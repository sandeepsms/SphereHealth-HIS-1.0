const Billing = require("../../models/Billing/billingModel");
const Prescription = require("../../models/Doctor/prescription");
const HospitalCharges = require("../../models/charges/HospitalChargesModel");
const TPAServices = require("../../models/tpa/TPAServicesModel");
const Patient = require("../../models/Patient/patientModel");

class BillingService {
  /**
   * 🎯 Main Function: Create Bill from Prescription
   * 🔥 FIX: Only add ESSENTIAL charges, not all TPA charges
   */
  async createFromPrescription(prescriptionId) {
    const prescription = await Prescription.findById(prescriptionId)
      .populate("patient")
      .populate("doctor")
      .populate("investigations");

    if (!prescription) {
      throw new Error("Prescription not found");
    }

    const patient = await Patient.findById(prescription.patient._id).populate(
      "tpa",
    );

    if (!patient) {
      throw new Error("Patient not found");
    }

    const tpaId = patient.tpa?._id || null;
    const tpaName = patient.tpa?.tpaName || "Normal";
    const tpaCode = patient.tpa?.tpaCode || "NORMAL";

    // Fetch Hospital Charges for reference
    const hospitalCharges = await this._getHospitalCharges(tpaId, tpaName);

    // 🔥 FIX: Only add ESSENTIAL charges based on registration type
    const selectedCharges = this._mapEssentialCharges(
      hospitalCharges,
      prescription.registrationType,
    );

    // 🔥 FIX: Properly map investigations from prescription
    const investigations = await this._mapInvestigationsFromPrescription(
      prescription,
      tpaId,
      tpaName,
    );

    console.log("📋 Prescription Details:", {
      registrationType: prescription.registrationType,
      investigationsCount: prescription.investigations?.length || 0,
    });
    console.log("💊 Mapped Investigations:", investigations.length);
    console.log("🏥 Essential Charges:", selectedCharges.length);

    const billing = new Billing({
      patient: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName,
      prescription: prescriptionId,
      tpa: tpaId,
      tpaName: tpaName,
      tpaCode: tpaCode,
      billingType: prescription.registrationType || "OPD",
      hospitalChargesRef: hospitalCharges?._id,
      selectedCharges, // Only essential charges
      investigations, // All prescribed investigations
      status: "draft",
    });

    await billing.save();
    return billing;
  }

  async _getHospitalCharges(tpaId, tpaName) {
    let hospitalCharges;

    if (tpaId && tpaName !== "Normal") {
      hospitalCharges = await HospitalCharges.findOne({
        tpa: tpaId,
        isActive: true,
      });
    }

    if (!hospitalCharges) {
      hospitalCharges = await HospitalCharges.findOne({
        tpaName: "Normal",
        isActive: true,
      });
    }

    return hospitalCharges;
  }

  /**
   * 🔥 FIX: Only add ESSENTIAL charges, not all charges
   * Essential charges are mandatory for each registration type
   */
  _mapEssentialCharges(hospitalCharges, registrationType) {
    if (!hospitalCharges?.charges || hospitalCharges.charges.length === 0) {
      return [];
    }

    const essentialCharges = [];

    hospitalCharges.charges.forEach((charge) => {
      let isEssential = false;

      // Only add charges that are ESSENTIAL (mandatory) for this registration type
      if (registrationType === "OPD" && charge.chargeType === "OPD") {
        isEssential = true; // OPD registration fee is essential
      }

      if (
        registrationType === "Emergency" &&
        charge.chargeType === "EMERGENCY"
      ) {
        isEssential = true; // Emergency fee is essential
      }

      // For IPD, NO charges are automatically added
      // User must manually select which charges to add (bed, nursing, etc.)

      if (isEssential) {
        essentialCharges.push({
          chargeId: charge._id?.toString(),
          chargeName: charge.chargeName,
          chargeType: charge.chargeType,
          baseAmount: charge.amount || 0,
          discount: charge.discount || 0,
          finalAmount: charge.totalAmount || charge.amount,
          perUnit: charge.perUnit || "one time",
          quantity: 1,
          isActive: true,
        });
      }
    });

    console.log("✅ Essential charges added:", essentialCharges.length);
    return essentialCharges;
  }

