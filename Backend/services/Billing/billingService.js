// services/billingService.js
const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Admission = require("../../models/Patient/admissionModel");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const AutoBilledItems = require("../../models/PatientBillModel/AutoBilledItemsModel");

async function generateBillNumber() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `BILL-${dateStr}-`;
  const count = await PatientBill.countDocuments({
    billNumber: { $regex: `^${prefix}` },
  });
  const serial = String(count + 1).padStart(5, "0");
  return `${prefix}${serial}`;
}

class BillingService {
  // ── 1. Patient + all bills by UHID ───────────────────────────
  async getPatientWithBills(UHID) {
    const Patient = require("../../models/Patient/patientModel");

    const [bills, patient] = await Promise.all([
      this.getBillsByUHID(UHID),
      Patient.findOne({ UHID })
        .populate("tpa", "tpaName tpaCode")
        .populate("department", "departmentName")
        .populate("doctor", "personalInfo"),
    ]);

    if (!patient) throw new Error(`Patient not found: ${UHID}`);
    return { patient, bills };
  }

  // ── 2. Get existing DRAFT bill or create new one ──────────────
  async getOrCreateDraftBill(UHID, visitType, admissionId = null) {
    const Patient = require("../../models/Patient/patientModel");

    const patient = await Patient.findOne({ UHID }).populate("tpa");
    if (!patient) throw new Error(`Patient not found: ${UHID}`);

    const filter = { UHID, visitType, billStatus: "DRAFT" };
    if (admissionId) filter.admission = admissionId;

    let bill = await PatientBill.findOne(filter);
    if (bill) return bill;

    const billData = {
      patient: patient._id,
      UHID,
      visitType,
      paymentType: patient.tpa ? "TPA" : "CASH",
      tpa: patient.tpa?._id || null,
      tpaName: patient.tpa?.tpaName || null,
      billStatus: "DRAFT",
      billItems: [],
    };

    if (admissionId) {
      const adm = await Admission.findById(admissionId);
      if (adm) {
        billData.admission = admissionId;
        billData.admissionNumber = adm.admissionNumber;
      }
    }

    try {
      bill = new PatientBill(billData);
      await bill.save();
      return bill;
    } catch (err) {
      if (err.code === 11000) {
        const existing = await PatientBill.findOne(filter);
        if (existing) return existing;
      }
      throw err;
    }
  }

  // ── 3. Get single bill (fully populated) ─────────────────────
  async getBillById(billId) {
    const bill = await PatientBill.findById(billId)
      .populate("patient")
      .populate("tpa")
      .populate("admission")
      .populate("billItems.serviceId");

    if (!bill) throw new Error("Bill not found");
    return bill;
  }

  // ── 4. Get draft bill (populated) ────────────────────────────
  async getDraftBillPopulated(UHID, visitType, admissionId) {
    const bill = await this.getOrCreateDraftBill(UHID, visitType, admissionId);
    return PatientBill.findById(bill._id)
      .populate("patient", "fullName title UHID contactNumber gender tpa")
      .populate("tpa", "tpaName tpaCode")
      .populate("admission");
  }

  // ── 5. All bills for a UHID ───────────────────────────────────
  async getBillsByUHID(UHID) {
    return PatientBill.find({ UHID })
      .populate("patient", "fullName title contactNumber gender dateOfBirth")
      .populate("tpa", "tpaName tpaCode")
      .populate(
        "admission",
        "admissionNumber bedNumber roomCategory status admissionDateTime",
      )
      .sort({ createdAt: -1 });
  }

  // ── 6. Add service to bill ────────────────────────────────────
  async addServiceToBill(
    billId,
    serviceId,
    quantity = 1,
    chargeDate = new Date(),
    remarks = "",
  ) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (["PAID", "CANCELLED"].includes(bill.billStatus)) {
      throw new Error("Cannot modify a PAID or CANCELLED bill");
    }

    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");

    const pricing = await ServicePricing.getPriceFor(
      serviceId,
      bill.paymentType,
      bill.tpa,
    );

    const unitPrice = pricing ? pricing.finalPrice : service.defaultPrice;
    const grossAmount = unitPrice * quantity;
    const discountPct = pricing?.discount || 0;
    const discountAmt = (grossAmount * discountPct) / 100;
    const netAmount = grossAmount - discountAmt;
    const taxAmount = service.isTaxable
      ? (netAmount * (service.taxPercentage || 0)) / 100
      : 0;
    const lineTotal = netAmount + taxAmount;

