/**
 * services/Abdm/abdmDataFlowService.js — ABDM M4 (health information exchange)
 *
 * On a consented health-information request the HIP must: assemble each care
 * context's clinical data into a FHIR R4 document Bundle, encrypt it end-to-end
 * for the HIU (X25519 → AES-GCM), and push the ciphertext to the HIU's
 * dataPushUrl, then notify the gateway of the transfer status.
 *
 * The assembly + encryption (`buildEncryptedTransfer`) is network-free so it is
 * unit-testable and drives the admin "FHIR preview". `pushHealthInformation`
 * adds the outbound gateway leg.
 */
"use strict";

const abdmCrypto = require("./abdmCrypto");
const { buildAbdmDocumentBundle } = require("./abdmFhirR4");

// R8-FIX(#37): permission.frequency { unit, value } → window length in ms (0 = not enforceable).
function _frequencyWindowMs(freq) {
  if (!freq || !freq.unit) return 0;
  const per = { HOUR: 3600e3, DAY: 86400e3, WEEK: 604800e3, MONTH: 2592000e3, YEAR: 31536000e3 }[String(freq.unit).toUpperCase()];
  if (!per) return 0;
  const value = Number(freq.value) > 0 ? Number(freq.value) : 1;
  return per * value;
}

// ── clinical file assembler (shape the FHIR exporter consumes) ─────
async function assembleFile(uhid, admissionId, dateRange = null) {
  const UH = String(uhid).toUpperCase();
  const Patient = require("../../models/Patient/patientModel");
  const Admission = require("../../models/Patient/admissionModel");
  const DoctorNotes = require("../../models/Doctor/DoctorNotesModel");
  const DoctorOrder = require("../../models/Doctor/DoctorOrderModel");

  // R8-FIX(#1) — ABDM HDM: restrict disclosure to the consent's permission.dateRange
  // window. No-op (byte-identical queries) when the range is absent/open-ended.
  const dateClause = (field) => {
    const r = {};
    if (dateRange && dateRange.from) r.$gte = new Date(dateRange.from);
    if (dateRange && dateRange.to)   r.$lte = new Date(dateRange.to);
    return (r.$gte || r.$lte) ? { [field]: r } : {};
  };

  const [patient, currentAdmission] = await Promise.all([
    Patient.findOne({ UHID: UH }).lean(),
    admissionId ? Admission.findById(admissionId).lean() : Admission.findOne({ UHID: UH }).sort({ admissionDate: -1 }).lean(),
  ]);
  const notesFilter = { ...(currentAdmission ? { admissionId: currentAdmission._id } : { patientUHID: UH }), ...dateClause("visitDate") };
  const [doctorNotes, doctorOrders, investigations, dischargeSummary] = await Promise.all([
    DoctorNotes.find(notesFilter).limit(500).lean().catch(() => []),
    DoctorOrder.find({ UHID: UH, ...dateClause("orderedAt") }).limit(500).lean().catch(() => []),
    (async () => {
      try {
        const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
        return await InvestigationOrder.find({ UHID: UH, ...dateClause("createdAt") }).limit(500).lean();
      } catch { return []; }
    })(),
    (async () => {
      try {
        const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
        const q = { ...(currentAdmission ? { admissionId: currentAdmission._id } : { UHID: UH }), ...dateClause("createdAt") };
        return await DischargeSummary.find(q).sort({ createdAt: -1 }).limit(10).lean();
      } catch { return []; }
    })(),
  ]);
  return { patient, currentAdmission, doctorNotes, doctorOrders, investigations, dischargeSummary, vitals: [], consents: [] };
}

// Build the FHIR document bundle for one care context (+ hospital identity).
async function buildBundleForCareContext(careContext, hiType, dateRange = null) {
  const HospitalSettings = require("../../models/HospitalSettings");
  const settings = await HospitalSettings.findOne({}).lean().catch(() => null);
  const hospital = settings
    ? { name: settings.hospitalName || settings.name, hfrId: settings.hfrId, address: settings.address }
    : {};
  const file = await assembleFile(careContext.UHID, careContext.admissionId, dateRange);
  return buildAbdmDocumentBundle(file, hospital, { hiType });
}

/**
 * Assemble + encrypt the transfer for a health-information request. Network-
 * free. Returns the data-push payload (ciphertext entries + HIP key material).
 * @param consentArtefact  AbdmConsentArtefact doc
 * @param hiRequest        { transactionId, keyMaterial:{ dhPublicKey:{keyValue}, nonce }, ... }
 * @param careContexts     [AbdmCareContext] to serve (defaults to the artefact's)
 */
