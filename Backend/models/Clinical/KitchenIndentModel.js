// models/Clinical/KitchenIndentModel.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — model moved to Backend/models/Pharmacy/KitchenIndentModel.js
// (close-loop owner re-organisation; collection name unchanged so
// existing rows are reused). This shim re-exports the new path so any
// older `require("../../models/Clinical/KitchenIndentModel")` callsite
// still resolves to the same compiled mongoose model. Once every
// caller has been migrated this file can be deleted.
// ════════════════════════════════════════════════════════════════════
module.exports = require("../Pharmacy/KitchenIndentModel");
