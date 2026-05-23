// Backend/services/Compliance/visitorPassExpiryCron.js
// R7bj-F9 — moves the expensive `updateMany({status:"Active",
// validUntil:{$lt:now}}, ...)` of expired passes OFF the hot path.
//
// Before R7bj this same query fired on every /visitor-passes list /
// stats / issue request. Hot, contended, and serialised a write-lock
// on each refresh. The cron runs every 5 minutes; visitorPassController
// list/stats/issue endpoints should drop their inline updateMany.

const VisitorPass = require("../../models/VisitorPass/visitorPassModel");

async function expireStalePasses() {
  const now = new Date();
  try {
    const result = await VisitorPass.updateMany(
      { status: "Active", validUntil: { $lt: now } },
      { $set: { status: "Expired", autoExpiredAt: now } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[cron:visitor-pass-expiry] expired ${result.modifiedCount} passes`);
    }
    return { expired: result.modifiedCount || 0 };
  } catch (e) {
    console.error("[cron:visitor-pass-expiry] error:", e.message);
    return { expired: 0, error: e.message };
  }
}

module.exports = { expireStalePasses };
