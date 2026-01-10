const Admission = require("../../models/Patient/admissionModel");
const Bed = require("../../models/bedMgmt/bedsModel");
const Patient = require("../../models/Patient/patientModel");

class AdmissionService {
  async generateAdmissionNumber() {
    const today = new Date();
    const year = today.getFullYear().toString().slice(-2);
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const prefix = `ADM${year}${month}`;

    const lastAdmission = await Admission.findOne({
      admissionNumber: { $regex: `^${prefix}` },
    }).sort({ admissionNumber: -1 });

    let sequence = 1;
    if (lastAdmission) {
      const lastSequence = parseInt(lastAdmission.admissionNumber.slice(-4));
      sequence = lastSequence + 1;
    }

    return `${prefix}${String(sequence).padStart(4, "0")}`;
  }

  async createAdmission(data) {
    const bed = await Bed.findById(data.bedId)
      .populate("room")
      .populate("ward")
      .populate("floor")
      .populate("building");

    if (!bed) throw new Error("Bed not found");
    if (bed.status !== "Available") throw new Error("Bed is not available");

    const patient = await Patient.findById(data.patientId);
    if (!patient) throw new Error("Patient not found");

    const activeAdmission = await Admission.findOne({
      patientId: data.patientId,
      status: "Active",
    });

    if (activeAdmission) {
      throw new Error("Patient already has an active admission");
    }

    const admissionNumber = await this.generateAdmissionNumber();

    const admission = await Admission.create({
      admissionNumber,
      UHID: patient.UHID || patient.uhid || patient.id,
      patientId: data.patientId,
      patientName:
        `${patient.firstName || ""} ${patient.lastName || ""}`.trim() ||
        patient.name ||
        "Unknown",
      contactNumber:
        patient.phone ||
        patient.mobile ||
        patient.contactNumber ||
        patient.contact ||
        "0000000000",
      email: patient.email || "",
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      roomNumber: bed.room?.roomNumber,
      roomId: bed.room?._id,
      wardId: bed.ward?._id,
      floorId: bed.floor?._id,
      buildingId: bed.building?._id,
      department: data.department,
      admissionDate: data.admissionDate || new Date(),
      expectedDischargeDate: data.expectedDischargeDate,
      reasonForAdmission: data.reasonForAdmission,
      estimatedCost: data.estimatedCost || 0,
      advancePaid: data.advancePaid || 0,
      status: "Active",
    });

    bed.status = "Occupied";
    bed.currentAdmission = admission._id;
    await bed.save();

    return admission;
  }

  async getAllAdmissions(filters = {}) {
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.department) query.department = filters.department;
    if (filters.patientId) query.patientId = filters.patientId;
    if (filters.bedId) query.bedId = filters.bedId;
    if (filters.wardId) query.wardId = filters.wardId;
    if (filters.UHID) query.UHID = { $regex: filters.UHID, $options: "i" };

    if (filters.fromDate || filters.toDate) {
      query.admissionDate = {};
      if (filters.fromDate)
        query.admissionDate.$gte = new Date(filters.fromDate);
      if (filters.toDate) query.admissionDate.$lte = new Date(filters.toDate);
    }

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const skip = (page - 1) * limit;

