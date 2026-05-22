/**
 * criticalValueAlertController.js  (R7bf-G / A5-CRIT-1 / NABH AAC.6)
 *
 * Thin HTTP layer over services/Notification/criticalValueAlerter.
 * The route file owns auth + permission; the controller maps the
 * service errors to the correct HTTP status code.
 */
const svc = require("../../services/Notification/criticalValueAlerter");

function _mapStatus(err) {
  if (err.status) return err.status;
  if (/required/i.test(err.message || "")) return 400;
  if (/not found/i.test(err.message || "")) return 404;
  return 500;
}

// POST /api/critical-value-alerts
//   body: { kind, patientUHID, patientName, sourceRef?, sourceKind?, valueLabel, severity?, slaMinutes?, notes? }
exports.create = async (req, res, next) => {
  try {
    const u = req.user || {};
    const doc = await svc.emit({
      kind:        req.body?.kind,
      patientUHID: req.body?.patientUHID,
      patientName: req.body?.patientName,
      sourceRef:   req.body?.sourceRef || null,
      sourceKind:  req.body?.sourceKind || "",
      valueLabel:  req.body?.valueLabel,
      severity:    req.body?.severity || "CRITICAL",
      slaMinutes:  req.body?.slaMinutes,
      emittedBy:   u.fullName || u.name || "system",
      emittedById: u._id || u.id || null,
      notes:       req.body?.notes || "",
      hospitalId:  u.hospitalId || null,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message });
    next(e);
  }
};

// POST /api/critical-value-alerts/:id/acknowledge
//   body: { notes? }
exports.acknowledge = async (req, res, next) => {
  try {
    const u = req.user || {};
    const doc = await svc.acknowledge(req.params.id, {
      _id:      u._id || u.id,
      fullName: u.fullName || u.name || "",
      role:     u.role || "",
    }, req.body?.notes || "");
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message });
    next(e);
  }
};

// POST /api/critical-value-alerts/:id/close
//   body: { reason? }
exports.close = async (req, res, next) => {
  try {
    const u = req.user || {};
    const doc = await svc.close(req.params.id, {
      _id:      u._id || u.id,
      fullName: u.fullName || u.name || "",
      role:     u.role || "",
    }, req.body?.reason || "");
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message });
    next(e);
  }
};

// GET /api/critical-value-alerts/open?uhid=&since=
exports.listOpen = async (req, res, next) => {
  try {
    const since = req.query?.since ? new Date(req.query.since) : null;
    const data = await svc.listOpen({
      uhid:  req.query?.uhid,
      since: since && !isNaN(since.getTime()) ? since : null,
      limit: Number(req.query?.limit) || 200,
    });
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};

// GET /api/critical-value-alerts/by-uhid/:UHID
exports.byUHID = async (req, res, next) => {
  try {
    const data = await svc.listByUHID(req.params.UHID, { limit: Number(req.query?.limit) || 200 });
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};

// GET /api/critical-value-alerts/:id
exports.getOne = async (req, res, next) => {
  try {
    const Model = require("../../models/Clinical/CriticalValueAlertModel");
    const doc = await Model.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Alert not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};
