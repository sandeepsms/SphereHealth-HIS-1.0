/**
 * icuBundleController.js — R7eg
 *
 * Endpoints exposed at /api/icu-bundles:
 *   GET    /:uhid                          — last 30 days of sheets for a UHID
 *   GET    /:uhid/:date/:shift             — fetch sheet by UHID + date + shift
 *   POST   /                               — upsert sheet (admissionId+date+shift)
 *   PATCH  /:id/:bundleKey/:itemKey        — toggle a single checklist item
 *   POST   /:id/finalize                   — lock the sheet, emit final audit
 *
 * Mirrors diabeticChartController patterns:
 *   - admissionId+date+shift compound upsert
 *   - VersionError-safe via retryVersionError for the toggle/finalize paths
 *   - ClinicalAudit emit on save + finalize + per-bundle non-compliance signal
 */
const mongoose       = require("mongoose");
const ICUBundle      = require("../../models/Clinical/ICUBundleModel");
const Admission      = require("../../models/Patient/admissionModel");
const retryVersionError = require("../../utils/retryVersionError");
const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");

const BUNDLE_KEYS = ICUBundle.BUNDLE_KEYS;
const DEFAULT_ITEMS = ICUBundle.DEFAULT_ITEMS;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Build a fresh bundle sub-document with the canonical checklist seed.
function seedBundle(key) {
  return {
    applicable: true,
    items: (DEFAULT_ITEMS[key] || []).map(it => ({
      key: it.key,
      label: it.label,
      checked: false,
      notes: "",
    })),
    compliancePct: 0,
    nurseName: "",
    nurseId: null,
    signedAt: null,
  };
}

// Merge an incoming bundle payload onto an existing bundle without
// dropping items the client didn't send. The client can send partial
// items[] (e.g. just key+checked); we splice them onto the canonical
// seeded list by key.
function mergeBundle(existing, incoming, key) {
  const base = existing || seedBundle(key);
  if (!incoming) return base;

  // Replace applicable flag if explicitly sent.
  if (typeof incoming.applicable === "boolean") base.applicable = incoming.applicable;

  // Merge items by key — preserves order from the seed.
  if (Array.isArray(incoming.items) && incoming.items.length > 0) {
    const byKey = new Map((base.items || []).map(i => [i.key, { ...(i.toObject ? i.toObject() : i) }]));
    for (const it of incoming.items) {
      if (!it?.key) continue;
      const prev = byKey.get(it.key) || { key: it.key, label: it.label || it.key, checked: false, notes: "" };
      byKey.set(it.key, {
        key: prev.key,
        label: prev.label || it.label || prev.key,
        checked: typeof it.checked === "boolean" ? it.checked : !!prev.checked,
        notes: typeof it.notes === "string" ? it.notes : (prev.notes || ""),
      });
    }
    // Preserve canonical seed ordering — items in the default list come
    // first, then anything custom appended at the end.
    const seedKeys = (DEFAULT_ITEMS[key] || []).map(i => i.key);
    const ordered = [];
    for (const sk of seedKeys) if (byKey.has(sk)) { ordered.push(byKey.get(sk)); byKey.delete(sk); }
    for (const extra of byKey.values()) ordered.push(extra);
    base.items = ordered;
  }

  // Signature fields — only overwrite when explicitly provided so a
  // partial PATCH doesn't wipe an earlier signature.
  if (incoming.nurseName != null) base.nurseName = incoming.nurseName;
  if (incoming.nurseId   != null) base.nurseId   = incoming.nurseId;
  if (incoming.signedAt  != null) base.signedAt  = incoming.signedAt;

  return base;
}

