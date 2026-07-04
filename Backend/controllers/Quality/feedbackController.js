/**
 * feedbackController — NABH patient satisfaction & experience feedback.
 *
 * Staff surface (authenticated):
 *   POST /api/feedback              staffCreate   — reception/discharge entry
 *   POST /api/feedback/generate-link generateLink — mint a patient link/QR
 *   GET  /api/feedback              list          — filtered, paginated
 *   GET  /api/feedback/stats        stats         — dashboard aggregation
 *
 * Public surface (no login, rate-limited — mounted before the JWT wall):
 *   GET  /api/public-feedback/:token  publicGetForm — form context
 *   POST /api/public-feedback/:token  publicSubmit  — patient submits
 */
const PatientFeedback = require("../../models/Quality/PatientFeedbackModel");
const { RATING_KEYS } = PatientFeedback;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";

// Coerce an incoming ratings blob into the {key: 0-5} shape (ignores junk keys).
function sanitizeRatings(input) {
  const out = {};
  for (const k of RATING_KEYS) {
    const n = Number(input?.[k]);
    out[k] = Number.isFinite(n) ? clamp(Math.round(n), 0, 5) : 0;
  }
  return out;
}

function sanitizeVisitType(v) {
  const allowed = ["OPD", "IPD", "Emergency", "Daycare", "Walk-in"];
  return allowed.includes(v) ? v : "OPD";
}

// Shape the fields a patient/staff is allowed to fill (shared by both paths).
function pickFeedbackFields(body) {
  const npsRaw = body?.npsScore;
  const nps = (npsRaw === "" || npsRaw == null) ? null : clamp(Math.round(Number(npsRaw)), 0, 10);
  return {
    ratings: sanitizeRatings(body?.ratings),
    npsScore: Number.isFinite(nps) ? nps : null,
    wentWell: String(body?.wentWell || "").slice(0, 4000),
    improvements: String(body?.improvements || "").slice(0, 4000),
    contactConsent: !!body?.contactConsent,
    anonymous: !!body?.anonymous,
  };
}

