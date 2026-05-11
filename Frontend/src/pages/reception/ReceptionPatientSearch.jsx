/**
 * ReceptionPatientSearch.jsx — Front-desk patient lookup
 *
 * Live-as-you-type search by name / UHID / phone via /api/patients/search.
 * Click a result → side panel with quick actions:
 *   • New OPD/IPD/Emergency visit → /reception/register?uhid=...
 *   • Visit history → /patient-history/:uhid
 *   • Billing → /reception-billing/:uhid
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";

const initials = (name = "") => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0] || "").join("").toUpperCase() || "?";
};

const ageGenderLine = (p) => {
  const bits = [];
  if (p.age != null && p.age !== "") bits.push(`${p.age}y`);
  if (p.gender) bits.push(p.gender);
  return bits.join(" · ");
};

export default function ReceptionPatientSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const inputRef = useRef(null);
  const debRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search (200ms)
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!q || q.trim().length < 2) { setResults([]); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.PATIENTS}/search?q=${encodeURIComponent(q.trim())}&limit=30`
        );
        setResults(data?.data || data || []);
      } catch (e) {
        toast.error(e?.response?.data?.message || "Search failed");
      } finally { setLoading(false); }
    }, 200);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [q]);

  const openFullProfile = async (uhid) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${uhid}`);
      setSelected(data?.data || data);
    } catch (e) {
      toast.error("Could not load patient profile");
    }
  };

  const empty = !q || q.trim().length < 2;

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-search" /> Patient Search</div>
          <div className="rx-header-meta">Search any patient by name, UHID or phone · {empty ? "Type 2+ characters to start" : `${results.length} result${results.length === 1 ? "" : "s"}`}</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-primary" onClick={() => navigate("/reception/register")}>
            <i className="pi pi-user-plus" /> New Registration
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      <div className="rx-search" style={{ marginBottom: 12 }}>
        <i className="pi pi-search" />
        <input
          ref={inputRef}
          placeholder="Search by name, UHID (e.g. UH0001), mobile (10 digit)…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        {loading && <i className="pi pi-spin pi-spinner" style={{ color: "#06b6d4" }} />}
        {q && !loading && <button className="rx-action-btn" onClick={() => setQ("")}><i className="pi pi-times" /></button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0,1fr) 380px" : "1fr", gap: 14 }}>
        {/* ─── Results column ───────────────────────────────── */}
        <div>
          {empty ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">🔍</span>
              Start typing to search patients
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                Tip: enter at least 2 characters — name, UHID number, or mobile number.
              </div>
            </div>
          ) : loading ? (
            <div className="rx-empty"><i className="pi pi-spin pi-spinner" style={{ fontSize: 28 }} /></div>
          ) : results.length === 0 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">😶</span>
              No match for <strong>"{q}"</strong>
              <div style={{ marginTop: 10 }}>
                <button className="rx-btn-primary" onClick={() => navigate(`/reception/register?prefill=${encodeURIComponent(q)}`)}>
                  <i className="pi pi-user-plus" /> Register new patient
                </button>
              </div>
            </div>
          ) : (
            results.map(p => (
              <div
                key={p._id || p.UHID}
                className={`rx-mini-card ${(p.gender === "Female") ? "is-female" : ""}`}
                onClick={() => openFullProfile(p.UHID)}
              >
                <div className="rx-mini-avatar">{initials(p.fullName)}</div>
                <div className="rx-mini-info">
                  <div className="rx-mini-name">
                    {p.fullName || "Unknown"}
                    {p.isMLC && <span className="rx-card-stage rx-card-stage--denied">MLC</span>}
                    {p.tpa && <span className="rx-card-stage rx-card-stage--submitted">TPA</span>}
                    {p.registrationType && <span style={{ fontSize: 10, fontWeight: 700, color: "#0e7490", fontFamily: "DM Mono, monospace" }}>{p.registrationType}</span>}
                  </div>
                  <div className="rx-mini-meta">
                    <span>UHID: <strong>{p.UHID}</strong></span>
                    <span>{ageGenderLine(p)}</span>
                    {p.contactNumber && <span>📱 <strong>{p.contactNumber}</strong></span>}
                    {p.bloodGroup && <span>🩸 <strong>{p.bloodGroup}</strong></span>}
                    {p.department && <span>Dept: <strong>{typeof p.department === "object" ? p.department.name : p.department}</strong></span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="rx-action-btn" onClick={(e) => { e.stopPropagation(); openFullProfile(p.UHID); }}>
                    <i className="pi pi-id-card" /> View
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ─── Side panel (selected patient) ───────────────── */}
        {selected && <PatientSidePanel patient={selected} onClose={() => setSelected(null)} navigate={navigate} />}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */

function PatientSidePanel({ patient: p, onClose, navigate }) {
  const addr = p.address && typeof p.address === "object"
    ? [p.address.completeAddress, p.address.city, p.address.state, p.address.pincode].filter(Boolean).join(", ")
    : p.address || "";

  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
      padding: 16, height: "fit-content", position: "sticky", top: 16
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div className="rx-mini-avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(p.fullName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{p.fullName}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>UHID: <strong>{p.UHID}</strong> · {ageGenderLine(p)}</div>
        </div>
        <button className="rx-action-btn" onClick={onClose}><i className="pi pi-times" /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11, color: "#475569", marginBottom: 12 }}>
        {p.contactNumber && <div>📱 <strong>{p.contactNumber}</strong></div>}
        {p.email && <div>✉ <strong>{p.email}</strong></div>}
        {p.bloodGroup && <div>🩸 <strong>{p.bloodGroup}</strong></div>}
        {p.maritalStatus && <div>💍 <strong>{p.maritalStatus}</strong></div>}
        {addr && <div style={{ gridColumn: "1/-1" }}>🏠 <strong>{addr}</strong></div>}
        {p.knownAllergies && <div style={{ gridColumn: "1/-1", color: "#b91c1c" }}>⚠ Allergies: <strong>{p.knownAllergies}</strong></div>}
      </div>

      {/* Visit counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
        <CounterTile label="OPD" value={p.totalOPDVisits || 0} color="#0e7490" />
        <CounterTile label="IPD" value={p.totalIPDVisits || 0} color="#6d28d9" />
        <CounterTile label="ER"  value={p.totalEmergencyVisits || 0} color="#b91c1c" />
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="rx-action-btn rx-action-btn--primary" style={{ justifyContent: "center" }}
                onClick={() => navigate(`/reception/register?uhid=${p.UHID}`)}>
          <i className="pi pi-plus" /> New Visit / Registration
        </button>
        <button className="rx-action-btn" style={{ justifyContent: "center" }}
                onClick={() => navigate(`/visit-history/${p.UHID}`)}>
          <i className="pi pi-clock" /> View Visit History
        </button>
        <button className="rx-action-btn" style={{ justifyContent: "center" }}
                onClick={() => navigate(`/reception-billing/${p.UHID}`)}>
          <i className="pi pi-receipt" /> Billing & Payments
        </button>
        {p.contactNumber && (
          <button className="rx-action-btn" style={{ justifyContent: "center" }}
                  onClick={() => {
                    const num = (p.contactNumber || "").replace(/\D/g, "");
                    const phone = num.length === 10 ? `91${num}` : num;
                    window.open(`https://wa.me/${phone}`, "_blank");
                  }}>
            <i className="pi pi-whatsapp" style={{ color: "#22c55e" }} /> Open WhatsApp
          </button>
        )}
      </div>
    </div>
  );
}

function CounterTile({ label, value, color }) {
  return (
    <div style={{
      background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
      padding: "8px 6px", textAlign: "center"
    }}>
      <div style={{ fontSize: 18, fontWeight: 900, color, fontFamily: "DM Mono, monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>{label} VISITS</div>
    </div>
  );
}
