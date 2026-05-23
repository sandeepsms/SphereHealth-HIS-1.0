// Backend/services/Pharmacy/coldChainLogger.js
// R7bh-F5: cold-chain log service. WHO PQS E003 acceptable bands.

const ColdChainLog = require("../../models/Pharmacy/ColdChainLogModel");

const RANGES = {
  FRIDGE: { minC: 2, maxC: 8 },          // vaccines, insulin, biologics
  FREEZER: { minC: -25, maxC: -20 },      // OPV, varicella stockpile
  ROOM_TEMP: { minC: 15, maxC: 25 },      // controlled room temp
};

function _inRange(fridgeType, temperatureC) {
  const r = RANGES[fridgeType] || RANGES.FRIDGE;
  return temperatureC >= r.minC && temperatureC <= r.maxC;
}

async function recordReading({
  fridgeId,
  fridgeLabel = null,
  fridgeLocation = null,
  fridgeType = "FRIDGE",
  temperatureC,
  humidityPct = null,
  incidentNotes = null,
  recordedById,
  recordedByName,
  hospitalId = null,
}) {
  if (!fridgeId) throw Object.assign(new Error("fridgeId required"), { statusCode: 400, code: "FRIDGE_ID_REQUIRED" });
  if (typeof temperatureC !== "number" || Number.isNaN(temperatureC)) {
    throw Object.assign(new Error("temperatureC required (number)"), { statusCode: 400, code: "TEMP_REQUIRED" });
  }
  if (!recordedById) throw Object.assign(new Error("recordedById required"), { statusCode: 400, code: "ACTOR_REQUIRED" });

  const inRange = _inRange(fridgeType, temperatureC);
  const doc = await ColdChainLog.create({
    fridgeId,
    fridgeLabel,
    fridgeLocation,
    fridgeType,
    temperatureC,
    humidityPct,
    inRange,
    isBreachIncident: !inRange,
    incidentNotes: !inRange ? (incidentNotes || `Out of range for ${fridgeType}`) : incidentNotes,
    recordedById,
    recordedByName,
    hospitalId,
  });
  return doc.toObject();
}

async function getReadingsForFridge(fridgeId, from, to) {
  const q = { fridgeId };
  if (from || to) {
    q.recordedAt = {};
    if (from) q.recordedAt.$gte = new Date(from);
    if (to) q.recordedAt.$lte = new Date(to);
  }
  return ColdChainLog.find(q).sort({ recordedAt: -1 }).limit(500).lean();
}

async function getActiveBreaches(hospitalId = null) {
  const q = { isBreachIncident: true, acknowledgedAt: null };
  if (hospitalId) q.hospitalId = hospitalId;
  return ColdChainLog.find(q).sort({ recordedAt: -1 }).limit(100).lean();
}

async function acknowledgeBreach(id, acknowledgedById, acknowledgedByName, correctiveAction) {
  if (!correctiveAction || !String(correctiveAction).trim()) {
    throw Object.assign(new Error("correctiveAction required"), { statusCode: 400, code: "CORRECTIVE_ACTION_REQUIRED" });
  }
  const doc = await ColdChainLog.findOneAndUpdate(
    { _id: id, acknowledgedAt: null },
    {
      $set: {
        acknowledgedAt: new Date(),
        acknowledgedById,
        acknowledgedByName,
        correctiveAction: String(correctiveAction).trim(),
      },
    },
    { new: true }
  );
  if (!doc) {
    throw Object.assign(new Error("Already acknowledged or not found"), { statusCode: 409, code: "ALREADY_ACKED" });
  }
  return doc.toObject();
}

module.exports = { recordReading, getReadingsForFridge, getActiveBreaches, acknowledgeBreach, RANGES };
