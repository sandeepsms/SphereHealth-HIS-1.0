// services/Clinical/icd10ImportService.js
// R7hr(ICD-P1.1) — shared ICD-10-CM import: used by BOTH the CLI seeder
// (scripts/importIcd10.js) and the admin upload endpoint (POST
// /api/icd10/import), so the yearly refresh is one code path.
//
// Input: the CMS/NCHS "codes file" — one line per billable code:
//   A0100   Typhoid fever, unspecified
// (code = chars before first whitespace run, description = the rest).
// Accepts plain .txt or gzipped (.gz) buffers — detected by magic bytes.

const zlib = require("zlib");

const dot = (raw) => (raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw);

function parseCodesFile(buffer) {
  let text;
  // gzip magic: 0x1f 0x8b
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) text = zlib.gunzipSync(buffer).toString("utf8");
  else text = buffer.toString("utf8");

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]{2,7})\s+(.+?)\s*$/);
    if (!m) continue;                                  // headers/blank lines
    const code = m[1].toUpperCase();
    rows.push({ code, dotted: dot(code), description: m[2] });
  }
  return rows;
}

/**
 * Upsert the parsed release into the master.
 * @param {Buffer} buffer  codes file (.txt or .gz)
 * @param {object} opts    { version, source, importedBy, prune }
 *   prune: deactivate codes NOT present in this release (safe delete —
 *   historical notes keep resolving). Default true for full releases.
 * @returns {object} { parsed, upserted, modified, deactivated, count, version }
 */
async function importIcd10(buffer, opts = {}) {
  const { Icd10Code, Icd10Meta } = require("../../models/Clinical/Icd10CodeModel");
  const version = opts.version || "";
  const rows = parseCodesFile(buffer);
  if (rows.length < 1000) {
    // A real CMS release has ~74k rows; a tiny parse means a wrong/corrupt
    // file — refuse rather than deactivate the whole master via prune.
    const e = new Error(`Parsed only ${rows.length} codes — not a valid ICD-10-CM codes file`);
    e.status = 400;
    throw e;
  }

  let upserted = 0, modified = 0;
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const ops = rows.slice(i, i + BATCH).map((r) => ({
      updateOne: {
        filter: { code: r.code },
        update: { $set: { dotted: r.dotted, description: r.description, version, isActive: true } },
        upsert: true,
      },
    }));
    const res = await Icd10Code.bulkWrite(ops, { ordered: false });
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
  }

  let deactivated = 0;
  if (opts.prune !== false) {
    const live = new Set(rows.map((r) => r.code));
    // Codes dropped by the new release → deactivate (never hard-delete:
    // old discharge summaries / claims still reference them).
    const stale = await Icd10Code.find({ isActive: true }).select("code").lean();
    const gone = stale.filter((d) => !live.has(d.code)).map((d) => d.code);
    if (gone.length) {
      const res = await Icd10Code.updateMany({ code: { $in: gone } }, { $set: { isActive: false } });
      deactivated = res.modifiedCount || 0;
    }
  }

  const count = await Icd10Code.countDocuments({ isActive: true });
  await Icd10Meta.findOneAndUpdate(
    {},
    { $set: { version, source: opts.source || "", count, importedAt: new Date(), importedBy: opts.importedBy || "" } },
    { upsert: true },
  );

  return { parsed: rows.length, upserted, modified, deactivated, count, version };
}

module.exports = { importIcd10, parseCodesFile };
