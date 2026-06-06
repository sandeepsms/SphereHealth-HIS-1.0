const router   = require("express").Router();
const DoctorOrder = require("../../models/Doctor/DoctorOrderModel");
const User = require("../../models/User/userModel");
// R7m: Apply role-based action gates to every write route. Reads stay
// open (any authenticated clinician can view orders). Writes are
// scoped to the appropriate role per Backend/config/permissions.js.
const { requireAction, adminOnly } = require("../../middleware/auth");
// B1-T08: doctor-order writes (create/bulk/restart/doctor-action) are
// licensed clinical acts under NMC Regulations 2002 + NABH HRD.3 — block on
// missing/expired NMC_REG. Mounted AFTER requireAction so the role gate
// runs first.
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
const { validateObjectIdParam } = require("../../utils/queryGuards");
// R7hr-12-S? — per-verb permission resolver used by /doctor-action so
// each action verb (stop/hold/resume/modify/substitute) can demand its
// own fine-grained permission rather than sharing the route-level gate.
const { roleCan } = require("../../config/permissions");

/* ─────────────────────────────────────────────────────
   R7hr-12-S? — Centralized status transition helper.
   Pre-fix multiple route handlers mutated `status` via
   findByIdAndUpdate / $set, bypassing the pre('save') hook
   that enforces the ALLOWED_TRANSITIONS matrix (see
   DoctorOrderModel.js). That meant a Stopped or Cancelled
   order could be flipped back to Active via the wrong
   route handler. Every state change MUST flow through
   moveStatus() so the matrix + audit emit fire uniformly.

   Caller passes a HYDRATED Mongoose doc (NOT a lean()
   object). Reason / actor are persisted onto schema
   fields when present; statusReason / statusChangedBy /
   statusChangedAt are written through but silently
   stripped by Mongoose strict-mode if absent from the
   schema (sibling agent will add them in a follow-up).
───────────────────────────────────────────────────── */
async function moveStatus(orderDoc, nextStatus, { actor, reason, session } = {}) {
  orderDoc.status = nextStatus;
  if (reason) orderDoc.statusReason = reason;
  if (actor)  orderDoc.statusChangedBy = actor;
  orderDoc.statusChangedAt = new Date();
  await orderDoc.save(session ? { session } : undefined);
  try {
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
    await emitClinicalAudit({
      event: "STATUS_CHANGE",
      targetType: "DoctorOrder",
      targetId: orderDoc._id,
      UHID: orderDoc.UHID,
      admissionId: orderDoc.admissionId,
      patientId: orderDoc.patientId,
      actor: typeof actor === "object" ? actor : { _id: actor },
      after: { status: nextStatus, reason },
    });
  } catch (e) { /* never let audit emit break the route */ }
  return orderDoc;
}

/* ─────────────────────────────────────────────────────
   NABH High Alert Medication detection (shared util)
───────────────────────────────────────────────────── */
const HAM_KW = [
  "insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone",
  "kcl","potassium chloride","magnesium sulphate","mgso4","calcium chloride",
  "dextrose 25%","dextrose 50%","hypertonic saline","nacl 3%",
  "morphine","fentanyl","pethidine","tramadol iv","oxycodone",
  "noradrenaline","norepinephrine","adrenaline","epinephrine",
  "dopamine","dobutamine","vasopressin","milrinone",
  "suxamethonium","succinylcholine","vecuronium","rocuronium","atracurium",
  "streptokinase","alteplase","tenecteplase",
  "methotrexate","cyclophosphamide","cisplatin","vincristine","doxorubicin",
  "oxytocin","nitroprusside","ketamine","propofol","midazolam iv",
  "phenytoin iv","vancomycin iv","gentamicin iv","amikacin iv",
];
const checkHAM = (name = "") => HAM_KW.some(k => (name || "").toLowerCase().includes(k));

/* ─────────────────────────────────────────────────────
   R7bq-J1 — Duration parser for course pre-seeding.
   Accepts: "5 days", "5d", "1 week", "2 weeks", "1 month",
   "Continue" / "Continuous" / "Daily" (returns null → no
   pre-seed, treated as open-ended). Caps at 30 days so a
   typo can't seed thousands of AR rows.
───────────────────────────────────────────────────── */
function parseDurationToDays(str) {
  if (!str || typeof str !== "string") return 1;
  const s = str.toLowerCase().trim();
  if (!s) return 1;
  // Open-ended courses — no pre-seed.
  if (s.includes("continu") || s === "daily" || s === "stat" || s === "sos") return null;
  // R7hr-12-S? (P1-12): hours come BEFORE the "day" branch so "5 hrs" doesn't
  // accidentally match the d?ay regex via "h" then "r" → 1 day. Convert
  // hours → days via ceil(h/24) with a floor of 1.
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\b/);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    return Math.min(30, Math.max(1, Math.ceil(hours / 24)));
  }
  // "5 days", "5d", "5  day"
  const dayMatch  = s.match(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?/);
  if (dayMatch)  return Math.min(30, Math.max(1, Math.round(parseFloat(dayMatch[1]))));
  // "1 week", "2 weeks", "1w", "1 wk", "2 wks"
  const weekMatch = s.match(/(\d+(?:\.\d+)?)\s*w(?:k|ks|eek|eeks)?\b/);
  if (weekMatch) return Math.min(30, Math.max(1, Math.round(parseFloat(weekMatch[1]) * 7)));
  // "1 month" — conservative 30-day cap.
  const monthMatch = s.match(/(\d+(?:\.\d+)?)\s*m(?:onth)?s?\b/);
  if (monthMatch) return 30; // cap at the schema max
  // Bare integer ("5") — assume days.
  const bareNum = s.match(/^\d+$/);
  if (bareNum) return Math.min(30, Math.max(1, parseInt(s, 10)));
  return 1;
}

/* Build a midnight-IST date at offset `+nDays` from baseMidnight. Pre-seeded
   AR rows store scheduledDate at midnight so the cron + completion check
   compare cleanly. */
