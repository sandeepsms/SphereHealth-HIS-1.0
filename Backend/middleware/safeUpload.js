/**
 * safeUpload.js — R7bj-F10. Safe file-upload pipeline.
 *
 * Purpose
 *   Provide a single, hardened multer wrapper for every endpoint that
 *   accepts a binary upload (visitor-pass photo, incident-report
 *   attachment, mortuary handover, diet-card photo, spillage photo,
 *   treatment photo, BMW manifest scan, etc.). Pre-R7bj every schema
 *   trusted `[String]` URL arrays passed in from `req.body` — an
 *   attacker could ship `javascript:`, `data:`, or external tracker
 *   URLs through any field (R7bi-10-X-CRIT-1).
 *
 *   This module is the WRITE half of the defence. The READ half lives in
 *   `Backend/utils/urlValidator.js` (validates URL strings on attachment
 *   fields when no file is uploaded).
 *
 * Stub mode
 *   `multer` is not yet a dependency in Backend/package.json. We do NOT
 *   `npm install` from inside this commit (requires user approval).
 *   When multer is missing, `safeUpload(...)` returns an Express
 *   middleware that 501s with `code: "UPLOAD_DISABLED"` so the upload
 *   surface is reachable but explicitly disabled — and the install step
 *   can land in a follow-up cycle without touching any caller code.
 *
 * Guarantees when multer IS installed
 *   • 5 MB per-file hard ceiling (configurable per call).
 *   • Whitelisted MIME types only (`image` / `document` kinds).
 *   • At most 5 files per request.
 *   • Filenames sanitised to `[a-zA-Z0-9._-]` + a millisecond timestamp
 *     prefix so collisions and path-traversal characters (`../`, `:`,
 *     `\`) can never reach the destination.
 *   • Disk storage under `destination`. Caller is responsible for
 *     ensuring the directory exists with the right permissions
 *     (typically `uploads/<feature>/`).
 *
 *   Antivirus / image-bomb scanning is NOT done here — those add up to
 *   another infrastructure dependency. Either layer is welcome later
 *   (`clamav` worker, `sharp` thumbnail re-encode), but the surface
 *   defined here is the minimum the rest of the codebase can rely on.
 */
"use strict";

let multer;
try {
  // eslint-disable-next-line global-require
  multer = require("multer");
} catch (_) {
  multer = null;
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = {
  image: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

/**
 * Sanitise a user-supplied filename.
 *   • Strip everything except letters, digits, dot, hyphen, underscore.
 *   • Collapse repeated dots so `..` style sequences vanish.
 *   • Cap length at 100 chars (Linux ext4 allows 255, but 100 is plenty
 *     and keeps the millisecond prefix visible in `ls`).
 */
function _safeName(original) {
  const trimmed = String(original || "").trim();
  const cleaned = trimmed.replace(/[^a-zA-Z0-9.\-_]/g, "_").replace(/\.\.+/g, ".");
  return cleaned.slice(0, 100) || "file";
}

/**
 * safeUpload({ destination, maxSize, allowedKinds })
 *   destination  — relative or absolute disk dir; required.
 *   maxSize      — bytes; default 5 MB.
 *   allowedKinds — array of `"image"` and/or `"document"`; default
 *                  `["image"]`.
 *
 * Returns an Express middleware (the multer instance) so callers do
 *   `router.post("/photo", safeUpload({ ... }).single("photo"), ctrl.save)`
 * exactly as if it were a vanilla multer instance.
 *
 * When multer is missing the return value is a single-arg middleware
 * that 501s with `code: "UPLOAD_DISABLED"`. Test the surface in CI by
 * asserting either a 2xx (multer installed) or a 501 (stub) — both
 * are valid until the dependency lands.
 */
function safeUpload({
  destination = "uploads/",
  maxSize = DEFAULT_MAX_SIZE,
  allowedKinds = ["image"],
} = {}) {
  if (!multer) {
    // Stub middleware. Mirrors the shape multer would expose (`single`,
    // `array`, `fields`, `any`) so callers don't have to special-case
    // the install state. Each method returns the same 501 middleware.
    const stub = (_req, res, _next) => res.status(501).json({
      success: false,
      message: "File upload pipeline not installed (multer dependency missing). Contact admin to enable.",
      code: "UPLOAD_DISABLED",
    });
    return {
      single: () => stub,
      array: () => stub,
      fields: () => stub,
      any: () => stub,
      none: () => stub,
    };
  }

  const allowedMime = (allowedKinds || []).flatMap((k) => ALLOWED_MIME[k] || []);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${_safeName(file.originalname)}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: maxSize,
      files: 5,
    },
    fileFilter: (_req, file, cb) => {
      if (!allowedMime.includes(file.mimetype)) {
        const err = new Error(`UNSUPPORTED_MIME: ${file.mimetype}`);
        err.status = 415;
        err.code = "UNSUPPORTED_MIME";
        return cb(err, false);
      }
      cb(null, true);
    },
  });
}

module.exports = { safeUpload, ALLOWED_MIME, DEFAULT_MAX_SIZE };
