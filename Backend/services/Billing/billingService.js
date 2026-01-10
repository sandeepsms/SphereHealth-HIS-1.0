const Billing = require("../../models/billing/billingModel");
const Admission = require("../../models/Patient/admissionModel");
const Patient = require("../../models/Patient/patientModel");

class BillingService {
  async createBill(billData) {
    const admission = await Admission.findById(billData.admission);
    if (!admission) {
      throw new Error("Admission not found");
    }
    const patient = await Patient.findById(billData.patient);
    if (!patient) {
      throw new Error("Patient not found");
    }

    const admissionDate = new Date(
      billData.admissionDate || admission.admissionDate
    );
    const dischargeDate = new Date(
      billData.dischargeDate || admission.actualDischargeDate
    );
    const totalDays =
      Math.ceil((dischargeDate - admissionDate) / (1000 * 60 * 60 * 24)) || 1;

    const newBillData = {
      ...billData,
      admissionDate,
      dischargeDate,
      totalDays,
      generatedDate: new Date(),
    };

    const bill = new Billing(newBillData);
    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(bill._id);
  }

  async getAllBills(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.patient) query.patient = filters.patient;
    if (filters.admission) query.admission = filters.admission;
    if (filters.billStatus) query.billStatus = filters.billStatus;

    const bills = await Billing.find(query)
      .populate("patient", "fullName UHID contactNumber")
      .populate("admission", "admissionNumber department")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Billing.countDocuments(query);

    return {
      bills,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getBillById(id) {
    const bill = await Billing.findById(id)
      .populate("patient", "fullName UHID contactNumber age gender")
      .populate(
        "admission",
        "admissionNumber department admissionDate actualDischargeDate"
      );

    if (!bill) {
      throw new Error("Bill not found");
    }

    return bill;
  }

  async getBillByNumber(billNumber) {
    const bill = await Billing.findOne({ billNumber })
      .populate("patient", "fullName UHID contactNumber age gender")
      .populate(
        "admission",
        "admissionNumber department admissionDate actualDischargeDate"
      );

    if (!bill) {
      throw new Error("Bill not found");
    }

    return bill;
  }

  async getBillByAdmission(admissionId) {
    const bill = await Billing.findOne({ admission: admissionId })
      .populate("patient", "fullName UHID contactNumber age gender")
      .populate(
        "admission",
        "admissionNumber department admissionDate actualDischargeDate"
      );

    return bill;
  }

  async updateBill(id, updateData) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot update paid bill");
    }

    Object.assign(bill, updateData);
    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async addService(id, service) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot add service to paid bill");
    }

    const serviceData = {
      serviceName: service.serviceName,
      quantity: service.quantity || 1,
      pricePerUnit: service.pricePerUnit,
      total: (service.quantity || 1) * service.pricePerUnit,
      addedDate: new Date(),
    };

    bill.additionalServices.push(serviceData);
    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async addInvestigation(id, investigation) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot add investigation to paid bill");
    }

    bill.investigations.push({
      investigationName: investigation.investigationName,
      charges: investigation.charges,
      performedDate: investigation.performedDate || new Date(),
    });

    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async addMedication(id, medication) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot add medication to paid bill");
    }

    bill.medications.push({
      medicationName: medication.medicationName,
      quantity: medication.quantity,
      pricePerUnit: medication.pricePerUnit,
      total: medication.quantity * medication.pricePerUnit,
    });

    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async addProcedure(id, procedure) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot add procedure to paid bill");
    }

    bill.procedures.push({
      procedureName: procedure.procedureName,
      charges: procedure.charges,
      performedDate: procedure.performedDate || new Date(),
    });

    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async applyDiscount(id, discountAmount) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot apply discount to paid bill");
    }

    if (discountAmount < 0 || discountAmount > bill.subtotal) {
      throw new Error("Invalid discount amount");
    }

    bill.discount = discountAmount;
    bill.recalculateTotals();
    await bill.save();

    return await this.getBillById(id);
  }

  async addPayment(id, paymentData) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Cancelled") {
      throw new Error("Cannot add payment to cancelled bill");
    }

    if (paymentData.amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    if (paymentData.amount > bill.balanceDue) {
      throw new Error("Payment amount exceeds balance due");
    }

    bill.addPayment(paymentData);
    await bill.save();

    return await this.getBillById(id);
  }

  async cancelBill(id) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot cancel paid bill");
    }

    bill.billStatus = "Cancelled";
    await bill.save();

    return await this.getBillById(id);
  }

  async getPendingBills() {
    return await Billing.find({ billStatus: "Draft" })
      .populate("patient", "fullName UHID")
      .populate("admission", "admissionNumber department")
      .sort({ createdAt: -1 });
  }

  async getPaidBills() {
    return await Billing.find({ billStatus: "Paid" })
      .populate("patient", "fullName UHID")
      .populate("admission", "admissionNumber department")
      .sort({ createdAt: -1 });
  }

  async getPatientBills(patientId) {
    return await Billing.find({ patient: patientId })
      .populate("admission", "admissionNumber department admissionDate")
      .sort({ createdAt: -1 });
  }

  async getBillSummary(id) {
    const bill = await this.getBillById(id);

    return {
      billNumber: bill.billNumber,
      patientName: bill.patient.fullName,
      UHID: bill.patient.UHID,
      admissionNumber: bill.admission.admissionNumber,
      admissionDate: bill.admissionDate,
      dischargeDate: bill.dischargeDate,
      totalDays: bill.totalDays,
      charges: {
        bedCharges: bill.bedCharges,
        servicesCharges: bill.additionalServices.reduce(
          (sum, s) => sum + s.total,
          0
        ),
        investigationsCharges: bill.investigations.reduce(
          (sum, i) => sum + i.charges,
          0
        ),
        medicationsCharges: bill.medications.reduce(
          (sum, m) => sum + m.total,
          0
        ),
        proceduresCharges: bill.procedures.reduce(
          (sum, p) => sum + p.charges,
          0
        ),
      },
      subtotal: bill.subtotal,
      discount: bill.discount,
      tax: bill.tax,
      grandTotal: bill.grandTotal,
      totalPaid: bill.totalPaid,
      balanceDue: bill.balanceDue,
      status: bill.billStatus,
    };
  }

  async getRevenue(startDate, endDate) {
    const query = {
      billStatus: "Paid",
      generatedDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    const bills = await Billing.find(query);

    const totalRevenue = bills.reduce((sum, bill) => sum + bill.grandTotal, 0);
    const totalDiscount = bills.reduce((sum, bill) => sum + bill.discount, 0);
    const totalTax = bills.reduce((sum, bill) => sum + bill.tax, 0);

    return {
      totalBills: bills.length,
      totalRevenue,
      totalDiscount,
      totalTax,
      startDate,
      endDate,
    };
  }

  async deleteBill(id) {
    const bill = await Billing.findById(id);
    if (!bill) {
      throw new Error("Bill not found");
    }

    if (bill.billStatus === "Paid") {
      throw new Error("Cannot delete paid bill");
    }

    await Billing.findByIdAndDelete(id);
    return bill;
  }
}

module.exports = new BillingService();
