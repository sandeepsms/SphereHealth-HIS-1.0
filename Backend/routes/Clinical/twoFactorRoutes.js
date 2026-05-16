// routes/Clinical/twoFactorRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/twoFactorController");

router.post("/request", ctrl.requestOtp);
router.post("/verify",  ctrl.verifyOtp);

module.exports = router;
