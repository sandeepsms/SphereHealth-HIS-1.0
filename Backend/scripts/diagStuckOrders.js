// scripts/diagStuckOrders.js
// ════════════════════════════════════════════════════════════════════
// Diagnostic: "stuck InProgress" doctor orders for UHID UH00000029.
//
// Read-only — prints the live state of every Medication / IV_Fluid
// DoctorOrder for the suspect UHID and flags entries that could be
// blocking the lifecycle flip from InProgress → Completed.
//
// Run:  node scripts/diagStuckOrders.js
// ════════════════════════════════════════════════════════════════════
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const UHID = process.argv[2] || "UH00000029";

function fmtIso(d) {
  if (!d) return "—";
  try { return new Date(d).toISOString(); } catch (_) { return String(d); }
}

function fmtLocal(d) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    return dt.toISOString().slice(0, 10) + " " +
           dt.toISOString().slice(11, 19) + "Z";
  } catch (_) { return String(d); }
}

function pad(s, n) {
  s = String(s == null ? "" : s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

(async () => {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  console.log(`[diagStuckOrders] connecting → ${uri}`);
  await mongoose.connect(uri);
  console.log(`[diagStuckOrders] connected.\n`);

  const DoctorOrder = require(path.join(
    __dirname, "..", "models", "Doctor", "DoctorOrderModel"
  ));

  /* ── today's window (server local interpretation) ───────────────── */
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  console.log(`[diagStuckOrders] NOW          = ${fmtIso(now)}`);
  console.log(`[diagStuckOrders] todayStart   = ${fmtIso(todayStart)}`);
  console.log(`[diagStuckOrders] todayEnd     = ${fmtIso(todayEnd)}`);
  console.log(`[diagStuckOrders] UHID         = ${UHID}\n`);

  /* ── 1. Aggregate counts by orderType + status ──────────────────── */
  console.log("═══════════════════════════════════════════════════════");
  console.log(" 1.  COUNT  by orderType + status");
  console.log("═══════════════════════════════════════════════════════");
  const agg = await DoctorOrder.aggregate([
    { $match: { UHID } },
    { $group: { _id: { type: "$orderType", status: "$status" }, count: { $sum: 1 } } },
    { $sort: { "_id.type": 1, "_id.status": 1 } },
  ]);
  console.log(pad("orderType", 18) + pad("status", 14) + "count");
  console.log("-".repeat(40));
  for (const r of agg) {
    console.log(pad(r._id.type, 18) + pad(r._id.status, 14) + r.count);
  }

  /* ── duplicate (medicineName, orderType, frequency) detection ──── */
  console.log("\n--- duplicate detector (same medicineName + orderType + frequency) ---");
  const dupAgg = await DoctorOrder.aggregate([
    { $match: { UHID, orderType: { $in: ["Medication", "IV_Fluid"] } } },
    { $group: {
      _id: {
        medicineName: "$orderDetails.medicineName",
        orderType: "$orderType",
        frequency: "$orderDetails.frequency",
      },
      count: { $sum: 1 },
      ids: { $push: "$_id" },
      statuses: { $push: "$status" },
    }},
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (dupAgg.length === 0) {
    console.log("(none)");
  } else {
    for (const d of dupAgg) {
      console.log(`  • ${d._id.medicineName} [${d._id.orderType} | ${d._id.frequency}] × ${d.count}`);
      console.log(`      ids: ${d.ids.map(x => String(x)).join(", ")}`);
      console.log(`      statuses: ${d.statuses.join(", ")}`);
    }
  }

  /* ── 2/3. Detailed dump of every Medication / IV_Fluid order ────── */
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" 2.  ORDER  detail dump  (Medication + IV_Fluid)");
  console.log("═══════════════════════════════════════════════════════");
  const orders = await DoctorOrder.find({
    UHID,
    orderType: { $in: ["Medication", "IV_Fluid"] },
  }).lean();

  const flags = {
    pastPendingByOrder: {},   // orderId → [entries]
    futurePendingByOrder: {}, // orderId → [entries]
    todayGivenByOrder: {},    // orderId → [entries]
  };

  for (const o of orders) {
    console.log("\n" + "═".repeat(75));
    console.log(`_id          : ${o._id}`);
    console.log(`orderType    : ${o.orderType}`);
    console.log(`medicineName : ${o.orderDetails?.medicineName || "—"}`);
    console.log(`frequency    : ${o.orderDetails?.frequency || "—"}`);
    console.log(`duration     : ${o.orderDetails?.duration || "—"}`);
    console.log(`STATUS       : ${o.status}`);
    console.log(`orderedAt    : ${fmtIso(o.orderedAt)}`);
    console.log(`orderedBy    : ${o.orderedBy || "—"}`);
    console.log(`AR entries   : ${(o.administrationRecord || []).length}`);

    const past = []; const future = []; const todayGiven = []; const todayPending = [];

    if (Array.isArray(o.administrationRecord) && o.administrationRecord.length > 0) {
      console.log("\n  administrationRecord:");
      console.log("  " + pad("#", 4) + pad("schedTime", 11) + pad("scheduledDate (ISO)", 27) +
                  pad("status", 10) + pad("givenAt", 24) + pad("givenBy", 18) + "stat?");
      console.log("  " + "-".repeat(110));
      o.administrationRecord.forEach((a, i) => {
        const schedDate = a.scheduledDate ? new Date(a.scheduledDate) : null;
        const isPast    = schedDate && schedDate < todayStart;
        const isFuture  = schedDate && schedDate > todayEnd;
        const isToday   = schedDate && schedDate >= todayStart && schedDate <= todayEnd;
        console.log("  " +
          pad(i, 4) +
          pad(a.scheduledTime, 11) +
          pad(fmtIso(a.scheduledDate), 27) +
          pad(a.status, 10) +
          pad(fmtIso(a.givenAt), 24) +
          pad(a.givenBy || "", 18) +
          (a.isStatDose ? "Y" : ""));
        if (a.status === "pending" && isPast)   past.push({ i, ...a });
        if (a.status === "pending" && isFuture) future.push({ i, ...a });
        if (a.status === "given"   && isToday)  todayGiven.push({ i, ...a });
        if (a.status === "pending" && isToday)  todayPending.push({ i, ...a });
      });
    } else {
      console.log("  (no administrationRecord entries)");
    }

    /* ── per-order flags ─── */
    console.log("\n  flags:");
    console.log(`    past-pending     : ${past.length}`);
    console.log(`    future-pending   : ${future.length}`);
    console.log(`    today-given      : ${todayGiven.length}`);
    console.log(`    today-pending    : ${todayPending.length}`);

    if (past.length)   flags.pastPendingByOrder[o._id]   = past;
    if (future.length) flags.futurePendingByOrder[o._id] = future;
    if (todayGiven.length) flags.todayGivenByOrder[o._id] = todayGiven;

    /* ── verdict for this order ─── */
    if (o.status === "InProgress" || o.status === "Active") {
      const totalPending = (o.administrationRecord || []).filter(a => a.status === "pending").length;
      const totalGiven   = (o.administrationRecord || []).filter(a => a.status === "given").length;
      const totalAR      = (o.administrationRecord || []).length;
      console.log(`\n  STATE: ${o.status}   (totalAR=${totalAR}, given=${totalGiven}, pending=${totalPending})`);
      if (past.length > 0) {
        console.log(`  → BLOCKER: ${past.length} past-day pending slot(s) — these never got marked missed/given/skipped,`);
        console.log(`              so the lifecycle still sees outstanding work and refuses to flip to Completed.`);
        past.forEach(p => {
          console.log(`              · AR[${p.i}]  schedDate=${fmtIso(p.scheduledDate)}  time=${p.scheduledTime}  status=${p.status}`);
        });
      }
      if (future.length > 0) {
        console.log(`  → INFO: ${future.length} future-dated pending slot(s) (expected for multi-day orders not yet at completion).`);
      }
      if (past.length === 0 && totalPending === 0) {
        console.log(`  → All AR entries terminal but status still ${o.status} — controller never flipped it.`);
      }
    }
  }

  /* ── 3. Aggregated "blocking entries" recap ─────────────────────── */
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log(" 3.  BLOCKING entries summary");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n[A] pending entries with scheduledDate BEFORE today:");
  let totalPast = 0;
  for (const [oid, list] of Object.entries(flags.pastPendingByOrder)) {
    const order = orders.find(o => String(o._id) === String(oid));
    console.log(`  • ${order?.orderDetails?.medicineName || "?"} (${oid}) — ${list.length} entries`);
    list.forEach(p => {
      console.log(`      AR[${p.i}]  ${fmtIso(p.scheduledDate)}  time=${p.scheduledTime}  status=${p.status}`);
      totalPast++;
    });
  }
  if (totalPast === 0) console.log("  (none)");

  console.log("\n[B] pending entries with scheduledDate AFTER today:");
  let totalFuture = 0;
  for (const [oid, list] of Object.entries(flags.futurePendingByOrder)) {
    const order = orders.find(o => String(o._id) === String(oid));
    console.log(`  • ${order?.orderDetails?.medicineName || "?"} (${oid}) — ${list.length} entries`);
    list.slice(0, 5).forEach(p => {
      console.log(`      AR[${p.i}]  ${fmtIso(p.scheduledDate)}  time=${p.scheduledTime}  status=${p.status}`);
      totalFuture++;
    });
    if (list.length > 5) console.log(`      ... (${list.length - 5} more)`);
  }
  if (totalFuture === 0) console.log("  (none)");

  console.log("\n[C] given entries scheduled for TODAY:");
  for (const [oid, list] of Object.entries(flags.todayGivenByOrder)) {
    const order = orders.find(o => String(o._id) === String(oid));
    console.log(`  • ${order?.orderDetails?.medicineName || "?"} (${oid}) — ${list.length} entries`);
    list.forEach(p => {
      console.log(`      AR[${p.i}]  ${fmtIso(p.scheduledDate)}  time=${p.scheduledTime}  givenAt=${fmtIso(p.givenAt)}  by=${p.givenBy}`);
    });
  }

  await mongoose.disconnect();
  console.log("\n[diagStuckOrders] done.");
})().catch(async (e) => {
  console.error("[diagStuckOrders] ERROR:", e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