// ─── GET /:uhid ──────────────────────────────────────────────────────
// Last 30 days of sheets for a UHID. Summary rows only — UI hydrates
// the full sheet via getByDateShift when one is opened.
exports.listByUhid = async (req, res) => {
  try {
    const { uhid } = req.params;
    if (!uhid) return res.status(400).json({ success: false, message: "UHID required" });

    // 30-day window — matches the diabetic chart list cadence.
    const thirty = new Date(); thirty.setDate(thirty.getDate() - 30);
    const cutoff = `${thirty.getFullYear()}-${String(thirty.getMonth() + 1).padStart(2, "0")}-${String(thirty.getDate()).padStart(2, "0")}`;

    const rows = await ICUBundle
      .find({ UHID: uhid, date: { $gte: cutoff } })
      .sort({ date: -1, shift: 1 })
      .lean();

    // R7ei — include finalizedBy / updatedBy so the frontend history
    // panel can render the nurse / clinician who signed each row.
    const summary = rows.map(r => ({
      _id: r._id,
      date: r.date,
      shift: r.shift,
      status: r.status,
      overallCompliancePct: r.overallCompliancePct,
      finalizedBy: r.finalizedBy || "",
      finalizedAt: r.finalizedAt || null,
      updatedBy: r.updatedBy || "",
      bundles: BUNDLE_KEYS.reduce((acc, k) => {
        acc[k] = {
          applicable: r[k]?.applicable !== false,
          compliancePct: r[k]?.compliancePct ?? 0,
        };
        return acc;
      }, {}),
    }));

    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── GET /admission/:admissionId ─────────────────────────────────────
// Every bundle sheet ever filed for a given admission, sorted by date
// + shift, with bundle subdocs unwrapped into a flat shape for easy
// print rendering. Unlike listByUhid this returns FULL items[] (not
// just the compliancePct summary) and is NOT capped to 30 days — the
// Patient File / Treatment Chart print needs the entire admission's
// worth of bundle activity, however long the stay was.
exports.listByAdmission = async (req, res) => {
  try {
    const { admissionId } = req.params;
    if (!admissionId) {
      return res.status(400).json({ success: false, message: "admissionId required" });
    }
    if (!mongoose.Types.ObjectId.isValid(admissionId)) {
      return res.status(400).json({ success: false, message: "Invalid admissionId" });
    }

    const SHIFT_ORDER = { Morning: 0, Evening: 1, Night: 2 };
    const rows = await ICUBundle
      .find({ admissionId })
      .sort({ date: 1 })
      .lean();

    // Sort within a date by canonical shift order (Morning → Evening → Night)
    // so the print reads top-to-bottom in the order the nurses would have
    // filled it.
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
    });

    // Unwrap bundles into an array so the print template can iterate
    // without knowing the six keys. We keep the parent doc fields intact
    // and add `bundles: [{key, title, ...subdoc}]` for convenience.
    const TITLES = {
      vap:    "VAP — Ventilator-Associated Pneumonia",
      cauti:  "CAUTI — Catheter-Associated UTI",
      clabsi: "CLABSI — Central Line BSI",
      dvt:    "DVT Prophylaxis",
      sepsis: "Sepsis — Hour-1 Bundle",
      sup:    "SUP — Stress Ulcer Prophylaxis",
    };

    const data = rows.map((r) => {
      const bundles = BUNDLE_KEYS.map((k) => {
        const b = r[k] || {};
        return {
          key: k,
          title: TITLES[k] || k.toUpperCase(),
          applicable: b.applicable !== false,
          items: Array.isArray(b.items) ? b.items : [],
          compliancePct: typeof b.compliancePct === "number" ? b.compliancePct : 0,
          nurseName: b.nurseName || "",
          signedAt:  b.signedAt || null,
        };
      });
      return {
        _id: r._id,
        UHID: r.UHID,
        admissionId: r.admissionId,
        admissionNumber: r.admissionNumber,
        patientName: r.patientName,
        date: r.date,
        shift: r.shift,
        status: r.status,
        overallCompliancePct: r.overallCompliancePct,
        notes: r.notes,
        finalizedBy: r.finalizedBy,
        finalizedAt: r.finalizedAt,
        bundles,
      };
    });

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── GET /:uhid/:date/:shift ─────────────────────────────────────────
exports.getByDateShift = async (req, res) => {
  try {
    const { uhid, date, shift } = req.params;
    if (!uhid || !date || !shift) {
      return res.status(400).json({ success: false, message: "uhid, date, shift required" });
    }
    const sheet = await ICUBundle.findOne({ UHID: uhid, date, shift }).lean();
    res.json({ success: true, data: sheet || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── POST / ──────────────────────────────────────────────────────────
// Upsert by (admissionId, date, shift). Seeds default checklists on
// first create. Subsequent saves can either send a full bundles
// payload or partial — mergeBundle() handles both.
exports.upsertSheet = async (req, res) => {
  try {
    const {
      UHID, admissionId, date = todayStr(), shift,
      patientId, admissionNumber, patientName,
      notes,
      // bundle payloads — any of vap/cauti/clabsi/dvt/sepsis/sup
      ...rest
    } = req.body || {};

    if (!UHID || !admissionId || !shift) {
      return res.status(400).json({ success: false, message: "UHID, admissionId, shift required" });
    }
    if (!ICUBundle.SHIFTS.includes(shift)) {
      return res.status(400).json({ success: false, message: `Invalid shift "${shift}"` });
    }

    // Resolve patientId from admission if missing.
    let pid = patientId;
    let pName = patientName;
    let admNo = admissionNumber;
    if (!pid || !pName) {
      const adm = await Admission.findById(admissionId).lean();
      if (adm) {
        if (!pid)  pid  = adm.patientId;
        if (!pName) pName = adm.patientName || adm.patientId?.fullName || "";
        if (!admNo) admNo = adm.admissionNumber || "";
      }
    }

    const sheet = await retryVersionError(async () => {
      let doc = await ICUBundle.findOne({ admissionId, date, shift });
      const isNew = !doc;
      if (!doc) {
        doc = new ICUBundle({
          UHID, admissionId, patientId: pid || null,
          patientName: pName || "",
          admissionNumber: admNo || "",
          date, shift,
          // Seed every bundle with the canonical checklist so the UI
          // can render checkboxes immediately on first open.
          vap:    seedBundle("vap"),
          cauti:  seedBundle("cauti"),
          clabsi: seedBundle("clabsi"),
          dvt:    seedBundle("dvt"),
          sepsis: seedBundle("sepsis"),
          sup:    seedBundle("sup"),
          createdBy: req.user?.fullName || req.user?.name || "System",
        });
      }
      // Apply any per-bundle updates from the request.
      for (const k of BUNDLE_KEYS) {
        if (rest[k]) doc[k] = mergeBundle(doc[k], rest[k], k);
      }
      if (typeof notes === "string") doc.notes = notes;
      doc.updatedBy = req.user?.fullName || req.user?.name || "System";
      await doc.save();
      doc.__isNew = isNew;
      return doc;
    }, { label: "icu-bundle-upsert" });

    // Fire audit (best-effort, never throws).
    emitClinicalAudit({
      req,
      event: "ICU_BUNDLE_SAVED",
      UHID: sheet.UHID,
      admissionId: sheet.admissionId,
      patientId: sheet.patientId,
      patientName: sheet.patientName,
      targetType: "ICUBundle",
      targetId: sheet._id,
      after: {
        date: sheet.date,
        shift: sheet.shift,
        overallCompliancePct: sheet.overallCompliancePct,
        status: sheet.status,
      },
    });

    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── PATCH /:id/:bundleKey/:itemKey ──────────────────────────────────
// Toggle a single checklist item. Body: { checked: bool, notes?: string }.
// Cheap optimistic-concurrency-friendly per-checkbox update.
exports.toggleItem = async (req, res) => {
  try {
    const { id, bundleKey, itemKey } = req.params;
    const { checked, notes } = req.body || {};

    if (!BUNDLE_KEYS.includes(bundleKey)) {
      return res.status(400).json({ success: false, message: `Unknown bundleKey "${bundleKey}"` });
    }

    const sheet = await retryVersionError(async () => {
      const doc = await ICUBundle.findById(id);
      if (!doc) {
        const e = new Error("Sheet not found"); e.status = 404; throw e;
      }
      if (doc.status === "finalized") {
        const e = new Error("Cannot edit a finalized shift"); e.status = 409; throw e;
      }
      const bundle = doc[bundleKey];
      if (!bundle) {
        const e = new Error(`Bundle "${bundleKey}" missing on sheet`); e.status = 404; throw e;
      }
      const idx = (bundle.items || []).findIndex(i => i.key === itemKey);
      if (idx < 0) {
        const e = new Error(`Item "${itemKey}" not in bundle "${bundleKey}"`); e.status = 404; throw e;
      }
      if (typeof checked === "boolean") bundle.items[idx].checked = checked;
      if (typeof notes === "string")    bundle.items[idx].notes   = notes;
      // Make sure mongoose notices the deep mutation on the subdoc array.
      doc.markModified(`${bundleKey}.items`);
      doc.updatedBy = req.user?.fullName || req.user?.name || "System";
      await doc.save();
      return doc;
    }, { label: "icu-bundle-toggle" });

    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

// ─── POST /:id/finalize ──────────────────────────────────────────────
// Lock the shift, stamp signature, emit final audit + per-bundle
// non-compliance signals so the IC officer's daily roll-up surfaces
// them automatically.
exports.finalize = async (req, res) => {
  try {
    const { id } = req.params;

    const sheet = await retryVersionError(async () => {
      const doc = await ICUBundle.findById(id);
      if (!doc) { const e = new Error("Sheet not found"); e.status = 404; throw e; }
      if (doc.status === "finalized") {
        // Idempotent — second finalize click is fine.
        return doc;
      }
      doc.status = "finalized";
      doc.finalizedBy   = req.user?.fullName || req.user?.name || "System";
      doc.finalizedById = req.user?._id || null;
      doc.finalizedAt   = new Date();
      // Stamp the per-bundle signature on every applicable bundle that
      // doesn't yet have one — saves the nurse from clicking a sign
      // button on each card individually.
      for (const k of BUNDLE_KEYS) {
        const b = doc[k];
        if (!b || b.applicable === false) continue;
        if (!b.signedAt) {
          b.nurseName = doc.finalizedBy;
          b.nurseId   = doc.finalizedById;
          b.signedAt  = doc.finalizedAt;
        }
      }
      doc.updatedBy = doc.finalizedBy;
      await doc.save();
      return doc;
    }, { label: "icu-bundle-finalize" });

    // Top-level finalize event.
    emitClinicalAudit({
      req,
      event: "ICU_BUNDLE_SHIFT_FINALIZED",
      UHID: sheet.UHID,
      admissionId: sheet.admissionId,
      patientId: sheet.patientId,
      patientName: sheet.patientName,
      targetType: "ICUBundle",
      targetId: sheet._id,
      after: {
        date: sheet.date, shift: sheet.shift,
        overallCompliancePct: sheet.overallCompliancePct,
        finalizedBy: sheet.finalizedBy,
      },
    });

    // Per-bundle non-compliance signals — VAP and CLABSI specifically
    // because those two have the highest mortality + are the marquee
    // metrics on the NABH HIC.5 register. Fire only when the bundle
    // was *applicable* (skip patients not on vent / no central line).
    if (sheet.vap?.applicable && (sheet.vap.compliancePct ?? 0) < 100) {
      emitClinicalAudit({
        req,
        event: "ICU_BUNDLE_VAP_NON_COMPLIANT",
        UHID: sheet.UHID,
        admissionId: sheet.admissionId,
        patientId: sheet.patientId,
        patientName: sheet.patientName,
        targetType: "ICUBundle",
        targetId: sheet._id,
        after: {
          date: sheet.date, shift: sheet.shift,
          compliancePct: sheet.vap.compliancePct,
          missed: (sheet.vap.items || []).filter(i => !i.checked).map(i => i.key),
        },
      });
    }
    if (sheet.clabsi?.applicable && (sheet.clabsi.compliancePct ?? 0) < 100) {
      emitClinicalAudit({
        req,
        event: "ICU_BUNDLE_CLABSI_NON_COMPLIANT",
        UHID: sheet.UHID,
        admissionId: sheet.admissionId,
        patientId: sheet.patientId,
        patientName: sheet.patientName,
        targetType: "ICUBundle",
        targetId: sheet._id,
        after: {
          date: sheet.date, shift: sheet.shift,
          compliancePct: sheet.clabsi.compliancePct,
          missed: (sheet.clabsi.items || []).filter(i => !i.checked).map(i => i.key),
        },
      });
    }

    res.json({ success: true, data: sheet });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};
