/**
 * investigationMasterController.js — Lab/Radiology master-data HTTP layer.
 *
 * R7bj-F8 / R7bi-3-CRIT-1: envelope normalised via utils/apiEnvelope. The
 * legacy `getAll` previously spread `...result` at the top level (pagination
 * keys) and duplicated `data`. We now place pagination inside `meta` and
 * keep `data` strictly to the rows array.
 */
const svc = require("../../services/Investigation/investigationMasterService");
// Lazy import — keeps boot tolerant if envelope helper rebuilds.
let _env;
function env() {
  if (!_env) _env = require("../../utils/apiEnvelope");
  return _env;
}

exports.getAll = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const result = await svc.getAll(req.query);
    // service returns {investigations, total, page, pages, ...}
    const { investigations = [], ...meta } = result || {};
    return sendOk(res, investigations, { count: investigations.length, ...meta });
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.getGrouped = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getGrouped();
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.getById = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getById(req.params.id);
    return sendOk(res, data);
  } catch (e) {
    const notFound = e.message === "Investigation not found";
    return sendErr(res, e, notFound ? "NOT_FOUND" : null, notFound ? 404 : 500);
  }
};

exports.create = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.create(req.body);
    return sendOk(res, data, undefined, 201);
  } catch (e) {
    if (e.code === 11000) return sendErr(res, "Investigation already exists", "DUPLICATE", 409);
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.update = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.update(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    const notFound = e.message === "Investigation not found";
    return sendErr(res, e, notFound ? "NOT_FOUND" : "VALIDATION", notFound ? 404 : 400);
  }
};

exports.remove = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    await svc.deactivate(req.params.id);
    return sendOk(res, { deactivated: true });
  } catch (e) {
    const notFound = e.message === "Investigation not found";
    return sendErr(res, e, notFound ? "NOT_FOUND" : null, notFound ? 404 : 500);
  }
};

exports.getPricing = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getPricing(req.params.id);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.setPricing = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.upsertPricing(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.getEffectivePrice = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const { tariffType = "CASH", tpaId = null } = req.query;
    const data = await svc.getEffectivePrice(req.params.id, tariffType, tpaId);
    return sendOk(res, data);
  } catch (e) {
    const notFound = e.message === "Investigation not found";
    return sendErr(res, e, notFound ? "NOT_FOUND" : null, notFound ? 404 : 500);
  }
};

exports.seed = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.seed();
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e);
  }
};
