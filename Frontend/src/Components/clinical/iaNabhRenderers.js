// R7gx — Shared NABH Initial Assessment sub-bucket renderers.
// Used by both buildDoctorNoteCardHtml (panel + Complete File doctor
// card) and printNurseNote (panel + Complete File nurse card) so
// every populated NABH sub-block surfaces on the patient panel — not
// just the 6 that were hard-coded before. NABH AAC.1 / AAC.2 / IPSG.6.
//
// Renderers take the parent helper-set `H` (the existing _kv/_section/
// _grid functions from the caller) so each side keeps its own CSS
// class prefix (.dfx-* on doctor, .nfx-* on nurse). All renderers
// return "" when their bucket is empty — empty buckets stay hidden.

export const COMORBIDITY_LABELS = {
  diabetes:     "Diabetes mellitus",
  hypertension: "Hypertension",
  cad:          "Coronary artery disease",
  ckd:          "Chronic kidney disease",
  copd:         "COPD",
  asthma:       "Asthma",
  liverDx:      "Chronic liver disease",
  cancer:       "Active malignancy",
  stroke:       "Prior CVA / Stroke",
  mentalHealth: "Mental health disorder",
  hypothyroid:  "Hypothyroidism",
  hiv:          "HIV",
  hepB:         "Hepatitis B",
  hepC:         "Hepatitis C",
};

export const ROS_LABELS = {
  constitutional:   "Constitutional",
  cardiac:          "Cardiac",
  respiratory:      "Respiratory",
  gi:               "GI",
  gu:               "GU",
  musculoskeletal:  "Musculoskeletal",
  neuro:            "Neuro",
  skin:             "Skin",
  endocrine:        "Endocrine",
  psych:            "Psych",
};

export const HIGH_RISK_LABELS = {
  pediatric:          "Paediatric",
  geriatric:          "Geriatric",
  pregnant:           "Pregnant",
  immunocompromised:  "Immunocompromised",
  mentalHealth:       "Mental health",
  bariatric:          "Bariatric",
  polyTrauma:         "Poly-trauma",
  severeMalnutrition: "Severe malnutrition",
};

const _isFilled = (v) => {
  if (v === null || v === undefined || v === "" || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v).some(_isFilled);
  return true;
};

const _yes = (b) => b === true ? "Yes" : b === false ? "No" : "";

const _chips = (items, bg, fg) =>
  `<div style="display:flex;flex-wrap:wrap;gap:5px">${items.map(c =>
    `<span style="padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600">${esc(c)}</span>`
  ).join("")}</div>`;

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─────────────────────────────────────────────────────────────────
// DOCTOR-SIDE nabh.* renderers
// ─────────────────────────────────────────────────────────────────

export function renderComorbidities(nabh, H) {
  const cm = nabh?.comorbidities || {};
  const chips = Object.entries(COMORBIDITY_LABELS)
    .filter(([k]) => cm[k] === true).map(([, lbl]) => lbl);
  if (cm.other) chips.push(String(cm.other));
  if (!chips.length) return "";
  return H._section("Active Comorbidities (NABH AAC.1)", "#d97706",
    _chips(chips, "#fef3c7", "#92400e"));
}

export function renderReviewOfSystems(nabh, H) {
  const ros = nabh?.reviewOfSystems || {};
  const entries = Object.entries(ROS_LABELS)
    .map(([k, lbl]) => [lbl, ros[k]])
    .filter(([, val]) => val != null && val !== "");
  if (!entries.length) return "";
  const hasNonNad = entries.some(([, val]) => String(val).toUpperCase() !== "NAD");
  const body = hasNonNad
    ? H._grid(entries.map(([lbl, val]) => H._kv(lbl, val)))
    : `<div style="font-size:11.5px;color:#475569;font-style:italic;padding:4px 8px">Reviewed — no abnormality detected in ${entries.length}/10 systems.</div>`;
  return H._section("Review of Systems (NABH AAC.1)", "#475569", body);
}

export function renderFunctionalEcog(nabh, H) {
  const e = nabh?.functionalEcog || {};
  if (!_isFilled(e.score) && !_isFilled(e.disabilities) && !_isFilled(e.aidsRequired)) return "";
  return H._section("Functional Status — ECOG (NABH AAC.1)", "#0891b2", H._grid([
    H._kv("ECOG Score", e.score),
    H._kv("Disabilities", e.disabilities, true),
    H._kv("Aids Required", e.aidsRequired, true),
  ]));
}

