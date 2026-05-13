// services/bedMgmt/bedEventBus.js
// Tiny pub-sub bus for bed state changes. Backed by the SSE endpoint
// at GET /api/bedss/events — every bed write (book / discharge /
// status / housekeeping / isolation / transfer) calls `emit()` here
// and connected clients (BedVisualLayout, BedDashboard, BedTransfers)
// receive a "bed-update" event and refresh.
//
// Why SSE (vs Socket.IO): bed updates are one-way (server -> client)
// and don't justify a new dep. SSE is native browser EventSource +
// chunked res.write, auto-reconnects on disconnect.

const subscribers = new Set();

function subscribe(res) {
  subscribers.add(res);
  return () => subscribers.delete(res);
}

function emit(eventName, payload) {
  const chunk =
    `event: ${eventName}\n` +
    `data: ${JSON.stringify(payload || {})}\n\n`;
  for (const res of subscribers) {
    try { res.write(chunk); } catch (_) { /* dead socket — cleanup happens on close */ }
  }
}

function subscriberCount() {
  return subscribers.size;
}

module.exports = { subscribe, emit, subscriberCount };
