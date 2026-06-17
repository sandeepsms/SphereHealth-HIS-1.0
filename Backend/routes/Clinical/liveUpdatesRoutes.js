// routes/Clinical/liveUpdatesRoutes.js
// ═══════════════════════════════════════════════════════════════
// Server-Sent Events channel for live patient-file updates.
//
// Clients open `GET /api/live-updates/:uhid` and stay connected. Any
// mutation that writes a PatientActivityLog row fires a process-level
// event-emitter event; this handler forwards relevant ones to the
// subscribed clients as `data: {...}\n\n` chunks.
//
// Keeps things simple — no Redis fanout, no clustering. For a single-
// node deployment this is enough; for multi-node, swap the in-process
// EventEmitter for a pub/sub (Redis / NATS).
// ═══════════════════════════════════════════════════════════════

const router = require("express").Router();
const { EventEmitter } = require("events");
const { requireAction } = require("../../middleware/auth");

// Module-scoped emitter — exported so activityLogger can fire on it.
const bus = new EventEmitter();
bus.setMaxListeners(200); // 200 simultaneous viewers per node

// R7az-A/D1-CRIT: SSE was completely ungated pre-R7az — any logged-in
// role could subscribe to the live activity firehose for any UHID
// (charts, MAR entries, lab results, payments, etc. = full PHI feed).
// R7hr-219 (RBAC review #4): this firehose is the LIVE twin of the
// static activity feed GET /api/patient-file/:uhid/activity, which
// R7hr-214 already narrowed to patient-file.read [Admin/Doctor/Nurse/
// MRD]. The SSE stream was left on the broad patient.read, so the same
// non-clinical roles R7hr-214 denied (Lab Tech / Pharmacist / Dietician
// / TPA / Accountant) could still subscribe to a patient's real-time
// PHI activity. Align it with its static twin. The only consumer is the
// clinical PatientPanelShell (Doctor/Nurse panel), so no UX regresses.
router.get("/:uhid", requireAction("patient-file.read"), (req, res) => {
  const uhid = String(req.params.uhid || "").toUpperCase();
  if (!uhid) return res.status(400).end();

  res.set({
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection:      "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  // Keep-alive ping every 25s — many proxies drop idle SSE after 30s.
  const ping = setInterval(() => res.write(":ping\n\n"), 25_000);

  // Immediate handshake event so the client knows the stream is live.
  res.write(`event: open\ndata: ${JSON.stringify({ uhid, t: Date.now() })}\n\n`);

  const onActivity = (entry) => {
    if (!entry || entry.UHID !== uhid) return;
    res.write(`event: activity\ndata: ${JSON.stringify({
      action: entry.action, module: entry.module, area: entry.area,
      summary: entry.summary, userName: entry.userName, when: entry.createdAt,
    })}\n\n`);
  };
  bus.on("activity", onActivity);

  req.on("close", () => {
    clearInterval(ping);
    bus.off("activity", onActivity);
  });
});

module.exports = router;
module.exports.bus = bus;
