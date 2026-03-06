// services/billingService.js
// ═══════════════════════════════════════════════════════════════
// BILLING SERVICE LAYER
// Sabhi billing business logic yahan hai
// Controllers sirf call karenge — koi bhi DB query ya logic
// controller mein nahi hogi
// ═══════════════════════════════════════════════════════════════

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Admission = require("../../models/Patient/admissionModel");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const AutoBilledItems = require("../../models/PatientBillModel/AutoBilledItemsModel");

class BillingService {
  // ── 1. Patient + all bills by UHID ───────────────────────────
  async getPatientWithBills(UHID) {
    const Patient = require("../..models/Patient/patientModel");

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
    const Patient = require("../..models/Patient/patientModel");

    // Pehle existing DRAFT dhundho
    const query = { UHID, visitType, billStatus: "DRAFT" };
    if (admissionId) query.admission = admissionId;

    let bill = await PatientBill.findOne(query);
    if (bill) return bill;

    // Patient ka tariff type determine karo
    const patient = await Patient.findOne({ UHID }).populate("tpa");
    if (!patient) throw new Error(`Patient not found: ${UHID}`);

    const billData = {
      patient: patient._id,
      UHID,
      visitType,
      paymentType: patient.tpa ? "TPA" : "CASH",
      tpa: patient.tpa?._id || null,
      tpaName: patient.tpa?.tpaName || null,
      billItems: [],
    };

    if (admissionId) {
      const adm = await Admission.findById(admissionId);
      if (adm) {
        billData.admission = admissionId;
        billData.admissionNumber = adm.admissionNumber;
      }
    }

    bill = new PatientBill(billData);
    await bill.save();
    return bill;
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

  // ── 4. Get draft bill (populated) for a new/existing session ──
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
  // Pricing fetch → TPA split calculate → item add → save
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

    // Correct tariff fetch karo (TPA → fallback to CASH if not configured)
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

    // TPA split: TPA kitna dega, patient kitna dega
    let tpaPayableAmount = 0;
    if (bill.paymentType === "TPA") {
      tpaPayableAmount = pricing?.tpaApprovedLimit
        ? Math.min(pricing.tpaApprovedLimit * quantity, lineTotal)
        : lineTotal; // Limit nahi hai → TPA full amount dega
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
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (["PAID", "CANCELLED"].includes(bill.billStatus)) {
      throw new Error("Cannot modify a PAID or CANCELLED bill");
    }

    const item = bill.billItems.id(itemId);
    if (!item) throw new Error("Bill item not found");

    item.quantity = quantity;
    await bill.save();
    return bill;
  }

  // ── 9. Generate final bill (DRAFT → GENERATED) ────────────────
  async generateFinalBill(billId, generatedBy = "Staff") {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (bill.billStatus !== "DRAFT")
      throw new Error("Only DRAFT bills can be generated");
    if (!bill.billItems || bill.billItems.length === 0) {
      throw new Error("Cannot generate empty bill — pehle services add karo");
    }

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
    if (bill.billStatus === "PAID") throw new Error("Bill already fully paid");

    bill.payments.push({
      amount,
      paymentMode,
      transactionId,
      receivedBy,
      remarks,
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
  // Aaj ka revenue, pending bills, TPA claims
  async getBillingSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, pendingCount, paidToday, tpaPending] = await Promise.all(
      [
        PatientBill.countDocuments({ billDate: { $gte: today } }),
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
  // Room category se service codes map → AutoBilledItems records
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

  // ── 14. Daycare time check + auto-convert to IPD ──────────────
  async checkAndHandleDaycareConversion(admissionId) {
    const admission = await Admission.findById(admissionId);
    if (!admission || admission.admissionType !== "DAYCARE") return null;

    const hours = admission.totalHoursAdmitted;
    const exceeded = hours > admission.daycareMaxHours;

    if (exceeded && !admission.isConvertedToIPD) {
      admission.isConvertedToIPD = true;
      admission.convertedToIPDAt = new Date();
      admission.conversionReason = `Exceeded ${admission.daycareMaxHours}hr daycare limit`;
      await admission.save();

      // Open draft bills ko bhi IPD mein convert karo
      await PatientBill.updateMany(
        { admission: admissionId, billStatus: "DRAFT" },
        { $set: { visitType: "IPD" } },
      );

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

  // ── 15. Daily auto-charge cron job ────────────────────────────
  // Har raat cron is method ko call karta hai
  // Sabhi admitted patients ke liye room rent + nursing daily bill mein add hota hai
  async runDailyAutoCharges() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Aaj jo bhi bill nahi hue woh sab do
    const items = await AutoBilledItems.find({
      isActive: true,
      $or: [{ lastBilledDate: null }, { lastBilledDate: { $lt: today } }],
    }).populate("admission");

    const results = [];

    for (const item of items) {
      try {
        // Patient discharged ho gaya → auto-charge band
        if (!item.admission || item.admission.status !== "ADMITTED") {
          item.isActive = false;
          await item.save();
          results.push({
            UHID: item.UHID,
            service: item.serviceName,
            status: "stopped",
          });
          continue;
        }

        const bill = await this.getOrCreateDraftBill(
          item.UHID,
          item.admission.admissionType,
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
        results.push({
          UHID: item.UHID,
          service: item.serviceName,
          status: "error",
          error: err.message,
        });
      }
    }

    return { processed: results.length, results };
  }
}

module.exports = new BillingService();
