/**
 * uploadsRoutes.js — authenticated read-half of the file-upload pipeline.
 *
 * safeUpload.js (the WRITE half) saves multer files under
 * `Backend/uploads/<feature>/`, and models store `/uploads/...` URLs
 * (VisitorPass.photoUrl, IncidentReport.attachments, …). Until now NOTHING
 * served those paths — every stored link 404'd (read half missing).
 *
 * These files are PHI (visitor/patient photos, incident attachments,
 * compliance scans), so this is intentionally NOT a public
 * `express.static` mount:
 *
 *   • JWT required — same `authenticate` as the API. The `?token=` query
 *     fallback stays SSE-only (R7bb-FIX-A-6/S14: query tokens leak into
 *     proxy logs / history), so <img> tags can't slip a token into the
 *     URL. The frontend renders these through <SecureImage>, which fetches
 *     the file as a blob with the Authorization header and displays an
 *     object URL.
 *   • Path-traversal safe — decoded, `\`/NUL/`..` rejected, resolved path
 *     must stay under Backend/uploads (belt) AND res.sendFile gets
 *     `root:` so Express re-checks containment (braces).
 *   • Extension whitelist mirrors safeUpload's ALLOWED_MIME — the read
 *     half can never serve a type the write half wouldn't accept.
 *   • `Cache-Control: no-store, private` — same PHI rule the API paths
 *     get in index.js; a shared workstation's back button or a proxy
 *     must never replay a patient photo after logout.
 *
 * Mounted at app.use("/uploads", …) in index.js — top-level (not /api)
 * so stored `/uploads/...` URLs work as-is. The Docker nginx.conf and
 * the Vite dev proxy both forward /uploads to this backend unchanged.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const { authenticate } = require("../../middleware/auth");

const router = express.Router();

// Backend/uploads — the same root safeUpload writes under.
const UPLOADS_ROOT = path.resolve(__dirname, "..", "..", "uploads");

// Read-side whitelist mirroring safeUpload.ALLOWED_MIME (image + document).
const EXT_CONTENT_TYPE = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

router.use(authenticate);

router.get(/.*/, (req, res) => {
  // 1. Decode. A malformed escape (%zz) throws — treat as a bad request.
  let rel;
  try {
    rel = decodeURIComponent(req.path);
  } catch (_) {
    return res.status(400).json({ success: false, message: "Bad file path." });
  }

  // 2. Reject traversal / separator / control tricks outright: backslashes
  //    (Windows separators sneak past string checks), NUL bytes, any `..`
  //    segment, and dotfiles (.env-style names) anywhere in the path.
  const segments = rel.split("/").filter(Boolean);
  if (
    rel.includes("\\") || rel.includes("\0") || segments.length === 0 ||
    segments.some((s) => s === ".." || s === "." || s.startsWith("."))
  ) {
    return res.status(400).json({ success: false, message: "Bad file path." });
  }

  // 3. Extension whitelist — never serve types the write half wouldn't accept.
  const ext = path.extname(rel).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return res.status(404).json({ success: false, message: "File not found." });
  }

  // 4. Containment check (belt — sendFile's `root:` re-checks as braces).
  const abs = path.resolve(UPLOADS_ROOT, ...segments);
  if (!abs.startsWith(UPLOADS_ROOT + path.sep)) {
    return res.status(400).json({ success: false, message: "Bad file path." });
  }

  // 5. Regular files only — no directories, and no symlink escape: the
  //    realpath must still live under the uploads root.
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(UPLOADS_ROOT);
    if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) {
      return res.status(404).json({ success: false, message: "File not found." });
    }
  } catch (_) {
    return res.status(404).json({ success: false, message: "File not found." });
  }

  // 6. Serve. PHI — never cacheable (mirrors the index.js no-store list).
  res.set("Cache-Control", "no-store, private");
  res.type(contentType);
  res.sendFile(path.join(...segments), { root: UPLOADS_ROOT, dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) {
      res.status(err.status === 403 ? 400 : 404).json({ success: false, message: "File not found." });
    }
  });
});

// Anything but GET on /uploads is meaningless — uploads WRITE through the
// feature endpoints (safeUpload), never directly here.
router.all(/.*/, (_req, res) => {
  res.status(405).json({ success: false, message: "Method not allowed." });
});

module.exports = router;
