/**
 * ReceptionBedView.jsx — Visual bed occupancy (receptionist view)
 *
 * Read-only tile grid grouped by Building → Floor → Ward.
 * Each bed shows status + occupant (patient name, UHID, age,
 * admitted on, expected discharge).
 *
 * Filter by building / ward / status. Click bed → quick panel.
 *
 * NO admit / transfer / discharge actions here — those live in
 * Bed Management for nurses.
 *
 * API: GET /api/bedss?status=&building=&ward=
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const daysBetween = (a, b) => {
  if (!a) return 0;
  const ms = (b ? new Date(b) : new Date()) - new Date(a);
  return Math.max(0, Math.floor(ms / 86400000));
};

const STATUSES = ["Available", "Occupied", "Reserved", "Maintenance", "Blocked"];
const STATUS_TONE = {
  Available: "available", Occupied: "occupied",
  Maintenance: "maintenance", Reserved: "reserved", Blocked: "blocked",
};

export default function ReceptionBedView() {
  const navigate = useNavigate();
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  // Always fetch ALL beds so the KPI strip can show the full breakdown.
  // Filtering by status happens client-side in `grouped`.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BEDS}`);
      setBeds(data?.data || data || []);
    } catch (e) {
      toast.error("Could not load beds");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  // KPI counts (across all beds, ignoring statusFilter)
  const counts = useMemo(() => {
    const acc = { total: beds.length };
    STATUSES.forEach(s => acc[s] = 0);
    beds.forEach(b => { if (acc[b.status] != null) acc[b.status]++; });
    return acc;
  }, [beds]);

  const occupancy = counts.total ? Math.round((counts.Occupied / counts.total) * 100) : 0;

  // Group: Building → Floor → Ward → beds
  // bedsModel stores denormalised buildingName/floorNumber/wardName/roomNumber,
  // so we read those directly rather than relying on populate.
  const grouped = useMemo(() => {
    const s = search.trim().toLowerCase();
    const tree = {}; // building → floor → ward → []
    beds.forEach(b => {
      if (statusFilter && b.status !== statusFilter) return;
      if (s) {
        const patientName = b.currentAdmission?.patientId?.fullName || "";
        const patientUHID = b.currentAdmission?.patientId?.UHID || "";
        const hay = `${b.bedNumber} ${patientName} ${patientUHID}`.toLowerCase();
        if (!hay.includes(s)) return;
      }
      const bldg = b.buildingName || b.building?.buildingName || b.building?.name || "Main Building";
      const flrNum = b.floorNumber ?? b.floor?.floorNumber;
      const flr  = flrNum != null && flrNum !== "" ? `Floor ${flrNum}` : (b.floor?.name || "Ground Floor");
      const ward = b.wardName || b.ward?.wardName || b.ward?.name || "—";
      (tree[bldg] ||= {});
      (tree[bldg][flr] ||= {});
      (tree[bldg][flr][ward] ||= []).push(b);
    });
    return tree;
  }, [beds, statusFilter, search]);

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-table" /> Bed Visual Layout</div>
          <div className="rx-header-meta">Live occupancy · {counts.Occupied}/{counts.total} beds occupied ({occupancy}%) · Auto-refresh 60s</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => navigate("/reception/register?type=IPD")}>
            <i className="pi pi-plus" /> New IPD Admission
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* KPI strip — clickable to filter by status */}
      <div className="rx-kpis">
        <div className="rx-kpi rx-kpi--accent rx-kpi-tile--filtering rx-kpi-clickable" onClick={() => setStatusFilter("")}>
          <div className="rx-kpi-label">Total Beds</div>
          <div className="rx-kpi-value">{counts.total}</div>
          {!statusFilter && <div className="rx-kpi-sub rx-kpi-active">✓ all</div>}
        </div>
        {STATUSES.map(s => {
          const variant = s.toLowerCase();
          return (
            <div key={s}
                 className={`rx-kpi rx-kpi-tile--${variant} ${statusFilter === s ? "rx-kpi-tile--filtering" : ""}`}
                 onClick={() => setStatusFilter(statusFilter === s ? "" : s)}>
              <div className="rx-kpi-label">{s}</div>
              <div className="rx-kpi-value">{counts[s] || 0}</div>
              {statusFilter === s && <div className="rx-kpi-sub rx-kpi-active">✓ filtering</div>}
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search bed number, patient name or UHID…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🛏️</span>
          No beds match the current filters
        </div>
      ) : (
        Object.entries(grouped).map(([bldg, floors]) => (
          <div key={bldg} className="rx-mb-12">
            <div className="rx-tree-building">
              <i className="pi pi-building" /> {bldg}
            </div>
            {Object.entries(floors).map(([flr, wards]) => (
              <div key={flr} className="rx-tree-floor">
                <div className="rx-tree-floor-label">
                  <i className="pi pi-arrow-right" /> {flr}
                </div>
                {Object.entries(wards).map(([ward, list]) => {
                  const occ = list.filter(b => b.status === "Occupied").length;
                  const avail = list.filter(b => b.status === "Available").length;
                  return (
                    <div key={ward} className="rx-ward-block">
                      <div className="rx-ward-head">
                        <i className="pi pi-home" />
                        <span>{ward}</span>
                        <span className="rx-ward-count">
                          <span className="rx-ward-count-avail">{avail} avail</span>
                          <span className="rx-ward-count-occ">{occ} occ</span>
                          <span className="rx-ward-count-tot">{list.length} total</span>
                        </span>
                      </div>
                      <div className="rx-bed-grid">
                        {list.map(b => <BedTile key={b._id} bed={b} onClick={() => setSelected(b)} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))
      )}

      {selected && <BedDetailModal bed={selected} onClose={() => setSelected(null)} navigate={navigate} />}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function BedTile({ bed, onClick }) {
  const tone = STATUS_TONE[bed.status] || "available";
  const adm = bed.currentAdmission;
  const patientName = adm?.patientId?.fullName;
  const patientUHID = adm?.patientId?.UHID;
  const admittedDate = adm?.admissionDate || bed.currentBooking?.admittedDate;
  const days = admittedDate ? daysBetween(admittedDate) : 0;

  return (
    <div className={`rx-bed rx-bed--${tone}`} onClick={onClick} title={`Bed ${bed.bedNumber} — ${bed.status}`}>
      <div className="rx-bed-num">
        <span>{bed.bedNumber}</span>
        <span className="rx-bed-status-dot" />
      </div>
      {bed.status === "Occupied" && patientName ? (
        <>
          <div className="rx-bed-name">{patientName}</div>
          <div className="rx-bed-sub">{patientUHID || "—"} · Day {days || 1}</div>
        </>
      ) : (
        <div className="rx-bed-sub rx-bed-sub--strong">{bed.status}</div>
      )}
    </div>
  );
}

function BedDetailModal({ bed, onClose, navigate }) {
  const adm = bed.currentAdmission;
  const p = adm?.patientId;
  const isOcc = bed.status === "Occupied" && p;

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className={`rx-modal-head ${isOcc ? "rx-modal-head--bed-occ" : "rx-modal-head--bed-free"}`}>
          <i className="pi pi-table" />
          <span className="rx-modal-title">Bed {bed.bedNumber} — {bed.status}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-grid-fit-2col">
            <div>Building: <strong>{bed.buildingName || bed.building?.buildingName || bed.building?.name || "—"}</strong></div>
            <div>Floor: <strong>{bed.floorNumber ?? bed.floor?.floorNumber ?? "—"}</strong></div>
            <div>Ward: <strong>{bed.wardName || bed.ward?.wardName || bed.ward?.name || "—"}</strong></div>
            <div>Room: <strong>{bed.roomNumber || bed.room?.roomNumber || bed.room?.name || "—"}</strong></div>
            {bed.category && <div>Category: <strong>{bed.category}</strong></div>}
          </div>

          {isOcc && (
            <>
              <div className="rx-modal-section">
                <div className="rx-modal-section-title">Current Occupant</div>
                <div className="rx-grid-fit-2col">
                  <div>Name: <strong>{p.fullName}</strong></div>
                  <div>UHID: <strong>{p.UHID}</strong></div>
                  {p.age && <div>Age/Sex: <strong>{p.age}y · {p.gender || "—"}</strong></div>}
                  {p.bloodGroup && <div>Blood Group: <strong>{p.bloodGroup}</strong></div>}
                  {p.contactNumber && <div className="rx-grid-full-row">📱 <strong>{p.contactNumber}</strong></div>}
                </div>
              </div>
              <div className="rx-modal-section">
                <div className="rx-modal-section-title">Admission</div>
                <div className="rx-grid-fit-2col">
                  {adm.admissionNumber && <div>Admission #: <strong>{adm.admissionNumber}</strong></div>}
                  {adm.admissionDate && <div>Admitted: <strong>{fmtDate(adm.admissionDate)}</strong></div>}
                  {adm.expectedDischargeDate && <div>Expected Discharge: <strong>{fmtDate(adm.expectedDischargeDate)}</strong></div>}
                  {adm.admissionDate && <div>Day: <strong>{daysBetween(adm.admissionDate) || 1}</strong></div>}
                  {adm.consultantDoctor?.fullName && <div>Doctor: <strong>{adm.consultantDoctor.fullName}</strong></div>}
                  {adm.diagnosis && <div className="rx-grid-full-row">Diagnosis: <strong>{adm.diagnosis}</strong></div>}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Close</button>
          {isOcc && (
            <>
              <button className="rx-modal-btn-primary"
                      onClick={() => { onClose(); navigate(`/visit-history/${p.UHID}`); }}>
                <i className="pi pi-clock" /> History
              </button>
              <button className="rx-modal-btn-primary"
                      onClick={() => { onClose(); navigate(`/reception-billing/${p.UHID}`); }}>
                <i className="pi pi-receipt" /> Billing
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
