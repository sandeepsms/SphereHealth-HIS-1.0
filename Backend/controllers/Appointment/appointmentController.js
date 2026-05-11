const Appointment = require("../../models/Appointment/appointmentModel");
const OPDRegistration = require("../../models/Patient/OPDModels");

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

  // Conflict check — same doctor + same date + same slot
  const dayStart = new Date(`${appointmentDate}T00:00:00`);
  const dayEnd   = new Date(`${appointmentDate}T23:59:59.999`);
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
    appointmentDate: dayStart,
    slotTime, durationMinutes,
    chiefComplaint, notes, bookedBy,
  });
  return res.status(201).json({ success: true, data: apt });
});

/* GET /api/appointments?date=YYYY-MM-DD&doctorId=...&status=... */
exports.list = handle(async (req, res) => {
  const filter = {};
  if (req.query.date) {
    const d = new Date(`${req.query.date}T00:00:00`);
    const e = new Date(`${req.query.date}T23:59:59.999`);
    filter.appointmentDate = { $gte: d, $lte: e };
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

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd   = new Date(`${date}T23:59:59.999`);
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
   Converts a booked appointment to an OPD visit (the patient has arrived). */
exports.checkIn = handle(async (req, res) => {
  const apt = await Appointment.findById(req.params.id);
  if (!apt) return res.status(404).json({ success: false, message: "Appointment not found" });
  if (apt.status === "CheckedIn" || apt.status === "Completed")
    return res.status(400).json({ success: false, message: "Appointment already checked in" });

  // Create the OPD visit
  const visit = await OPDRegistration.create({
    patientId:        apt.patientId,
    UHID:             apt.UHID,
    patientName:      apt.patientName,
    doctorId:         apt.doctorId,
    department:       apt.departmentId,
    visitDate:        new Date(),
    chiefComplaint:   apt.chiefComplaint,
    consultationFee:  req.body.consultationFee || 0,
    hasAppointment:   true,
  });

  apt.status      = "CheckedIn";
  apt.checkedInAt = new Date();
  apt.opdVisitId  = visit._id;
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
