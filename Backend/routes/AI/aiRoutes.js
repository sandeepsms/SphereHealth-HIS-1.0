/**
 * AI Assistant — minimal backend endpoint that the floating HISAssistant
 * widget calls on every chat message. Until a real AI backend (Claude API
 * proxy) is wired up, we return a graceful "AI not configured" message
 * so the widget doesn't show 404s in the chat bubble.
 */
const express = require("express");
const router  = express.Router();
const { attemptAuth } = require("../../middleware/auth");

router.use(attemptAuth);

/* POST /api/ai/chat
   Body: { message, context, history }
   Response shape matches what HISAssistant.jsx expects:
     { message?, clarification_needed?, actions? } */
router.post("/chat", async (req, res) => {
  try {
    const userMsg = String(req.body?.message || "").trim();
    if (!userMsg) {
      return res.json({
        message: "Hi! Type a question and I'll try to help. The AI engine isn't fully wired up yet, so for now I'll just acknowledge.",
      });
    }
    // Friendly canned reply — the real Claude proxy can replace this later.
    return res.json({
      message:
        "I've received your question. The AI assistant integration is being set up by your admin; in the meantime, please use the main menu or ask the receptionist/desk for help. (You asked: \"" +
        userMsg.slice(0, 120) +
        (userMsg.length > 120 ? "…" : "") + "\")",
      actions: [],
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
