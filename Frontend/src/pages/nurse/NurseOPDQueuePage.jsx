/**
 * NurseOPDQueuePage.jsx
 * Nurse's view of today's OPD patients — enter vitals, track status
 * Roles: Admin, Nurse
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { InputNumber } from "primereact/inputnumber";
import opdService from "../../Services/patient/opdService";
import { departmentService } from "../../Services/departmentService";
import { useAuth } from "../../context/AuthContext";

const STATUS_COLORS = {
  Waiting:     { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  "In Progress": { bg: "#dbeafe", color: "#1e40af", dot: "#3b82f6" },
  Completed:   { bg: "#dcfce7", color: "#166534", dot: "#22c55e" },
  Referred:    { bg: "#f3e8ff", color: "#6b21a8", dot: "#a855f7" },
};

const VITALS_STATUS_COLOR = { Pending: "warning", Done: "success" };

const calcAge = (dob) => {
  if (!dob) return "—";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "—" : `${a} yrs`;
};

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function NurseOPDQueuePage() {
  const { user } = useAuth();
  const toast = useRef(null);

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [filterDept, setFilterDept] = useState(null);
  const [filterVitals, setFilterVitals] = useState(null);
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  // Vitals modal
  const [vitalsModal, setVitalsModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [vitals, setVitals] = useState({ weight: null, height: null, temperature: null, bloodPressure: "", pulse: null, respiratoryRate: null, oxygenSaturation: null });
  const [savingVitals, setSavingVitals] = useState(false);

  useEffect(() => {
    loadDepartments();
    loadQueue();
  }, []);

  const loadDepartments = async () => {
    try {
      const res = await departmentService.getActiveDepartments();
      const list = res.data || res || [];
      setDepartments([
        { label: "All Departments", value: null },
        ...(Array.isArray(list) ? list : []).map(d => ({ label: d.departmentName, value: d._id })),
      ]);
    } catch (e) { /* silent */ }
  };

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterDept) params.departmentId = filterDept;
      if (filterVitals) params.vitalsStatus = filterVitals;
      const res = await opdService.getTodayVisits(params);
      const list = res.data?.data || res.data || [];
      setVisits(Array.isArray(list) ? list : []);
      setLastRefresh(new Date());
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load queue", life: 3000 });
    } finally {
      setLoading(false);
    }
  }, [filterDept, filterVitals]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const openVitals = (visit) => {
    setSelectedVisit(visit);
    setVitals({
      weight: visit.vitals?.weight || null,
      height: visit.vitals?.height || null,
      temperature: visit.vitals?.temperature || null,
      bloodPressure: visit.vitals?.bloodPressure || "",
      pulse: visit.vitals?.pulse || null,
      respiratoryRate: visit.vitals?.respiratoryRate || null,
      oxygenSaturation: visit.vitals?.oxygenSaturation || null,
    });
    setVitalsModal(true);
  };

  const saveVitals = async () => {
    if (!selectedVisit) return;
    setSavingVitals(true);
    try {
      await opdService.updateVitals(selectedVisit.visitNumber, vitals, user?.name || user?.username || "Nurse");
      toast.current?.show({ severity: "success", summary: "Vitals saved", detail: `Vitals updated for ${selectedVisit.UHID}`, life: 3000 });
      setVitalsModal(false);
      loadQueue();
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: e?.response?.data?.message || e.message, life: 3000 });
    } finally {
      setSavingVitals(false);
    }
  };

  const updateStatus = async (visitNumber, status) => {
    try {
      await opdService.updateStatus(visitNumber, status);
      setVisits(prev => prev.map(v => v.visitNumber === visitNumber ? { ...v, status } : v));
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Could not update status", life: 2000 });
    }
  };

  const vSet = (k, v) => setVitals(prev => ({ ...prev, [k]: v }));

  // Client-side search filter
  const displayed = visits.filter(v => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return v.UHID?.toLowerCase().includes(s) ||
      (v.patientId?.fullName || "").toLowerCase().includes(s) ||
      String(v.tokenNumber || "").includes(s);
  });

  // Stats
  const stats = {
    total: visits.length,
    waiting: visits.filter(v => v.status === "Waiting").length,
    inProgress: visits.filter(v => v.status === "In Progress").length,
    done: visits.filter(v => v.status === "Completed").length,
    vitalsPending: visits.filter(v => v.vitalsStatus === "Pending").length,
  };

  return (
    <div>
      <Toast ref={toast} />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#ec4899,#db2777)", borderRadius: 14, padding: "20px 24px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <i className="pi pi-heart" style={{ fontSize: 26 }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>OPD Queue — Today</div>
              <div style={{ opacity: .8, fontSize: 13 }}>
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {lastRefresh && <span style={{ marginLeft: 12 }}>· Refreshed {fmtTime(lastRefresh)}</span>}
              </div>
            </div>
          </div>
          <Button label="Refresh" icon="pi pi-refresh" className="p-button-outlined"
            style={{ color: "#fff", border: "1px solid rgba(255,255,255,.5)" }}
            onClick={loadQueue} disabled={loading}
          />
        </div>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
          {[
            ["Total", stats.total, "#fff"],
            ["Waiting", stats.waiting, "#fbbf24"],
            ["In Progress", stats.inProgress, "#60a5fa"],
            ["Completed", stats.done, "#4ade80"],
            ["Vitals Pending", stats.vitalsPending, "#f87171"],
          ].map(([k, v, c]) => (
            <div key={k} style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: 11, opacity: .85 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span className="p-input-icon-left" style={{ flex: 1, minWidth: 200 }}>
          <i className="pi pi-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
          <InputText value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, UHID, or token…"
            style={{ width: "100%", paddingLeft: 34 }} />
        </span>
        <Dropdown value={filterDept} options={departments} onChange={e => setFilterDept(e.value)} placeholder="All Departments"
          style={{ minWidth: 180 }} />
        <Dropdown value={filterVitals} options={[{ label: "All", value: null }, { label: "Vitals Pending", value: "Pending" }, { label: "Vitals Done", value: "Done" }]}
          onChange={e => setFilterVitals(e.value)} placeholder="Vitals status" style={{ minWidth: 160 }} />
      </div>

      {/* Queue List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <ProgressSpinner style={{ width: 40, height: 40 }} />
          <div style={{ marginTop: 10, color: "#64748b" }}>Loading queue…</div>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: "40px", textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}>
          <i className="pi pi-inbox" style={{ fontSize: 48, color: "#cbd5e1" }} />
          <div style={{ color: "#94a3b8", fontSize: 15, marginTop: 10 }}>No patients in queue today</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayed.map(visit => (
            <QueueCard key={visit._id} visit={visit} onVitals={() => openVitals(visit)} onStatusChange={updateStatus} />
          ))}
        </div>
      )}

      {/* Vitals Dialog */}
      <Dialog header={`Enter Vitals — ${selectedVisit?.UHID || ""}`} visible={vitalsModal}
        style={{ width: 520 }} onHide={() => setVitalsModal(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button label="Cancel" className="p-button-text" onClick={() => setVitalsModal(false)} />
            <Button label={savingVitals ? "Saving…" : "Save Vitals"} icon={savingVitals ? "pi pi-spin pi-spinner" : "pi pi-check"}
              disabled={savingVitals} onClick={saveVitals} style={{ background: "#ec4899", border: "none" }} />
          </div>
        }
      >
        {selectedVisit && (
          <div>
            <div style={{ background: "#fdf2f8", border: "1px solid #fbcfe8", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
              <strong>{selectedVisit.UHID}</strong> · Token #{selectedVisit.tokenNumber} · {selectedVisit.chiefComplaint}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <VitalInput label="Weight (kg)" value={vitals.weight} onChange={v => vSet("weight", v)} suffix="kg" min={1} max={300} />
              <VitalInput label="Height (cm)" value={vitals.height} onChange={v => vSet("height", v)} suffix="cm" min={30} max={250} />
              <VitalInput label="Temperature (°F)" value={vitals.temperature} onChange={v => vSet("temperature", v)} suffix="°F" min={90} max={110} />
              <div>
                <label style={lbl}>Blood Pressure</label>
                <InputText value={vitals.bloodPressure} onChange={e => vSet("bloodPressure", e.target.value)}
                  placeholder="120/80" style={{ width: "100%" }} />
              </div>
              <VitalInput label="Pulse (bpm)" value={vitals.pulse} onChange={v => vSet("pulse", v)} suffix="bpm" min={20} max={300} />
              <VitalInput label="Respiratory Rate" value={vitals.respiratoryRate} onChange={v => vSet("respiratoryRate", v)} suffix="/min" min={4} max={60} />
              <VitalInput label="SpO2 (%)" value={vitals.oxygenSaturation} onChange={v => vSet("oxygenSaturation", v)} suffix="%" min={50} max={100} />
              {vitals.weight && vitals.height && (
                <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={lbl}>BMI (calculated)</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>
                    {(vitals.weight / Math.pow(vitals.height / 100, 2)).toFixed(1)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function VitalInput({ label, value, onChange, suffix, min, max }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <InputNumber value={value} onValueChange={e => onChange(e.value)}
        suffix={` ${suffix}`} min={min} max={max} inputStyle={{ width: "100%" }}
        style={{ width: "100%" }} />
    </div>
  );
}

function QueueCard({ visit, onVitals, onStatusChange }) {
  const sc = STATUS_COLORS[visit.status] || STATUS_COLORS.Waiting;
  const doctorName = visit.doctorId?.personalInfo
    ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
    : visit.consultantName || "—";
  const deptName = visit.departmentId?.departmentName || visit.department || "—";

  return (
    <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 6px rgba(0,0,0,.07)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {/* Token column */}
        <div style={{ background: "#0891b2", color: "#fff", padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 72 }}>
          <div style={{ fontSize: 9, opacity: .8, letterSpacing: 1 }}>TOKEN</div>
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{String(visit.tokenNumber || "—").padStart(2, "0")}</div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: "12px 16px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
                {visit.UHID}
                <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b", marginLeft: 8 }}>
                  Visit #{visit.visitNumber} · {visit.patientVisitSeq ? `${visit.patientVisitSeq}${["th","st","nd","rd"][(visit.patientVisitSeq % 10 <= 3 && visit.patientVisitSeq % 100 !== 11 && visit.patientVisitSeq % 100 !== 12 && visit.patientVisitSeq % 100 !== 13) ? visit.patientVisitSeq % 10 : 0] || "th"} OPD` : ""}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                {deptName} · {doctorName}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                <i className="pi pi-comment" style={{ fontSize: 10, marginRight: 4 }} />
                {visit.chiefComplaint}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              {/* Status badge */}
              <div style={{ background: sc.bg, color: sc.color, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc.dot }} />
                {visit.status}
              </div>
              {/* Vitals status */}
              <Tag value={`Vitals: ${visit.vitalsStatus || "Pending"}`} severity={VITALS_STATUS_COLOR[visit.vitalsStatus] || "warning"} style={{ fontSize: 11 }} />
            </div>
          </div>
        </div>

        {/* Actions column */}
        <div style={{ borderLeft: "1px solid #f1f5f9", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, justifyContent: "center", minWidth: 140 }}>
          <Button
            label={visit.vitalsStatus === "Done" ? "Edit Vitals" : "Enter Vitals"}
            icon="pi pi-heart"
            style={{ background: visit.vitalsStatus === "Done" ? "#f0fdf4" : "#ec4899", border: visit.vitalsStatus === "Done" ? "1px solid #bbf7d0" : "none", color: visit.vitalsStatus === "Done" ? "#16a34a" : "#fff", fontSize: 12, padding: "7px 12px", whiteSpace: "nowrap" }}
            onClick={onVitals}
          />
          {visit.status === "Waiting" && (
            <Button label="Mark In Progress" icon="pi pi-play" className="p-button-outlined"
              style={{ fontSize: 11, padding: "5px 10px", color: "#3b82f6", border: "1px solid #93c5fd", whiteSpace: "nowrap" }}
              onClick={() => onStatusChange(visit.visitNumber, "In Progress")} />
          )}
          {visit.status === "In Progress" && (
            <Button label="Mark Complete" icon="pi pi-check" className="p-button-outlined"
              style={{ fontSize: 11, padding: "5px 10px", color: "#16a34a", border: "1px solid #86efac", whiteSpace: "nowrap" }}
              onClick={() => onStatusChange(visit.visitNumber, "Completed")} />
          )}
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 };
