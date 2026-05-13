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
  update = handle(async (req, res) => {
    const form = await ConsentForm.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form });
  });

  // PATCH /api/consent-forms/:id/sign
  sign = handle(async (req, res) => {
    const { guardianName, guardianRelation, witnessName } = req.body;
    const form = await ConsentForm.findByIdAndUpdate(
      req.params.id,
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
    if (!form) return res.status(404).json({ success: false, message: "Consent form not found" });
    return res.json({ success: true, data: form, message: "Consent form signed" });
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
