/**
 * nursingChargesService.js
 *
 * Handles:
 *  - Master item catalogue CRUD
 *  - Logging equipment used per shift (with daily dedup)
 *  - Fetching today's charges for a patient
 *  - Voiding a charge entry
 */

const NursingConsumableItem = require("../../models/nursing/NursingConsumableItem");
const NursingChargeEntry    = require("../../models/nursing/NursingChargeEntry");
const Admission             = require("../../models/Patient/admissionModel");

/* ── helper: "2026-04-15" from a Date ── */
const toDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ═══════════════════════════════════════════════════════
   MASTER CATALOGUE
══════════════════════════════════════════════════════ */

exports.getAllItems = async () =>
  NursingConsumableItem.find({ isActive: true }).sort({ category: 1, name: 1 }).lean();

exports.createItem = async (body) => {
  const item = new NursingConsumableItem(body);
  return item.save();
};

exports.updateItem = async (id, body) =>
  NursingConsumableItem.findByIdAndUpdate(id, body, { new: true, runValidators: true });

exports.deleteItem = async (id) =>
  NursingConsumableItem.findByIdAndUpdate(id, { isActive: false });

/* ═══════════════════════════════════════════════════════
   SEED DEFAULT ITEMS (called on first startup if DB empty)
══════════════════════════════════════════════════════ */

const DEFAULT_ITEMS = [
  // Oxygen & Respiratory
  { name: "Oxygen Mask (Simple)",        category: "Oxygen & Respiratory", unitPrice: 80,   chargeOncePerDay: true  },
  { name: "Oxygen Mask (Non-Rebreather)",category: "Oxygen & Respiratory", unitPrice: 150,  chargeOncePerDay: true  },
  { name: "Nasal Cannula",               category: "Oxygen & Respiratory", unitPrice: 50,   chargeOncePerDay: true  },
  { name: "Nebulization",                category: "Oxygen & Respiratory", unitPrice: 120,  chargeOncePerDay: false },
  { name: "Oxygen Cylinder (per day)",   category: "Oxygen & Respiratory", unitPrice: 500,  chargeOncePerDay: true  },
  { name: "Ventilator Support (per day)",category: "Oxygen & Respiratory", unitPrice: 3500, chargeOncePerDay: true  },
  // IV & Lines
  { name: "IV Cannula (18G)",            category: "IV & Lines",           unitPrice: 60,   chargeOncePerDay: false },
  { name: "IV Cannula (20G)",            category: "IV & Lines",           unitPrice: 55,   chargeOncePerDay: false },
  { name: "IV Infusion Set",             category: "IV & Lines",           unitPrice: 40,   chargeOncePerDay: false },
  { name: "Central Line (CVP)",          category: "IV & Lines",           unitPrice: 2500, chargeOncePerDay: true  },
  { name: "Infusion Pump (per day)",     category: "IV & Lines",           unitPrice: 400,  chargeOncePerDay: true  },
  { name: "Syringe Pump (per day)",      category: "IV & Lines",           unitPrice: 300,  chargeOncePerDay: true  },
  // Monitoring
  { name: "Pulse Oximeter (per day)",    category: "Monitoring",           unitPrice: 200,  chargeOncePerDay: true  },
  { name: "BP Cuff (per day)",           category: "Monitoring",           unitPrice: 100,  chargeOncePerDay: true  },
  { name: "ECG Monitoring (per day)",    category: "Monitoring",           unitPrice: 350,  chargeOncePerDay: true  },
  { name: "Glucometer Strip",            category: "Monitoring",           unitPrice: 30,   chargeOncePerDay: false },
  { name: "Temperature Probe",           category: "Monitoring",           unitPrice: 50,   chargeOncePerDay: true  },
  // Wound & Skin
  { name: "Dressing (Simple)",           category: "Wound & Skin",         unitPrice: 150,  chargeOncePerDay: false },
  { name: "Dressing (Complex)",          category: "Wound & Skin",         unitPrice: 350,  chargeOncePerDay: false },
  { name: "Suture Removal Set",          category: "Wound & Skin",         unitPrice: 120,  chargeOncePerDay: false },
  { name: "Foam Dressing (Allevyn)",     category: "Wound & Skin",         unitPrice: 800,  chargeOncePerDay: false },
  // Urinary
  { name: "Foley Catheter Insertion",    category: "Urinary",              unitPrice: 300,  chargeOncePerDay: false },
  { name: "Urine Bag (per day)",         category: "Urinary",              unitPrice: 80,   chargeOncePerDay: true  },
  { name: "Urinary Catheter Kit",        category: "Urinary",              unitPrice: 450,  chargeOncePerDay: false },
  // Feeding
  { name: "Ryle's Tube (NGT) Insertion", category: "Feeding",             unitPrice: 250,  chargeOncePerDay: false },
  { name: "NGT Feed (per session)",      category: "Feeding",             unitPrice: 100,  chargeOncePerDay: false },
  // Disposables
  { name: "Gloves (per pair)",           category: "Disposables",          unitPrice: 15,   chargeOncePerDay: false },
  { name: "Syringe 5ml",                category: "Disposables",          unitPrice: 8,    chargeOncePerDay: false },
  { name: "Syringe 10ml",               category: "Disposables",          unitPrice: 10,   chargeOncePerDay: false },
  { name: "Syringe 20ml",               category: "Disposables",          unitPrice: 12,   chargeOncePerDay: false },
  { name: "Alcohol Swabs (pack)",        category: "Disposables",          unitPrice: 20,   chargeOncePerDay: false },
  { name: "Face Mask (Surgical)",        category: "Disposables",          unitPrice: 10,   chargeOncePerDay: false },
];

