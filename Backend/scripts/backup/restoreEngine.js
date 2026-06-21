// scripts/backup/restoreEngine.js
// ════════════════════════════════════════════════════════════════════
// R7hr-253 — Companion to backupEngine.js. Restores a .shbak.gz file
// produced by it — tool-free (no mongorestore required).
//
// Safety: verifies the .sha256 sidecar BEFORE touching the target DB, so
// a corrupted (half-copied / truncated upload) backup never silently
// overwrites good data. `drop:true` re-creates collections from scratch;
// the default is an additive merge.
//
// Index rebuild: each collection's indexes were captured at backup time
// and are re-created after its documents are inserted.
// ════════════════════════════════════════════════════════════════════
"use strict";

const { MongoClient } = require("mongodb");
const { EJSON }       = require("bson");
const zlib     = require("zlib");
const fs       = require("fs");
const readline = require("readline");
const { sha256File } = require("./backupEngine");

async function verifyChecksum(inFile) {
  const side = inFile + ".sha256";
  if (!fs.existsSync(side)) return { checked: false };
  const expected = fs.readFileSync(side, "utf8").trim().split(/\s+/)[0];
  const actual   = await sha256File(inFile);
  if (expected !== actual) {
    throw new Error(`Checksum mismatch — backup file is corrupt or truncated.\n  expected ${expected}\n  actual   ${actual}`);
  }
  return { checked: true, sha256: actual };
}

function indexSpecsFrom(rawIndexes) {
  return (rawIndexes || [])
    .filter((ix) => ix && ix.name !== "_id_" && ix.key)
    .map((ix) => {
      const spec = { key: ix.key, name: ix.name };
      for (const k of ["unique", "sparse", "partialFilterExpression", "expireAfterSeconds", "collation", "weights", "default_language"]) {
        if (ix[k] !== undefined) spec[k] = ix[k];
      }
      return spec;
    });
}

/**
 * Restore `inFile` into the DB at `uri`.
 *   drop:true     — drop each collection before re-inserting (clean restore)
 *   only:[names]  — restore just these collections
 * Returns { restored:[{name,count}], totalDocs }.
 */
async function restoreDatabase({ uri, inFile, drop = false, only = null, batchSize = 1000, log = () => {} }) {
  if (!fs.existsSync(inFile)) throw new Error(`Backup file not found: ${inFile}`);
  const chk = await verifyChecksum(inFile);
  log(chk.checked ? `Checksum OK (${chk.sha256.slice(0, 12)}…)` : "No .sha256 sidecar — skipping integrity check");

  const onlySet = only ? new Set(Array.isArray(only) ? only : [only]) : null;
  const client  = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const db = client.db();
    const rl = readline.createInterface({
      input: fs.createReadStream(inFile).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });

    const summary = [];
    let curName = null, curIndexes = [], batch = [], skip = false, count = 0;

    const flush = async () => {
      if (batch.length && !skip) {
        await db.collection(curName).insertMany(batch, { ordered: false })
          .catch((e) => { if (e.code !== 11000) throw e; }); // ignore dup-key on merge
      }
      batch = [];
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);

      if (rec.t === "header") {
        log(`Restoring "${rec.db}" backup (${rec.format}, ${rec.collectionCount} collections, taken ${rec.createdAt})`);
      } else if (rec.t === "collstart") {
        curName = rec.name; curIndexes = rec.indexes || []; count = 0;
        skip = onlySet ? !onlySet.has(curName) : false;
        if (!skip && drop) await db.collection(curName).drop().catch(() => {});
      } else if (rec.t === "doc") {
        if (skip) continue;
        batch.push(EJSON.deserialize(rec.d, { relaxed: false }));
        count++;
        if (batch.length >= batchSize) await flush();
      } else if (rec.t === "collend") {
        await flush();
        if (!skip) {
          const specs = indexSpecsFrom(curIndexes);
          if (specs.length) {
            try { await db.collection(curName).createIndexes(specs); }
            catch (e) { log(`  ! index rebuild on ${curName}: ${e.message}`); }
          }
          summary.push({ name: curName, count });
          log(`  ✓ ${curName}: ${count}`);
        }
      }
    }
    return { restored: summary, totalDocs: summary.reduce((s, x) => s + x.count, 0) };
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { restoreDatabase, verifyChecksum };
