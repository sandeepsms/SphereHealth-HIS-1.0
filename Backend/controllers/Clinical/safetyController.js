// controllers/Clinical/safetyController.js
// ═══════════════════════════════════════════════════════════════
// Patient-safety controller — handles NABH-mandated gates the panel
// can call to record explicit clinical decisions:
//
//   POST /api/safety/critical-result/:resultId/acknowledge
//   POST /api/safety/break-glass               — non-attending access
//   POST /api/safety/two-id-confirm            — IPSG.2 verification
//   POST /api/safety/surgical-checklist        — WHO Sign In/Time Out/Sign Out
//   POST /api/safety/pain-reassessment         — close a pain window
//
// All these write a PatientActivityLog row (with the safety tag) so the
// audit feed shows the explicit acknowledgement chain. The endpoints
// don't carry medical data themselves — they're the "decision capture"
// layer on top of existing data.
// ═══════════════════════════════════════════════════════════════

const activityLogger = require("../../services/Clinical/activityLogger");

function user(req) {
  const u = req.user || {};
  return {
    userId:   u._id || u.id || null,
    userName: u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "",
    userRole: u.role || u.userRole || "",
  };
}

// POST /api/safety/critical-result/:id/acknowledge
// Body: { uhid, resultLabel, value, refRange, comment }
exports.acknowledgeCriticalResult = async (req, res) => {
  try {
    const { uhid, resultLabel, value, refRange, comment } = req.body || {};
    if (!uhid || !req.params.id) {
      return res.status(400).json({ success: false, message: "UHID and resultId required" });
    }
    await activityLogger.log({
      UHID: uhid,
      module: "Safety.CriticalResult",
      action: "sign",
      area: "critical-result.ack",
      summary: `Critical result acknowledged — ${resultLabel || "result"} = ${value || "?"} (ref ${refRange || "—"})`,
      sourceModel: "InvestigationOrder",
      sourceId: req.params.id,
      after: { resultLabel, value, refRange, comment },
      tags: ["safety", "critical-result"],
      isFlagged: true,
      ...user(req),
      httpMethod: req.method, httpPath: req.originalUrl,
      ip: req.ip, userAgent: req.headers["user-agent"] || "",
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/safety/break-glass
// Body: { uhid, reason }   — any non-attending physician opening a chart
exports.breakGlassAccess = async (req, res) => {
  try {
    const { uhid, reason } = req.body || {};
    if (!uhid || !reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "UHID and a justification reason (min 10 chars) are required",
      });
    }
    await activityLogger.log({
      UHID: uhid,
      module: "Safety.BreakGlass",
      action: "view",
      area: "break-glass.justification",
      summary: `Break-glass access — ${reason.slice(0, 200)}`,
      tags: ["safety", "break-glass", "disclosure"],
      isFlagged: true,
      ...user(req),
      httpMethod: req.method, httpPath: req.originalUrl,
      ip: req.ip, userAgent: req.headers["user-agent"] || "",
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/safety/two-id-confirm
// Body: { uhid, dob, fullName, action, area, sourceModel, sourceId }
// Captures the IPSG.2 explicit confirmation before a mutation.
exports.twoIdentifierConfirm = async (req, res) => {
  try {
    const { uhid, dob, fullName, action, area, sourceModel, sourceId } = req.body || {};
    if (!uhid || !dob || !fullName) {
      return res.status(400).json({ success: false, message: "UHID, DOB and Full Name required" });
    }
    await activityLogger.log({
      UHID: uhid,
      module: "Safety.TwoID",
      action: "sign",
      area: area || "two-id.confirm",
      summary: `Two-identifier confirm: ${fullName} · DOB ${dob} → action ${action || "—"}`,
      sourceModel: sourceModel || "", sourceId: sourceId || null,
      tags: ["safety", "ipsg-2"],
      isFlagged: false,
      ...user(req),
      httpMethod: req.method, httpPath: req.originalUrl,
      ip: req.ip, userAgent: req.headers["user-agent"] || "",
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/safety/surgical-checklist
// Body: { uhid, procedureId, phase: "SIGN_IN"|"TIME_OUT"|"SIGN_OUT",
//         items: [{key, value, by}], confirmedBy: [{role, name}] }
exports.surgicalChecklist = async (req, res) => {
  try {
    const { uhid, procedureId, phase, items, confirmedBy } = req.body || {};
    if (!uhid || !phase) {
      return res.status(400).json({ success: false, message: "UHID and phase required" });
    }
    if (!["SIGN_IN", "TIME_OUT", "SIGN_OUT"].includes(phase)) {
      return res.status(400).json({ success: false, message: "phase must be SIGN_IN / TIME_OUT / SIGN_OUT" });
    }
    await activityLogger.log({
      UHID: uhid,
      module: "Safety.SurgicalChecklist",
      action: "sign",
      area: `surgical-checklist.${phase.toLowerCase()}`,
      summary: `WHO Surgical Safety Checklist · ${phase} · ${(confirmedBy || []).map((c) => `${c.role}:${c.name}`).join(" / ")}`,
      sourceModel: "Procedure",
      sourceId: procedureId || null,
      after: { phase, items, confirmedBy },
      tags: ["safety", "who-ssc"],
      isFlagged: true,
      ...user(req),
      httpMethod: req.method, httpPath: req.originalUrl,
      ip: req.ip, userAgent: req.headers["user-agent"] || "",
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/safety/pain-reassessment
// Body: { uhid, marId, beforeScore, afterScore, intervention, comment }
exports.painReassessment = async (req, res) => {
  try {
    const { uhid, marId, beforeScore, afterScore, intervention, comment } = req.body || {};
    if (!uhid) {
      return res.status(400).json({ success: false, message: "UHID required" });
    }
    await activityLogger.log({
      UHID: uhid,
      module: "Safety.PainReassess",
      action: "create",
      area: "pain.reassessment",
      summary: `Pain reassessed ${beforeScore || "—"}/10 → ${afterScore || "—"}/10 after ${intervention || "intervention"}`,
      sourceModel: "MAR",
      sourceId: marId || null,
      after: { beforeScore, afterScore, intervention, comment },
      tags: ["safety", "cop-18"],
      isFlagged: !!(beforeScore != null && afterScore != null && Number(afterScore) > Number(beforeScore)),
      ...user(req),
      httpMethod: req.method, httpPath: req.originalUrl,
      ip: req.ip, userAgent: req.headers["user-agent"] || "",
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
