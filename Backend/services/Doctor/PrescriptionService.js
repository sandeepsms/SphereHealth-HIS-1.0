const Prescription = require("../../models/Doctor/prescription");
const Patient = require("../../models/Patient/patientModel");
const Doctor = require("../../models/Doctor/doctorModel");
const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");
const mongoose = require("mongoose");

class PrescriptionService {
  // ── CREATE ────────────────────────────────────────────────────
  static async createPrescription(data) {
    const { patient, UHID, doctor, ...rest } = data;

    // Fetch patient
    let patientData;
    if (patient && mongoose.Types.ObjectId.isValid(patient)) {
      patientData = await Patient.findById(patient);
    } else if (UHID) {
      patientData = await Patient.findOne({ UHID: UHID.toUpperCase() });
    }
    if (!patientData) throw new Error("Patient not found");

    // Fetch doctor
    const doctorData = await Doctor.findById(doctor);
    if (!doctorData) throw new Error("Doctor not found");

    const doctorName = [
      doctorData.personalInfo?.firstName,
      doctorData.personalInfo?.lastName,
    ]
      .filter(Boolean)
      .join(" ");

    // Create prescription
    const prescription = await Prescription.create({
      patient: patientData._id,
      UHID: patientData.UHID,
      patientName: patientData.fullName || patientData.name,
      age: patientData.age,
      gender: patientData.gender,
      contactNumber: patientData.contactNumber,
      fatherName: patientData.fatherName || "",
      doctor: doctorData._id,
      doctorName: `Dr. ${doctorName}`,
      ...rest,
    });

    // Auto-create lab order if investigations present
    if (prescription.investigations?.length > 0) {
      const labOrderIds = await PrescriptionService._createLabOrder(
        prescription,
        patientData,
        doctorData,
      );
      if (labOrderIds.length > 0) {
        await Prescription.findByIdAndUpdate(prescription._id, {
          $set: { labOrderIds },
        });
      }
    }

    return PrescriptionService._populate(prescription._id);
  }

  // ── UPDATE BY UHID ────────────────────────────────────────────
  // Audit log added per A-11 — every prescription edit needs a before/
  // after snapshot in PatientActivityLog so a NABH reviewer can replay
  // the chain. The actor info comes from the controller as `data.actor`
  // (req.user); we strip it before writing to Mongo so it doesn't
  // pollute the prescription doc.
  static async updatePrescriptionByUHID(uhid, data) {
    const { actor, ...payload } = data || {};

    const before = await Prescription.findOne({ UHID: uhid }).lean();
    if (!before) throw new Error("Prescription not found");

    const p = await Prescription.findOneAndUpdate(
      { UHID: uhid },
      { $set: payload },
      { new: true, runValidators: true },
    );
    if (!p) throw new Error("Prescription not found");

    // Fire-and-forget audit log — never block the clinical write even if
    // the log path is down. The PatientActivityLog hash-chain in the
    // model still detects tampering after the fact.
    try {
      const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");
      await PatientActivityLog.create({
        UHID: uhid,
        action: "PRESCRIPTION_UPDATE",
        module: "Prescription",
        summary: `Prescription updated by ${actor?.name || actor?.role || "System"}`,
        userId:   actor?.id   || null,
        userName: actor?.name || "System",
        userRole: actor?.role || "System",
        before,
        after: p.toObject(),
      });
    } catch (e) {
      console.error("[PrescriptionService] audit-log write failed:", e.message);
    }

    return PrescriptionService._populate(p._id);
  }

  // ── GET ALL ───────────────────────────────────────────────────
  static async getAllPrescriptions(filters = {}) {
    const q = { isActive: true };
    if (filters.patient) q.patient = filters.patient;
    if (filters.UHID) q.UHID = filters.UHID.toUpperCase();
    if (filters.doctor) q.doctor = filters.doctor;
    if (filters.registrationType) q.registrationType = filters.registrationType;
    if (filters.status) q.status = filters.status;
    if (filters.fromDate || filters.toDate) {
      q.prescriptionDate = {};
      if (filters.fromDate)
        q.prescriptionDate.$gte = new Date(filters.fromDate);
      if (filters.toDate) q.prescriptionDate.$lte = new Date(filters.toDate);
    }
    return Prescription.find(q)
      .populate("patient", "fullName name UHID age gender contactNumber")
      .populate("doctor", "personalInfo professional")
      .populate("labOrderIds", "orderNumber orderStatus")
      .sort({ prescriptionDate: -1 });
  }

  // ── GET BY ID ─────────────────────────────────────────────────
  static async getPrescriptionById(id) {
    const p = await PrescriptionService._populate(id);
    if (!p || !p.isActive) throw new Error("Prescription not found");
    return p;
  }

