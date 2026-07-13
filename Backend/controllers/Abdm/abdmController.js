/**
 * controllers/Abdm/abdmController.js — ABDM gateway callbacks + admin ops
 *
 * Callback handlers (inbound from the ABDM gateway) follow ABDM's async
 * pattern: validate + journal the request, ACK 202 immediately, then compute
 * and POST the matching /on-* reply out-of-band. Admin/ops handlers (behind
 * abdm.read/write) drive local ABHA linking, care-context inspection, and a
 * FHIR document-bundle preview (which works even when ABDM is disabled, since
 * it's pure local FHIR generation).
 */
"use strict";

const crypto = require("crypto");
const { ABDM, publicConfig } = require("../../config/abdm");

const AbdmTransaction = () => require("../../models/Abdm/AbdmTransactionModel");
const AbdmCareContext = () => require("../../models/Abdm/AbdmCareContextModel");
const AbdmConsentArtefact = () => require("../../models/Abdm/AbdmConsentArtefactModel");
const linkService = () => require("../../services/Abdm/abdmLinkService");
const dataFlow = () => require("../../services/Abdm/abdmDataFlowService");
const gateway = () => require("../../services/Abdm/abdmGateway");

async function _journal(fields) {
  try { await AbdmTransaction().create(fields); } catch (_) { /* best-effort */ }
}
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────
// CALLBACKS (gateway → HIP)  —  ACK 202, then reply via /on-* asynchronously
// ─────────────────────────────────────────────────────────────────────────

// POST /api/abdm/v0.5/care-contexts/discover
exports.careContextsDiscover = async (req, res) => {
  const b = req.body || {};
  await _journal({ kind: "DISCOVER", direction: "INBOUND", status: "RECEIVED", requestId: b.requestId, transactionId: b.transactionId, endpoint: "care-contexts/discover", requestPayload: b });
  res.status(202).json({ status: "processing" });
  // async reply
  (async () => {
    try {
      const result = await linkService().discoverForDemographics(b.patient || {});
      const reply = {
        requestId: uuid(), timestamp: nowIso(), transactionId: b.transactionId,
        patient: result.matched ? {
          referenceNumber: result.patientReference, display: result.patientDisplay,
          careContexts: result.careContexts, matchedBy: ["MOBILE", "ABHA_ADDRESS"],
        } : null,
        error: result.matched ? null : { code: "ABDM-1010", message: "No patient found" },
        resp: { requestId: b.requestId },
      };
      await gateway().onDiscover(reply);
    } catch (e) { console.warn("[abdm] discover reply failed:", e.message); }
  })().catch(() => {});
};

// POST /api/abdm/v0.5/links/link/init
exports.linkInit = async (req, res) => {
  const b = req.body || {};
  await _journal({ kind: "LINK_INIT", direction: "INBOUND", status: "RECEIVED", requestId: b.requestId, transactionId: b.transactionId, endpoint: "links/link/init", requestPayload: b });
  res.status(202).json({ status: "processing" });
  (async () => {
    try {
      const linkRefNumber = uuid();
      await gateway().onLinkInit({
        requestId: uuid(), timestamp: nowIso(), transactionId: b.transactionId,
        link: { referenceNumber: linkRefNumber, authenticationType: "DIRECT", meta: { communicationMedium: "MOBILE", communicationHint: "OTP", communicationExpiry: new Date(Date.now() + 300000).toISOString() } },
        error: null, resp: { requestId: b.requestId },
      });
    } catch (e) { console.warn("[abdm] link/init reply failed:", e.message); }
  })().catch(() => {});
};

// POST /api/abdm/v0.5/links/link/confirm
exports.linkConfirm = async (req, res) => {
  const b = req.body || {};
  await _journal({ kind: "LINK_CONFIRM", direction: "INBOUND", status: "RECEIVED", requestId: b.requestId, endpoint: "links/link/confirm", requestPayload: b });
  res.status(202).json({ status: "processing" });
  (async () => {
    try {
      await gateway().onLinkConfirm({
        requestId: uuid(), timestamp: nowIso(),
        patient: { referenceNumber: b.confirmation?.linkRefNumber || "", display: "", careContexts: [] },
        error: null, resp: { requestId: b.requestId },
      });
    } catch (e) { console.warn("[abdm] link/confirm reply failed:", e.message); }
  })().catch(() => {});
};

