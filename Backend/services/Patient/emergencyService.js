const Emergency = require("../../models/Patient/emergencyModel");
const patientService = require("./patientService");

class EmergencyService {
  async createEmergencyVisit(emergencyData) {
    const emergency = new Emergency(emergencyData);
    const savedEmergency = await emergency.save();

    await patientService.updateVisitCount(emergencyData.patientId, "Emergency");

    return savedEmergency;
  }

  async getAllEmergencyVisits(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;

    const visits = await Emergency.find(filters)
      .sort({ arrivalDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate("patientId", "fullName UHID contactNumber");

    const total = await Emergency.countDocuments(filters);

    return {
      visits,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getEmergencyVisitById(emergencyNumber) {
    return await Emergency.findOne({ emergencyNumber }).populate(
      "patientId",
      "fullName UHID contactNumber age gender"
    );
  }

  async getPatientEmergencyHistory(patientId) {
    return await Emergency.find({ patientId }).sort({ arrivalDate: -1 });
  }

  async updateEmergencyVisit(emergencyNumber, updateData) {
    return await Emergency.findOneAndUpdate({ emergencyNumber }, updateData, {
      new: true,
      runValidators: true,
    });
  }

  async deleteEmergencyVisit(emergencyNumber) {
    return await Emergency.findOneAndDelete({ emergencyNumber });
  }

  async addInvestigation(emergencyNumber, investigation) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          investigationsOrdered: {
            ...investigation,
            orderedDate: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async updateInvestigationStatus(
    emergencyNumber,
    investigationId,
    status,
    result
  ) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber, "investigationsOrdered._id": investigationId },
      {
        $set: {
          "investigationsOrdered.$.status": status,
          "investigationsOrdered.$.result": result,
        },
      },
      { new: true }
    );
  }

  async addMedication(emergencyNumber, medication) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          "treatmentGiven.medications": {
            ...medication,
            givenAt: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async addProcedure(emergencyNumber, procedure) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          "treatmentGiven.procedures": {
            ...procedure,
            performedAt: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async addNursingNote(emergencyNumber, note, recordedBy) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          nursingNotes: {
            time: new Date(),
            note,
            recordedBy,
          },
        },
      },
      { new: true }
    );
  }

  async updateDisposition(emergencyNumber, dispositionData) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        disposition: dispositionData.disposition,
        admittedTo: dispositionData.admittedTo,
        dischargeDate: dispositionData.dischargeDate,
        dischargeInstructions: dispositionData.dischargeInstructions,
        referredTo: dispositionData.referredTo,
        status: dispositionData.status || "Completed",
      },
      { new: true }
    );
  }

  async getActiveEmergencies() {
    return await Emergency.find({
      status: { $in: ["Active", "Under Observation"] },
    })
      .sort({ triageCategory: 1, arrivalDate: 1 })
      .populate("patientId", "fullName UHID age gender");
  }

  async getEmergenciesByTriage(triageCategory) {
    return await Emergency.find({
      triageCategory,
      status: { $in: ["Active", "Under Observation"] },
    })
      .sort({ arrivalDate: 1 })
      .populate("patientId", "fullName UHID");
  }

  async getTodayEmergencies() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await Emergency.find({
      arrivalDate: {
        $gte: today,
        $lt: tomorrow,
      },
    }).populate("patientId", "fullName UHID");
  }

  async getMLCCases() {
    return await Emergency.find({ isMLC: true })
      .sort({ arrivalDate: -1 })
      .populate("patientId", "fullName UHID contactNumber");
  }
}

module.exports = new EmergencyService();
