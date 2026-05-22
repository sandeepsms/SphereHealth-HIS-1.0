// services/Dietitian/dietitianService.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-9 / D6-CRIT-6: Dietitian → Kitchen indent push.
//
// Pre-R7bb the dietitian created a PatientDietPlan but the kitchen ran
// on verbal handovers and prior-day tray lists. NABH COP.18 expects a
// documented diet-order → kitchen-receipt trail with timestamps.
//
// pushToKitchenIndent(planId, actor):
//   1. Load the active PatientDietPlan (must be status=draft/active).
//   2. Fan out one KitchenIndent row per meal in plan.meals[] for the
//      next 24h (one slot per meal time). Carries patient identity,
//      ward / bed, the meal items, calorie/protein targets, allergen
//      list, salt/fluid restrictions, and food preference.
//   3. Stamp the indent with the actor (dietitian) for audit.
//   4. Return the created indents.
//
// Idempotent at the (planId, scheduledFor, mealSlot) grain — re-pushing
// the same plan within the same day no-ops existing rows (updates the
// in-memory plan snapshot instead of duplicating).
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const KitchenIndent = require("../../models/Clinical/KitchenIndentModel");
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

class DietitianService {
  /**
   * Push a PatientDietPlan's meal plan to the kitchen as a set of
   * KitchenIndent rows. One row per meal slot. Idempotent on
   * (planId, scheduledFor truncated-to-day, mealSlot).
   *
   * @param {string} planId
   * @param {{ id?:string, _id?:string, fullName?:string, role?:string }} actor
   * @returns {Promise<{ created:number, updated:number, indents:Array }>}
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

    // Pick up the bed / ward from the linked admission (best effort).
    let bedNumber = "", ward = "", ipdNo = "";
    if (plan.admissionId) {
      try {
        const a = await Admission.findById(plan.admissionId)
          .select("bedNumber wardId admissionNumber")
          .populate("wardId", "wardName name")
          .lean();
        if (a) {
          bedNumber = a.bedNumber || "";
          ward      = a.wardId?.wardName || a.wardId?.name || "";
          ipdNo     = a.admissionNumber || "";
        }
      } catch (_) { /* non-fatal — kitchen UI handles missing ward */ }
    }

    const allergens  = plan.assessment?.allergens?.length
      ? plan.assessment.allergens
      : (plan.assessment?.allergies || []);

    const planContraind = (plan.plan?.notes || "").split(/[,;]/)
      .map((s) => s.trim()).filter(Boolean);

    let created = 0, updated = 0;
    const indents = [];
    for (const meal of meals) {
      const mealSlot      = mapMealSlot(meal.time || "");
      const scheduledFor  = nextSlotTime(meal.time || "");
      const items = (meal.items || []).map((it) => it?.en || it?.hi || "").filter(Boolean);

      // Idempotency: a KitchenIndent already on the same plan + slot +
      // calendar day is updated in place, not duplicated.
      const dayStart = new Date(scheduledFor); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(dayStart);     dayEnd.setDate(dayEnd.getDate() + 1);
      const payload = {
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
        createdBy:        actor.fullName || "",
        createdById:      actor.id || actor._id || null,
        createdByRole:    actor.role || "",
      };

      const existing = await KitchenIndent.findOne({
        planId:       plan._id,
        mealSlot,
        scheduledFor: { $gte: dayStart, $lt: dayEnd },
        status:       { $in: ["PENDING", "PREPARED"] },
      });
      if (existing) {
        Object.assign(existing, payload);
        await existing.save();
        updated += 1;
        indents.push(existing);
      } else {
        const row = await KitchenIndent.create(payload);
        created += 1;
        indents.push(row);
      }
    }

    return { created, updated, indents };
  }
}

module.exports = new DietitianService();
