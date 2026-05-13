const Bed = require("../../models/bedMgmt/bedsModel");

class BedService {
  async createBeds(data) {
    const bedsData = Array.isArray(data) ? data : [data];
    const created = await Bed.insertMany(bedsData);
    return { created: created.length, beds: created };
  }

  /* ─────────────────────────────────────────────────────────────
     getAllBeds  —  KEY FIX:
     Populate currentAdmission → patientId (name, UHID, age, gender,
     bloodGroup, contactNumber) + attendingDoctor string field.
     This is what the frontend reads to show patient info on bed cards
     and in the Patient Details modal without extra API calls.
  ───────────────────────────────────────────────────────────── */
  async getAllBeds(filters = {}) {
    const query = { isActive: true };

    if (filters.status) query.status = filters.status;
    if (filters.building) query.building = filters.building;
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;
    if (filters.room) query.room = filters.room;

    const beds = await Bed.find(query)
      .populate({
        path: "currentAdmission",
        // ref is "Admission" — populate patient nested inside admission
        populate: {
          path: "patientId",
          select:
            "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        },
      })
      .sort({ floorNumber: 1, roomNumber: 1, bedNumber: 1 })
      .lean();

    return beds;
  }

  async getBedById(id) {
    const bed = await Bed.findById(id)
      .populate({
        path: "currentAdmission",
        populate: {
          path: "patientId",
          select:
            "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        },
      })
      .lean();
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async getBedPricing(id) {
    const bed = await Bed.findById(id).lean();
    if (!bed) throw new Error("Bed not found");
    return { bedId: id, bedNumber: bed.bedNumber, pricing: bed.pricing || {} };
  }

  async bookBed(bedId, bookingData) {
    const bed = await Bed.findOneAndUpdate(
      { _id: bedId, status: "Available" },
      {
        $set: {
          status: "Occupied",
          patient: bookingData.patientId || null,
          "currentBooking.admittedDate": bookingData.admittedDate || new Date(),
          "currentBooking.expectedDischargeDate":
            bookingData.expectedDischargeDate || null,
        },
      },
      { new: true },
    );
    if (!bed) throw new Error("Bed not available for booking");
    return bed;
  }

  async dischargeBed(bedId, dischargeDate) {
    const bed = await Bed.findByIdAndUpdate(
      bedId,
      {
        $set: {
          status: "Available",
          patient: null,
          currentAdmission: null,
          "currentBooking.actualDischargeDate": dischargeDate || new Date(),
        },
      },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async estimateCharges(bedId) {
    const bed = await Bed.findById(bedId).lean();
    if (!bed) throw new Error("Bed not found");
    const days = bed.currentBooking?.admittedDate
      ? Math.ceil(
          (new Date() - new Date(bed.currentBooking.admittedDate)) /
            (1000 * 60 * 60 * 24),
        )
      : 0;
    return {
      bedId,
      bedNumber: bed.bedNumber,
      daysOccupied: days,
      estimatedCharges: days * (bed.pricing?.perDayCharge || 0),
    };
  }

  async updateBedStatus(bedId, status) {
    const allowed = [
      "Available",
      "Occupied",
      "Maintenance",
      "Blocked",
      "Reserved",
    ];
    if (!allowed.includes(status))
      throw new Error(`Invalid status. Must be one of: ${allowed.join(", ")}`);

    // FIX (audit P7-B3): transition guards. Previously this just $set status,
    // so flipping an Occupied bed straight to "Available" via admin tool
    // left patient + currentAdmission references stuck on it — the bed
    // looked free on the board but admission service still thought it was
    // taken. Status transitions that release the bed must also wipe the
    // patient links; transitions to Occupied via this endpoint are blocked
    // (use bookBed / admission flow instead so we don't bypass admission).
    const update = { status };
    if (status === "Occupied") {
      throw new Error(
        "Use the admission/bookBed flow to mark a bed Occupied — direct status update is not allowed",
      );
    }
    if (["Available", "Maintenance", "Blocked"].includes(status)) {
      // Releasing the bed: nuke patient + admission links and clear booking dates.
      const current = await Bed.findById(bedId).lean();
      if (!current) throw new Error("Bed not found");
      if (current.status === "Occupied" && status === "Available") {
        update.patient = null;
        update.admission = null;
        update.currentAdmission = null;
        update["currentBooking.actualDischargeDate"] = new Date();
      }
    }

    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: update },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async updateBed(bedId, data) {
    const safe = { ...data };
    // Prevent overwriting critical fields directly
    delete safe._id;
    delete safe.createdAt;

    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: safe },
      { new: true, runValidators: true },
    );
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async deleteBed(bedId) {
    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: { isActive: false } },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async getRoomBedCapacity(roomId) {
    const [total, available, occupied] = await Promise.all([
      Bed.countDocuments({ room: roomId, isActive: true }),
      Bed.countDocuments({ room: roomId, status: "Available", isActive: true }),
      Bed.countDocuments({ room: roomId, status: "Occupied", isActive: true }),
    ]);
    return { roomId, total, available, occupied };
  }

  async getWardBedCapacity(wardId) {
    const [total, available, occupied] = await Promise.all([
      Bed.countDocuments({ ward: wardId, isActive: true }),
      Bed.countDocuments({ ward: wardId, status: "Available", isActive: true }),
      Bed.countDocuments({ ward: wardId, status: "Occupied", isActive: true }),
    ]);
    return { wardId, total, available, occupied };
  }

  async getAvailableBeds(filters = {}) {
    const query = { status: "Available", isActive: true };
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;
    if (filters.room) query.room = filters.room;
    if (filters.building) query.building = filters.building;

    return Bed.find(query)
      .sort({ floorNumber: 1, roomNumber: 1, bedNumber: 1 })
      .lean();
  }
}

module.exports = new BedService();
