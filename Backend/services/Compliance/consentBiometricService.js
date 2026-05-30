/**
 * consentBiometricService.js — R7ez
 *
 * Thin wrapper around @simplewebauthn/server that the consent controller
 * uses to (a) issue a registration challenge to the browser and (b)
 * verify the attestation that comes back. We use the REGISTRATION
 * ceremony (not authentication) because each consent records a brand-
 * new biometric attestation — the consenting party is not pre-enrolled
 * with our system; they simply touch the laptop's Windows Hello scanner
 * at the moment of consent. The resulting credential is a one-time
 * proof artefact, not a reusable identity.
 *
 * Why this is paperless-grade evidence:
 *   1. The browser cryptographically signs a server-issued challenge
 *      using a key that only exists inside the authenticator chip
 *      (TPM/SE) — proof that THIS device, at THIS moment, performed
 *      a user-verifying gesture (fingerprint, PIN, face).
 *   2. The server stamps capturedAt + IP + user-agent on success,
 *      anchoring the event to wall-clock time.
 *   3. The staff member's digital signature (drawn via SignaturePad)
 *      attaches a human identity at the same moment.
 *   4. Together (biometric attestation + staff sign + timestamps +
 *      consent text) form a tamper-evident packet equivalent to the
 *      paper "thumb impression + doctor signature + date" artefact.
 */

"use strict";

const crypto = require("crypto");

let webauthn;
try {
  webauthn = require("@simplewebauthn/server");
} catch (e) {
  console.error("[consentBiometric] @simplewebauthn/server not installed:", e.message);
}

// Relying-Party identity. Browser checks rpID === current origin's
// hostname (no port), so anything serving the page works in dev. In
// production set RP_ID env var to the hospital's domain.
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "SphereHealth HIS";
const RP_ID   = process.env.WEBAUTHN_RP_ID   || "localhost";
const ORIGIN_FALLBACK = process.env.WEBAUTHN_ORIGIN || "http://localhost:5173";

// Challenge TTL — short window prevents replay if a captured options
// payload leaks. 3 minutes is enough for a patient to touch the scanner
// without rushing.
const CHALLENGE_TTL_MS = 3 * 60 * 1000;

/**
 * Generate a registration ceremony options object.
 *
 * @param {object} consent — the ConsentForm document we're capturing for
 * @param {string} hostnameHint — req.hostname (browser-reported); used
 *   only as the rpID fallback if env var isn't set.
 * @returns {object} {options, expectedChallenge, expectedChallengeExpiresAt}
 */
async function makeRegistrationOptions(consent, hostnameHint = "") {
  if (!webauthn) {
    throw new Error("WebAuthn library not available — npm install @simplewebauthn/server");
  }
  const rpID = RP_ID || hostnameHint || "localhost";

  // userID must be unique per ceremony. We use a fresh random per
  // consent so that re-attempts (after failed scans) don't collide.
  const userID = Buffer.from(crypto.randomBytes(16));

  const options = await webauthn.generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID,
    // Human-readable handle. Shown by some authenticators (rarely on
    // Windows Hello) — keep it descriptive for audit.
    userName: `${(consent.consentingParty?.name || "Consenting Party")} - ${consent.consentType} - ${consent._id}`,
    userDisplayName: consent.consentingParty?.name || "Consenting Party",
    // We DON'T want resident keys (the credential should not persist on
    // the device beyond this ceremony). residentKey: discouraged tells
    // the platform "don't save this".
    authenticatorSelection: {
      authenticatorAttachment: "platform",   // built-in scanners (Windows Hello, Touch ID)
      userVerification: "required",          // must actually scan, not just click "OK"
      residentKey: "discouraged",
    },
    // none = simplest attestation, sufficient for our audit needs
    attestationType: "none",
    timeout: CHALLENGE_TTL_MS,
  });

  return {
    options,
    expectedChallenge: options.challenge,
    expectedChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  };
}

/**
 * Verify the attestation response coming back from the browser.
 *
 * @param {object} response — raw RegistrationResponseJSON from the browser
 * @param {string} expectedChallenge — the challenge stored on the consent doc
 * @param {string} originHint — req.headers.origin (used for verification)
 * @param {string} hostnameHint — req.hostname (used as rpID fallback)
 * @returns {object} {verified, credentialId, publicKey, counter, fmt, aaguid}
 */
async function verifyRegistrationResponse(response, expectedChallenge, originHint = "", hostnameHint = "") {
  if (!webauthn) {
    throw new Error("WebAuthn library not available");
  }
  if (!expectedChallenge) {
    throw new Error("No pending challenge — request fresh options first");
  }
  const rpID = RP_ID || hostnameHint || "localhost";
  // expectedOrigin accepts an array; allow the browser-reported origin
  // and the env-configured one so a dev/prod mismatch doesn't reject.
  const expectedOrigin = [ORIGIN_FALLBACK];
  if (originHint && !expectedOrigin.includes(originHint)) expectedOrigin.push(originHint);

  const verification = await webauthn.verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified) {
    return { verified: false };
  }

  // @simplewebauthn/server@11 stores credential data on
  // `verification.registrationInfo.credential` (changed from `.credentialID`
  // in older versions). Handle both shapes defensively.
  const info = verification.registrationInfo || {};
  const cred = info.credential || {};
  const credentialIdRaw =
    cred.id || info.credentialID || null;
  const publicKeyRaw =
    cred.publicKey || info.credentialPublicKey || null;
  const counter = cred.counter ?? info.counter ?? 0;
  const fmt = info.fmt || "";
  const aaguid = info.aaguid || cred.aaguid || "";

  return {
    verified: true,
    credentialId: credentialIdRaw ? Buffer.from(credentialIdRaw).toString("base64url") : "",
    publicKey:    publicKeyRaw    ? Buffer.from(publicKeyRaw).toString("base64url")    : "",
    counter,
    attestationFmt: fmt,
    aaguid,
  };
}

module.exports = {
  makeRegistrationOptions,
  verifyRegistrationResponse,
  CHALLENGE_TTL_MS,
};
