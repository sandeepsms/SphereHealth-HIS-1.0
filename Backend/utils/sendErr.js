// utils/sendErr.js — CLEAN-M3B. Shared Express error responder so every
// controller catch maps errors the same way instead of hand-rolling
// `res.status(500).json(...)` (which made client validation mistakes look
// like server crashes). Mirrors the semantics pharmacyController proved out:
//   ValidationError → 400 (joined field messages)   CastError → 400
//   Mongo 11000     → 409 duplicate                 anything else → 500
module.exports = function sendErr(res, e) {
  if (e?.name === "ValidationError") {
    const msg = Object.values(e.errors || {}).map((x) => x.message).join("; ") || e.message;
    return res.status(400).json({ success: false, message: msg, code: "VALIDATION" });
  }
  if (e?.name === "CastError") {
    return res.status(400).json({ success: false, message: `Invalid id / cast — ${e.path}`, code: "VALIDATION" });
  }
  if (e?.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate key — record already exists", code: "DUPLICATE" });
  }
  return res.status(e?.status || 500).json({ success: false, message: e?.message || "Server error", code: e?.code || null });
};