// ── STAFF: direct entry (reception / discharge / quality desk) ──────────────
exports.staffCreate = async (req, res) => {
  try {
    const b = req.body || {};
    const doc = await PatientFeedback.create({
      UHID: String(b.UHID || "").toUpperCase().trim(),
      patientName: b.anonymous ? "" : String(b.patientName || ""),
      contactNumber: b.anonymous ? "" : String(b.contactNumber || ""),
      admissionId: b.admissionId || null,
      visitType: sanitizeVisitType(b.visitType),
      department: String(b.department || ""),
      ward: String(b.ward || ""),
      ...pickFeedbackFields(b),
      submittedVia: "staff",
      submittedByUserId: req.user?._id || null,
      submittedByName: req.user?.fullName || req.user?.name || "",
      submittedFromIp: clientIp(req),
      submittedAt: new Date(),
      status: "submitted",
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_CREATE_FAILED", message: err.message });
  }
};

// ── STAFF: mint a patient-facing link / QR (creates a pending row) ──────────
exports.generateLink = async (req, res) => {
  try {
    const b = req.body || {};
    const token = PatientFeedback.newToken();
    const days = clamp(Number(b.validDays) || 14, 1, 90);
    const doc = await PatientFeedback.create({
      UHID: String(b.UHID || "").toUpperCase().trim(),
      patientName: String(b.patientName || ""),
      contactNumber: String(b.contactNumber || ""),
      admissionId: b.admissionId || null,
      visitType: sanitizeVisitType(b.visitType),
      department: String(b.department || ""),
      ward: String(b.ward || ""),
      submittedVia: "patient-link",
      generatedByName: req.user?.fullName || req.user?.name || "",
      publicToken: token,
      tokenExpiresAt: new Date(Date.now() + days * 86400000),
      status: "pending",
    });
    // The frontend composes the absolute URL from window.location.origin; we
    // return the relative path + token so no server-side base-URL config is needed.
    return res.status(201).json({
      success: true,
      data: { id: doc._id, token, path: `/feedback/${token}`, expiresAt: doc.tokenExpiresAt },
    });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_LINK_FAILED", message: err.message });
  }
};

// ── PUBLIC: fetch the form context for a token (no login) ───────────────────
exports.publicGetForm = async (req, res) => {
  try {
    const row = await PatientFeedback.findOne({ publicToken: req.params.token }).lean();
    if (!row) return res.status(404).json({ success: false, code: "TOKEN_INVALID", message: "This feedback link is invalid." });
    if (row.tokenExpiresAt && row.tokenExpiresAt < new Date()) {
      return res.status(410).json({ success: false, code: "TOKEN_EXPIRED", message: "This feedback link has expired." });
    }
    if (row.status === "submitted") {
      return res.json({ success: true, data: { alreadySubmitted: true, categories: RATING_KEYS } });
    }
    return res.json({
      success: true,
      data: {
        alreadySubmitted: false,
        categories: RATING_KEYS,
        // Only a friendly first name is exposed publicly — never full PHI.
        greetingName: (row.patientName || "").split(" ")[0] || "",
        visitType: row.visitType,
        department: row.department,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_FORM_FAILED", message: err.message });
  }
};

// ── PUBLIC: patient submits the feedback for a token (no login) ─────────────
exports.publicSubmit = async (req, res) => {
  try {
    const row = await PatientFeedback.findOne({ publicToken: req.params.token });
    if (!row) return res.status(404).json({ success: false, code: "TOKEN_INVALID", message: "This feedback link is invalid." });
    if (row.tokenExpiresAt && row.tokenExpiresAt < new Date()) {
      return res.status(410).json({ success: false, code: "TOKEN_EXPIRED", message: "This feedback link has expired." });
    }
    if (row.status === "submitted") {
      return res.status(409).json({ success: false, code: "ALREADY_SUBMITTED", message: "This feedback has already been submitted. Thank you!" });
    }
    const fields = pickFeedbackFields(req.body);
    Object.assign(row, fields);
    if (fields.anonymous) { row.patientName = ""; row.contactNumber = ""; }
    row.submittedFromIp = clientIp(req);
    row.submittedAt = new Date();
    row.status = "submitted";
    await row.save();
    return res.json({ success: true, data: { ok: true } });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_SUBMIT_FAILED", message: err.message });
  }
};

// ── STAFF: list submitted feedback (filters + pagination) ───────────────────
exports.list = async (req, res) => {
  try {
    const { from, to, visitType, department, via, minOverall } = req.query;
    const q = { status: "submitted" };
    if (visitType) q.visitType = visitType;
    if (department) q.department = new RegExp(`^${String(department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (via) q.submittedVia = via;
    if (minOverall) q["ratings.overall"] = { $gte: Number(minOverall) };
    if (from || to) {
      q.submittedAt = {};
      if (from) q.submittedAt.$gte = new Date(from);
      if (to) q.submittedAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }
    const limit = clamp(Number(req.query.limit) || 100, 1, 500);
    const page = clamp(Number(req.query.page) || 1, 1, 100000);
    const [rows, total] = await Promise.all([
      PatientFeedback.find(q).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PatientFeedback.countDocuments(q),
    ]);
    return res.json({ success: true, data: rows, total, page, limit });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_LIST_FAILED", message: err.message });
  }
};

// ── STAFF: dashboard aggregation (averages, NPS, distribution, comments) ────
exports.stats = async (req, res) => {
  try {
    const { from, to, visitType, department } = req.query;
    const match = { status: "submitted" };
    if (visitType) match.visitType = visitType;
    if (department) match.department = new RegExp(`^${String(department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (from || to) {
      match.submittedAt = {};
      if (from) match.submittedAt.$gte = new Date(from);
      if (to) match.submittedAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    // Category averages — one $avg per key, only counting answered (>0) rows.
    const avgStage = {};
    for (const k of RATING_KEYS) {
      avgStage[k] = { $avg: { $cond: [{ $gt: [`$ratings.${k}`, 0] }, `$ratings.${k}`, "$$REMOVE"] } };
    }

    const [agg] = await PatientFeedback.aggregate([
      { $match: match },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          ...avgStage,
          promoters:  { $sum: { $cond: [{ $gte: ["$npsScore", 9] }, 1, 0] } },
          passives:   { $sum: { $cond: [{ $and: [{ $gte: ["$npsScore", 7] }, { $lte: ["$npsScore", 8] }] }, 1, 0] } },
          detractors: { $sum: { $cond: [{ $and: [{ $ne: ["$npsScore", null] }, { $lte: ["$npsScore", 6] }] }, 1, 0] } },
          npsAnswered:{ $sum: { $cond: [{ $ne: ["$npsScore", null] }, 1, 0] } },
        } },
    ]);

    const byVisitType = await PatientFeedback.aggregate([
      { $match: match },
      { $group: { _id: "$visitType", count: { $sum: 1 }, avgOverall: { $avg: { $cond: [{ $gt: ["$ratings.overall", 0] }, "$ratings.overall", "$$REMOVE"] } } } },
      { $sort: { count: -1 } },
    ]);

    const round = (v) => (v == null ? 0 : Number(v.toFixed(2)));
    const categoryAverages = {};
    for (const k of RATING_KEYS) categoryAverages[k] = round(agg?.[k]);

    // NPS = %promoters − %detractors (range −100..+100), over answered rows.
    const nps = agg && agg.npsAnswered
      ? Math.round(((agg.promoters - agg.detractors) / agg.npsAnswered) * 100)
      : null;

    // Recent free-text comments (most recent 25 with any text).
    const comments = await PatientFeedback.find(
      { ...match, $or: [{ wentWell: { $nin: ["", null] } }, { improvements: { $nin: ["", null] } }] },
      { patientName: 1, anonymous: 1, visitType: 1, department: 1, wentWell: 1, improvements: 1, "ratings.overall": 1, npsScore: 1, submittedAt: 1 },
    ).sort({ submittedAt: -1 }).limit(25).lean();

    return res.json({
      success: true,
      data: {
        count: agg?.count || 0,
        categoryAverages,
        overallAverage: categoryAverages.overall,
        nps,
        npsBreakdown: { promoters: agg?.promoters || 0, passives: agg?.passives || 0, detractors: agg?.detractors || 0, answered: agg?.npsAnswered || 0 },
        byVisitType: byVisitType.map((r) => ({ visitType: r._id, count: r.count, avgOverall: round(r.avgOverall) })),
        comments: comments.map((c) => ({
          name: c.anonymous ? "Anonymous" : (c.patientName || "—"),
          visitType: c.visitType, department: c.department,
          wentWell: c.wentWell, improvements: c.improvements,
          overall: c.ratings?.overall || 0, npsScore: c.npsScore, at: c.submittedAt,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_STATS_FAILED", message: err.message });
  }
};
