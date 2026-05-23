/**
 * controllers/Tax/taxReturnController.js  (R7bh-F6 / R7bg CRIT-A1 / GST §37 + §39)
 *
 * REST surface mounted at `/api/tax-returns`. Wraps the GSTR-1 / GSTR-3B
 * exporters + the GstReturnSnapshot persistence model. The accountant's
 * workflow is preview → generate (persist DRAFT) → finalize → mark-filed.
 */
"use strict";

const GstReturnSnapshot = require("../../models/Tax/GstReturnSnapshotModel");
const gstr1 = require("../../services/Tax/gstr1Exporter");
const gstr3b = require("../../services/Tax/gstr3bExporter");
const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
const { decimalToNumber } = require("../../utils/money");
// R7bm-F9: envelope helper — `count` moves to `meta` on list() so list()
// matches `{ success, data, meta? }`. The F4 decimalToNumber unwrap on
// list+getOne is preserved verbatim.
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

/* ────────────────────────────────────────────────────────────────
   PREVIEW — build JSON without persisting
──────────────────────────────────────────────────────────────── */
exports.previewGSTR1 = async (req, res, next) => {
  try {
    const period = String(req.query.period || req.body?.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return _err(res, 400, "BAD_PERIOD", "period must be YYYY-MM");
    }
    const json = await gstr1.previewGSTR1(period);
    res.json({ success: true, data: json });
  } catch (e) {
    next(e);
  }
};

exports.previewGSTR3B = async (req, res, next) => {
  try {
    const period = String(req.query.period || req.body?.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return _err(res, 400, "BAD_PERIOD", "period must be YYYY-MM");
    }
    const json = await gstr3b.previewGSTR3B(period);
    res.json({ success: true, data: json });
  } catch (e) {
    next(e);
  }
};

/* ────────────────────────────────────────────────────────────────
   GENERATE — persist DRAFT (or refresh an existing DRAFT)
──────────────────────────────────────────────────────────────── */
async function _generate(period, returnKind, builder, u) {
  // Reject re-generation if a FINALIZED/FILED snapshot exists.
  const existing = await GstReturnSnapshot.findOne({ period, returnKind });
  if (existing && existing.filingStatus !== "DRAFT") {
    const e = new Error(
      `Cannot regenerate — period ${period} ${returnKind} is ${existing.filingStatus}`,
    );
    e.status = 409;
    e.code = "ALREADY_FINALIZED";
    throw e;
  }
  const json = await builder(period);
  const summary = json.summary || {};
  if (existing) {
    existing.generatedAt = new Date();
    existing.generatedBy = u._id || null;
    existing.generatedByName = u.fullName || "";
    existing.jsonPayload = json;
    existing.summary = {
      totalTaxable: summary.totalTaxable || 0,
      totalCgst: summary.totalCgst || 0,
      totalSgst: summary.totalSgst || 0,
      totalIgst: summary.totalIgst || 0,
      hsnCount: summary.hsnCount || 0,
      lineCount: summary.lineCount || 0,
    };
    await existing.save();
    return existing;
  }
  const doc = await GstReturnSnapshot.create({
    period,
    returnKind,
    generatedAt: new Date(),
    generatedBy: u._id || null,
    generatedByName: u.fullName || "",
    jsonPayload: json,
    summary: {
      totalTaxable: summary.totalTaxable || 0,
      totalCgst: summary.totalCgst || 0,
      totalSgst: summary.totalSgst || 0,
      totalIgst: summary.totalIgst || 0,
      hsnCount: summary.hsnCount || 0,
      lineCount: summary.lineCount || 0,
    },
    filingStatus: "DRAFT",
    hospitalId: u.hospitalId || null,
  });
  return doc;
}

exports.generateGSTR1 = async (req, res, next) => {
  try {
    const period = String(req.query.period || req.body?.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return _err(res, 400, "BAD_PERIOD", "period must be YYYY-MM");
    }
    const u = actor(req);
    const doc = await _generate(period, "GSTR-1", gstr1.buildGSTR1JSON, u);
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    if (e.status)
      return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
  }
};

