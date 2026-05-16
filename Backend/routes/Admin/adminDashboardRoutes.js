/**
 * adminDashboardRoutes.js — single aggregate endpoint that powers
 * the Admin "Mission Control" home dashboard.
 *
 *   GET /api/admin-dashboard/overview
 *
 * Returns hospital-wide KPIs, today's revenue picture, bed-by-ward
 * occupancy, department-wise OPD load, and a chronological live
 * activity feed (registrations + admissions + discharges + pharmacy
 * sales). One round-trip instead of 8.
 *
 * RBAC: requires reports.financial OR users.read so admins (and the
 * accountant, who can also see the financial side) can query it. The
 * route gate is just `requireAction("users.read")` for now since
 * Accountant reads users.read=false — only Admin sees the full
 * picture. If we want Accountant on a trimmed version later, add a
 * `?slim=true` switch and gate it separately.
 */
const express = require("express");
const router  = express.Router();
const { authenticate, requireAction } = require("../../middleware/auth");

const Patient       = require("../../models/Patient/patientModel");
const Admission     = require("../../models/Patient/admissionModel");
const OPD           = require("../../models/Patient/OPDModels");
const Bed           = require("../../models/bedMgmt/bedsModel");
const User          = require("../../models/User/userModel");
const PharmacySale  = require("../../models/Pharmacy/PharmacySaleModel");
const DrugBatch     = require("../../models/Pharmacy/DrugBatchModel");
const Drug          = require("../../models/Pharmacy/DrugModel");
const HospitalSettings = require("../../models/HospitalSettings");

router.use(authenticate);

