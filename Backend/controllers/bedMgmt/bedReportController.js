// controllers/bedMgmt/bedReportController.js
// NABH MOI.2 — monthly bed utilization report (P3 #16).
//
// Aggregates Admission + Bed data for a given month and returns the
// metrics NABH expects for the Management of Information Indicators
// (MOI.2) audit pack:
//   - bedDays      = sum of (dischargeDate - admissionDate) for the month
//   - admissions   = # admissions in the month
//   - discharges   = # discharges in the month
//   - alos         = bedDays / discharges
//   - turnover     = discharges / total beds
//   - occupancyPct = bedDays / (totalBeds * daysInMonth) * 100
//
// We compute by ward + by room category so the report can highlight
// underutilized cohorts.

const Bed       = require("../../models/bedMgmt/bedsModel");
const Admission = require("../../models/Patient/admissionModel");

function startOfMonth(year, month) { return new Date(year, month - 1, 1, 0, 0, 0, 0); }
function endOfMonth(year, month)   { return new Date(year, month, 0, 23, 59, 59, 999); }
function daysInMonth(year, month)  { return new Date(year, month, 0).getDate(); }

function clampToWindow(date, lo, hi) {
  if (!date) return null;
  const t = new Date(date).getTime();
  return new Date(Math.max(lo.getTime(), Math.min(hi.getTime(), t)));
}

function dayDiff(from, to) {
  if (!from || !to) return 0;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

exports.getMonthlyReport = async (req, res) => {
  try {
    const now = new Date();
    const year  = parseInt(req.query.year,  10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);  // 1-12

    if (month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: "Month must be 1-12" });
    }

    const winStart = startOfMonth(year, month);
    const winEnd   = endOfMonth(year, month);
    const dim      = daysInMonth(year, month);

    // ── Snapshots ──
    const beds = await Bed.find({ isActive: true })
      .populate("room", "roomCategory")
      .lean();
    const totalBeds = beds.length;
    const byWard      = new Map();   // wardName -> { beds, occupied }
    const byCategory  = new Map();   // categoryName -> { beds }
    beds.forEach(b => {
      const w = b.wardName || "(Unassigned)";
      if (!byWard.has(w)) byWard.set(w, { name: w, beds: 0 });
      byWard.get(w).beds += 1;

      const cat = b.room?.roomCategory?.toString?.() || "(Uncategorized)";
      if (!byCategory.has(cat)) byCategory.set(cat, { name: cat, beds: 0 });
      byCategory.get(cat).beds += 1;
    });

    // ── Admissions overlapping the window ──
    // Patient counts as bed-day in the month if admission-discharge
    // window intersects [winStart, winEnd]. Open admissions count up
    // to "now or winEnd, whichever is earlier".
    const admissions = await Admission.find({
      admissionDate: { $lte: winEnd },
      $or: [{ dischargeDate: null }, { dischargeDate: { $gte: winStart } }],
    }).lean();

    let totalBedDays   = 0;
    let admissionsInM  = 0;
    let dischargesInM  = 0;
    const wardBedDays  = {};

    admissions.forEach(a => {
      const admDate = a.admissionDate ? new Date(a.admissionDate) : null;
      const disDate = a.dischargeDate ? new Date(a.dischargeDate) : null;
      if (admDate && admDate >= winStart && admDate <= winEnd) admissionsInM += 1;
      if (disDate && disDate >= winStart && disDate <= winEnd) dischargesInM += 1;

      const effStart = clampToWindow(admDate, winStart, winEnd);
      const effEnd   = clampToWindow(disDate || new Date(), winStart, winEnd);
      const days     = dayDiff(effStart, effEnd);
      totalBedDays  += days;

      const w = a.wardName || "(Unassigned)";
      wardBedDays[w] = (wardBedDays[w] || 0) + days;
    });

    const alos          = dischargesInM > 0 ? +(totalBedDays / dischargesInM).toFixed(2) : 0;
    const turnover      = totalBeds > 0 ? +(dischargesInM / totalBeds).toFixed(2) : 0;
    const occupancyPct  = totalBeds > 0
      ? +((totalBedDays / (totalBeds * dim)) * 100).toFixed(2)
      : 0;

    // Per-ward occupancy %
    const wardRows = Array.from(byWard.values()).map(w => {
      const bd = wardBedDays[w.name] || 0;
      return {
        name:        w.name,
        beds:        w.beds,
        bedDays:     +bd.toFixed(2),
        occupancyPct: w.beds > 0 ? +((bd / (w.beds * dim)) * 100).toFixed(2) : 0,
      };
    }).sort((a, b) => b.occupancyPct - a.occupancyPct);

    return res.json({
      success: true,
      data: {
        period: {
          year,
          month,
          monthName: new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" }),
          start: winStart,
          end:   winEnd,
          days:  dim,
        },
        totals: {
          totalBeds,
          admissions:   admissionsInM,
          discharges:   dischargesInM,
          bedDays:      +totalBedDays.toFixed(2),
          alos,
          turnover,
          occupancyPct,
        },
        byWard:     wardRows,
        byCategory: Array.from(byCategory.values()),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
