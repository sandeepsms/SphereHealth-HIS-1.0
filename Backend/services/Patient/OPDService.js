const OPD = require("../../models/Patient/OPDModels");
const patientService = require("../Patient/patientService");


class OPDService {
  async createOPDVisit(opdData) {
    const opd = new OPD(opdData);
    const savedOPD = await opd.save();

    await patientService.updateVisitCount(opdData.patientId, "OPD");

    return savedOPD;
  }

  async getAllOPDVisits(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;

    const visits = await OPD.find(filters)
      .sort({ visitDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate("patientId", "fullName UHID contactNumber");

    const total = await OPD.countDocuments(filters);

    return {
      visits,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOPDVisitById(visitNumber) {
    return await OPD.findOne({ visitNumber }).populate(
      "patientId",
      "fullName UHID contactNumber age gender"
    );
  }

  async getPatientOPDHistory(patientId) {
    return await OPD.find({ patientId }).sort({ visitDate: -1 });
  }

  async updateOPDVisit(visitNumber, updateData) {
    return await OPD.findOneAndUpdate({ visitNumber }, updateData, {
      new: true,
      runValidators: true,
    });
  }

  async deleteOPDVisit(visitNumber) {
    return await OPD.findOneAndDelete({ visitNumber });
  }

  async addInvestigation(visitNumber, investigation) {
    return await OPD.findOneAndUpdate(
      { visitNumber },
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

  async updateInvestigationStatus(visitNumber, investigationId, status) {
    return await OPD.findOneAndUpdate(
      { visitNumber, "investigationsOrdered._id": investigationId },
      { $set: { "investigationsOrdered.$.status": status } },
      { new: true }
    );
  }

  async addPrescription(visitNumber, medication) {
    return await OPD.findOneAndUpdate(
      { visitNumber },
      { $push: { prescribedMedications: medication } },
      { new: true }
    );
  }

  async completeVisit(visitNumber, finalData) {
    return await OPD.findOneAndUpdate(
      { visitNumber },
      {
        ...finalData,
        status: "Completed",
      },
      { new: true }
    );
  }

  async getTodayVisits() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await OPD.find({
      visitDate: {
        $gte: today,
        $lt: tomorrow,
      },
    }).populate("patientId", "fullName UHID");
  }

  async getFollowUpDue(date) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    return await OPD.find({
      followUpRequired: true,
      followUpDate: {
        $gte: startDate,
        $lt: endDate,
      },
    }).populate("patientId", "fullName UHID contactNumber");
  }
}

module.exports = new OPDService();