export function renderImmunisation(nabh, H) {
  const im = nabh?.immunisationStatus || {};
  const rows = [
    ["Tetanus", im.tetanus],
    ["Hepatitis B", im.hepB],
    ["COVID-19", im.covid],
    ["Influenza", im.influenza],
    ["Pneumococcal", im.pneumococcal],
  ];
  const filledRows = rows.filter(([, v]) => v && (v.vaccinated || v.lastDate));
  const hasAny = filledRows.length || _isFilled(im.other) || im.upToDateForAge === false;
  if (!hasAny) return "";
  const tbl = `<table class="${H.cssPrefix}-tbl"><tr><th>Vaccine</th><th>Status</th><th>Last Date</th><th>Notes</th></tr>${
    rows.map(([lbl, v]) => {
      const vac = v?.vaccinated;
      const extra = v?.doses ? `${v.doses} doses` : "";
      return `<tr><td>${esc(lbl)}</td><td>${vac
        ? '<strong style="color:#16a34a">✓ Vaccinated</strong>'
        : '<span style="color:#94a3b8">Not vaccinated</span>'}</td><td>${esc(v?.lastDate || "—")}</td><td>${esc(extra)}</td></tr>`;
    }).join("")
  }${im.other ? `<tr><td colspan="4"><strong>Other:</strong> ${esc(im.other)}</td></tr>` : ""}</table>${
    im.upToDateForAge === false
      ? '<p style="margin:6px 0 0;font-size:11px;color:#dc2626;font-weight:600">⚠ Patient is NOT up-to-date for age.</p>'
      : ""
  }`;
  return H._section("Immunisation Status (NABH AAC.1)", "#0d9488", tbl);
}

export function renderSpiritualNeeds(nabh, H) {
  const sp = nabh?.spiritualNeeds || {};
  if (!sp.distressNoted && !_isFilled(sp.concerns) && !sp.chaplainReferralRequested) return "";
  return H._section("Spiritual / Existential Needs (NABH AAC.1)", "#7c3aed", H._grid([
    H._kv("Distress Noted",      sp.distressNoted ? "Yes" : ""),
    H._kv("Chaplain Referral",   sp.chaplainReferralRequested ? "✓ Requested" : ""),
    H._kv("Concerns",            sp.concerns, true),
  ]));
}

export function renderObstetricGynae(nabh, H) {
  const og = nabh?.obstetricGynae || {};
  const hasContent = og.isApplicable === true
    || _isFilled(og.lmp) || _isFilled(og.gravida) || _isFilled(og.para)
    || _isFilled(og.contraception) || _isFilled(og.lastPregnancyOutcome)
    || og.pregnancyTestDone === true || _isFilled(og.notes);
  if (!hasContent) return "";
  const gpa = [og.gravida, og.para, og.abortions]
    .filter(v => v !== "" && v != null && v !== 0).join(" / ");
  const cycle = og.cycleRegular === false
    ? `Irregular${og.cycleDays ? ` (${og.cycleDays} days)` : ""}`
    : (og.cycleRegular === true ? `Regular${og.cycleDays ? ` (${og.cycleDays} days)` : ""}` : "");
  return H._section("Obstetric & Gynaecological History (NABH AAC.1)", "#db2777", H._grid([
    H._kv("LMP", og.lmp),
    H._kv("Cycle", cycle),
    H._kv("G / P / A", gpa),
    H._kv("Living Children", og.livingChildren),
    H._kv("Contraception", og.contraception),
    H._kv("Last Pregnancy Outcome", og.lastPregnancyOutcome, true),
    H._kv("Pregnancy Test", og.pregnancyTestDone ? (og.pregnancyTestResult || "Done") : ""),
    H._kv("Notes", og.notes, true),
  ]));
}

// ─────────────────────────────────────────────────────────────────
// NURSING nursingNabh.* renderers
// ─────────────────────────────────────────────────────────────────

