/**
 * money.js — helpers for working with Decimal128-stored currency amounts.
 *
 * Money fields are stored as mongoose Decimal128 so the database round-trip
 * doesn't drift (IEEE 754 floats accumulate fractional cents over hundreds
 * of line-items). Server-side JS still does the arithmetic in Number — the
 * helpers below convert at the schema boundary:
 *
 *   read  : toNum(doc.unitPrice)            → JS number for math
 *   write : doc.unitPrice = toDec(value)    → Decimal128 with 2-dp rounding
 *
 * The toJSON transform `decimalToNumber` converts every Decimal128 in the
 * serialized object (recursively, including nested arrays / subdocs) back
 * to a JS Number so the existing frontend keeps working with no change.
 */
const mongoose = require("mongoose");
const { Decimal128 } = mongoose.Types;

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  // mongoose Decimal128 / BSON Decimal128 — has toString().
  if (typeof v.toString === "function") return Number(v.toString()) || 0;
  return 0;
}

function toDec(n) {
  const x = (Number(n) || 0).toFixed(2);
  return Decimal128.fromString(x);
}

// Recursive walker that replaces every Decimal128 leaf with a plain Number.
// Called from toJSON / toObject transforms on schemas with money fields.
function decimalToNumber(_doc, ret) {
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (v && v._bsontype === "Decimal128") {
          node[i] = Number(v.toString());
        } else if (typeof v === "object") {
          walk(v);
        }
      }
      return;
    }
    if (typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && v._bsontype === "Decimal128") {
        node[k] = Number(v.toString());
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(ret);
  return ret;
}

module.exports = { toNum, toDec, decimalToNumber };
