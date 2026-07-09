// services/Billing/insurerFormService.js
// R7hr(CLAIM-P4.2) — the PDF-fill engine behind "print the insurer's claim form".
//
// Two paths:
//   1. OVERLAY (CLAIM-P4.3) — if the hospital has uploaded the insurer's own
//      official blank PDF + a field-map, we load THAT pdf and stamp the claim
//      data onto it (AcroForm field names when the pdf is fillable, else x/y
//      text overlay). That is the "fills the company's own form" path.
//   2. GENERATED FALLBACK (this file) — when no official template is on file we
//      generate a clean, standard-format health-claim form from scratch with
//      pdf-lib (our own layout — NOT a copy of any insurer's copyrighted form),
//      branded with the selected insurer's name and auto-filled from the same
//      claim data. Because IRDAI standardised the claim form, this standard
//      layout is accepted by every insurer, so the feature works day one.
//
// Both paths share ONE data source: claimFormService.buildClaimData(billId).

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { buildClaimData } = require("./claimFormService");
const { getInsurer } = require("../../config/insurers");

// ── format helpers ─────────────────────────────────────────────────────
function inr(n) {
  const v = Number(n || 0);
  // Indian digit grouping (##,##,###) without relying on ICU locale data.
  const neg = v < 0;
  let [int, dec] = Math.abs(v).toFixed(2).split(".");
  let last3 = int.length > 3 ? int.slice(-3) : int;
  const rest = int.length > 3 ? int.slice(0, -3) : "";
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3;
  return `${neg ? "-" : ""}Rs. ${grouped}.${dec}`;
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── layout primitives ──────────────────────────────────────────────────
// A small cursor-based builder over pdf-lib so the form reads top-to-bottom.
function makeBuilder(pdf, fonts) {
  const A4 = { w: 595.28, h: 841.89 };
  const M = 40;                       // page margin
  const contentW = A4.w - M * 2;
  const state = { page: null, y: 0 };
  const ink = rgb(0.06, 0.09, 0.16);
  const grey = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.8, 0.83, 0.88);
  const band = rgb(0.93, 0.95, 0.98);

  function addPage() {
    state.page = pdf.addPage([A4.w, A4.h]);
    state.y = A4.h - M;
  }
  function ensure(space) { if (state.y - space < M) addPage(); }
  function text(s, x, y, { size = 9, font = fonts.reg, color = ink } = {}) {
    state.page.drawText(String(s == null ? "" : s), { x, y, size, font, color });
  }
  // wrap a string to a width, return the array of lines
  function wrap(s, width, size, font) {
    const words = String(s || "").split(/\s+/);
    const lines = []; let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) > width && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  const api = {
    A4, M, contentW,
    get y() { return state.y; },
    get page() { return state.page; },
    newPage: addPage,

    gap(h) { state.y -= h; },

    sectionTitle(t) {
      ensure(26);
      state.y -= 18;
      state.page.drawRectangle({ x: M, y: state.y - 4, width: contentW, height: 18, color: band });
      text(t, M + 6, state.y, { size: 10, font: fonts.bold });
      state.y -= 10;
    },

    // label : value row. `blank` draws a fill-in underline (hand-write).
    field(label, value, { blank = false, w = contentW, x = M, labelW = 130 } = {}) {
      ensure(16);
      state.y -= 14;
      text(label, x, state.y, { size: 8.5, font: fonts.bold, color: grey });
      const vx = x + labelW;
      const vw = w - labelW;
      if (blank) {
        state.page.drawLine({ start: { x: vx, y: state.y - 2 }, end: { x: x + w, y: state.y - 2 }, thickness: 0.6, color: line });
      } else {
        const lines = wrap(value, vw, 9, fonts.reg);
        text(lines[0], vx, state.y, { size: 9 });
        for (let i = 1; i < lines.length; i++) { state.y -= 11; ensure(4); text(lines[i], vx, state.y, { size: 9 }); }
      }
    },

    // two fields side by side
    field2(l1, v1, l2, v2, opts = {}) {
      const halfW = contentW / 2 - 6;
      const startY = state.y;
      this.field(l1, v1, { ...opts, w: halfW, x: M, labelW: opts.labelW || 95 });
      const afterFirst = state.y;
      state.y = startY;   // reset to draw the second on the same row
      this.field(l2, v2, { ...opts, w: halfW, x: M + contentW / 2 + 6, labelW: opts.labelW || 95 });
      state.y = Math.min(afterFirst, state.y);
    },

    paragraph(s, { size = 8, color = grey } = {}) {
      const lines = wrap(s, contentW, size, fonts.reg);
      for (const ln of lines) { ensure(12); state.y -= 11; text(ln, M, state.y, { size, color }); }
    },

    // a simple table: cols = [{header, width, align}], rows = [[..],..]
    table(cols, rows, { footer } = {}) {
      const rowH = 15;
      ensure(rowH * 2);
      state.y -= rowH;
      // header band
      state.page.drawRectangle({ x: M, y: state.y - 3, width: contentW, height: rowH, color: band });
      let cx = M + 4;
      for (const c of cols) { text(c.header, cx, state.y, { size: 8, font: fonts.bold, color: ink }); cx += c.width; }
      const drawRow = (cells, bold = false) => {
        ensure(rowH);
        state.y -= rowH;
        let x = M + 4;
        cells.forEach((cell, i) => {
          const c = cols[i];
          const s = String(cell == null ? "" : cell);
          const font = bold ? fonts.bold : fonts.reg;
          let tx = x;
          if (c.align === "right") tx = x + c.width - 8 - font.widthOfTextAtSize(s, 8);
          text(s, tx, state.y, { size: 8, font });
          x += c.width;
        });
        state.page.drawLine({ start: { x: M, y: state.y - 4 }, end: { x: M + contentW, y: state.y - 4 }, thickness: 0.4, color: line });
      };
      rows.forEach((r) => drawRow(r));
      if (footer) drawRow(footer, true);
    },

    // signature blocks at the bottom of the current flow
    signatures(labels) {
      ensure(46);
      state.y -= 40;
      const each = contentW / labels.length;
      labels.forEach((lb, i) => {
        const x = M + i * each;
        state.page.drawLine({ start: { x: x + 6, y: state.y + 12 }, end: { x: x + each - 12, y: state.y + 12 }, thickness: 0.6, color: line });
        text(lb, x + 6, state.y, { size: 8, color: grey });
      });
    },
  };
  return api;
}

