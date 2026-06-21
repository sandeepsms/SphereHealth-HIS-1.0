// services/Investigation/admissionInvestigationsService.js
// ════════════════════════════════════════════════════════════════════
// R7hr-229 — Aggregate ALL of a patient's investigations across an IPD
// admission into a DAY-WISE + TREND paragraph and a structured view.
//
// Sources (all keyed by UHID):
//   • InvestigationOrder.items[]   — lab test orders with entered/verified results
//   • LabTrend.tests[].readings[]  — multi-day grids (CBC/LFT/KFT/…) per-day readings
//   • LabReport                    — narrative imaging / micro / histopath reports
//
// Scoping: investigations are scoped to THIS admission by their ACTUAL DATE
// against the admission's date window (admissionDate → discharge|now), padded
// ±1 day. This is robust even when a lab record was saved WITHOUT an
// admissionId stamp (common). When no admissionId is supplied it returns the
// patient's full UHID history (ad-hoc view).
//
// Single source of truth for BOTH the discharge-summary investigations
// paragraph (keyInvestigationsText, R7hr-200) AND the new Doctor/Nurse
// "Investigations" panel tab. READ-ONLY + ADDITIVE — touches no frozen model.
// ════════════════════════════════════════════════════════════════════
"use strict";

const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const { LabTrend, LabReport } = require("../../models/Clinical/labRecordsModels");
const Admission = require("../../models/Patient/admissionModel");

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
};
const dayKey = (d) => {
  const x = new Date(d);
  return isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};

const REPORT_TYPE_LABEL = {
  "imaging-xray": "X-ray", "imaging-usg": "USG", "imaging-ct": "CT scan",
  "imaging-mri": "MRI", "imaging-other": "Imaging", microbiology: "Microbiology",
  histopath: "Histopathology", cytology: "Cytology", ecg: "ECG", echo: "Echo",
};

/**
 * @param {{ uhid?:string, admissionId?:string }} q
 * @returns {{ paragraph:string, days:Array, trends:Array, counts:object, window:object }}
 */
