// controllers/Nurse/nurseStaffController.js
const nurseStaffService = require("../../services/Nurse/nurseStaffService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status =
      err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class NurseStaffController {
  create = handle(async (req, res) => {
    const nurse = await nurseStaffService.createNurseStaff(req.body);
    return res.status(201).json({ success: true, data: nurse });
  });

  getAll = handle(async (req, res) => {
    const result = await nurseStaffService.getAllNurseStaff(req.query);
    return res.json({ success: true, ...result });
  });

  getById = handle(async (req, res) => {
    const nurse = await nurseStaffService.getNurseStaffById(req.params.id);
    return res.json({ success: true, data: nurse });
  });

  getByDepartment = handle(async (req, res) => {
    const nurses = await nurseStaffService.getNursesByDepartment(
      req.params.deptId,
    );
    return res.json({ success: true, data: nurses, count: nurses.length });
  });

  update = handle(async (req, res) => {
    const nurse = await nurseStaffService.updateNurseStaff(
      req.params.id,
      req.body,
    );
    return res.json({ success: true, data: nurse });
  });

  toggleStatus = handle(async (req, res) => {
    const result = await nurseStaffService.toggleNurseStatus(req.params.id);
    return res.json({ success: true, data: result });
  });

  remove = handle(async (req, res) => {
    await nurseStaffService.deleteNurseStaff(req.params.id);
    return res.json({ success: true, message: "Nurse staff deleted" });
  });
}

module.exports = new NurseStaffController();
