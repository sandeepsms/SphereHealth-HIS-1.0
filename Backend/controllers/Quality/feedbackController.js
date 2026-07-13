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
const { escapeRegex } = require("../../utils/queryGuards");   // TD-3 dedup — was hand-rolled twice below
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
    if (department) q.department = new RegExp(`^${escapeRegex(String(department))}$`, "i");
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
    if (department) match.department = new RegExp(`^${escapeRegex(String(department))}$`, "i");
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

    // R7hr(DEFER-15): the three sequential queries (summary group, visit-type
    // breakdown, recent comments) now run as ONE $facet — one collection
    // scan of the matched window instead of three round-trips.
    const [facets] = await PatientFeedback.aggregate([
      { $match: match },
      { $facet: {
          summary: [
            { $group: {
                _id: null,
                count: { $sum: 1 },
                ...avgStage,
                promoters:  { $sum: { $cond: [{ $gte: ["$npsScore", 9] }, 1, 0] } },
                passives:   { $sum: { $cond: [{ $and: [{ $gte: ["$npsScore", 7] }, { $lte: ["$npsScore", 8] }] }, 1, 0] } },
                detractors: { $sum: { $cond: [{ $and: [{ $ne: ["$npsScore", null] }, { $lte: ["$npsScore", 6] }] }, 1, 0] } },
                npsAnswered:{ $sum: { $cond: [{ $ne: ["$npsScore", null] }, 1, 0] } },
              } },
          ],
          byVisitType: [
            { $group: { _id: "$visitType", count: { $sum: 1 }, avgOverall: { $avg: { $cond: [{ $gt: ["$ratings.overall", 0] }, "$ratings.overall", "$$REMOVE"] } } } },
            { $sort: { count: -1 } },
          ],
          comments: [
            { $match: { $or: [{ wentWell: { $nin: ["", null] } }, { improvements: { $nin: ["", null] } }] } },
            { $sort: { submittedAt: -1 } },
            { $limit: 25 },
            { $project: { patientName: 1, anonymous: 1, visitType: 1, department: 1, wentWell: 1, improvements: 1, "ratings.overall": 1, npsScore: 1, submittedAt: 1 } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const agg         = facets?.summary?.[0] || null;
    const byVisitType = facets?.byVisitType || [];
    const comments    = facets?.comments || [];

    const round = (v) => (v == null ? 0 : Number(v.toFixed(2)));
    const categoryAverages = {};
    for (const k of RATING_KEYS) categoryAverages[k] = round(agg?.[k]);

    // NPS = %promoters − %detractors (range −100..+100), over answered rows.
    const nps = agg && agg.npsAnswered
      ? Math.round(((agg.promoters - agg.detractors) / agg.npsAnswered) * 100)
      : null;

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

// ── STAFF: CQI experience indicator (month-bucketed PROM/PREM trend) ─────────
// NABH PRE.6 + QPS.3. The `stats` endpoint is a single-window snapshot; the
// Quality committee's CQI dashboard tracks the *trend* — satisfaction rate and
// NPS bucketed by month so an improvement/decline is visible over time. This
// powers the same kind of indicator tile as the discharge-TAT CQI metric.
//
//   satisfactionRate = % of answered-overall rows rating overall ≥ 4 (of 5)
//   nps              = %promoters(9-10) − %detractors(0-6) over answered rows
//
// Query: ?months=12 (default, 3-36) or explicit ?from&to; ?visitType&department.
exports.cqiIndicator = async (req, res) => {
  try {
    const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
    const { from, to, visitType, department } = req.query;
    const months = Math.max(3, Math.min(Number(req.query.months) || 12, 36));

    const match = { status: "submitted" };
    if (visitType) match.visitType = visitType;
    if (department) match.department = new RegExp(`^${escapeRegex(String(department))}$`, "i");
    if (from || to) {
      match.submittedAt = {};
      if (from) match.submittedAt.$gte = new Date(from);
      if (to) match.submittedAt.$lte = new Date(`${to}T23:59:59.999Z`);
    } else {
      // Default window: the last `months` calendar months up to now.
      const start = new Date();
      start.setUTCMonth(start.getUTCMonth() - months, 1);
      start.setUTCHours(0, 0, 0, 0);
      match.submittedAt = { $gte: start };
    }

    const rows = await PatientFeedback.aggregate([
      { $match: match },
      { $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$submittedAt", timezone: TZ } },
          n: { $sum: 1 },
          overallAnswered: { $sum: { $cond: [{ $gt: ["$ratings.overall", 0] }, 1, 0] } },
          satisfied:       { $sum: { $cond: [{ $gte: ["$ratings.overall", 4] }, 1, 0] } },
          avgOverall:      { $avg: { $cond: [{ $gt: ["$ratings.overall", 0] }, "$ratings.overall", "$$REMOVE"] } },
          promoters:  { $sum: { $cond: [{ $gte: ["$npsScore", 9] }, 1, 0] } },
          detractors: { $sum: { $cond: [{ $and: [{ $ne: ["$npsScore", null] }, { $lte: ["$npsScore", 6] }] }, 1, 0] } },
          npsAnswered:{ $sum: { $cond: [{ $ne: ["$npsScore", null] }, 1, 0] } },
        } },
      { $sort: { _id: 1 } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const round = (v) => (v == null ? 0 : Number(v.toFixed(2)));
    const series = rows.map((r) => ({
      period: r._id, // "YYYY-MM"
      n: r.n,
      avgOverall: round(r.avgOverall),
      satisfactionRate: r.overallAnswered ? Math.round((r.satisfied / r.overallAnswered) * 100) : null,
      nps: r.npsAnswered ? Math.round(((r.promoters - r.detractors) / r.npsAnswered) * 100) : null,
    }));

    // Window roll-up + trend (latest complete month vs the one before).
    const totals = rows.reduce((a, r) => ({
      n: a.n + r.n, satisfied: a.satisfied + r.satisfied, overallAnswered: a.overallAnswered + r.overallAnswered,
      promoters: a.promoters + r.promoters, detractors: a.detractors + r.detractors, npsAnswered: a.npsAnswered + r.npsAnswered,
    }), { n: 0, satisfied: 0, overallAnswered: 0, promoters: 0, detractors: 0, npsAnswered: 0 });

    const overallSatisfaction = totals.overallAnswered ? Math.round((totals.satisfied / totals.overallAnswered) * 100) : null;
    const overallNps = totals.npsAnswered ? Math.round(((totals.promoters - totals.detractors) / totals.npsAnswered) * 100) : null;

    let trend = "flat";
    if (series.length >= 2) {
      const cur = series[series.length - 1].satisfactionRate;
      const prev = series[series.length - 2].satisfactionRate;
      if (cur != null && prev != null) trend = cur > prev ? "up" : cur < prev ? "down" : "flat";
    }

    return res.json({
      success: true,
      data: {
        indicator: "Patient Experience (PROM/PREM)",
        unit: "% satisfied + NPS",
        window: { months, from: match.submittedAt?.$gte || null, to: match.submittedAt?.$lte || null },
        totalResponses: totals.n,
        overallSatisfaction, // % overall ≥ 4
        overallNps,          // −100..+100
        trend,               // up | down | flat (latest month vs prior)
        series,              // month-bucketed points for the CQI chart
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, code: "FEEDBACK_CQI_FAILED", message: err.message });
  }
};
