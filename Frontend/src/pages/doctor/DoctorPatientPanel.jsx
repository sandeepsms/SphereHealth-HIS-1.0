/**
 * DoctorPatientPanel.jsx
 * Comprehensive Doctor Patient File Panel — full 360° view of any patient.
 * Purple/blue theme. 7-tab layout. UHID-based search + ?uhid= URL param.
 *
 * Tabs: Overview | Clinical Notes | Nursing Notes | Investigations | Billing | Audit Trail | Quick Links
 */

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const C = {
  primary:    "#7c3aed",
  primaryDark:"#4c1d95",
  primaryLight:"#f5f3ff",
  primaryMid: "#ede9fe",
  accent:     "#6d28d9",
  blue:       "#1e40af",
  blueLight:  "#dbeafe",
  success:    "#059669",
  successLight:"#d1fae5",
  danger:     "#dc2626",
  dangerLight:"#fee2e2",
  warn:       "#d97706",
  warnLight:  "#fef3c7",
  muted:      "#64748b",
  dark:       "#0f172a",
  card:       "#ffffff",
  bg:         "#f8fafc",
  border:     "#e2e8f0",
  text:       "#1e293b",
};

const TABS = [
  { id: "overview",     label: "📋 Overview" },
  { id: "clinical",     label: "🩺 Clinical Notes" },
  { id: "nursing",      label: "📝 Nursing Notes" },
  { id: "investigations",label: "🔬 Investigations" },
  { id: "billing",      label: "💰 Billing" },
  { id: "audit",        label: "📊 Audit Trail" },
  { id: "links",        label: "📄 Quick Links" },
];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtDT = (d) => {
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
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "—"; }
};

const fmtCur = (n) => `₹${(Number(n) || 0).toFixed(2)}`;

// ── Reusable sub-components ───────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 48 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        border: `3px solid ${C.primaryMid}`,
        borderTopColor: C.primary,
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function EmptyState({ icon = "📭", message = "No data available" }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "48px 24px", color: C.muted,
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14 }}>{message}</div>
    </div>
  );
}

function Badge({ children, color = C.primary, bg = C.primaryMid }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: ".3px",
      color, background: bg,
    }}>
      {children}
    </span>
  );
}