async function buildEncryptedTransfer({ consentArtefact, hiRequest, careContexts = null }) {
  const hiuKey = hiRequest?.keyMaterial;
  if (!hiuKey?.dhPublicKey?.keyValue || !hiuKey?.nonce) {
    const e = new Error("hiRequest.keyMaterial (HIU dhPublicKey + nonce) is required"); e.status = 400; throw e;
  }
  // HIP ephemeral keys.
  const hip = abdmCrypto.generateKeyMaterial();

  const AbdmCareContext = require("../../models/Abdm/AbdmCareContextModel");
  const ccRows = careContexts || await AbdmCareContext.find({
    careContextReference: { $in: (consentArtefact.careContexts || []).map((c) => c.careContextReference) },
  }).lean();

  const hiTypes = consentArtefact.hiTypes && consentArtefact.hiTypes.length ? consentArtefact.hiTypes : ["OPConsultation"];
  // R8-FIX(#1): honour the consent's permission.dateRange when assembling records.
  const dateRange = (consentArtefact && consentArtefact.permission && consentArtefact.permission.dateRange) || null;
  const entries = [];
  for (const cc of ccRows) {
    // One document per (care context × requested HI type) that the context serves.
    for (const hiType of hiTypes) {
      if (Array.isArray(cc.hiTypes) && cc.hiTypes.length && !cc.hiTypes.includes(hiType)) continue;
      const bundle = await buildBundleForCareContext(cc, hiType, dateRange);
      const plaintext = JSON.stringify(bundle);
      const content = abdmCrypto.encrypt({
        plaintext,
        senderPrivateKey: hip.privateKey,
        receiverPublicKeyB64: hiuKey.dhPublicKey.keyValue,
        senderNonceB64: hip.nonceBase64,
        receiverNonceB64: hiuKey.nonce,
      });
      entries.push({
        content,
        media: "application/fhir+json",
        checksum: abdmCrypto.checksum(plaintext),
        careContextReference: cc.careContextReference,
      });
    }
  }

  return {
    pageNumber: 1,
    pageCount: 1,
    transactionId: hiRequest.transactionId || "",
    entries,
    keyMaterial: hip.keyMaterial,   // HIP's public key + nonce so the HIU can derive the shared key
    _entryCount: entries.length,
  };
}

/**
 * Full data flow: build+encrypt+push to the HIU + notify the gateway.
 * Requires ABDM enabled (uses the gateway). Returns the transfer summary.
 */
async function pushHealthInformation({ consentArtefact, hiRequest }) {
  const gateway = require("./abdmGateway");
  // R8-FIX(#37): enforce permission.frequency — at most `repeats` pulls per
  // (value×unit) window — BEFORE assembling/encrypting so a denied replay builds
  // nothing. Blank/unknown frequency (schema default) → no enforcement.
  const _freq = consentArtefact.permission && consentArtefact.permission.frequency;
  const _windowMs = _frequencyWindowMs(_freq);
  if (_windowMs > 0) {
    const maxPulls = Number(_freq.repeats) > 0 ? Number(_freq.repeats) : 1;
    const now = Date.now();
    const wStart = consentArtefact.frequencyWindowStart ? new Date(consentArtefact.frequencyWindowStart).getTime() : 0;
    if (!wStart || (now - wStart) >= _windowMs) {
      consentArtefact.frequencyWindowStart = new Date(now);
      consentArtefact.fetchCountInWindow = 0;
    }
    if ((consentArtefact.fetchCountInWindow || 0) >= maxPulls) {
      const e = new Error(`consent frequency exceeded: ${maxPulls} pull(s) per ${_freq.value || 1} ${_freq.unit}`);
      e.status = 429;
      throw e;
    }
  }
  const transfer = await buildEncryptedTransfer({ consentArtefact, hiRequest });
  const dataPushUrl = hiRequest?.dataPushUrl || hiRequest?.hiRequest?.dataPushUrl;
  if (!dataPushUrl) { const e = new Error("hiRequest.dataPushUrl missing"); e.status = 400; throw e; }

  const push = await gateway.hiDataPush(dataPushUrl, transfer);

  // Transfer status notification back to the gateway.
  await gateway.hiNotify({
    requestId: require("crypto").randomUUID(),
    timestamp: new Date().toISOString(),
    notification: {
      consentId: consentArtefact.consentId,
      transactionId: hiRequest.transactionId,
      doneAt: new Date().toISOString(),
      notifier: { type: "HIP", id: require("../../config/abdm").ABDM.hipId },
      statusNotification: { sessionStatus: push.ok ? "TRANSFERRED" : "FAILED", hipId: require("../../config/abdm").ABDM.hipId },
    },
  }).catch(() => {});

  // Consent fetch bookkeeping.
  try {
    consentArtefact.lastFetchedAt = new Date();
    consentArtefact.fetchCount = (consentArtefact.fetchCount || 0) + 1;
    consentArtefact.fetchCountInWindow = (consentArtefact.fetchCountInWindow || 0) + 1; // R8-FIX(#37)
    if (consentArtefact.save) await consentArtefact.save();
  } catch (_) { /* best-effort */ }

  return { pushed: push.ok, httpStatus: push.status, entryCount: transfer._entryCount };
}

module.exports = { assembleFile, buildBundleForCareContext, buildEncryptedTransfer, pushHealthInformation };
