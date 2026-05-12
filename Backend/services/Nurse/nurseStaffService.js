// Nurse/Services/nurseStaffService.js
// Business logic for NurseStaff CRUD

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const NurseStaff = require("../../models/Nurse/NurseStaffModel");

// ─────────────────────────────────────────────────────────────
// Create nurse staff
// ─────────────────────────────────────────────────────────────
const createNurseStaff = async (data) => {
  const {
    personalInfo,
    contact,
    professional,
    department,
    ward,
    shift,
    username,
    password,
  } = data;

  const regExists = await NurseStaff.findOne({
    "professional.registrationNumber": professional?.registrationNumber,
  });
  if (regExists) {
    const error = new Error("Registration number already exists");
    error.statusCode = 400;
    throw error;
  }

  const mobileExists = await NurseStaff.findOne({
    "contact.mobileNumber": contact?.mobileNumber,
  });
  if (mobileExists) {
    const error = new Error("Mobile number already registered");
    error.statusCode = 400;
    throw error;
  }

  const nurseData = {
    personalInfo,
    contact,
    professional,
    department,
    ward,
    shift,
  };
  if (username && password) {
    nurseData.username = username;
    nurseData.password = await bcrypt.hash(password, 10);
  }

  const nurse = await NurseStaff.create(nurseData);
  const result = nurse.toObject();
  delete result.password;
  return result;
};

// ─────────────────────────────────────────────────────────────
// Get all with filters + pagination
// ─────────────────────────────────────────────────────────────
const getAllNurseStaff = async (query) => {
  const {
    page = 1,
    limit = 20,
    department,
    designation,
    shift,
    ward,
    isActive,
    search,
  } = query;

  const filter = {};
  if (department) filter.department = department;
  if (designation) filter["professional.designation"] = designation;
  if (shift) filter.shift = shift;
  if (ward) filter.ward = { $regex: ward, $options: "i" };
  if (isActive !== undefined) filter.isActive = isActive === "true";
  if (search) {
    filter.$or = [
      { "personalInfo.fullName": { $regex: search, $options: "i" } },
      { "personalInfo.firstName": { $regex: search, $options: "i" } },
      { staffId: { $regex: search, $options: "i" } },
      { "contact.mobileNumber": { $regex: search, $options: "i" } },
      { "professional.registrationNumber": { $regex: search, $options: "i" } },
    ];
  }

  const [nurses, total] = await Promise.all([
    NurseStaff.find(filter)
      .select("-password")
      .populate("department", "departmentName")
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean(),
    NurseStaff.countDocuments(filter),
  ]);

  return { nurses, total, page: +page, pages: Math.ceil(total / +limit) };
};

// ─────────────────────────────────────────────────────────────
// Get by _id or staffId
// ─────────────────────────────────────────────────────────────
const getNurseStaffById = async (id) => {
  const isObjectId = mongoose.Types.ObjectId.isValid(id);
  const query = isObjectId ? { _id: id } : { staffId: id.toUpperCase() };

  const nurse = await NurseStaff.findOne(query)
    .select("-password")
    .populate("department", "departmentName");

  if (!nurse) {
    const error = new Error("Nurse not found");
    error.statusCode = 404;
    throw error;
  }
  return nurse;
};

// ─────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────
const updateNurseStaff = async (id, data) => {
  const nurse = await NurseStaff.findById(id);
  if (!nurse) {
    const error = new Error("Nurse not found");
    error.statusCode = 404;
    throw error;
  }

  const allowed = [
    "personalInfo",
    "contact",
    "professional",
    "department",
    "ward",
    "shift",
    "isActive",
  ];
  allowed.forEach((f) => {
    if (data[f] !== undefined) nurse[f] = data[f];
  });

  if (data.password) nurse.password = await bcrypt.hash(data.password, 10);

  await nurse.save();
  const result = nurse.toObject();
  delete result.password;
  return result;
};

// ─────────────────────────────────────────────────────────────
// Toggle active status
// ─────────────────────────────────────────────────────────────
const toggleNurseStatus = async (id) => {
  const nurse = await NurseStaff.findById(id);
  if (!nurse) {
    const error = new Error("Nurse not found");
    error.statusCode = 404;
    throw error;
  }
  nurse.isActive = !nurse.isActive;
  await nurse.save();
  return { staffId: nurse.staffId, isActive: nurse.isActive };
};

// ─────────────────────────────────────────────────────────────
// Delete (only if no submitted notes)
// ─────────────────────────────────────────────────────────────
const deleteNurseStaff = async (id) => {
  const nurse = await NurseStaff.findById(id);
  if (!nurse) {
    const error = new Error("Nurse not found");
    error.statusCode = 404;
    throw error;
  }

  const NurseNotes = require("../../models/Nurse/NurseNotesModel");
  const count = await NurseNotes.countDocuments({ nurse: id });
  if (count > 0) {
    const error = new Error(
      `Cannot delete — nurse has ${count} submitted notes. Deactivate instead.`,
    );
    error.statusCode = 400;
    throw error;
  }

  await nurse.deleteOne();
  return true;
};

// ─────────────────────────────────────────────────────────────
// Get by department (for dropdown)
// ─────────────────────────────────────────────────────────────
const getNursesByDepartment = async (deptId) => {
  return NurseStaff.find({ department: deptId, isActive: true })
    .select("staffId personalInfo.fullName professional.designation shift ward")
    .lean();
};

module.exports = {
  createNurseStaff,
  getAllNurseStaff,
  getNurseStaffById,
  updateNurseStaff,
  toggleNurseStatus,
  deleteNurseStaff,
  getNursesByDepartment,
};
