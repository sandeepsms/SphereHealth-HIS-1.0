/**
 * bmwManifestService.js  (R7bj-F6 / NABH WB-CRIT-1 / BMW Rules 2016)
 *
 * Service layer for the BMW transport manifest register. Workflow:
 *
 *   1. createManifest(payload, actor)
 *        Hospital staff (HK / Ward Boy / Admin) collect the day's bags,
 *        weigh them, generate a manifest with a gap-less number.
 *        Status implicit: NOT handed over.
 *
 *   2. handover(id, driverInfo, signature, actor)
 *        CBWTF driver arrives, countersigns. Sets handedOverAt /
 *        cbwtfReceivedAt / signatures. From this moment the doc is
 *        append-only (enforced by model pre-update hooks).
 *
 *   3. markPcbFiled(id, refNumber, actor)
 *        Admin files the monthly state Pollution Control Board return
 *        (Form IV) and records the PCB-issued reference number. Only
 *        allowed after handover.
 *
 *   4. list / getById — readers.
 */
const BmwTransportManifest = require("../../models/Compliance/BmwTransportManifestModel");
const { nextSequence, formatId } = require("../../utils/counter");

function _err(code, message, status) {
  const e = new Error(message);
  e.code = code; e.status = status;
  return e;
}

function _istYear() {
  // Match counter.js IST anchoring so the manifest year prefix tracks
  // the same calendar boundary as the gap-less sequence.
  const tz = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()));
}

async function createManifest(payload, actor = {}) {
  if (!payload) throw _err("ARG_MISSING", "payload is required", 400);
  if (!payload.cbwtfName) throw _err("ARG_MISSING", "cbwtfName is required", 400);
  if (!payload.cbwtfLicenceNumber) throw _err("ARG_MISSING", "cbwtfLicenceNumber is required", 400);
  if (!payload.vehicleNumber) throw _err("ARG_MISSING", "vehicleNumber is required", 400);
  if (!Array.isArray(payload.bags) || payload.bags.length === 0) {
    throw _err("ARG_MISSING", "bags[] must contain at least one bag", 400);
  }

  // De-dup barcodes inside the same manifest (model has a sparse-by-array
  // index but we want a friendly error before insert).
  const seen = new Set();
  for (const b of payload.bags) {
    if (!b?.barcode) throw _err("ARG_MISSING", "every bag needs a barcode", 400);
    if (seen.has(b.barcode)) throw _err("DUP_BARCODE", `duplicate barcode in manifest: ${b.barcode}`, 400);
    seen.add(b.barcode);
    if (!b.bagColor) throw _err("ARG_MISSING", `bag ${b.barcode} missing bagColor`, 400);
    if (!b.category) throw _err("ARG_MISSING", `bag ${b.barcode} missing category`, 400);
    if (!Number.isFinite(Number(b.weight_kg)) || Number(b.weight_kg) <= 0) {
      throw _err("ARG_INVALID", `bag ${b.barcode} needs a positive weight_kg`, 400);
    }
  }

  const year = _istYear();
  const seq = await nextSequence(`bmw_manifest:${year}`);
  const manifestNumber = formatId(`BMW-${year}`, seq, 4); // BMW-2026-0001

  const bags = payload.bags.map((b) => ({
    barcode:       String(b.barcode).trim(),
    bagColor:      b.bagColor,
    category:      b.category,
    weight_kg:     Number(b.weight_kg),
    fromWard:      b.fromWard || "",
    generatedDate: b.generatedDate ? new Date(b.generatedDate) : new Date(),
  }));
  const totalBags = bags.length;
  const totalWeight_kg = Number(bags.reduce((s, b) => s + b.weight_kg, 0).toFixed(3));

  const doc = await BmwTransportManifest.create({
    manifestNumber,
    manifestDate:       payload.manifestDate ? new Date(payload.manifestDate) : new Date(),
    cbwtfName:          payload.cbwtfName,
    cbwtfLicenceNumber: payload.cbwtfLicenceNumber,
    vehicleNumber:      payload.vehicleNumber,
    driverName:         payload.driverName || "",
    driverPhone:        payload.driverPhone || "",
    bags,
    totalBags,
    totalWeight_kg,
    notes:              payload.notes || "",
    hospitalId:         actor.hospitalId || payload.hospitalId || null,
  });
  return doc;
}

/**
 * Handover step — CBWTF driver receives the bags. Records the driver
 * acknowledgement + signatures. Idempotent on a single doc: refuses if
 * already handed over (prevents accidental overwrite of the audit trail).
 */
async function handover(id, payload = {}, actor = {}) {
  if (!payload.cbwtfReceivedById) {
    throw _err("ARG_MISSING", "cbwtfReceivedById (driver licence / id) is required", 400);
  }
  const updated = await BmwTransportManifest.findOneAndUpdate(
    { _id: id, handedOverAt: null },
    {
      $set: {
        handedOverById:   actor._id || actor.id || null,
        handedOverByName: actor.fullName || actor.name || "",
        handedOverAt:     new Date(),
        cbwtfReceivedById: payload.cbwtfReceivedById,
        cbwtfReceivedAt:   payload.cbwtfReceivedAt ? new Date(payload.cbwtfReceivedAt) : new Date(),
        signature: {
          hospital: payload.signature?.hospital || "",
          cbwtf:    payload.signature?.cbwtf || "",
        },
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await BmwTransportManifest.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "BMW manifest not found", 404);
    throw _err("ALREADY_HANDED_OVER", "Manifest is already handed over — append-only after this point", 409);
  }
  return updated;
}

/**
 * markPcbFiled — administrative flip after the monthly Form-IV return
 * lands with the state PCB.  Only valid post-handover.
 */
async function markPcbFiled(id, refNumber, actor = {}) {
  if (!refNumber) throw _err("ARG_MISSING", "refNumber is required", 400);
  const updated = await BmwTransportManifest.findOneAndUpdate(
    { _id: id, handedOverAt: { $ne: null }, pcbReturnFiled: { $ne: true } },
    {
      $set: {
        pcbReturnFiled:       true,
        pcbReturnRefNumber:   String(refNumber).trim(),
        pcbReturnFiledAt:     new Date(),
        pcbReturnFiledBy:     actor._id || actor.id || null,
        pcbReturnFiledByName: actor.fullName || actor.name || "",
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await BmwTransportManifest.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "BMW manifest not found", 404);
    if (!existing.handedOverAt) {
      throw _err("INVALID_STATE", "Cannot file PCB return — manifest not yet handed over", 409);
    }
    throw _err("ALREADY_FILED", "PCB return already filed for this manifest", 409);
  }
  return updated;
}

async function getById(id) {
  if (!id) return null;
  return BmwTransportManifest.findById(id).lean();
}

async function list({ from, to, pcbFiled, limit = 100 } = {}) {
  const q = {};
  if (from || to) {
    q.manifestDate = {};
    if (from) q.manifestDate.$gte = new Date(from);
    if (to)   q.manifestDate.$lte = new Date(to);
  }
  if (pcbFiled === true || pcbFiled === "true") q.pcbReturnFiled = true;
  if (pcbFiled === false || pcbFiled === "false") q.pcbReturnFiled = false;
  return BmwTransportManifest.find(q)
    .sort({ manifestDate: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .lean();
}

module.exports = { createManifest, handover, markPcbFiled, getById, list };
