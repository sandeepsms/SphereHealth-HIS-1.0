// const express = require("express");
// const router = express.Router();
// const{setWardCharges,getWardCharges}=require('../controllers/WardCharges')


// router.post("/ward-charges",setWardCharges);
// router.get("/Getward-charges",getWardCharges);


// module.exports=router;


// routes/wardCharges.js
const express = require("express");
const router = express.Router();
const { setWardCharges, getWardCharges } = require('../controllers/WardCharges');

// Note: router paths are relative to where we mount this router in app.js
router.post('/', setWardCharges);   // will become POST /api/ward-charges
router.get('/', getWardCharges);    // will become GET  /api/ward-charges

module.exports = router;
