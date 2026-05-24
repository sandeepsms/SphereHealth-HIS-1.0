// scripts/seedAssessmentCompliance.js
// ════════════════════════════════════════════════════════════════════
// R7bw — One-shot seed for AssessmentCompliance. Pre-R7bw the collection
// was empty hospital-wide because rows were only inserted when a real
// assessment was saved. The R7bw boot-seed in index.js handles new
// admissions going forward, but to populate the collection NOW for the
// existing Active admissions, run this directly.
//
// USAGE:
//   node Backend/scripts/seedAssessmentCompliance.js
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const { seedAllActiveAdmissions, sweepOverdue } = require("../services/Compliance/assessmentComplianceService");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI not set"); process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("[seedAssessmentCompliance] starting…");

  const seed = await seedAllActiveAdmissions();
  console.log(`[seedAssessmentCompliance] seed result:`, seed);

  const sweep = await sweepOverdue();
  console.log(`[seedAssessmentCompliance] sweep result:`, sweep);

  const AssessmentCompliance = require("../models/Compliance/AssessmentComplianceModel");
  const total = await AssessmentCompliance.countDocuments({});
  const overdue = await AssessmentCompliance.countDocuments({ status: "OVERDUE" });
  const dueSoon = await AssessmentCompliance.countDocuments({ status: "DUE_SOON" });
  const done    = await AssessmentCompliance.countDocuments({ status: "DONE_THIS_WINDOW" });
  const notDue  = await AssessmentCompliance.countDocuments({ status: "NOT_DUE_YET" });
  console.log(`[seedAssessmentCompliance] post-seed totals:`);
  console.log(`  total=${total}  overdue=${overdue}  dueSoon=${dueSoon}  done=${done}  notDue=${notDue}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => {
  console.error("FATAL:", e.stack || e.message);
  process.exit(1);
});
