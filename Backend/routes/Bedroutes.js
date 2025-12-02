const express = require("express");
const router = express.Router();
const {
  getAllBeds,
  getBedById,
  addBed,
  updateBed,
  deleteBed,
  assignPatient,
  dischargePatient,
  assignPatientcharges,
  bedcharges,
  getBedCharges
} = require("../controllers/Bed");

router.get("/", getAllBeds);
router.get("/:id", getBedById);
router.post("/", addBed);
router.put("/:id", updateBed);
router.delete("/:id", deleteBed);
router.post("/:id/assign", assignPatient);
router.post("/:id/discharge", dischargePatient);

// router.put("/:bedId/assign",assignPatientcharges);

// router.put("/assign/:bedId",assignPatientcharges)
router.put("/:id/assign", assignPatientcharges);


// router.put("/:bedId/assign",assignPatientcharges);
// router.post("beds/assign",assignPatientcharges);


router.get("/charges/:bedId",bedcharges);
router.get("/:id/charges", getBedCharges);


// router.put("/assign/:bedId", async (req, res) => {
//   const { patientId } = req.body;

//   const bed = await bed.findOne({ id: req.params.bedId });

//  bed.status = "occupied";
//   bed.assignedTo = patientId;
//   bed.assignedAt = new Date();
//   bed.hourlyCharge = hourlyCharge;
//   bed.patientName = name;
//   bed.patientAge = age;

//   await bed.save();

//   res.json({ message: "Bed assigned successfully", bed });
// });

// router.post("/assign/:id", async (req, res) => {
//     try {
//         const { patientId, hourlyCharge } = req.body;

//         // ✅ Sabse pehle bed ko fetch karo
//         const bed = await bed.findById(req.params.id);

//         if (!bed) {
//             return res.status(404).json({ message: "Bed not found" });
//         }

//         // ✅ Ab patient assign + hourly charge add karo
//         bed.assignedPatient = patientId;
//         bed.hourlyCharge = hourlyCharge;
//         bed.assignedAt = new Date(); // start time for charges

//         await bed.save();

//         res.json({ message: "Bed assigned successfully", bed });

//     } catch (error) {
//         console.log(error);
//         res.status(500).json({ message: "Server error", error });
//     }
// });




// router.get("/charges/:bedId", async (req, res) => {
//   const bed = await bed.findOne({ id: req.params.bedId });
//   console.log("--------",bed);
  

//   if (!bed.assignedAt) {
//     return res.json({ totalHours: 0, totalCharge: 0 });
//   }

//   const now = new Date();
//   const assignedTime = new Date(bed.assignedAt);

//   const diffHours = Math.ceil((now - assignedTime) / (1000 * 60 * 60));
//   const totalCharge = diffHours * bed.hourlyCharge;

//   res.json({
//     totalHours: diffHours,
//     hourlyCharge: bed.hourlyCharge,
//     totalCharge,
//   });
// });


module.exports = router;
