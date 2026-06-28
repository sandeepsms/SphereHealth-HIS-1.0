// scripts/backup/restoreEngine.js
// ════════════════════════════════════════════════════════════════════
// R7hr-254 — Hardened restore engine (companion to backupEngine.js),
// tool-free (no mongorestore). Closes the 10-dim backup-audit findings:
//
//   • COUNTS WHAT IS WRITTEN, not what is read — returns real applied
//     counts (insertedCount / upserted+matched) so the drill can't be a
//     tautology, and re-derives per-collection truth.
//   • COMPLETENESS — validates the footer + every collend count; refuses
//     a truncated-but-checksum-valid archive (allowPartial to override).
//   • MERGE is authoritative — replaceOne(upsert) so the backup version
//     wins instead of being dropped by a swallowed dup-key.
//   • LOUD failures — drop() failure (other than not-found) aborts; a
//     batch error is swallowed ONLY when every writeError is dup-key.
//   • Collection options (capped/validator/collation) + empty collections
//     are recreated; index-rebuild failures are collected + surfaced.
//   • Checksum verified BEFORE any write.
// ════════════════════════════════════════════════════════════════════
"use strict";

const { MongoClient } = require("mongodb");
const { EJSON }       = require("bson");
const zlib     = require("zlib");
const fs       = require("fs");
const readline = require("readline");
const { sha256File } = require("./backupEngine");

const NS_NOT_FOUND = 26;
const DUP_KEY = 11000;

async function verifyChecksum(inFile) {
  const side = inFile + ".sha256";
  if (!fs.existsSync(side)) throw new Error(`Missing .sha256 sidecar for ${inFile} — refusing to trust an unverifiable backup.`);
  const expected = fs.readFileSync(side, "utf8").trim().split(/\s+/)[0];
  const actual   = await sha256File(inFile);
  if (expected !== actual) throw new Error(`Checksum mismatch — backup is corrupt or truncated.\n  expected ${expected}\n  actual   ${actual}`);
  return { checked: true, sha256: actual };
}

function indexSpecsFrom(rawIndexes) {
  return (rawIndexes || [])
    .filter((ix) => ix && ix.name !== "_id_" && ix.key)
    .map((ix) => {
      const spec = { key: ix.key, name: ix.name };
      for (const k of ["unique", "sparse", "partialFilterExpression", "expireAfterSeconds", "collation",
                       "weights", "default_language", "language_override", "textIndexVersion", "2dsphereIndexVersion",
                       "bits", "min", "max", "wildcardProjection"]) {
        if (ix[k] !== undefined) spec[k] = ix[k];
      }
      return spec;
    });
}

// Build a clean createCollection options object from what listCollections captured.
function collectionCreateOpts(rawOptions) {
  const o = rawOptions || {};
  const out = {};
  if (o.capped) { out.capped = true; if (o.size) out.size = o.size; if (o.max) out.max = o.max; }
  if (o.validator)       out.validator = o.validator;
  if (o.validationLevel) out.validationLevel = o.validationLevel;
  if (o.validationAction) out.validationAction = o.validationAction;
  if (o.collation && o.collation.locale) out.collation = o.collation;
  return out;
}

/**
 * Validate a backup FILE without touching any DB — streams it and checks
 * the footer is present and every per-collection collend count matches the
 * docs seen. Cheap; used as the nightly restorability check.
 * Returns { footerSeen, totalDocs, collections:[{name,count}], mismatches:[] }.
 */
