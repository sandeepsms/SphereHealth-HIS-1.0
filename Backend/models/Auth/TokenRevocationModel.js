/**
 * models/Auth/TokenRevocationModel.js
 *
 * Server-side JWT revocation list. Closes audit B-10.
 *
 * Why: stateless JWT auth means a compromised or logged-out token stays
 * valid until its `exp` claim — for the 8-hour expiry we use, that's
 * 8 hours of attack surface after the user clicked logout. This
 * collection lets the authenticate middleware reject revoked tokens.
 *
 * Schema is intentionally tiny. The `expiresAt` field has a Mongo TTL
 * index (`expires: 0`), so each revocation row auto-deletes the moment
 * the underlying JWT's `exp` passes — the revocation list never grows
 * larger than the active-token window.
 */
const mongoose = require("mongoose");

const TokenRevocationSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "logout" },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL — auto-delete at this timestamp
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.TokenRevocation ||
  mongoose.model("TokenRevocation", TokenRevocationSchema);
