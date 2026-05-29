/**
 * roomCategoryChargesController.js — R7en
 *
 * REST endpoints for the per-room-category daily-charges matrix.
 * Mounted at /api/admin/room-charges.
 *
 *   GET    /            → list every active category + its charge sheet
 *   GET    /:id         → fetch a single row (used for the audit drawer)
 *   POST   /            → create a new category row
 *   PUT    /:id         → update a single row's charges (stamps audit trio)
 *   DELETE /:id         → soft-delete (active=false) — never hard-delete
 *                         so the audit trail survives
 *   POST   /seed        → seed default categories — only fires when the
 *                         collection is empty so a re-run can't clobber
 *                         operator-edited prices
 *
 * Permissions are applied at the route layer (admin.write for writes,
 * billing.read for reads). The controller assumes req.user is populated.
 */
"use strict";
const mongoose = require("mongoose");
const RoomCategoryCharges = require("../../models/Admin/RoomCategoryChargesModel");
// R7ep — Auto-discover needs to read the canonical category list +
// live Room and Bed counts. Lazy-require so a misnamed collection at
// boot doesn't crash the matrix CRUD which doesn't need them.
let RoomCategoryModel = null;
let RoomModel = null;
let BedModel = null;
function _models() {
  if (!RoomCategoryModel) {
    try { RoomCategoryModel = require("../../models/bedMgmt/roomCategoryModel"); } catch {}
  }
  if (!RoomModel) {
    try { RoomModel = require("../../models/bedMgmt/roomModel"); } catch {}
  }
  if (!BedModel) {
    try { BedModel = require("../../models/bedMgmt/bedsModel"); } catch {}
  }
  return { RoomCategoryModel, RoomModel, BedModel };
}