  /**
   * 🔥 COMPLETELY REWRITTEN: Map investigations from prescription properly
   * prescription.investigations is an array of TPAServices references
   */
  async _mapInvestigationsFromPrescription(prescription, tpaId, tpaName) {
    if (
      !prescription.investigations ||
      prescription.investigations.length === 0
    ) {
      console.log("⚠️ No investigations in prescription");
      return [];
    }

    const investigations = [];

    console.log(
      "📋 Processing investigations:",
      prescription.investigations.length,
    );

    // prescription.investigations contains TPAServices document IDs
    for (const investigationRef of prescription.investigations) {
      try {
        // Get the TPAServices ID (handle both populated and non-populated)
        let tpaServiceId = investigationRef._id || investigationRef;

        console.log("🔍 Looking up TPAServices ID:", tpaServiceId);

        // Find the TPAServices document
        let tpaService = await TPAServices.findById(tpaServiceId);

        if (!tpaService) {
          console.log("❌ TPAServices not found for ID:", tpaServiceId);
          continue;
        }

        console.log("✅ Found TPAServices:", {
          id: tpaService._id,
          tpaName: tpaService.tpaName,
          serviceCount: tpaService.service?.length || 0,
        });

        // 🔥 If patient has TPA, try to find TPA-specific pricing
        if (tpaId && tpaName !== "Normal") {
          const tpaSpecificServices = await TPAServices.find({
            tpa: tpaId,
            isActive: true,
          });

          console.log(
            `🎯 Found ${tpaSpecificServices.length} TPA-specific service groups`,
          );

          // Try to find matching services in TPA-specific groups
          if (tpaService.service && Array.isArray(tpaService.service)) {
            for (const originalService of tpaService.service) {
              let serviceAdded = false;

              // Search for this service in TPA-specific groups
              for (const tpaSpecificGroup of tpaSpecificServices) {
                if (
                  tpaSpecificGroup.service &&
                  Array.isArray(tpaSpecificGroup.service)
                ) {
                  const matchingService = tpaSpecificGroup.service.find(
                    (s) =>
                      s.Name?.toLowerCase() ===
                      originalService.Name?.toLowerCase(),
                  );

                  if (matchingService) {
                    // Use TPA-specific pricing
                    investigations.push({
                      serviceRef: tpaSpecificGroup._id,
                      serviceName: matchingService.Name,
                      baseAmount: matchingService.Amount || 0,
                      discount: matchingService.Discount || 0,
                      finalAmount:
                        matchingService.Totalamount || matchingService.Amount,
                      performedInHouse: true,
                      isActive: true,
                      outsideDetails: {},
                    });

                    console.log("💰 Added with TPA pricing:", {
                      name: matchingService.Name,
                      amount: matchingService.Amount,
                      discount: matchingService.Discount,
                    });

                    serviceAdded = true;
                    break;
                  }
                }
              }

              // If no TPA-specific pricing found, use original pricing
              if (!serviceAdded) {
                investigations.push({
                  serviceRef: tpaService._id,
                  serviceName: originalService.Name,
                  baseAmount: originalService.Amount || 0,
                  discount: originalService.Discount || 0,
                  finalAmount:
                    originalService.Totalamount || originalService.Amount,
                  performedInHouse: true,
                  isActive: true,
                  outsideDetails: {},
                });

                console.log("💵 Added with Normal pricing:", {
                  name: originalService.Name,
                  amount: originalService.Amount,
                });
              }
            }
          }
        } else {
          // Normal patient - use standard pricing
          if (tpaService.service && Array.isArray(tpaService.service)) {
            tpaService.service.forEach((service) => {
              investigations.push({
                serviceRef: tpaService._id,
                serviceName: service.Name,
                baseAmount: service.Amount || 0,
                discount: service.Discount || 0,
                finalAmount: service.Totalamount || service.Amount,
                performedInHouse: true,
                isActive: true,
                outsideDetails: {},
              });

              console.log("💵 Added Normal investigation:", {
                name: service.Name,
                amount: service.Amount,
              });
            });
          }
        }
      } catch (error) {
        console.error("❌ Error processing investigation:", error);
        continue;
      }
    }

    console.log("✅ Total investigations mapped:", investigations.length);
    return investigations;
  }

