// controllers/backup/backupAdminController.js
// R7hr-272 — Admin backup page endpoints. All gated by backup.manage (Admin).
"use strict";

const fs   = require("fs");
const path = require("path");
const svc  = require("../../services/backup/backupAdminService");

exports.getStatus = async (req, res) => {
  try {
    res.json({ success: true, data: svc.getStatus() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.runNow = async (req, res) => {
  try {
    const result = await svc.runBackupNow();
    if (result.busy) return res.status(409).json({ success: false, ...result });
    res.json({ success: !!result.ok, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.download = async (req, res) => {
  try {
    const abs = svc.resolveDownload(req.params.file);
    if (!abs) {
      return res.status(404).json({ success: false, message: "Backup file not found." });
    }
    res.download(abs, path.basename(abs), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ success: false, message: "Download failed." });
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
