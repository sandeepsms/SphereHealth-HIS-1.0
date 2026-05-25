// controllers/Clinical/consentFormController.js
const ConsentForm = require("../../models/Clinical/ConsentFormModel");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

// Build a single audit-trail row from the request — captures actor,
// timestamp, IP, user-agent and an optional reason (NABH PRE.3/PRE.4).
const auditEntry = (req, action, reason = "") => ({
  action,
  at:        new Date(),
  byName:    req.user?.fullName || req.body?.actorName || "",
  byRole:    req.user?.role     || req.body?.actorRole || "",
  byUserId:  req.user?.id       || null,
  ip:        (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim(),
  userAgent: (req.headers["user-agent"] || "").slice(0, 200),
  reason,
});

class ConsentFormController {
  // POST /api/consent-forms
  create = handle(async (req, res) => {
    const form = await ConsentForm.create({
      ...req.body,
      auditTrail: [auditEntry(req, "CREATED")],
    });
    return res.status(201).json({ success: true, data: form });
  });

  // GET /api/consent-forms/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const forms = await ConsentForm.find({ UHID: req.params.uhid })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: forms, count: forms.length });
  });

  // GET /api/consent-forms/admission/:admissionId
  getByAdmission = handle(async (req, res) => {
    const forms = await ConsentForm.find({ admissionId: req.params.admissionId })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: forms, count: forms.length });
  });

  // GET /api/consent-forms/:id
  getById = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id).lean();
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form });
  });

  // PUT /api/consent-forms/:id
  // R7az-D2-CRIT-1: refuse edits on any non-PENDING consent. Once a
  // patient signs (or refuses / revokes), the form becomes a legal
  // record and the only legitimate edits are status transitions via
  // the dedicated PATCH endpoints (which also append to auditTrail).
  update = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        code: "CONSENT_LOCKED",
        message: `Cannot edit a ${form.status} consent form — only PENDING consents accept body updates`,
      });
    }
    // Reject any attempt to overwrite the audit trail in the body.
    const body = { ...(req.body || {}) };
    delete body.auditTrail;
    delete body.status; // status is moved via /sign /refuse /revoke
    delete body.signedAt;
    delete body.signedByName;
    delete body.signedByRole;
    for (const [k, v] of Object.entries(body)) form.set(k, v);
    form.auditTrail = form.auditTrail || [];
    form.auditTrail.push(auditEntry(req, "UPDATED"));
    await form.save();
    return res.json({ success: true, data: form });
  });

  // PATCH /api/consent-forms/:id/sign
  // R7az-D2-CRIT-1 / D2-HIGH-7: CAS — only flip PENDING → SIGNED. If the
  // status changed underneath (e.g. another tab refused the consent), we
  // return 409 instead of silently overwriting a refusal with a sign.
  sign = handle(async (req, res) => {
    const { guardianName, guardianRelation, witnessName } = req.body;
    const form = await ConsentForm.findOneAndUpdate(
      { _id: req.params.id, status: "PENDING" },
      {
        $set: {
          status: "SIGNED",
          patientAcknowledged: true,
          signedAt: new Date(),
          signedByName: req.user?.fullName || req.body?.actorName || "",
          signedByRole: req.user?.role     || req.body?.actorRole || "",
          ...(guardianName && { guardianName }),
          ...(guardianRelation && { guardianRelation }),
          ...(witnessName && { witnessName }),
        },
        $push: { auditTrail: auditEntry(req, "SIGNED") },
      },
      { new: true }
    );
    if (!form) {
      // Distinguish "doesn't exist" from "wrong status".
      const exists = await ConsentForm.findById(req.params.id).select("_id status").lean();
      if (!exists) return res.status(404).json({ success: false, message: "Consent form not found" });
      return res.status(409).json({
        success: false,
        code: "CONSENT_STATE_CHANGED",
        message: `Consent is no longer PENDING (now ${exists.status}) — cannot sign`,
      });
    }

    // R7bn-1 / D9-fix + D1-fix: cross-patient ClinicalAudit emit on
    // consent sign. Pre-fix the embedded auditTrail[] held the record
    // but was invisible to cross-admission audit queries.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "CONSENT_SIGNED",
        UHID: form.UHID,
        admissionId: form.admissionId,
        patientId: form.patientId,
        patientName: form.patientName,
        targetType: "ConsentForm",
        targetId: form._id,
        after: { consentType: form.consentType, signedAt: form.signedAt, signedByName: form.signedByName },
      });
    } catch (_) { /* silent */ }

    return res.json({ success: true, data: form, message: "Consent form signed" });
  });

  // GET /api/consent-forms/:id/print — print-event capture (NABH PRE.4)
  // R7az-D2-HIGH-7: every print of a consent emits a PRINTED audit row.
  // Returns the form payload so the frontend can render the printable
  // view; the side-effect is the auditTrail push, not the response shape.
  printConsent = handle(async (req, res) => {
    const form = await ConsentForm.findByIdAndUpdate(
      req.params.id,
      { $push: { auditTrail: auditEntry(req, "PRINTED") } },
      { new: true }
    );
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form });
  });

  // PATCH /api/consent-forms/:id/refuse
  refuse = handle(async (req, res) => {
    const { refusalReason } = req.body;
    const form = await ConsentForm.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "REFUSED",
          refusalReason: refusalReason || "",
          refusedAt: new Date(),
          refusedByName: req.user?.fullName || req.body?.actorName || "",
        },
        $push: { auditTrail: auditEntry(req, "REFUSED", refusalReason || "") },
      },
      { new: true }
    );
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form, message: "Consent refusal recorded" });
  });

  // PATCH /api/consent-forms/:id/revoke
  revoke = handle(async (req, res) => {
    const { revokedReason } = req.body;
    const form = await ConsentForm.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "REVOKED",
          revokedReason,
          revokedAt: new Date(),
          revokedByName: req.user?.fullName || req.body?.actorName || "",
        },
        $push: { auditTrail: auditEntry(req, "REVOKED", revokedReason || "") },
      },
      { new: true }
    );
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form, message: "Consent revoked" });
  });

  // DELETE /api/consent-forms/:id (only PENDING forms)
  delete = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "Only PENDING consent forms can be deleted" });
    }
    await form.deleteOne();
    return res.json({ success: true, message: "Consent form deleted" });
  });
}

module.exports = new ConsentFormController();
