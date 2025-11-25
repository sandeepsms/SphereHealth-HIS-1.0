const Bed = require("../models/bedmodel");

exports.getAllBeds = async (req, res) => {
  const beds = await Bed.find().sort({ createdAt: -1 }).lean();
  res.json(beds);
};

exports.getBedById = async (req, res) => {
  const bed = await Bed.findOne({ id: req.params.id }).lean();
  if (!bed) return res.status(404).json({ message: "Not found" });
  res.json(bed);
};

exports.addBed = async (req, res) => {
  try {
    const doc = await Bed.create(req.body);
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.updateBed = async (req, res) => {
  try {
    const updated = await Bed.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: "Not found" });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.deleteBed = async (req, res) => {
  await Bed.findOneAndDelete({ id: req.params.id });
  res.json({ message: "deleted" });
};

// exports.assignPatient = async (req, res) => {
//   const { name, age } = req.body;
//   const bed = await Bed.findOne({ id: req.params.id });
//   if (!bed) return res.status(404).json({ message: "Not founddddddddddddd" });
//   bed.status = "occupied";
//   bed.patient = { name: name.trim(), age: age ? Number(age) : null };
//   await bed.save();
//   res.json(bed);
// };

exports.assignPatient = async (req, res) => {
  try {
    const { name, age } = req.body;

    const bed = await Bed.findById(req.params.id);
    if (!bed) return res.status(404).json({ message: "Bed not found" });

    bed.patient = { name: name.trim(), age: Number(age) };
    bed.status = "occupied";

    // ✅ Ye line ADD KARO → Yahi time se counting start hogi
    bed.startingTime = new Date();

    await bed.save();

    res.json({ message: "Patient assigned successfully", bed });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

exports.assignPatientcharges = async (req, res) => {
  try {
    const { id } = req.params;

    const { patientUHID, hourlyCharge, TotalCharge } = req.body;

    console.log("bodysssssssssssssssssssssss", req.body);

    if (!patientUHID) {
      return res.status(400).json({ message: "patientId is required" });
    }

    const bed = await Bed.findById(id);
    if (!bed) {
      return res.status(404).json({ message: "Bed not found" });
    }

    bed.patientUHID = patientUHID;
    bed.hourlyCharge = hourlyCharge;
    bed.TotalCharge = TotalCharge ?? bed.TotalCharge;
    bed.startingTime = new Date();

    await bed.save();

    res.status(200).json({
      message: "Bed charges updated successfully",
      bed,
    });
  } catch (error) {
    console.error("PUT /beds/assign/:bedId error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

exports.bedcharges = async (req, res) => {
  try {
    const { bedId } = req.params;

    const bed = await Bed.findById(bedId);
if (!bed) return res.status(404).json({ message: "Bed not found" });

    res.json({ hourlyCharge: bed.hourlyCharge });
  } catch (err) {
    res.status(500).json(err);
  }
};

exports.dischargePatient = async (req, res) => {
  const bed = await Bed.findOne({ id: req.params.id });
  if (!bed) return res.status(404).json({ message: "Not found" });
  bed.status = "available";
  bed.patient = null;
  await bed.save();
  res.json(bed);
};

exports.getBedCharges = async (req, res) => {
  const bed = await Bed.findById(req.params.id);
  if (!bed) return res.status(404).json({ message: "Bed not found" });

  if (!bed.startingTime)
    return res.status(400).json({ message: "Charges not started yet" });

  const now = new Date();
  const diffMs = now - bed.startingTime;
  const hours = diffMs / (1000 * 60 * 60);

  const totalCharge = Math.round(hours * bed.hourlyCharge);

  res.json({
    hours: hours.toFixed(2),
    hourlyCharge: bed.hourlyCharge,
    totalCharge,
  });
};
