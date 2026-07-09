// controllers/Clinical/icd10Controller.js
// R7hr(ICD-P1.2) — ICD-10 master search (typeahead) + release meta +
// admin import of the yearly CMS file.

const { Icd10Code, Icd10Meta } = require("../../models/Clinical/Icd10CodeModel");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/icd10/search?q=pneum  |  q=J18  |  q=J18.9
// Code-ish queries (letter+digit start) match code prefix; word queries
// match word-prefixes in the description (all terms must hit). Sorted
// shortest-description-first so broad/parent diagnoses surface on top.
exports.search = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    if (q.length < 2) return res.json({ success: true, data: [] });

    let filter;
    const codeish = /^[A-Za-z][0-9]/.test(q);
    if (codeish) {
      filter = { isActive: true, code: { $regex: `^${escapeRe(q.replace(/\./g, "").toUpperCase())}` } };
    } else {
      const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
      filter = {
        isActive: true,
        $and: terms.map((t) => ({ description: { $regex: `\\b${escapeRe(t)}`, $options: "i" } })),
      };
    }

    const rows = await Icd10Code.aggregate([
      { $match: filter },
      { $addFields: { _len: { $strLenCP: "$description" } } },
      { $sort: codeish ? { code: 1 } : { _len: 1, code: 1 } },
      { $limit: limit },
      { $project: { _id: 0, code: "$dotted", raw: "$code", description: 1 } },
    ]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/icd10/meta — which release is loaded (picker shows freshness).
exports.meta = async (_req, res) => {
  try {
    const m = await Icd10Meta.findOne({}).lean();
    res.json({ success: true, data: m ? { version: m.version, count: m.count, importedAt: m.importedAt, source: m.source } : { version: "", count: 0 } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/icd10/import  (multipart "file" + optional "version") — the
// "always updated" lever: upload next year's CMS codes file, master
// refreshes in place (upsert + deactivate-dropped).
exports.importFile = async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ success: false, message: "codes file required (field: file)" });
    const { importIcd10 } = require("../../services/Clinical/icd10ImportService");
    const result = await importIcd10(req.file.buffer, {
      version: String(req.body.version || "").trim() || "custom",
      source: req.file.originalname || "upload",
      importedBy: req.user?.name || req.user?.email || "admin-upload",
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};
