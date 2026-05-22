/**
 * controllers/tpa/TPAServicebillcontroller.js
 * ────────────────────────────────────────────────────────────────────
 * R7bh-F8 — full rewrite onto the canonical apiEnvelope.
 *
 * Closes (from AUDIT_R7bg):
 *   • R7bg-3-CRIT-5  — `TestName` / `getTpaId` returned raw arrays/docs with
 *      no envelope + 3 different error keys (`msg`/`error`/`message`).
 *      Now `{success,data,meta?}` for both.
 *   • R7bg-3-CRIT-9  — `Number(s.Amount)` (money as float). Money should be
 *      stored as Decimal128 per R2. The SCHEMA still types these as `Number`
 *      (TPAServicesModel.js line 23/41 — Amount/Totalamount), so a true fix
 *      requires a schema + migration sweep. We FLAG this for next cycle and
 *      keep Number coercion compatible. Backlog item noted in output.
 *   • R7bg-5-HIGH-4  — dropped `console.log(req.params)` and
 *      `console.log("Incoming request body:", ...)`.
 *   • PascalCase → camelCase at the response boundary
 *      (`Name`→`name`, `Amount`→`amount`, `Discount`→`discount`,
 *       `Totalamount`→`totalAmount`). DB schema fields are unchanged
 *      for backward compatibility (no migration).
 *
 * BACKWARD COMPAT
 *   `?legacy=1` on `TestName` and `getTpaId` returns the OLD raw shape
 *   (Frontend Doctor.jsx and TpaIdget.js still parse the raw shape). This
 *   is a temporary shim — frontend agents should update consumers to the
 *   new envelope, then the shim removed in a later cycle.
 */

"use strict";

const Servicebilldata = require("../../models/tpa/TPAServicesModel");
const TPAModel        = require("../../models/tpa/tpaModel");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

// Boundary-transform a stored service-line to the new camelCase shape.
function _toCamelService(s) {
  if (!s) return s;
  const src = typeof s.toObject === "function" ? s.toObject() : s;
  return {
    _id: src._id,
    name: src.Name,
    amount: Number(src.Amount) || 0,
    discount: Number(src.Discount) || 0,
    totalAmount: Number(src.Totalamount) || 0,
    // Pass-through any other present fields without overwriting the camel keys.
    ...(src.serviceType ? { serviceType: src.serviceType } : {}),
    ...(src.discountOverrideReason ? { discountOverrideReason: src.discountOverrideReason } : {}),
  };
}

function _toCamelDoc(doc) {
  if (!doc) return doc;
  const src = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    _id: src._id,
    tpaName: src.tpaName,
    tpaCode: src.tpaCode,
    services: Array.isArray(src.service)
      ? src.service.map(_toCamelService)
      : Array.isArray(src.services)
        ? src.services.map(_toCamelService)
        : [],
    isActive: src.isActive,
    createdAt: src.createdAt,
    updatedAt: src.updatedAt,
    // also keep the original `tpa_name` legacy alias when frontends look for it
    ...(src.tpa_name ? { tpa_name: src.tpa_name } : {}),
  };
}

function _isLegacy(req) {
  const v = req?.query?.legacy;
  return v === "1" || v === "true" || v === 1 || v === true;
}

/**
 * POST /addbill — add a new TPA service-bill block under a TPA name.
 * Accepts:
 *   { tpaName, service: [{ Name, Amount, Discount }] }
 * Persists in the original PascalCase form (no schema migration).
 * Returns the camelCase envelope.
 */
