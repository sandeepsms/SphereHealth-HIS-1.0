// models/User/UserActivityLog.js
// ════════════════════════════════════════════════════════════════════
// R7bb-C/D7-HIGH-3: dedicated append-only audit log for every user-
// admin / authentication event. BillingAudit covers money-touching
// state changes; UserActivityLog covers identity + access state — the
// two collections together give NABH AAC.7 and HR audit reviewers a
// complete chronological trail without one collection ballooning into
// a generic event sink.
//
// • TTL via `retainUntil` lets routine events (login/logout) expire
//   after 7y while critical events (termination / role change / pw
//   reset) stay 10y for HR + compliance reviews.
// • Pre-save scrubs password / passwordHistory / signature from the
//   before/after blobs so a sensitive value never lands in the audit
//   collection even if the caller forgets to redact.
// • Append-only: delete* hooks throw and findOneAndUpdate is restricted
//   to retention/legal-hold field updates only. The audit row is
//   functionally immutable post-create.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const UserActivityLogSchema = new mongoose.Schema({
  event: { type: String, required: true, enum: [
    "USER_CREATED","USER_UPDATED","USER_DEACTIVATED","USER_REACTIVATED",
    "USER_TERMINATED","USER_SUSPENDED","USER_PASSWORD_RESET","USER_PASSWORD_CHANGED",
    "USER_ROLE_CHANGED","USER_DEPARTMENT_CHANGED","USER_WARD_CHANGED",
    "USER_LOCKED","USER_UNLOCKED","USER_TOKEN_REVOKED_ALL",
    "USER_LOGIN_SUCCESS","USER_LOGIN_FAILED","USER_LOGOUT","USER_LOGIN_LOCKED",
    "USER_MFA_ENABLED","USER_MFA_DISABLED","USER_SIGNATURE_UPDATED",
    "USER_HOD_ASSIGNED","USER_HOD_REMOVED","USER_FIRST_LOGIN_PW_CHANGE",
  ], index: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  targetUserEmployeeId: String,
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorRole: String,
  actorName: String,
  actorIp: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed,
  retainUntil: { type: Date, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

UserActivityLogSchema.pre("save", function(next) {
  if (!this.retainUntil) {
    // R7bb-C/D7-HIGH-3: termination / role change / pw reset → 10y so
    // HR can reconstruct disciplinary timelines years later. Routine
    // login/logout → 7y (NABH internal-audit floor).
    const longLifeEvents = ["USER_TERMINATED","USER_SUSPENDED","USER_PASSWORD_RESET","USER_ROLE_CHANGED"];
    const years = longLifeEvents.includes(this.event) ? 10 : 7;
    this.retainUntil = new Date(Date.now() + years * 365 * 86400 * 1000);
  }
  // R7bb-C/D3-CRIT-4: scrub credentials from audit blobs. If a caller
  // passes the full user doc as `before` / `after`, the password hash
  // would otherwise land in the audit collection (and any export of
  // the collection would leak hashes). Belt-and-suspenders — service
  // callers SHOULD redact, but never trust it.
  for (const blob of [this.before, this.after]) {
    if (blob && typeof blob === "object") {
      delete blob.password;
      delete blob.passwordHistory;
      delete blob.signature;
    }
  }
  next();
});

["findOneAndDelete","deleteMany","deleteOne"].forEach(op => {
  UserActivityLogSchema.pre(op, function() { throw new Error("UserActivityLog is append-only"); });
});

UserActivityLogSchema.pre("findOneAndUpdate", function() {
  const u = this.getUpdate() || {};
  const $set = u.$set || u;
  const allowed = new Set(["retainUntil","legalHoldUntil"]);
  for (const k of Object.keys($set)) if (!allowed.has(k)) throw new Error(`UserActivityLog field ${k} is append-only`);
});

module.exports = mongoose.model("UserActivityLog", UserActivityLogSchema);
