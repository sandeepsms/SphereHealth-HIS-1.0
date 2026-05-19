/**
 * MRDRecentDischargesPage.jsx — R7i
 *
 * Read-only "Recent Discharges" archive for the Medical Records
 * Department (also visible to Admin + Doctor). Lists every
 * patient discharged in the chosen time window. Click a row →
 * navigate to /patient-file/:uhid (the complete read-only file).
 *
 * NABH MOI.1: clinical records must be available for review for
 * the legally-mandated retention period (typically 5+ years).
 * Replaces the paper MRD pull-and-photocopy workflow.
 *
 * This page is intentionally lightweight — it's a router, not
 * another aggregator. The heavy lifting lives in
 * CompletePatientFilePage.jsx (3,125 lines) which already
 * renders all 18 sections + activity log + billing summary.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "../reception/reception-shared.css";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const daysSince = (d) => {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
};

const WINDOWS = [
  { id: "today", label: "Today",       days: 1 },
  { id: "week",  label: "Last 7 days", days: 7 },
  { id: "month", label: "Last 30 days", days: 30 },
  { id: "year",  label: "Last year",    days: 365 },
];

export default function MRDRecentDischargesPage() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [windowId, setWindowId] = useState("week");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // /discharges/today already exists; for the wider windows we hit
      // the generic /admissions endpoint with status=Discharged and
      // sort by actualDischargeDate desc. The backend already supports
      // these filters via getAllAdmissions.
      const days = WINDOWS.find((w) => w.id === windowId)?.days || 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/admissions`, {
        params: {
          status: "Discharged",
          dischargedSince: since,
          limit: 500,
        },
      });
      // Defensive normalisation — older endpoints return { data: [...] }
      // and newer ones return { admissions: [...] }
      const rows = data?.data || data?.admissions || [];
      setList(rows);
    } catch (e) {
      console.error("[MRDRecentDischarges] load:", e?.response?.data?.message || e?.message);
      toast.error(e?.response?.data?.message || "Could not load discharged patients");
    } finally {
      setLoading(false);
    }
  }, [windowId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let r = list.filter((a) => a.status === "Discharged");
    const s = search.trim().toLowerCase();
    if (s) {
      r = r.filter(
        (a) =>
          (a.patientName || "").toLowerCase().includes(s) ||
          (a.UHID || "").toLowerCase().includes(s) ||
          (a.admissionNumber || a.ipdNo || "").toLowerCase().includes(s) ||
          (a.attendingDoctor || "").toLowerCase().includes(s) ||
          (a.bedNumber || "").toLowerCase().includes(s),
      );
    }
    // Sort newest discharge first
    r.sort((a, b) => {
      const da = new Date(a.actualDischargeDate || a.dischargeWorkflow?.gatePassIssuedAt || 0).getTime();
      const db = new Date(b.actualDischargeDate || b.dischargeWorkflow?.gatePassIssuedAt || 0).getTime();
      return db - da;
    });
    return r;
  }, [list, search]);

  return (
    <div className="rx-page">
      {/* Header */}
      <div className="rx-header">
        <div>
          <div className="rx-header-title">
            <i className="pi pi-folder-open" /> Medical Records — Recent Discharges
          </div>
          <div className="rx-header-meta">
            NABH MOI.1 · Read-only archive of every discharged patient file
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}>
            <i className="pi pi-refresh" /> Refresh
          </button>
        </div>
      </div>

      {/* Time window tabs */}
      <div className="rx-tabs">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            className={`rx-tab ${windowId === w.id ? "rx-tab--active" : ""}`}
            onClick={() => setWindowId(w.id)}
          >
            <i className="pi pi-calendar" /> {w.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input
          placeholder="Search by name, UHID, IPD No, bed, or attending doctor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="rx-empty">
          <i className="pi pi-spin pi-spinner rx-loader-icon" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">📂</span>
          No discharged patients in the selected window.
        </div>
      ) : (
        filtered.map((adm) => {
          const dischargedAt =
            adm.actualDischargeDate ||
            adm.dischargeWorkflow?.gatePassIssuedAt ||
            adm.dischargeWorkflow?.billClearedAt;
          const since = daysSince(dischargedAt);
          return (
            <div
              key={adm._id}
              className="rx-card"
              onClick={() => navigate(`/patient-file/${adm.UHID}`)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/patient-file/${adm.UHID}`);
                }
              }}
            >
              <div className="rx-card-main">
                <div className="rx-card-name">
                  {adm.patientName || "—"}
                  <span className="rx-card-stage rx-card-stage--done">
                    DISCHARGED · {since === 0 ? "today" : `${since}d ago`}
                  </span>
                </div>
                <div className="rx-card-meta">
                  <span>
                    UHID: <strong>{adm.UHID || "—"}</strong>
                  </span>
                  <span>
                    IPD: <strong>{adm.admissionNumber || adm.ipdNo || "—"}</strong>
                  </span>
                  <span>
                    Bed: <strong>{adm.bedNumber || "—"}</strong>
                  </span>
                  {(adm.departmentId?.departmentName || adm.department) && (
                    <span>
                      Dept: <strong>{adm.departmentId?.departmentName || adm.department}</strong>
                    </span>
                  )}
                  <span>
                    Doctor: <strong>{adm.attendingDoctor || "—"}</strong>
                  </span>
                  <span>
                    Discharged: <strong>{fmtDateTime(dischargedAt)}</strong>
                  </span>
                </div>
              </div>
              <div className="rx-card-actions">
                <button
                  className="rx-action-btn rx-action-btn--primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/patient-file/${adm.UHID}`);
                  }}
                >
                  <i className="pi pi-folder-open" /> Open File
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