exports.Servicebillfun = async (req, res) => {
  try {
    let { tpaName, service } = req.body || {};

    // Default Normal
    if (!tpaName || String(tpaName).trim() === "") tpaName = "Normal";

    // Validate service array
    if (!Array.isArray(service) || service.length === 0) {
      return sendErr(res, "Service array required", "VALIDATION", 400);
    }

    let tpaCode = "NORMAL";
    if (tpaName !== "Normal") {
      const tpaData = await TPAModel.findOne({ tpaName });
      if (!tpaData) return sendErr(res, "TPA not found", "NOT_FOUND", 404);
      tpaCode = tpaData.tpaCode;
    }

    // Build PascalCase entries for the schema (R7bg-3-CRIT-9: Number coercion
    // until Decimal128 migration; see backlog note in header).
    const formattedServices = service.map((s) => {
      const amount   = Number(s.Amount ?? s.amount) || 0;
      const discount = Number(s.Discount ?? s.discount) || 0;
      const total    = amount - (amount * discount) / 100;
      return {
        Name:        s.Name ?? s.name,
        Amount:      amount,
        Discount:    discount,
        Totalamount: Number.isFinite(total) ? Math.max(0, total) : 0,
      };
    });

    // Find existing tpaName doc
    const existingDoc = await Servicebilldata.findOne({ tpaName });

    if (existingDoc) {
      // Duplicate service check (by Name)
      const existingNames = new Set((existingDoc.service || []).map((o) => o.Name));
      const duplicates    = formattedServices.filter((n) => existingNames.has(n.Name));
      if (duplicates.length > 0) {
        return sendErr(res,
          `Duplicate service(s): ${duplicates.map((d) => d.Name).join(", ")}`,
          "DUPLICATE", 409);
      }
      existingDoc.service.push(...formattedServices);
      await existingDoc.save();
      return sendOk(res, _toCamelDoc(existingDoc), { tpaName, added: formattedServices.length });
    }

    const saved = await Servicebilldata.create({
      tpaName,
      tpaCode,
      service: formattedServices,
    });

    return sendOk(res, _toCamelDoc(saved), { tpaName, created: true }, 201);
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

/**
 * GET /getAllTestNames — list all TPA service-bill blocks.
 *
 * Frontend consumer: `Frontend/src/Components/Doctor.jsx` calls
 *   `Testdata.data.map(item => ({label: item.tpa_name, value: String(item._id)}))`
 * which expects a RAW ARRAY of docs at the top level. Migrating that
 * caller is out of this agent's scope, so this endpoint honours
 * `?legacy=1` and returns the raw array as before. Without the flag,
 * the new envelope `{success,data:[...]}` is used.
 */
exports.TestName = async (req, res) => {
  try {
    const tests = await Servicebilldata.find();
    if (_isLegacy(req)) {
      // Legacy shape — raw array (no envelope).
      return res.status(200).json(tests);
    }
    return sendOk(res, tests.map(_toCamelDoc), { count: tests.length });
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

/**
 * GET /getOPDPrice?_id=... — return the OPD price under one TPA block.
 */
exports.getOPDPrice = async (req, res) => {
  try {
    const { _id } = req.query;
    if (!_id) return sendErr(res, "_id is required", "VALIDATION", 400);

    const tpaData = await Servicebilldata.findOne({ _id });
    if (!tpaData) return sendErr(res, "No data found", "NOT_FOUND", 404);

    const opdServices = (tpaData.service || []).filter((s) => s.Name === "OPD");
    const opdData = {
      id:        tpaData._id,
      tpaName:   tpaData.tpaName || tpaData.tpa_name,
      opdPrice:  opdServices.map(_toCamelService),
    };
    return sendOk(res, opdData);
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

/**
 * GET /getTpaId/:TpaId — TPA master doc by id.
 *
 * Frontend consumer: `Frontend/src/Services/TpaIdget.js` returns
 *   `response.data` directly and expects the raw TPA doc. Honours
 * `?legacy=1` to keep that caller working. Without the flag, the new
 * envelope is used.
 */
exports.getTpaId = async (req, res) => {
  try {
    const tpa = await TPAModel.findOne({ _id: req.params.TpaId });
    if (!tpa) return sendErr(res, "TpaID is not found", "NOT_FOUND", 404);
    if (_isLegacy(req)) {
      // Legacy shape — raw doc (no envelope).
      return res.status(200).json(tpa);
    }
    return sendOk(res, tpa);
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};
