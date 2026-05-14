const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Equipment/equipmentController");

router.get   ("/",                  ctrl.list);
router.get   ("/stats",             ctrl.stats);
router.get   ("/service-due",       ctrl.serviceDue);
router.get   ("/:id",               ctrl.getOne);
router.post  ("/",                  ctrl.create);
router.put   ("/:id",               ctrl.update);
router.post  ("/:id/assign",        ctrl.assign);
router.post  ("/:id/return",        ctrl.return);
router.post  ("/:id/service",       ctrl.logService);
router.delete("/:id",               ctrl.retire);

module.exports = router;
