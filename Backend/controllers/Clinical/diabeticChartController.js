/**
 * diabeticChartController.js
 *
 * Endpoints exposed at /api/diabetic-chart:
 *   GET    /:uhid/:date           — fetch sheet for a UHID on a calendar date
 *   GET    /:uhid                 — list all dates for a UHID (with row counts)
 *   POST   /                      — upsert sheet (admissionId + date)
 *   PUT    /:id/scale             — update sliding-scale policy
 *   POST   /:id/entry             — append or replace an entry by slot
 *   PUT    /:id/entry/:entryId    — patch an entry (BG / dose / status)
 *   DELETE /:id/entry/:entryId    — soft-remove an entry
 */
const DiabeticChart = require("../../models/Clinical/DiabeticChartModel");
const Admission     = require("../../models/Patient/admissionModel");

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Pick the matching rule from sliding scale (handles inclusive ranges).
function recommend(scale, bg) {
  if (bg == null || isNaN(bg) || !scale?.rules?.length) return { dose: null, action: "" };
  const hit = scale.rules.find(r => bg >= r.lo && bg <= r.hi);
  return hit ? { dose: hit.dose, action: hit.action } : { dose: null, action: "Out of policy — call doctor" };
}

// GET /:uhid/:date
exports.getByUhidDate = async (req, res) => {
  try {
    const { uhid, date } = req.params;
    const sheet = await DiabeticChart.findOne({ UHID: uhid, date }).lean();
    return res.json({ success: true, data: sheet || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /:uhid  → list of {date, entryCount, abnormalCount} summaries
exports.listByUhid = async (req, res) => {
  try {
    const { uhid } = req.params;
    const sheets = await DiabeticChart.find({ UHID: uhid }).sort({ date: -1 }).lean();
    const summary = sheets.map(s => ({
      _id: s._id,
      date: s.date,
      entryCount: s.entries?.length || 0,
      hypoCount: (s.entries || []).filter(e => e.bgValue != null && e.bgValue < 70).length,
      hyperCount: (s.entries || []).filter(e => e.bgValue != null && e.bgValue > 200).length,
      latestBG: (s.entries || []).reduce((acc, e) => (e.bgValue != null ? e.bgValue : acc), null),
    }));
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /  → upsert by (admissionId, date)
exports.upsertSheet = async (req, res) => {
  try {
    const {
      UHID, admissionId, date = todayStr(),
      patientId, admissionNumber,
      slidingScale, entries,
    } = req.body;

    if (!UHID || !admissionId) {
      return res.status(400).json({ success: false, message: "UHID and admissionId are required" });
    }

    // Resolve patientId from admission if not supplied
    let pid = patientId;
    if (!pid) {
      const adm = await Admission.findById(admissionId).lean();
      pid = adm?.patientId;
      if (!pid) return res.status(400).json({ success: false, message: "Could not resolve patientId from admission" });
    }

    const update = {
      UHID, admissionId, patientId: pid,
      admissionNumber: admissionNumber || "",
      updatedBy: req.user?.fullName || req.user?.name || "System",
    };
    if (slidingScale) update.slidingScale = slidingScale;
    if (entries)      update.entries      = entries;

    const sheet = await DiabeticChart.findOneAndUpdate(
      { admissionId, date },
      {
        $set: update,
        $setOnInsert: {
          createdBy: req.user?.fullName || req.user?.name || "System",
          date,
          // Seed with the default scale only on first create.
          ...(slidingScale ? {} : { slidingScale: DiabeticChart.DEFAULT_SLIDING_SCALE }),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /:id/scale
exports.updateScale = async (req, res) => {
  try {
    const sheet = await DiabeticChart.findByIdAndUpdate(
      req.params.id,
      { $set: { slidingScale: { ...req.body, setAt: new Date() } } },
      { new: true }
    );
    if (!sheet) return res.status(404).json({ success: false, message: "Sheet not found" });
    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /:id/entry  → append or replace by slot
exports.addOrReplaceEntry = async (req, res) => {
  try {
    const sheet = await DiabeticChart.findById(req.params.id);
    if (!sheet) return res.status(404).json({ success: false, message: "Sheet not found" });

    const payload = { ...req.body };
    // Auto-fill recommendedDose from sliding scale if not supplied
    if (payload.bgValue != null && payload.recommendedDose == null) {
      payload.recommendedDose = recommend(sheet.slidingScale, payload.bgValue).dose;
    }
    // Auto-status logic
    if (!payload.status) {
      if (payload.bgValue != null && payload.bgValue < 70)         payload.status = "hypo-flag";
      else if (payload.actualDose != null && payload.actualDose > 0) payload.status = "given";
      else if (payload.bgValue != null)                              payload.status = "bg-only";
      else                                                            payload.status = "pending";
    }

    // Replace by slot+scheduledTime if it exists, otherwise append.
    const idx = sheet.entries.findIndex(
      e => e.slot === payload.slot &&
           (!payload.scheduledTime || e.scheduledTime === payload.scheduledTime)
    );
    if (idx >= 0) {
      sheet.entries[idx] = { ...sheet.entries[idx].toObject(), ...payload };
    } else {
      sheet.entries.push(payload);
    }

    sheet.updatedBy = req.user?.fullName || req.user?.name || "System";
    await sheet.save();
    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /:id/entry/:entryId  → patch a specific entry by sub-doc id
exports.patchEntry = async (req, res) => {
  try {
    const sheet = await DiabeticChart.findById(req.params.id);
    if (!sheet) return res.status(404).json({ success: false, message: "Sheet not found" });

    const entry = sheet.entries.id(req.params.entryId);
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });

    Object.assign(entry, req.body);

    // Re-derive status if BG or actualDose changed and status not explicit
    if (!("status" in req.body)) {
      if (entry.bgValue != null && entry.bgValue < 70)               entry.status = "hypo-flag";
      else if (entry.actualDose != null && entry.actualDose > 0)     entry.status = "given";
      else if (entry.bgValue != null)                                 entry.status = "bg-only";
    }

    await sheet.save();
    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /:id/entry/:entryId
exports.deleteEntry = async (req, res) => {
  try {
    const sheet = await DiabeticChart.findById(req.params.id);
    if (!sheet) return res.status(404).json({ success: false, message: "Sheet not found" });
    const entry = sheet.entries.id(req.params.entryId);
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
    entry.deleteOne();
    await sheet.save();
    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Helper exposed for clients that just want to ask "what dose for BG=X?"
exports.recommendDose = async (req, res) => {
  try {
    const { id } = req.params;
    const bg = Number(req.query.bg);
    const sheet = await DiabeticChart.findById(id).lean();
    if (!sheet) return res.status(404).json({ success: false, message: "Sheet not found" });
    res.json({ success: true, data: recommend(sheet.slidingScale, bg) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