// POST /api/abdm/v0.5/consents/hip/notify  — store the granted consent artefact
exports.consentHipNotify = async (req, res) => {
  const b = req.body || {};
  const n = b.notification || {};
  await _journal({ kind: "CONSENT_NOTIFY", direction: "INBOUND", status: "RECEIVED", requestId: b.requestId, endpoint: "consents/hip/notify", abhaAddress: n.consentDetail?.patient?.id || "", requestPayload: b });
  try {
    const d = n.consentDetail || {};
    if (n.consentId && n.status === "GRANTED") {
      await AbdmConsentArtefact().findOneAndUpdate(
        { consentId: n.consentId },
        { $set: {
            consentId: n.consentId, consentRequestId: d.consentId || "",
            abhaAddress: d.patient?.id || "", hipId: d.hip?.id || ABDM.hipId,
            hiu: { id: d.hiu?.id || "", name: d.hiu?.name || "" },
            hiTypes: Array.isArray(d.hiTypes) ? d.hiTypes : [],
            careContexts: (d.careContexts || []).map((c) => ({ patientReference: c.patientReference, careContextReference: c.careContextReference })),
            permission: {
              accessMode: d.permission?.accessMode || "VIEW",
              dateRange: { from: d.permission?.dateRange?.from || null, to: d.permission?.dateRange?.to || null },
              dataEraseAt: d.permission?.dataEraseAt || null,
              frequency: d.permission?.frequency || {},
            },
            signature: n.signature || "", status: "GRANTED", grantedAt: new Date(),
            expiry: d.permission?.dataEraseAt || null, raw: b,
          } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } else if (n.consentId && (n.status === "REVOKED" || n.status === "EXPIRED")) {
      await AbdmConsentArtefact().updateOne({ consentId: n.consentId }, { $set: { status: n.status } });
    }
  } catch (e) { console.warn("[abdm] consent persist failed:", e.message); }
  res.status(202).json({ status: "processing" });
  (async () => {
    try {
      await gateway().onConsentNotify({ requestId: uuid(), timestamp: nowIso(), acknowledgement: { status: "OK", consentId: n.consentId }, error: null, resp: { requestId: b.requestId } });
    } catch (e) { console.warn("[abdm] consent on-notify failed:", e.message); }
  })().catch(() => {});
};

// POST /api/abdm/v0.5/health-information/hip/request  — serve consented data
exports.healthInfoHipRequest = async (req, res) => {
  const b = req.body || {};
  const hiRequest = b.hiRequest || {};
  await _journal({ kind: "HI_REQUEST", direction: "INBOUND", status: "RECEIVED", requestId: b.requestId, transactionId: b.transactionId, endpoint: "health-information/hip/request", requestPayload: b });
  res.status(202).json({ status: "processing" });
  (async () => {
    try {
      // ACK the request first.
      await gateway().onHiRequest({ requestId: uuid(), timestamp: nowIso(), hiRequest: { transactionId: b.transactionId, sessionStatus: "ACKNOWLEDGED" }, error: null, resp: { requestId: b.requestId } });
      // Validate consent + push.
      const consentId = hiRequest.consent?.id;
      const artefact = consentId ? await AbdmConsentArtefact().findOne({ consentId }) : null;
      if (!artefact || !artefact.isActive()) {
        console.warn("[abdm] HI request denied — no active consent:", consentId);
        return;
      }
      await dataFlow().pushHealthInformation({
        consentArtefact: artefact,
        hiRequest: { transactionId: b.transactionId, keyMaterial: hiRequest.keyMaterial, dataPushUrl: hiRequest.dataPushUrl },
      });
    } catch (e) { console.warn("[abdm] HI request flow failed:", e.message); }
  })().catch(() => {});
};

// ─────────────────────────────────────────────────────────────────────────
// ADMIN / OPS (behind JWT + abdm.*)
// ─────────────────────────────────────────────────────────────────────────

// GET /api/abdm/status
exports.getStatus = async (req, res) => {
  try {
    const [careContexts, consents, transactions, linkedPatients] = await Promise.all([
      AbdmCareContext().countDocuments({}).catch(() => 0),
      AbdmConsentArtefact().countDocuments({ status: "GRANTED" }).catch(() => 0),
      AbdmTransaction().countDocuments({}).catch(() => 0),
      require("../../models/Patient/patientModel").countDocuments({ abhaLinked: true }).catch(() => 0),
    ]);
    return res.json({ success: true, data: { config: publicConfig(), counts: { careContexts, activeConsents: consents, transactions, linkedPatients } } });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

// POST /api/abdm/link-abha  { uhid, abhaNumber, abhaAddress, kycVerified }
exports.linkAbha = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.uhid) return res.status(400).json({ success: false, message: "uhid is required" });
    if (!b.abhaNumber && !b.abhaAddress) return res.status(400).json({ success: false, message: "abhaNumber or abhaAddress required" });
    const { patient, careContexts } = await linkService().linkPatientAbha({
      uhid: b.uhid, abhaNumber: b.abhaNumber, abhaAddress: b.abhaAddress, kycVerified: b.kycVerified, actor: req.user,
    });
    return res.json({ success: true, data: {
      UHID: patient.UHID, abhaNumber: patient.abhaNumber, abhaAddress: patient.abhaAddress,
      abhaLinked: patient.abhaLinked, careContextsLinked: careContexts.length,
      careContexts: careContexts.map((c) => ({ ref: c.careContextReference, display: c.display, hiTypes: c.hiTypes })),
    } });
  } catch (e) { return res.status(e.status || 500).json({ success: false, message: e.message }); }
};

// GET /api/abdm/care-contexts/:uhid
exports.listCareContexts = async (req, res) => {
  try {
    const rows = await AbdmCareContext().find({ UHID: String(req.params.uhid).toUpperCase() }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

// GET /api/abdm/fhir-preview/:uhid?admissionId=&hiType=  — local FHIR gen (works even when ABDM disabled)
exports.fhirPreview = async (req, res) => {
  try {
    const uhid = String(req.params.uhid).toUpperCase();
    const hiType = req.query.hiType || "OPConsultation";
    const cc = { UHID: uhid, admissionId: req.query.admissionId || null };
    const bundle = await dataFlow().buildBundleForCareContext(cc, hiType);
    res.setHeader("Content-Type", "application/fhir+json");
    return res.json(bundle);
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

// GET /api/abdm/transactions?kind=&limit=
exports.listTransactions = async (req, res) => {
  try {
    const q = {};
    if (req.query.kind) q.kind = req.query.kind;
    if (req.query.direction) q.direction = req.query.direction;
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rows = await AbdmTransaction().find(q).sort({ createdAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};
