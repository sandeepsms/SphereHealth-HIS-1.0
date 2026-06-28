// scripts/backup/backupEngine.js
// ════════════════════════════════════════════════════════════════════
// R7hr-253 — Tool-free MongoDB backup engine (no mongodump required).
//
// Reads every collection via the MongoDB driver already bundled with the
// app and streams it into a SINGLE compressed, full-fidelity file:
//   <name>.shbak.gz   (gzip of newline-delimited canonical-EJSON records)
//   <name>.shbak.gz.sha256   (integrity sidecar)
//
// Why EJSON: canonical Extended JSON preserves every BSON type exactly —
// ObjectId, Date, Decimal128, Long/int64, Binary, etc. — so a restore is
// byte-faithful, unlike a naive JSON.stringify.
//
// Streaming, so memory stays flat regardless of DB size. Indexes are
// captured per collection so a restore rebuilds them.
// ════════════════════════════════════════════════════════════════════
"use strict";

const { MongoClient } = require("mongodb");
const { EJSON }       = require("bson");
const zlib   = require("zlib");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const FORMAT = "sphere-backup-v1";

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Back up the whole database `uri` points at into a single .shbak.gz file.
 * Returns { outFile, sha256, sizeBytes, collections:[{name,count}], totalDocs }.
 */
async function backupDatabase({ uri, outFile, log = () => {} }) {
  if (!uri) throw new Error("backupDatabase: uri required");
  if (!outFile) throw new Error("backupDatabase: outFile required");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const db = client.db();
    const collInfos = (await db.listCollections().toArray())
      .filter((c) => c.type === "collection" && !c.name.startsWith("system."))
      .sort((a, b) => a.name.localeCompare(b.name));

    log(`Backing up "${db.databaseName}" — ${collInfos.length} collections → ${outFile}`);

    const out  = fs.createWriteStream(outFile);
    const gzip = zlib.createGzip({ level: 9 });
    let streamErr = null;
    gzip.on("error", (e) => { streamErr = e; });
    out.on("error",  (e) => { streamErr = e; });
    gzip.pipe(out);

    const writeLine = (obj) =>
      new Promise((resolve, reject) => {
        if (streamErr) return reject(streamErr);
        const ok = gzip.write(JSON.stringify(obj) + "\n");
        if (ok) return resolve();
        // R7hr-254 (audit: backpressure path could hang on a stream error) —
        // resolve on drain, but reject if the stream errors while we wait.
        const onDrain = () => { gzip.removeListener("error", onErr); streamErr ? reject(streamErr) : resolve(); };
        const onErr   = () => { gzip.removeListener("drain", onDrain); reject(streamErr || new Error("backup write-stream error")); };
        gzip.once("drain", onDrain);
        gzip.once("error", onErr);
      });

    await writeLine({
      t: "header", format: FORMAT, createdAt: new Date().toISOString(),
      db: db.databaseName, node: process.version, collectionCount: collInfos.length,
    });

    const summary = [];
    let grandTotal = 0;
    for (const info of collInfos) {
      const coll = db.collection(info.name);
      let indexes = [];
      try { indexes = await coll.indexes(); } catch (_) { /* capped/views/perm — skip */ }
      await writeLine({ t: "collstart", name: info.name, options: info.options || {}, indexes });

      let count = 0;
      const cursor = coll.find({});
      for await (const doc of cursor) {
        await writeLine({ t: "doc", c: info.name, d: EJSON.serialize(doc, { relaxed: false }) });
        count++;
      }
      await writeLine({ t: "collend", name: info.name, count });
      summary.push({ name: info.name, count });
      grandTotal += count;
    }
    await writeLine({ t: "footer", collections: summary, totalDocs: grandTotal });

    await new Promise((resolve, reject) => {
      gzip.end();
      out.on("finish", resolve);
      out.on("error", reject);
      gzip.on("error", reject);
    });
    if (streamErr) throw streamErr;

    const sha256    = await sha256File(outFile);
    const sizeBytes = fs.statSync(outFile).size;
    fs.writeFileSync(outFile + ".sha256", `${sha256}  ${path.basename(outFile)}\n`);

    log(`Done — ${grandTotal} docs, ${(sizeBytes / 1048576).toFixed(2)} MB, sha256 ${sha256.slice(0, 12)}…`);
    return { outFile, sha256, sizeBytes, collections: summary, totalDocs: grandTotal, createdAt: new Date().toISOString() };
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { backupDatabase, sha256File, FORMAT };