    const admissions = await Admission.find(query)
      .populate("patientId", "firstName lastName UHID phone")
      .populate("bedId", "bedNumber status")
      .populate("department", "name")
      .populate("roomId", "roomNumber")
      .populate("wardId", "wardName")
      .sort({ admissionDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Admission.countDocuments(query);

    return {
      admissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAdmissionById(id) {
    const admission = await Admission.findById(id)
      .populate("patientId")
      .populate("bedId")
      .populate("department")
      .populate("roomId")
      .populate("wardId")
      .populate("floorId")
      .populate("buildingId");

    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  async getActiveAdmissions(filters = {}) {
    const query = { status: "Active" };

    if (filters.department) query.department = filters.department;
    if (filters.wardId) query.wardId = filters.wardId;

    return await Admission.find(query)
      .populate("patientId", "firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .populate("department", "name")
      .sort({ admissionDate: -1 });
  }

  async getTodayAdmissions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await Admission.find({
      admissionDate: { $gte: today, $lt: tomorrow },
    })
      .populate("patientId", "firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .populate("department", "name")
      .sort({ admissionDate: -1 });
  }

  async updateAdmission(id, data) {
    const admission = await Admission.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  async transferBed(admissionId, newBedId, reason) {
    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error("Admission is not active");

    const oldBed = await Bed.findById(admission.bedId);
    const newBed = await Bed.findById(newBedId);

    if (!newBed) throw new Error("New bed not found");
    if (newBed.status !== "Available")
      throw new Error("New bed is not available");

    if (oldBed) {
      oldBed.status = "Available";
      oldBed.currentAdmission = null;
      await oldBed.save();
    }

    newBed.status = "Occupied";
    newBed.currentAdmission = admissionId;
    await newBed.save();

    admission.bedId = newBedId;
    admission.bedNumber = newBed.bedNumber;
    admission.roomId = newBed.room;
    admission.wardId = newBed.ward;
    admission.transferHistory = admission.transferHistory || [];
    admission.transferHistory.push({
      fromBed: oldBed?._id,
      toBed: newBedId,
      reason,
      date: new Date(),
    });

    await admission.save();
    return admission;
  }

  async dischargePatient(admissionId, dischargeData) {
    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error("Admission is not active");

    const bed = await Bed.findById(admission.bedId);
    if (bed) {
      bed.status = "Available";
      bed.currentAdmission = null;
      await bed.save();
    }

    admission.status = "Discharged";
    admission.actualDischargeDate =
      dischargeData.actualDischargeDate || new Date();
    admission.dischargeNotes = dischargeData.dischargeNotes;
    admission.dischargeSummary = dischargeData.dischargeSummary;
    admission.totalCost = dischargeData.totalCost;

    await admission.save();
    return admission;
  }

  async cancelAdmission(id, reason) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");

    const bed = await Bed.findById(admission.bedId);
    if (bed) {
      bed.status = "Available";
      bed.currentAdmission = null;
      await bed.save();
    }

    admission.status = "Cancelled";
    admission.cancelReason = reason;
    admission.cancelledAt = new Date();

    await admission.save();
    return admission;
  }

  async getAdmissionStatistics(startDate, endDate) {
    const query = {};
    if (startDate || endDate) {
      query.admissionDate = {};
      if (startDate) query.admissionDate.$gte = new Date(startDate);
      if (endDate) query.admissionDate.$lte = new Date(endDate);
    }

    const total = await Admission.countDocuments(query);
    const active = await Admission.countDocuments({
      ...query,
      status: "Active",
    });
    const discharged = await Admission.countDocuments({
      ...query,
      status: "Discharged",
    });
    const cancelled = await Admission.countDocuments({
      ...query,
      status: "Cancelled",
    });

    const departmentStats = await Admission.aggregate([
      { $match: query },
      { $group: { _id: "$department", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "departments",
          localField: "_id",
          foreignField: "_id",
          as: "dept",
        },
      },
      { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
      { $project: { department: "$dept.name", count: 1 } },
    ]);

    return {
      total,
      active,
      discharged,
      cancelled,
      departmentWise: departmentStats,
    };
  }

  async getPatientAdmissionHistory(patientId) {
    return await Admission.find({ patientId })
      .populate("bedId", "bedNumber")
      .populate("department", "name")
      .sort({ admissionDate: -1 });
  }

  async searchAdmissions(searchTerm) {
    const regex = new RegExp(searchTerm, "i");

    return await Admission.find({
      $or: [
        { UHID: regex },
        { patientName: regex },
        { admissionNumber: regex },
        { contactNumber: regex },
      ],
    })
      .populate("patientId", "firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .populate("department", "name")
      .limit(20)
      .sort({ admissionDate: -1 });
  }

  async deleteAdmission(id) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");

    if (admission.status === "Active") {
      const bed = await Bed.findById(admission.bedId);
      if (bed) {
        bed.status = "Available";
        bed.currentAdmission = null;
        await bed.save();
      }
    }

    await Admission.findByIdAndDelete(id);
    return { message: "Admission deleted successfully" };
  }
}

module.exports = new AdmissionService();
