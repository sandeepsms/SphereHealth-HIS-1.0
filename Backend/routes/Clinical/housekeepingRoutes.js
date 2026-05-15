const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/housekeepingController");
const { requireAction } = require("../../middleware/auth");

/* ── Task board ──────────────────────────────────────── */
router.get   ("/tasks",         requireAction("house.read"),    ctrl.taskList);
router.get   ("/tasks/stats",   requireAction("house.read"),    ctrl.taskStats);
router.post  ("/tasks",         requireAction("house.create"),  ctrl.taskCreate);
router.patch ("/tasks/:id/accept",   requireAction("house.fulfill"), ctrl.taskAccept);
router.patch ("/tasks/:id/start",    requireAction("house.fulfill"), ctrl.taskStart);
router.patch ("/tasks/:id/complete", requireAction("house.fulfill"), ctrl.taskComplete);
router.patch ("/tasks/:id/cancel",   requireAction("house.create"),  ctrl.taskCancel);

/* ── Spillage incidents ─────────────────────────────── */
router.get   ("/spillage",      requireAction("house.read"),    ctrl.spillageList);
router.post  ("/spillage",      requireAction("house.spillage"),ctrl.spillageReport);
router.patch ("/spillage/:id/contain", requireAction("house.spillage"), ctrl.spillageContain);
router.patch ("/spillage/:id/clean",   requireAction("house.spillage"), ctrl.spillageClean);

/* ── Inventory ────────────────────────────────────── */
router.get   ("/inventory",     requireAction("house.read"),    ctrl.inventoryList);
router.post  ("/inventory",     requireAction("house.inventory"), ctrl.inventoryUpsert);
router.patch ("/inventory/:id/receive", requireAction("house.inventory"), ctrl.inventoryReceive);
router.patch ("/inventory/:id/consume", requireAction("house.inventory"), ctrl.inventoryConsume);

/* ── Area cleaning checklist ────────────────────── */
router.get   ("/checklist/defaults", requireAction("house.read"), ctrl.checklistDefaults);
router.get   ("/checklist/today",    requireAction("house.read"), ctrl.checklistToday);
router.get   ("/checklist/history",  requireAction("house.read"), ctrl.checklistHistory);
router.post  ("/checklist",          requireAction("house.checklist"), ctrl.checklistLog);

/* ── Pest control ────────────────────────────────── */
router.get   ("/pest",          requireAction("house.read"),    ctrl.pestList);
router.post  ("/pest",          requireAction("house.pest"),    ctrl.pestSchedule);
router.patch ("/pest/:id/complete", requireAction("house.pest"), ctrl.pestComplete);

/* ── Manager KPI dashboard ────────────────────── */
router.get   ("/manager-stats", requireAction("house.manage"),  ctrl.managerStats);

module.exports = router;
