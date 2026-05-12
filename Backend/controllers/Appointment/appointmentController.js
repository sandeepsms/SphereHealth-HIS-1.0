const Appointment = require("../../models/Appointment/appointmentModel");
const OPDRegistration = require("../../models/Patient/OPDModels");
const OPDService = require("../../services/Patient/OPDService");
const Patient = require("../../models/Patient/patientModel");

// IST date-range helpers so server timezone doesn't shift the day window
// (clinics in India should see Saturday-IST appointments under Saturday,
// not under Sunday-UTC). Appointments stored as `appointmentDate` are
// inserted via this same helper so booking + lookup agree.
const istDayStart = (d) => new Date(`${d}T00:00:00+05:30`);
const istDayEnd   = (d) => new Date(`${d}T23:59:59.999+05:30`);

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};

/* POST /api/appointments
   Body: { patientId?, UHID?, patientName, patientPhone,
           doctorId, doctorName?, departmentId?,
           appointmentDate (YYYY-MM-DD), slotTime ("HH:MM"),
           durationMinutes?, chiefComplaint, bookedBy } */
exports.book = handle(async (req, res) => {
  const {
    patientId, UHID, patientName, patientPhone,
    doctorId, doctorName, departmentId,
    appointmentDate, slotTime, durationMinutes,
    chiefComplaint, notes, bookedBy,
  } = req.body;

  if (!patientName || !patientPhone || !doctorId || !appointmentDate || !slotTime)
    return res.status(400).json({ success: false, message: "patientName, patientPhone, doctorId, appointmentDate, slotTime required" });

  // Conflict check — same doctor + same date + same slot (IST window).
  const dayStart = istDayStart(appointmentDate);
  const dayEnd   = istDayEnd(appointmentDate);
  const conflict = await Appointment.findOne({
    doctorId,
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    slotTime,
    status: { $nin: ["Cancelled", "NoShow"] },
  });
  if (conflict)
    return res.status(409).json({ success: false, message: `Slot already booked for ${slotTime} (${conflict.patientName})` });

  const apt = await Appointment.create({
    patientId, UHID, patientName, patientPhone,
    doctorId, doctorName, departmentId,
    appointmentDate: dayStart, // IST midnight; pairs with istDay* lookups
    slotTime, durationMinutes,
    chiefComplaint, notes, bookedBy,
  });
  return res.status(201).json({ success: true, data: apt });
});

/* GET /api/appointments?date=YYYY-MM-DD&doctorId=...&status=... */
exports.list = handle(async (req, res) => {
  const filter = {};
  if (req.query.date) {
    filter.appointmentDate = { $gte: istDayStart(req.query.date), $lte: istDayEnd(req.query.date) };
  }
  if (req.query.doctorId) filter.doctorId = req.query.doctorId;
  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.q) {
    const q = new RegExp(req.query.q, "i");
    filter.$or = [{ patientName: q }, { patientPhone: q }, { appointmentNumber: q }, { UHID: q }];
  }
  const list = await Appointment.find(filter)
    .populate("doctorId", "personalInfo.fullName professional.specialization")
    .sort({ appointmentDate: 1, slotTime: 1 })
    .limit(500)
    .lean();
  return res.json({ success: true, count: list.length, data: list });
});

/* GET /api/appointments/slots?doctorId=...&date=YYYY-MM-DD
   Returns the time grid for the doctor on the given date with booked
   slots marked. The receptionist picks an available slot from this. */
