// routes/Billing/insurerFormTemplateRoutes.js
// R7hr(CLAIM-P4.3) — admin management of uploaded official insurer claim PDFs.
// Uploads/edits gated on settings.write (Admin config); reads on billing.read.
const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/Billing/insurerFormTemplateController");
const { requireAction } = require("../../middleware/auth");

// memoryStorage so the PDF buffer goes straight into Mongo (no disk roundtrip).
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    const ext = (file.originalname || "").toLowerCase().split(".").pop();
    if (mt === "application/pdf" || ext === "pdf") return cb(null, true);
    cb(new Error("Only PDF files are accepted"));
  },
});

router.get("/mappable-fields", requireAction("billing.read"), ctrl.getMappableFields);
router.get("/",                requireAction("billing.read"), ctrl.listTemplates);
router.get("/:code",           requireAction("billing.read"), ctrl.getTemplate);
router.get("/:code/blank",     requireAction("billing.read"), ctrl.downloadBlank);

router.post("/:code/template", requireAction("settings.write"), uploadPdf.single("pdf"), ctrl.uploadTemplate);
router.put("/:id/field-map",   requireAction("settings.write"), ctrl.updateFieldMap);
router.delete("/:id",          requireAction("settings.write"), ctrl.deleteTemplate);

module.exports = router;