// R7ep — Derive sensible charges-matrix defaults from a RoomCategory's
// defaultPricing block. Caller gets back a charges subdoc + chargingRule
// they can persist as-is, or further edit before saving.
//   perBedDailyRate         → bedRent
//   nursingCharges          → nursingCharge
//   equipmentCharges        → split: monitoringCharge for critical care,
//                              housekeepingCharge otherwise
//   chargingRule            → "Full" for ICU/NICU/CCU/HDU (NABH critical
//                              care guidance — every hour billable), else
//                              "HalfBoth"
function chargesFromRoomCategory(cat) {
  const dp = cat?.defaultPricing || {};
  const critical = ["ICU", "NICU", "CCU", "HDU"].includes(cat?.roomType);
  const bedRent    = Number(dp.perBedDailyRate || 0);
  const nursing    = Number(dp.nursingCharges  || 0);
  const equipment  = Number(dp.equipmentCharges || 0);
  return {
    chargingRule: critical ? "Full" : "HalfBoth",
    charges: {
      bedRent,
      nursingCharge:      nursing,
      // No direct doctor-visit slot on RoomCategory; estimate at
      // ~25% of bed rent for non-critical rooms, 35% for critical. The
      // admin can edit immediately after import — this is just a
      // first-cut so the row doesn't show all zeros.
      doctorVisitCharge:  Math.round(bedRent * (critical ? 0.35 : 0.25)),
      rmoCharge:          Math.round(bedRent * (critical ? 0.10 : 0.07)),
      monitoringCharge:   critical ? equipment : 0,
      dieteticsCharge:    Math.round(bedRent * 0.05),
      housekeepingCharge: critical ? 0 : equipment,
      linenCharge:        Math.round(bedRent * 0.03),
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// Default seed matrix. Prices align with the existing
// ServiceMaster BED-* / NURSING-* defaults so the cron flip is a
// clean swap (operator sees identical bills the day before vs after
// the swap, then can tune per-category from the grid).
// ──────────────────────────────────────────────────────────────────
const DEFAULT_SEED = [
  {
    categoryCode: "GENW",
    categoryName: "General Ward",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           1000,
      nursingCharge:      300,
      doctorVisitCharge:  500,
      rmoCharge:          150,
      monitoringCharge:     0,
      dieteticsCharge:    100,
      housekeepingCharge: 100,
      linenCharge:         50,
    },
  },
  {
    categoryCode: "SEMI",
    categoryName: "Semi-Private",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           1800,
      nursingCharge:      500,
      doctorVisitCharge:  700,
      rmoCharge:          200,
      monitoringCharge:     0,
      dieteticsCharge:    150,
      housekeepingCharge: 150,
      linenCharge:         75,
    },
  },
  {
    categoryCode: "PVT",
    categoryName: "Private Room",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           3000,
      nursingCharge:      700,
      doctorVisitCharge: 1000,
      rmoCharge:          300,
      monitoringCharge:     0,
      dieteticsCharge:    200,
      housekeepingCharge: 200,
      linenCharge:        100,
    },
  },
  {
    categoryCode: "DELUXE",
    categoryName: "Deluxe Suite",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           5000,
      nursingCharge:     1000,
      doctorVisitCharge: 1500,
      rmoCharge:          400,
      monitoringCharge:     0,
      dieteticsCharge:    300,
      housekeepingCharge: 300,
      linenCharge:        150,
    },
  },
  {
    categoryCode: "SUITE",
    categoryName: "VIP Suite",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           8000,
      nursingCharge:     1500,
      doctorVisitCharge: 2500,
      rmoCharge:          500,
      monitoringCharge:     0,
      dieteticsCharge:    500,
      housekeepingCharge: 500,
      linenCharge:        250,
    },
  },
  {
    categoryCode: "ICU",
    categoryName: "ICU",
    // ICU bills full charge from day one — the "half day" rule
    // doesn't apply when an ICU bed is held for an active critical
    // patient (every hour of monitoring is billable per NABH ICU
    // tariff guidance).
    chargingRule: "Full",
    charges: {
      bedRent:           6000,
      nursingCharge:     1200,
      doctorVisitCharge: 2000,
      rmoCharge:          600,
      monitoringCharge:  2000,
      dieteticsCharge:    400,
      housekeepingCharge: 300,
      linenCharge:        150,
    },
  },
  {
    categoryCode: "HDU",
    categoryName: "HDU / Step-Down",
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           4500,
      nursingCharge:     1000,
      doctorVisitCharge: 1500,
      rmoCharge:          500,
      monitoringCharge:  1500,
      dieteticsCharge:    300,
      housekeepingCharge: 250,
      linenCharge:        125,
    },
  },
  {
    categoryCode: "NICU",
    categoryName: "NICU",
    chargingRule: "Full",
    charges: {
      bedRent:           7000,
      nursingCharge:     1500,
      doctorVisitCharge: 2000,
      rmoCharge:          700,
      monitoringCharge:  2500,
      dieteticsCharge:      0,   // no dietetics in NICU
      housekeepingCharge: 300,
      linenCharge:        150,
    },
  },
];

// Tiny helper — pull a usable actor name off req.user without
// crashing on the various shapes (some routes populate user as a
// flat object, some as a Mongoose doc with virtuals).
function actorName(user) {
  if (!user) return "System";
  return (
    user.name ||
    user.fullName ||
    user.username ||
    user.email ||
    "System"
  );
}

