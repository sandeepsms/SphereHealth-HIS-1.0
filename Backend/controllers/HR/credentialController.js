/**
 * credentialController.js  (R7bf-G / A5-CRIT-6 / NABH HRD.3)
 *
 * Credential CRUD + verification + revoke + cron-expiry. The cron worker
 * `expireCredentials` is exported so Backend/index.js can call it on the
 * daily schedule.
 */
const Credential = require("../../models/HR/CredentialModel");

const actor = (req) => ({
  _id:      req.user?._id || req.user?.id,
  fullName: req.user?.fullName || req.user?.name || "",
  role:     req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/credentials
exports.create = async (req, res, next) => {
  try {
    const u = actor(req);
    const body = req.body || {};
    if (!body.userId)         return res.status(400).json({ success: false, message: "userId is required" });
    if (!body.credentialType) return res.status(400).json({ success: false, message: "credentialType is required" });
    if (!body.title)          return res.status(400).json({ success: false, message: "title is required" });

    // Capture identity snapshot if available.
    let snap = {};
    try {
      const User = require("../../models/User/userModel");
      const usr = await User.findById(body.userId).select("fullName role employeeId").lean();
      if (usr) snap = { userFullName: usr.fullName || "", userRole: usr.role || "", userEmployeeId: usr.employeeId || "" };
    } catch (_) { /* best-effort */ }

    const doc = await Credential.create({
      userId:           body.userId,
      doctorId:         body.doctorId || null,
      credentialType:   body.credentialType,
      title:            body.title,
      institution:      body.institution || "",
      year:             Number.isFinite(body.year) ? body.year : null,
      registrationNumber: body.registrationNumber || "",
      councilName:      body.councilName || "",
      expiryDate:       body.expiryDate ? new Date(body.expiryDate) : null,
      scopeOfPractice:  Array.isArray(body.scopeOfPractice) ? body.scopeOfPractice : [],
      privilegesGranted: Array.isArray(body.privilegesGranted) ? body.privilegesGranted : [],
      documentUrl:      body.documentUrl || "",
      notes:            body.notes || "",
      hospitalId:       u.hospitalId,
      ...snap,
      status: "PENDING",
    });
    res.status(201).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// PUT /api/credentials/:id
exports.update = async (req, res, next) => {
  try {
    const doc = await Credential.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Credential not found" });
    if (doc.status === "REVOKED") {
      return res.status(409).json({ success: false, message: "Cannot edit a REVOKED credential" });
    }
    const body = { ...(req.body || {}) };
    delete body.status; delete body.verified; delete body.verifiedAt; delete body.verifiedBy;
    delete body.revokedAt; delete body.revokedBy; delete body.revokedReason;
    for (const [k, v] of Object.entries(body)) {
      if (k === "expiryDate" && v) doc.set(k, new Date(v));
      else doc.set(k, v);
    }
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// PUT /api/credentials/:id/verify
exports.verify = async (req, res, next) => {
  try {
    const u = actor(req);
    const updated = await Credential.findOneAndUpdate(
      { _id: req.params.id, status: "PENDING" },
      {
        $set: {
          verified: true,
          status: "VERIFIED",
          verifiedAt: new Date(),
          verifiedBy: u._id || null,
          verifiedByName: u.fullName,
        },
      },
      { new: true },
    );
    if (!updated) return res.status(409).json({ success: false, message: "Credential not in PENDING state — cannot verify" });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

// PUT /api/credentials/:id/revoke
exports.revoke = async (req, res, next) => {
  try {
    const u = actor(req);
    const body = req.body || {};
    if (!body.reason) return res.status(400).json({ success: false, message: "reason is required" });
    const updated = await Credential.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: "REVOKED" } },
      {
        $set: {
          status: "REVOKED",
          revokedAt: new Date(),
          revokedBy: u._id || null,
          revokedByName: u.fullName,
          revokedReason: body.reason,
        },
      },
      { new: true },
    );
    if (!updated) return res.status(404).json({ success: false, message: "Credential not found or already revoked" });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

// GET /api/credentials/:id
exports.getOne = async (req, res, next) => {
  try {
    const u = actor(req);
    const doc = await Credential.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Credential not found" });
    // R7hr-227 (security audit) — hr.credential.read admits Doctor only to
    // audit their OWN credentials; a non-Admin may not read another staff
    // member's credential (reg number, granted privileges, document URL).
    if (u.role !== "Admin" && String(doc.userId || "") !== String(u._id || "")) {
      return res.status(403).json({ success: false, code: "NOT_YOUR_CREDENTIAL", message: "You can only view your own credentials." });
    }
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/credentials?userId=&doctorId=&status=&type=
exports.list = async (req, res, next) => {
  try {
    const u = actor(req);
    const q = {};
    // R7hr-227 (security audit) — owner scope. The route intent is that a
    // Doctor audits their OWN credentials list, but list() applied no scope, so
    // any Doctor could dump the entire staff register. Force non-Admin callers
    // to their own userId (ignoring client userId/doctorId filters); Admin
    // keeps the full register + filters.
    if (u.role !== "Admin") {
      q.userId = u._id;
    } else {
      if (req.query?.userId)   q.userId = req.query.userId;
      if (req.query?.doctorId) q.doctorId = req.query.doctorId;
    }
    if (req.query?.status)   q.status = req.query.status;
    if (req.query?.type)     q.credentialType = req.query.type;
    const data = await Credential.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(req.query?.limit) || 200)))
      .lean();
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};

/**
 * Cron worker: scan VERIFIED credentials whose expiryDate has passed
 * and flip them to EXPIRED. Returns a small report for the cron logger.
 */
exports.expireCredentials = async function expireCredentials() {
  const now = new Date();
  // bulk updateMany — safe to re-run, idempotent.
  const r = await Credential.updateMany(
    { status: "VERIFIED", expiryDate: { $ne: null, $lt: now } },
    { $set: { status: "EXPIRED" } },
  );
  return { matched: r.matchedCount, modified: r.modifiedCount };
};
