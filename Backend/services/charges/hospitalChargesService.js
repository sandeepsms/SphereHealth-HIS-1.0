const HospitalCharges = require("../../models/charges/HospitalChargesModel");
const TPA = require("../../models/tpa/tpaModel");
const { safeRegex } = require("../../utils/queryGuards"); // R8-FIX(#50): ReDoS/regex-injection guard

const createHospitalCharges = async (body) => {
  const { tpaName, charges } = body;

  if (!Array.isArray(charges) || charges.length === 0) {
    throw new Error("At least one charge is required");
  }

  const tpaData = await TPA.findOne({
    tpaName: tpaName.trim(),
    isActive: { $ne: false },
  });

  if (!tpaData) {
    throw new Error(`TPA '${tpaName}' not found`);
  }

  let existingCharges = await HospitalCharges.findOne({ tpa: tpaData._id });

  if (existingCharges) {
    const duplicates = [];

    for (let newCharge of charges) {
      const isDuplicate = existingCharges.charges.some(
        (oldCharge) =>
          oldCharge.chargeName.toLowerCase().trim() ===
          newCharge.chargeName.toLowerCase().trim(),
      );

      if (isDuplicate) duplicates.push(newCharge.chargeName);
    }

    if (duplicates.length > 0) {
      throw new Error(`Duplicate charge(s) found: ${duplicates.join(", ")}`);
    }

    existingCharges.charges.push(...charges);
    await existingCharges.save();
    return existingCharges;
  }

  const newCharges = new HospitalCharges({
    tpa: tpaData._id,
    tpaName: tpaData.tpaName,
    tpaCode: tpaData.tpaCode,
    charges,
    isActive: true,
  });

  await newCharges.save();
  return newCharges;
};

const getAllHospitalCharges = async (queryParams) => {
  const { search, isActive } = queryParams;
  let query = {};

  if (search) {
    const rx = safeRegex(search); // R8-FIX(#50)
    query.$or = [
      { tpaName: rx },
      { tpaCode: rx },
    ];
  }

  if (isActive !== undefined) {
    query.isActive = isActive === "true";
  }

  return await HospitalCharges.find(query)
    .populate("tpa", "tpaName tpaCode phone email")
    .sort({ createdAt: -1 });
};

// ✅ NEW: Get by document ID
const getHospitalChargesById = async (id) => {
  return await HospitalCharges.findById(id).populate(
    "tpa",
    "tpaName tpaCode phone email",
  );
};

const getHospitalChargesByTPA = async (tpaId) => {
  if (!tpaId || tpaId === "normal") {
    return await HospitalCharges.findOne({
      tpaName: "Normal",
      isActive: true,
    });
  }

  return await HospitalCharges.findOne({
    tpa: tpaId,
    isActive: true,
  }).populate("tpa", "tpaName tpaCode phone email");
};

const updateHospitalCharges = async (id, charges) => {
  return await HospitalCharges.findByIdAndUpdate(
    id,
    { charges },
    { new: true, runValidators: true },
  ).populate("tpa");
};

const deleteHospitalCharges = async (id) => {
  return await HospitalCharges.findByIdAndDelete(id);
};

const toggleActiveStatus = async (id) => {
  const hospitalCharges = await HospitalCharges.findById(id);

  if (!hospitalCharges) {
    throw new Error("Hospital charges not found");
  }

  hospitalCharges.isActive = !hospitalCharges.isActive;
  await hospitalCharges.save();
  return hospitalCharges;
};

module.exports = {
  createHospitalCharges,
  getAllHospitalCharges,
  getHospitalChargesById,
  getHospitalChargesByTPA,
  updateHospitalCharges,
  deleteHospitalCharges,
  toggleActiveStatus,
};
