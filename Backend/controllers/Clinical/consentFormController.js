// controllers/Clinical/consentFormController.js
const ConsentForm = require("../../models/Clinical/ConsentFormModel");
// R7ez — paperless consent: WebAuthn helper for biometric attestation.
const biometric = require("../../services/Compliance/consentBiometricService");

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
  // R7hr-226 (security audit) — mass-assignment guard. create() must only ever
  // produce a PENDING consent. The SIGNED / REFUSED / REVOKED states and their
  // signing-ceremony evidence (biometric WebAuthn attestation, staff e-sign,
  // admin bypass) may ONLY be reached through the gated PATCH /sign /refuse
  // /revoke + biometric/staff-sign endpoints. Pre-fix, spreading req.body let a
  // Doctor/Nurse POST an already-"SIGNED" consent with forged
  // biometric.isHardwareBacked + staffSignature, defeating the whole R7ez/R7gh
  // signing ceremony (NABH PRE.3/PRE.4 legal-record forgery). Strip those here,
  // mirroring the field-strip update() already applies.
  create = handle(async (req, res) => {
    const body = { ...(req.body || {}) };
    delete body.auditTrail;
    delete body.status; // forced to PENDING below — signing goes through /sign
    delete body.signedAt;
    delete body.signedByName;
    delete body.signedByRole;
    delete body.refusedAt;
    delete body.revokedAt;
    delete body.patientAcknowledged;
    delete body.biometric;
    delete body.staffSignature;
    delete body.bypass;
    const form = await ConsentForm.create({
      ...body,
      status: "PENDING",
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
  // R7ez: biometric + staff signature gate. Mandatory across all consent
  // types unless an admin bypass is on record. The gate fires BEFORE the
  // CAS update so the failure messages distinguish "wrong status" from
  // "consent not yet ready to sign".
  sign = handle(async (req, res) => {
    const { guardianName, guardianRelation, witnessName } = req.body;

    // R7ez gate — fetch first so we can show the user exactly which
    // pre-requisite is missing instead of generic "cannot sign".
    const draft = await ConsentForm.findById(req.params.id).lean();
    if (!draft) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (draft.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        code: "CONSENT_STATE_CHANGED",
        message: `Consent is no longer PENDING (now ${draft.status}) — cannot sign`,
      });
    }
    const hasBio    = !!(draft.biometric?.captured && draft.biometric?.capturedAt);
    const hasStaff  = !!(draft.staffSignature?.signatureImage && draft.staffSignature?.signedAt);
    const hasBypass = !!(draft.bypass?.authorisedAt && draft.bypass?.reason);
    // R7gh — Even when a biometric capture is recorded, refuse to flip
    // PENDING → SIGNED unless it was HARDWARE-backed. This blocks a
    // legacy / pre-R7gh / virtual-authenticator record from sneaking
    // through. Admin bypass is still the documented escape valve.
    const hwBacked  = !!(draft.biometric?.isHardwareBacked);
    if (!hasBypass && hasBio && !hwBacked) {
      return res.status(412).json({
        success: false,
        code: "BIOMETRIC_NOT_HARDWARE",
        message:
          "Cannot sign — captured biometric is not from a hardware-backed scanner " +
          "(software / virtual / legacy authenticator). Re-capture using the laptop's " +
          "built-in fingerprint reader, or use admin bypass with reason.",
      });
    }
    if (!hasBypass && (!hasBio || !hasStaff)) {
      return res.status(412).json({
        success: false,
        code: "CONSENT_INCOMPLETE",
        message: "Cannot sign — biometric capture and staff signature are mandatory (or admin bypass with reason)",
        missing: {
          biometric:      !hasBio,
          staffSignature: !hasStaff,
          consentingParty:!(draft.consentingParty?.name && draft.consentingParty?.relation),
        },
      });
    }

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
    // B6-T06 — capture prior status before the update so we can record
    // prevStatus → newStatus in the cross-patient ClinicalAudit row below.
    const before = await ConsentForm.findById(req.params.id).select("status").lean();
    const prevStatus = before?.status || null;
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

    // B6-T06 — cross-patient ClinicalAudit emit (CONSENT_REFUSED is on
    // LONG_RETENTION_EVENTS so the row is retained for 7y per NABH PRE.4).
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      await emitClinicalAudit({
        req,
        event: "CONSENT_REFUSED",
        UHID: form.UHID,
        admissionId: form.admissionId,
        patientId: form.patientId,
        patientName: form.patientName,
        targetType: "ConsentForm",
        targetId: form._id,
        reason: refusalReason || "",
        before: { status: prevStatus },
        after: { status: form.status, consentType: form.consentType, refusedAt: form.refusedAt },
      });
    } catch (e) {
      console.warn("[consent-audit] emit failed (non-fatal):", e.message);
    }

    return res.json({ success: true, data: form, message: "Consent refusal recorded" });
  });

  // PATCH /api/consent-forms/:id/revoke
  revoke = handle(async (req, res) => {
    const { revokedReason } = req.body;
    // B6-T06 — capture prior status before the update so we can record
    // prevStatus → newStatus in the cross-patient ClinicalAudit row below.
    const before = await ConsentForm.findById(req.params.id).select("status").lean();
    const prevStatus = before?.status || null;
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

    // B6-T06 — cross-patient ClinicalAudit emit (CONSENT_REVOKED is on
    // LONG_RETENTION_EVENTS so the row is retained for 7y per NABH PRE.4).
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      await emitClinicalAudit({
        req,
        event: "CONSENT_REVOKED",
        UHID: form.UHID,
        admissionId: form.admissionId,
        patientId: form.patientId,
        patientName: form.patientName,
        targetType: "ConsentForm",
        targetId: form._id,
        reason: revokedReason || "",
        before: { status: prevStatus },
        after: { status: form.status, consentType: form.consentType, revokedAt: form.revokedAt },
      });
    } catch (e) {
      console.warn("[consent-audit] emit failed (non-fatal):", e.message);
    }

    return res.json({ success: true, data: form, message: "Consent revoked" });
  });

  // ── R7ez · Paperless consent endpoints ──────────────────────────

  // PUT /api/consent-forms/:id/consenting-party
  // Captures who's about to place the fingerprint (self / spouse / LAR
  // / etc.) along with their name + ID-proof + contact. Editable while
  // PENDING; locked once SIGNED (consent is a legal record).
  setConsentingParty = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({ success: false, code: "CONSENT_LOCKED",
        message: `Cannot edit consenting party on a ${form.status} consent` });
    }
    const { relation, relationOther, name, idProofType, idProofNumber, contactNumber } = req.body || {};
    if (!name || !relation) {
      return res.status(400).json({ success: false, message: "name and relation are required" });
    }
    form.consentingParty = {
      relation, relationOther, name, idProofType, idProofNumber, contactNumber,
    };
    form.auditTrail.push(auditEntry(req, "UPDATED", `consentingParty:${relation}/${name}`));
    await form.save();
    return res.json({ success: true, data: form });
  });

  // POST /api/consent-forms/:id/biometric/options
  // Issues a WebAuthn registration challenge. The challenge is stamped
  // onto the consent doc so the matching verify call can validate it
  // server-side (cannot be replayed by reusing options).
  biometricOptions = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({ success: false, code: "CONSENT_LOCKED",
        message: `Cannot capture biometric on a ${form.status} consent` });
    }
    if (!form.consentingParty?.name || !form.consentingParty?.relation) {
      return res.status(400).json({ success: false, code: "CONSENTING_PARTY_MISSING",
        message: "Set consenting-party (relation + name) before capturing biometric" });
    }
    const { options, expectedChallenge, expectedChallengeExpiresAt } =
      await biometric.makeRegistrationOptions(form, req.hostname);
    form.biometric = form.biometric || {};
    form.biometric.pendingChallenge = expectedChallenge;
    form.biometric.pendingChallengeExpiresAt = expectedChallengeExpiresAt;
    await form.save();
    return res.json({ success: true, options });
  });

  // POST /api/consent-forms/:id/biometric/verify
  // Verifies the attestation, stores the public credential + capture
  // metadata, clears the pending challenge so it can't be replayed.
  biometricVerify = handle(async (req, res) => {
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({ success: false, code: "CONSENT_LOCKED",
        message: `Cannot capture biometric on a ${form.status} consent` });
    }
    const expectedChallenge = form.biometric?.pendingChallenge;
    const expiresAt = form.biometric?.pendingChallengeExpiresAt;
    if (!expectedChallenge || (expiresAt && expiresAt < new Date())) {
      return res.status(412).json({ success: false, code: "CHALLENGE_EXPIRED",
        message: "Challenge missing or expired — request fresh options" });
    }
    let verification;
    try {
      verification = await biometric.verifyRegistrationResponse(
        req.body?.attestation || req.body,
        expectedChallenge,
        req.headers.origin,
        req.hostname,
      );
    } catch (e) {
      return res.status(400).json({ success: false, code: "WEBAUTHN_VERIFY_FAILED",
        message: e.message });
    }
    // R7gh — Hardware enforcement. The service returns
    // hardwareRejected:true when the cryptographic verify passed BUT
    // the AAGUID belongs to a software / virtual / unknown
    // authenticator. Surface this as a clear, actionable error instead
    // of pretending verification failed for unknown reasons.
    if (!verification.verified && verification.hardwareRejected) {
      // Audit the rejection so a forensic reviewer can see what was
      // attempted (e.g. someone probing with a virtual authenticator).
      form.auditTrail.push(auditEntry(req, "REJECTED", `biometric:hw-reject ${verification.aaguid}`));
      await form.save();
      return res.status(400).json({
        success: false,
        code: "HARDWARE_REQUIRED",
        message: verification.rejectReason,
        aaguid: verification.aaguid,
      });
    }
    if (!verification.verified) {
      return res.status(400).json({ success: false, code: "WEBAUTHN_VERIFY_FAILED",
        message: "Attestation could not be verified" });
    }
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
    form.biometric = {
      captured: true,
      method: "WEBAUTHN",
      credentialId: verification.credentialId,
      publicKey: verification.publicKey,
      counter: verification.counter,
      attestationFmt: verification.attestationFmt,
      aaguid: verification.aaguid,
      // R7gh — persist the hardware classification.
      isHardwareBacked: !!verification.isHardwareBacked,
      authenticatorVendor: verification.authenticatorVendor || "",
      capturedAt: new Date(),
      capturedFromIp: ip,
      capturedUserAgent: (req.headers["user-agent"] || "").slice(0, 200),
      // Clear the transient challenge — it has done its job.
      pendingChallenge: "",
      pendingChallengeExpiresAt: null,
    };
    form.auditTrail.push(auditEntry(req, "UPDATED",
      `biometric:captured hw=${verification.isHardwareBacked ? "yes" : "no"} vendor=${verification.authenticatorVendor || "—"}`));
    await form.save();
    return res.json({ success: true, data: {
      captured: true,
      capturedAt: form.biometric.capturedAt,
      method: form.biometric.method,
      isHardwareBacked: !!verification.isHardwareBacked,
      authenticatorVendor: verification.authenticatorVendor || "",
      // Public-safe summary — never leak the raw publicKey to the UI.
      credentialFingerprint: (verification.credentialId || "").slice(0, 16) + "…",
    } });
  });

  // POST /api/consent-forms/:id/staff-sign
  // Captures the staff/doctor's drawn signature image. The identity
  // (userId, name, role) comes from req.user — the body only carries
  // the signature image. signedAt is server-stamped.
  staffSign = handle(async (req, res) => {
    const { signatureImage } = req.body || {};
    // R7hr-248 (audit: svg+xml scriptable image accepted) — restrict to PNG/JPG
    // base64 data URLs; the prior data:image/ prefix allowed data:image/svg+xml.
    if (!signatureImage || !/^data:image\/(png|jpe?g);base64,/i.test(signatureImage)) {
      return res.status(400).json({ success: false, code: "INVALID_SIGNATURE",
        message: "signatureImage must be a data URL (base64 PNG/JPG)" });
    }
    // Hard cap on size — a drawn signature is typically < 30 KB.
    if (signatureImage.length > 500_000) {
      return res.status(413).json({ success: false, code: "SIGNATURE_TOO_LARGE",
        message: "Signature image exceeds 500 KB — re-draw smaller" });
    }
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({ success: false, code: "CONSENT_LOCKED",
        message: `Cannot e-sign a ${form.status} consent` });
    }
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
    form.staffSignature = {
      userId:   req.user?.id || null,
      userName: req.user?.fullName || "",
      userRole: req.user?.role || "",
      signatureImage,
      signedAt: new Date(),
      signedFromIp: ip,
    };
    form.auditTrail.push(auditEntry(req, "UPDATED", `staff-sign:${req.user?.fullName || ""}`));
    await form.save();
    return res.json({ success: true, data: {
      signedAt: form.staffSignature.signedAt,
      userName: form.staffSignature.userName,
      userRole: form.staffSignature.userRole,
    } });
  });

  // POST /api/consent-forms/:id/bypass — admin only
  // Documented escape valve when the scanner is unavailable / patient
  // cannot biometric-sign. Requires a non-empty reason; the admin's
  // identity is recorded from req.user.
  bypassBiometric = handle(async (req, res) => {
    if ((req.user?.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ success: false, code: "ADMIN_ONLY",
        message: "Only Admin can bypass biometric capture" });
    }
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ success: false, code: "REASON_REQUIRED",
        message: "A reason of at least 10 characters is required" });
    }
    const form = await ConsentForm.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    if (form.status !== "PENDING") {
      return res.status(409).json({ success: false, code: "CONSENT_LOCKED",
        message: `Cannot bypass on a ${form.status} consent` });
    }
    form.bypass = {
      reason: reason.trim(),
      authorisedBy: req.user?.id || null,
      authorisedByName: req.user?.fullName || "",
      authorisedAt: new Date(),
    };
    // Also stamp biometric.method = BYPASS so downstream readers can
    // see at a glance how this consent was authenticated.
    form.biometric = form.biometric || {};
    form.biometric.method = "BYPASS";
    form.auditTrail.push(auditEntry(req, "UPDATED", `bypass:${reason}`));
    await form.save();
    return res.json({ success: true, data: form.bypass });
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