exports.seedDefaultItems = async () => {
  const count = await NursingConsumableItem.countDocuments();
  if (count > 0) return;
  await NursingConsumableItem.insertMany(DEFAULT_ITEMS);
  console.log("✅ Seeded", DEFAULT_ITEMS.length, "nursing consumable items");
};

/* ═══════════════════════════════════════════════════════
   CHARGE ENTRIES
══════════════════════════════════════════════════════ */

/**
 * logItems — record equipment used in a shift.
 *
 * @param {Object} opts
 *   admissionId  - Admission._id
 *   items        - [{ itemId, quantity }]
 *   shift        - "morning" | "afternoon" | "evening" | "night"
 *   chargedBy    - nurse display name
 *   chargedById  - User._id (optional)
 *   dateKey      - "2026-04-15"  (defaults to today)
 *
 * Returns { saved: [...], skipped: [...] }
 *   skipped = already charged today (chargeOncePerDay items)
 */
exports.logItems = async ({ admissionId, items, shift, chargedBy, chargedById, dateKey }) => {
  if (!admissionId || !items?.length) throw new Error("admissionId and items are required");

  const admission = await Admission.findById(admissionId).lean();
  if (!admission) throw new Error("Admission not found");

  const today = dateKey || toDateKey();
  const saved = [];
  const skipped = [];

  for (const { itemId, quantity = 1 } of items) {
    const item = await NursingConsumableItem.findById(itemId).lean();
    if (!item || !item.isActive) continue;

    // Daily dedup check — only for chargeOncePerDay items
    if (item.chargeOncePerDay) {
      const exists = await NursingChargeEntry.findOne({
        admissionId,
        itemId,
        dateKey: today,
        status: "active",
      }).lean();

      if (exists) {
        skipped.push({ itemId, itemName: item.name, reason: "Already charged today" });
        continue;
      }
    }

    const entry = await NursingChargeEntry.create({
      admissionId,
      patientId:   admission.patientId,
      UHID:        admission.UHID,
      itemId,
      itemName:    item.name,
      category:    item.category,
      unitPrice:   item.unitPrice,
      quantity,
      totalAmount: item.unitPrice * quantity,
      dateKey:     today,
      shift,
      chargedBy,
      chargedById: chargedById || undefined,
      status:      "active",
    });

    // Hook into auto-billing so the consumable lands on the patient's
    // bill the moment the nurse logs it. Previously these entries were
    // created here but never propagated — `onEquipmentCharged` existed
    // in autoBillingService but nothing called it. Fire-and-forget; if
    // the bill is closed (PAID/CANCELLED/REFUNDED) the auto-billing
    // engine marks the trigger as "skipped" and the entry still stays
    // on file for audit.
    try {
      const autoBilling = require("../Billing/autoBillingService");
      autoBilling.onEquipmentCharged(entry).catch((e) =>
        console.error("[NursingCharges] auto-bill error:", e.message),
      );
    } catch (e) {
      console.error("[NursingCharges] could not load autoBillingService:", e.message);
    }

    saved.push(entry);
  }

  return { saved, skipped };
};

/**
 * getTodayCharges — all active entries for an admission on a given date.
 */
exports.getTodayCharges = async (admissionId, dateKey) => {
  const today = dateKey || toDateKey();
  return NursingChargeEntry.find({ admissionId, dateKey: today, status: "active" })
    .populate("itemId", "name category unitPrice chargeOncePerDay")
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * getAllCharges — full charge history for an admission.
 */
exports.getAllCharges = async (admissionId) =>
  NursingChargeEntry.find({ admissionId, status: "active" })
    .sort({ dateKey: -1, createdAt: -1 })
    .lean();

/**
 * voidEntry — nurse removes an entry (before billing is finalised).
 */
exports.voidEntry = async (entryId, reason, actor = {}) => {
  const entry = await NursingChargeEntry.findById(entryId);
  if (!entry) throw new Error("Charge entry not found");
  if (entry.status === "voided") return entry; // idempotent

  // R7hr-238 (audit: void ANY charge hospital-wide) — voidEntry had no actor
  // scoping, so anyone holding billing.manual-charge could void any nursing
  // charge for any patient. A nurse may now only void a charge they themselves
  // entered; Admin/Accountant may void any.
  const role = actor.role || "";
  if (role !== "Admin" && role !== "Accountant") {
    const owner  = String(entry.chargedById || "");
    const caller = String(actor._id || actor.id || "");
    if (!owner || !caller || owner !== caller) {
      const e = new Error("You can only void a nursing charge you entered — ask Admin/Accountant to void others.");
      e.status = 403; e.code = "NOT_YOUR_CHARGE"; throw e;
    }
  }

  // R7hr-238 (audit: dead `billed` guard) — the boolean is never set true, so
  // also check for a real BillingTrigger (onEquipmentCharged stamps
  // sourceDocumentId = entry._id). Once the charge is on the bill, voiding it
  // here would desync the ledger — route the reversal through billing instead.
  const BillingTrigger = require("../../models/Billing/BillingTrigger");
  const onBill = entry.billed || !!(await BillingTrigger.exists({ sourceDocumentId: entry._id, status: { $ne: "voided" } }));
  if (onBill) throw new Error("Cannot void a billed entry — contact billing to reverse it.");

  entry.status = "voided";
  entry.voidReason = reason || "Removed by nurse";
  return entry.save();
};

/**
 * getDailyTotals — summary per day for a patient (for billing view).
 */
exports.getDailyTotals = async (admissionId) => {
  const rows = await NursingChargeEntry.aggregate([
    { $match: { admissionId: new (require("mongoose").Types.ObjectId)(admissionId), status: "active" } },
    { $group: { _id: "$dateKey", total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);
  return rows;
};