async function getAdmissionInvestigations({ uhid, admissionId } = {}) {
  const empty = { paragraph: "", days: [], trends: [], counts: { orders: 0, panels: 0, reports: 0, days: 0 }, window: null };
  let UHID = String(uhid || "").toUpperCase();
  if (!UHID && !admissionId) return empty;

  // Resolve the admission date window (scope by the investigation's own date).
  let admission = null;
  if (admissionId) {
    admission = await Admission.findById(admissionId)
      .select("admissionDate actualDischargeDate dischargeDate UHID")
      .lean()
      .catch(() => null);
  }
  if (!UHID && admission?.UHID) UHID = String(admission.UHID).toUpperCase();
  if (!UHID) return empty;

  const admitDate = admission?.admissionDate ? new Date(admission.admissionDate) : null;
  const admitEnd = admission
    ? new Date(admission.actualDischargeDate || admission.dischargeDate || Date.now())
    : null;
  const winStart = admitDate && !isNaN(admitDate.getTime()) ? admitDate.getTime() - 86400000 : null; // pad 1 day before
  const winEnd = admitEnd && !isNaN(admitEnd.getTime()) ? admitEnd.getTime() + 86400000 : null;       // pad 1 day after
  const inWindow = (date) => {
    if (winStart == null) return true; // no admission window → include all (UHID-wide)
    const t = new Date(date).getTime();
    return !isNaN(t) && t >= winStart && (winEnd == null || t <= winEnd);
  };

  const [orders, labTrends, labReports] = await Promise.all([
    InvestigationOrder.find({ UHID }).lean().catch(() => []),
    LabTrend.find({ UHID }).lean().catch(() => []),
    LabReport.find({ UHID }).lean().catch(() => []),
  ]);

  // ── collect day-indexed events: dayKey -> { date, items:[{name,value,type}] } ──
  const dayMap = new Map();
  const pushEvent = (date, name, value, type) => {
    if (!inWindow(date)) return;
    const k = dayKey(date);
    if (!k || !name) return;
    if (!dayMap.has(k)) dayMap.set(k, { date: new Date(date), items: [] });
    dayMap.get(k).items.push({ name: String(name).trim(), value: String(value || "").trim(), type });
  };

  // InvestigationOrder — only completed / verified items
  for (const o of orders) {
    for (const it of (o.items || [])) {
      if (!["COMPLETED", "VERIFIED"].includes(it.resultStatus)) continue;
      const date = it.resultEnteredAt || it.verifiedAt || o.createdAt;
      const vals = (it.results || [])
        .map((r) => `${r.parameterName} ${r.value}${r.unit ? " " + r.unit : ""}${r.isAbnormal ? " (abn)" : ""}`)
        .join(", ") || (it.interpretation || "").trim() || "result entered";
      pushEvent(date, it.investigationName, vals, "lab");
    }
  }

  // LabReport — narrative imaging / micro / histopath
  for (const r of labReports) {
    const label = REPORT_TYPE_LABEL[r.reportType] || (r.reportType || "Report");
    const finding = (r.impression || r.findings || r.organism || "reported").toString().replace(/\s+/g, " ").trim();
    pushEvent(r.reportDate, `${r.testName} (${label})`, finding.slice(0, 200), "report");
  }

  // LabTrend — per-reading data points (the multi-day source) + trend feed
  const trendMap = new Map(); // "Hb (g/dL)" -> [{date,value}]
  for (const t of labTrends) {
    const panel = (t.panelName || t.panelType || "Lab panel").toString();
    const byDay = new Map(); // dayKey -> { date, parts:[] }
    for (const test of (t.tests || [])) {
      for (const rd of (test.readings || [])) {
        if (rd.value === "" || rd.value == null) continue;
        if (!inWindow(rd.date)) continue;
        const k = dayKey(rd.date);
        if (!k) continue;
        if (!byDay.has(k)) byDay.set(k, { date: rd.date, parts: [] });
        byDay.get(k).parts.push(`${test.name} ${rd.value}${test.unit ? " " + test.unit : ""}`);
        const key = `${test.name}${test.unit ? " (" + test.unit + ")" : ""}`;
        if (!trendMap.has(key)) trendMap.set(key, []);
        trendMap.get(key).push({ date: rd.date, value: rd.value });
      }
    }
    for (const [, v] of byDay) pushEvent(v.date, panel, v.parts.join(", "), "lab");
  }

  // ── sort days ASC, number relative to admission date ──
  const sortedDays = [...dayMap.entries()].sort((a, b) => a[1].date - b[1].date);
  const baseline = (admitDate && !isNaN(admitDate.getTime())) ? admitDate : (sortedDays[0]?.[1]?.date || null);
  const dayBlocks = sortedDays.map(([k, v], i) => {
    let dayNo = i + 1;
    if (baseline) dayNo = Math.max(1, Math.floor((v.date - baseline) / 86400000) + 1);
    const seen = new Set();
    const items = [];
    for (const it of v.items) {
      const sig = it.name + "::" + it.value;
      if (seen.has(sig)) continue;
      seen.add(sig);
      items.push(it);
    }
    return { dayNo, dateKey: k, dateLabel: fmtDate(v.date), items };
  });

  // ── trends: tests with >= 2 readings whose value actually changed ──
  const trends = [];
  for (const [test, pts] of trendMap) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => new Date(a.date) - new Date(b.date));
    const first = pts[0], last = pts[pts.length - 1];
    if (String(first.value) === String(last.value)) continue;
    trends.push({
      test,
      first: `${first.value} (${fmtDate(first.date)})`,
      last: `${last.value} (${fmtDate(last.date)})`,
    });
  }

  // ── compose the day-wise + trend paragraph ──
  const lines = dayBlocks.map((b) => {
    const parts = b.items.map((it) => (it.value ? `${it.name} — ${it.value}` : it.name));
    return `Day ${b.dayNo} (${b.dateLabel}): ${parts.join("; ")}.`;
  });
  let paragraph = lines.join(" ");
  if (trends.length) {
    paragraph += `\n\nTrends: ${trends.map((t) => `${t.test} ${t.first} → ${t.last}`).join("; ")}.`;
  }

  return {
    paragraph: paragraph.trim(),
    days: dayBlocks,
    trends,
    counts: { orders: orders.length, panels: labTrends.length, reports: labReports.length, days: dayBlocks.length },
    window: winStart ? { from: new Date(winStart).toISOString(), to: winEnd ? new Date(winEnd).toISOString() : null } : null,
  };
}

module.exports = { getAdmissionInvestigations };