exports.generateGSTR3B = async (req, res, next) => {
  try {
    const period = String(req.query.period || req.body?.period || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return _err(res, 400, "BAD_PERIOD", "period must be YYYY-MM");
    }
    const u = actor(req);
    const doc = await _generate(period, "GSTR-3B", gstr3b.buildGSTR3BJSON, u);
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    if (e.status)
      return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
  }
};

/* ────────────────────────────────────────────────────────────────
   FINALIZE — lock further changes
──────────────────────────────────────────────────────────────── */
exports.finalize = async (req, res, next) => {
  try {
    const u = actor(req);
    const updated = await GstReturnSnapshot.findOneAndUpdate(
      { _id: req.params.id, filingStatus: "DRAFT" },
      {
        $set: {
          filingStatus: "FINALIZED",
          finalizedAt: new Date(),
          finalizedBy: u._id || null,
        },
      },
      { new: true },
    );
    if (!updated)
      return _err(
        res,
        409,
        "INVALID_STATE",
        "Snapshot not in DRAFT state — cannot finalize",
      );
    emitBillingAudit(
      {
        event: "CRON_RECONCILED",
        actorId: u._id,
        actorName: u.fullName,
        actorRole: u.role,
        reason: `GST return finalized: ${updated.returnKind} ${updated.period}`,
        after: {
          snapshotId: updated._id,
          period: updated.period,
          returnKind: updated.returnKind,
          filingStatus: "FINALIZED",
        },
      },
      { req },
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
};

/* ────────────────────────────────────────────────────────────────
   MARK FILED — store ARN
──────────────────────────────────────────────────────────────── */
exports.markFiled = async (req, res, next) => {
  try {
    const u = actor(req);
    const arn = String(req.body?.arn || "").trim();
    if (!arn) return _err(res, 400, "ARG_MISSING", "arn is required");
    const updated = await GstReturnSnapshot.findOneAndUpdate(
      { _id: req.params.id, filingStatus: "FINALIZED" },
      {
        $set: {
          filingStatus: "FILED",
          arn,
          filedAt: new Date(),
          filedBy: u._id || null,
        },
      },
      { new: true },
    );
    if (!updated)
      return _err(
        res,
        409,
        "INVALID_STATE",
        "Snapshot must be FINALIZED before marking FILED",
      );
    emitBillingAudit(
      {
        event: "CRON_RECONCILED",
        actorId: u._id,
        actorName: u.fullName,
        actorRole: u.role,
        reason: `GST return filed: ${updated.returnKind} ${updated.period}, ARN=${arn}`,
        after: {
          snapshotId: updated._id,
          period: updated.period,
          returnKind: updated.returnKind,
          arn,
          filingStatus: "FILED",
        },
      },
      { req },
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
};

/* ────────────────────────────────────────────────────────────────
   LIST + DETAIL
──────────────────────────────────────────────────────────────── */
exports.list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.returnKind) q.returnKind = req.query.returnKind;
    if (req.query.filingStatus) q.filingStatus = req.query.filingStatus;
    if (req.query.from || req.query.to) {
      q.period = {};
      if (req.query.from) q.period.$gte = String(req.query.from);
      if (req.query.to) q.period.$lte = String(req.query.to);
    }
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    const rows = await GstReturnSnapshot.find(q)
      .sort({ period: -1, returnKind: 1 })
      .limit(limit)
      // Exclude the heavy jsonPayload from the list view; clients fetch
      // detail via /:id when they want the actual portal JSON.
      .select("-jsonPayload")
      .lean();
    // R7bm-F4 / R7bl-3-CRIT-1 — .lean() bypasses the model's toJSON
    // transform so summary.totalTaxable/Cgst/Sgst/Igst would ship as
    // `{$numberDecimal:"…"}`. Walk each row and unwrap Decimal128 leaves
    // back to plain JS numbers (matches the wire shape non-lean reads
    // produce via decimalToNumber).
    rows.forEach((r) => decimalToNumber(null, r));
    return sendOk(res, rows, { count: rows.length });
  } catch (e) {
    next(e);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const doc = await GstReturnSnapshot.findById(req.params.id).lean();
    if (!doc) return _err(res, 404, "NOT_FOUND", "Snapshot not found");
    // R7bm-F4 / R7bl-3-CRIT-1 — lean bypasses toJSON; unwrap Decimal128
    // walk so summary.totalTaxable etc. ship as plain numbers.
    decimalToNumber(null, doc);
    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
};