// ── the generated standard form ────────────────────────────────────────
async function generateStandardClaimPdf(claim) {
  const pdf = await PDFDocument.create();
  const fonts = {
    reg:  await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const b = makeBuilder(pdf, fonts);
  b.newPage();

  const p = claim.patient || {};
  const a = claim.admission || {};
  const h = claim.hospital || {};
  const t = claim.totals || {};
  const ins = claim.insurer || {};
  const pa = claim.preAuth || {};

  // ── letterhead ──
  b.gap(2);
  b.page.drawText(h.name || "Hospital", { x: b.M, y: b.y, size: 15, font: fonts.bold, color: rgb(0.06, 0.09, 0.16) });
  b.gap(16);
  const sub = [h.address, h.phone && `Ph: ${h.phone}`, h.gstin && `GSTIN: ${h.gstin}`, h.rohiniId && `ROHINI: ${h.rohiniId}`].filter(Boolean).join("  •  ");
  b.page.drawText(sub, { x: b.M, y: b.y, size: 7.5, font: fonts.reg, color: rgb(0.42, 0.45, 0.5) });
  b.gap(14);
  const title = `HEALTH INSURANCE CLAIM FORM — ${ins.name || "Insurer"}`;
  b.page.drawRectangle({ x: b.M, y: b.y - 4, width: b.contentW, height: 20, color: rgb(0.10, 0.34, 0.65) });
  b.page.drawText(title, { x: b.M + 8, y: b.y + 1, size: 10.5, font: fonts.bold, color: rgb(1, 1, 1) });
  b.gap(6);
  if (ins.legalName) { b.page.drawText(`Insurer: ${ins.legalName}`, { x: b.M, y: b.y, size: 7.5, font: fonts.reg, color: rgb(0.42, 0.45, 0.5) }); b.gap(4); }

  // ── PART A — insured ──
  b.sectionTitle("PART A  —  To be filled by the Insured / Claimant");
  b.field2("Insurer", ins.name, "Policy No.", p.policyNumber);
  b.field2("TPA (if any)", p.tpaName, "Sum Insured", p.sumInsured ? inr(p.sumInsured) : "");
  b.field2("Policy Holder", p.policyHolderName || p.name, "Member / Card ID", "", { labelW: 95, blank: false });
  b.field("Card / Member ID", "", { blank: true, labelW: 130 });
  b.field2("Patient Name", p.name, "Age / Gender", [p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / "));
  b.field("Relationship to Policy Holder", "", { blank: true });
  b.field("Address", p.address);
  b.field2("Contact No.", p.phone, "Occupation", "", { labelW: 95 });
  b.field("Occupation", "", { blank: true });
  b.field("Nature of Illness / Injury", a.finalDiagnosis || a.provisionalDiagnosis);
  b.field2("Date of Injury / Onset", "", "Hospitalisation due to", a.isMLC ? "Accident / MLC" : "Illness", { labelW: 105, blank: false });
  b.field("Date of Injury / Onset", "", { blank: true });
  // reimbursement bank block
  b.gap(2);
  b.field("Bank A/c Holder (for NEFT)", "", { blank: true });
  b.field2("Bank & Branch", "", "Account No.", "", { blank: true, labelW: 95 });
  b.field("IFSC Code", "", { blank: true });

  // ── PART B — hospital ──
  b.sectionTitle("PART B  —  To be filled by the Hospital");
  b.field2("Hospital", h.name, "ROHINI ID", h.rohiniId);
  b.field2("GSTIN", h.gstin, "PAN", h.pan);
  b.field2("Patient / UHID", `${p.name || ""}  (${p.uhid || ""})`, "IPD No.", a.ipNo || a.admissionNumber, { labelW: 95 });
  b.field2("Admission Date", fmtDate(a.admissionDate), "Discharge Date", fmtDate(a.dischargeDate));
  b.field2("Room Category", a.roomCategory, "Treating Consultant", a.consultant);
  b.field("Final Diagnosis", a.finalDiagnosis || a.provisionalDiagnosis);
  if (a.icdCode) b.field("ICD-10 Code", a.icdCode);
  if (Array.isArray(a.diagnoses) && a.diagnoses.length) {
    const dx = a.diagnoses.map((d) => [d.code || "—", d.description || "", d.type || ""]);
    b.gap(2);
    b.table(
      [{ header: "ICD Code", width: 90 }, { header: "Diagnosis", width: 320 }, { header: "Type", width: 90 }],
      dx
    );
  }

  // ── bill breakup ──
  b.sectionTitle("Bill Break-up (as per final hospital bill)");
  const rows = (claim.billBreakup || []).map((x) => [x.name, String(x.items || ""), inr(x.amount)]);
  b.table(
    [{ header: "Head", width: 300 }, { header: "Items", width: 80, align: "right" }, { header: "Amount", width: 135, align: "right" }],
    rows.length ? rows : [["No billable items", "", inr(0)]],
    { footer: ["TOTAL (Gross)", "", inr(t.gross || t.net)] }
  );
  b.gap(2);
  b.field2("Discount", inr(t.discount), "Tax (GST)", inr(t.tax), { labelW: 95 });
  b.field2("Net Payable", inr(t.net), "Amount Collected", inr(t.collected), { labelW: 95 });
  b.field2("Insurer / TPA Payable", inr(t.tpaPayable), "Patient Share / Co-pay", inr(t.patientPayable), { labelW: 125 });
  if (pa.number || pa.approvedAmount) {
    b.field2("Pre-Auth / Approval No.", pa.number, "Approved Amount", pa.approvedAmount ? inr(pa.approvedAmount) : "", { labelW: 125 });
  }

  // ── documents enclosed ──
  b.sectionTitle("Documents Enclosed");
  const docs = claim.docsChecklist || [];
  for (let i = 0; i < docs.length; i += 2) {
    b.gap(12);
    b.page.drawText(`[ ]  ${docs[i]}`, { x: b.M, y: b.y, size: 8, font: fonts.reg, color: rgb(0.06, 0.09, 0.16) });
    if (docs[i + 1]) b.page.drawText(`[ ]  ${docs[i + 1]}`, { x: b.M + b.contentW / 2, y: b.y, size: 8, font: fonts.reg, color: rgb(0.06, 0.09, 0.16) });
  }

  // ── declaration + signatures ──
  b.sectionTitle("Declaration");
  b.paragraph("I hereby declare that the information furnished in this form is true and correct to the best of my knowledge. I authorise the hospital / TPA / insurer to obtain any medical information and to release the same for the purpose of processing this claim. I understand that any false statement may result in denial of the claim.");
  b.signatures(["Signature of Insured / Claimant", "Hospital Authorised Signatory & Seal"]);

  // submission footer
  if (ins.claimEmail || ins.claimAddress || ins.portal) {
    b.gap(20);
    const where = [ins.claimAddress, ins.claimEmail && `Email: ${ins.claimEmail}`, ins.portal && `Portal: ${ins.portal}`].filter(Boolean).join("   |   ");
    b.page.drawText(`Submit to: ${where}`, { x: b.M, y: b.y, size: 7, font: fonts.reg, color: rgb(0.42, 0.45, 0.5) });
  }

  return await pdf.save();
}

// ── overlay path (CLAIM-P4.3 wires the template lookup) ─────────────────
// Given an uploaded blank PDF (bytes) + fieldMap, stamp the claim values on.
// fieldMap entries: { field, acroName?, page?, x?, y?, size? }. When acroName
// is present and the pdf has that AcroForm field, we set it; otherwise we draw
// text at (page,x,y). `resolve(field)` maps a field key → a string value.
async function overlayOntoTemplate(templateBytes, fieldMap, resolve) {
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let form = null;
  try { form = pdf.getForm(); } catch { form = null; }
  const pages = pdf.getPages();
  for (const m of fieldMap || []) {
    const value = resolve(m.field);
    if (value == null || value === "") continue;
    if (m.acroName && form) {
      try { form.getTextField(m.acroName).setText(String(value)); continue; } catch { /* fall through to xy */ }
    }
    const pg = pages[m.page || 0];
    if (pg && typeof m.x === "number" && typeof m.y === "number") {
      pg.drawText(String(value), { x: m.x, y: m.y, size: m.size || 9, font, color: rgb(0.06, 0.09, 0.16) });
    }
  }
  if (form) { try { form.flatten(); } catch { /* leave interactive if flatten unsupported */ } }
  return await pdf.save();
}

// Flatten claim data into the string values an insurer field-map can resolve.
function claimFieldValues(claim) {
  const p = claim.patient || {}, a = claim.admission || {}, h = claim.hospital || {}, t = claim.totals || {}, pa = claim.preAuth || {};
  return {
    insurerName: claim.insurer?.name, policyNumber: p.policyNumber, tpaName: p.tpaName,
    sumInsured: p.sumInsured ? inr(p.sumInsured) : "", policyHolderName: p.policyHolderName || p.name,
    patientName: p.name, uhid: p.uhid, age: p.age ? `${p.age}` : "", gender: p.gender, address: p.address, phone: p.phone,
    hospitalName: h.name, rohiniId: h.rohiniId, gstin: h.gstin, pan: h.pan,
    ipNo: a.ipNo || a.admissionNumber, admissionDate: fmtDate(a.admissionDate), dischargeDate: fmtDate(a.dischargeDate),
    roomCategory: a.roomCategory, consultant: a.consultant, diagnosis: a.finalDiagnosis || a.provisionalDiagnosis, icdCode: a.icdCode,
    grossAmount: inr(t.gross || t.net), discount: inr(t.discount), tax: inr(t.tax), netAmount: inr(t.net),
    tpaPayable: inr(t.tpaPayable), patientPayable: inr(t.patientPayable),
    preAuthNumber: pa.number, approvedAmount: pa.approvedAmount ? inr(pa.approvedAmount) : "",
  };
}

// ── public entry ────────────────────────────────────────────────────────
// Returns { bytes, filename, insurer, usedTemplate }.
async function fillInsurerForm(billId, insurerCode, opts = {}) {
  const claim = await buildClaimData(billId);

  // Explicit insurerCode (from the UI selector) overrides the patient's stored
  // insurer — lets the desk print any company's form on demand.
  if (insurerCode) {
    const ins = getInsurer(insurerCode);
    claim.insurer = {
      code: ins.code, name: ins.name, legalName: ins.legalName, type: ins.type,
      formTitle: ins.formTitle, claimEmail: ins.claimEmail, claimAddress: ins.claimAddress,
      portal: ins.portal, mandatesOwnForm: ins.mandatesOwnForm,
    };
    claim.patient.insurerCode = ins.code;
    claim.patient.insurerName = ins.name;
  }

  // CLAIM-P4.3: prefer an uploaded official template when the caller provides
  // one (controller looks it up). `opts.template = { bytes, fieldMap }`.
  if (opts.template && opts.template.bytes) {
    const bytes = await overlayOntoTemplate(opts.template.bytes, opts.template.fieldMap, (k) => claimFieldValues(claim)[k]);
    return { bytes, filename: fileName(claim), insurer: claim.insurer, usedTemplate: true };
  }

  const bytes = await generateStandardClaimPdf(claim);
  return { bytes, filename: fileName(claim), insurer: claim.insurer, usedTemplate: false };
}

function fileName(claim) {
  const safe = (s) => String(s || "").replace(/[^\w-]+/g, "_").slice(0, 40);
  return `Claim_${safe(claim.insurer?.code || "FORM")}_${safe(claim.patient?.uhid || "patient")}.pdf`;
}

module.exports = { fillInsurerForm, generateStandardClaimPdf, overlayOntoTemplate, claimFieldValues };