router.get("/overview", requireAction("users.read"), async (req, res) => {
  try {
    const today      = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow   = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday  = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const ninetyDays = new Date(today); ninetyDays.setDate(ninetyDays.getDate() + 90);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    /* Fire every aggregation in parallel — keeps the round-trip under
       ~200ms on a warm Mongo, even with full pipelines. */
    const [
      hospitalSettings,
      staffCount,
      patientCount,
      ipdActive,
      opdToday,
      opdYesterday,
      bedsAll,
      pharmacyToday,
      pharmacyMTD,
      pharmacyYesterday,
      drugsCount,
      expiringBatches,
      expiredBatches,
      lowStockDrugs,
      recentAdmissions,
      recentDischarges,
      recentPatients,
      recentSales,
      deptOPDLoad,
      deptIPDLoad,
    ] = await Promise.all([
      HospitalSettings.findOne().lean().catch(() => null),
      User.countDocuments({ isActive: true }).catch(() => 0),
      Patient.estimatedDocumentCount().catch(() => 0),
      // IPD-active = beds actually occupied by an admitted patient.
      // The Admission collection also stores OPD / Day-Care / Services
      // rows (admissionType varies) — without `hasBed: true` we'd
      // double-count them as IPD. See models/Patient/admissionModel.js.
      Admission.countDocuments({ status: "Active", hasBed: true }).catch(() => 0),
      OPD.countDocuments({ visitDate: { $gte: today, $lt: tomorrow } }).catch(() => 0),
      OPD.countDocuments({ visitDate: { $gte: yesterday, $lt: today } }).catch(() => 0),
      Bed.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).catch(() => []),
      PharmacySale.aggregate([
        { $match: { createdAt: { $gte: today, $lt: tomorrow }, status: { $ne: "cancelled" } } },
        { $group: { _id: null, count: { $sum: 1 }, net: { $sum: "$netAmount" }, grand: { $sum: "$grandTotal" } } },
      ]).catch(() => []),
      PharmacySale.aggregate([
        { $match: { createdAt: { $gte: monthStart, $lt: tomorrow }, status: { $ne: "cancelled" } } },
        { $group: { _id: null, count: { $sum: 1 }, net: { $sum: "$netAmount" } } },
      ]).catch(() => []),
      PharmacySale.aggregate([
        { $match: { createdAt: { $gte: yesterday, $lt: today }, status: { $ne: "cancelled" } } },
        { $group: { _id: null, count: { $sum: 1 }, net: { $sum: "$netAmount" } } },
      ]).catch(() => []),
      Drug.countDocuments({ isActive: { $ne: false } }).catch(() => 0),
      DrugBatch.countDocuments({ expiryDate: { $gte: today, $lt: ninetyDays }, currentStock: { $gt: 0 } }).catch(() => 0),
      DrugBatch.countDocuments({ expiryDate: { $lt: today }, currentStock: { $gt: 0 } }).catch(() => 0),
      Drug.aggregate([
        { $lookup: { from: "pharmacydrugbatches", localField: "_id", foreignField: "drug", as: "batches" } },
        { $addFields: { onHand: { $sum: "$batches.currentStock" } } },
        { $match: { reorderLevel: { $gt: 0 }, $expr: { $lte: ["$onHand", "$reorderLevel"] } } },
        { $count: "n" },
      ]).catch(() => []),
      Admission.find({ admissionDate: { $gte: yesterday } })
        .sort({ admissionDate: -1 }).limit(8)
        .select("patientName UHID admissionDate department admissionType status hasBed").lean().catch(() => []),
      Admission.find({ status: "Discharged", dischargeDate: { $gte: yesterday } })
        .sort({ dischargeDate: -1 }).limit(6)
        .select("patientName UHID dischargeDate department").lean().catch(() => []),
      Patient.find({ createdAt: { $gte: yesterday } })
        .sort({ createdAt: -1 }).limit(8)
        .select("fullName firstName lastName UHID createdAt gender").lean().catch(() => []),
      PharmacySale.find({ createdAt: { $gte: yesterday }, status: { $ne: "cancelled" } })
        .sort({ createdAt: -1 }).limit(6)
        .select("billNumber patientName grandTotal createdAt").lean().catch(() => []),
      OPD.aggregate([
        { $match: { visitDate: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: "$department", n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 8 },
      ]).catch(() => []),
      // Same "real IPD only" predicate as above — group by department.
      Admission.aggregate([
        { $match: { status: "Active", hasBed: true } },
        { $group: { _id: "$department", n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 8 },
      ]).catch(() => []),
    ]);

    /* Bed status rollup */
    const bedsByStatus = {};
    bedsAll.forEach(b => { bedsByStatus[b._id] = b.n; });
    const bedsTotal     = Object.values(bedsByStatus).reduce((a, b) => a + b, 0);
    const bedsOccupied  = bedsByStatus["Occupied"] || 0;
    const bedsAvailable = bedsByStatus["Available"] || 0;
    const occupancyPct  = bedsTotal ? Math.round((bedsOccupied / bedsTotal) * 100) : 0;

    /* By-ward occupancy */
    const bedsByWard = await Bed.aggregate([
      { $group: {
          _id: { ward: "$wardName", code: "$wardCode" },
          total:    { $sum: 1 },
          occupied: { $sum: { $cond: [{ $eq: ["$status", "Occupied"] }, 1, 0] } },
          available:{ $sum: { $cond: [{ $eq: ["$status", "Available"] }, 1, 0] } },
      } },
      { $project: {
          _id: 0,
          ward: { $ifNull: ["$_id.ward", "Unassigned"] },
          code: { $ifNull: ["$_id.code", "—"] },
          total: 1, occupied: 1, available: 1,
          occupancyPct: { $cond: [{ $gt: ["$total", 0] }, { $multiply: [{ $divide: ["$occupied", "$total"] }, 100] }, 0] },
      } },
      { $sort: { total: -1 } },
      { $limit: 10 },
    ]).catch(() => []);

    /* Pharmacy figures */
    const phToday     = pharmacyToday[0]     || { count: 0, net: 0, grand: 0 };
    const phMTD       = pharmacyMTD[0]       || { count: 0, net: 0 };
    const phYesterday = pharmacyYesterday[0] || { count: 0, net: 0 };

    /* Build the unified activity feed */
    const activity = [];
    for (const a of recentAdmissions) {
      // Distinguish IPD admissions from OPD / Day-Care visits that also
      // live in the Admission collection — verb + icon + colour all
      // change based on whether a bed was actually assigned.
      const isIPD = !!a.hasBed;
      const isOPD = a.admissionType === "OPD";
      activity.push({
        kind:  isIPD ? "admission" : isOPD ? "opd-visit" : "visit",
        title: isIPD
          ? `${a.patientName || "Patient"} admitted (IPD)`
          : isOPD
            ? `${a.patientName || "Patient"} — OPD visit`
            : `${a.patientName || "Patient"} — ${a.admissionType || "visit"}`,
        sub:  `${a.department || "—"} · ${a.admissionType || ""} · ${a.UHID || ""}`,
        when: a.admissionDate,
        icon: isIPD ? "pi-home" : "pi-user-edit",
        color: isIPD ? "blue" : "purple",
      });
    }
    for (const d of recentDischarges) {
      activity.push({
        kind: "discharge",
        title: `${d.patientName || "Patient"} discharged`,
        sub: `${d.department || "—"} · ${d.UHID || ""}`,
        when: d.dischargeDate,
        icon: "pi-sign-out", color: "green",
      });
    }
    for (const p of recentPatients) {
      const nm = p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "Patient";
      activity.push({
        kind: "registration",
        title: `${nm} registered`,
        sub: `${p.UHID || ""} · ${p.gender || ""}`,
        when: p.createdAt,
        icon: "pi-user-plus", color: "teal",
      });
    }
    for (const s of recentSales) {
      activity.push({
        kind: "sale",
        title: `Pharmacy bill ${s.billNumber || ""}`,
        sub: `${s.patientName || "Walk-in"} · ₹${Math.round(s.grandTotal || 0)}`,
        when: s.createdAt,
        icon: "pi-receipt", color: "orange",
      });
    }
    activity.sort((a, b) => new Date(b.when) - new Date(a.when));
    const activityFeed = activity.slice(0, 20);

    /* Compliance / system health summary from hospital settings */
    const hospital = hospitalSettings ? {
      name:    hospitalSettings.hospitalName || hospitalSettings.name || "SphereHealth Hospital",
      address: [hospitalSettings.address?.line1, hospitalSettings.address?.city].filter(Boolean).join(", "),
      gstin:   hospitalSettings.gstin || "",
      nabh:    (hospitalSettings.accreditations || []).some(a => /NABH/i.test(a.name || "")),
      accreditations: (hospitalSettings.accreditations || []).filter(a => a.name).map(a => a.name).slice(0, 4),
    } : { name: "SphereHealth Hospital", nabh: true, accreditations: ["NABH"] };

    res.json({
      success: true,
      data: {
        generatedAt: new Date(),
        hospital,
        kpi: {
          staff:           staffCount,
          patientsTotal:   patientCount,
          ipdActive,
          opdToday,
          opdYesterday,
          opdDelta:        opdToday - opdYesterday,
          bedsTotal, bedsOccupied, bedsAvailable, occupancyPct,
          pharmacyToday:   phToday.net,
          pharmacyTodayCount: phToday.count,
          pharmacyMTD:     phMTD.net,
          pharmacyYesterday: phYesterday.net,
          pharmacyDelta:   phToday.net - phYesterday.net,
          drugsCount,
          expiringBatches,
          expiredBatches,
          lowStockCount:   lowStockDrugs[0]?.n || 0,
        },
        beds: { byStatus: bedsByStatus, byWard: bedsByWard },
        departments: {
          opdToday: deptOPDLoad.map(d => ({ name: d._id || "Unassigned", n: d.n })),
          ipdActive: deptIPDLoad.map(d => ({ name: d._id || "Unassigned", n: d.n })),
        },
        activity: activityFeed,
      },
    });
  } catch (e) {
    console.error("admin-dashboard/overview error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
