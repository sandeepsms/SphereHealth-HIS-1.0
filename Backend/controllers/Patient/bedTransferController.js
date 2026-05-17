// controllers/Patient/bedTransferController.js
// Handles the full bed-transfer workflow:
//   1. Doctor initiates  → POST /api/bed-transfers
//   2. Nurse completes   → PUT  /api/bed-transfers/:id/handover
//   3. Doctor cancels    → PUT  /api/bed-transfers/:id/cancel

const BedTransfer = require("../../models/Patient/bedTransferModel");
const Bed         = require("../../models/bedMgmt/bedsModel");
const Admission   = require("../../models/Patient/admissionModel");

/* ──────────────────────────────────────────────────────────────
   POST /api/bed-transfers
   Doctor initiates a transfer request with shifting notes.
   Target bed is reserved immediately so no one else can take it.
────────────────────────────────────────────────────────────── */
exports.createTransfer = async (req, res) => {
  try {
    const {
      UHID, admissionId, patientName,
      fromBedId, fromBedNumber, fromWardName, fromRoomNumber,
      toBedId,   toBedNumber,   toWardName,   toRoomNumber,
      reason, shiftingNotes,
      requestedBy, requestedById,
    } = req.body;

    if (!UHID || !admissionId || !toBedId || !shiftingNotes?.trim()) {
      return res.status(400).json({
        success: false,
        message: "UHID, admissionId, toBedId, and shiftingNotes are required",
      });
    }

    // Block if a transfer is already pending for this admission
    const existing = await BedTransfer.findOne({ admissionId, status: "PendingHandover" });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A bed transfer is already pending nurse handover for this patient",
      });
    }

    // Verify target bed is available. 409 (not 400) — the request body is
    // well-formed; the conflict is in resource state (bed currently in use
    // or being held by someone else).
    const targetBed = await Bed.findOne({ _id: toBedId, status: "Available" });
    if (!targetBed) {
      return res.status(409).json({
        success: false,
        message: "Selected bed is not available for transfer",
      });
    }

    // Atomic reserve — only flip "Available" → "Reserved" if we win the
    // race. Two concurrent transfer-initiations targeting the same bed
    // were previously both passing the SELECT step then both calling
    // findByIdAndUpdate, leaving one of them with a phantom transfer
    // doc against a bed that's already reserved by another admission.
    // Patient-safety/data-integrity audit A-09.
    const reserved = await Bed.findOneAndUpdate(
      { _id: toBedId, status: "Available" },
      { $set: { status: "Reserved" } },
      { new: true },
    );
    if (!reserved) {
      return res.status(409).json({
        success: false,
        message: "Selected bed was just taken by another transfer. Pick another bed.",
      });
    }

    let transfer;
    try {
      transfer = await BedTransfer.create({
        UHID, admissionId, patientName: patientName || "",
        fromBedId:      fromBedId      || null,
        fromBedNumber:  fromBedNumber  || "",
        fromWardName:   fromWardName   || "",
        fromRoomNumber: fromRoomNumber || "",
        toBedId, toBedNumber, toWardName, toRoomNumber,
        reason: reason || "",
        shiftingNotes: shiftingNotes.trim(),
        requestedBy:   requestedBy  || "",
        requestedById: requestedById || null,
      });
    } catch (createErr) {
      // The unique partial index on `{admissionId, status:"PendingHandover"}`
      // is the main expected failure here (duplicate transfer). Roll back
      // the reservation so the bed doesn't get stuck. Best-effort —
      // if the rollback itself fails the admin still gets a clear error.
      try {
        await Bed.findByIdAndUpdate(toBedId, { $set: { status: "Available" } });
      } catch (rbErr) {
        console.error("[BedTransfer] rollback reservation failed:", rbErr.message);
      }
      const dup = createErr.code === 11000;
      return res.status(dup ? 409 : 500).json({
        success: false,
        message: dup
          ? "An open transfer is already pending for this admission."
          : createErr.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "Bed transfer initiated. Nurse handover notes required to complete.",
      data: transfer,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────
   GET /api/bed-transfers?UHID=&admissionId=&status=
────────────────────────────────────────────────────────────── */
exports.getTransfers = async (req, res) => {
  try {
    const query = {};
    if (req.query.UHID)        query.UHID        = req.query.UHID;
    if (req.query.admissionId) query.admissionId = req.query.admissionId;
    if (req.query.status)      query.status      = req.query.status;

    const transfers = await BedTransfer.find(query).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: transfers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────
   PUT /api/bed-transfers/:id/handover
   Nurse writes handover notes → actual bed switch happens here.
────────────────────────────────────────────────────────────── */
exports.completeHandover = async (req, res) => {
  try {
    const { handoverNotes, handoverBy, handoverById } = req.body;

    if (!handoverNotes?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Handover notes are required to complete the transfer",
      });
    }

    const transfer = await BedTransfer.findById(req.params.id);
    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer record not found" });
    }
    if (transfer.status !== "PendingHandover") {
      return res.status(400).json({
        success: false,
        message: `Transfer is already ${transfer.status.toLowerCase()}`,
      });
    }

    // Perform the actual bed switch directly
    // Note: toBed is "Reserved" (not "Available") because doctor reserved it on initiation.
    // We accept Reserved|Available here to complete the move.
    const newBed = await Bed.findOneAndUpdate(
      { _id: transfer.toBedId, status: { $in: ["Reserved", "Available"] } },
      { $set: { status: "Occupied", currentAdmission: transfer.admissionId } },
      { new: true }
    );
    if (!newBed) {
      return res.status(400).json({
        success: false,
        message: "Target bed is no longer available. Transfer cannot be completed.",
      });
    }

    // Release the old bed
    if (transfer.fromBedId) {
      await Bed.findByIdAndUpdate(transfer.fromBedId, {
        $set: { status: "Available", currentAdmission: null, patient: null },
      });
    }

    // Update the admission record
    const admission = await Admission.findById(transfer.admissionId);
    if (admission) {
      admission.transferHistory = admission.transferHistory || [];
      admission.transferHistory.push({
        fromBed: transfer.fromBedId || null,
        toBed:   transfer.toBedId,
        reason:  transfer.reason || "Bed Transfer with Handover",
        date:    new Date(),
      });
      admission.bedId     = newBed._id;
      admission.bedNumber = newBed.bedNumber;
      admission.wardName  = newBed.wardName  || admission.wardName;
      admission.roomId    = newBed.room      || null;
      admission.wardId    = newBed.ward      || null;
      admission.floorId   = newBed.floor     || null;
      await admission.save();
    }

    // Mark transfer complete
    transfer.handoverNotes = handoverNotes.trim();
    transfer.handoverBy    = handoverBy    || "";
    transfer.handoverById  = handoverById  || null;
    transfer.handoverAt    = new Date();
    transfer.status        = "Complete";
    await transfer.save();

    res.json({
      success: true,
      message: "Handover complete — patient bed updated successfully.",
      data: transfer,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────
   PUT /api/bed-transfers/:id/cancel
   Doctor cancels a pending transfer — reserved bed released.
────────────────────────────────────────────────────────────── */
exports.cancelTransfer = async (req, res) => {
  try {
    const transfer = await BedTransfer.findById(req.params.id);
    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }
    if (transfer.status !== "PendingHandover") {
      return res.status(400).json({
        success: false,
        message: "Only pending transfers can be cancelled",
      });
    }

    // FIX (audit P11-B4): only release the bed if it's still Reserved by
    // THIS transfer. Otherwise we'd flip an Occupied bed (admin manually
    // reassigned to another patient between initiate + cancel) back to
    // Available, double-allocating it.
    await Bed.findOneAndUpdate(
      { _id: transfer.toBedId, status: "Reserved" },
      { $set: { status: "Available" } },
    );

    transfer.status = "Cancelled";
    await transfer.save();

    res.json({ success: true, message: "Transfer cancelled — bed released.", data: transfer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