exports.getSlots = handle(async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date)
    return res.status(400).json({ success: false, message: "doctorId and date required" });

  // Default schedule (Mon-Sat, 9-13 and 17-20) — every 15 min
  // (Real per-doctor schedules would come from a DoctorSchedule model;
  // this default covers small hospitals.)
  const slots = [];
  for (const [start, end] of [["09:00", "13:00"], ["17:00", "20:00"]]) {
    let [h, m] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    while (h < eh || (h === eh && m < em)) {
      slots.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
      m += 15;
      if (m >= 60) { m -= 60; h += 1; }
    }
  }

  const dayStart = istDayStart(date);
  const dayEnd   = istDayEnd(date);
  const booked = await Appointment.find({
    doctorId,
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: ["Cancelled", "NoShow"] },
  }).select("slotTime status patientName").lean();
  const bookedMap = {};
  booked.forEach(b => { bookedMap[b.slotTime] = b; });

  const grid = slots.map(s => ({
    slot: s,
    booked: !!bookedMap[s],
    bookingInfo: bookedMap[s] ? {
      patient: bookedMap[s].patientName,
      status:  bookedMap[s].status,
    } : null,
  }));

  return res.json({ success: true, doctorId, date, grid });
});

/* POST /api/appointments/:id/check-in
   Converts a booked appointment to an OPD visit (the patient has arrived).
   Routes through OPDService so the visit gets the bridging Admission record,
   patient-counter increments, and auto-billing — same as a direct OPD
   registration through the Reception Console. */
exports.checkIn = handle(async (req, res) => {
  const apt = await Appointment.findById(req.params.id);
  if (!apt) return res.status(404).json({ success: false, message: "Appointment not found" });
  if (apt.status === "CheckedIn" || apt.status === "Completed")
    return res.status(400).json({ success: false, message: "Appointment already checked in" });

  // The appointment may have been booked over the phone for a brand-new
  // patient (just name + phone). OPDService requires a real Patient _id —
  // create a stub Patient record so the check-in doesn't fail.
  if (!apt.patientId) {
    const stub = await Patient.create({
      fullName:        apt.patientName,
      gender:          "Other",     // unknown at booking time
      contactNumber:   apt.patientPhone,
      paymentType:     "Cash",
      registrationType: "OPD",
      hasAppointment:  true,
    });
    apt.patientId = stub._id;
    apt.UHID      = stub.UHID;
  }

  // Resolve dept + doctor display names for denormalisation on the visit.
  let deptName = "";
  let doctorName = apt.doctorName || "";
  try {
    if (apt.departmentId) {
      const Dept = require("../../models/Department/department");
      const d = await Dept.findById(apt.departmentId).lean();
      deptName = d?.departmentName || d?.name || "";
    }
    if (!doctorName && apt.doctorId) {
      const Doc = require("../../models/Doctor/doctorModel");
      const doc = await Doc.findById(apt.doctorId).lean();
      doctorName = doc?.personalInfo?.fullName || doc?.fullName || "";
    }
  } catch (e) { /* fallback to blank labels */ }

  // Hand off to OPDService — it generates the visitNumber, creates the
  // bridging Admission, increments patient counters, and fires auto-billing.
  const visit = await OPDService.createOPDVisit({
    patientId:        apt.patientId,
    departmentId:     apt.departmentId,
    department:       deptName,
    doctorId:         apt.doctorId,
    consultantName:   doctorName,
    visitDate:        new Date(),
    chiefComplaint:   apt.chiefComplaint || "Follow-up",
    consultationFee:  req.body.consultationFee || 0,
    hasAppointment:   true,
  });

  apt.status         = "CheckedIn";
  apt.checkedInAt    = new Date();
  apt.opdVisitId     = visit._id;
  apt.opdVisitNumber = visit.visitNumber; // saved for navigation (/opd-details/:visitNumber)
  await apt.save();

  return res.json({ success: true, data: { appointment: apt, opdVisit: visit } });
});

/* POST /api/appointments/:id/cancel  Body: { reason } */
exports.cancel = handle(async (req, res) => {
  const apt = await Appointment.findById(req.params.id);
  if (!apt) return res.status(404).json({ success: false, message: "Appointment not found" });
  apt.status       = "Cancelled";
  apt.cancelledAt  = new Date();
  apt.cancelReason = req.body.reason || "";
  await apt.save();
  return res.json({ success: true, data: apt });
});
