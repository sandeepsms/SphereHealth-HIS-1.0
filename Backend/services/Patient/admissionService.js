const mongoose = require("mongoose");
const Admission = require("../../models/Patient/admissionModel");

// ✅ FIX: Model registered as "Beds" (plural) in bedsModel.js
//    mongoose.model("Beds", BedSchema)
//    Using require directly avoids the "Schema hasn't been registered" error
const Bed = require("../../models/bedMgmt/bedsModel");

const Patient = require("../../models/Patient/patientModel");

class AdmissionService {
  async _generateAdmissionNumber() {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `ADM${yy}${mm}`;

    const last = await Admission.findOne({
      admissionNumber: { $regex: `^${prefix}` },
    })
      .sort({ admissionNumber: -1 })
      .lean();

    const seq = last
      ? (parseInt(last.admissionNumber.slice(-4), 10) || 0) + 1
      : 1;

    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  _patientName(p) {
    return (
      p.fullName ||
      `${p.firstName || ""} ${p.lastName || ""}`.trim() ||
      p.name ||
      "Unknown Patient"
    );
  }

  async _findPatient(patientId, UHID) {
    let patient = null;

    if (patientId && mongoose.isValidObjectId(patientId)) {
      patient = await Patient.findById(patientId).lean();
    }

    if (!patient && UHID) {
      patient = await Patient.findOne({
        UHID: UHID.toString().trim().toUpperCase(),
      }).lean();
    }

    if (!patient)
      throw new Error("Patient not found — check patientId or UHID");
    return patient;
  }

  async createAdmission(data) {
    if (!data.bedId) throw new Error("bedId is required");
    if (!data.patientId && !data.UHID)
      throw new Error("patientId or UHID is required");

    const patient = await this._findPatient(data.patientId, data.UHID);

    const existing = await Admission.findOne({
      patientId: patient._id,
      status: "Active",
    }).lean();

    if (existing) {
      throw new Error(
        `Patient already has an active admission: ${existing.admissionNumber}. ` +
          `Discharge the patient first before creating a new admission.`,
      );
    }

    const bed = await Bed.findOneAndUpdate(
      { _id: data.bedId, status: "Available" },
      { $set: { status: "Occupied" } },
      { new: true },
    ).populate("room ward floor building");

    if (!bed) {
      const bedCheck = await Bed.findById(data.bedId).lean();
      if (!bedCheck) throw new Error("Bed not found");
      throw new Error(
        `Bed ${bedCheck.bedNumber} is not available (current status: ${bedCheck.status}). ` +
          `Cannot book an already occupied or unavailable bed without discharging first.`,
      );
    }

    const admissionNumber = await this._generateAdmissionNumber();

    let admission;
    try {
      admission = await Admission.create({
        admissionNumber,
        UHID: patient.UHID || String(patient._id),
        patientId: patient._id,
        patientName: this._patientName(patient),
        contactNumber:
          patient.contactNumber ||
          patient.phone ||
          patient.mobile ||
          "0000000000",
        email: patient.email || "",

        bedId: bed._id,
        bedNumber: bed.bedNumber,
        roomNumber: bed.room?.roomNumber || "",
        roomId: bed.room?._id || null,
        wardId: bed.ward?._id || null,
        floorId: bed.floor?._id || null,
        buildingId: bed.building?._id || null,

        department: data.department || "",
        admissionDate: data.admissionDate
          ? new Date(data.admissionDate)
          : new Date(),
        expectedDischargeDate: data.expectedDischargeDate
          ? new Date(data.expectedDischargeDate)
          : undefined,
        reasonForAdmission: data.reasonForAdmission || "",
        admissionType: data.admissionType || "Emergency",
        attendingDoctor: data.attendingDoctor || "",
        estimatedCost: Number(data.estimatedCost) || 0,
        advancePaid: Number(data.advancePaid) || 0,
        status: "Active",
      });
    } catch (err) {
      // Rollback bed status if admission creation fails
      await Bed.findByIdAndUpdate(bed._id, {
        $set: { status: "Available", currentAdmission: null },
      });
      throw err;
    }

    // ✅ Store admission reference on bed so getAllBeds can populate it
    await Bed.findByIdAndUpdate(bed._id, {
      $set: { currentAdmission: admission._id },
    });

    return admission;
  }

  async dischargePatient(admissionId, dischargeData = {}) {
    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error(
        `Cannot discharge — admission status is already "${admission.status}"`,
      );

    // ✅ Clear bed: Available + null currentAdmission
    await Bed.findByIdAndUpdate(admission.bedId, {
      $set: { status: "Available", currentAdmission: null, patient: null },
    });

    admission.status = "Discharged";
    admission.actualDischargeDate = dischargeData.actualDischargeDate
      ? new Date(dischargeData.actualDischargeDate)
      : new Date();
    admission.dischargeNotes = dischargeData.dischargeNotes || "";
    admission.dischargeSummary = dischargeData.dischargeSummary || "";
    admission.followUpInstructions = dischargeData.followUpInstructions || "";

    if (dischargeData.conditionOnDischarge) {
      admission.conditionOnDischarge = dischargeData.conditionOnDischarge;
    }
    if (
      dischargeData.totalCost !== undefined &&
      dischargeData.totalCost !== ""
    ) {
      admission.totalCost = Number(dischargeData.totalCost);
    }

    await admission.save();
    return admission;
  }

  async cancelAdmission(id, reason) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error(
        `Cannot cancel — admission status is "${admission.status}"`,
      );

    await Bed.findByIdAndUpdate(admission.bedId, {
      $set: { status: "Available", currentAdmission: null, patient: null },
    });

    admission.status = "Cancelled";
    admission.cancelReason = reason || "";
    admission.cancelledAt = new Date();
    await admission.save();
    return admission;
  }

