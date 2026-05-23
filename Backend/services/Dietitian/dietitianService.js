// services/Dietitian/dietitianService.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-9 / D6-CRIT-6 + R7bj-F2: Dietitian → Kitchen indent push.
//
// Pre-R7bb the dietitian created a PatientDietPlan but the kitchen ran
// on verbal handovers and prior-day tray lists. NABH COP.18 expects a
// documented diet-order → kitchen-receipt trail with timestamps.
//
// Pre-R7bj the fan-out used a per-iteration findOne-then-save loop
// (R7bi-1-CRIT-10 — race window between two dietitian clicks
// duplicated trays; R7bi-5-CRIT-1 — a mid-loop failure left a partial
// indent set so the kitchen fed wrong-patient half-meals;
// R7bi-1-CRIT-16 — no admission.status check, discharged patient
// indents kept going to an empty bed).
//
// R7bj-F2 close-loop fixes:
//   • Wrap the entire push in a mongoose transaction
//     (session.withTransaction) so the whole meal set lands atomically
//     — either every row or none. Closes 5-CRIT-1.
//   • Replace the per-iteration findOne+save loop with a single
//     bulkWrite upsert keyed on (planId, mealSlot, dateKey). Closes
//     1-CRIT-10 (race) and turns N round-trips into one. The
//     supporting partial-unique index lives on the KitchenIndent
//     schema (R7bj-F2 — uniq_indent_per_plan_slot_day).
//   • Reject push if Admission.status !== "Active" (1-CRIT-16).
//   • On re-push (plan revision) the upsert touches future-only meal
//     slots; rows whose dateKey < today's IST date are skipped so a
//     served / billed past meal can't be silently rewritten
//     (R7bi-1-CRIT-12).
//
// pushToKitchenIndent(planId, actor):
//   1. Load the active PatientDietPlan (must be status=draft/active).
//   2. Verify the linked admission is still status=Active.
//   3. Within a transaction, bulkWrite-upsert one KitchenIndent row
//      per meal in plan.meals[] — atomic per push, idempotent on
//      (planId, mealSlot, dateKey).
//   4. Stamp the indent with the actor (dietitian) for audit.
//   5. Return the created/updated counts + the post-upsert indents.
// ════════════════════════════════════════════════════════════════════

"use strict";

const mongoose = require("mongoose");
const KitchenIndent = require("../../models/Pharmacy/KitchenIndentModel");
const { PatientDietPlan } = require("../../models/Clinical/DietitianModels");
const Admission = require("../../models/Patient/admissionModel");

// Heuristic mapping from meal-time labels to the KitchenIndent enum
// slot. Templates seeded in DietPlanTemplate use English labels like
// "Early Morning", "Breakfast", "Mid-Morning", "Lunch", "Tea", "Dinner",
// "Bedtime", "RT Feed". Map liberally so any sensible label lands on
// a known slot; anything we can't map goes to OTHER.
function mapMealSlot(label = "") {
  const s = String(label).toLowerCase().trim();
  if (/early\s*morning|wake/.test(s))                    return "EARLY_MORNING";
  if (/breakfast/.test(s))                                return "BREAKFAST";
  if (/mid[-\s]*morning|11\s*am|11:00/.test(s))           return "MID_MORNING";
  if (/lunch/.test(s))                                    return "LUNCH";
  if (/afternoon|tea\b|4\s*pm|4:00|snack/.test(s))        return "AFTERNOON_SNACK";
  if (/dinner|supper/.test(s))                            return "DINNER";
  if (/bedtime|night|9\s*pm|10\s*pm/.test(s))             return "BEDTIME";
  if (/rt\b|tube|ryle|ng\b|enteral/.test(s))              return "RT_FEED";
  return "OTHER";
}

