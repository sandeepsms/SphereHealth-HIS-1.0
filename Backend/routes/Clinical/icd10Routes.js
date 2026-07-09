// routes/Clinical/icd10Routes.js
// R7hr(ICD-P1.2) — ICD-10 master: typeahead search (all clinical roles),
// release meta, and admin yearly-file import.
const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/icd10Controller");
const { requireAction } = require("../../middleware/auth");

// memoryStorage: the ~6MB codes file goes straight to the import service.
const uploadCodes = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || "").toLowerCase().split(".").pop();
    if (["txt", "gz"].includes(ext)) return cb(null, true);
    cb(new Error("Upload the CMS codes file (.txt or .txt.gz)"));
  },
});

router.get("/search", requireAction("icd10.read"), ctrl.search);
router.get("/meta",   requireAction("icd10.read"), ctrl.meta);
router.post("/import", requireAction("icd10.manage"), uploadCodes.single("file"), ctrl.importFile);

module.exports = router;
