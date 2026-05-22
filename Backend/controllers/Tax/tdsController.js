/**
 * controllers/Tax/tdsController.js  (R7bh-F6 / R7bg CRIT-A2)
 *
 * REST surface mounted at `/api/tds`. Owns the Form 16A
 * preview/generate/list workflow.
 */
"use strict";

const TdsCertificate = require("../../models/Tax/TdsCertificateModel");
const generator = require("../../services/Tax/form16aGenerator");
const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
const { decimalToNumber } = require("../../utils/money");
// R7bm-F9: envelope helper. Folds `count`/`created`/`skipped` siblings
// into the `meta` object so every method conforms to
// `{ success, data, meta? }`. F4's decimalToNumber unwraps preserved.
const { sendOk } = require("../../utils/apiEnvelope");

const actor = (req) => ({
  _id: req.user?._id || req.user?.id,
  fullName: req.user?.fullName || req.user?.name || "",
  role: req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

function _err(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

/**
 * GET /api/tds/16a/preview?quarter=Q1&fy=2026-27
 *   Returns the candidate certificates for the quarter without persisting.
 */
exports.previewForm16A = async (req, res, next) => {
  try {
    const quarter = String(req.query.quarter || req.body?.quarter || "").trim();
    const fy = String(req.query.fy || req.query.financialYear || req.body?.fy || "").trim();
    if (!/^Q[1-4]$/.test(quarter))
      return _err(res, 400, "BAD_QUARTER", "quarter must be Q1..Q4");
    if (!/^\d{4}-\d{2}$/.test(fy))
      return _err(res, 400, "BAD_FY", "fy must be e.g. 2026-27");
    const previews = await generator.previewForm16A(quarter, fy);
    return sendOk(res, previews, {
      count: previews.length,
      quarter,
      financialYear: fy,
    });
  } catch (e) {
    if (e.status)
      return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
  }
};

/**
 * POST /api/tds/16a/generate
 *   body: { quarter, fy, parties?: [tpaName,...] }
 *   When `parties` omitted, generates certificates for every TPA with TDS > 0.
 */
exports.generateForm16A = async (req, res, next) => {
  try {
    const u = actor(req);
    const quarter = String(req.body?.quarter || req.query?.quarter || "").trim();
    const fy = String(req.body?.fy || req.body?.financialYear || req.query?.fy || "").trim();
    if (!/^Q[1-4]$/.test(quarter))
      return _err(res, 400, "BAD_QUARTER", "quarter must be Q1..Q4");
    if (!/^\d{4}-\d{2}$/.test(fy))
      return _err(res, 400, "BAD_FY", "fy must be e.g. 2026-27");
    const parties = Array.isArray(req.body?.parties) ? req.body.parties : null;
    const previews = await generator.previewForm16A(quarter, fy);
    const subset = parties
      ? previews.filter((p) =>
          parties
            .map((s) => String(s).trim().toLowerCase())
            .includes(p.tpaParty.name.trim().toLowerCase()),
        )
      : previews;
    const created = [];
    const skipped = [];
    for (const p of subset) {
      try {
        const doc = await generator.persistForm16A(
          { ...p, quarter, financialYear: fy },
          u,
        );
        created.push(doc);
        emitBillingAudit(
          {
            event: "CRON_RECONCILED",
            actorId: u._id,
            actorName: u.fullName,
            actorRole: u.role,
            amount: doc.totalTdsDeducted,
            reason: `Form 16A generated: ${doc.certificateNumber} (${p.tpaParty.name}, ${fy} ${quarter})`,
            after: {
              certificateNumber: doc.certificateNumber,
              tpaParty: doc.tpaParty.name,
              totalAmountPaid: p.totalAmountPaid,
              totalTdsDeducted: p.totalTdsDeducted,
            },
          },
          { req },
        );
      } catch (err) {
        skipped.push({ tpaParty: p.tpaParty.name, reason: err.message });
      }
    }
    return sendOk(res, created, {
      created: created.length,
      skipped,
      quarter,
      financialYear: fy,
    }, 201);
  } catch (e) {
    if (e.status)
      return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
  }
};

/**
 * PUT /api/tds/16a/:id/issue — mark DRAFT → ISSUED
 */
exports.issue = async (req, res, next) => {
  try {
    const updated = await TdsCertificate.findOneAndUpdate(
      { _id: req.params.id, status: "DRAFT" },
      { $set: { status: "ISSUED", issuedAt: new Date() } },
      { new: true },
    );
    if (!updated)
      return _err(res, 409, "INVALID_STATE", "Certificate not in DRAFT — cannot issue");
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
};

/**
 * PUT /api/tds/16a/:id/mark-filed — store TRACES ARN
 */
exports.markFiled = async (req, res, next) => {
  try {
    const arn = String(req.body?.arnFromTraces || req.body?.arn || "").trim();
    if (!arn) return _err(res, 400, "ARG_MISSING", "arnFromTraces is required");
    const updated = await TdsCertificate.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ["DRAFT", "ISSUED"] } },
      {
        $set: {
          status: "FILED",
          filedAt: new Date(),
          arnFromTraces: arn,
        },
      },
      { new: true },
    );
    if (!updated)
      return _err(
        res,
        409,
        "INVALID_STATE",
        "Certificate must be DRAFT/ISSUED before marking FILED",
      );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
};

exports.list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.quarter) q.quarter = req.query.quarter;
    if (req.query.fy) q.financialYear = req.query.fy;
    if (req.query.status) q.status = req.query.status;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    const rows = await TdsCertificate.find(q)
      .sort({ financialYear: -1, quarter: -1 })
      .limit(limit)
      .lean();
    // R7bm-F4 / R7bl-3-CRIT-2 — .lean() bypasses the model's toJSON
    // transform; totalAmountPaid / totalTdsDeducted ship as `{$numberDecimal:"…"}`
    // and the frontend's bare `Number(...)` then renders ₹0. Walk each row
    // and unwrap Decimal128 → plain Number.
    rows.forEach((r) => decimalToNumber(null, r));
    return sendOk(res, rows, { count: rows.length });
  } catch (e) {
    next(e);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const doc = await TdsCertificate.findById(req.params.id).lean();
    if (!doc) return _err(res, 404, "NOT_FOUND", "Certificate not found");
    // R7bm-F4 / R7bl-3-CRIT-2 — lean bypasses toJSON; unwrap Decimal128.
    decimalToNumber(null, doc);
    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
};
