const VisitorPass = require("../../models/VisitorPass/visitorPassModel");
const Admission   = require("../../models/Patient/admissionModel");
const { nextSequence } = require("../../utils/counter");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};

// Atomic pass-number via shared Counter (replaces countDocuments race).
async function nextPassNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seq     = await nextSequence(`visitorpass:${dateStr}`);
  return `VP-${dateStr}-${String(seq).padStart(4, "0")}`;
}

/* POST /api/visitor-passes
   Body: { admissionId, attendantName, attendantRelation, attendantPhone,
           idProofType, idProofNumber, validHours, notes }
   R7ab: issuedBy / issuedByRole are now derived from req.user — they
   used to be trusted from req.body, so any Receptionist could attribute
   a pass to "Dr. X". */
exports.issuePass = handle(async (req, res) => {
  const {
    admissionId, attendantName, attendantRelation, attendantPhone,
    idProofType, idProofNumber, validHours = 24, notes,
  } = req.body;

  if (!admissionId || !attendantName || !attendantRelation)
    return res.status(400).json({ success: false, message: "admissionId, attendantName, attendantRelation required" });

  // R7ab: identity comes from the auth context, NOT the request body.
  // requireAction("reception.visitor-pass") on the route guarantees
  // req.user is populated; this fallback is for emergency dev paths.
  const issuedBy     = req.user?.fullName || req.user?.email || "Receptionist";
  const issuedByRole = req.user?.role     || "Receptionist";

  // FIX (audit P8-B3): reject negative / non-numeric validHours before
  // computing validUntil — old code created already-expired passes.
  const hours = Number(validHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    return res.status(400).json({ success: false, message: "validHours must be a positive number ≤ 720 (30 days)" });
  }

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
  const validUntil = new Date(validFrom.getTime() + hours * 60 * 60 * 1000);

  // R7ab: passNumber retry on E11000 — the counter is atomic but if a
  // legacy seed clash or manual import collides, gracefully bump and
  // retry rather than 500-ing the desk.
  let pass = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      pass = await VisitorPass.create({
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
        issuedByRole,
        notes,
      });
      break;
    } catch (e) {
      lastErr = e;
      if (e?.code !== 11000) throw e;
      // E11000 on passNumber — burn next sequence and retry.
    }
  }
  if (!pass) throw lastErr || new Error("Failed to issue pass after retries");

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
    // Escape user-supplied regex chars so a caller can't pass `.*` and
    // dump every pass (security audit 2026-05-17 finding B-03).
    const { safeRegex } = require("../../utils/queryGuards");
    const q = safeRegex(req.query.q);
    filter.$or = [{ patientName: q }, { attendantName: q }, { passNumber: q }, { patientUHID: q }];
  }
  const list = await VisitorPass.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  return res.json({ success: true, count: list.length, data: list });
});

/* POST /api/visitor-passes/:id/return */
exports.returnPass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Pass not found" });
  // FIX (audit P8-B4): block flipping an already-terminal pass (Revoked /
  // Returned / Expired) back to Returned. Only Active passes can be returned.
  if (p.status !== "Active") {
    return res.status(409).json({ success: false, message: `Pass is already ${p.status}` });
  }
  p.status     = "Returned";
  p.returnedAt = new Date();
  await p.save();
  return res.json({ success: true, data: p });
});

/* POST /api/visitor-passes/:id/revoke */
exports.revokePass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Pass not found" });
  // FIX (audit P8-B4): same status guard as return — only an Active pass
  // can be revoked. Prevents flipping Returned passes to Revoked.
  if (p.status !== "Active") {
    return res.status(409).json({ success: false, message: `Pass is already ${p.status}` });
  }
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

/* GET /api/visitor-passes/stats
   Three KPIs for the Security dashboard in one round-trip. */
exports.stats = handle(async (req, res) => {
  // First, transition any stale Active passes whose window has closed.
  await VisitorPass.updateMany(
    { status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  // Hospital-local "today" — UTC slice would put the IST midnight cutoff
  // in the wrong place (see autoBillingService HOSPITAL_TZ for the same
  // reasoning).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [passesToday, activeVisitors, expiredPasses] = await Promise.all([
    VisitorPass.countDocuments({ createdAt: { $gte: startOfDay } }),
    VisitorPass.countDocuments({ status: "Active" }),
    // "Expired passes" — pass window closed AND still on file today (we
    // don't surface ancient expired passes; the gate-pass auditor uses
    // listPasses for the full history view).
    VisitorPass.countDocuments({ status: "Expired", validUntil: { $gte: startOfDay } }),
  ]);

  return res.json({
    success: true,
    data: { passesToday, activeVisitors, expiredPasses },
  });
});