function dateAtMidnightOffset(base, nDays) {
  const d = new Date(base);
  d.setDate(d.getDate() + nDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ═══════════════════════════════════════════════════
   DOCTOR ROUTES
═══════════════════════════════════════════════════ */

// POST / — create single order (Doctor / Admin only)
router.post("/", requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), async (req, res) => {
  try {
    const body = req.body;
    // Auto-set HAM flags
    const name = body.orderDetails?.medicineName || body.orderDetails?.displayName || "";
    if (name) {
      body.hamFlag = checkHAM(name);
      body.twoNurseRequired = body.hamFlag;
      body.highRisk = body.hamFlag;
    }

    // R7hr-83 — strip ServiceMaster pick fields if the orderType can't map
    // to a ServiceMaster row (e.g. Investigation). Mongoose strict-mode
    // would persist them otherwise, and the Phase C billing trigger would
    // misfire for a category that has no catalog entry.
    if (body.orderDetails && !SERVICE_MASTER_MAPPABLE_TYPES.has(body.orderType)) {
      for (const k of SERVICE_MASTER_PICK_KEYS) delete body.orderDetails[k];
    }

    // R7bv — stamp clinical linkage fields so the patient-history aggregator
    // (which filters DoctorOrder by `{ $or: [{admissionId}, {ipdNo}] }`)
    // can find this order. Pre-R7bv the DoctorOrder schema didn't even
    // define admissionId / ipdNo, so Mongoose strict-mode silently stripped
    // them on every save. With the schema additions (DoctorOrderModel.js)
    // we now actively normalise: front-end sometimes sends only
    // UHID + visitId (legacy OPD path), sometimes the full set. Resolve
    // the active admission server-side rather than trusting whatever
    // partial state the caller had to hand.
    //
    // R7bw — visitId fallback. Two upstream paths (BloodTransfusion ordering
    // and an early Medication path) call POST without `visitId`. Persisting
    // `visitId: undefined` breaks the legacy OPD-style filter
    // `DoctorOrder.find({ visitId })` on the GET listing route. We now
    // mirror the admissionNumber → visitId when visitId is missing for IPD
    // orders, so the listing route returns the order regardless of which
    // identifier the caller queries with.
    if ((body.visitType === "IPD" || !body.visitType) && body.UHID) {
      if (!body.admissionId || !body.ipdNo || !body.admissionNumber || !body.visitId) {
        try {
          const Admission = require("../../models/Patient/admissionModel");
          const adm = await Admission.findOne({
            UHID: body.UHID,
            status: "Active",
          }).select("_id admissionNumber").lean();
          if (adm) {
            if (!body.admissionId)     body.admissionId     = adm._id;
            if (!body.ipdNo)           body.ipdNo           = adm.admissionNumber || body.visitId || null;
            if (!body.admissionNumber) body.admissionNumber = adm.admissionNumber || null;
            // R7bw — visitId fallback: prefer caller-supplied, else mirror
            // admissionNumber so legacy `?visitId=` queries still hit.
            if (!body.visitId)         body.visitId         = adm.admissionNumber || null;
          }
        } catch (_) { /* non-fatal — the order can still save without linkage */ }
      }
    }
    // R7bq-J1 — pre-seed the full course (not just today). Pre-J1 only
    // today's slots were seeded, so a 5-day BD order looked "almost
    // done" after one day and the doctor had to keep re-prescribing.
    // Worse, past-day pending slots blocked the completion check
    // forever. Now we seed every day from today → today + courseDays.
    if (body.scheduledTimes && Array.isArray(body.scheduledTimes) && !body.administrationRecord?.length) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const wantsCourseSeed =
        body.orderType === "Medication" || body.orderType === "IV_Fluid";
      const days = wantsCourseSeed
        ? parseDurationToDays(body.orderDetails?.duration)
        : 1;

      if (wantsCourseSeed && days != null && days > 0) {
        // Multi-day full-course seed.
        const rows = [];
        for (let i = 0; i < days; i++) {
          const dayDate = dateAtMidnightOffset(today, i);
          for (const t of body.scheduledTimes) {
            rows.push({
              scheduledTime: t,
              scheduledDate: dayDate,
              status: "pending",
            });
          }
        }
        body.administrationRecord = rows;
        body.courseDays = days;
        // endDate = last seeded day at end-of-day so the completion check
        // (endDate <= startOfToday) flips on the day AFTER the last dose.
        const lastDay = dateAtMidnightOffset(today, days - 1);
        body.endDate = lastDay;
      } else {
        // Open-ended / non-medication — today only, no endDate.
        body.administrationRecord = body.scheduledTimes.map(t => ({
          scheduledTime: t,
          scheduledDate: today,
          status: "pending",
        }));
        if (wantsCourseSeed && days == null) {
          // Continuous / Daily / STAT / SOS — explicitly leave open-ended.
          body.courseDays = null;
          body.endDate = null;
        }
      }
    }

    // R7bq-J2 — Defense against double-clicks / network retries. If an identical
    // Medication or IV_Fluid order was placed within the last 30 seconds, surface
    // a 409 with the existing _id so the caller can recover idempotently. STAT
    // priority bypasses dedupe because code-blue scenarios genuinely repeat the
    // same dose in quick succession.
    if (
      (body.orderType === "Medication" || body.orderType === "IV_Fluid") &&
      body.priority !== "STAT" &&
      !body.isVerbal              // verbal orders are pre-validated by a co-sign step elsewhere
    ) {
      const since = new Date(Date.now() - 30_000);
      // R7hr-12-S? (P2-5): include `route` and `dilutionVolume` in the dedup
      // key — pre-fix two identical-name doses prescribed via PO and IV in
      // the same 30s window would have collapsed into a single 409. Same
      // dose dissolved in different diluent volumes is a different order.
      const dup = await DoctorOrder.findOne({
        UHID: body.UHID,
        orderType: body.orderType,
        "orderDetails.medicineName": body.orderDetails?.medicineName,
        "orderDetails.dose":         body.orderDetails?.dose,
        "orderDetails.frequency":    body.orderDetails?.frequency,
        "orderDetails.route":        body.orderDetails?.route,
        "orderDetails.dilutionVolume": body.orderDetails?.dilutionVolume,
        status: { $nin: ["Cancelled","Stopped"] },
        orderedAt: { $gte: since },
      }).select("_id orderedAt orderDetails.medicineName").lean();
      if (dup) {
        return res.status(409).json({
          ok: false,
          code: "DUPLICATE_ORDER",
          duplicateId: String(dup._id),
          message: `Identical ${dup.orderDetails?.medicineName || body.orderType} order was placed ${Math.round((Date.now() - new Date(dup.orderedAt).getTime())/1000)}s ago — refusing the duplicate. Modify priority to STAT for genuine repeat doses.`,
        });
      }
    }

    // R7gw-B3-T08 — defense-in-depth: high-risk Procedure orders auto-flag
    // for the OT register even if the UI toggle (T06) is bypassed by a
    // direct API caller or an older client. Major / Surgical procedures
    // and GA / Sedation / Spinal anaesthesia always belong in the OT
    // register per NABH COP.10. The downstream emitter at line ~272 keys
    // off `order.orderDetails.requiresOT === true`, so we mutate the same
    // path here before persistence.
    if (body.orderType === "Procedure") {
      const details = body.orderDetails || (body.orderDetails = {});
      const highRiskTypes = new Set(["Major", "Surgical"]);
      const highRiskAnaes = new Set(["GA", "Sedation", "Spinal"]);
      const uiFlag = details.requiresOT === true || details.requiresOT === "Yes";
      details.requiresOT =
        uiFlag ||
        highRiskTypes.has(details.procedureType) ||
        highRiskAnaes.has(details.anaesthesia);
    }

    const order = await DoctorOrder.create(body);

    // R7bn-3 / D1-fix: when the doctor orders a blood transfusion, auto-
    // populate the NABH BloodTransfusionRegister. Pre-fix the emitter
    // existed but was never called from any controller — orders piled up
    // but the NABH register stayed empty.
    if (order.orderType === "BloodTransfusion") {
      try {
        const { emitBloodTransfusion } = require("../../services/Compliance/nabhRegisterEmitter");
        const Patient = require("../../models/Patient/patientModel");
        const Admission = require("../../models/Patient/admissionModel");
        const patient = order.patientId
          ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex bloodGroup").lean()
          : null;
        const admission = order.admissionId
          ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
          : null;
        // R7du — DoctorOrderModel has no `preTransfusion` schema slot, so
        // Mongoose strict-mode strips it on .create(). Build a plain-object
        // shim that carries the persisted order's _id + identity fields plus
        // the raw `preTransfusion` payload from the request body, so the
        // NABH MOM.4 emitter (which reads `order.preTransfusion.{consentSigned,
        // consentFormId, bp, pulse, temp, spo2}`) gets the consent + pre-tx
        // vitals captured by the doctor at order entry. Adding the field at
        // the DoctorOrder schema level is a separate, broader change.
        const orderForEmit = order.toObject ? order.toObject() : { ...order };
        if (body && body.preTransfusion && typeof body.preTransfusion === "object") {
          orderForEmit.preTransfusion = body.preTransfusion;
        }
        emitBloodTransfusion({ order: orderForEmit, patient: patient || {}, admission, actor: req.user || {} })
          .catch((e) => console.error("[doctor-orders] emitBloodTransfusion error:", e?.message));
      } catch (e) {
        console.error("[doctor-orders] BloodTransfusion emit wiring failed:", e?.message);
      }
    }

    // R7bx-3 — Auto-populate NABH MOM.7 Antimicrobial-Use register when
    // a Medication order names an antibiotic. The emitter performs the
    // antibiotic name match (see ANTIBIOTIC_STEMS) and no-ops if the drug
    // isn't an antibiotic, so this branch is cheap and safe for every
    // Medication order. NABH AMS (Antimicrobial Stewardship) expects every
    // antibiotic prescription to surface in the AMU register from the
    // moment it is written; we cannot rely on the pharmacy dispense step.
    if (order.orderType === "Medication") {
      try {
        const { emitAntimicrobial, isAntibiotic } = require("../../services/Compliance/nabhRegisterEmitter");
        const medName = order.orderDetails?.medicineName || order.orderDetails?.displayName || "";
        if (isAntibiotic(medName)) {
          const Patient = require("../../models/Patient/patientModel");
          const Admission = require("../../models/Patient/admissionModel");
          const patient = order.patientId
            ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex").lean()
            : null;
          const admission = order.admissionId
            ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
            : null;
          emitAntimicrobial({ order, patient: patient || {}, admission, actor: req.user || {} })
            .catch((e) => console.error("[doctor-orders] emitAntimicrobial error:", e?.message));
        }
      } catch (e) {
        console.error("[doctor-orders] Antimicrobial emit wiring failed:", e?.message);
      }
    }

    // R7bx-3 — Auto-populate NABH COP.10 OT register when a Procedure
    // order is flagged `requiresOT=true`. Mirrors the BloodTransfusion
    // pattern above: emitter is non-blocking, only fires when the
    // discriminator is true. Frontend procedure-order form flips
    // `orderDetails.requiresOT` whenever the doctor selects an OT slot;
    // also covers any direct API caller that explicitly sets the flag.
    if (order.orderType === "Procedure" && order.orderDetails?.requiresOT === true) {
      try {
        const { emitOT } = require("../../services/Compliance/nabhRegisterEmitter");
        const Patient = require("../../models/Patient/patientModel");
        const Admission = require("../../models/Patient/admissionModel");
        const patient = order.patientId
          ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex").lean()
          : null;
        const admission = order.admissionId
          ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
          : null;
        emitOT({ order, patient: patient || {}, admission, actor: req.user || {} })
          .catch((e) => console.error("[doctor-orders] emitOT error:", e?.message));
      } catch (e) {
        console.error("[doctor-orders] OT emit wiring failed:", e?.message);
      }
    }

    // R7en — Auto-populate NABH ECG register when an Investigation order
    // names an ECG / EKG / Electrocardiogram. Creates a PendingReport row
    // immediately so the surveyor sees the order in the register from the
    // moment it's written; the nurse/tech files findings via the
    // PATCH /api/ecg-register/:id/report endpoint once the strip is read.
    // Non-blocking — never rolls back the primary doctor-order write.
    if (order.orderType === "Investigation" || order.orderType === "Lab") {
      try {
        const details = order.orderDetails || {};
        const name = String(
          details.testName || details.displayName || details.investigationName || details.medicineName || ""
        ).toLowerCase();
        const isECG =
          /\becg\b/.test(name) ||
          /\bekg\b/.test(name) ||
          name.includes("electrocardiogram") ||
          name.includes("electro-cardiogram");
        if (isECG) {
          const { emitECG } = require("../../services/Compliance/nabhRegisterEmitter");
          const Patient = require("../../models/Patient/patientModel");
          const Admission = require("../../models/Patient/admissionModel");
          const patient = order.patientId
            ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex").lean()
            : null;
          const admission = order.admissionId
            ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
            : null;
          emitECG({
            patient: patient || {},
            admission,
            ecg: {
              orderedAt: order.orderedAt || order.createdAt || new Date(),
              // performedAt defaults to orderedAt for PendingReport rows; the
              // /report patch updates it with the actual performance time.
              performedAt: order.orderedAt || order.createdAt || new Date(),
              indication: details.indication || order.indication || order.notes || details.diagnosis || "",
              indicationCategory: details.indicationCategory || "Other",
              location: admission?.wardName || admission?.ward || "Ward",
              leadType: details.leadType || "12-lead",
              sourceType: "DoctorOrder",
              doctorOrderId: order._id,
            },
            actor: req.user || {},
          }).catch((e) => console.error("[doctor-orders] emitECG error:", e?.message));
        }
      } catch (e) {
        console.error("[doctor-orders] ECG emit wiring failed:", e?.message);
      }
    }

    // R7bn-4 / D7-1-fix: when orderType==="Medication", auto-seed the
    // MAR so the nurse sees the drug on the Treatment Chart without
    // requiring a separate Prescription save. Pre-fix MAR rows came
    // exclusively from Prescription model — standalone DoctorOrder
    // medications were never charted, so nurses didn't see them on
    // MAR and couldn't administer/sign them.
    if (order.orderType === "Medication" && order.admissionId) {
      try {
        const MAR = require("../../models/Clinical/MARModel");
        const Patient = require("../../models/Patient/patientModel");
        const today = new Date();
        const marDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const nextDay = new Date(marDate); nextDay.setDate(nextDay.getDate() + 1);

        // Find or create the MAR for today + this ipdNo.
        let mar = await MAR.findOne({
          ipdNo: order.ipdNo || String(order.admissionId),
          date: { $gte: marDate, $lt: nextDay },
        });
        if (!mar) {
          const pat = order.patientId
            ? await Patient.findById(order.patientId).select("_id UHID fullName").lean()
            : null;
          if (pat?._id) {
            mar = await MAR.create({
              patient: pat._id,
              UHID: order.UHID || pat.UHID || "",
              ipdNo: order.ipdNo || String(order.admissionId),
              admissionId: order.admissionId,
              patientName: order.patientName || pat.fullName || "",
              date: marDate,
              medications: [],
            });
          }
        }
        // Atomic $push of this med onto today's MAR.
        if (mar) {
          const medRow = {
            drugName:   order.orderDetails?.medicineName || order.orderDetails?.displayName || "",
            dose:       order.orderDetails?.dose || order.orderDetails?.dosage || "",
            route:      order.orderDetails?.route || "",
            frequency:  order.orderDetails?.frequency || "",
            startDate:  order.startDate || new Date(),
            endDate:    order.endDate || null,
            isHighAlert:    !!order.hamFlag,
            twoNurseRequired: !!order.twoNurseRequired,
            prescribedBy:   order.doctorId || order.attendingDoctorId || null,
            doctorOrderId:  order._id,
            scheduledTimes: order.scheduledTimes || [],
            administrations: [],
          };
          await MAR.updateOne(
            { _id: mar._id },
            { $push: { medications: medRow } },
          );
        }
      } catch (e) {
        console.error("[doctor-orders] MAR seed failed:", e?.message);
      }
    }

    // R7bn-1 / D9-fix: ClinicalAudit emit on every doctor-order create.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: order.orderType === "BloodTransfusion"
          ? "TRANSFUSION_ORDERED"
          : order.orderType === "IV_Fluid"
            ? "INFUSION_STARTED"
            : "ORDER_CREATED",
        UHID: order.UHID,
        admissionId: order.admissionId,
        patientId: order.patientId,
        patientName: order.patientName,
        targetType: "DoctorOrder",
        targetId: order._id,
        after: { orderType: order.orderType, summary: (order.orderDetails?.medicineName || order.description || "").slice(0, 200) },
      });
    } catch (_) { /* silent */ }

    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// POST /bulk — create multiple orders
