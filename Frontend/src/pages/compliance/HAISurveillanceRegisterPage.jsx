/**
 * HAISurveillanceRegisterPage.jsx — R7gw-B9-T05 / NABH HIC.4
 *
 * Surveyor + IC-officer facing chronological log of every Healthcare-
 * Associated Infection (HAI) event captured in the facility. Auto-
 * populated from the ICU-bundle finalize path when CAUTI compliance <100
 * AND Foley dwell>3d AND a positive UTI culture is present; manual rows
 * (SSI / CDI / MRSA-Bacteremia) added via the "Add Entry" button.
 *
 *   URL: /compliance/nabh-registers/haisurveillance
 *
 * Role-gated to Admin / Doctor / Nurse / MRD (same surveyor cohort that
 * accesses the rest of the NABH register surface; matches the
 * compliance.nabh.read permission tier).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

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

// Enum lists — keep in lock-step with HAISurveillanceRegisterModel.js
const HAI_TYPES = ["", "CAUTI", "CLABSI", "VAP", "SSI", "CDI", "MRSA-Bacteremia"];
const STATUSES  = ["", "Open", "InProgress", "Closed"];
const OUTCOMES  = ["", "Resolved", "Complicated", "Death"];

const tdStyle    = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const inputStyle = { padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle = { fontSize: 11, color: C.muted, display: "block", marginBottom: 2 };

const blankEntry = {
  UHID: "",
  patientId: "",
  patientName: "",
  admissionId: "",
  HAIType: "CAUTI",
  onsetDate: new Date().toISOString().slice(0, 16),
  identifiedByEmpId: "",
  deviceDays: "",
  cultureSent: false,
  organismIsolated: "",
  antibioticPrescribed: "",
  outcome: "",
  status: "Open",
};

const haiPalette = (type) => {
  switch (type) {
    case "CAUTI":
    case "CLABSI":
    case "VAP": return "red";
    case "SSI": return "orange";
    case "CDI": return "purple";
    case "MRSA-Bacteremia": return "pink";
    default: return "muted";
  }
};

const statusPalette = (status) => {
  switch (status) {
    case "Open": return "red";
    case "InProgress": return "orange";
    case "Closed": return "green";
    default: return "muted";
  }
};

const outcomePalette = (outcome) => {
  switch (outcome) {
    case "Resolved": return "green";
    case "Complicated": return "orange";
    case "Death": return "red";
    default: return "muted";
  }
};

export default function HAISurveillanceRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(90));
  const [endDate, setEndDate] = useState(todayISO());
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [haiTypeFilter, setHaiTypeFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");

  // Add-entry modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [entry, setEntry] = useState({ ...blankEntry });
  const [submitting, setSubmitting] = useState(false);
  const [patientLookup, setPatientLookup] = useState(null);

  // ── Fetch list ────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      if (statusFilter) params.set("status", statusFilter);
      if (haiTypeFilter) params.set("HAIType", haiTypeFilter);
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      params.set("limit", "500");
      const r = await axios.get(`${API}/nabh-registers/hai-surveillance?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load HAI Surveillance register");
    }
    setLoading(false);
  }, [startDate, endDate, q, statusFilter, haiTypeFilter, outcomeFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── UHID → patient lookup for the manual-entry modal ─────────────
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

  // ── Submit a manual HAI surveillance row ─────────────────────────
  const submitEntry = async () => {
    if (!entry.UHID) { toast.warn("Enter UHID"); return; }
    if (!entry.HAIType) { toast.warn("Pick an HAI type"); return; }
    setSubmitting(true);
    try {
      const payload = {
        UHID: entry.UHID,
        patientId: entry.patientId || null,
        patientName: entry.patientName || "",
        admissionId: entry.admissionId || null,
        HAIType: entry.HAIType,
        onsetDate: entry.onsetDate || new Date().toISOString(),
        identifiedByEmpId: entry.identifiedByEmpId || "",
        deviceDays: entry.deviceDays !== "" ? Number(entry.deviceDays) : null,
        cultureSent: !!entry.cultureSent,
        organismIsolated: entry.organismIsolated || "",
        antibioticPrescribed: entry.antibioticPrescribed || "",
        outcome: entry.outcome || "",
        status: entry.status || "Open",
      };
      const r = await axios.post(`${API}/nabh-registers/hai-surveillance`, payload, authHdr());
      toast.success(`HAI surveillance row saved · ${r.data?.data?._id || "OK"}`);
      setEntry({ ...blankEntry });
      setPatientLookup(null);
      setModalOpen(false);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save HAI surveillance row");
    }
    setSubmitting(false);
  };

  // ── Counters for the filter strip ────────────────────────────────
  const totalOpen      = useMemo(() => rows.filter((r) => r.status === "Open").length, [rows]);
  const totalLinkedICU = useMemo(() => rows.filter((r) => r.linkedICUBundleId).length, [rows]);

  return (
    <AdminPage>
      <Hero
        icon="pi-shield"
        title="HAI Surveillance Register"
        subtitle="NABH HIC.4 — every Healthcare-Associated Infection event captured in the facility: CAUTI / CLABSI / VAP / SSI / CDI / MRSA-Bacteremia. Auto-emitted when the ICU CAUTI bundle breaches with a positive UTI culture; manual entries for other HAI types."
        color="purple"
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
            <label style={labelStyle}>Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="UHID / patient / organism / antibiotic"
              style={{ ...inputStyle, width: 260 }} />
          </div>
          <div>
            <label style={labelStyle}>HAI Type</label>
            <select value={haiTypeFilter} onChange={(e) => setHaiTypeFilter(e.target.value)} style={{ ...inputStyle, width: 160 }}>
              {HAI_TYPES.map((t) => <option key={t} value={t}>{t || "All"}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 140 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Outcome</label>
            <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} style={{ ...inputStyle, width: 140 }}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o || "All"}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => { setEntry({ ...blankEntry }); setPatientLookup(null); setModalOpen(true); }}
              style={{
                padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.purple}`,
                background: C.purple, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
              }}
            >
              <i className="pi pi-plus" style={{ marginRight: 6 }} />Add Entry
            </button>
          </div>
          <div style={{ width: "100%", fontSize: 12, color: C.muted, marginTop: 4 }}>
            <strong style={{ color: C.text }}>{rows.length}</strong> events
            {totalOpen > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalOpen} open</span></>}
            {totalLinkedICU > 0 && <> · <span style={{ color: C.purple, fontWeight: 600 }}>{totalLinkedICU} from ICU bundle</span></>}
          </div>
        </div>
      </Card>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Card title={`HAI Surveillance · ${rows.length} events`}>
        <Table cols={["Onset", "UHID", "Patient", "HAI Type", "Device-days", "Organism", "Antibiotic", "Outcome", "Status", "Identified by", "Linked"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No HAI surveillance events in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}>{fmt(r.onsetDate)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName || "—"}</td>
              <td style={tdStyle}><Badge value={r.HAIType} palette={haiPalette(r.HAIType)} /></td>
              <td style={tdStyle}>{r.deviceDays != null ? `${r.deviceDays} d` : "—"}</td>
              <td style={tdStyle}>{r.organismIsolated || "—"}{r.cultureSent ? <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Culture sent</div> : null}</td>
              <td style={tdStyle}>{r.antibioticPrescribed || "—"}</td>
              <td style={tdStyle}>{r.outcome ? <Badge value={r.outcome} palette={outcomePalette(r.outcome)} /> : "—"}</td>
              <td style={tdStyle}><Badge value={r.status} palette={statusPalette(r.status)} /></td>
              <td style={tdStyle}>{r.identifiedByEmpId || "—"}</td>
              <td style={tdStyle}>{r.linkedICUBundleId ? <Badge value="ICU bundle" palette="purple" /> : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* ── Add-Entry modal ───────────────────────────────────────── */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 10, padding: 20, maxWidth: 760,
              width: "100%", maxHeight: "90vh", overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                  New HAI Surveillance Entry
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  NABH HIC.4 — IC officer surface for SSI / CDI / MRSA events surfaced outside the ICU bundle path.
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                  background: "#fff", color: C.muted, cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                }}
              >✕ Close</button>
            </div>

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
                  padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.purple}`,
                  background: "#fff", color: C.purple, cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}
              >
                <i className="pi pi-search" style={{ marginRight: 6 }} />Lookup
              </button>
              {patientLookup && (
                <div style={{
                  flex: 1, padding: "6px 12px", borderRadius: 6,
                  background: "#f5f3ff", border: `1px solid #ddd6fe`,
                  fontSize: 13,
                }}>
                  <strong>{patientLookup.fullName || patientLookup.name}</strong>{" "}
                  <span style={{ color: C.muted }}>· {patientLookup.UHID}</span>{" "}
                  {patientLookup.age && <span style={{ color: C.muted }}> · {patientLookup.age} y</span>}
                  {patientLookup.gender && <span style={{ color: C.muted }}> · {patientLookup.gender}</span>}
                </div>
              )}
            </div>

            {/* Core fields */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>HAI Type *</label>
                <select value={entry.HAIType}
                  onChange={(e) => setEntry((p) => ({ ...p, HAIType: e.target.value }))}
                  style={inputStyle}>
                  {HAI_TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Onset date *</label>
                <input type="datetime-local" value={entry.onsetDate}
                  onChange={(e) => setEntry((p) => ({ ...p, onsetDate: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Device days</label>
                <input type="number" min={0} value={entry.deviceDays}
                  onChange={(e) => setEntry((p) => ({ ...p, deviceDays: e.target.value }))}
                  placeholder="e.g. 4"
                  style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Identified by (Emp ID / name)</label>
                <input value={entry.identifiedByEmpId}
                  onChange={(e) => setEntry((p) => ({ ...p, identifiedByEmpId: e.target.value }))}
                  placeholder="IC officer / lab tech"
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={entry.status}
                  onChange={(e) => setEntry((p) => ({ ...p, status: e.target.value }))}
                  style={inputStyle}>
                  {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Culture + drug */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Organism isolated</label>
                <input value={entry.organismIsolated}
                  onChange={(e) => setEntry((p) => ({ ...p, organismIsolated: e.target.value }))}
                  placeholder="e.g. E. coli ESBL"
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Antibiotic prescribed</label>
                <input value={entry.antibioticPrescribed}
                  onChange={(e) => setEntry((p) => ({ ...p, antibioticPrescribed: e.target.value }))}
                  placeholder="e.g. Meropenem 1g IV q8h"
                  style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Outcome</label>
                <select value={entry.outcome}
                  onChange={(e) => setEntry((p) => ({ ...p, outcome: e.target.value }))}
                  style={inputStyle}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, alignSelf: "end" }}>
                <input type="checkbox" checked={entry.cultureSent}
                  onChange={(e) => setEntry((p) => ({ ...p, cultureSent: e.target.checked }))} />
                Culture sent to lab
              </label>
            </div>

            {/* Action buttons */}
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
                disabled={submitting || !entry.UHID || !entry.HAIType}
                style={{
                  padding: "6px 18px", borderRadius: 6, border: `1px solid ${C.purple}`,
                  background: submitting || !entry.UHID || !entry.HAIType ? C.border : C.purple,
                  color: "#fff",
                  cursor: submitting || !entry.UHID || !entry.HAIType ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 13,
                }}
              >
                {submitting ? "Saving..." : "Save Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
