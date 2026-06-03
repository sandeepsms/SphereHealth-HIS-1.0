/**
 * ECGRegisterPage.jsx — R7en / NABH AAC.4 + IPSG.2 + COP.7
 *
 * Surveyor + clinical-staff facing chronological view of all ECGs done
 * in the facility. Top of page has a collapsed Quick-Entry section: UHID
 * lookup → patient banner → ECG entry form (leads / rhythm / HR / PR /
 * QRS / QT / QTc / axis / ST-T / interpretation). Table below lists
 * recent ECGs with critical/abnormal flags + TAT; click a row to see
 * full details + audit trail.
 *
 *   URL: /compliance/nabh/ecg-register
 *
 * Auto-populated by emitECG from DoctorOrder (Investigation/ECG); manual
 * entries use the POST endpoint. Findings filed via PATCH /:id/report
 * once the strip is read.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";
import {
  listECG as svcListECG,
  createECG as svcCreateECG,
  reportECG as svcReportECG,
  reviewECG as svcReviewECG,
} from "../../Services/ecgRegisterService";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// Enum lists — keep in lock-step with ECGRegisterModel.js
const RHYTHMS = ["", "NSR", "AF", "AFL", "SVT", "VT", "VF", "AV-Block-1", "AV-Block-2", "AV-Block-3", "Junctional", "Paced", "Asystole", "Other"];
const AXES = ["", "Normal", "LAD", "RAD", "Extreme-RAD", "Indeterminate"];
const ST_CHANGES = ["", "None", "STE", "STD", "Non-specific", "Inverted-T"];
const LOCATIONS = ["Ward", "ICU", "ER", "OPD", "Cath Lab", "Day Care"];
const LEAD_TYPES = ["12-lead", "3-lead", "Single-lead", "Holter"];
const INDICATION_CATEGORIES = [
  "Chest pain", "Pre-op", "Routine", "Follow-up", "Arrhythmia w/u",
  "Post-MI", "Pacemaker check", "Cardiotoxicity", "Other",
];
const ALL_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const inputStyle = { padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle = { fontSize: 11, color: C.muted, display: "block", marginBottom: 2 };

const blankEntry = {
  UHID: "",
  patientId: "",
  patientName: "",
  performedAt: new Date().toISOString().slice(0, 16),
  location: "Ward",
  leadType: "12-lead",
  indication: "",
  indicationCategory: "Other",
  rhythm: "",
  heartRate: "",
  prInterval: "",
  qrsDuration: "",
  qtInterval: "",
  qtcInterval: "",
  axis: "",
  stChanges: "",
  leadsAffected: [],
  interpretation: "",
  performedByName: "",
  reportedByName: "",
};

export default function ECGRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(7));
  const [endDate, setEndDate] = useState(todayISO());
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [uhidFilter, setUhidFilter] = useState("");

  // Quick-entry state
  const [entryOpen, setEntryOpen] = useState(false);
  const [entry, setEntry] = useState({ ...blankEntry });
  const [patientLookup, setPatientLookup] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState(null);

  // ── Fetch the list ────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await svcListECG({
        startDate,
        endDate,
        limit: 200,
        ...(criticalOnly ? { critical: "true" } : {}),
        ...(abnormalOnly ? { abnormal: "true" } : {}),
        ...(uhidFilter ? { UHID: uhidFilter.toUpperCase() } : {}),
      });
      setRows(data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load ECG register");
    }
    setLoading(false);
  }, [startDate, endDate, criticalOnly, abnormalOnly, uhidFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── UHID → patient lookup for the quick-entry form ───────────────
  const lookupPatient = async (uhid) => {
    const trimmed = String(uhid || "").trim().toUpperCase();
    if (!trimmed) { setPatientLookup(null); return; }
    try {
      const r = await axios.get(`${API}/patients/uhid/${encodeURIComponent(trimmed)}`, authHdr());
      const p = r.data?.data || r.data?.patient || r.data;
      if (p && (p._id || p.UHID)) {
        setPatientLookup(p);
        setEntry((prev) => ({
          ...prev,
          UHID: p.UHID || trimmed,
          patientId: p._id || "",
          patientName: p.fullName || p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "",
        }));
      } else {
        setPatientLookup(null);
        toast.warn(`No patient found for UHID ${trimmed}`);
      }
    } catch (e) {
      setPatientLookup(null);
      toast.error(e?.response?.data?.message || `Lookup failed for UHID ${trimmed}`);
    }
  };

  // ── Submit a manual ECG ───────────────────────────────────────────
  const submitEntry = async () => {
    if (!entry.UHID) { toast.warn("Enter UHID"); return; }
    setSubmitting(true);
    try {
      const data = await svcCreateECG({
        UHID: entry.UHID,
        ecg: {
          performedAt: entry.performedAt || new Date().toISOString(),
          location: entry.location,
          leadType: entry.leadType,
          indication: entry.indication,
          indicationCategory: entry.indicationCategory,
          rhythm: entry.rhythm,
          heartRate: entry.heartRate,
          prInterval: entry.prInterval,
          qrsDuration: entry.qrsDuration,
          qtInterval: entry.qtInterval,
          qtcInterval: entry.qtcInterval,
          axis: entry.axis,
          stChanges: entry.stChanges,
          leadsAffected: entry.leadsAffected,
          interpretation: entry.interpretation,
          performedByName: entry.performedByName,
          reportedByName: entry.reportedByName,
        },
      });
      toast.success(`ECG saved · ${data?.data?.ecgNumber || "OK"}`);
      setEntry({ ...blankEntry });
      setPatientLookup(null);
      setEntryOpen(false);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save ECG");
    }
    setSubmitting(false);
  };

  const toggleLead = (lead) => {
    setEntry((p) => ({
      ...p,
      leadsAffected: p.leadsAffected.includes(lead)
        ? p.leadsAffected.filter((l) => l !== lead)
        : [...p.leadsAffected, lead],
    }));
  };

  // ── Detail modal actions ──────────────────────────────────────────
  const submitReport = async () => {
    if (!detail) return;
    try {
      const data = await svcReportECG(detail._id, {
        rhythm: detail.rhythm,
        heartRate: detail.heartRate,
        prInterval: detail.prInterval,
        qrsDuration: detail.qrsDuration,
        qtInterval: detail.qtInterval,
        qtcInterval: detail.qtcInterval,
        axis: detail.axis,
        stChanges: detail.stChanges,
        leadsAffected: detail.leadsAffected || [],
        interpretation: detail.interpretation,
        reportedByName: detail.reportedByName,
      });
      toast.success("Report filed");
      setDetail(data?.data || null);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to file report");
    }
  };

  const submitReview = async () => {
    if (!detail) return;
    try {
      const data = await svcReviewECG(detail._id, {
        reviewedByName: detail.reviewedByName,
        reviewNotes: detail.reviewNotes,
      });
      toast.success("Review filed");
      setDetail(data?.data || null);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to file review");
    }
  };

  // ── Status badge helper ───────────────────────────────────────────
  const statusBadge = (r) => {
    if (r.criticalFlag) return <Badge value="CRITICAL" palette="red" />;
    if (r.abnormalFlag) return <Badge value="ABNORMAL" palette="orange" />;
    return <Badge value="NORMAL" palette="green" />;
  };

  const statusStageBadge = (s) => {
    if (s === "Reviewed") return <Badge value="REVIEWED" palette="green" />;
    if (s === "Reported") return <Badge value="REPORTED" palette="blue" />;
    return <Badge value="PENDING" palette="muted" />;
  };

  const totalCritical = useMemo(() => rows.filter((r) => r.criticalFlag).length, [rows]);
  const totalAbnormal = useMemo(() => rows.filter((r) => r.abnormalFlag).length, [rows]);

  return (
    <AdminPage>
      <Hero
        icon="pi-bolt"
        title="ECG Register"
        subtitle="NABH AAC.4 / IPSG.2 / COP.7 — chronological log of every 12-lead / Holter ECG performed in the facility, with critical-rhythm flagging and cardiologist sign-off."
        color="blue"
      />

      {/* ── Filters ───────────────────────────────────────────────── */}
      <Card title="Filters">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, width: 160 }} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ ...inputStyle, width: 160 }} />
          </div>
          <div>
            <label style={labelStyle}>UHID</label>
            <input value={uhidFilter} onChange={(e) => setUhidFilter(e.target.value)}
              placeholder="Filter by UHID" style={{ ...inputStyle, width: 180 }} />
          </div>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
            Critical only
          </label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />
            Abnormal only
          </label>
          <div style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.text }}>{rows.length}</strong> entries
            {totalCritical > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalCritical} critical</span></>}
            {totalAbnormal > 0 && <> · <span style={{ color: "#ea580c", fontWeight: 600 }}>{totalAbnormal} abnormal</span></>}
          </div>
        </div>
      </Card>

      {/* ── Quick-entry (collapsible) ─────────────────────────────── */}
      <Card>
        <button
          type="button"
          onClick={() => setEntryOpen((v) => !v)}
          style={{
            width: "100%", textAlign: "left", padding: "8px 4px", background: "transparent",
            border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, color: C.text,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <i className={`pi ${entryOpen ? "pi-chevron-down" : "pi-chevron-right"}`} style={{ fontSize: 12 }} />
          <span>Quick Entry — Record an ECG</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontWeight: 500 }}>
            {entryOpen ? "Hide" : "Show"}
          </span>
        </button>

        {entryOpen && (
          <div style={{ marginTop: 12 }}>
            {/* UHID lookup */}
            <div style={{ display: "flex", gap: 12, alignItems: "end", marginBottom: 12 }}>
              <div style={{ flex: "0 0 200px" }}>
                <label style={labelStyle}>UHID *</label>
                <input
                  value={entry.UHID}
                  onChange={(e) => setEntry((p) => ({ ...p, UHID: e.target.value.toUpperCase() }))}
                  onBlur={(e) => lookupPatient(e.target.value)}
                  placeholder="UHID000001"
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={() => lookupPatient(entry.UHID)}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.blue}`,
                  background: "#fff", color: C.blue, cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}
              >
                <i className="pi pi-search" style={{ marginRight: 6 }} />Lookup
              </button>
              {patientLookup && (
                <div style={{
                  flex: 1, padding: "6px 12px", borderRadius: 6,
                  background: "#eff6ff", border: `1px solid #bfdbfe`,
                  fontSize: 13,
                }}>
                  <strong>{patientLookup.fullName || patientLookup.name}</strong>{" "}
                  <span style={{ color: C.muted }}>· {patientLookup.UHID}</span>{" "}
                  {patientLookup.age && <span style={{ color: C.muted }}> · {patientLookup.age} y</span>}
                  {patientLookup.gender && <span style={{ color: C.muted }}> · {patientLookup.gender}</span>}
                </div>
              )}
            </div>

            {/* ECG metadata */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Performed at *</label>
                <input type="datetime-local" value={entry.performedAt}
                  onChange={(e) => setEntry((p) => ({ ...p, performedAt: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Location</label>
                <select value={entry.location}
                  onChange={(e) => setEntry((p) => ({ ...p, location: e.target.value }))}
                  style={inputStyle}>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Lead type</label>
                <select value={entry.leadType}
                  onChange={(e) => setEntry((p) => ({ ...p, leadType: e.target.value }))}
                  style={inputStyle}>
                  {LEAD_TYPES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Indication category</label>
                <select value={entry.indicationCategory}
                  onChange={(e) => setEntry((p) => ({ ...p, indicationCategory: e.target.value }))}
                  style={inputStyle}>
                  {INDICATION_CATEGORIES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Indication (clinical reason)</label>
              <input value={entry.indication}
                onChange={(e) => setEntry((p) => ({ ...p, indication: e.target.value }))}
                placeholder="e.g. Chest pain since 2 hr, post-MI day 1, pre-op workup"
                style={inputStyle} />
            </div>

            {/* Findings */}
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>
              Findings <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>(optional — file later via Report)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Rhythm</label>
                <select value={entry.rhythm}
                  onChange={(e) => setEntry((p) => ({ ...p, rhythm: e.target.value }))}
                  style={inputStyle}>
                  {RHYTHMS.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>HR (bpm)</label>
                <input type="number" min={0} max={300} value={entry.heartRate}
                  onChange={(e) => setEntry((p) => ({ ...p, heartRate: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>PR (ms)</label>
                <input type="number" value={entry.prInterval}
                  onChange={(e) => setEntry((p) => ({ ...p, prInterval: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>QRS (ms)</label>
                <input type="number" value={entry.qrsDuration}
                  onChange={(e) => setEntry((p) => ({ ...p, qrsDuration: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>QT (ms)</label>
                <input type="number" value={entry.qtInterval}
                  onChange={(e) => setEntry((p) => ({ ...p, qtInterval: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>QTc (ms)</label>
                <input type="number" value={entry.qtcInterval}
                  onChange={(e) => setEntry((p) => ({ ...p, qtcInterval: e.target.value }))}
                  style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Axis</label>
                <select value={entry.axis}
                  onChange={(e) => setEntry((p) => ({ ...p, axis: e.target.value }))}
                  style={inputStyle}>
                  {AXES.map((a) => <option key={a} value={a}>{a || "—"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>ST-T changes</label>
                <select value={entry.stChanges}
                  onChange={(e) => setEntry((p) => ({ ...p, stChanges: e.target.value }))}
                  style={inputStyle}>
                  {ST_CHANGES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Leads affected</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {ALL_LEADS.map((lead) => {
                    const active = entry.leadsAffected.includes(lead);
                    return (
                      <button
                        key={lead}
                        type="button"
                        onClick={() => toggleLead(lead)}
                        style={{
                          padding: "3px 8px", borderRadius: 12, fontSize: 11,
                          border: `1px solid ${active ? C.blue : C.border}`,
                          background: active ? C.blue : "#fff",
                          color: active ? "#fff" : C.text,
                          cursor: "pointer", fontWeight: 600,
                        }}
                      >{lead}</button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Interpretation</label>
              <textarea value={entry.interpretation}
                onChange={(e) => setEntry((p) => ({ ...p, interpretation: e.target.value }))}
                placeholder="Free-text reading (max 2000 chars)"
                rows={3}
                style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Performed by</label>
                <input value={entry.performedByName}
                  onChange={(e) => setEntry((p) => ({ ...p, performedByName: e.target.value }))}
                  placeholder="Tech / nurse name"
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Reported by</label>
                <input value={entry.reportedByName}
                  onChange={(e) => setEntry((p) => ({ ...p, reportedByName: e.target.value }))}
                  placeholder="Reading clinician name"
                  style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => { setEntry({ ...blankEntry }); setPatientLookup(null); }}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`,
                  background: "#fff", color: C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}
              >Clear</button>
              <button
                type="button"
                onClick={submitEntry}
                disabled={submitting || !entry.UHID}
                style={{
                  padding: "6px 18px", borderRadius: 6, border: `1px solid ${C.blue}`,
                  background: submitting || !entry.UHID ? C.border : C.blue,
                  color: "#fff", cursor: submitting || !entry.UHID ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 13,
                }}
              >
                {submitting ? "Saving..." : "Save ECG"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Card title={`ECG Register · ${rows.length} entries`}>
        <Table cols={["ECG #", "Performed", "UHID", "Patient", "Loc", "Indication", "Rhythm", "HR", "Flag", "Stage", "TAT", "By"]}>
          {rows.length === 0 ? (
            <EmptyRow span={12} text={loading ? "Loading…" : "No ECGs in this range"} />
          ) : rows.map((r) => (
            <tr
              key={r._id}
              onClick={() => setDetail({ ...r })}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <td style={tdStyle}><strong>{r.ecgNumber || "—"}</strong></td>
              <td style={tdStyle}>{fmt(r.performedAt)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}</td>
              <td style={tdStyle}>{r.location}</td>
              <td style={tdStyle}>
                <Badge value={r.indicationCategory || "Other"} palette="muted" />
                {r.indication ? <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{r.indication.slice(0, 40)}</div> : null}
              </td>
              <td style={tdStyle}>{r.rhythm ? <Badge value={r.rhythm} palette={r.criticalFlag ? "red" : r.rhythm === "NSR" ? "green" : "orange"} /> : "—"}</td>
              <td style={tdStyle}>{r.heartRate ?? "—"}</td>
              <td style={tdStyle}>{statusBadge(r)}</td>
              <td style={tdStyle}>{statusStageBadge(r.status)}</td>
              <td style={tdStyle}>{r.tatPerformedToReportedMin != null ? `${r.tatPerformedToReportedMin}m` : "—"}</td>
              <td style={tdStyle}>{r.performedByName || "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* ── Detail modal ──────────────────────────────────────────── */}
      {detail && (
        <ECGDetailModal
          ecg={detail}
          onClose={() => setDetail(null)}
          onChange={(patch) => setDetail((p) => ({ ...p, ...patch }))}
          onReport={submitReport}
          onReview={submitReview}
        />
      )}
    </AdminPage>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Detail modal — full row + report / review actions + audit trail
// ─────────────────────────────────────────────────────────────────────────
function ECGDetailModal({ ecg, onClose, onChange, onReport, onReview }) {
  const editable = !ecg.isLocked;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, padding: 20, maxWidth: 900,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
              {ecg.ecgNumber || "ECG"} <span style={{ color: C.muted, fontWeight: 400, fontSize: 14 }}>· {ecg.patientName} · {ecg.UHID}</span>
            </div>
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              {ecg.criticalFlag && <Badge value="CRITICAL" palette="red" />}
              {ecg.abnormalFlag && !ecg.criticalFlag && <Badge value="ABNORMAL" palette="orange" />}
              <Badge value={ecg.status} palette={ecg.status === "Reviewed" ? "green" : ecg.status === "Reported" ? "blue" : "muted"} />
              {ecg.sourceType === "DoctorOrder" && <Badge value="from Order" palette="muted" />}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, cursor: "pointer",
              fontSize: 12, fontWeight: 600,
            }}
          >✕ Close</button>
        </div>

        {/* Patient + metadata */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14, fontSize: 12 }}>
          <div><span style={{ color: C.muted }}>Age/Sex</span><div>{[ecg.age, ecg.sex].filter(Boolean).join(" / ") || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Performed at</span><div>{ecg.performedAt ? new Date(ecg.performedAt).toLocaleString("en-IN") : "—"}</div></div>
          <div><span style={{ color: C.muted }}>Location</span><div>{ecg.location}</div></div>
          <div><span style={{ color: C.muted }}>Lead type</span><div>{ecg.leadType}</div></div>
          <div><span style={{ color: C.muted }}>Indication category</span><div>{ecg.indicationCategory}</div></div>
          <div style={{ gridColumn: "span 3" }}><span style={{ color: C.muted }}>Indication</span><div>{ecg.indication || "—"}</div></div>
        </div>

        {/* Findings (editable when not locked + status != Reviewed) */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 8 }}>
          Findings {!editable && <span style={{ fontSize: 11, color: "#dc2626" }}>(locked)</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Rhythm</label>
            <select value={ecg.rhythm || ""} disabled={!editable}
              onChange={(e) => onChange({ rhythm: e.target.value })}
              style={inputStyle}>
              {RHYTHMS.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>HR</label>
            <input type="number" value={ecg.heartRate ?? ""} disabled={!editable}
              onChange={(e) => onChange({ heartRate: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>PR</label>
            <input type="number" value={ecg.prInterval ?? ""} disabled={!editable}
              onChange={(e) => onChange({ prInterval: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>QRS</label>
            <input type="number" value={ecg.qrsDuration ?? ""} disabled={!editable}
              onChange={(e) => onChange({ qrsDuration: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>QT</label>
            <input type="number" value={ecg.qtInterval ?? ""} disabled={!editable}
              onChange={(e) => onChange({ qtInterval: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>QTc</label>
            <input type="number" value={ecg.qtcInterval ?? ""} disabled={!editable}
              onChange={(e) => onChange({ qtcInterval: e.target.value })}
              style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Axis</label>
            <select value={ecg.axis || ""} disabled={!editable}
              onChange={(e) => onChange({ axis: e.target.value })}
              style={inputStyle}>
              {AXES.map((a) => <option key={a} value={a}>{a || "—"}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>ST-T</label>
            <select value={ecg.stChanges || ""} disabled={!editable}
              onChange={(e) => onChange({ stChanges: e.target.value })}
              style={inputStyle}>
              {ST_CHANGES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Leads affected</label>
            <div style={{ fontSize: 12, color: C.text, padding: 6 }}>
              {(ecg.leadsAffected || []).join(", ") || "—"}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Interpretation</label>
          <textarea value={ecg.interpretation || ""} disabled={!editable}
            onChange={(e) => onChange({ interpretation: e.target.value })}
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
        </div>

        {/* Personnel */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14, fontSize: 12 }}>
          <div>
            <label style={labelStyle}>Performed by</label>
            <div>{ecg.performedByName || "—"}</div>
          </div>
          <div>
            <label style={labelStyle}>Reported by</label>
            <input value={ecg.reportedByName || ""} disabled={!editable}
              onChange={(e) => onChange({ reportedByName: e.target.value })}
              placeholder="Name"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Reviewed by (cardiologist)</label>
            <input value={ecg.reviewedByName || ""} disabled={!editable}
              onChange={(e) => onChange({ reviewedByName: e.target.value })}
              placeholder="Cardiologist name"
              style={inputStyle} />
          </div>
        </div>
        {editable && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Review notes</label>
            <textarea value={ecg.reviewNotes || ""}
              onChange={(e) => onChange({ reviewNotes: e.target.value })}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
          </div>
        )}

        {/* Action buttons */}
        {editable && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 14 }}>
            <button
              type="button"
              onClick={onReport}
              style={{
                padding: "6px 16px", borderRadius: 6, border: `1px solid ${C.blue}`,
                background: C.blue, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
              }}
            >
              <i className="pi pi-save" style={{ marginRight: 6 }} />File Report
            </button>
            <button
              type="button"
              onClick={onReview}
              disabled={ecg.status !== "Reported" && ecg.status !== "Reviewed"}
              title={ecg.status === "PendingReport" ? "File report first" : "Cardiologist sign-off"}
              style={{
                padding: "6px 16px", borderRadius: 6, border: `1px solid #16a34a`,
                background: ecg.status === "PendingReport" ? C.border : "#16a34a",
                color: "#fff",
                cursor: ecg.status === "PendingReport" ? "not-allowed" : "pointer",
                fontWeight: 700, fontSize: 13,
              }}
            >
              <i className="pi pi-check-circle" style={{ marginRight: 6 }} />Cardiologist Review
            </button>
          </div>
        )}

        {/* TAT info */}
        <div style={{
          padding: 10, borderRadius: 6, background: "#f8fafc",
          fontSize: 12, color: C.muted, marginBottom: 14, display: "flex", gap: 20,
        }}>
          <div><strong>Order → Performed:</strong> {ecg.tatOrderToPerformedMin != null ? `${ecg.tatOrderToPerformedMin} min` : "—"}</div>
          <div><strong>Performed → Reported:</strong> {ecg.tatPerformedToReportedMin != null ? `${ecg.tatPerformedToReportedMin} min` : "—"}</div>
          <div><strong>Reported at:</strong> {ecg.reportedAt ? new Date(ecg.reportedAt).toLocaleString("en-IN") : "—"}</div>
        </div>

        {/* Audit trail */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>Audit Trail</div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          {(ecg.auditTrail || []).length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>No audit entries</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>When</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>Action</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>By</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {(ecg.auditTrail || []).map((a, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{a.at ? new Date(a.at).toLocaleString("en-IN") : "—"}</td>
                    <td style={tdStyle}>
                      <Badge value={a.action}
                        palette={a.action === "CRITICAL_FLAGGED" ? "red"
                          : a.action === "REVIEWED" ? "green"
                          : a.action === "REPORTED" ? "blue" : "muted"} />
                    </td>
                    <td style={tdStyle}>{a.byName || "—"}{a.byRole ? <div style={{ fontSize: 10, color: C.muted }}>{a.byRole}</div> : null}</td>
                    <td style={tdStyle}>{a.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