async function validateBackupFile(inFile) {
  await verifyChecksum(inFile);
  const rl = readline.createInterface({ input: fs.createReadStream(inFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let footer = null, cur = null, seen = 0;
  const collections = [], mismatches = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.t === "collstart") { cur = rec.name; seen = 0; }
    else if (rec.t === "doc") { seen++; }
    else if (rec.t === "collend") {
      if (seen !== rec.count) mismatches.push(`${rec.name}: saw ${seen}, collend says ${rec.count}`);
      collections.push({ name: rec.name, count: seen });
    } else if (rec.t === "footer") footer = rec;
  }
  const totalDocs = collections.reduce((s, c) => s + c.count, 0);
  if (!footer) mismatches.push("no footer record — file is truncated/incomplete");
  else if (footer.totalDocs !== totalDocs) mismatches.push(`footer.totalDocs ${footer.totalDocs} != docs seen ${totalDocs}`);
  return { footerSeen: !!footer, totalDocs, collections, mismatches };
}

/**
 * Restore `inFile` into the DB at `uri`.
 *   drop:true     — drop+recreate each collection (clean cold-recovery; uses insertMany)
 *   (no drop)     — MERGE: replaceOne(upsert) so the BACKUP version is authoritative
 *   only:[names]  — restore just these collections
 *   allowPartial  — proceed even if the archive is truncated (default: refuse)
 * Returns { restored:[{name,inFile,applied}], totalApplied, totalInFile, indexErrors, footerSeen }.
 */
async function restoreDatabase({ uri, inFile, drop = false, only = null, batchSize = 1000, allowPartial = false, log = () => {} }) {
  if (!fs.existsSync(inFile)) throw new Error(`Backup file not found: ${inFile}`);
  const chk = await verifyChecksum(inFile);
  log(`Checksum OK (${chk.sha256.slice(0, 12)}…)`);

  const onlySet = only ? new Set(Array.isArray(only) ? only : [only]) : null;
  const client  = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const db = client.db();
    const rl = readline.createInterface({ input: fs.createReadStream(inFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });

    const restored = [], indexErrors = [], mismatches = [];
    let curName = null, curIndexes = [], curOptions = {}, batch = [], skip = false;
    let seen = 0, applied = 0, totalInFile = 0, footer = null, header = null;

    const flush = async () => {
      if (!batch.length || skip) { batch = []; return; }
      try {
        if (drop) {
          const r = await db.collection(curName).insertMany(batch, { ordered: false });
          applied += r.insertedCount || 0;
        } else {
          // MERGE — backup is authoritative: overwrite any existing _id.
          const ops = batch.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
          const r = await db.collection(curName).bulkWrite(ops, { ordered: false });
          applied += (r.upsertedCount || 0) + (r.matchedCount || 0);
        }
      } catch (e) {
        const writeErrs = e.writeErrors || (e.result && e.result.writeErrors) || [];
        const allDup = writeErrs.length > 0 && writeErrs.every((w) => (w.code || (w.err && w.err.code)) === DUP_KEY);
        if (!allDup) throw e; // a NON-dup-key failure must abort loudly, not silently drop docs
        applied += (e.result && (e.result.insertedCount || e.result.nInserted)) || 0;
      }
      batch = [];
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);

      if (rec.t === "header") { header = rec; log(`Restoring "${rec.db}" (${rec.format}, ${rec.collectionCount} collections, taken ${rec.createdAt})`); }
      else if (rec.t === "collstart") {
        curName = rec.name; curIndexes = rec.indexes || []; curOptions = rec.options || {}; seen = 0; applied = 0;
        skip = onlySet ? !onlySet.has(curName) : false;
        if (!skip) {
          if (drop) await db.collection(curName).drop().catch((e) => {
            if ((e.code !== NS_NOT_FOUND) && !/ns not found/i.test(e.message || "")) throw new Error(`drop ${curName} failed (refusing to silently merge onto stale data): ${e.message}`);
          });
          // recreate the collection WITH its options (capped/validator/collation) so a
          // clean restore keeps those constraints; also makes empty collections exist.
          const opts = collectionCreateOpts(curOptions);
          await db.createCollection(curName, opts).catch((e) => { if (!/already exists|NamespaceExists/i.test(e.message || "")) log(`  ! createCollection ${curName}: ${e.message}`); });
        }
      } else if (rec.t === "doc") {
        if (skip) continue;
        seen++; totalInFile++;
        batch.push(EJSON.deserialize(rec.d, { relaxed: false }));
        if (batch.length >= batchSize) await flush();
      } else if (rec.t === "collend") {
        await flush();
        if (seen !== rec.count) mismatches.push(`${rec.name}: ${seen} docs in stream vs collend ${rec.count}`);
        if (!skip) {
          const specs = indexSpecsFrom(curIndexes);
          if (specs.length) {
            try { await db.collection(curName).createIndexes(specs); }
            catch (e) { indexErrors.push({ collection: curName, error: e.message }); log(`  ! INDEX REBUILD FAILED on ${curName}: ${e.message}`); }
          }
          restored.push({ name: curName, applied });
          log(`  ✓ ${curName}: ${applied} applied`);
        }
      } else if (rec.t === "footer") footer = rec;
    }

    // COMPLETENESS — a truncated archive must not pass as a full restore.
    if (!footer) {
      const msg = "Backup has NO footer record — it is truncated/incomplete.";
      if (!allowPartial) throw new Error(`${msg} (pass allowPartial to force).`);
      log(`WARNING: ${msg}`);
    }
    if (mismatches.length) {
      const msg = `Per-collection count mismatches (truncation/corruption):\n  ${mismatches.join("\n  ")}`;
      if (!allowPartial) throw new Error(msg);
      log(`WARNING: ${msg}`);
    }

    return {
      restored, totalInFile, footerSeen: !!footer,
      totalApplied: restored.reduce((s, x) => s + x.applied, 0),
      indexErrors, header, footer,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { restoreDatabase, verifyChecksum, validateBackupFile };
