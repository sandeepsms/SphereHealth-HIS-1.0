/**
 * services/Abdm/abdmCrypto.js — ABDM Health-Information-Exchange crypto
 *
 * ABDM's data flow is end-to-end encrypted between the HIP (sender) and the
 * HIU (receiver) so the Consent Manager / gateway only ever relays ciphertext.
 * The scheme is ECDH over Curve25519 (X25519) → HKDF-SHA256 → AES-256-GCM.
 *
 *   1. Each side generates an ephemeral X25519 keypair + a random 32-byte
 *      nonce and publishes { dhPublicKey.keyValue, nonce } (base64).
 *   2. sharedSecret = X25519(myPrivate, theirPublic).
 *   3. salt = myNonce ‖ theirNonce ; AES key = HKDF(sharedSecret, salt).
 *   4. AES-256-GCM(plaintext) → base64(ciphertext ‖ 16-byte GCM tag).
 *
 * The wire shapes (dhPublicKey / nonce / keyValue in base64) match ABDM. NOTE:
 * the exact HKDF salt/info + IV derivation is ABDM-crypto-library-version
 * specific — align `_HKDF_INFO_KEY` / `_HKDF_INFO_IV` / the salt order to the
 * certified library version before production milestone testing. This module
 * is self-consistent (its own encrypt↔decrypt round-trips) so the framework
 * and its tests work today.
 *
 * Built on Node's native crypto (X25519, hkdfSync, aes-256-gcm) — no deps.
 */
"use strict";

const crypto = require("crypto");

// X25519 SubjectPublicKeyInfo DER prefix (12 bytes) — lets us import/export a
// bare 32-byte raw public key, which is what ABDM puts in keyValue.
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const _HKDF_INFO_KEY = Buffer.from("abdm-hie-aes256gcm-key");
const _HKDF_INFO_IV = Buffer.from("abdm-hie-aes256gcm-iv");

// ── key material ───────────────────────────────────────────────────
/**
 * Generate an ephemeral X25519 keypair + nonce in ABDM keyMaterial shape.
 * @returns { privateKey(KeyObject), publicKeyBase64, nonceBase64, keyMaterial }
 */
function generateKeyMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const spki = publicKey.export({ type: "spki", format: "der" });          // 44 bytes
  const rawPub = spki.subarray(spki.length - 32);                           // last 32 = raw key
  const publicKeyBase64 = rawPub.toString("base64");
  const nonce = crypto.randomBytes(32);
  const nonceBase64 = nonce.toString("base64");
  const expiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return {
    privateKey,
    publicKeyBase64,
    nonceBase64,
    keyMaterial: {
      cryptoAlg: "ECDH",
      curve: "Curve25519",
      dhPublicKey: { expiry, parameters: "Curve25519/32byte random key", keyValue: publicKeyBase64 },
      nonce: nonceBase64,
    },
  };
}

// Import a peer's base64 public key (raw 32-byte or full 44-byte SPKI DER).
function _importPublicKey(base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  const der = buf.length === 32 ? Buffer.concat([X25519_SPKI_PREFIX, buf]) : buf;
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

// Derive the AES-256 key + 12-byte GCM IV from an ECDH exchange.
function _deriveKeyIv(myPrivateKey, theirPublicB64, saltBuf) {
  const shared = crypto.diffieHellman({ privateKey: myPrivateKey, publicKey: _importPublicKey(theirPublicB64) });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, saltBuf, _HKDF_INFO_KEY, 32));
  const iv = Buffer.from(crypto.hkdfSync("sha256", shared, saltBuf, _HKDF_INFO_IV, 12));
  return { key, iv };
}

function _salt(myNonceB64, theirNonceB64) {
  return Buffer.concat([Buffer.from(myNonceB64 || "", "base64"), Buffer.from(theirNonceB64 || "", "base64")]);
}

// ── encrypt / decrypt ──────────────────────────────────────────────
/**
 * HIP-side encrypt: encrypt `plaintext` for the HIU.
 * @returns base64 of (ciphertext ‖ 16-byte GCM tag)
 */
function encrypt({ plaintext, senderPrivateKey, receiverPublicKeyB64, senderNonceB64, receiverNonceB64 }) {
  const { key, iv } = _deriveKeyIv(senderPrivateKey, receiverPublicKeyB64, _salt(senderNonceB64, receiverNonceB64));
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ct, tag]).toString("base64");
}

/**
 * HIU-side decrypt (also used by round-trip tests). The salt order MUST mirror
 * the encrypt call — the receiver derives with (receiverNonce, senderNonce)
 * swapped to reproduce the same salt, so pass the SAME salt components.
 * @returns utf8 plaintext
 */
function decrypt({ cipherB64, receiverPrivateKey, senderPublicKeyB64, senderNonceB64, receiverNonceB64 }) {
  const { key, iv } = _deriveKeyIv(receiverPrivateKey, senderPublicKeyB64, _salt(senderNonceB64, receiverNonceB64));
  const buf = Buffer.from(cipherB64, "base64");
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// SHA-256 checksum (base64) — ABDM data-push entries carry a content checksum.
function checksum(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("base64");
}

module.exports = {
  generateKeyMaterial,
  encrypt,
  decrypt,
  checksum,
  X25519_SPKI_PREFIX,
};
