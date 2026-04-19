/**
 * DoctorOPDPanelPage.jsx
 * Doctor's OPD waiting room — see all patients registered under their department
 * Tabs: Today | All Visits | Follow-ups Due
 * Roles: Admin, Doctor
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { TabView, TabPanel } from "primereact/tabview";
import opdService from "../../Services/patient/opdService";
import patientService from "../../Services/patient/patientService";
import { useAuth } from "../../context/AuthContext";

const STATUS_COLORS = {
  Waiting:       { bg: "#fef3c7", color: "#92400e" },
  "In Progress": { bg: "#dbeafe", color: "#1e40af" },
  Completed:     { bg: "#dcfce7", color: "#166534" },
  Referred:      { bg: "#f3e8ff", color: "#6b21a8" },
};

const calcAge = (dob) => {
  if (!dob) return "—";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "—" : `${a} yrs`;
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function DoctorOPDPanelPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useRef(null);

  const [activeTab, setActiveTab] = useState(0);
  const [todayVisits, setTodayVisits] = useState([]);
  const [allVisits, setAllVisits] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Patient history modal
  const [historyModal, setHistoryModal] = useState(false);
  const [historyPatient, setHistoryPatient] = useState(null);
  const [historyVisits, setHistoryVisits] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    loadToday();
  }, []);

  const loadToday = async () => {
    setLoading(true);
    try {
      const res = await opdService.getTodayVisits({});
      const list = res.data?.data || res.data || [];
      setTodayVisits(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load today's visits", life: 3000 });
    } finally {
      setLoading(false);
    }
  };

  const loadAll = async () => {
    if (allVisits.length > 0) return; // already loaded
    setLoading(true);
    try {
      const res = await opdService.getAllOPDVisits({ limit: 200 });
      const list = res.data?.data || res.data?.visits || res.data || [];
      setAllVisits(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load visits", life: 3000 });
    } finally {
      setLoading(false);
    }
  };

  const loadFollowups = async () => {
    if (followups.length > 0) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await opdService.getFollowUpDue(today);
      const list = res.data?.data || res.data || [];
      setFollowups(Array.isArray(list) ? list : []);
    } catch (e) { /* silent */ } finally {
      setLoading(false);
    }
  };

  const onTabChange = (e) => {
    setActiveTab(e.index);
    if (e.index === 1) loadAll();
    if (e.index === 2) loadFollowups();
  };

  const openHistory = async (visit) => {
    setHistoryPatient(visit);
    setHistoryVisits([]);
    setHistoryModal(true);
    setLoadingHistory(true);
    try {
      const res = await opdService.getPatientOPDHistory(visit.patientId);
      const list = res.data?.data || res.data || [];
      setHistoryVisits(Array.isArray(list) ? list : []);
    } catch (e) { /* silent */ } finally {
      setLoadingHistory(false);
    }
  };

  const goAssess = (visit) => {
    navigate(`/doctor-opd-panel?visitNumber=${visit.visitNumber}&uhid=${visit.UHID}`);
  };

  const filterVisits = (list) => {
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter(v =>
      v.UHID?.toLowerCase().includes(s) ||
      String(v.tokenNumber || "").includes(s) ||
      (v.chiefComplaint || "").toLowerCase().includes(s) ||
      (v.consultantName || "").toLowerCase().includes(s)
    );
  };

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <Toast ref={toast} />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#14b8a6,#0d9488)", borderRadius: 14, padding: "20px 24px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <i className="pi pi-stop-circle" style={{ fontSize: 26 }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>My OPD Panel</div>
              <div style={{ opacity: .8, fontSize: 13 }}>
                {user?.name && <span>Dr. {user.name} · </span>}
                {today}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="p-input-icon-left">
              <i className="pi pi-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <InputText value={search} onChange={e => setSearch(e.target.value)} placeholder="Search UHID, complaint…"
                style={{ paddingLeft: 34, background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", "::placeholder": { color: "rgba(255,255,255,.6)" } }} />
            </span>
            <Button label="Refresh" icon="pi pi-refresh" className="p-button-outlined"
              style={{ color: "#fff", border: "1px solid rgba(255,255,255,.5)" }}
              onClick={() => { setAllVisits([]); setFollowups([]); loadToday(); }} />
          </div>
        </div>

        {/* Today stats */}
        <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
          {[
            ["Today's Patients", todayVisits.length, "#fff"],
            ["Waiting", todayVisits.filter(v => v.status === "Waiting").length, "#fbbf24"],
            ["In Progress", todayVisits.filter(v => v.status === "In Progress").length, "#60a5fa"],
            ["Completed", todayVisits.filter(v => v.status === "Completed").length, "#4ade80"],
            ["Vitals Pending", todayVisits.filter(v => v.vitalsStatus === "Pending").length, "#f87171"],
          ].map(([k, v, c]) => (
            <div key={k} style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: 11, opacity: .85 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      <TabView activeIndex={activeTab} onTabChange={onTabChange}>
        {/* ── Today's Patients ── */}
        <TabPanel header={`Today (${todayVisits.length})`} leftIcon="pi pi-calendar mr-2">
          <VisitList
            visits={filterVisits(todayVisits)}
            loading={loading}
            onAssess={goAssess}
            onHistory={openHistory}
            emptyMsg="No patients registered for today yet"
          />
        </TabPanel>

        {/* ── All Visits ── */}
        <TabPanel header="All Visits" leftIcon="pi pi-list mr-2">
          <VisitList
            visits={filterVisits(allVisits)}
            loading={loading}
            onAssess={goAssess}
            onHistory={openHistory}
            emptyMsg="No visits found"
            showDate
          />
        </TabPanel>

        {/* ── Follow-ups Due ── */}
        <TabPanel header="Follow-ups Due" leftIcon="pi pi-calendar-plus mr-2">
          <VisitList
            visits={filterVisits(followups)}
            loading={loading}
            onAssess={goAssess}
            onHistory={openHistory}
            emptyMsg="No follow-ups due today"
            showDate
          />
        </TabPanel>
      </TabView>

      {/* Patient History Dialog */}
      <Dialog header={historyPatient ? `Visit History — ${historyPatient.UHID}` : "Visit History"}
        visible={historyModal} style={{ width: 640 }} onHide={() => setHistoryModal(false)}>
        {loadingHistory ? (
          <div style={{ textAlign: "center", padding: 32 }}><ProgressSpinner style={{ width: 36, height: 36 }} /></div>
        ) : historyVisits.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>No previous OPD visits found</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 480, overflowY: "auto" }}>
            {historyVisits.map((v, i) => (
              <div key={v._id} style={{ background: i === 0 ? "#f0fdf4" : "#f8fafc", border: `1px solid ${i === 0 ? "#bbf7d0" : "#e2e8f0"}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0891b2" }}>{v.visitNumber}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{fmtDate(v.visitDate)}</div>
                </div>
                <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 4 }}>
                  <strong>Complaint:</strong> {v.chiefComplaint}
                </div>
                {v.provisionalDiagnosis && (
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    <strong>Diagnosis:</strong> {v.provisionalDiagnosis}
                  </div>
                )}
                {v.prescribedMedications?.length > 0 && (
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                    <strong>Rx:</strong> {v.prescribedMedications.map(m => m.medicineName).join(", ")}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <Tag value={v.visitType} severity="info" style={{ fontSize: 10 }} />
                  {v.followUpRequired && v.followUpDate && (
                    <Tag value={`Follow-up: ${fmtDate(v.followUpDate)}`} severity="warning" style={{ fontSize: 10 }} />
                  )}
                  {i === 0 && <Tag value="Latest" severity="success" style={{ fontSize: 10 }} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ── Visit List ── */
function VisitList({ visits, loading, onAssess, onHistory, emptyMsg, showDate = false }) {
  if (loading) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <ProgressSpinner style={{ width: 40, height: 40 }} />
    </div>
  );

  if (visits.length === 0) return (
    <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 10 }}>
      <i className="pi pi-inbox" style={{ fontSize: 40, color: "#cbd5e1" }} />
      <div style={{ color: "#94a3b8", marginTop: 10 }}>{emptyMsg}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {visits.map(visit => {
        const sc = STATUS_COLORS[visit.status] || STATUS_COLORS.Waiting;
        const doctorName = visit.doctorId?.personalInfo
          ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
          : visit.consultantName || "—";
        const deptName = visit.departmentId?.departmentName || visit.department || "—";

        return (
          <div key={visit._id} style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 6px rgba(0,0,0,.06)", overflow: "hidden", display: "flex" }}>
            {/* Token */}
            <div style={{ background: "#14b8a6", color: "#fff", padding: "10px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 68 }}>
              <div style={{ fontSize: 9, opacity: .8, letterSpacing: 1 }}>TOKEN</div>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{String(visit.tokenNumber || "—").padStart(2, "0")}</div>
            </div>

            <div style={{ flex: 1, padding: "12px 16px", minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{visit.UHID}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Visit #{visit.visitNumber}</span>
                    {visit.patientVisitSeq > 0 && (
                      <Tag value={`OPD #${visit.patientVisitSeq}`} severity={visit.patientVisitSeq === 1 ? "info" : "success"} style={{ fontSize: 10 }} />
                    )}
                    {showDate && <span style={{ fontSize: 12, color: "#94a3b8" }}>{fmtDate(visit.visitDate)}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{deptName} · {doctorName}</div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                    <i className="pi pi-comment" style={{ fontSize: 10, marginRight: 4 }} />
                    {visit.chiefComplaint}
                  </div>
                  {visit.provisionalDiagnosis && (
                    <div style={{ fontSize: 12, color: "#0891b2", marginTop: 2 }}>
                      Dx: {visit.provisionalDiagnosis}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <div style={{ ...sc, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{visit.status}</div>
                  <Tag value={`Vitals: ${visit.vitalsStatus || "Pending"}`}
                    severity={visit.vitalsStatus === "Done" ? "success" : "warning"} style={{ fontSize: 10 }} />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ borderLeft: "1px solid #f1f5f9", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
              <Button label="Assess" icon="pi pi-file-check" style={{ background: "#14b8a6", border: "none", fontSize: 12, padding: "7px 12px", whiteSpace: "nowrap" }}
                onClick={() => onAssess(visit)} />
              <Button label="History" icon="pi pi-clock" className="p-button-outlined"
                style={{ fontSize: 12, padding: "5px 10px", color: "#14b8a6", border: "1px solid #99f6e4", whiteSpace: "nowrap" }}
                onClick={() => onHistory(visit)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