  /**
   * 🆕 NEW METHOD: Add additional charges manually
   * This allows users to add optional charges after bill creation
   */
  async addChargeToExistingBill(billId, chargeData) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status !== "draft") {
      throw new Error("Can only add charges to draft bills");
    }

    // Add the charge
    bill.selectedCharges.push({
      chargeId: chargeData.chargeId,
      chargeName: chargeData.chargeName,
      chargeType: chargeData.chargeType,
      baseAmount: chargeData.baseAmount,
      discount: chargeData.discount || 0,
      finalAmount: chargeData.finalAmount,
      perUnit: chargeData.perUnit || "one time",
      quantity: chargeData.quantity || 1,
      isActive: true,
    });

    await bill.save();
    return bill;
  }

  /**
   * 🆕 NEW METHOD: Remove charge from bill
   */
  async removeChargeFromBill(billId, chargeIndex) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status !== "draft") {
      throw new Error("Can only modify draft bills");
    }

    bill.selectedCharges.splice(chargeIndex, 1);
    await bill.save();
    return bill;
  }

  /**
   * 🆕 NEW METHOD: Get available charges for this bill's TPA
   * Returns all charges that can be added manually
   */
  async getAvailableCharges(billId) {
    const bill = await Billing.findById(billId).populate("hospitalChargesRef");

    if (!bill) {
      throw new Error("Bill not found");
    }

    const hospitalCharges = bill.hospitalChargesRef;

    if (!hospitalCharges?.charges) {
      return [];
    }

    // Filter charges based on billing type
    return hospitalCharges.charges.filter((charge) => {
      if (bill.billingType === "OPD") {
        return ["OPD", "DRESSING", "INJECTION", "OTHER"].includes(
          charge.chargeType,
        );
      }
      if (bill.billingType === "IPD") {
        return [
          "IPD_BED",
          "ICU_BED",
          "NURSE",
          "DOCTOR_VISIT",
          "OPERATION_THEATER",
          "DRESSING",
          "INJECTION",
          "OTHER",
        ].includes(charge.chargeType);
      }
      if (bill.billingType === "Emergency") {
        return ["EMERGENCY", "AMBULANCE", "DRESSING", "INJECTION"].includes(
          charge.chargeType,
        );
      }
      return false;
    });
  }

  async toggleInvestigation(
    billId,
    investigationId,
    performInHouse,
    outsideDetails,
  ) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    const investigation = bill.investigations.id(investigationId);

    if (!investigation) {
      throw new Error("Investigation not found");
    }

    if (performInHouse) {
      investigation.performedInHouse = true;
      investigation.isActive = true;
      investigation.outsideDetails = {};
    } else {
      investigation.performedInHouse = false;
      investigation.isActive = false;
      investigation.outsideDetails = {
        reason: outsideDetails?.reason || "Patient preference",
        suggestedLab: outsideDetails?.suggestedLab || "",
        estimatedCost:
          outsideDetails?.estimatedCost || investigation.finalAmount,
      };
    }

    await bill.save();
    return bill;
  }

  async getBillById(billId) {
    const bill = await Billing.findById(billId)
      .populate("patient", "fullName UHID contactNumber gender age")
      .populate("prescription")
      .populate("tpa", "tpaName tpaCode phone email")
      .populate("hospitalChargesRef");

    if (!bill) {
      throw new Error("Bill not found");
    }

    return bill;
  }

  async updateBill(billId, updateData) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status === "paid") {
      throw new Error("Cannot update a paid bill");
    }

    if (updateData.selectedCharges) {
      bill.selectedCharges = updateData.selectedCharges;
    }

    if (updateData.investigations) {
      bill.investigations = updateData.investigations;
    }

    if (updateData.additionalItems) {
      bill.additionalItems = updateData.additionalItems;
    }

    if (updateData.financials) {
      bill.financials = { ...bill.financials, ...updateData.financials };
    }

    if (updateData.notes) {
      bill.notes = updateData.notes;
    }

    await bill.save();
    return bill;
  }

  async generateBill(billId) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status !== "draft") {
      throw new Error("Bill already generated");
    }

    await bill.generateBillNumber();
    await bill.save();

    return bill;
  }

  async addPayment(billId, paymentData) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.status === "cancelled") {
      throw new Error("Cannot add payment to cancelled bill");
    }

    if (paymentData.amount > bill.financials.balance) {
      throw new Error(
        `Payment amount cannot exceed balance of ₹${bill.financials.balance}`,
      );
    }

    await bill.addPayment({
      amount: paymentData.amount,
      method: paymentData.method || "Cash",
      transactionId: paymentData.transactionId || "",
      status: paymentData.status || "success",
    });

    return bill;
  }

  async getAllBills(filters = {}, page = 1, limit = 20) {
    const query = {};

    if (filters.UHID) {
      query.UHID = new RegExp(filters.UHID, "i");
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.patientName) {
      query.patientName = new RegExp(filters.patientName, "i");
    }

    if (filters.billNumber) {
      query.billNumber = new RegExp(filters.billNumber, "i");
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        query.createdAt.$lte = new Date(filters.endDate);
      }
    }

    const skip = (page - 1) * limit;

    const [bills, total] = await Promise.all([
      Billing.find(query)
        .populate("patient", "fullName UHID contactNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Billing.countDocuments(query),
    ]);

    return {
      bills,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async cancelBill(billId, reason) {
    const bill = await Billing.findById(billId);

    if (!bill) {
      throw new Error("Bill not found");
    }

    bill.cancel(reason);
    await bill.save();

    return bill;
  }

  async getBillStats(filters = {}) {
    const matchQuery = {};

    if (filters.startDate || filters.endDate) {
      matchQuery.createdAt = {};
      if (filters.startDate)
        matchQuery.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate)
        matchQuery.createdAt.$lte = new Date(filters.endDate);
    }

    const stats = await Billing.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$financials.total" },
          totalPaid: { $sum: "$financials.paid" },
          totalBalance: { $sum: "$financials.balance" },
        },
      },
    ]);

    const summary = {
      total: 0,
      paid: 0,
      partial: 0,
      draft: 0,
      cancelled: 0,
      totalRevenue: 0,
      totalCollected: 0,
      totalPending: 0,
    };

    stats.forEach((stat) => {
      summary.total += stat.count;
      summary[stat._id] = stat.count;
      summary.totalRevenue += stat.totalAmount;
      summary.totalCollected += stat.totalPaid;
      summary.totalPending += stat.totalBalance;
    });

    return summary;
  }
}

module.exports = new BillingService();