// Convert "Breakfast" / "8 AM" labels to a Date for today's slot. If
// the slot has already passed, push it to tomorrow so the kitchen
// receives the next-cycle indent (not yesterday's).
function nextSlotTime(label = "") {
  // Default slot times (24h). Conservative — kitchen staff edit on
  // receipt if their hospital's mealtimes differ.
  const map = {
    EARLY_MORNING:    "06:00",
    BREAKFAST:        "08:00",
    MID_MORNING:      "11:00",
    LUNCH:            "13:00",
    AFTERNOON_SNACK:  "16:00",
    DINNER:           "20:00",
    BEDTIME:          "22:00",
    RT_FEED:          "10:00",
    OTHER:            "12:00",
  };
  const slot = mapMealSlot(label);
  const hhmm = map[slot] || "12:00";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // If already passed by > 30 min, schedule for tomorrow.
  if (d.getTime() + 30 * 60 * 1000 < Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// IST calendar-day key (YYYY-MM-DD) for a Date — matches the dateKey
// dimension on the KitchenIndent dedup index + BillingTrigger trigger
// emit. Centralised so push + service emit + UI all agree.
function _istDateKey(d) {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

class DietitianService {
  /**
   * Push a PatientDietPlan's meal plan to the kitchen as a set of
   * KitchenIndent rows. One row per meal slot. Atomic + idempotent on
   * (planId, mealSlot, dateKey).
   *
   * @param {string} planId
   * @param {{ id?:string, _id?:string, fullName?:string, role?:string }} actor
   * @returns {Promise<{ created:number, updated:number, skipped:number, indents:Array }>}
   */
  async pushToKitchenIndent(planId, actor = {}) {
    if (!planId || !mongoose.isValidObjectId(planId)) {
      const err = new Error("planId required");
      err.status = 400; throw err;
    }
    const plan = await PatientDietPlan.findById(planId).lean();
    if (!plan) {
      const err = new Error("Diet plan not found");
      err.status = 404; throw err;
    }
    if (!["draft", "active"].includes(plan.status)) {
      const err = new Error(
        `Diet plan is ${plan.status} — only draft or active plans can push to kitchen`,
      );
      err.status = 409; throw err;
    }
    const meals = (plan.plan?.meals && plan.plan.meals.length)
      ? plan.plan.meals
      : [];
    if (!meals.length) {
      const err = new Error(
        "Plan has no meals[] — populate from a template (or add custom meals) before pushing to the kitchen",
      );
      err.status = 422; throw err;
    }

    // ── R7bj-F2 / R7bi-1-CRIT-16: active-admission gate ─────────
    // Pick up bed / ward + verify admission is still Active. A
    // discharged / cancelled admission must not receive trays.
    let bedNumber = "", ward = "", ipdNo = "";
    if (plan.admissionId) {
      const a = await Admission.findById(plan.admissionId)
        .select("bedNumber wardId admissionNumber status")
        .populate("wardId", "wardName name")
        .lean();
      if (!a) {
        const err = new Error("Admission for this plan not found");
        err.status = 404; throw err;
      }
      if (a.status !== "Active") {
        const err = new Error(
          `Admission is ${a.status} — kitchen push refused (NABH COP.18 — discharged / cancelled patients receive no trays)`,
        );
        err.status = 409; err.code = "ADMISSION_NOT_ACTIVE"; throw err;
      }
      bedNumber = a.bedNumber || "";
      ward      = a.wardId?.wardName || a.wardId?.name || "";
      ipdNo     = a.admissionNumber || "";
    }

    const allergens  = plan.assessment?.allergens?.length
      ? plan.assessment.allergens
      : (plan.assessment?.allergies || []);

    const planContraind = (plan.plan?.notes || "").split(/[,;]/)
      .map((s) => s.trim()).filter(Boolean);

    // ── R7bj-F2 / R7bi-1-CRIT-12: future-only on re-push ────────
    // On a plan revision we only fan out indents for meal slots
    // whose dateKey is today or later. A past slot already has its
    // billing trail; rewriting it would orphan the trigger.
    const todayKey = _istDateKey(new Date());

    // Compose the bulkWrite ops — one upsert per future meal slot.
    const ops = [];
    let skipped = 0;
    for (const meal of meals) {
      const mealSlot     = mapMealSlot(meal.time || "");
      const scheduledFor = nextSlotTime(meal.time || "");
      const dateKey      = _istDateKey(scheduledFor);
      if (dateKey < todayKey) { skipped += 1; continue; }

      const items = (meal.items || [])
        .map((it) => it?.en || it?.hi || "")
        .filter(Boolean);

      const setOnInsert = {
        planId:           plan._id,
        UHID:             plan.UHID,
        patientName:      plan.patientName || "",
        admissionId:      plan.admissionId || null,
        ipdNo,
        bedNumber,
        ward,
        mealSlot,
        mealSlotLabel:    meal.time || "",
        scheduledFor,
        dateKey,
        status:           "PENDING",
        createdBy:        actor.fullName || "",
        createdById:      actor.id || actor._id || null,
        createdByRole:    actor.role || "",
      };
      const set = {
        // Safe-to-update fields on an existing PENDING/PREPARED row
        // — items + allergens + restrictions reflect the latest plan.
        // We deliberately do NOT overwrite status / actor trios /
        // billingTriggerId here — those are owned by the kitchen
        // service's transitions.
        items,
        instructions:     plan.plan?.customisations || "",
        allergens,
        contraindications: planContraind,
        targetCalories:   plan.plan?.targetCalories ?? null,
        targetProtein:    plan.plan?.targetProtein  ?? null,
        fluidRestriction: plan.plan?.fluidRestriction ?? null,
        saltRestriction:  plan.plan?.saltRestriction  ?? null,
        foodPreference:   plan.assessment?.foodPreference || "",
        swallowingNote:   plan.assessment?.swallowing || "normal",
      };

      ops.push({
        updateOne: {
          filter: { planId: plan._id, mealSlot, dateKey },
          update: { $setOnInsert: setOnInsert, $set: set },
          upsert: true,
        },
      });
    }

    if (!ops.length) {
      return { created: 0, updated: 0, skipped, indents: [] };
    }

    // ── R7bj-F2 / R7bi-5-CRIT-1 / Node 5-CRIT-1 — atomic fan-out ──
    // Wrap in session.withTransaction so a mid-list failure rolls
    // back the partial set. bulkWrite is already a single round-trip,
    // but transaction semantics keep us safe against a doc-validation
    // error on op #3 stranding the kitchen with ops #1-#2.
    //
    // Standalone-Mongo deploys (dev only) don't have replica-set
    // transactions; the catch below falls back to a non-transactional
    // bulkWrite so dev / CI doesn't break. Production deploys MUST
    // be on a replica set per R7bi-Node-CRIT-1.
    let writeResult;
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        writeResult = await KitchenIndent.bulkWrite(ops, { session, ordered: false });
      });
    } catch (e) {
      const isStandalone = /Transaction numbers are only allowed/i.test(e.message || "")
        || /not supported|replica set/i.test(e.message || "");
      if (!isStandalone) {
        await session.endSession().catch(() => {});
        throw e;
      }
      console.warn("[dietitian.pushToKitchenIndent] standalone-Mongo fallback (no transaction):", e.message);
      writeResult = await KitchenIndent.bulkWrite(ops, { ordered: false });
    } finally {
      await session.endSession().catch(() => {});
    }

    const created = writeResult?.upsertedCount  || 0;
    const updated = writeResult?.modifiedCount  || 0;
    const upsertedIds = Object.values(writeResult?.upsertedIds || {});

    // Re-read the affected rows so the caller (controller) can render
    // the kitchen-side indent list without a second round-trip.
    const planObjId = new mongoose.Types.ObjectId(String(plan._id));
    const indents = await KitchenIndent.find({
      planId: planObjId,
      dateKey: { $gte: todayKey },
    }).sort({ scheduledFor: 1 }).lean();

    return {
      created,
      updated,
      skipped,
      upsertedIds,
      indents,
    };
  }
}

module.exports = new DietitianService();
