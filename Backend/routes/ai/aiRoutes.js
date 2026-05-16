// routes/ai/aiRoutes.js
const express = require("express");
const router = express.Router();
const { chat } = require("../../controllers/ai/aiController");

// POST /api/ai/chat
router.post("/chat", chat);

module.exports = router;