// FIX (audit P14-B5): insertMany({ordered:false}) silently swallows
// per-document validation failures and the caller only sees the rows that
// made it in. The frontend would then re-render with "5 orders created"
// when only 3 actually inserted, and the missing 2 quietly disappeared.
// Now we report inserted + failed counts with reasons so the UI can flag
// the bad rows.
router.post("/bulk", requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || !orders.length)
      return res.status(400).json({ ok: false, message: "orders[] required" });

    // R7bv — same linkage normalisation as POST /. Cache the admission
    // lookup per-UHID so a bulk insert of 10 orders for the same patient
    // does ONE Admission query, not 10.
    const Admission = require("../../models/Patient/admissionModel");
    const admissionCache = new Map();
    async function resolveAdmission(uhid) {
      if (!uhid) return null;
      if (admissionCache.has(uhid)) return admissionCache.get(uhid);
      const adm = await Admission.findOne({ UHID: uhid, status: "Active" })
        .select("_id admissionNumber").lean().catch(() => null);
      admissionCache.set(uhid, adm || null);
      return adm;
    }

    const enriched = [];
    for (const o of orders) {
      const name = o.orderDetails?.medicineName || o.orderDetails?.displayName || "";
      o.hamFlag = checkHAM(name);
      o.twoNurseRequired = o.hamFlag;
      o.highRisk = o.hamFlag;

      // R7hr-83 — mirror POST / scoping: strip ServiceMaster pick fields if
      // this orderType can't map to a ServiceMaster row.
      if (o.orderDetails && !SERVICE_MASTER_MAPPABLE_TYPES.has(o.orderType)) {
        for (const k of SERVICE_MASTER_PICK_KEYS) delete o.orderDetails[k];
      }

      // R7bv — stamp admissionId / ipdNo / admissionNumber from the
      // patient's active admission so the aggregator can surface this
      // order under the IPD patient file.
      // R7bw — also fill visitId fallback for IPD orders so legacy
      // `?visitId=` listing queries return the order.
      if ((o.visitType === "IPD" || !o.visitType) && o.UHID &&
          (!o.admissionId || !o.ipdNo || !o.admissionNumber || !o.visitId)) {
        const adm = await resolveAdmission(o.UHID);
        if (adm) {
          if (!o.admissionId)     o.admissionId     = adm._id;
          if (!o.ipdNo)           o.ipdNo           = adm.admissionNumber || o.visitId || null;
          if (!o.admissionNumber) o.admissionNumber = adm.admissionNumber || null;
          if (!o.visitId)         o.visitId         = adm.admissionNumber || null;
        }
      }

      // R7bq-J1 — pre-seed the full course for Medication / IV_Fluid.
      if (o.scheduledTimes?.length && !o.administrationRecord?.length) {
        const today = new Date(); today.setHours(0,0,0,0);
        const wantsCourseSeed = o.orderType === "Medication" || o.orderType === "IV_Fluid";
        const days = wantsCourseSeed ? parseDurationToDays(o.orderDetails?.duration) : 1;
        if (wantsCourseSeed && days != null && days > 0) {
          const rows = [];
          for (let i = 0; i < days; i++) {
            const dayDate = dateAtMidnightOffset(today, i);
            for (const t of o.scheduledTimes) {
              rows.push({ scheduledTime: t, scheduledDate: dayDate, status: "pending" });
            }
          }
          o.administrationRecord = rows;
          o.courseDays = days;
          o.endDate = dateAtMidnightOffset(today, days - 1);
        } else {
          o.administrationRecord = o.scheduledTimes.map(t => ({ scheduledTime: t, scheduledDate: today, status: "pending" }));
        }
      }
      enriched.push(o);
    }

    // R7bq-J2 — Per-row dedupe (mirrors POST /). For each Medication / IV_Fluid
    // (non-STAT, non-verbal) row, check if an identical order was placed within
    // the last 30s. Skip duplicates and surface them in the failed list so the
    // caller can recover idempotently; non-duplicate rows still flow into
    // insertMany below.
    //
    // R7hr-12-S? (P2-7): batched dedup. Pre-fix this loop did one findOne
    // per row — 50-row indents produced 50 sequential round-trips per request.
    // Now we collect every candidate's dedup key into a single $or query, build
    // an in-memory Map of (UHID|med|dose|freq) → existing _id, and filter the
    // batch in O(n) without per-row I/O.
    const failed = [];
    const toInsert = [];
    {
      const sinceTs = Date.now() - 30_000;
      const since = new Date(sinceTs);
      const keyOf = (uhid, med, dose, freq) =>
        `${uhid || ""}|${med || ""}|${dose || ""}|${freq || ""}`;

      // Build a parallel array of indices into `enriched` that need dedup.
      const dedupCandidates = [];
      for (let i = 0; i < enriched.length; i++) {
        const o = enriched[i];
        const shouldDedupe =
          (o.orderType === "Medication" || o.orderType === "IV_Fluid") &&
          o.priority !== "STAT" &&
          !o.isVerbal;
        if (shouldDedupe) dedupCandidates.push({ i, o });
      }

      // Single batched query for ALL candidates.
      let existingMap = new Map();
      if (dedupCandidates.length > 0) {
        const dedupOr = dedupCandidates.map(({ o }) => ({
          UHID: o.UHID,
          "orderDetails.medicineName": o.orderDetails?.medicineName,
          "orderDetails.dose":         o.orderDetails?.dose,
          "orderDetails.frequency":    o.orderDetails?.frequency,
          orderedAt: { $gte: since },
        }));
        const existing = await DoctorOrder.find({
          $or: dedupOr,
          status: { $nin: ["Cancelled","Stopped"] },
        }).select("_id UHID orderedAt orderDetails.medicineName orderDetails.dose orderDetails.frequency").lean();
        for (const row of existing) {
          const k = keyOf(
            row.UHID,
            row.orderDetails?.medicineName,
            row.orderDetails?.dose,
            row.orderDetails?.frequency,
          );
          // Keep the most recent existing row per key (first hit is fine — the
          // matter is whether ANY recent dup exists, not which one).
          if (!existingMap.has(k)) existingMap.set(k, row);
        }
      }

      // Now walk every enriched row and decide insert vs failed.
      const candidateIndexSet = new Set(dedupCandidates.map(c => c.i));
      for (let i = 0; i < enriched.length; i++) {
        const o = enriched[i];
        if (!candidateIndexSet.has(i)) { toInsert.push(o); continue; }
        const k = keyOf(o.UHID, o.orderDetails?.medicineName, o.orderDetails?.dose, o.orderDetails?.frequency);
        const dup = existingMap.get(k);
        if (dup) {
          failed.push({
            index: i,
            code: "DUPLICATE_ORDER",
            duplicateId: String(dup._id),
            message: `Identical ${dup.orderDetails?.medicineName || o.orderType} order was placed ${Math.round((Date.now() - new Date(dup.orderedAt).getTime())/1000)}s ago — skipped.`,
            row: o,
          });
        } else {
          toInsert.push(o);
        }
      }
    }

    let created = [];
    try {
      if (toInsert.length) {
        created = await DoctorOrder.insertMany(toInsert, { ordered: false, rawResult: false });
      }
    } catch (bulkErr) {
      // Mongoose 8 throws BulkWriteError with .insertedDocs + .writeErrors.
      created = bulkErr.insertedDocs || [];
      const writeErrors = bulkErr.writeErrors || bulkErr.result?.result?.writeErrors || [];
      for (const we of writeErrors) {
        failed.push({
          index: we.index ?? we.err?.index,
          message: we.errmsg || we.err?.errmsg || we.message,
          row: toInsert[we.index ?? we.err?.index],
        });
      }
      // If insertMany threw but produced no clear writeErrors, fall back to
      // diff-by-length so we don't drop the failure on the floor.
      if (!writeErrors.length && toInsert.length > created.length) {
        failed.push({ index: -1, message: bulkErr.message, count: toInsert.length - created.length });
      }
    }

    res.status(failed.length ? 207 : 201).json({
      ok: failed.length === 0,
      data: created,
      count: created.length,
      failedCount: failed.length,
      failed,
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// GET / — list orders. Query: UHID, visitId, status (comma-sep), orderType
// R7bb-B/D4-CRIT-S1: gated on `doctor-notes.read` (Admin / Doctor / Nurse /
// MRD). Pre-R7bb any authenticated role could pull every active doctor
// order (medication name + dose + HAM flag + administration record) for
// any patient.
router.get("/", requireAction("doctor-notes.read"), async (req, res) => {
  try {
    const { UHID, visitId, admissionId, ipdNo, status, orderType } = req.query;
    // R7hr-12-S? (P1-2): mandatory patient-scope filter. Pre-fix any caller
    // with doctor-notes.read could pull EVERY doctor order across the entire
    // hospital — drug name, dose, HAM flag, administration record — which
    // is a cross-ward PHI leak (NABH IMS.5 / HIPAA §164.502 minimum necessary).
    // Now we require at least one of UHID / visitId / admissionId / ipdNo.
    // TODO: layer role-scoped ward filtering (e.g. restrictToOwnNurseWard) on
    // top of this gate as a follow-up — out of scope for this pass.
    if (!UHID && !visitId && !admissionId && !ipdNo) {
      return res.status(400).json({
        ok: false,
        error: "GET /doctor-orders requires UHID, visitId, admissionId, or ipdNo filter",
      });
    }
    const filter = {};
    if (UHID)        filter.UHID = UHID;
    if (visitId)     filter.visitId = visitId;
    if (admissionId) filter.admissionId = admissionId;
    if (ipdNo)       filter.ipdNo = ipdNo;
    if (status)      filter.status = { $in: status.split(",") };
    if (orderType)   filter.orderType = orderType;
    // R7hr-12-S? (P1-2): defensive max-limit cap. Even with the filter above
    // a single bad query (e.g. status=Pending across a long-stay patient) can
    // still pull a thousand rows. Cap at 1000, default 200.
    const lim = Math.min(parseInt(req.query.limit) || 200, 1000);
    const orders = await DoctorOrder.find(filter)
      .sort({ orderedAt: -1, createdAt: -1 })
      .limit(lim);
    res.json({ ok: true, data: orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /:id — single order
router.get("/:id", validateObjectIdParam("id"), requireAction("doctor-notes.read"), async (req, res) => {
  try {
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// PATCH /:id — general update (status, consent, nurseNotes, stopReason, etc.)
//
// FIX (audit P14-B7): legacy PATCH was a wide-open `$set: req.body` —
// any caller could overwrite hamFlag / twoNurseRequired / orderedBy /
// administrationRecord / auditLog directly, bypassing every safeguard.
// Now whitelisted to fields the workflow genuinely needs to mutate from
// the generic PATCH path. Other changes go through dedicated endpoints
// (administer / rate-change / step / stop) that enforce business rules.
// R7hr-12-S? (P2-4): removed `status`, `stopReason`, `stoppedAt`, `stoppedBy`
// from the PATCH whitelist. Status changes MUST go through /doctor-action,
// /step, /administer, /infusion-rate, or DELETE — all of which now route
// through moveStatus() so the ALLOWED_TRANSITIONS matrix + audit emit fire.
// Allowing PATCH /:id to mutate status bypassed every guard.
const PATCH_ALLOWED = new Set([
  "nurseNotes", "consentObtained", "consentNotes",
  // R7bq-H — field names corrected to match the schema (`infusionStarted` /
  // `infusionStopped`, not `*At` / `*EndedAt`). Pre-fix, PATCH accepted the
  // wrong keys, mongoose silently stripped them, and the hourly infusion
  // cron (which queries `infusionStarted` IS NOT NULL) never picked the
  // order up. The legacy keys are still accepted as aliases for any
  // frontend code that hasn't migrated yet.
  "currentRate", "rateUnit",
  "infusionStarted",   "infusionStopped",
  "infusionStartedAt", "infusionEndedAt",
  "holdUntil", "holdReason", "delayReason",
  "remarks", "priority",
  // R7hr-83 — ServiceMaster pick fields carried on the order. Accepted on
  // PATCH for late binding (doctor picks the catalog row after order entry).
  // Scope-checked below against the ServiceMaster-mappable orderType set
  // and rewritten onto `orderDetails.<field>` dotted-path $set targets.
  "serviceMasterId", "serviceCode", "serviceName", "unitPrice",
]);
// R7hr-83 — orderTypes that can map to a ServiceMaster row (see
// ServiceMasterModel.doctorOrderCategory enum). `Investigation` is intentionally
// excluded — pathology investigations are billed via the lab dispatch path,
// not via ServiceMaster.
const SERVICE_MASTER_MAPPABLE_TYPES = new Set([
  "Medication","IV_Fluid","Lab","Radiology","Procedure","BloodTransfusion",
  "Diet","Oxygen","Physiotherapy","Activity","Nursing","Consultation",
]);
const SERVICE_MASTER_PICK_KEYS = ["serviceMasterId","serviceCode","serviceName","unitPrice"];
// R7hr-12-S? (P0-3): credentialExpiryBlocker('NMC_REG') now matches POST /,
// POST /bulk, /doctor-action, /restart. PATCH /:id is a licensed clinical
// act (rate change defaults, hold-until window adjustments, infusion start
// confirmation) and must demand a valid NMC registration.
router.patch("/:id", validateObjectIdParam("id"), requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), async (req, res) => {
  try {
    const safe = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (PATCH_ALLOWED.has(k)) safe[k] = v;
    }
    // R7bq-H — alias the legacy keys onto the canonical schema fields.
    if (safe.infusionStartedAt && !safe.infusionStarted) safe.infusionStarted = safe.infusionStartedAt;
    if (safe.infusionEndedAt   && !safe.infusionStopped) safe.infusionStopped = safe.infusionEndedAt;
    delete safe.infusionStartedAt;
    delete safe.infusionEndedAt;

    // R7hr-83 — rewrite ServiceMaster pick keys onto orderDetails dotted-path
    // $set targets, but only for orderTypes that can map to ServiceMaster
    // (see SERVICE_MASTER_MAPPABLE_TYPES above). If the order isn't mappable
    // the keys are dropped silently so a billing trigger never fires on a
    // category that has no catalog row.
    const pickKeysPresent = SERVICE_MASTER_PICK_KEYS.filter(k =>
      Object.prototype.hasOwnProperty.call(safe, k),
    );
    if (pickKeysPresent.length) {
      const head = await DoctorOrder.findById(req.params.id).select("orderType").lean();
      if (!head) return res.status(404).json({ ok: false, message: "Not found" });
      if (SERVICE_MASTER_MAPPABLE_TYPES.has(head.orderType)) {
        for (const k of pickKeysPresent) {
          safe[`orderDetails.${k}`] = safe[k];
          delete safe[k];
        }
      } else {
        for (const k of pickKeysPresent) delete safe[k];
      }
    }

    if (Object.keys(safe).length === 0) {
      return res.status(400).json({ ok: false, message: "No allowed fields to update — use the dedicated /administer, /rate-change, /doctor-action endpoints for status / stop transitions" });
    }

    const order = await DoctorOrder.findByIdAndUpdate(
      req.params.id, { $set: safe }, { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — STEP COMPLETION
═══════════════════════════════════════════════════ */
// POST /:id/step — nurse completes a workflow step
router.post("/:id/step", validateObjectIdParam("id"), requireAction("order.acknowledge"), async (req, res) => {
  try {
    const { step, doneBy, notes, totalSteps } = req.body;
    if (!step || !doneBy) return res.status(400).json({ ok: false, message: "step and doneBy required" });

    const current = await DoctorOrder.findById(req.params.id);
    if (!current) return res.status(404).json({ ok: false, message: "Not found" });

    const nextIndex  = (current.currentStepIndex ?? -1) + 1;
    const isLastStep = totalSteps && nextIndex >= totalSteps - 1;

    // R7bq-K2 — Respect the "first dose given = Completed" rule for
    // Medication orders. Pre-K2, /step blindly set status to InProgress
    // for intermediate steps and Completed for the last step — but if
    // the nurse had already administered a dose via /administer (which
    // K sets to Completed), clicking a step button like "Prepared"
    // afterward would silently down-grade the status back to InProgress
    // and the order would reappear in the active queue forever.
    //
    // Rule: never DOWNGRADE a Completed order via /step. And for
    // Medication where any non-STAT regular dose has already been
    // recorded as given, lock the status at Completed regardless of
    // how many step buttons remain.
    const medAlreadyGiven =
      current.orderType === "Medication" &&
      (current.administrationRecord || []).some(
        a => !a.isStatDose && a.status === "given",
      );
    const dontDowngrade = current.status === "Completed" || medAlreadyGiven;

    // R7hr-12-S? (P0-1): route the status mutation through moveStatus so
    // ALLOWED_TRANSITIONS + audit-emit fire. Non-status fields (auditLog,
    // currentStepIndex, completedBy/At) are applied directly on the doc
    // before the moveStatus save so a single .save() roundtrip persists
    // everything atomically.
    current.auditLog.push({ step, doneBy, doneAt: new Date(), notes: notes || "" });
    current.currentStepIndex = nextIndex;
    const nextStatus = (isLastStep || dontDowngrade) ? "Completed" : "InProgress";
    if (isLastStep || dontDowngrade) {
      current.completedBy = doneBy;
      current.completedAt = new Date();
    }
    const order = await moveStatus(current, nextStatus, { actor: req.user?._id || doneBy });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   R7bq-L — RESTART A COMPLETED/STOPPED INFUSION
═══════════════════════════════════════════════════
   Clones a finished infusion order as a fresh bag — same drug,
   diluent, rate, totalVolume — but a brand-new DoctorOrder with
   reset state. Used when the patient needs another bag of the same
   regimen (e.g. continue NS @ 50 ml/hr for another 500 ml). Bypasses
   the 30-second dedup guard because this is a deliberate, audited
   restart, not an accidental double-click.

   Body: { restartedBy?: string }
   Returns: { ok: true, data: <new order>, parentId: <original> }
═══════════════════════════════════════════════════ */
router.post("/:id/restart", validateObjectIdParam("id"), requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), async (req, res) => {
  try {
    const original = await DoctorOrder.findById(req.params.id);
    if (!original) return res.status(404).json({ ok: false, message: "Original order not found" });
    if (original.orderType !== "IV_Fluid") {
      return res.status(400).json({ ok: false, message: "Restart is only supported for IV_Fluid orders" });
    }
    // Build a clone payload from the original. Drop server-managed
    // fields so Mongoose generates fresh _id/createdAt/updatedAt and
    // we don't accidentally carry forward stale audit/state from the
    // previous bag.
    const o = original.toObject();
    delete o._id; delete o.__v;
    delete o.createdAt; delete o.updatedAt;
    delete o.administrationRecord;
    delete o.rateChanges;
    delete o.infusionMonitoring;
    delete o.auditLog;
    delete o.currentStepIndex;
    delete o.acknowledgedBy; delete o.acknowledgedAt;
    delete o.completedBy;    delete o.completedAt;
    delete o.stoppedAt;      delete o.stoppedBy;     delete o.stopReason;
    delete o.infusionStarted;
    delete o.infusionStopped;
    delete o.currentRate;
    delete o.mergedInto;
    o.status     = "Active";          // ready to run immediately
    o.orderedAt  = new Date();
    o.priority   = original.priority || "Routine";
    o.parentOrderId = original._id;   // audit link back to bag #1
    o.restartedFrom = original._id;
    o.auditLog   = [{
      step: "Bag restarted from previous order",
      doneBy: req.body?.restartedBy || req.user?.fullName || req.user?.email || "Nurse",
      doneAt: new Date(),
      notes: `Restarted from order ${original._id} (${original.orderDetails?.medicineName || "infusion"})`,
    }];
    o.infusionStarted = new Date();   // start the new bag immediately
    o.currentRate     = original.currentRate || original.orderDetails?.rate || "";

    const clone = await DoctorOrder.create(o);

    // Log on the original too so the timeline shows the handoff.
    original.auditLog.push({
      step: "Bag continued — new order created",
      doneBy: req.body?.restartedBy || req.user?.fullName || req.user?.email || "Nurse",
      doneAt: new Date(),
      notes: `Continued as order ${clone._id}`,
    });
    await original.save();

    return res.status(201).json({ ok: true, data: clone, parentId: String(original._id) });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — MEDICATION ADMINISTRATION (NABH MAR)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/administer
 * Body: {
 *   scheduledTime, scheduledDate?,
 *   status: "given"|"hold"|"not_available"|"delayed"|"skipped"|"refused"|"partial",
 *   givenAt?, givenBy, doseGiven?, routeUsed?, siteUsed?, notes?,
 *   verifiedBy?,                  // HAM 2nd nurse
 *   fiveRightsChecked?,
 *   holdReason?, holdUntil?,
 *   delayedTo?, delayReason?,
 *   prnEffect?, prnReassessTime?,
 *   adverseEvent?, adverseDetails?,
 * }
 */
router.post("/:id/administer", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    const {
      scheduledTime, status, givenAt, givenBy, doseGiven, routeUsed, siteUsed, notes,
      verifiedBy, fiveRightsChecked,
      holdReason, holdUntil, delayedTo, delayReason,
      prnEffect, prnReassessTime, adverseEvent, adverseDetails,
      isStatDose, statReason, nextDoseAdjustedAt,
    } = req.body;

    if (!scheduledTime || !givenBy || !status)
      return res.status(400).json({ ok: false, message: "scheduledTime, givenBy, status required" });

    // Validate HAM 2-nurse check
    if (order.twoNurseRequired && status === "given" && !verifiedBy)
      return res.status(422).json({ ok: false, message: "HAM order requires second nurse verification (verifiedBy)" });

    // B1-T05: When a witness (verifiedBy) is supplied — for HAM, controlled
    // substances, or voluntary co-sign — verify the actor is a real Nurse
    // (ISMP two-nurse rule, NABH MOM.3) AND is not the same person doing
    // the administration. Previously we only checked presence — any user id
    // (or none) passed. Hardens against forged witness on HAM doses.
    if (verifiedBy) {
      const wUser = await User.findById(verifiedBy).select("role employeeId fullName").lean();
      if (!wUser) {
        return res.status(400).json({ success: false, code: "VERIFIER_NOT_FOUND", message: "verifiedBy user not found" });
      }
      if (wUser.role !== "Nurse") {
        return res.status(400).json({ success: false, code: "VERIFIER_NOT_NURSE", message: "Witness must be a Nurse (ISMP)" });
      }
      if (String(wUser._id) === String(req.user.id)) {
        return res.status(400).json({ success: false, code: "VERIFIER_SAME_USER", message: "Witness must be different from acting nurse" });
      }
    }

    // Validate 5 Rights for given status
    if (status === "given" && !fiveRightsChecked)
      return res.status(422).json({ ok: false, message: "5 Rights must be confirmed before marking as given (fiveRightsChecked: true)" });

    // STAT dose: reason mandatory for audit trail
    if (isStatDose && status === "given" && !statReason)
      return res.status(422).json({ ok: false, message: "STAT dose requires a reason for NABH documentation (statReason)" });

    // Normalise today's date window (midnight → next midnight UTC)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(todayStart.getTime() + 86400000);

    const entry = {
      scheduledTime,
      scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : todayStart,
      status,
      givenAt:   givenAt ? new Date(givenAt) : (status === "given" ? new Date() : undefined),
      givenBy,   doseGiven, routeUsed, siteUsed, notes,
      verifiedBy, verifiedAt: verifiedBy ? new Date() : undefined,
      fiveRightsChecked: fiveRightsChecked || false,
      holdReason, holdUntil, delayedTo, delayReason,
      prnEffect, prnReassessTime,
      adverseEvent: adverseEvent || false, adverseDetails,
      isStatDose:  isStatDose  || false,
      statReason:  statReason  || undefined,
      nextDoseAdjustedAt: nextDoseAdjustedAt || undefined,
    };

    if (isStatDose) {
      // FIX (audit P14-B1): STAT idempotency — protect against a fat-fingered
      // double-click producing two STAT records 200ms apart with the same
      // nurse / drug. Window = 30 seconds, same nurse, same dose, same
      // status==given. Anything outside that we treat as a deliberate second
      // STAT (e.g. emergency repeat dose) and accept.
      if (status === "given") {
        const recentDuplicate = order.administrationRecord.find(r => {
          if (!r.isStatDose) return false;
          if (r.status !== "given") return false;
          if (r.givenBy !== givenBy) return false;
          if (!r.givenAt) return false;
          return (Date.now() - new Date(r.givenAt).getTime()) < 30_000;
        });
        if (recentDuplicate) {
          return res.status(409).json({
            ok: false,
            message: "Duplicate STAT dose ignored — same nurse already recorded one within 30 seconds",
            data: order,
          });
        }
      }
      // STAT doses are always NEW records — never overwrite a scheduled slot
      order.administrationRecord.push(entry);
    } else {
      // Regular: find existing entry for this scheduledTime AND today
      const existing = order.administrationRecord.find(r => {
        if (r.isStatDose) return false; // never overwrite a STAT record as a regular slot
        if (r.scheduledTime !== scheduledTime) return false;
        if (!r.scheduledDate) return false;
        const d = new Date(r.scheduledDate);
        return d >= todayStart && d < todayEnd;
      });
      if (existing) Object.assign(existing, entry);
      else order.administrationRecord.push(entry);
    }

    // Update order-level status — compute desired next status; the actual
    // mutation is done through moveStatus() so ALLOWED_TRANSITIONS + audit
    // emit fire uniformly.
    let nextStatus = null;
    if (status === "hold") nextStatus = "OnHold";
    if (status === "given") {
      // R7bq-K — Per workflow spec from user: a Medication order is
      // considered "system-complete" as soon as the FIRST non-STAT dose
      // is given. The remaining doses of the course continue to be
      // administered through the Treatment Chart (MAR), but the order
      // itself stops blocking the nurse's "active orders" queue once
      // it's been started. Rationale: the order is just the doctor's
      // instruction; the MAR is the running record. Subsequent doses
      // don't re-toggle the status — once Completed, stays Completed.
      //
      // IV_Fluid + other types keep the older "all doses terminal +
      // course window closed" logic because:
      //   - IV_Fluid is continuous; no "one dose" notion. Stops when
      //     the nurse explicitly stops or totalVolume is hit.
      //   - BloodTransfusion has its own pre/per/post protocol.
      //   - Lab / Procedure use the /step endpoint, not /administer.
      const isMedFirstDoseRule = order.orderType === "Medication" && !isStatDose;
      if (isMedFirstDoseRule) {
        nextStatus = "Completed";
      } else {
        const regularRecords = order.administrationRecord.filter(r => !r.isStatDose);
        // R7bq-J1 — include "missed" in the terminal set.
        const regularDone = regularRecords.length > 0
          && regularRecords.every(r => ["given","skipped","refused","missed"].includes(r.status));
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const courseWindowClosed = order.endDate
          ? new Date(order.endDate) <= startOfToday
          : true;
        if (regularDone && order.orderDetails?.frequency !== "Continuous" && courseWindowClosed) {
          nextStatus = "Completed";
        } else if (order.status !== "Completed") {
          // Don't downgrade from Completed (covers Medication path where a
          // later STAT or held-then-given dose comes through after the
          // first-dose-complete flip).
          nextStatus = "InProgress";
        }
      }
    }

    // STAT audit log
    if (isStatDose && status === "given") {
      order.auditLog.push({
        step: "STAT Dose Administered",
        doneBy: givenBy,
        doneAt: new Date(),
        notes: `STAT reason: ${statReason}${nextDoseAdjustedAt ? ` | Next dose adjusted to ${nextDoseAdjustedAt}` : ""}`,
      });
    }

    // Log adverse event
    if (adverseEvent) {
      order.auditLog.push({ step: "Adverse Event Reported", doneBy: givenBy, doneAt: new Date(), notes: adverseDetails || "Adverse drug reaction noted" });
    }

    // R7hr-12-S? (P0-1): route status mutation through moveStatus when there's
    // an actual transition. Otherwise just persist the auditLog / admin-record
    // edits via plain save().
    if (nextStatus && nextStatus !== order.status) {
      await moveStatus(order, nextStatus, { actor: req.user?._id || givenBy });
    } else {
      await order.save();
    }

    // ─── R7bq-3 — Auto I/O ledger: write an intake row when a dose is
    // GIVEN and the order carries a diluent volume. The service is
    // idempotent (upsert keyed on orderId + doseId), so re-runs of the
    // same scheduled slot won't double-count. Non-throwing — never
    // fails the administer call. NABH MOM.4 expects every infused
    // volume to be traceable to the order that drove it.
    if (status === "given" && order.orderDetails?.dilutionVolume > 0) {
      try {
        const ioService = require("../../services/Clinical/intakeOutputService");
        // Find the admin record we just pushed (last regular entry for
        // this scheduledTime + today, or the very last for STAT).
        const todayKey = new Date(); todayKey.setHours(0, 0, 0, 0);
        const adminRow = isStatDose
          ? order.administrationRecord[order.administrationRecord.length - 1]
          : order.administrationRecord
              .filter(r => !r.isStatDose
                && r.scheduledTime === scheduledTime
                && r.scheduledDate
                && new Date(r.scheduledDate).getTime() === todayKey.getTime())
              .pop();
        if (adminRow) {
          // doseId fallback — Mongoose subdoc _id should be present after
          // save, but in some edge cases (pre-existing rows updated in
          // place) the _id may not surface on the in-memory copy. Compose
          // a deterministic fallback key from (orderId, scheduledTime,
          // YYYY-MM-DD) so the partial unique index on the I/O ledger
          // doesn't collide across multiple doses of the same order.
          const doseIdFallback = `${order._id}_${scheduledTime}_${todayKey.toISOString().slice(0,10)}`;
          const doseIdStr = adminRow._id ? String(adminRow._id) : doseIdFallback;
          ioService.recordIntakeFromMAR({
            order,
            adminRow,
            doseId: doseIdStr,
          }).catch(e => { /* logged inside the service */ });
        }
      } catch (e) {
        // Service file failed to load — non-fatal.
        const { logErr } = require("../../utils/logErr");
        logErr("intakeOutput", "load failure on order.administer")(e);
      }
    }

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — INFUSION RATE CHANGE (NABH)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/infusion-rate
 * Body: { changedBy, oldRate, newRate, reason, reasonDetail?, verifiedBy?, doctorInformed?, doctorName? }
 */
router.post("/:id/infusion-rate", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const { changedBy, oldRate, newRate, reason, reasonDetail, verifiedBy, doctorInformed, doctorName } = req.body;
    if (!changedBy || !newRate || !reason)
      return res.status(400).json({ ok: false, message: "changedBy, newRate, reason required" });

    // FIX (audit P14-B3): rate values were accepted as raw strings —
    // "abc", "-5", "0" all sailed through. Strip units, coerce to number,
    // reject anything that isn't a positive finite value.
    const parseRate = (v) => {
      if (v === null || v === undefined) return NaN;
      const s = String(v).replace(/[^\d.\-]/g, "");
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const newRateNum = parseRate(newRate);
    if (!Number.isFinite(newRateNum) || newRateNum <= 0) {
      return res.status(400).json({ ok: false, message: `Invalid newRate: '${newRate}' — must be a positive number (ml/hr)` });
    }

    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    if (order.twoNurseRequired && !verifiedBy)
      return res.status(422).json({ ok: false, message: "HAM infusion rate change requires second nurse verification" });

    // B1-T05: When a witness (verifiedBy) is supplied — for HAM infusion
    // rate change — verify the actor is a real Nurse (ISMP two-nurse rule)
    // AND is not the same person changing the rate. Previously we only
    // checked presence — any user id (or none) passed.
    if (verifiedBy) {
      const wUser = await User.findById(verifiedBy).select("role employeeId fullName").lean();
      if (!wUser) {
        return res.status(400).json({ success: false, code: "VERIFIER_NOT_FOUND", message: "verifiedBy user not found" });
      }
      if (wUser.role !== "Nurse") {
        return res.status(400).json({ success: false, code: "VERIFIER_NOT_NURSE", message: "Witness must be a Nurse (ISMP)" });
      }
      if (String(wUser._id) === String(req.user.id)) {
        return res.status(400).json({ success: false, code: "VERIFIER_SAME_USER", message: "Witness must be different from acting nurse" });
      }
    }

    // R7bn-4 / D7-2-fix: doctorInformed defaults to true whenever a
    // doctorName is supplied AND the change is non-emergency. The audit
    // surfaced this flag as "exists but never set" — nurses adjusted
    // rates and the field stayed false forever. New behaviour: explicit
    // false is preserved; null/undefined + doctorName → assume informed.
    const informed = doctorInformed === undefined || doctorInformed === null
      ? !!doctorName
      : !!doctorInformed;
    const entry = { changedAt: new Date(), changedBy, oldRate: oldRate || order.currentRate, newRate, reason, reasonDetail, verifiedBy, doctorInformed: informed, doctorName };
    order.rateChanges.push(entry);
    order.currentRate = newRate;
    order.auditLog.push({ step: `Rate changed: ${oldRate || "—"} → ${newRate} ml/hr`, doneBy: changedBy, doneAt: new Date(), notes: `Reason: ${reason}${reasonDetail ? ` — ${reasonDetail}` : ""}${informed ? ` (doctor informed)` : " (DOCTOR NOT INFORMED — flag for follow-up)"}` });

    await order.save();

    // R7bn-1 / D9-fix: ClinicalAudit emit on infusion rate change.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "INFUSION_RATE_CHANGED",
        UHID: order.UHID,
        admissionId: order.admissionId,
        patientId: order.patientId,
        targetType: "DoctorOrder.infusion",
        targetId: order._id,
        before: { rate: oldRate || null },
        after: { rate: newRate, changedBy, reason, doctorInformed: informed, doctorName },
        reason: reasonDetail || reason,
      });
    } catch (_) { /* silent */ }

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — INFUSION MONITORING ENTRY (NABH)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/infusion-monitor
 * Body: { nurse, currentRate?, bp?, pulse?, spo2?, urineOutput?, volumeInfused?, siteCondition?, action?, remarks? }
 */
router.post("/:id/infusion-monitor", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const { nurse, currentRate, bp, pulse, spo2, urineOutput, volumeInfused, siteCondition, action, remarks } = req.body;
    if (!nurse) return res.status(400).json({ ok: false, message: "nurse required" });

    const entry = { time: new Date(), nurse, currentRate, bp, pulse, spo2, urineOutput, volumeInfused, siteCondition: siteCondition || "", action: action || "No Change", remarks };

    const order = await DoctorOrder.findByIdAndUpdate(
      req.params.id,
      { $push: { infusionMonitoring: entry } },
      { new: true }
    );
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   DOCTOR — ORDER ACTIONS (Stop / Hold / Resume / Modify / Substitute)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/doctor-action
 * Body: {
 *   type: "stop"|"hold"|"resume"|"modify"|"substitute",
 *   doneBy: String,                  // doctor name
 *   reason?: String,
 *   reasonDetail?: String,
 *   holdUntil?: String,              // for hold
 *   orderDetails?: Object,           // for modify — merged with existing
 *   substituteWith?: {               // for substitute
 *     medicineName, dose, route, frequency, duration, indication, notes
 *   }
 * }
 */
// R7hr-12-S? (P1-3): per-verb permission map. The route-level requireAction
// gate stays at 'order.stop' (loosest of the bunch — every doctor can stop an
// order) so the chain still rejects non-doctor roles upfront. Inside the
// handler we re-check the SPECIFIC permission for the requested verb via
// roleCan() — pre-fix all five verbs (stop/hold/resume/modify/substitute)
// shared a single 'order.stop' gate, so a role allowed to stop was implicitly
// allowed to modify or substitute even if permissions.js disagreed.
const ACTION_PERMS = {
  stop: "order.stop",
  hold: "order.hold",
  resume: "order.resume",
  modify: "order.modify",
  substitute: "order.substitute",
};
router.post("/:id/doctor-action", validateObjectIdParam("id"), requireAction("order.stop"), credentialExpiryBlocker("NMC_REG"), async (req, res) => {
  try {
    const { type, doneBy, reason, reasonDetail, holdUntil, orderDetails, substituteWith } = req.body;
    if (!type || !doneBy)
      return res.status(400).json({ ok: false, message: "type and doneBy required" });

    // R7hr-12-S? (P1-3): per-verb permission check. NOTE: this is defense-in-
    // depth on TOP of the route-level requireAction('order.stop') gate, not a
    // replacement — the route-level gate runs first to reject roles that have
    // no business in this endpoint at all. If permissions.js doesn't define a
    // specific verb (e.g. 'order.substitute' may not exist yet), the lookup
    // falls back to the route gate.
    const verbPerm = ACTION_PERMS[type];
    if (verbPerm && !roleCan(req.user?.role, verbPerm)) {
      return res.status(403).json({
        ok: false,
        message: `Access denied. Action '${verbPerm}' is not permitted for role '${req.user?.role}'.`,
        action: verbPerm,
        role: req.user?.role,
      });
    }

    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    let auditNote = reason || "";
    let newOrder  = null;
    let nextStatus = null;

    switch (type) {
      case "stop":
        if (!reason)
          return res.status(400).json({ ok: false, message: "reason required to stop/discontinue an order" });
        nextStatus           = "Stopped";
        order.stopReason     = reason;
        order.completedBy    = doneBy;
        order.completedAt    = new Date();
        auditNote = `Discontinued: ${reason}${reasonDetail ? ` — ${reasonDetail}` : ""}`;
        break;

      case "hold":
        if (!reason)
          return res.status(400).json({ ok: false, message: "reason required to hold an order" });
        nextStatus       = "OnHold";
        order.nurseNotes = `HOLD by Dr. ${doneBy}: ${reason}${holdUntil ? ` — hold until ${holdUntil}` : ""}`;
        auditNote = `Order held: ${reason}${holdUntil ? ` (until ${holdUntil})` : ""}`;
        break;

      case "resume":
        nextStatus = "InProgress";
        auditNote = `Order resumed by doctor${reason ? `: ${reason}` : ""}`;
        break;

      case "modify": {
        if (!orderDetails)
          return res.status(400).json({ ok: false, message: "orderDetails required for modify" });
        // R7hr-83 — drop ServiceMaster pick fields from the incoming patch if
        // this order's type can't map to a ServiceMaster row, before the merge.
        if (!SERVICE_MASTER_MAPPABLE_TYPES.has(order.orderType)) {
          for (const k of SERVICE_MASTER_PICK_KEYS) delete orderDetails[k];
        }
        // Merge new fields into existing orderDetails
        const existing = order.orderDetails.toObject ? order.orderDetails.toObject() : { ...order.orderDetails };
        order.orderDetails = { ...existing, ...orderDetails };
        // Re-evaluate HAM flag if drug name changed
        const name = orderDetails.medicineName || orderDetails.displayName || existing.medicineName || "";
        if (name) {
          order.hamFlag         = checkHAM(name);
          order.twoNurseRequired = order.hamFlag;
          order.highRisk        = order.hamFlag;
        }
        const changedFields = Object.keys(orderDetails).join(", ");
        auditNote = `Order modified [${changedFields}]: ${reason || "Doctor order"}${reasonDetail ? ` — ${reasonDetail}` : ""}`;
        break;
      }

      case "substitute": {
        // Step 1: Stop current order
        nextStatus        = "Stopped";
        order.stopReason  = `Substituted by: ${substituteWith?.medicineName || "new drug"}. ${reason || ""}`.trim();
        order.completedBy = doneBy;
        order.completedAt = new Date();
        auditNote = `Substituted — replaced by ${substituteWith?.medicineName || "new drug"}`;

        // Step 2: Create replacement order
        if (substituteWith?.medicineName) {
          const today = new Date(); today.setHours(0,0,0,0);
          const newName = substituteWith.medicineName;
          const hamNew  = checkHAM(newName);

          // R7hr-12-S? (P1-3): route substitute through the SAME 30s dedup
          // pipeline that POST / uses. Pre-fix a substitute could create a
          // duplicate of an existing recent order because the dedup logic
          // only fired on POST /. Mirror the dedup keys (UHID, orderType,
          // medicineName, dose, frequency, route, dilutionVolume) and 409
          // if a recent identical order already exists.
          if (order.orderType === "Medication" || order.orderType === "IV_Fluid") {
            const since = new Date(Date.now() - 30_000);
            const dup = await DoctorOrder.findOne({
              UHID: order.UHID,
              orderType: order.orderType,
              "orderDetails.medicineName": substituteWith.medicineName,
              "orderDetails.dose":         substituteWith.dose,
              "orderDetails.frequency":    substituteWith.frequency,
              "orderDetails.route":        substituteWith.route,
              "orderDetails.dilutionVolume": substituteWith.dilutionVolume,
              status: { $nin: ["Cancelled","Stopped"] },
              orderedAt: { $gte: since },
            }).select("_id orderedAt orderDetails.medicineName").lean();
            if (dup) {
              return res.status(409).json({
                ok: false,
                code: "DUPLICATE_ORDER",
                duplicateId: String(dup._id),
                message: `Substitution refused — an identical ${dup.orderDetails?.medicineName || order.orderType} order was placed ${Math.round((Date.now() - new Date(dup.orderedAt).getTime())/1000)}s ago.`,
              });
            }
          }

          const FREQ_TIMES_MAP = {
            "OD":["08:00"],"BD":["08:00","20:00"],"TDS":["08:00","14:00","20:00"],
            "QID":["06:00","12:00","18:00","00:00"],"Q8H":["06:00","14:00","22:00"],
            "Q12H":["08:00","20:00"],"STAT":["Immediate"],"SOS":["As Needed"],
            "HS":["22:00"],"Continuous":["Continuous"],
          };
          const times = FREQ_TIMES_MAP[substituteWith.frequency] || ["08:00"];
          newOrder = await DoctorOrder.create({
            UHID: order.UHID, patientName: order.patientName, visitId: order.visitId,
            visitType: order.visitType,
            // R7bv — carry the parent order's admission linkage onto the
            // substitution so the aggregator surfaces it under the same
            // IPD patient file.
            admissionId: order.admissionId, ipdNo: order.ipdNo, admissionNumber: order.admissionNumber,
            patientId: order.patientId,
            orderType: order.orderType,
            priority: substituteWith.priority || "Routine",
            hamFlag: hamNew, twoNurseRequired: hamNew, highRisk: hamNew,
            orderDetails: { ...substituteWith, notes: (substituteWith.notes || "") + ` [Substituted for: ${order.orderDetails?.medicineName || "previous order"}]` },
            orderedBy: doneBy, orderedByRole: "Doctor",
            status: "Pending",
            administrationRecord: times.filter(t => t !== "Immediate" && t !== "As Needed" && t !== "Continuous")
              .map(t => ({ scheduledTime: t, scheduledDate: today, status: "pending" })),
            auditLog: [{ step: "Order created (substitution)", doneBy, doneAt: new Date(), notes: `Substituted for order ${order._id}` }],
          });
        }
        break;
      }

      default:
        return res.status(400).json({ ok: false, message: `Unknown action type: ${type}` });
    }

    order.auditLog.push({ step: `doctor:${type}`, doneBy, doneAt: new Date(), notes: auditNote });

    // R7hr-12-S? (P0-1): status transitions flow through moveStatus so the
    // ALLOWED_TRANSITIONS matrix + ClinicalAudit emit fire uniformly. Modify
    // doesn't change status, so just save() the field updates directly.
    if (nextStatus && nextStatus !== order.status) {
      await moveStatus(order, nextStatus, { actor: req.user?._id || doneBy, reason });
    } else {
      await order.save();
    }

    res.json({ ok: true, data: order, newOrder: newOrder || undefined });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   SEED DEMO DATA — for testing NABH compliance
═══════════════════════════════════════════════════ */
/**
 * POST /seed-demo
 * Body: { UHID, patientName, visitId, createdBy }
 * Creates a realistic set of medication + infusion orders for demo
 */
// R7m: Demo seeder is intentionally gated to Admin so a logged-in
// receptionist or nurse can't inject fake orders into the system in
// production.
router.post("/seed-demo", adminOnly, async (req, res) => {
  try {
    // R7hr-12-S? (P2-6): hard-block the demo seeder in production. Even with
    // adminOnly, a logged-in Admin could accidentally inject fake orders
    // into the live patient file. The seeder is for staging / training only.
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ ok: false, error: "seed-demo disabled in production" });
    }
    const { UHID, patientName, visitId, createdBy = "Dr. Demo" } = req.body;
    if (!UHID) return res.status(400).json({ ok: false, message: "UHID required" });

    const today = new Date(); today.setHours(0,0,0,0);
    const now   = new Date();

    const DEMO_ORDERS = [
      // ── Medications ──
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Amoxicillin + Clavulanate", dose: "625mg", route: "PO", frequency: "BD", duration: "5 days", indication: "Community acquired pneumonia — prophylaxis", notes: "Give after food" },
        scheduledTimes: ["08:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000 + 5*60000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true, notes: "Patient tolerated well" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Paracetamol", dose: "500mg", route: "PO", frequency: "TDS", duration: "3 days", indication: "Fever and pain", notes: "SOS if temp > 100°F" },
        scheduledTimes: ["08:00","14:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true },
          { scheduledTime: "14:00", scheduledDate: today, status: "hold", holdReason: "Patient afebrile — temp 98.4°F, not required", givenBy: "Sr. Meena Devi" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "STAT",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 2),
        orderDetails: { medicineName: "Inj. Pantoprazole", dose: "40mg", route: "IV", frequency: "OD", duration: "5 days", indication: "GI prophylaxis", dilution: "NS 0.9%", totalVolume: "100", notes: "Dilute in 100ml NS, give over 15 min" },
        scheduledTimes: ["08:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Kavita R.", verifiedBy: "Sr. Meena Devi", fiveRightsChecked: true, notes: "Diluted in 100ml NS, infused over 15 min" },
        ],
        status: "InProgress",
      },
      {
        // HAM — Insulin
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        hamFlag: true, twoNurseRequired: true, highRisk: true,
        orderDetails: { medicineName: "Inj. Insulin (Regular)", dose: "10 Units", route: "SC", frequency: "OD", duration: "Daily — sliding scale", indication: "T2DM — fasting hyperglycaemia", notes: "Give 30 min before breakfast. BSL check mandatory before administration" },
        scheduledTimes: ["07:30"],
        administrationRecord: [
          { scheduledTime: "07:30", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 7.5*3600000), givenBy: "Sr. Priya Sharma", verifiedBy: "Sr. Meena Devi", fiveRightsChecked: true, notes: "BSL: 186 mg/dL pre-dose. Patient cooperative" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Atorvastatin", dose: "40mg", route: "PO", frequency: "HS", duration: "Continue", indication: "Dyslipidaemia — on long-term therapy", notes: "Give at bedtime with water" },
        scheduledTimes: ["22:00"],
        administrationRecord: [{ scheduledTime: "22:00", scheduledDate: today, status: "pending" }],
        status: "Pending",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Urgent",
        orderedBy: createdBy, orderedAt: new Date(now - 1800000),
        orderDetails: { medicineName: "Inj. Ondansetron", dose: "4mg", route: "IV", frequency: "TDS", duration: "2 days", indication: "Post-operative nausea/vomiting", notes: "Slow IV push over 5 min" },
        scheduledTimes: ["08:00","14:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "not_available", holdReason: "Out of stock — pharmacy indent placed. ETA 2 hours", givenBy: "Sr. Kavita R." },
          { scheduledTime: "14:00", scheduledDate: today, status: "pending" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      // ── IV Fluids / Infusions ──
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "IV_Fluid", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 8),
        orderDetails: { medicineName: "NS 0.9%", displayName: "NS 0.9% 500ml", dose: "500ml", route: "IV Infusion", frequency: "Q8H", duration: "24 hours", rate: "62", totalVolume: "500", titrationGoal: "Adequate hydration — urine output > 30 ml/hr", notes: "Through 18G cannula — right forearm" },
        scheduledTimes: ["06:00","14:00","22:00"],
        currentRate: "62",
        rateChanges: [
          { changedAt: new Date(now - 3600000 * 4), changedBy: "Sr. Priya Sharma", oldRate: "62", newRate: "50", reason: "Fluid overload", reasonDetail: "Pedal oedema noted — rate reduced per protocol", doctorInformed: true, doctorName: createdBy },
          { changedAt: new Date(now - 3600000 * 1), changedBy: "Sr. Meena Devi", oldRate: "50", newRate: "62", reason: "Doctor order", reasonDetail: "Oedema resolved — resumed standard rate", doctorInformed: false },
        ],
        infusionMonitoring: [
          { time: new Date(now - 3600000 * 6), nurse: "Sr. Priya Sharma", currentRate: "62", bp: "124/80", pulse: "86", spo2: "97", urineOutput: "35", siteCondition: "Patent", action: "No Change", remarks: "Infusion running well" },
          { time: new Date(now - 3600000 * 4), nurse: "Sr. Priya Sharma", currentRate: "50", bp: "128/84", pulse: "88", spo2: "96", urineOutput: "20", siteCondition: "Patent", action: "Rate Decreased", remarks: "Bilateral pedal oedema +1 noted. Rate reduced to 50 ml/hr. Dr. notified" },
          { time: new Date(now - 3600000 * 2), nurse: "Sr. Meena Devi", currentRate: "62", bp: "122/78", pulse: "82", spo2: "98", urineOutput: "40", siteCondition: "Patent", action: "Rate Increased", remarks: "Oedema resolved. Rate restored per doctor order" },
        ],
        status: "InProgress",
      },
      {
        // HAM — Noradrenaline infusion
        UHID, patientName, visitId, visitType: "IPD", orderType: "IV_Fluid", priority: "Urgent",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 5),
        hamFlag: true, twoNurseRequired: true, highRisk: true,
        orderDetails: { medicineName: "Noradrenaline", displayName: "Inj. Noradrenaline (HAM ⚠)", dose: "4mg", route: "IV Infusion", dilution: "4mg in 50ml NS (80 mcg/ml)", frequency: "Continuous", rate: "3", totalVolume: "50", titrationGoal: "Target MAP > 65 mmHg", notes: "Titrate 0.5–1 ml/hr every 5–10 min. Mandatory vitals Q30 min. MUST run through central line only" },
        currentRate: "3",
        rateChanges: [
          { changedAt: new Date(now - 3600000 * 4), changedBy: "Sr. Meena Devi", oldRate: "2", newRate: "3", reason: "Haemodynamic instability", reasonDetail: "MAP dropped to 58 — increased per titration protocol. Dr. informed", verifiedBy: "Sr. Priya Sharma", doctorInformed: true, doctorName: createdBy },
        ],
        infusionMonitoring: [
          { time: new Date(now - 3600000 * 4.5), nurse: "Sr. Meena Devi", currentRate: "2", bp: "86/52", pulse: "104", spo2: "95", urineOutput: "12", siteCondition: "Patent", action: "Rate Increased", remarks: "MAP 55 — rate increased to 3ml/hr. Dr. notified. Patient semi-conscious" },
          { time: new Date(now - 3600000 * 3.5), nurse: "Sr. Priya Sharma", currentRate: "3", bp: "94/60", pulse: "98", spo2: "96", urineOutput: "18", siteCondition: "Patent", action: "No Change", remarks: "MAP improving. Continue monitoring Q30 min" },
          { time: new Date(now - 3600000 * 2.5), nurse: "Sr. Meena Devi", currentRate: "3", bp: "102/68", pulse: "92", spo2: "97", urineOutput: "28", siteCondition: "Patent", action: "No Change", remarks: "MAP 79 — target achieved. Continue current rate" },
        ],
        status: "InProgress",
      },
    ];

    // Clear existing demo data.
    // R7hr-12-S? (P2-6, deferred): IDEALLY we would tag every seeded row with
    // `isDemo: true` and `deleteMany({ isDemo: true })` so the deletion is
    // self-scoped regardless of `orderedBy`. The DoctorOrder schema has no
    // `isDemo` field yet (sibling agent owns the model), and Mongoose strict
    // mode would silently drop the field on insert AND on the deleteMany
    // query — which would make deleteMany match EVERY row. So we keep the
    // legacy `orderedBy: "Dr. Demo"` scope here and hand the flag work to a
    // schema follow-up.
    await DoctorOrder.deleteMany({ UHID, orderedBy: "Dr. Demo" });
    const created = await DoctorOrder.insertMany(DEMO_ORDERS, { ordered: false });

    // R7hr-12-S? (P2-6): audit-trail the demo seed so a surveyor inspecting
    // the clinical audit collection can immediately distinguish demo data
    // from real orders. Non-blocking — never fail the seed call.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "SEED_DEMO",
        UHID,
        patientName,
        targetType: "DoctorOrder",
        after: { count: created.length, orderedBy: createdBy, env: process.env.NODE_ENV || "unknown" },
      });
    } catch (_) { /* silent */ }

    res.status(201).json({ ok: true, message: `${created.length} demo orders created`, data: created });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// DELETE /:id — cancel order
// R7hr-12-S? (P1-1, P0-1): hardened.
//   - cancelReason is now mandatory (NABH MOM.6 traceability).
//   - Status transition flows through moveStatus() so the
//     ALLOWED_TRANSITIONS matrix + ClinicalAudit emit fire (pre-fix used
//     findByIdAndUpdate which bypassed the pre-save guard).
router.delete("/:id", validateObjectIdParam("id"), requireAction("doctor-orders.write"), async (req, res) => {
  try {
    const cancelReason = (req.body && typeof req.body.cancelReason === "string")
      ? req.body.cancelReason.trim()
      : "";
    if (!cancelReason) {
      return res.status(400).json({ ok: false, error: "cancelReason is required (NABH MOM.6 — every cancellation needs a documented reason)" });
    }
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    await moveStatus(order, "Cancelled", { actor: req.user?._id, reason: cancelReason });
    res.json({ ok: true, order });
  } catch (err) {
    res.status(err?.status || 500).json({ ok: false, message: err.message, code: err?.code });
  }
});

module.exports = router;
