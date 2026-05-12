const VisitorPass = require("../../models/VisitorPass/visitorPassModel");
const Admission   = require("../../models/Patient/admissionModel");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};

async function nextPassNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count   = await VisitorPass.countDocuments({ passNumber: { $regex: `^VP-${dateStr}-` } });
  return `VP-${dateStr}-${String(count + 1).padStart(4, "0")}`;
}

/* POST /api/visitor-passes
   Body: { admissionId, attendantName, attendantRelation, attendantPhone,
           idProofType, idProofNumber, validHours, issuedBy } */
exports.issuePass = handle(async (req, res) => {
  const {
    admissionId, attendantName, attendantRelation, attendantPhone,
    idProofType, idProofNumber, validHours = 24, issuedBy, notes,
  } = req.body;

  if (!admissionId || !attendantName || !attendantRelation || !issuedBy)
    return res.status(400).json({ success: false, message: "admissionId, attendantName, attendantRelation, issuedBy required" });

  const adm = await Admission.findById(admissionId).populate("patientId", "fullName UHID").lean();
  if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
  if (adm.status !== "Active")
    return res.status(400).json({ success: false, message: "Cannot issue pass for non-active admission" });

  // Auto-expire stale Active passes for this admission so the max-2 check
  // doesn't lock the patient out forever.
  await VisitorPass.updateMany(
    { admissionId, status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  // Enforce max 2 active passes per admission
  const activeCount = await VisitorPass.countDocuments({ admissionId, status: "Active" });
  if (activeCount >= 2)
    return res.status(400).json({ success: false, message: "Maximum 2 active passes per patient. Revoke an existing pass first." });

  const validFrom  = new Date();
  const validUntil = new Date(validFrom.getTime() + Number(validHours) * 60 * 60 * 1000);

  const pass = await VisitorPass.create({
    passNumber:    await nextPassNumber(),
    admissionId,
    patientName:   adm.patientName || adm.patientId?.fullName || "Patient",
    patientUHID:   adm.UHID || adm.patientId?.UHID,
    bedNumber:     adm.bedNumber || "",
    wardName:      adm.wardName || "",
    attendantName,
    attendantRelation,
    attendantPhone,
    idProofType,
    idProofNumber,
    validFrom,
    validUntil,
    issuedBy,
    issuedByRole: req.body.issuedByRole || "Receptionist",
    notes,
  });

  return res.status(201).json({ success: true, data: pass });
});

/* GET /api/visitor-passes?status=Active&admissionId=...&patientUHID=... */
exports.listPasses = handle(async (req, res) => {
  // Persist stale Active → Expired transitions BEFORE listing so the count
  // and rows reflect reality (and so the max-2 issuePass guard is honest).
  await VisitorPass.updateMany(
    { status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  const filter = {};
  if (req.query.status)       filter.status      = req.query.status;
  if (req.query.admissionId)  filter.admissionId = req.query.admissionId;
  if (req.query.patientUHID)  filter.patientUHID = req.query.patientUHID;
  if (req.query.q) {
    const q = new RegExp(req.query.q, "i");
    filter.$or = [{ patientName: q }, { attendantName: q }, { passNumber: q }, { patientUHID: q }];
  }
  const list = await VisitorPass.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  return res.json({ success: true, count: list.length, data: list });
});

/* POST /api/visitor-passes/:id/return */
exports.returnPass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Pass not found" });
  p.status     = "Returned";
  p.returnedAt = new Date();
  await p.save();
  return res.json({ success: true, data: p });
});

/* POST /api/visitor-passes/:id/revoke */
exports.revokePass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Pass not found" });
  p.status        = "Revoked";
  p.revokedAt     = new Date();
  p.revokedReason = req.body.reason || "";
  await p.save();
  return res.json({ success: true, data: p });
});

/* GET /api/visitor-passes/active-count — for dashboard widget */
exports.activeCount = handle(async (req, res) => {
  const count = await VisitorPass.countDocuments({ status: "Active" });
  return res.json({ success: true, count });
});
