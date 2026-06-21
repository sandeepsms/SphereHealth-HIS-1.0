const svc = require("../../services/nursing/nursingChargesService");

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, e,   status = 400) => res.status(status).json({ success: false, message: e.message });

/* ── Master catalogue ── */
exports.getItems   = async (req, res) => { try { ok(res, await svc.getAllItems()); }        catch (e) { err(res, e); } };
exports.createItem = async (req, res) => { try { ok(res, await svc.createItem(req.body), 201); } catch (e) { err(res, e); } };
exports.updateItem = async (req, res) => { try { ok(res, await svc.updateItem(req.params.id, req.body)); } catch (e) { err(res, e); } };
exports.deleteItem = async (req, res) => { try { ok(res, await svc.deleteItem(req.params.id)); } catch (e) { err(res, e); } };

/* ── Charge entries ── */

// POST /api/nursing-charges/log
exports.logItems = async (req, res) => {
  try {
    const { admissionId, items, shift, chargedBy, dateKey } = req.body;
    const chargedById = req.user?.id;
    const result = await svc.logItems({ admissionId, items, shift, chargedBy, chargedById, dateKey });
    // ── Auto-billing audit trail ────────────────────────────────
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../../services/Billing/autoBillingService");
      for (const saved of result.saved || []) {
        autoBilling.onEquipmentCharged({ ...saved, admissionId, UHID: req.body.UHID, chargedBy }, saved.billItemId).catch(logErr("autoBilling", `onEquipmentCharged ${saved?._id}`));
      }
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on nursing-charges log")(e);
    }
    ok(res, result, 201);
  } catch (e) { err(res, e); }
};

// GET /api/nursing-charges/:admissionId/today
exports.getTodayCharges = async (req, res) => {
  try {
    const { date } = req.query;   // optional ?date=2026-04-15
    ok(res, await svc.getTodayCharges(req.params.admissionId, date));
  } catch (e) { err(res, e); }
};

// GET /api/nursing-charges/:admissionId/history
exports.getAllCharges = async (req, res) => {
  try { ok(res, await svc.getAllCharges(req.params.admissionId)); }
  catch (e) { err(res, e); }
};

// DELETE /api/nursing-charges/entry/:entryId
exports.voidEntry = async (req, res) => {
  try {
    const { reason } = req.body;
    // R7hr-238 (audit) — pass the JWT actor so the service can scope the void
    // to the charge's owner (nurse) vs Admin/Accountant.
    ok(res, await svc.voidEntry(req.params.entryId, reason, req.user));
  } catch (e) { err(res, e); }
};

// GET /api/nursing-charges/:admissionId/daily-totals
exports.getDailyTotals = async (req, res) => {
  try { ok(res, await svc.getDailyTotals(req.params.admissionId)); }
  catch (e) { err(res, e); }
};
