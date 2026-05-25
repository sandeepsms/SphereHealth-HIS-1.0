// models/Common/PincodeMasterModel.js
// ────────────────────────────────────────────────────────────────
// R7dn — Cached pincode → address lookup.
//
// Every successful third-party lookup (postalpincode.in, Nominatim,
// zippopotam.us) gets persisted here so future requests are an
// instant MongoDB hit instead of a network round-trip. Pincode →
// district/state/city mappings rarely change, so the cache is
// effectively forever (no TTL).
//
// `source` tracks which API populated the row, useful for back-
// filling district later if the row was created from zippopotam
// (no district) and a richer source becomes available.
// ────────────────────────────────────────────────────────────────
const mongoose = require("mongoose");

const PincodeMasterSchema = new mongoose.Schema(
  {
    pincode:  { type: String, required: true, unique: true, index: true,
                match: /^\d{6}$/ },
    city:     { type: String, default: "" },
    district: { type: String, default: "" },
    state:    { type: String, default: "" },
    country:  { type: String, default: "India" },
    // R7dn — provenance, so we know if/when to refresh:
    //   postalpincode  — best, has all 3 fields
    //   nominatim      — OSM, has state + county (treat as district)
    //   zippopotam     — has city + state (no district)
    //   manual         — admin seeded
    source:   { type: String, enum: ["local-india-post", "postalpincode", "nominatim", "zippopotam", "manual"], default: "manual" },
    // Optional secondary data we collected but don't surface in the form
    division: { type: String, default: "" },
    block:    { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.PincodeMaster
  || mongoose.model("PincodeMaster", PincodeMasterSchema);