function SectionCard({ title, children, style = {} }) {
  return (
    <div style={{
      background: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
      overflow: "hidden", ...style,
    }}>
      {title && (
        <div style={{
          padding: "12px 18px", borderBottom: `1px solid ${C.border}`,
          background: C.primaryLight, fontWeight: 700, fontSize: 13, color: C.primaryDark,
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: C.muted, minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.dark, fontWeight: 500, wordBreak: "break-word" }}>{value || "—"}</span>
    </div>
  );
}

function Table({ headers, rows, emptyMsg = "No records" }) {
  if (!rows || rows.length === 0) {
    return <EmptyState message={emptyMsg} />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.primaryLight }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: "10px 14px", textAlign: "left", fontWeight: 700,
                color: C.primaryDark, borderBottom: `2px solid ${C.primaryMid}`,
                whiteSpace: "nowrap",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? C.card : "#fafaf9" }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: "9px 14px", borderBottom: `1px solid ${C.border}`, color: C.text,
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Status badge helper ───────────────────────────────────────────────────────
function statusBadge(status) {
  const s = (status || "").toLowerCase();
  if (s === "active" || s === "admitted")   return <Badge color={C.success} bg={C.successLight}>Active</Badge>;
  if (s === "discharged")                    return <Badge color={C.muted} bg="#f1f5f9">Discharged</Badge>;
  if (s === "pending")                       return <Badge color={C.warn} bg={C.warnLight}>Pending</Badge>;
  if (s === "completed")                     return <Badge color={C.blue} bg={C.blueLight}>Completed</Badge>;
  return <Badge color={C.muted} bg="#f1f5f9">{status || "—"}</Badge>;
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function OverviewTab({ patient, admission, opdVisits, billing }) {
  const recentVisits = (opdVisits || []).slice(0, 3);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Quick stats */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {[
          { label: "Admission Type", value: admission?.admissionType || "—", icon: "🏥" },
          { label: "Balance Due",    value: fmtCur(billing?.balanceAmount), icon: "💳" },
          { label: "Total Bill",     value: fmtCur(billing?.netAmount), icon: "🧾" },
          { label: "OPD Visits",     value: opdVisits?.length || 0, icon: "📅" },
        ].map((s, i) => (
          <div key={i} style={{
            flex: "1 1 160px", background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: "14px 18px", display: "flex", gap: 12, alignItems: "center",
          }}>
            <span style={{ fontSize: 28 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: ".3px" }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.primaryDark, marginTop: 2 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: patient + admission */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <SectionCard title="👤 Patient Demographics">
          <InfoRow label="Full Name"    value={`${patient?.title || ""} ${patient?.fullName || ""}`.trim()} />
          <InfoRow label="UHID"         value={patient?.UHID} />
          <InfoRow label="Age / Gender" value={`${patient?.age || "—"} / ${patient?.gender || "—"}`} />
          <InfoRow label="Date of Birth" value={fmtDate(patient?.dateOfBirth)} />
          <InfoRow label="Blood Group"  value={patient?.bloodGroup} />
          <InfoRow label="Contact"      value={patient?.contactNumber} />
          <InfoRow label="Payment Type" value={patient?.paymentType} />
          {patient?.knownAllergies && (
            <div style={{
              marginTop: 10, padding: "8px 12px", background: C.dangerLight,
              borderRadius: 8, fontSize: 12, color: C.danger, fontWeight: 600,
            }}>
              ⚠️ Allergies: {patient.knownAllergies}
            </div>
          )}
        </SectionCard>

        <SectionCard title="🏥 Admission Details">
          <InfoRow label="Admission No."  value={admission?.admissionNumber} />
          <InfoRow label="Type"           value={admission?.admissionType} />
          <InfoRow label="Attending Dr."  value={admission?.attendingDoctor} />
          <InfoRow label="Department"     value={admission?.department} />
          <InfoRow label="Admission Date" value={fmtDate(admission?.admissionDate)} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 13, color: C.muted, minWidth: 130 }}>Status</span>
            {statusBadge(admission?.status)}
          </div>
        </SectionCard>
      </div>

      {/* Recent OPD Visits */}
      <SectionCard title="📅 Recent OPD Visits">
        {recentVisits.length === 0 ? (
          <EmptyState icon="📅" message="No OPD visits found" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {recentVisits.map((v, i) => (
              <div key={i} style={{
                padding: "12px 16px", borderRadius: 10,
                border: `1px solid ${C.border}`, background: C.bg,
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{v?.visitNumber || "—"}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{v?.chiefComplaint || "—"}</div>
                  {v?.diagnosis && (
                    <div style={{ fontSize: 12, color: C.blue, marginTop: 2 }}>Dx: {v.diagnosis}</div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(v?.visitDate)}</div>
                  <div style={{ marginTop: 4 }}>{statusBadge(v?.status)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab: Clinical Notes ───────────────────────────────────────────────────────
function ClinicalNotesTab({ notes }) {
  if (!notes || notes.length === 0) {
    return <EmptyState icon="🩺" message="No clinical notes found for this patient" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {notes.map((note, i) => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 8,
            padding: "12px 18px", background: C.primaryLight, borderBottom: `1px solid ${C.primaryMid}`,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Badge>{note?.noteType || "Note"}</Badge>
              {note?.isSigned && <Badge color={C.success} bg={C.successLight}>✓ Signed</Badge>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: C.muted }}>{fmtDT(note?.createdAt)}</div>
              {note?.createdBy && (
                <div style={{ fontSize: 12, fontWeight: 600, color: C.primaryDark }}>{note.createdBy}</div>
              )}
            </div>
          </div>

          {/* SOAP body */}
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "S — Subjective",  value: note?.soap?.subjective || note?.subjective,  color: "#1e40af", bg: "#eff6ff" },
              { label: "O — Objective",   value: note?.soap?.objective  || note?.objective,   color: "#0f766e", bg: "#f0fdfa" },
              { label: "A — Assessment",  value: note?.soap?.assessment || note?.assessment || note?.provisionalDiagnosis || note?.finalDiagnosis,  color: "#9a3412", bg: "#fff7ed" },
              { label: "P — Plan",        value: note?.soap?.plan       || note?.plan,        color: "#166534", bg: "#f0fdf4" },
            ].filter(s => s.value).map((s, j) => (
              <div key={j} style={{
                padding: "10px 14px", borderRadius: 8,
                background: s.bg, borderLeft: `3px solid ${s.color}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 4, letterSpacing: ".3px" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 13, color: C.dark, lineHeight: 1.6 }}>{s.value}</div>
              </div>
            ))}

            {note?.diagnosis && (
              <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "#fdf4ff", border: `1.5px solid ${C.primary}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.primary, marginBottom: 4, letterSpacing: ".3px" }}>
                  🏷️ DIAGNOSIS
                </div>
                <div style={{ fontSize: 13, color: C.dark, fontWeight: 600 }}>{note.diagnosis}</div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Nursing Notes ────────────────────────────────────────────────────────
function NursingNotesTab({ notes }) {
  if (!notes || notes.length === 0) {
    return <EmptyState icon="📝" message="No nursing notes found for this patient" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {notes.map((note, i) => {
        const vitals = note?.vitals;
        const hasVitals = vitals && typeof vitals === "object" && Object.keys(vitals).length > 0;
        return (
          <div key={i} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
              padding: "10px 16px", background: "#fdf4ff", borderBottom: `1px solid #ede9fe`,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge color="#db2777" bg="#fdf2f8">{note?.noteType || "Nursing Note"}</Badge>
                {note?.nurseId && (
                  <span style={{ fontSize: 12, color: C.muted }}>Nurse: {note.nurseId}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{fmtDT(note?.createdAt)}</div>
            </div>
            <div style={{ padding: 16 }}>
              {note?.content && (
                <div style={{ fontSize: 13, color: C.dark, lineHeight: 1.6, marginBottom: hasVitals ? 12 : 0 }}>
                  {note.content}
                </div>
              )}
              {hasVitals && (
                <div style={{
                  padding: "10px 14px", borderRadius: 8, background: "#f0fdf4",
                  border: "1px solid #bbf7d0", display: "flex", flexWrap: "wrap", gap: 16,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", width: "100%", marginBottom: 4 }}>
                    📊 Vitals
                  </div>
                  {Object.entries(vitals).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 12 }}>
                      <span style={{ color: C.muted, marginRight: 4 }}>{k}:</span>
                      <span style={{ fontWeight: 600, color: C.dark }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Investigations ───────────────────────────────────────────────────────
function InvestigationsTab({ billItems, auditTrail }) {
  const INV_CATS = ["SUPPORT", "RADIOLOGY", "LABORATORY", "LAB", "INVESTIGATION"];
  const filtered = (billItems || []).filter(
    item => INV_CATS.includes((item?.category || "").toUpperCase())
  );

  // Group by category
  const groups = {};
  filtered.forEach(item => {
    const cat = item?.category || "Other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  if (filtered.length === 0) {
    return <EmptyState icon="🔬" message="No investigation records found" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {Object.entries(groups).map(([cat, items]) => (
        <SectionCard key={cat} title={`🔬 ${cat}`}>
          <Table
            headers={["#", "Test / Service", "Amount", "Ordered By"]}
            rows={items.map((item, i) => [
              i + 1,
              item?.serviceName || "—",
              fmtCur(item?.netAmount),
              (() => {
                const trail = (auditTrail || []).find(
                  t => (t?.serviceName || "").toLowerCase() === (item?.serviceName || "").toLowerCase()
                );
                return trail ? `${trail.orderedBy || ""} (${trail.orderedByRole || ""})` : "—";
              })(),
            ])}
            emptyMsg="No investigations in this category"
          />
        </SectionCard>
      ))}
    </div>
  );
}

// ── Tab: Billing ──────────────────────────────────────────────────────────────
function BillingTab({ billing }) {
  if (!billing) {
    return <EmptyState icon="💰" message="No billing record found for this patient" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Summary card */}
      <div style={{
        background: `linear-gradient(135deg, ${C.primaryDark}, ${C.primary})`,
        borderRadius: 14, padding: "24px 28px", color: "#fff",
        display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 12, opacity: .8, marginBottom: 4 }}>Bill Number</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{billing?.billNumber || "—"}</div>
        </div>
        {[
          { label: "Total Amount", value: fmtCur(billing?.netAmount) },
          { label: "Advance Paid", value: fmtCur(billing?.advancePaid) },
          { label: "Balance Due",  value: fmtCur(billing?.balanceAmount) },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: .8, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
        <div>{statusBadge(billing?.billStatus)}</div>
      </div>

      {/* Bill items */}
      <SectionCard title="🧾 Itemised Bill">
        <Table
          headers={["#", "Service Name", "Category", "Amount"]}
          rows={(billing?.billItems || []).map((item, i) => [
            i + 1,
            item?.serviceName || "—",
            item?.category ? <Badge>{item.category}</Badge> : "—",
            fmtCur(item?.netAmount),
          ])}
          emptyMsg="No bill items found"
        />
      </SectionCard>

      {/* Payment history */}
      <SectionCard title="💳 Payment History">
        <Table
          headers={["#", "Amount", "Mode", "Date", "Notes"]}
          rows={(billing?.payments || []).map((p, i) => [
            i + 1,
            fmtCur(p?.amount),
            p?.mode || p?.paymentMode || "—",
            fmtDT(p?.createdAt || p?.date || p?.paidAt),
            p?.notes || p?.remarks || "—",
          ])}
          emptyMsg="No payment records found"
        />
      </SectionCard>
    </div>
  );
}

// ── Tab: Audit Trail ──────────────────────────────────────────────────────────
function AuditTrailTab({ auditTrail }) {
  const roleStyle = (role) => {
    const r = (role || "").toLowerCase();
    if (r.includes("doctor")) return { color: C.primary, bg: C.primaryMid, icon: "👨‍⚕️" };
    if (r.includes("nurse"))  return { color: "#db2777", bg: "#fdf2f8",    icon: "👩‍⚕️" };
    if (r.includes("recep"))  return { color: C.blue,   bg: C.blueLight,   icon: "🏥" };
    return { color: C.muted, bg: "#f1f5f9", icon: "👤" };
  };

  const sorted = [...(auditTrail || [])].sort(
    (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)
  );

  if (sorted.length === 0) {
    return <EmptyState icon="📊" message="No audit trail entries found" />;
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Timeline line */}
      <div style={{
        position: "absolute", left: 22, top: 24, bottom: 24, width: 2,
        background: `linear-gradient(to bottom, ${C.primary}, ${C.primaryMid})`,
        borderRadius: 2,
      }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {sorted.map((entry, i) => {
          const rs = roleStyle(entry?.orderedByRole);
          return (
            <div key={i} style={{ display: "flex", gap: 16, paddingBottom: 20, paddingLeft: 4 }}>
              {/* Dot */}
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: rs.bg, border: `2px solid ${rs.color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0, zIndex: 1,
              }}>
                {rs.icon}
              </div>
              {/* Content */}
              <div style={{
                flex: 1, background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: "12px 16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.dark }}>
                      {entry?.serviceName || "—"}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <Badge color={rs.color} bg={rs.bg}>{entry?.orderedByRole || "Unknown"}</Badge>
                      {entry?.sourceType && <Badge color={C.muted} bg="#f1f5f9">{entry.sourceType}</Badge>}
                      {entry?.orderedBy && (
                        <span style={{ fontSize: 12, color: C.muted }}>by {entry.orderedBy}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.primary }}>
                      {fmtCur(entry?.amount)}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                      {fmtDT(entry?.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Quick Links ──────────────────────────────────────────────────────────
function QuickLinksTab({ uhid, navigate }) {
  const links = [
    {
      label: "IPD Assessment",
      desc: "Doctor notes and assessment for IPD patients",
      icon: "🏥",
      path: `/doctor-assessment`,
      color: C.primary,
      bg: C.primaryMid,
    },
    {
      label: "Consent Forms",
      desc: "View and manage patient consent forms",
      icon: "📋",
      path: `/consent-forms`,
      color: "#0f766e",
      bg: "#ccfbf1",
    },
    {
      label: "Discharge Summary",
      desc: "Generate or view discharge summary",
      icon: "📄",
      path: `/discharge-summary`,
      color: "#9a3412",
      bg: "#ffedd5",
    },
    {
      label: "Full Audit Trail",
      desc: "Detailed billing audit trail for this patient",
      icon: "📊",
      path: `/billing-audit-trail/${uhid}`,
      color: "#6d28d9",
      bg: "#ede9fe",
    },
    {
      label: "Patient Billing",
      desc: "Full billing and payment management",
      icon: "💰",
      path: `/patient-billing/${uhid}`,
      color: "#166534",
      bg: "#dcfce7",
    },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: 16,
    }}>
      {links.map((link, i) => (
        <button
          key={i}
          onClick={() => navigate(link.path)}
          style={{
            background: C.card, border: `1.5px solid ${C.border}`,
            borderRadius: 14, padding: "20px 22px",
            cursor: "pointer", textAlign: "left",
            transition: "all .15s ease",
            display: "flex", gap: 16, alignItems: "flex-start",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = link.color;
            e.currentTarget.style.background = link.bg;
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = `0 4px 16px ${link.color}33`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = C.border;
            e.currentTarget.style.background = C.card;
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <span style={{
            fontSize: 30, width: 44, height: 44, borderRadius: 10,
            background: link.bg, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {link.icon}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.dark, marginBottom: 4 }}>
              {link.label}
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{link.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DoctorPatientPanel() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState(searchParams.get("uhid") || "");
  const [activeUhid, setActiveUhid] = useState(searchParams.get("uhid") || "");
  const [activeTab, setActiveTab] = useState("overview");

  // Data state
  const [patient, setPatient] = useState(null);
  const [admission, setAdmission] = useState(null);
  const [doctorNotes, setDoctorNotes] = useState([]);
  const [nursingNotes, setNursingNotes] = useState([]);
  const [billing, setBilling] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [opdVisits, setOpdVisits] = useState([]);

  // Loading states
  const [loadingMain, setLoadingMain] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingNursing, setLoadingNursing] = useState(false);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [error, setError] = useState("");

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const fetchPatientCore = useCallback(async (uhid) => {
    setLoadingMain(true);
    setError("");
    try {
      const [admRes, patRes, opdRes] = await Promise.all([
        axios.get(`${BASE}/admissions?uhid=${uhid}`).catch(() => ({ data: [] })),
        axios.get(`${BASE}/patients?UHID=${uhid}`).catch(() => ({ data: [] })),
        axios.get(`${BASE}/opd?UHID=${uhid}&limit=5`).catch(() => ({ data: [] })),
      ]);

      const admissions = Array.isArray(admRes.data?.admissions) ? admRes.data.admissions
                       : Array.isArray(admRes.data)            ? admRes.data : [];
      const patients   = Array.isArray(patRes.data?.data)  ? patRes.data.data
                       : Array.isArray(patRes.data)         ? patRes.data  : [];
      const visits     = Array.isArray(opdRes.data?.data)  ? opdRes.data.data
                       : Array.isArray(opdRes.data)         ? opdRes.data  : [];

      const adm = admissions.find(a => (a?.status || "").toLowerCase() === "active")
                  || admissions.find(a => (a?.status || "").toLowerCase() === "admitted")
                  || admissions[0]
                  || null;

      setAdmission(adm);
      setPatient(patients[0] || null);
      setOpdVisits(visits);

      if (!adm && patients.length === 0) {
        setError(`No patient found for UHID: ${uhid}`);
      }

      return adm;
    } catch (err) {
      setError("Failed to load patient data. Please check the UHID and try again.");
      return null;
    } finally {
      setLoadingMain(false);
    }
  }, []);

  const fetchNotes = useCallback(async (ipdNo) => {
    if (!ipdNo) return;
    setLoadingNotes(true);
    try {
      const res = await axios.get(`${BASE}/doctor-notes/ipd/${ipdNo}`);
      const notes = res.data?.data || res.data?.notes || (Array.isArray(res.data) ? res.data : []);
      setDoctorNotes(Array.isArray(notes) ? notes : []);
    } catch {
      setDoctorNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  const fetchNursingNotes = useCallback(async (ipdNo) => {
    if (!ipdNo) return;
    setLoadingNursing(true);
    try {
      let notes = [];
      try {
        const r = await axios.get(`${BASE}/nursing-notes/ipd/${ipdNo}`);
        notes = r.data?.data || r.data?.notes || (Array.isArray(r.data) ? r.data : []);
      } catch {
        const r = await axios.get(`${BASE}/nurse-notes/ipd/${ipdNo}`).catch(() => ({ data: [] }));
        notes = r.data?.data || r.data?.notes || (Array.isArray(r.data) ? r.data : []);
      }
      setNursingNotes(Array.isArray(notes) ? notes : []);
    } catch {
      setNursingNotes([]);
    } finally {
      setLoadingNursing(false);
    }
  }, []);

  const fetchBilling = useCallback(async (uhid) => {
    setLoadingBilling(true);
    try {
      const res = await axios.get(`${BASE}/billing/uhid/${uhid}`);
      // /uhid/:UHID returns { data: { patient, bills: [...] } }
      const bills = Array.isArray(res.data?.data?.bills) ? res.data.data.bills
                  : Array.isArray(res.data?.bills) ? res.data.bills
                  : Array.isArray(res.data?.data) ? res.data.data
                  : Array.isArray(res.data) ? res.data : [];
      setBilling(bills[0] || null);
    } catch {
      setBilling(null);
    } finally {
      setLoadingBilling(false);
    }
  }, []);

  const fetchAuditTrail = useCallback(async (admissionId) => {
    if (!admissionId) return;
    setLoadingAudit(true);
    try {
      const res = await axios.get(`${BASE}/billing/audit-trail/${admissionId}`);
      const data = res.data;
      const triggers = Array.isArray(data?.triggers) ? data.triggers
                     : Array.isArray(data) ? data : [];
      setAuditTrail(triggers);
    } catch {
      setAuditTrail([]);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  // ── Load all data when UHID is set ────────────────────────────────────────
  const loadPatient = useCallback(async (uhid) => {
    if (!uhid) return;
    const trimmed = uhid.trim().toUpperCase();
    if (!trimmed) return;

    setPatient(null);
    setAdmission(null);
    setDoctorNotes([]);
    setNursingNotes([]);
    setBilling(null);
    setAuditTrail([]);
    setOpdVisits([]);
    setActiveTab("overview");

    const adm = await fetchPatientCore(trimmed);

    // Fetch remaining data in parallel — use correct IDs for each endpoint
    await Promise.all([
      fetchBilling(trimmed),
      adm?._id ? fetchAuditTrail(adm._id) : Promise.resolve(),
      adm?.admissionNumber ? fetchNotes(adm.admissionNumber) : Promise.resolve(),
      adm?.admissionNumber ? fetchNursingNotes(adm.admissionNumber) : Promise.resolve(),
    ]);
  }, [fetchPatientCore, fetchBilling, fetchAuditTrail, fetchNotes, fetchNursingNotes]);

  // Auto-load from URL param on mount
  useEffect(() => {
    const uhidParam = searchParams.get("uhid");
    if (uhidParam) {
      setSearchInput(uhidParam);
      setActiveUhid(uhidParam);
      loadPatient(uhidParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = () => {
    const uhid = searchInput.trim().toUpperCase();
    if (!uhid) return;
    setActiveUhid(uhid);
    loadPatient(uhid);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLoad();
  };

  const patientLoaded = !!(patient || admission);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.primaryDark} 0%, ${C.primary} 100%)`,
        padding: "16px 28px",
        display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
        boxShadow: "0 4px 20px rgba(124,58,237,.35)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
          <span style={{ fontSize: 26 }}>🩺</span>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 17, letterSpacing: "-.2px" }}>
              Doctor Patient Panel
            </div>
            <div style={{ color: "#c4b5fd", fontSize: 11 }}>Full patient file — clinical, billing & audit</div>
          </div>
        </div>

        {/* Search */}
        <div style={{ flex: 1, display: "flex", gap: 10, maxWidth: 480, marginLeft: "auto" }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter UHID (e.g. UH-00001)"
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 10,
              border: "2px solid rgba(255,255,255,.3)",
              background: "rgba(255,255,255,.12)", color: "#fff",
              fontSize: 14, outline: "none", fontFamily: "inherit",
              letterSpacing: ".5px",
            }}
            onFocus={e => e.target.style.borderColor = "rgba(255,255,255,.7)"}
            onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.3)"}
          />
          <button
            onClick={handleLoad}
            disabled={loadingMain}
            style={{
              padding: "10px 22px", borderRadius: 10, border: "none",
              background: loadingMain ? "rgba(255,255,255,.3)" : "#fff",
              color: loadingMain ? "#fff" : C.primary,
              fontWeight: 700, fontSize: 14, cursor: loadingMain ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {loadingMain ? "Loading…" : "Load Patient"}
          </button>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          margin: "16px 28px 0", padding: "12px 16px",
          background: C.dangerLight, border: `1px solid #fca5a5`,
          borderRadius: 10, color: C.danger, fontSize: 13, fontWeight: 500,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Loading state ───────────────────────────────────────────────────── */}
      {loadingMain && <Spinner />}

      {/* ── Patient loaded ───────────────────────────────────────────────────── */}
      {!loadingMain && patientLoaded && (
        <>
          {/* Patient summary strip */}
          <div style={{
            margin: "16px 28px 0",
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: "16px 22px",
            display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
            boxShadow: "0 2px 8px rgba(0,0,0,.05)",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: C.primaryMid, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 22, flexShrink: 0,
            }}>
              👤
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 800, fontSize: 18, color: C.dark }}>
                {patient?.title ? `${patient.title} ` : ""}{patient?.fullName || admission?.patientName || "—"}
              </div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                UHID: <strong style={{ color: C.primary }}>{activeUhid}</strong>
                {(patient?.age || patient?.gender) && (
                  <span style={{ marginLeft: 12 }}>
                    {patient?.age || "—"} yrs · {patient?.gender || "—"}
                  </span>
                )}
                {patient?.bloodGroup && (
                  <span style={{ marginLeft: 12 }}>
                    Blood: <strong>{patient.bloodGroup}</strong>
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {admission?.admissionType && (
                <Badge color={C.blue} bg={C.blueLight}>{admission.admissionType}</Badge>
              )}
              {statusBadge(admission?.status || "Active")}
              {admission?.department && (
                <span style={{ fontSize: 12, color: C.muted }}>Dept: {admission.department}</span>
              )}
            </div>
          </div>

          {/* ── Tab Bar ──────────────────────────────────────────────────────── */}
          <div style={{
            margin: "16px 28px 0",
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0,0,0,.05)",
          }}>
            {/* Tabs */}
            <div style={{
              display: "flex", overflowX: "auto",
              borderBottom: `2px solid ${C.border}`,
              background: "#fafaf9",
            }}>
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "14px 18px", border: "none", background: "transparent",
                      cursor: "pointer", fontSize: 13, fontWeight: isActive ? 700 : 500,
                      color: isActive ? C.primary : C.muted,
                      borderBottom: isActive ? `3px solid ${C.primary}` : "3px solid transparent",
                      marginBottom: -2, whiteSpace: "nowrap",
                      transition: "all .15s ease",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = C.dark; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = C.muted; }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div style={{ padding: "24px 22px" }}>
              {/* Overview */}
              {activeTab === "overview" && (
                <OverviewTab
                  patient={patient}
                  admission={admission}
                  opdVisits={opdVisits}
                  billing={billing}
                />
              )}

              {/* Clinical Notes */}
              {activeTab === "clinical" && (
                loadingNotes ? <Spinner /> : <ClinicalNotesTab notes={doctorNotes} />
              )}

              {/* Nursing Notes */}
              {activeTab === "nursing" && (
                loadingNursing ? <Spinner /> : <NursingNotesTab notes={nursingNotes} />
              )}

              {/* Investigations */}
              {activeTab === "investigations" && (
                loadingBilling ? <Spinner /> : (
                  <InvestigationsTab
                    billItems={billing?.billItems}
                    auditTrail={auditTrail}
                  />
                )
              )}

              {/* Billing */}
              {activeTab === "billing" && (
                loadingBilling ? <Spinner /> : <BillingTab billing={billing} />
              )}

              {/* Audit Trail */}
              {activeTab === "audit" && (
                loadingAudit ? <Spinner /> : <AuditTrailTab auditTrail={auditTrail} />
              )}

              {/* Quick Links */}
              {activeTab === "links" && (
                <QuickLinksTab uhid={activeUhid} navigate={navigate} />
              )}
            </div>
          </div>

          <div style={{ height: 40 }} />
        </>
      )}

      {/* ── Empty / initial state ────────────────────────────────────────────── */}
      {!loadingMain && !patientLoaded && !error && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "80px 24px", color: C.muted,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: C.primaryMid, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 40, marginBottom: 20,
          }}>
            🩺
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.primaryDark, marginBottom: 8 }}>
            Enter a Patient UHID
          </div>
          <div style={{ fontSize: 14, maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
            Type a UHID in the search bar above and click <strong>Load Patient</strong> to view
            the complete patient file — clinical notes, billing, nursing records, and more.
          </div>
        </div>
      )}
    </div>
  );
}