// ──────────────────────────────────────────────────────────────────
// GET / → list all active rows, sorted by categoryCode so the grid
// renders in a stable order. The `lean()` is intentional — the row
// is purely tabular data with no business logic on read.
// ──────────────────────────────────────────────────────────────────
exports.list = async (_req, res) => {
  try {
    const rows = await RoomCategoryCharges
      .find({ active: true, effectiveTo: null })
      .sort({ categoryCode: 1 })
      .lean({ virtuals: true });

    // R7ep — Enrich each row with live bed/room counts so the admin
    // grid can render "ICU — 8 beds · 3 rooms" badges. Missing models
    // (legacy hospital seeded only with ServiceMaster) → bedCount=null
    // which the UI hides gracefully.
    try {
      const { RoomCategoryModel, RoomModel, BedModel } = _models();
      if (RoomCategoryModel && RoomModel && BedModel) {
        // 1 query, 1 round-trip — pull all category docs + their bed counts.
        const cats = await RoomCategoryModel.aggregate([
          { $match: { isActive: true } },
          { $lookup: {
              from: "rooms",
              localField: "_id",
              foreignField: "roomCategory",
              as: "rooms",
          } },
          { $project: {
              categoryCode: 1,
              roomIds: "$rooms._id",
              roomCount: { $size: "$rooms" },
          } },
        ]);
        // Flatten roomIds to count beds per category in one bed query.
        const allRoomIds = cats.flatMap(c => c.roomIds || []);
        const bedCountsByRoom = allRoomIds.length
          ? await BedModel.aggregate([
              { $match: { room: { $in: allRoomIds }, isActive: { $ne: false } } },
              { $group: { _id: "$room", n: { $sum: 1 } } },
            ])
          : [];
        const bedsByRoomId = new Map(bedCountsByRoom.map(b => [String(b._id), b.n]));
        const countByCode = new Map();
        for (const c of cats) {
          const beds = (c.roomIds || []).reduce(
            (acc, rid) => acc + (bedsByRoomId.get(String(rid)) || 0), 0,
          );
          countByCode.set(String(c.categoryCode).toUpperCase(), { rooms: c.roomCount, beds });
        }
        for (const row of rows) {
          const k = String(row.categoryCode || "").toUpperCase();
          const c = countByCode.get(k);
          row.bedCount  = c ? c.beds  : 0;
          row.roomCount = c ? c.rooms : 0;
        }
      }
    } catch (enrichErr) {
      // Soft-fail enrichment — the grid still renders without counts.
      console.warn("[roomCharges:list] bed-count enrichment skipped:", enrichErr.message);
    }

    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[roomCharges:list]", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /discover → walk RoomCategoryModel + Room + Bed to figure out
// which categories actually have beds in the system, and cross-
// reference with existing charge-matrix rows. Returns:
//   {
//     configured: [{ categoryCode, categoryName, bedCount, roomCount }],
//     missing:    [{ categoryCode, categoryName, roomType, bedCount,
//                    roomCount, suggested: { chargingRule, charges } }],
//   }
// Admin clicks "Import" on `missing` → POST /auto-import creates rows.
// ──────────────────────────────────────────────────────────────────
exports.discover = async (_req, res) => {
  try {
    const { RoomCategoryModel, RoomModel, BedModel } = _models();
    if (!RoomCategoryModel || !RoomModel || !BedModel) {
      return res.status(503).json({
        success: false,
        message: "Room / Bed / RoomCategory models not loaded — cannot auto-discover.",
      });
    }
    // Pull every active category + count its rooms + beds in 1 aggregation.
    const cats = await RoomCategoryModel.aggregate([
      { $match: { isActive: true } },
      { $lookup: {
          from: "rooms",
          localField: "_id",
          foreignField: "roomCategory",
          as: "rooms",
      } },
      { $project: {
          categoryCode: 1,
          categoryName: 1,
          roomType:     1,
          defaultPricing: 1,
          classification: 1,
          displayOrder:   1,
          roomIds: "$rooms._id",
          roomCount: { $size: "$rooms" },
      } },
      { $sort: { displayOrder: 1, categoryCode: 1 } },
    ]);

    // Bed counts by room (1 query for all rooms across all categories).
    const allRoomIds = cats.flatMap(c => c.roomIds || []);
    const bedCounts = allRoomIds.length
      ? await BedModel.aggregate([
          { $match: { room: { $in: allRoomIds }, isActive: { $ne: false } } },
          { $group: { _id: "$room", n: { $sum: 1 } } },
        ])
      : [];
    const bedsByRoomId = new Map(bedCounts.map(b => [String(b._id), b.n]));

    // Active matrix rows — used to bucket categories as configured vs missing.
    const existingRows = await RoomCategoryCharges
      .find({ active: true, effectiveTo: null })
      .select("categoryCode")
      .lean();
    const configuredCodes = new Set(existingRows.map(r => String(r.categoryCode).toUpperCase()));

    const configured = [];
    const missing    = [];
    for (const c of cats) {
      const beds = (c.roomIds || []).reduce(
        (acc, rid) => acc + (bedsByRoomId.get(String(rid)) || 0), 0,
      );
      const code = String(c.categoryCode || "").toUpperCase();
      const row = {
        categoryCode: code,
        categoryName: c.categoryName,
        roomType:     c.roomType,
        classification: c.classification,
        bedCount:  beds,
        roomCount: c.roomCount,
      };
      if (configuredCodes.has(code)) {
        configured.push(row);
      } else {
        const sug = chargesFromRoomCategory(c);
        missing.push({ ...row, suggested: sug });
      }
    }
    res.json({
      success: true,
      data: {
        configured,
        missing,
        summary: {
          totalCategories:   cats.length,
          configuredCount:   configured.length,
          missingCount:      missing.length,
          totalBeds:         configured.reduce((a, x) => a + x.bedCount, 0)
                           + missing.reduce(   (a, x) => a + x.bedCount, 0),
        },
      },
    });
  } catch (e) {
    console.error("[roomCharges:discover]", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /auto-import → bulk-create RoomCategoryCharges rows for the
// categories the admin picked from the discover panel. Body shape:
//   { categoryCodes: ["ICU","HDU"] }  // explicit
//   { all: true }                      // every missing category
// Each new row uses the suggested charges derived from
// RoomCategoryModel.defaultPricing. Skips codes that already have an
// active matrix row (idempotent).
// ──────────────────────────────────────────────────────────────────
exports.autoImport = async (req, res) => {
  try {
    const { RoomCategoryModel } = _models();
    if (!RoomCategoryModel) {
      return res.status(503).json({
        success: false,
        message: "RoomCategoryModel not loaded.",
      });
    }
    const wantAll = !!req.body?.all;
    const codes = Array.isArray(req.body?.categoryCodes)
      ? req.body.categoryCodes.map(c => String(c).toUpperCase().trim()).filter(Boolean)
      : [];
    if (!wantAll && codes.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Pass { all:true } or { categoryCodes:[...] }.",
      });
    }

    // Skip codes that already have an active row.
    const existing = await RoomCategoryCharges
      .find({ active: true, effectiveTo: null })
      .select("categoryCode")
      .lean();
    const skip = new Set(existing.map(r => String(r.categoryCode).toUpperCase()));

    // Pull candidate categories.
    const filter = { isActive: true };
    if (!wantAll) filter.categoryCode = { $in: codes };
    const cats = await RoomCategoryModel.find(filter).lean();
    if (cats.length === 0) {
      return res.json({ success: true, data: [], skipped: [], message: "No matching categories." });
    }

    const actor = { id: req.user?._id || req.user?.id || null, name: actorName(req.user) };
    const toInsert = [];
    const skipped  = [];
    for (const cat of cats) {
      const code = String(cat.categoryCode || "").toUpperCase().trim();
      if (!code) continue;
      if (skip.has(code)) { skipped.push(code); continue; }
      const sug = chargesFromRoomCategory(cat);
      toInsert.push({
        categoryCode: code,
        categoryName: cat.categoryName,
        chargingRule: sug.chargingRule,
        charges:      sug.charges,
        notes:        `Auto-imported from RoomCategoryModel "${cat.categoryName}" (${cat.roomType || "—"}). Edit each cell to fine-tune.`,
        active:       true,
        effectiveFrom: new Date(),
        effectiveTo:   null,
        createdBy:     actor.id,
        createdByName: actor.name,
        updatedBy:     actor.id,
        updatedByName: actor.name,
      });
    }
    if (toInsert.length === 0) {
      return res.json({ success: true, data: [], skipped, message: "Every category already has a matrix row." });
    }
    const inserted = await RoomCategoryCharges.insertMany(toInsert, { ordered: false });
    res.status(201).json({
      success: true,
      data: inserted,
      skipped,
      count: inserted.length,
      message: `Imported ${inserted.length} categor${inserted.length === 1 ? "y" : "ies"}.`,
    });
  } catch (e) {
    console.error("[roomCharges:autoImport]", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// GET /:id → fetch a single row (drawer / audit view).
// ──────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await RoomCategoryCharges.findById(req.params.id).lean({ virtuals: true });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    console.error("[roomCharges:getOne]", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST / → create a new category row. Body shape mirrors the model:
//   { categoryCode, categoryName, charges:{ … }, chargingRule? }
// ──────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { categoryCode, categoryName, charges, chargingRule, notes } = req.body || {};
    if (!categoryCode || !categoryName) {
      return res.status(400).json({ success: false, message: "categoryCode and categoryName required" });
    }
    const codeUpper = String(categoryCode).toUpperCase().trim();
    // Reject duplicate active code so the unique partial index doesn't
    // surface a raw E11000 to the operator.
    const existing = await RoomCategoryCharges.findOne({
      categoryCode: codeUpper, active: true, effectiveTo: null,
    }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Category "${codeUpper}" already exists. Soft-delete the existing row first.`,
      });
    }
    const row = await RoomCategoryCharges.create({
      categoryCode: codeUpper,
      categoryName: String(categoryName).trim(),
      charges:      charges || {},
      chargingRule: chargingRule || "HalfBoth",
      notes:        notes || "",
      createdBy:     req.user?._id || req.user?.id || null,
      createdByName: actorName(req.user),
      updatedBy:     req.user?._id || req.user?.id || null,
      updatedByName: actorName(req.user),
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate category code" });
    }
    console.error("[roomCharges:create]", e);
    res.status(400).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// PUT /:id → update a single row's charges. The payload can include
// any subset of { categoryName, chargingRule, notes, charges:{…} }.
// Charge fields merge into the existing subdoc so the caller can
// touch just one line item without resetting the rest.
// ──────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const { categoryName, chargingRule, notes, charges } = req.body || {};
    const update = {
      updatedBy:     req.user?._id || req.user?.id || null,
      updatedByName: actorName(req.user),
    };
    if (categoryName !== undefined) update.categoryName = String(categoryName).trim();
    if (chargingRule !== undefined) {
      const allowed = ["Full", "HalfOnAdmission", "HalfOnDischarge", "HalfBoth"];
      if (!allowed.includes(chargingRule)) {
        return res.status(400).json({ success: false, message: `chargingRule must be one of ${allowed.join(", ")}` });
      }
      update.chargingRule = chargingRule;
    }
    if (notes !== undefined) update.notes = String(notes);

    // Merge charges instead of replace — operator typically edits one
    // cell at a time from the grid. Use dot-notation so untouched
    // line items keep their current value.
    if (charges && typeof charges === "object") {
      const allowedKeys = [
        "bedRent", "nursingCharge", "doctorVisitCharge", "rmoCharge",
        "monitoringCharge", "dieteticsCharge", "housekeepingCharge", "linenCharge",
      ];
      for (const k of allowedKeys) {
        if (charges[k] !== undefined) {
          const n = Number(charges[k]);
          if (!Number.isFinite(n) || n < 0) {
            return res.status(400).json({ success: false, message: `Invalid value for charges.${k}` });
          }
          update[`charges.${k}`] = n;
        }
      }
    }
    const row = await RoomCategoryCharges.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    console.error("[roomCharges:update]", e);
    res.status(400).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// DELETE /:id → soft-delete (active=false, effectiveTo=now). The
// cron filter excludes inactive rows so admissions admitted to a
// category that's been retired will fall through to zero rates
// (operator sees a warning in the autoBilling logs).
// ──────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await RoomCategoryCharges.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          active:        false,
          effectiveTo:   new Date(),
          updatedBy:     req.user?._id || req.user?.id || null,
          updatedByName: actorName(req.user),
        },
      },
      { new: true },
    );
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    console.error("[roomCharges:remove]", e);
    res.status(400).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────────────
// POST /seed → idempotent default seed. Only fires if the collection
// is empty so a re-run can't clobber operator edits. Returns the
// rows that were actually inserted (empty array on a no-op call).
// ──────────────────────────────────────────────────────────────────
exports.seedDefaults = async (req, res) => {
  try {
    const count = await RoomCategoryCharges.countDocuments({ active: true });
    if (count > 0) {
      return res.json({
        success: true,
        seeded: false,
        message: `Collection already has ${count} active rows — seed skipped.`,
        data: [],
      });
    }
    const actor = {
      id:   req.user?._id || req.user?.id || null,
      name: actorName(req.user),
    };
    const docs = DEFAULT_SEED.map((row) => ({
      ...row,
      active:        true,
      effectiveFrom: new Date(),
      effectiveTo:   null,
      createdBy:     actor.id,
      createdByName: actor.name,
      updatedBy:     actor.id,
      updatedByName: actor.name,
    }));
    const inserted = await RoomCategoryCharges.insertMany(docs, { ordered: false });
    res.status(201).json({ success: true, seeded: true, count: inserted.length, data: inserted });
  } catch (e) {
    console.error("[roomCharges:seed]", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