    let tpaPayableAmount = 0;
    if (bill.paymentType === "TPA") {
      tpaPayableAmount = pricing?.tpaApprovedLimit
        ? Math.min(pricing.tpaApprovedLimit * quantity, lineTotal)
        : lineTotal;
    }

    bill.billItems.push({
      serviceId: service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      category: service.category,
      billingType: service.billingType,
      quantity,
      unitPrice,
      grossAmount,
      discountPercent: discountPct,
      discountAmount: discountAmt,
      netAmount,
      tpaPayableAmount,
      patientPayableAmount: lineTotal - tpaPayableAmount,
      isTaxable: service.isTaxable,
      taxPercent: service.taxPercentage || 0,
      taxAmount,
      appliedTariff: bill.paymentType,
      chargeDate,
      remarks,
    });

    await bill.save();
    return bill;
  }

  // ── 7. Remove item from bill ──────────────────────────────────
  async removeItemFromBill(billId, itemId) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (["PAID", "CANCELLED"].includes(bill.billStatus)) {
      throw new Error("Cannot modify a PAID or CANCELLED bill");
    }

    bill.billItems = bill.billItems.filter(
      (i) => i._id.toString() !== itemId.toString(),
    );
    await bill.save();
    return bill;
  }

  // ── 8. Update item quantity ───────────────────────────────────
  async updateItemQuantity(billId, itemId, quantity) {
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");

    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (["PAID", "CANCELLED"].includes(bill.billStatus)) {
      throw new Error("Cannot modify a PAID or CANCELLED bill");
    }

    const item = bill.billItems.id(itemId);
    if (!item) throw new Error("Bill item not found");

    item.quantity = quantity;
    item.grossAmount = item.unitPrice * quantity;
    item.discountAmount =
      (item.grossAmount * (item.discountPercent || 0)) / 100;
    item.netAmount = item.grossAmount - item.discountAmount;
    item.taxAmount = item.isTaxable
      ? (item.netAmount * (item.taxPercent || 0)) / 100
      : 0;
    const lineTotal = item.netAmount + item.taxAmount;

    if (bill.paymentType === "TPA") {
      const tpaLimit = item.tpaApprovedLimitPerUnit
        ? item.tpaApprovedLimitPerUnit * quantity
        : lineTotal;
      item.tpaPayableAmount = Math.min(tpaLimit, lineTotal);
      item.patientPayableAmount = lineTotal - item.tpaPayableAmount;
    } else {
      item.tpaPayableAmount = 0;
      item.patientPayableAmount = lineTotal;
    }

    await bill.save();
    return bill;
  }

  // ── 9. Generate final bill (DRAFT → GENERATED) ────────────────
  async generateFinalBill(billId, generatedBy = "Staff") {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (bill.billStatus !== "DRAFT") {
      throw new Error("Only DRAFT bills can be generated");
    }
    if (!bill.billItems || bill.billItems.length === 0) {
      throw new Error("Cannot generate empty bill — pehle services add karo");
    }

    bill.billNumber = await generateBillNumber();
    bill.billStatus = "GENERATED";
    bill.billGeneratedAt = new Date();
    bill.generatedBy = generatedBy;

    if (bill.paymentType === "TPA") {
      bill.tpaClaimStatus = "PENDING";
    }

    await bill.save();
    return bill;
  }

  // ── 10. Record payment ────────────────────────────────────────
  async recordPayment(
    billId,
    { amount, paymentMode, transactionId, receivedBy, remarks },
  ) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");

    if (bill.billStatus === "DRAFT") {
      throw new Error(
        "Bill abhi DRAFT hai — pehle generateFinalBill() karo, tab payment lo",
      );
    }
    if (bill.billStatus === "PAID") throw new Error("Bill already fully paid");
    if (bill.billStatus === "CANCELLED")
      throw new Error("Cancelled bill pe payment nahi ho sakti");
    if (!amount || amount <= 0) throw new Error("Valid amount required");

    bill.payments.push({
      amount,
      paymentMode,
      transactionId,
      receivedBy,
      remarks,
      paidAt: new Date(),
    });

    const totalPaid = bill.payments.reduce((s, p) => s + p.amount, 0);
    bill.advancePaid = totalPaid;
    bill.balanceAmount = Math.max(0, bill.patientPayableAmount - totalPaid);
    bill.billStatus = bill.balanceAmount === 0 ? "PAID" : "PARTIAL";
    if (bill.billStatus === "PAID") bill.paidAt = new Date();

    await bill.save();
    return bill;
  }

  // ── 11. Update TPA claim status ───────────────────────────────
  async updateTPAClaimStatus(billId, { status, claimNumber, approvedAmount }) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");

    bill.tpaClaimStatus = status;
    if (claimNumber) bill.tpaClaimNumber = claimNumber;
    if (approvedAmount) bill.tpaApprovedAmount = approvedAmount;
    await bill.save();
    return bill;
  }

  // ── 12. Billing dashboard summary ────────────────────────────
  async getBillingSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, pendingCount, paidToday, tpaPending] = await Promise.all(
      [
        PatientBill.countDocuments({ createdAt: { $gte: today } }),
        PatientBill.countDocuments({
          billStatus: { $in: ["GENERATED", "PARTIAL"] },
        }),
        PatientBill.aggregate([
          { $match: { billStatus: "PAID", paidAt: { $gte: today } } },
          { $group: { _id: null, total: { $sum: "$advancePaid" } } },
        ]),
        PatientBill.countDocuments({
          paymentType: "TPA",
          tpaClaimStatus: "PENDING",
        }),
      ],
    );

    return {
      todayBills: todayCount,
      pendingBills: pendingCount,
      todayRevenue: paidToday[0]?.total || 0,
      tpaPending,
    };
  }

  // ── 13. Setup daily auto-charges on admission ─────────────────
  async setupAutoChargesForAdmission(admission, patient) {
    const ROOM_MAP = {
      GENERAL_WARD: { room: "IPD-RM-001", nursing: "IPD-NUR-001" },
      SEMI_PRIVATE: { room: "IPD-RM-002", nursing: "IPD-NUR-001" },
      PRIVATE: { room: "IPD-RM-003", nursing: "IPD-NUR-002" },
      DELUXE: { room: "IPD-RM-004", nursing: "IPD-NUR-002" },
      SUITE: { room: "IPD-RM-005", nursing: "IPD-NUR-003" },
      ICU: { room: "IPD-ICU-001", nursing: "IPD-ICU-005" },
      DAYCARE_BED: { room: "IPD-RM-008", nursing: null },
      EMERGENCY_BED: { room: "ER-OBS-001", nursing: "ER-NUR-001" },
    };

    const mapping =
      ROOM_MAP[admission.roomCategory] || ROOM_MAP["GENERAL_WARD"];
    const codes = [mapping.room, mapping.nursing].filter(Boolean);
    const tariff = patient.tpa ? "TPA" : "CASH";

    for (const code of codes) {
      const service = await ServiceMaster.findOne({
        serviceCode: code,
        isActive: true,
      });
      if (!service) continue;

      const alreadyExists = await AutoBilledItems.findOne({
        admission: admission._id,
        service: service._id,
        isActive: true,
      });
      if (alreadyExists) continue;

      const pricing = await ServicePricing.getPriceFor(
        service._id,
        tariff,
        patient.tpa?._id,
      );
      const unitPrice = pricing ? pricing.finalPrice : service.defaultPrice;

      await AutoBilledItems.create({
        admission: admission._id,
        admissionNumber: admission.admissionNumber,
        UHID: admission.UHID,
        patient: admission.patient,
        service: service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        billingType: "PER_DAY",
        unitPrice,
        startDate: admission.admissionDateTime,
        appliedTariff: tariff,
        tpaId: patient.tpa?._id || null,
      });
    }
  }

  // ── 14. Daycare → IPD conversion ──────────────────────────────
  async checkAndHandleDaycareConversion(admissionId) {
    const admission = await Admission.findById(admissionId).populate("patient");
    if (!admission || admission.admissionType !== "DAYCARE") return null;

    const hours = admission.totalHoursAdmitted;
    const exceeded = hours > admission.daycareMaxHours;

    if (exceeded && !admission.isConvertedToIPD) {
      admission.isConvertedToIPD = true;
      admission.convertedToIPDAt = new Date();
      admission.conversionReason = `Exceeded ${admission.daycareMaxHours}hr daycare limit`;
      admission.admissionType = "IPD";
      await admission.save();

      await PatientBill.updateMany(
        { admission: admissionId, billStatus: "DRAFT" },
        { $set: { visitType: "IPD" } },
      );

      await AutoBilledItems.updateMany(
        { admission: admissionId, isActive: true },
        { $set: { isActive: false } },
      );

      if (admission.patient) {
        const Patient = require("../../models/Patient/patientModel");
        const patient = await Patient.findById(admission.patient).populate(
          "tpa",
        );
        if (patient)
          await this.setupAutoChargesForAdmission(admission, patient);
      }

      return {
        converted: true,
        hours,
        message: `Patient converted to IPD after ${hours} hours`,
      };
    }

    return {
      converted: false,
      hours,
      remaining: Math.max(0, admission.daycareMaxHours - hours),
    };
  }

  // ── 16. Add a charge via nurse ────────────────────────────────
  // Validates that the service has chargeableBy: ["Nurse"] before adding
  async addNurseCharge(billId, serviceId, quantity, { nurseName, shift, remarks } = {}) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (!["DRAFT", "GENERATED"].includes(bill.billStatus)) {
      throw new Error("Bill is closed");
    }

    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");
    if (!service.chargeableBy?.includes("Nurse")) {
      throw new Error("This service cannot be added by nursing staff");
    }

    const pricing = await ServicePricing.getPriceFor(
      serviceId,
      bill.paymentType,
      bill.tpa?.toString(),
    );
    const unitPrice = pricing?.finalPrice ?? service.defaultPrice ?? 0;
    const gross = unitPrice * (quantity || 1);

    const item = {
      serviceId: service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      category: service.category,
      billingType: service.billingType,
      quantity: quantity || 1,
      unitPrice,
      grossAmount: gross,
      discountPercent: 0,
      discountAmount: 0,
      netAmount: gross,
      tpaPayableAmount: bill.paymentType === "TPA" ? gross : 0,
      patientPayableAmount: bill.paymentType === "TPA" ? 0 : gross,
      chargeDate: new Date(),
      appliedTariff: bill.paymentType,
      remarks: remarks || `Added by nurse: ${shift || ""}`,
      addedBySource: "Nurse",
      addedBy: nurseName || "Nursing Staff",
      addedByRole: "Nurse",
    };

    bill.billItems.push(item);
    await bill.save();
    return bill;
  }

  // ── 17. Get services a nurse can add ─────────────────────────
  async getNurseChargeableServices(patientType = "IPD") {
    const services = await ServiceMaster.find({
      isActive: true,
      chargeableBy: "Nurse",
      $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
    })
      .select(
        "_id serviceName serviceCode category serviceType defaultPrice billingType aiTags applicableTo",
      )
      .lean();
    return services;
  }

  // ── 15. Daily auto-charge cron job ────────────────────────────
  async runDailyAutoCharges() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = await AutoBilledItems.find({
      isActive: true,
      $or: [{ lastBilledDate: null }, { lastBilledDate: { $lt: today } }],
    }).populate("admission");

    const results = [];
    const failed = [];

    // Map Admission.admissionType → PatientBill.visitType enum
    // (enum: ["OPD","IPD","DAYCARE","EMERGENCY"]).
    const admTypeToVisitType = {
      "Planned":   "IPD",
      "Transfer":  "IPD",
      "Emergency": "EMERGENCY",
      "Day Care":  "DAYCARE",
      "Daycare":   "DAYCARE",
      "OPD":       "OPD",
      "Services":  "OPD",
    };

    for (const item of items) {
      try {
        // Admission.status enum is ["Active","Discharged","Transferred","Cancelled"].
        // The legacy check against "ADMITTED" stopped EVERY active admission's
        // daily auto-charges on the first cron run.
        if (!item.admission || item.admission.status !== "Active") {
          item.isActive = false;
          await item.save();
          results.push({
            UHID: item.UHID,
            service: item.serviceName,
            status: "stopped",
          });
          continue;
        }

        const visitType = admTypeToVisitType[item.admission.admissionType] || "IPD";
        const bill = await this.getOrCreateDraftBill(
          item.UHID,
          visitType,
          item.admission._id,
        );

        await this.addServiceToBill(
          bill._id,
          item.service,
          1,
          new Date(),
          "Auto-charged daily",
        );

        item.lastBilledDate = new Date();
        item.lastBilledBillId = bill._id;
        item.totalBilledCount += 1;
        item.totalBilledAmount += item.unitPrice;
        await item.save();

        results.push({
          UHID: item.UHID,
          service: item.serviceName,
          status: "billed",
        });
      } catch (err) {
        const failEntry = {
          UHID: item.UHID,
          service: item.serviceName,
          status: "error",
          error: err.message,
        };
        results.push(failEntry);
        failed.push(failEntry);
      }
    }

    return {
      processed: results.length,
      successCount: results.filter((r) => r.status === "billed").length,
      failedCount: failed.length,
      failed,
      results,
    };
  }
}

module.exports = new BillingService();
