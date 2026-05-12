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

      <div className="rx-search rx-mb-12">
        <i className="pi pi-search" />
        <input
          ref={inputRef}
          placeholder="Search by name, UHID (e.g. UH0001), mobile (10 digit)…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        {loading && <i className="pi pi-spin pi-spinner rx-spinner-info" />}
        {q && !loading && <button className="rx-action-btn" onClick={() => setQ("")}><i className="pi pi-times" /></button>}
      </div>

      <div className={`rx-search-layout ${selected ? "rx-search-layout--with-panel" : ""}`}>
        {/* ─── Results column ───────────────────────────────── */}
        <div>
          {empty ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">🔍</span>
              Start typing to search patients
              <div className="rx-empty-tip">
                Tip: enter at least 2 characters — name, UHID number, or mobile number.
              </div>
            </div>
          ) : loading ? (
            <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
          ) : results.length === 0 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">😶</span>
              No match for <strong>"{q}"</strong>
              <div className="rx-mt-10">
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
                    {p.registrationType && <span className="rx-mono-tag">{p.registrationType}</span>}
                  </div>
                  <div className="rx-mini-meta">
                    <span>UHID: <strong>{p.UHID}</strong></span>
                    <span>{ageGenderLine(p)}</span>
                    {p.contactNumber && <span>📱 <strong>{p.contactNumber}</strong></span>}
                    {p.bloodGroup && <span>🩸 <strong>{p.bloodGroup}</strong></span>}
                    {p.department && <span>Dept: <strong>{typeof p.department === "object" ? p.department.name : p.department}</strong></span>}
                  </div>
                </div>
                <div className="rx-flex-row">
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
    <div className="rx-summary-panel">
      <div className="rx-summary-head">
        <div className="rx-mini-avatar">{initials(p.fullName)}</div>
        <div className="rx-flex-1">
          <div className="rx-summary-name">{p.fullName}</div>
          <div className="rx-summary-meta">UHID: <strong>{p.UHID}</strong> · {ageGenderLine(p)}</div>
        </div>
        <button className="rx-action-btn" onClick={onClose}><i className="pi pi-times" /></button>
      </div>

      <div className="rx-summary-grid">
        {p.contactNumber && <div>📱 <strong>{p.contactNumber}</strong></div>}
        {p.email && <div>✉ <strong>{p.email}</strong></div>}
        {p.bloodGroup && <div>🩸 <strong>{p.bloodGroup}</strong></div>}
        {p.maritalStatus && <div>💍 <strong>{p.maritalStatus}</strong></div>}
        {addr && <div className="rx-grid-full-row">🏠 <strong>{addr}</strong></div>}
        {p.knownAllergies && <div className="rx-grid-full-row rx-text-danger">⚠ Allergies: <strong>{p.knownAllergies}</strong></div>}
      </div>

      {/* Visit counters */}
      <div className="rx-counter-row">
        <CounterTile label="OPD" value={p.totalOPDVisits || 0} variant="opd" />
        <CounterTile label="IPD" value={p.totalIPDVisits || 0} variant="ipd" />
        <CounterTile label="ER"  value={p.totalEmergencyVisits || 0} variant="er" />
      </div>

      {/* Quick actions */}
      <div className="rx-quick-actions">
        <button className="rx-action-btn rx-action-btn--primary rx-action-btn--block"
                onClick={() => navigate(`/reception/register?uhid=${p.UHID}`)}>
          <i className="pi pi-plus" /> New Visit / Registration
        </button>
        <button className="rx-action-btn rx-action-btn--block"
                onClick={() => navigate(`/visit-history/${p.UHID}`)}>
          <i className="pi pi-clock" /> View Visit History
        </button>
        <button className="rx-action-btn rx-action-btn--block"
                onClick={() => navigate(`/reception-billing/${p.UHID}`)}>
          <i className="pi pi-receipt" /> Billing & Payments
        </button>
        {p.contactNumber && (
          <button className="rx-action-btn rx-action-btn--block"
                  onClick={() => {
                    const num = (p.contactNumber || "").replace(/\D/g, "");
                    const phone = num.length === 10 ? `91${num}` : num;
                    window.open(`https://wa.me/${phone}`, "_blank");
                  }}>
            <i className="pi pi-whatsapp rx-wa-icon" /> Open WhatsApp
          </button>
        )}
      </div>
    </div>
  );
}

function CounterTile({ label, value, variant }) {
  return (
    <div className="rx-counter-tile">
      <div className={`rx-counter-tile-value rx-counter-tile-value--${variant}`}>{value}</div>
      <div className="rx-counter-tile-label">{label} VISITS</div>
    </div>
  );
}