export function renderIdentification(nNabh, H) {
  const id = nNabh?.identification || {};
  if (!id.bandAttached && !id.nameVerified && !id.uhidVerified
      && !id.dobVerified && !_isFilled(id.verifiedBy)) return "";
  const checks = [
    ["Band Attached", id.bandAttached],
    ["Name Verified", id.nameVerified],
    ["UHID Verified", id.uhidVerified],
    ["DOB Verified",  id.dobVerified],
  ].filter(c => c[1]);
  const body = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${
    checks.map(c => `<span style="padding:3px 10px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:600">✓ ${esc(c[0])}</span>`).join("")
  }${id.verifiedBy ? `<span style="font-size:11px;color:#475569;margin-left:6px">Verified by: <strong>${esc(id.verifiedBy)}</strong></span>` : ""}</div>`;
  return H._section("Identification & 2-Identifier Verification (NABH IPSG.1)", "#16a34a", body);
}

export function renderPsychosocial(nNabh, H) {
  const ps = nNabh?.psychosocial || {};
  if (!_isFilled(ps.emotionalState) && !_isFilled(ps.moodAffect)
      && !_isFilled(ps.familySupport) && !_isFilled(ps.notes)
      && !_isFilled(ps.languagePreferred)) return "";
  return H._section("Psychosocial Assessment", "#7c3aed", H._grid([
    H._kv("Emotional State",    ps.emotionalState),
    H._kv("Mood / Affect",      ps.moodAffect),
    H._kv("Preferred Language", ps.languagePreferred),
    H._kv("Family Support",     ps.familySupport),
    H._kv("Notes",              ps.notes, true),
  ]));
}

export function renderAdlBarthel(nNabh, H) {
  const adl = nNabh?.adlBarthel || {};
  const keys = ["feeding","bathing","grooming","dressing","bowels",
                "bladder","toilet","transfer","mobility","stairs"];
  const rows = keys.map(k => [k[0].toUpperCase() + k.slice(1), adl[k]])
    .filter(r => r[1] != null && r[1] !== "");
  if (!rows.length && adl.total == null) return "";
  // Always compute total from per-item rows; the stored `adl.total`
  // field has been observed to drift (some forms double-summed by
  // including the prior `total` in the spread). Falling back to a
  // recomputed sum keeps the displayed band consistent with the
  // visible item scores. Caps at 100 (Barthel max) defensively.
  const computed = rows.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  const total = Math.min(computed, 100);
  const band = total >= 80 ? "Independent"
    : total >= 60 ? "Mild dependency"
    : total >= 40 ? "Moderate dependency"
    : total >= 20 ? "Severe dependency"
    : "Totally dependent";
  const tbl = `<table class="${H.cssPrefix}-tbl"><tr><th style="width:60%">Item</th><th>Score</th></tr>${
    rows.map(r => `<tr><td>${esc(r[0])}</td><td><strong>${esc(String(r[1]))}</strong></td></tr>`).join("")
  }<tr style="background:#f1f5f9"><td><strong>Total</strong></td><td><strong>${total} / 100 — ${esc(band)}</strong></td></tr></table>`;
  return H._section("Activities of Daily Living — Barthel Index (NABH AAC.1)", "#16a34a", tbl);
}

export function renderBodyChart(nNabh, H) {
  const bc = nNabh?.bodyChart || {};
  const cells = [
    ["Head / Neck",       bc.headNeck],
    ["Chest / Back",      bc.chestBack],
    ["Abdomen / Groin",   bc.abdomenGroin],
    ["Upper Limbs",       bc.upperLimbs],
    ["Lower Limbs",       bc.lowerLimbs],
    ["Existing Wounds",   bc.existingWounds],
    ["Existing Bruises",  bc.existingBruises],
  ].filter(c => _isFilled(c[1]));
  if (!cells.length) return "";
  return H._section("Body Chart / Skin Assessment", "#475569",
    H._grid(cells.map(([lbl, val]) => H._kv(lbl, val, true))));
}

export function renderBowelBladder(nNabh, H) {
  const bb = nNabh?.bowelBladder || {};
  if (!_isFilled(bb.bowelContinence) && !_isFilled(bb.bladderContinence)
      && !bb.bladderCatheterised && !_isFilled(bb.bladderOutput24h)
      && !_isFilled(bb.bowelLastBM) && !_isFilled(bb.bowelFrequency)
      && !_isFilled(bb.notes)) return "";
  return H._section("Bowel / Bladder Pattern", "#475569", H._grid([
    H._kv("Bowel Continence",   bb.bowelContinence),
    H._kv("Last Bowel Movement", bb.bowelLastBM),
    H._kv("Bowel Frequency",    bb.bowelFrequency),
    H._kv("Bladder Continence", bb.bladderContinence),
    H._kv("Catheterised",       bb.bladderCatheterised ? "Yes" : ""),
    H._kv("Output (24h)",       bb.bladderOutput24h ? `${bb.bladderOutput24h} mL` : ""),
    H._kv("Notes",              bb.notes, true),
  ]));
}

export function renderCulturalSpiritual(nNabh, H) {
  const cs = nNabh?.culturalSpiritual || {};
  if (!_isFilled(cs.religion) && !_isFilled(cs.dietaryRestrictions)
      && !_isFilled(cs.spiritualNeeds) && !_isFilled(cs.customs)) return "";
  return H._section("Cultural & Spiritual Preferences (NABH PRE.5)", "#7c3aed", H._grid([
    H._kv("Religion",        cs.religion),
    H._kv("Dietary",         cs.dietaryRestrictions),
    H._kv("Spiritual Needs", cs.spiritualNeeds, true),
    H._kv("Care Customs",    cs.customs, true),
  ]));
}

export function renderDischargePlanning(nNabh, H) {
  const dp = nNabh?.dischargePlanning || {};
  const equip = Array.isArray(dp.equipmentNeeded) ? dp.equipmentNeeded.join(", ") : dp.equipmentNeeded;
  if (!_isFilled(dp.homeSupport) && !_isFilled(dp.primaryCaregiver)
      && !_isFilled(equip) && !_isFilled(dp.transportNeed)
      && !_isFilled(dp.anticipatedBarriers)) return "";
  return H._section("Discharge Planning (Day-1 NABH AAC.4)", "#0891b2", H._grid([
    H._kv("Home Support",         dp.homeSupport),
    H._kv("Primary Caregiver",    dp.primaryCaregiver),
    H._kv("Equipment Needed",     equip),
    H._kv("Transport Need",       dp.transportNeed),
    H._kv("Anticipated Barriers", dp.anticipatedBarriers, true),
  ]));
}

export function renderEducationNeeds(nNabh, H) {
  const en = nNabh?.educationNeeds || {};
  if (!_isFilled(en.preferredLanguage) && !_isFilled(en.learningStyle)
      && !_isFilled(en.barriersToLearning) && !_isFilled(en.targetAudience)
      && en.canRead == null && en.canWrite == null) return "";
  return H._section("Education Needs (NABH AAC.6 / PRE.5)", "#1d4ed8", H._grid([
    H._kv("Preferred Language", en.preferredLanguage),
    H._kv("Learning Style",     en.learningStyle),
    H._kv("Target Audience",    en.targetAudience),
    H._kv("Can Read",           _yes(en.canRead)),
    H._kv("Can Write",          _yes(en.canWrite)),
    H._kv("Barriers",           en.barriersToLearning, true),
  ]));
}

export function renderSpecialPrecautions(nNabh, H) {
  const sp = nNabh?.specialPrecautions || {};
  const chips = [];
  if (sp.isolation?.required) chips.push(`Isolation${sp.isolation.type ? ` (${sp.isolation.type})` : ""}`);
  if (sp.restraints?.required) chips.push(`Restraints${sp.restraints.type ? ` (${sp.restraints.type})` : ""}`);
  if (sp.suicide)        chips.push("Suicide precaution");
  if (sp.fallPrecaution) chips.push("Fall precaution");
  if (sp.aspiration)     chips.push("Aspiration");
  if (sp.bleed)          chips.push("Bleed");
  if (sp.seizure)        chips.push("Seizure");
  if (sp.mri)            chips.push("MRI safety");
  if (sp.latex)          chips.push("Latex allergy");
  if (!chips.length) return "";
  const body = _chips(chips, "#fef2f2", "#991b1b") +
    (sp.restraints?.reason ? `<p style="margin:6px 0 0;font-size:11px"><strong>Restraint reason:</strong> ${esc(sp.restraints.reason)}</p>` : "");
  return H._section("Special Precautions", "#dc2626", body);
}

export function renderCognitiveCommunication(nNabh, H) {
  const cog = nNabh?.cognitiveCommunication || {};
  const hasContent = cog.visionDeficit || cog.hearingDeficit || cog.speechDeficit
    || _isFilled(cog.aidsUsed) || _isFilled(cog.gcs) || _isFilled(cog.notes)
    || cog.orientationPerson === false || cog.orientationPlace === false || cog.orientationTime === false;
  if (!hasContent) return "";
  const orient = [
    ["Person", cog.orientationPerson],
    ["Place",  cog.orientationPlace],
    ["Time",   cog.orientationTime],
  ].map(([lbl, v]) => v === false ? `${lbl}: ✗` : v === true ? `${lbl}: ✓` : "")
   .filter(Boolean).join(" · ");
  return H._section("Cognitive / Communication", "#475569", H._grid([
    H._kv("Orientation", orient, true),
    H._kv("Vision Deficit",  cog.visionDeficit ? "Yes" : ""),
    H._kv("Hearing Deficit", cog.hearingDeficit ? "Yes" : ""),
    H._kv("Speech Deficit",  cog.speechDeficit ? "Yes" : ""),
    H._kv("Aids Used",       cog.aidsUsed),
    H._kv("GCS",             cog.gcs),
    H._kv("Notes",           cog.notes, true),
  ]));
}

export function renderSleepPattern(nNabh, H) {
  const slp = nNabh?.sleepPattern || {};
  if (!_isFilled(slp.hoursPerNight) && !_isFilled(slp.quality)
      && !_isFilled(slp.sleepAids) && !slp.snoring && !slp.apneaDx) return "";
  return H._section("Sleep Pattern", "#475569", H._grid([
    H._kv("Hours / Night",     slp.hoursPerNight),
    H._kv("Quality",           slp.quality),
    H._kv("Sleep Aids",        slp.sleepAids),
    H._kv("Snoring",           slp.snoring ? "Yes" : ""),
    H._kv("Sleep Apnoea Dx",   slp.apneaDx ? "Yes" : ""),
  ]));
}

export function renderValuablesBelongings(nNabh, H) {
  const vb = nNabh?.valuablesBelongings || {};
  if (!_isFilled(vb.status) && !_isFilled(vb.items)
      && !_isFilled(vb.handedTo) && !vb.receiptIssued) return "";
  return H._section("Valuables / Belongings", "#475569", H._grid([
    H._kv("Status",          vb.status),
    H._kv("Items",           vb.items, true),
    H._kv("Handed To",       vb.handedTo),
    H._kv("Receipt Issued",  vb.receiptIssued ? "✓ Yes" : ""),
  ]));
}

export function renderFamilyCaregiver(nNabh, H) {
  const fc = nNabh?.familyCaregiver || {};
  if (!_isFilled(fc.primaryName) && !_isFilled(fc.escalationName)
      && !_isFilled(fc.primaryContact) && !_isFilled(fc.escalationContact)) return "";
  return H._section("Family / Primary Caregiver", "#16a34a", H._grid([
    H._kv("Primary Name",      fc.primaryName),
    H._kv("Relation",          fc.primaryRelation),
    H._kv("Contact",           fc.primaryContact),
    H._kv("Lives w/ Patient",  _yes(fc.lives_with_patient)),
    H._kv("Escalation Name",   fc.escalationName),
    H._kv("Esc. Relation",     fc.escalationRelation),
    H._kv("Esc. Contact",      fc.escalationContact),
  ]));
}

export function renderHighRiskFlags(nNabh, H) {
  const hr = nNabh?.highRiskFlags || {};
  const chips = Object.entries(HIGH_RISK_LABELS)
    .filter(([k]) => hr[k] === true).map(([, lbl]) => lbl);
  if (!chips.length && !_isFilled(hr.notes)) return "";
  const body = _chips(chips, "#fef2f2", "#991b1b") +
    (hr.notes ? `<p style="margin:6px 0 0;font-size:11px"><strong>Notes:</strong> ${esc(hr.notes)}</p>` : "");
  return H._section("High-Risk Patient Flags", "#dc2626", body);
}

export function renderMobilityGait(nNabh, H) {
  const mg = nNabh?.mobilityGait || {};
  if (!_isFilled(mg.usesAid) && !_isFilled(mg.notes)
      && mg.independent !== false && mg.gaitNormal !== false && !mg.fallRisk) return "";
  return H._section("Mobility / Gait", "#0891b2", H._grid([
    H._kv("Independent",  _yes(mg.independent)),
    H._kv("Aid Used",     mg.usesAid),
    H._kv("Gait",         mg.gaitNormal === false ? "Abnormal" : mg.gaitNormal === true ? "Normal" : ""),
    H._kv("Fall Risk",    mg.fallRisk ? "⚠ Yes" : ""),
    H._kv("Notes",        mg.notes, true),
  ]));
}

export function renderPreAnaesthesia(nNabh, H) {
  const pa = nNabh?.preAnaesthesia || {};
  const hasContent = pa.plannedSurgery || _isFilled(pa.npoSince)
    || pa.looseTooth || pa.crowns || pa.dentures
    || pa.difficulIntubationHistory || _isFilled(pa.anaesthesiaHistory)
    || pa.pacScheduled;
  if (!hasContent) return "";
  return H._section("Pre-anaesthesia Screen (NABH COP.13)", "#0891b2", H._grid([
    H._kv("Planned Surgery",       pa.plannedSurgery ? "Yes" : ""),
    H._kv("NPO Since",             pa.npoSince),
    H._kv("Loose Tooth",           pa.looseTooth ? "Yes" : ""),
    H._kv("Crowns",                pa.crowns ? "Yes" : ""),
    H._kv("Dentures",              pa.dentures ? "Yes" : ""),
    H._kv("Difficult Intubation Hx", pa.difficulIntubationHistory ? "Yes" : ""),
    H._kv("Anaesthesia Hx",        pa.anaesthesiaHistory),
    H._kv("PAC Scheduled",         pa.pacScheduled ? (pa.pacDate ? `Yes — ${pa.pacDate}` : "Yes") : ""),
  ]));
}

export function renderNrsQuick(nNabh, H) {
  const nrs = nNabh?.nutritionalScreeningQuick || {};
  const triggers = [];
  if (nrs.bmiUnder20)              triggers.push("BMI < 20");
  if (nrs.weightLossLast3Months)   triggers.push("Weight loss (3 mo)");
  if (nrs.reducedIntakeLastWeek)   triggers.push("Reduced intake (1 wk)");
  if (nrs.severelyIll)             triggers.push("Severely ill");
  if (!triggers.length && !nrs.dietitianReferralTriggered) return "";
  const body = _chips(triggers, "#fef3c7", "#92400e") +
    (nrs.dietitianReferralTriggered ? `<p style="margin:6px 0 0;font-size:11px;color:#0d9488;font-weight:600">✓ Dietitian referral triggered</p>` : "");
  return H._section("NRS-2002 Nutritional Quick Screen", "#d97706", body);
}

export function renderPromPremTriggers(nNabh, H) {
  const pp = nNabh?.promPremTriggers || {};
  if (!pp.promPlanned && !pp.premPlanned
      && !_isFilled(pp.promSurvey) && !_isFilled(pp.premSurvey)
      && !_isFilled(pp.notes)) return "";
  return H._section("PROM / PREM Surveys (NABH PSQ)", "#7c3aed", H._grid([
    H._kv("PROM Planned", pp.promPlanned ? (pp.promSurvey || "Yes") : ""),
    H._kv("PREM Planned", pp.premPlanned ? (pp.premSurvey || "Yes") : ""),
    H._kv("Notes",        pp.notes, true),
  ]));
}

// ─────────────────────────────────────────────────────────────────
// Composite renderers — emit the full ordered set for one side.
// Empty buckets stay hidden; populated ones surface in form-order.
// ─────────────────────────────────────────────────────────────────

/**
 * Renders the doctor-side NABH P1+P2 sub-buckets that the existing
 * `initial:` builder didn't cover (Comorbidities, ROS, ECOG,
 * Immunisation, Spiritual, Obs/Gynae). Returns concatenated HTML.
 */
export function renderDoctorNabhExtras(nabh, H) {
  return [
    renderComorbidities(nabh, H),
    renderReviewOfSystems(nabh, H),
    renderFunctionalEcog(nabh, H),
    renderImmunisation(nabh, H),
    renderSpiritualNeeds(nabh, H),
    renderObstetricGynae(nabh, H),
  ].join("");
}

/**
 * Renders the full nursing NABH sub-bucket set. Used by both the
 * nurse Initial Assessment card and (optionally) embedded in the
 * doctor card when the doctor side wants a quick reference.
 */
export function renderNursingNabhExtras(nNabh, H) {
  return [
    renderIdentification(nNabh, H),
    renderPsychosocial(nNabh, H),
    renderAdlBarthel(nNabh, H),
    renderBodyChart(nNabh, H),
    renderSpecialPrecautions(nNabh, H),
    renderCognitiveCommunication(nNabh, H),
    renderCulturalSpiritual(nNabh, H),
    renderBowelBladder(nNabh, H),
    renderSleepPattern(nNabh, H),
    renderValuablesBelongings(nNabh, H),
    renderFamilyCaregiver(nNabh, H),
    renderHighRiskFlags(nNabh, H),
    renderMobilityGait(nNabh, H),
    renderPreAnaesthesia(nNabh, H),
    renderNrsQuick(nNabh, H),
    renderDischargePlanning(nNabh, H),
    renderEducationNeeds(nNabh, H),
    renderPromPremTriggers(nNabh, H),
  ].join("");
}
