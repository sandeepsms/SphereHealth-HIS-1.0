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
  static async updatePrescriptionByUHID(uhid, data) {
    const p = await Prescription.findOneAndUpdate(
      { UHID: uhid },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!p) throw new Error("Prescription not found");
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

    for (const inv of prescription.investigations) {
      let invId = inv.investigationId;

      if (!invId) {
        const found = await InvestigationMaster.findOne({
          $or: [
            {
              investigationName: {
                $regex: `^${inv.investigationName}$`,
                $options: "i",
              },
            },
            {
              shortName: {
                $regex: `^${inv.investigationName}$`,
                $options: "i",
              },
            },
          ],
          isActive: true,
        });
        if (found) invId = found._id;
      }

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

      const master = await InvestigationMaster.findById(invId);
      const pricing = await InvestigationPricing.getPriceFor(
        invId,
        paymentType,
        tpaId,
      );

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