  // ── GET BY UHID ───────────────────────────────────────────────
  static async getPrescriptionByUHID(uhid) {
    const p = await Prescription.findOne({ UHID: uhid })
      .populate("patient")
      .populate("doctor")
      .populate(
        "investigations.investigationId",
        "investigationName investigationCode defaultPrice performedAt",
      )
      .populate("labOrderIds", "orderNumber orderStatus totalAmount");
    if (!p || !p.isActive) throw new Error("Prescription not found");
    return p;
  }

  // ── GET BY PATIENT ────────────────────────────────────────────
  static async getPrescriptionsByPatient(id) {
    const q = { isActive: true };
    if (mongoose.Types.ObjectId.isValid(id)) q.patient = id;
    else q.UHID = id.toUpperCase();
    return Prescription.find(q)
      .populate("patient", "fullName name UHID age gender")
      .populate("doctor", "personalInfo")
      .populate("labOrderIds", "orderNumber orderStatus")
      .sort({ prescriptionDate: -1 });
  }

  // ── GET BY DOCTOR ─────────────────────────────────────────────
  static async getPrescriptionsByDoctor(doctorId) {
    return Prescription.find({ doctor: doctorId, isActive: true })
      .populate("patient", "fullName name UHID age gender")
      .populate("labOrderIds", "orderNumber orderStatus")
      .sort({ prescriptionDate: -1 });
  }