  async transferBed(admissionId, newBedId, reason) {
    if (!mongoose.isValidObjectId(newBedId))
      throw new Error("Invalid newBedId");

    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error("Admission is not active");

    const newBed = await Bed.findOneAndUpdate(
      { _id: newBedId, status: "Available" },
      { $set: { status: "Occupied", currentAdmission: admissionId } },
      { new: true },
    );

    if (!newBed) {
      const check = await Bed.findById(newBedId).lean();
      if (!check) throw new Error("New bed not found");
      throw new Error(
        `New bed ${check.bedNumber} is not available (status: ${check.status})`,
      );
    }

    // Free old bed
    await Bed.findByIdAndUpdate(admission.bedId, {
      $set: { status: "Available", currentAdmission: null, patient: null },
    });

    admission.transferHistory = admission.transferHistory || [];
    admission.transferHistory.push({
      fromBed: admission.bedId,
      toBed: newBedId,
      reason: reason || "",
      date: new Date(),
    });

    admission.bedId = newBed._id;
    admission.bedNumber = newBed.bedNumber;
    admission.roomId = newBed.room || null;
    admission.wardId = newBed.ward || null;
    admission.floorId = newBed.floor || null;

    await admission.save();
    return admission;
  }

  async getAllAdmissions(filters = {}) {
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.admissionType) query.admissionType = filters.admissionType;
    if (filters.attendingDoctor)
      query.attendingDoctor = {
        $regex: filters.attendingDoctor,
        $options: "i",
      };
    if (filters.department)
      query.department = { $regex: filters.department, $options: "i" };
    if (filters.UHID) query.UHID = { $regex: filters.UHID, $options: "i" };
    if (filters.patientName)
      query.patientName = { $regex: filters.patientName, $options: "i" };

    // ✅ FIX: accept both bedId and bed as filter keys
    const bedFilter = filters.bedId || filters.bed;
    if (bedFilter && mongoose.isValidObjectId(String(bedFilter)))
      query.bedId = new mongoose.Types.ObjectId(String(bedFilter));

    const patFilter = filters.patientId || filters.patient;
    if (patFilter && mongoose.isValidObjectId(String(patFilter)))
      query.patientId = patFilter;

    if (filters.wardId && mongoose.isValidObjectId(String(filters.wardId)))
      query.wardId = filters.wardId;

    if (filters.fromDate || filters.toDate) {
      query.admissionDate = {};
      if (filters.fromDate)
        query.admissionDate.$gte = new Date(filters.fromDate);
      if (filters.toDate) query.admissionDate.$lte = new Date(filters.toDate);
    }

    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(500, parseInt(filters.limit) || 50); // ✅ higher default limit
    const skip = (page - 1) * limit;

