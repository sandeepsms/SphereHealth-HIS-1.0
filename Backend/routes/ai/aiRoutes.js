// routes/ai/aiRoutes.js
//
// R7au-FIX-12/D3-HIGH: AI chat gated on `rx.read` (clinical roles —
// Doctor / Nurse / Pharmacist / Accountant). Pre-R7au any
// authenticated user could hit Groq through this endpoint, leaking
// PHI into the prompt and burning quota.
const express = require("express");
const router = express.Router();
const { chat } = require("../../controllers/ai/aiController");
const { requireAction } = require("../../middleware/auth");

// POST /api/ai/chat
router.post("/chat", requireAction("rx.read"), chat);

module.exports = router;
