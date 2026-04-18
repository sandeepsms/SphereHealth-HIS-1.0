/**
 * NursePatientPanel.jsx
 * Comprehensive nursing patient panel — full patient file for nursing staff.
 * Pink/rose theme. 7 tabs: Overview, Vitals, Nursing Notes, Doctor Orders,
 * Nursing Charges, Patient Billing, Audit Trail.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const C = {
  primary:   "#db2777",
  primaryD:  "#9d174d",
  primaryL:  "#fdf2f8",
  primaryMid:"#be185d",
  rose50:    "#fff1f2",
  rose100:   "#ffe4e6",
  rose200:   "#fecdd3",
  text:      "#0f172a",
  muted:     "#64748b",
  border:    "#e2e8f0",
  card:      "#ffffff",
  bg:        "#f8fafc",
  green:     "#16a34a",  greenL: "#dcfce7",
  red:       "#dc2626",  redL:   "#fef2f2",
  amber:     "#d97706",  amberL: "#fffbeb",
  blue:      "#1d4ed8",  blueL:  "#eff6ff",
  purple:    "#7c3aed",  purpleL:"#f5f3ff",
};

const TABS = [
  { id: "overview",       label: "📋 Overview"         },
  { id: "vitals",         label: "❤️ Vitals"           },
  { id: "nursing-notes",  label: "📝 Nursing Notes"    },
  { id: "doctor-orders",  label: "🩺 Doctor's Orders"  },
  { id: "charges",        label: "💊 Nursing Charges"  },
  { id: "billing",        label: "💰 Patient Billing"  },
  { id: "audit",          label: "📊 Audit Trail"      },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
};

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "—"; }
};

const currency = (n) => `₹${(Number(n) || 0).toFixed(2)}`;

// ─── Shared Styles ────────────────────────────────────────────────────────────
const cardStyle = {
  background: C.card,
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  padding: "20px 24px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: ".6px",
  marginBottom: 4,
};

const valueStyle = {
  fontSize: 14,
  fontWeight: 600,
  color: C.text,
};

const inputStyle = {
  padding: "10px 14px",
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 14,
  color: C.text,
  outline: "none",
  background: "white",
  fontFamily: "'DM Sans', sans-serif",
};

const btnPrimaryStyle = {
  padding: "10px 20px",
  background: C.primary,
  color: "white",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnOutlineStyle = {
  padding: "8px 16px",
  background: "transparent",
  color: C.primary,
  border: `1.5px solid ${C.primary}`,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const thStyle = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  borderBottom: `2px solid ${C.rose100}`,
  background: C.primaryL,
};

const tdStyle = {
  padding: "10px 14px",
  fontSize: 13,
  color: C.text,
  borderBottom: `1px solid ${C.border}`,
  verticalAlign: "middle",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 40 }}>
      <div style={{
        width: 36, height: 36,
        border: `3px solid ${C.rose100}`,
        borderTop: `3px solid ${C.primary}`,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Badge({ text, bg, color, border }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      background: bg || C.primaryL,
      color: color || C.primary,
      border: `1px solid ${border || C.rose200}`,
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
    }}>
      {text}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    Active:      { bg: C.greenL,  color: C.green,  border: "#bbf7d0" },
    Admitted:    { bg: C.greenL,  color: C.green,  border: "#bbf7d0" },
    Discharged:  { bg: "#f1f5f9", color: C.muted,  border: C.border  },
    Pending:     { bg: C.amberL,  color: C.amber,  border: "#fde68a" },
    Completed:   { bg: C.blueL,   color: C.blue,   border: "#bfdbfe" },
  }[status] || { bg: C.primaryL, color: C.primary, border: C.rose200 };
  return <Badge text={status || "—"} {...cfg} />;
}

function EmptyState({ icon, message }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <p style={{ fontSize: 14, margin: 0 }}>{message}</p>
    </div>
  );
}

function InfoGrid({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "16px 24px" }}>
      {items.map(({ label, value, badge }) => (
        <div key={label}>
          <span style={labelStyle}>{label}</span>
          {badge
            ? badge
            : <span style={valueStyle}>{value || "—"}</span>
          }
        </div>
      ))}
    </div>
  );
}

// ─── Vital helpers ─────────────────────────────────────────────────────────────
function isAbnormalPulse(v)  { const n = Number(v); return n > 100 || n < 60; }
function isAbnormalTemp(v)   { return Number(v) > 99; }
function isAbnormalSpO2(v)   { return Number(v) < 95; }

function VitalCell({ value, isAbnormal, unit = "" }) {
  if (!value && value !== 0) return <span style={{ color: C.muted }}>—</span>;
  return (
    <span style={{
      color: isAbnormal ? C.red : C.green,
      fontWeight: 600,
    }}>
      {value}{unit}
    </span>
  );
}

// ─── TAB: Overview ────────────────────────────────────────────────────────────
function OverviewTab({ patient, admission, nursingNotes, nursingCharges }) {
  // Find latest nursing note with vitals
  const latestVitalsNote = nursingNotes.find(n => n.vitals && Object.keys(n.vitals).length > 0);
  const v = latestVitalsNote?.vitals || {};

  const chargesTotal = (nursingCharges?.items || []).reduce(
    (s, i) => s + (Number(i.amount) || 0), 0
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Patient Card */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 22 }}>👤</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Patient Demographics</span>
          </div>
          <InfoGrid items={[
            { label: "Full Name",    value: patient?.fullName || patient?.patientName },
            { label: "UHID",         value: patient?.UHID },
            { label: "Age / Gender", value: `${patient?.age || "—"} / ${patient?.gender || "—"}` },
            { label: "Blood Group",  value: patient?.bloodGroup },
            { label: "Contact",      value: patient?.contactNumber },
            { label: "Payment",      value: patient?.paymentType },
          ]} />
          {patient?.knownAllergies && patient.knownAllergies !== "None" && patient.knownAllergies !== "—" && (
            <div style={{
              marginTop: 16, padding: "10px 14px",
              background: "#fef2f2", border: "1px solid #fecaca",
              borderRadius: 8, fontSize: 13, color: C.red,
            }}>
              ⚠️ <strong>Known Allergies:</strong> {patient.knownAllergies}
            </div>
          )}
        </div>

        {/* Admission Card */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 22 }}>🏥</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Admission Details</span>
          </div>
          <InfoGrid items={[
            { label: "Admission No.",   value: admission?.admissionNumber },
            { label: "Type",            value: admission?.admissionType },
            { label: "Attending Doctor",value: admission?.attendingDoctor },
            { label: "Department",      value: admission?.department },
            { label: "Admission Date",  value: fmtDate(admission?.admissionDate) },
            { label: "Status",          badge: <StatusBadge status={admission?.status} /> },
          ]} />
        </div>
      </div>

      {/* Vitals Summary */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>💓</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Last Recorded Vitals</span>
          {latestVitalsNote && (
            <span style={{ fontSize: 12, color: C.muted, marginLeft: "auto" }}>
              {fmt(latestVitalsNote.createdAt)}
            </span>
          )}
        </div>
        {latestVitalsNote ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 16 }}>
            {[
              { label: "Blood Pressure", value: v.bp, unit: "" },
              { label: "Pulse",          value: v.pulse, unit: " bpm", abnormal: isAbnormalPulse(v.pulse) },
              { label: "Temperature",    value: v.temp, unit: "°F",   abnormal: isAbnormalTemp(v.temp) },
              { label: "SpO₂",           value: v.spo2, unit: "%",    abnormal: isAbnormalSpO2(v.spo2) },
              { label: "RR",             value: v.rr,   unit: "/min"  },
              { label: "Weight",         value: v.weight, unit: " kg" },
            ].map(({ label, value, unit, abnormal }) => (
              <div key={label} style={{
                background: C.primaryL,
                border: `1px solid ${C.rose200}`,
                borderRadius: 10,
                padding: "12px 14px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: abnormal ? C.red : C.green }}>
                  {value ? `${value}${unit}` : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No vitals recorded yet.</p>
        )}
      </div>

      {/* Today's Nursing Charges Summary */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>💊</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Today's Nursing Charges</span>
          <span style={{
            marginLeft: "auto", fontSize: 16, fontWeight: 700, color: C.primary,
          }}>
            {currency(chargesTotal)}
          </span>
        </div>
        {(nursingCharges?.items || []).length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {(nursingCharges.items || []).map((item, i) => (
              <div key={i} style={{
                background: C.primaryL,
                border: `1px solid ${C.rose200}`,
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 13,
              }}>
                <strong>{item.serviceName}</strong>
                {item.quantity > 1 && <span style={{ color: C.muted }}> ×{item.quantity}</span>}
                <span style={{ color: C.primary, marginLeft: 8, fontWeight: 700 }}>
                  {currency(item.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No nursing charges recorded today.</p>
        )}
      </div>
    </div>
  );
}

// ─── TAB: Vitals ──────────────────────────────────────────────────────────────
function VitalsTab({ nursingNotes }) {
  const vitalsNotes = nursingNotes.filter(n => n.vitals && Object.keys(n.vitals).length > 0);

  if (vitalsNotes.length === 0) {
    return <EmptyState icon="👩‍⚕️" message="No vitals recorded yet. Record vitals via nursing notes." />;
  }

  return (
    <div style={cardStyle}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date / Time", "BP", "Pulse", "Temp (°F)", "SpO₂ (%)", "RR (/min)", "Weight (kg)", "Nurse"].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vitalsNotes.map((note, i) => {
              const v = note.vitals || {};
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : C.primaryL }}>
                  <td style={tdStyle}>{fmt(note.createdAt)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600, color: C.text }}>{v.bp || "—"}</span>
                  </td>
                  <td style={tdStyle}>
                    <VitalCell value={v.pulse} isAbnormal={isAbnormalPulse(v.pulse)} unit=" bpm" />
                  </td>
                  <td style={tdStyle}>
                    <VitalCell value={v.temp} isAbnormal={isAbnormalTemp(v.temp)} unit="°F" />
                  </td>
                  <td style={tdStyle}>
                    <VitalCell value={v.spo2} isAbnormal={isAbnormalSpO2(v.spo2)} unit="%" />
                  </td>
                  <td style={tdStyle}>{v.rr || "—"}</td>
                  <td style={tdStyle}>{v.weight || "—"}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {note.nurseId || "Nurse"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TAB: Nursing Notes ───────────────────────────────────────────────────────
const NOTE_TYPE_CFG = {
  "Progress Note":    { bg: C.blueL,   color: C.blue,   border: "#bfdbfe" },
  "Shift Note":       { bg: C.greenL,  color: C.green,  border: "#bbf7d0" },
  "Incident Note":    { bg: "#fef2f2", color: C.red,    border: "#fecaca" },
  "Handover Note":    { bg: C.amberL,  color: C.amber,  border: "#fde68a" },
  "Assessment Note":  { bg: C.purpleL, color: C.purple, border: "#ddd6fe" },
};

function NursingNotesTab({ nursingNotes }) {
  if (nursingNotes.length === 0) {
    return <EmptyState icon="📝" message="No nursing notes recorded yet." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {nursingNotes.map((note, i) => {
        const typeCfg = NOTE_TYPE_CFG[note.noteType] || {
          bg: C.primaryL, color: C.primary, border: C.rose200,
        };
        const v = note.vitals || {};
        const hasVitals = v.bp || v.pulse || v.temp || v.spo2;

        return (
          <div key={i} style={{
            ...cardStyle,
            borderLeft: `4px solid ${typeCfg.color}`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge text={note.noteType || "Note"} bg={typeCfg.bg} color={typeCfg.color} border={typeCfg.border} />
                <span style={{ fontSize: 12, color: C.muted }}>{note.nurseId || "Nurse"}</span>
              </div>
              <span style={{ fontSize: 12, color: C.muted }}>{fmt(note.createdAt)}</span>
            </div>

            {note.content && (
              <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.6 }}>
                {note.content}
              </p>
            )}

            {hasVitals && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {v.bp    && <span style={{ padding: "3px 10px", background: C.primaryL, border: `1px solid ${C.rose200}`, borderRadius: 20, fontSize: 12, color: C.primaryD }}>BP: {v.bp}</span>}
                {v.pulse && (
                  <span style={{ padding: "3px 10px", background: isAbnormalPulse(v.pulse) ? "#fef2f2" : C.greenL, border: `1px solid ${isAbnormalPulse(v.pulse) ? "#fecaca" : "#bbf7d0"}`, borderRadius: 20, fontSize: 12, color: isAbnormalPulse(v.pulse) ? C.red : C.green }}>
                    Pulse: {v.pulse} bpm
                  </span>
                )}
                {v.temp  && (
                  <span style={{ padding: "3px 10px", background: isAbnormalTemp(v.temp) ? "#fef2f2" : C.greenL, border: `1px solid ${isAbnormalTemp(v.temp) ? "#fecaca" : "#bbf7d0"}`, borderRadius: 20, fontSize: 12, color: isAbnormalTemp(v.temp) ? C.red : C.green }}>
                    Temp: {v.temp}°F
                  </span>
                )}
                {v.spo2  && (
                  <span style={{ padding: "3px 10px", background: isAbnormalSpO2(v.spo2) ? "#fef2f2" : C.greenL, border: `1px solid ${isAbnormalSpO2(v.spo2) ? "#fecaca" : "#bbf7d0"}`, borderRadius: 20, fontSize: 12, color: isAbnormalSpO2(v.spo2) ? C.red : C.green }}>
                    SpO₂: {v.spo2}%
                  </span>
                )}
                {v.rr    && <span style={{ padding: "3px 10px", background: C.blueL, border: "1px solid #bfdbfe", borderRadius: 20, fontSize: 12, color: C.blue }}>RR: {v.rr}/min</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── TAB: Doctor's Orders ─────────────────────────────────────────────────────
function DoctorOrdersTab({ doctorNotes }) {
  if (doctorNotes.length === 0) {
    return <EmptyState icon="🩺" message="No doctor's orders recorded yet." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {doctorNotes.map((note, i) => (
        <div key={i} style={{
          ...cardStyle,
          borderLeft: `4px solid ${C.purple}`,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge
                text={note.noteType || "Doctor Note"}
                bg={C.purpleL}
                color={C.purple}
                border="#ddd6fe"
              />
              <span style={{ fontSize: 12, color: C.muted }}>
                Dr. {note.createdBy || "Doctor"}
              </span>
            </div>
            <span style={{ fontSize: 12, color: C.muted }}>{fmt(note.createdAt)}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {note.subjective && (
              <div>
                <span style={labelStyle}>Subjective (S)</span>
                <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{note.subjective}</p>
              </div>
            )}
            {note.objective && (
              <div>
                <span style={labelStyle}>Objective (O)</span>
                <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{note.objective}</p>
              </div>
            )}
            {note.assessment && (
              <div>
                <span style={labelStyle}>Assessment (A)</span>
                <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{note.assessment}</p>
              </div>
            )}
          </div>

          {note.diagnosis && (
            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 8,
            }}>
              <span style={{ ...labelStyle, color: C.amber }}>Diagnosis</span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.amber }}>{note.diagnosis}</p>
            </div>
          )}

          {note.plan && (
            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: C.greenL,
              border: "1px solid #bbf7d0",
              borderRadius: 8,
            }}>
              <span style={{ ...labelStyle, color: C.green }}>Plan (Follow)</span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.green, lineHeight: 1.6 }}>{note.plan}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── TAB: Nursing Charges ─────────────────────────────────────────────────────
function NursingChargesTab({ nursingCharges, billing }) {
  const todayItems = nursingCharges?.items || [];
  const nurseItems = (billing?.billItems || []).filter(
    item => item.addedBySource === "Nurse" || item.addedByRole === "Nurse"
  );

  const todayTotal = todayItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const nurseTotal = nurseItems.reduce((s, i) => s + (Number(i.netAmount) || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Today's charges */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Today's Nursing Charges</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.primary }}>{currency(todayTotal)}</span>
        </div>
        {todayItems.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Service", "Quantity", "Amount"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {todayItems.map((item, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : C.primaryL }}>
                  <td style={tdStyle}>{item.serviceName || "—"}</td>
                  <td style={tdStyle}>{item.quantity || 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: C.primary }}>{currency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>No nursing charges recorded today.</p>
        )}
      </div>

      {/* All nurse-added billing items */}
      {nurseItems.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>All Nurse-Added Services (Billing)</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.primary }}>{currency(nurseTotal)}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Service", "Category", "Amount"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nurseItems.map((item, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : C.primaryL }}>
                  <td style={tdStyle}>{item.serviceName || "—"}</td>
                  <td style={tdStyle}>
                    <Badge text={item.category || "Service"} bg={C.primaryL} color={C.primary} border={C.rose200} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: C.primary }}>{currency(item.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── TAB: Patient Billing ─────────────────────────────────────────────────────
function PatientBillingTab({ billing }) {
  if (!billing) {
    return <EmptyState icon="💰" message="No billing record found for this patient." />;
  }

  const billStatusCfg = {
    Paid:       { bg: C.greenL,  color: C.green,  border: "#bbf7d0" },
    Unpaid:     { bg: "#fef2f2", color: C.red,    border: "#fecaca" },
    Partial:    { bg: C.amberL,  color: C.amber,  border: "#fde68a" },
    Draft:      { bg: "#f1f5f9", color: C.muted,  border: C.border  },
  };
  const sc = billStatusCfg[billing.billStatus] || billStatusCfg.Draft;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Summary */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.primaryD }}>Bill #{billing.billNumber || "—"}</span>
          <Badge text={billing.billStatus || "Draft"} bg={sc.bg} color={sc.color} border={sc.border} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[
            { label: "Total Amount",  value: currency(billing.netAmount),     color: C.text    },
            { label: "Advance Paid",  value: currency(billing.advancePaid),   color: C.green   },
            { label: "Balance Due",   value: currency(billing.balanceAmount), color: billing.balanceAmount > 0 ? C.red : C.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: C.primaryL,
              border: `1px solid ${C.rose200}`,
              borderRadius: 10,
              padding: "14px 18px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Itemized table */}
      {(billing.billItems || []).length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.primaryD, marginBottom: 16 }}>Itemized Services</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Service", "Category", "Amount"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(billing.billItems || []).map((item, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : C.primaryL }}>
                  <td style={tdStyle}>{item.serviceName || "—"}</td>
                  <td style={tdStyle}>
                    <Badge text={item.category || "Service"} bg={C.primaryL} color={C.primary} border={C.rose200} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{currency(item.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment history */}
      {(billing.payments || []).length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.primaryD, marginBottom: 16 }}>Payment History</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Mode", "Amount", "Reference"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(billing.payments || []).map((pmt, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : C.primaryL }}>
                  <td style={tdStyle}>{fmt(pmt.paidAt || pmt.date)}</td>
                  <td style={tdStyle}>{pmt.mode || pmt.paymentMode || "—"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: C.green }}>{currency(pmt.amount)}</td>
                  <td style={tdStyle}>{pmt.reference || pmt.receiptNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── TAB: Audit Trail ─────────────────────────────────────────────────────────
const ROLE_CFG = {
  Nurse:       { bg: C.primaryL, color: C.primary, border: C.rose200,    icon: "👩‍⚕️" },
  Doctor:      { bg: C.purpleL,  color: C.purple,  border: "#ddd6fe",   icon: "🩺"  },
  Reception:   { bg: C.blueL,    color: C.blue,    border: "#bfdbfe",   icon: "🏥"  },
  Receptionist:{ bg: C.blueL,    color: C.blue,    border: "#bfdbfe",   icon: "🏥"  },
  Admin:       { bg: C.amberL,   color: C.amber,   border: "#fde68a",   icon: "⚙️"  },
  System:      { bg: "#f1f5f9",  color: C.muted,   border: C.border,    icon: "🤖"  },
};

function AuditTrailTab({ auditTrail }) {
  const triggers = (auditTrail?.triggers || []).slice().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (triggers.length === 0) {
    return <EmptyState icon="📊" message="No audit trail entries found." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {triggers.map((entry, i) => {
        const role = entry.orderedByRole || entry.sourceType || "System";
        const cfg = ROLE_CFG[role] || ROLE_CFG.System;

        return (
          <div key={i} style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
            {/* Timeline line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: cfg.bg, border: `2px solid ${cfg.color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, flexShrink: 0, zIndex: 1,
              }}>
                {cfg.icon}
              </div>
              {i < triggers.length - 1 && (
                <div style={{ width: 2, flex: 1, background: C.rose100, minHeight: 20 }} />
              )}
            </div>

            {/* Entry card */}
            <div style={{
              flex: 1,
              marginLeft: 12,
              marginBottom: 14,
              ...cardStyle,
              padding: "12px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge text={role} bg={cfg.bg} color={cfg.color} border={cfg.border} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {entry.serviceName || "—"}
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>
                  {entry.amount ? currency(entry.amount) : ""}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: C.muted }}>
                <span>By: {entry.orderedBy || "—"}</span>
                {entry.sourceType && <span>Source: {entry.sourceType}</span>}
                <span style={{ marginLeft: "auto" }}>{fmt(entry.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NursePatientPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [uhidInput, setUhidInput]       = useState(searchParams.get("uhid") || "");
  const [activeTab, setActiveTab]       = useState("overview");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  // Data state
  const [admission, setAdmission]           = useState(null);
  const [patient, setPatient]               = useState(null);
  const [nursingNotes, setNursingNotes]     = useState([]);
  const [doctorNotes, setDoctorNotes]       = useState([]);
  const [billing, setBilling]               = useState(null);
  const [auditTrail, setAuditTrail]         = useState(null);
  const [nursingCharges, setNursingCharges] = useState(null);
  const [opdVisits, setOpdVisits]           = useState([]);
  const [loaded, setLoaded]                 = useState(false);

  const fetchAll = useCallback(async (uhid) => {
    if (!uhid?.trim()) {
      setError("Please enter a UHID.");
      return;
    }
    setLoading(true);
    setError("");
    setLoaded(false);

    try {
      // 1. Admissions
      let adm = null;
      try {
        const res = await axios.get(`${BASE}/admissions?uhid=${uhid.trim()}`);
        const list = Array.isArray(res.data) ? res.data
                   : Array.isArray(res.data?.admissions) ? res.data.admissions
                   : (res.data?.data || []);
        adm = list.find(a => a.status === "Active" || a.status === "Admitted") || list[0] || null;
        setAdmission(adm);
      } catch (e) { console.error("admissions:", e); }

      // 2. Patient demographics
      try {
        const res = await axios.get(`${BASE}/patients?UHID=${uhid.trim()}`);
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setPatient(list[0] || null);
      } catch (e) { console.error("patients:", e); }

      const ipdNo = adm?.admissionNumber;

      // 3. Nursing notes
      if (ipdNo) {
        try {
          const res = await axios.get(`${BASE}/nursing-notes/ipd/${ipdNo}`);
          const list = res.data?.data || res.data?.notes || (Array.isArray(res.data) ? res.data : []);
          setNursingNotes(list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        } catch (e) { console.error("nursing-notes:", e); }
      }

      // 4. Doctor notes
      if (ipdNo) {
        try {
          const res = await axios.get(`${BASE}/doctor-notes/ipd/${ipdNo}`);
          const list = res.data?.data || res.data?.notes || (Array.isArray(res.data) ? res.data : []);
          setDoctorNotes(list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        } catch (e) { console.error("doctor-notes:", e); }
      }

      // 5. Billing
      try {
        const res = await axios.get(`${BASE}/billing/uhid/${uhid.trim()}`);
        // /uhid/:UHID returns { data: { patient, bills: [...] } }
        const bills = Array.isArray(res.data?.data?.bills) ? res.data.data.bills
                    : Array.isArray(res.data?.bills) ? res.data.bills
                    : Array.isArray(res.data?.data) ? res.data.data
                    : Array.isArray(res.data) ? res.data : [];
        setBilling(bills[0] || null);
      } catch (e) { console.error("billing:", e); }

      // 6. Billing audit trail (needs admissionId, not uhid)
      if (adm?._id) {
        try {
          const res = await axios.get(`${BASE}/billing/audit-trail/${adm._id}`);
          setAuditTrail(res.data || { triggers: [] });
        } catch (e) { console.error("audit-trail:", e); }
      }

      // 7. OPD visits
      try {
        const res = await axios.get(`${BASE}/opd?UHID=${uhid.trim()}&limit=5`);
        const list = Array.isArray(res.data?.data) ? res.data.data
                   : Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setOpdVisits(list);
      } catch (e) { console.error("opd:", e); }

      // 8. Nursing charges (today)
      if (adm?._id) {
        try {
          const res = await axios.get(`${BASE}/nursing-charges/${adm._id}/today`);
          setNursingCharges(res.data || { items: [] });
        } catch (e) { console.error("nursing-charges:", e); }
      }

      setLoaded(true);
    } catch (err) {
      setError("Failed to load patient data. Please check UHID and try again.");
      console.error("fetchAll:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load from URL param
  useEffect(() => {
    const urlUhid = searchParams.get("uhid");
    if (urlUhid) {
      setUhidInput(urlUhid);
      fetchAll(urlUhid);
    }
  }, []);

  const handleLoad = () => fetchAll(uhidInput);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLoad();
  };

  const patientName = patient?.fullName || admission?.patientName || "—";
  const uhidDisplay = admission?.UHID || patient?.UHID || uhidInput || "—";

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      fontFamily: "'DM Sans', 'Inter', sans-serif",
    }}>

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.primaryD} 0%, ${C.primary} 100%)`,
        padding: "16px 24px",
        color: "white",
        boxShadow: "0 2px 8px rgba(155,23,77,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>👩‍⚕️</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px" }}>
                Nursing Patient Panel
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Full Patient File — Nursing Staff
              </div>
            </div>
          </div>

          {/* UHID Search */}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
            <input
              value={uhidInput}
              onChange={e => setUhidInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter UHID…"
              style={{
                ...inputStyle,
                width: 200,
                background: "rgba(255,255,255,0.15)",
                border: "1.5px solid rgba(255,255,255,0.4)",
                color: "white",
                "::placeholder": { color: "rgba(255,255,255,0.6)" },
              }}
            />
            <button
              onClick={handleLoad}
              disabled={loading}
              style={{
                ...btnPrimaryStyle,
                background: "white",
                color: C.primary,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Loading…" : "Load Patient"}
            </button>
          </div>
        </div>

        {/* Quick action buttons — shown when patient loaded */}
        {loaded && admission && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/updateVitalSheet")}
              style={{ ...btnOutlineStyle, background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.5)" }}
            >
              ❤️ Record Vitals
            </button>
            <button
              onClick={() => navigate("/nursing-notes")}
              style={{ ...btnOutlineStyle, background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.5)" }}
            >
              📝 Nursing Notes
            </button>
            <button
              onClick={() => navigate("/nursing-care-plan")}
              style={{ ...btnOutlineStyle, background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.5)" }}
            >
              📋 Care Plan
            </button>
            <button
              onClick={() => navigate("/mar")}
              style={{ ...btnOutlineStyle, background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.5)" }}
            >
              💊 MAR
            </button>
          </div>
        )}
      </div>

      {/* ─── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* Error */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 10, padding: "14px 18px",
            color: C.red, fontSize: 14, marginBottom: 20,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Loading spinner */}
        {loading && <Spinner />}

        {/* Empty state — no patient loaded */}
        {!loading && !loaded && !error && (
          <div style={{
            ...cardStyle, textAlign: "center", padding: "60px 24px",
          }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.primaryD, marginBottom: 8 }}>
              Search for a Patient
            </div>
            <p style={{ fontSize: 14, color: C.muted, maxWidth: 400, margin: "0 auto" }}>
              Enter a UHID in the search bar above and click "Load Patient" to view the full patient file.
            </p>
          </div>
        )}

        {/* Patient loaded */}
        {!loading && loaded && (
          <>
            {/* Patient Info Banner */}
            <div style={{
              ...cardStyle,
              background: `linear-gradient(135deg, ${C.primaryL} 0%, ${C.rose50} 100%)`,
              border: `1px solid ${C.rose200}`,
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: C.primary, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, flexShrink: 0,
              }}>
                {patientName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.primaryD }}>
                  {patient?.title ? `${patient.title} ` : ""}{patientName}
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                  UHID: <strong>{uhidDisplay}</strong>
                  {patient?.age && <> &bull; {patient.age} yrs</>}
                  {patient?.gender && <> &bull; {patient.gender}</>}
                  {patient?.bloodGroup && <> &bull; 🩸 {patient.bloodGroup}</>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {admission?.admissionNumber && (
                  <Badge
                    text={`IPD: ${admission.admissionNumber}`}
                    bg={C.primaryL} color={C.primaryD} border={C.rose200}
                  />
                )}
                {admission?.status && <StatusBadge status={admission.status} />}
                {opdVisits.length > 0 && (
                  <Badge
                    text={`${opdVisits.length} OPD Visit${opdVisits.length > 1 ? "s" : ""}`}
                    bg={C.blueL} color={C.blue} border="#bfdbfe"
                  />
                )}
              </div>
            </div>

            {/* Tab Bar */}
            <div style={{
              display: "flex",
              borderBottom: `2px solid ${C.rose100}`,
              marginBottom: 20,
              overflowX: "auto",
              gap: 0,
            }}>
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "12px 18px",
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? C.primary : C.muted,
                      background: isActive ? C.primaryL : "transparent",
                      border: "none",
                      borderBottom: isActive ? `3px solid ${C.primary}` : "3px solid transparent",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      transition: "all 0.15s",
                      borderRadius: "6px 6px 0 0",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
              <OverviewTab
                patient={patient}
                admission={admission}
                nursingNotes={nursingNotes}
                nursingCharges={nursingCharges}
              />
            )}
            {activeTab === "vitals" && (
              <VitalsTab nursingNotes={nursingNotes} />
            )}
            {activeTab === "nursing-notes" && (
              <NursingNotesTab nursingNotes={nursingNotes} />
            )}
            {activeTab === "doctor-orders" && (
              <DoctorOrdersTab doctorNotes={doctorNotes} />
            )}
            {activeTab === "charges" && (
              <NursingChargesTab nursingCharges={nursingCharges} billing={billing} />
            )}
            {activeTab === "billing" && (
              <PatientBillingTab billing={billing} />
            )}
            {activeTab === "audit" && (
              <AuditTrailTab auditTrail={auditTrail} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