    const [admissions, total] = await Promise.all([
      Admission.find(query)
        .populate(
          "patientId",
          "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        )
        .populate("bedId", "bedNumber status")
        .populate("roomId", "roomNumber")
        .populate("wardId", "wardName")
        .sort({ admissionDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Admission.countDocuments(query),
    ]);

    return {
      admissions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getAdmissionById(id) {
    const admission = await Admission.findById(id)
      .populate("patientId")
      .populate("bedId")
      .populate("roomId")
      .populate("wardId")
      .populate("floorId")
      .populate("buildingId");

    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  /* ─────────────────────────────────────────────────────────────
     getActiveAdmissions  —  KEY FIX:
     Previously crashed with "Schema hasn't been registered for model Bed"
     because somewhere it was doing mongoose.model("Bed") but the model
     is registered as "Beds". Now we just require bedsModel directly —
     no mongoose.model() call needed at all.
  ───────────────────────────────────────────────────────────── */
  async getActiveAdmissions(filters = {}) {
    const query = { status: "Active" };

    if (filters.department)
      query.department = { $regex: filters.department, $options: "i" };
    if (filters.admissionType) query.admissionType = filters.admissionType;
    if (filters.attendingDoctor)
      query.attendingDoctor = {
        $regex: filters.attendingDoctor,
        $options: "i",
      };
    if (filters.wardId) query.wardId = filters.wardId;

    // ✅ Support bedId filter (frontend uses this as fallback)
    const bedFilter = filters.bedId || filters.bed;
    if (bedFilter && mongoose.isValidObjectId(String(bedFilter)))
      query.bedId = new mongoose.Types.ObjectId(String(bedFilter));

    return Admission.find(query)
      .populate(
        "patientId",
        "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
      )
      .populate("bedId", "bedNumber status")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async getTodayAdmissions() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return Admission.find({ admissionDate: { $gte: start, $lt: end } })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async getTodayDischarges() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return Admission.find({
      status: "Discharged",
      actualDischargeDate: { $gte: start, $lt: end },
    })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ actualDischargeDate: -1 })
      .lean();
  }

  async getExpectedDischarges(date) {
    const target = date ? new Date(date) : new Date();
    target.setHours(0, 0, 0, 0);
    const next = new Date(target);
    next.setDate(next.getDate() + 1);

    return Admission.find({
      status: "Active",
      expectedDischargeDate: { $gte: target, $lt: next },
    })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ expectedDischargeDate: 1 })
      .lean();
  }

  async updateAdmission(id, data) {
    const safe = { ...data };
    delete safe.status;
    delete safe.admissionNumber;
    delete safe.patientId;
    delete safe.bedId;

    const admission = await Admission.findByIdAndUpdate(
      id,
      { $set: safe },
      { new: true, runValidators: true },
    );
    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  async getAdmissionStatistics(startDate, endDate) {
    const match = {};
    if (startDate || endDate) {
      match.admissionDate = {};
      if (startDate) match.admissionDate.$gte = new Date(startDate);
      if (endDate) match.admissionDate.$lte = new Date(endDate);
    }

    const [
      total,
      active,
      discharged,
      cancelled,
      deptWise,
      typeWise,
      doctorWise,
    ] = await Promise.all([
      Admission.countDocuments(match),
      Admission.countDocuments({ ...match, status: "Active" }),
      Admission.countDocuments({ ...match, status: "Discharged" }),
      Admission.countDocuments({ ...match, status: "Cancelled" }),
      Admission.aggregate([
        { $match: match },
        { $group: { _id: "$department", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Admission.aggregate([
        { $match: match },
        { $group: { _id: "$admissionType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Admission.aggregate([
        { $match: { ...match, attendingDoctor: { $ne: "" } } },
        { $group: { _id: "$attendingDoctor", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return {
      total,
      active,
      discharged,
      cancelled,
      departmentWise: deptWise,
      admissionTypeWise: typeWise,
      doctorWise,
    };
  }

  async getPatientAdmissionHistory(patientId) {
    return Admission.find({ patientId })
      .populate("bedId", "bedNumber")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async searchAdmissions(searchTerm) {
    if (!searchTerm?.trim()) throw new Error("Search term is required");
    const regex = { $regex: searchTerm.trim(), $options: "i" };
    return Admission.find({
      $or: [
        { UHID: regex },
        { patientName: regex },
        { admissionNumber: regex },
        { contactNumber: regex },
        { attendingDoctor: regex },
      ],
    })
      .populate("patientId", "fullName UHID")
      .populate("bedId", "bedNumber")
      .limit(20)
      .sort({ admissionDate: -1 })
      .lean();
  }

  async getPatientByUHID(uhid) {
    if (!uhid) throw new Error("UHID is required");
    const patient = await Patient.findOne({
      UHID: uhid.toString().trim().toUpperCase(),
    }).lean();
    if (!patient) throw new Error(`No patient found with UHID: ${uhid}`);
    return patient;
  }

  async getAdmissionsByDoctor(doctorName) {
    if (!doctorName) throw new Error("Doctor name is required");
    return Admission.find({
      attendingDoctor: { $regex: doctorName.trim(), $options: "i" },
      status: "Active",
    })
      .populate("patientId", "fullName UHID contactNumber")
      .populate("bedId", "bedNumber")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async deleteAdmission(id) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");

    if (admission.status === "Active") {
      // ✅ Always free the bed when admission is deleted
      await Bed.findByIdAndUpdate(admission.bedId, {
        $set: { status: "Available", currentAdmission: null, patient: null },
      });
    }

    await Admission.findByIdAndDelete(id);
    return { message: "Admission deleted successfully" };
  }
}

module.exports = new AdmissionService();