  // ── UPDATE BY ID ──────────────────────────────────────────────
  static async updatePrescription(id, data) {
    const p = await Prescription.findOne({ _id: id, isActive: true });
    if (!p) throw new Error("Prescription not found");
    delete data.patient;
    delete data.doctor;
    delete data.UHID;
    return Prescription.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    })
      .populate("patient", "fullName name UHID age gender")
      .populate("doctor", "personalInfo");
  }

  // ── DELETE ────────────────────────────────────────────────────
  static async deletePrescription(id) {
    const p = await Prescription.findByIdAndUpdate(
      id,
      { isActive: false, status: "Cancelled" },
      { new: true },
    );
    if (!p) throw new Error("Prescription not found");
    return p;
  }

  // ── UPDATE STATUS ─────────────────────────────────────────────
  static async updatePrescriptionStatus(id, status) {
    const valid = ["Active", "Completed", "Cancelled", "FINAL"];
    if (!valid.includes(status)) throw new Error("Invalid status");
    const p = await Prescription.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    )
      .populate("patient", "fullName name UHID")
      .populate("doctor", "personalInfo");
    if (!p) throw new Error("Prescription not found");
    return p;
  }

  // ── STATS ─────────────────────────────────────────────────────
  static async getPrescriptionStats(filters = {}) {
    const match = { isActive: true };
    if (filters.doctor)
      match.doctor = new mongoose.Types.ObjectId(filters.doctor);
    if (filters.fromDate || filters.toDate) {
      match.prescriptionDate = {};
      if (filters.fromDate)
        match.prescriptionDate.$gte = new Date(filters.fromDate);
      if (filters.toDate)
        match.prescriptionDate.$lte = new Date(filters.toDate);
    }
    const stats = await Prescription.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalPrescriptions: { $sum: 1 },
          opdCount: {
            $sum: { $cond: [{ $eq: ["$registrationType", "OPD"] }, 1, 0] },
          },
          ipdCount: {
            $sum: { $cond: [{ $eq: ["$registrationType", "IPD"] }, 1, 0] },
          },
          emergencyCount: {
            $sum: {
              $cond: [{ $eq: ["$registrationType", "Emergency"] }, 1, 0],
            },
          },
          daycareCount: {
            $sum: { $cond: [{ $eq: ["$registrationType", "Daycare"] }, 1, 0] },
          },
          withInvestigations: {
            $sum: { $cond: [{ $gt: [{ $size: "$investigations" }, 0] }, 1, 0] },
          },
        },
      },
    ]);
    return (
      stats[0] || {
        totalPrescriptions: 0,
        opdCount: 0,
        ipdCount: 0,
        emergencyCount: 0,
        daycareCount: 0,
        withInvestigations: 0,
      }
    );
  }

  // ── CHECK CREATE OR UPDATE ────────────────────────────────────
  static async checkCreateOrUpdate(uhid) {
    const p = await Prescription.findOne({
      UHID: uhid.toUpperCase(),
      isActive: true,
    }).sort({ createdAt: -1 });
    return { exists: !!p, prescription: p };
  }

  // ── PRIVATE: Populate ─────────────────────────────────────────
  static _populate(id) {
    return Prescription.findById(id)
      .populate("patient", "fullName UHID age gender contactNumber")
      .populate("doctor", "personalInfo professional")
      .populate("labOrderIds", "orderNumber orderStatus totalAmount")
      .populate(
        "investigations.investigationId",
        "investigationName investigationCode defaultPrice performedAt sampleType",
      );
  }

  // ── PRIVATE: Auto-create lab order ───────────────────────────
  static async _createLabOrder(prescription, patientData, doctorData) {
    const labOrderIds = [];
    const paymentType = patientData.tpa ? "TPA" : "CASH";
    const tpaId = patientData.tpa?._id || patientData.tpa || null;
    const items = [];

    // ── Batch 1: resolve unknown investigationName → invId in a single query
    //    (was N+1 — one InvestigationMaster.findOne per investigation).
    const namesToLookup = prescription.investigations
      .filter((inv) => !inv.investigationId && inv.investigationName)
      .map((inv) => inv.investigationName);

    const nameToMaster = new Map();
    if (namesToLookup.length) {
      const escaped = namesToLookup.map((n) =>
        n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      const foundList = await InvestigationMaster.find({
        isActive: true,
        $or: escaped.flatMap((p) => [
          { investigationName: { $regex: `^${p}$`, $options: "i" } },
          { shortName:         { $regex: `^${p}$`, $options: "i" } },
        ]),
      });
      for (const reqName of namesToLookup) {
        const lc = reqName.toLowerCase();
        const m = foundList.find(
          (f) =>
            f.investigationName?.toLowerCase() === lc ||
            f.shortName?.toLowerCase() === lc,
        );
        if (m) nameToMaster.set(reqName, m);
      }
    }

    // Resolve each investigation to a (possibly-null) invId.
    const resolved = prescription.investigations.map((inv) => ({
      inv,
      invId:
        inv.investigationId ||
        nameToMaster.get(inv.investigationName)?._id ||
        null,
    }));

    // ── Batch 2: fetch ALL InvestigationMaster docs in one query, and resolve
    //    pricing in parallel (was N+1 + N — one findById + one getPriceFor
    //    per investigation, sequentially).
    const knownIds = resolved.map((r) => r.invId).filter(Boolean);
    const uniqIds = [...new Set(knownIds.map(String))];

    const [mastersList, pricings] = await Promise.all([
      uniqIds.length
        ? InvestigationMaster.find({ _id: { $in: uniqIds } })
        : Promise.resolve([]),
      Promise.all(
        uniqIds.map((id) =>
          InvestigationPricing.getPriceFor(id, paymentType, tpaId),
        ),
      ),
    ]);
    const masterById = new Map(mastersList.map((m) => [String(m._id), m]));
    const pricingById = new Map(uniqIds.map((id, i) => [id, pricings[i]]));

    for (const { inv, invId } of resolved) {
      if (!invId) {
        items.push({
          investigationId: new mongoose.Types.ObjectId(),
          investigationName: inv.investigationName,
          investigationCode: "MANUAL",
          category: "OTHER",
          performedAt: "INTERNAL",
          chargedPrice: inv.chargedPrice || 0,
          tariffType: paymentType,
          sampleStatus: "PENDING",
          resultStatus: "PENDING",
        });
        continue;
      }

      const master = masterById.get(String(invId));
      const pricing = pricingById.get(String(invId));

      items.push({
        investigationId: invId,
        investigationCode: master?.investigationCode || "MANUAL",
        investigationName: inv.investigationName,
        category: master?.category || "OTHER",
        sampleType: master?.sampleType || "",
        performedAt:
          master?.performedAt === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
        chargedPrice: pricing ? pricing.finalPrice : master?.defaultPrice || 0,
        tariffType: paymentType,
        tpaApprovedLimit: pricing?.tpaApprovedLimit || null,
        sampleStatus: master?.performedAt === "EXTERNAL" ? "N/A" : "PENDING",
        resultStatus: "PENDING",
      });
    }

    if (!items.length) return labOrderIds;

    const doctorName = [
      doctorData.personalInfo?.firstName,
      doctorData.personalInfo?.lastName,
    ]
      .filter(Boolean)
      .join(" ");

    const order = await InvestigationOrder.create({
      prescriptionId: prescription._id,
      patientId: patientData._id,
      UHID: patientData.UHID,
      patientName: patientData.fullName || patientData.name,
      contactNumber: patientData.contactNumber,
      visitType:
        prescription.registrationType === "Emergency"
          ? "EMERGENCY"
          : prescription.registrationType === "Daycare"
            ? "DAYCARE"
            : prescription.registrationType || "OPD",
      doctorId: doctorData._id,
      doctorName: `Dr. ${doctorName}`,
      doctorNote: prescription.clinicalDetails?.historyOfPresentIllness || "",
      orderedBy: "DOCTOR",
      paymentType,
      tpaId,
      items,
      priority: "ROUTINE",
      orderStatus: "PENDING",
      actionLog: [
        {
          action: "ORDER_CREATED",
          performedBy: `Dr. ${doctorName}`,
          performedAt: new Date(),
          remarks: "Auto-created from prescription",
        },
      ],
    });

    labOrderIds.push(order._id);
    return labOrderIds;
  }
}

module.exports = PrescriptionService;
