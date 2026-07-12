// services/Clinical/icd10PcsImportService.js
// R7hr(PCS-P1) — shared ICD-10-PCS import: used by BOTH the CLI seeder
// (scripts/importIcd10Pcs.js) and the admin upload endpoint (POST
// /api/icd10/pcs/import), mirroring icd10ImportService for CM.
//
// Input: a "codes file" — one line per valid 7-char procedure code:
//   0016070 Bypass Cerebral Ventricle to Nasopharynx with Autologous ...
// (Backend/data/icd10pcs-codes-2026.txt.gz ships with the repo, derived
// from the CMS FY2026 PCS release; 3-char section-header rows excluded.)
// Accepts plain .txt or gzipped (.gz) buffers — detected by magic bytes.

const zlib = require("zlib");

function parsePcsCodesFile(buffer) {
  let text;
  // gzip magic: 0x1f 0x8b. Cap the inflated size (decompression-bomb guard —
  // the admin endpoint accepts a 25 MB upload; the real PCS file is ~7 MB
  // uncompressed, so 128 MB is a generous ceiling that still refuses a bomb).
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) text = zlib.gunzipSync(buffer, { maxOutputLength: 128 * 1024 * 1024 }).toString("utf8");
  else text = buffer.toString("utf8");

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    // PCS codes are exactly 7 alphanumerics (the alphabet excludes I and O
    // to avoid 1/0 confusion, but we don't enforce that here — the CMS
    // file is the authority; the length gate alone rejects header rows).
    const m = line.match(/^([A-Za-z0-9]{7})\s+(.+?)\s*$/);
    if (!m) continue;                                  // headers/blank lines
    rows.push({ code: m[1].toUpperCase(), description: m[2] });
  }
  return rows;
}

/**
 * Upsert the parsed release into the PCS master.
 * @param {Buffer} buffer  codes file (.txt or .gz)
 * @param {object} opts    { version, source, importedBy, prune }
 *   prune: deactivate codes NOT present in this release (safe delete —
 *   historical records keep resolving). Default true for full releases.
 * @returns {object} { parsed, upserted, modified, deactivated, count, version }
 */
async function importIcd10Pcs(buffer, opts = {}) {
  const { Icd10PcsCode, Icd10PcsMeta } = require("../../models/Clinical/Icd10PcsCodeModel");
  const version = opts.version || "";
  const rows = parsePcsCodesFile(buffer);
  if (rows.length < 1000) {
    // A real CMS PCS release has ~79k rows; a tiny parse means a wrong/
    // corrupt file — refuse rather than deactivate the master via prune.
    const e = new Error(`Parsed only ${rows.length} codes — not a valid ICD-10-PCS codes file`);
    e.status = 400;
    throw e;
  }

  let upserted = 0, modified = 0;
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const ops = rows.slice(i, i + BATCH).map((r) => ({
      updateOne: {
        filter: { code: r.code },
        update: { $set: { description: r.description, version, isActive: true } },
        upsert: true,
      },
    }));
    const res = await Icd10PcsCode.bulkWrite(ops, { ordered: false });
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
  }

  let deactivated = 0;
  if (opts.prune !== false) {
    const live = new Set(rows.map((r) => r.code));
    // Codes dropped by the new release → deactivate (never hard-delete:
    // old discharge summaries / claims still reference them).
    const stale = await Icd10PcsCode.find({ isActive: true }).select("code").lean();
    const gone = stale.filter((d) => !live.has(d.code)).map((d) => d.code);
    if (gone.length) {
      const res = await Icd10PcsCode.updateMany({ code: { $in: gone } }, { $set: { isActive: false } });
      deactivated = res.modifiedCount || 0;
    }
  }

  const count = await Icd10PcsCode.countDocuments({ isActive: true });
  await Icd10PcsMeta.findOneAndUpdate(
    {},
    { $set: { version, source: opts.source || "", count, importedAt: new Date(), importedBy: opts.importedBy || "" } },
    { upsert: true },
  );

  return { parsed: rows.length, upserted, modified, deactivated, count, version };
}

module.exports = { importIcd10Pcs, parsePcsCodesFile };
