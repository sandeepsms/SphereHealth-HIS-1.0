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
import { useHospitalSettings } from "../../context/HospitalSettingsContext";

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
  const toast    = useRef(null);
  const { settings: hs } = useHospitalSettings();

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
    navigate(`/opd-assessment?visitNumber=${visit.visitNumber}&uhid=${visit.UHID}`);
  };

  // R7cj — Inline "Add Note" modal so doctors can append an addendum
  // without leaving the OPD panel. Mirrors the medico-legal append-only
  // pattern: the structured assessment stays locked, but follow-up
  // observations (lab result, family clarification, post-visit symptom
  // update) get a timestamped, authored entry on the same visit.
  const [noteModal,      setNoteModal]      = useState(false);
  const [noteVisit,      setNoteVisit]      = useState(null);   // the visit being annotated
  const [noteDraft,      setNoteDraft]      = useState("");
  const [noteSaving,     setNoteSaving]     = useState(false);
  const [noteHistory,    setNoteHistory]    = useState([]);     // existing addendums for this visit

  const openAddNote = async (visit) => {
    setNoteVisit(visit);
    setNoteDraft("");
    setNoteHistory([]);
    setNoteModal(true);
    // Re-fetch the visit so we render the latest additionalNotes[] even
    // if the panel list is stale by a few seconds.
    try {
      const r = await opdService.getOPDVisit(visit.visitNumber);
      const fresh = r?.data?.data || r?.data || {};
      setNoteHistory(Array.isArray(fresh.additionalNotes) ? fresh.additionalNotes : []);
    } catch (_) { /* non-fatal; modal still works for new entry */ }
  };

  const saveAdditionalNote = async () => {
    const text = noteDraft.trim();
    if (!text) { toastRef.current?.show({ severity: "warn", summary: "Empty note", detail: "Type the note before saving.", life: 2500 }); return; }
    if (text.length > 4000) { toastRef.current?.show({ severity: "warn", summary: "Too long", detail: "Keep under 4000 characters.", life: 2500 }); return; }
    if (!noteVisit?.visitNumber) return;
    setNoteSaving(true);
    try {
      const r = await opdService.addAdditionalNote(noteVisit.visitNumber, text);
      const updated = r?.data?.data || r?.data || null;
      setNoteHistory(Array.isArray(updated?.additionalNotes) ? updated.additionalNotes : noteHistory);
      setNoteDraft("");
      toastRef.current?.show({ severity: "success", summary: "Note added", detail: "Addendum saved against this visit.", life: 2500 });
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || "Could not save the note";
      toastRef.current?.show({ severity: "error", summary: "Save failed", detail: msg, life: 4000 });
    } finally {
      setNoteSaving(false);
    }
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

  /* ── Print ─────────────────────────────────────────────────────── */
  // R7cn: queue-print (printing the entire OPD list) was removed in
  // favour of per-row "Print" buttons that print THIS PATIENT'S
  // assessment — the actual clinical record the doctor wants on
  // paper. Reuses the existing OPDAssessmentPage `handlePrint` flow
  // (full SOAP + Rx + investigations + diagnosis + signature) via an
  // `autoPrint=1` query param the assessment page consumes on load.
  const goPrint = (visit) => {
    if (!visit?.visitNumber) return;
    navigate(
      `/opd-assessment?visitNumber=${encodeURIComponent(visit.visitNumber)}` +
      `&uhid=${encodeURIComponent(visit.UHID || "")}` +
      `&autoPrint=1`,
    );
  };

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{ padding: "16px 20px 60px", background: "#f8fafc", minHeight: "100vh" }}>
      <Toast ref={toast} />

      {/* ── Hero (R7hh — matches system UI / IPD Live Ledger pattern) ── */}
      <div style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 14,
        boxShadow: "0 1px 2px rgba(15,23,42,.04)",
        fontFamily: "'DM Sans',sans-serif",
      }}>
        {/* Accent left strip */}
        <div style={{
          width: 4, alignSelf: "stretch", borderRadius: 4,
          background: "linear-gradient(180deg,#0f766e,#0d9488)",
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#0f766e", letterSpacing: ".7px", textTransform: "uppercase" }}>
            Doctor · OPD Panel
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2, letterSpacing: "-.2px" }}>
            My OPD Panel
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <i className="pi pi-calendar" style={{ fontSize: 10 }} />
            {today}
            {user?.name && (
              <>
                <span style={{ color: "#cbd5e1" }}>·</span>
                <span>Dr. {user.name}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <i className="pi pi-search" style={{
              position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
              color: "#94a3b8", fontSize: 12, pointerEvents: "none",
            }} />
            <InputText
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search UHID, complaint…"
              style={{
                paddingLeft: 32,
                paddingRight: 12,
                paddingTop: 7,
                paddingBottom: 7,
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#fff",
                color: "#0f172a",
                width: 240,
                outline: "none",
                fontFamily: "'DM Sans',sans-serif",
              }}
            />
          </div>
          <Button
            label="Refresh"
            icon="pi pi-refresh"
            onClick={() => { setAllVisits([]); setFollowups([]); loadToday(); }}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 600,
              fontSize: 12,
              fontFamily: "'DM Sans',sans-serif",
            }}
          />
          {/* R7cn: top-right "Print" button removed — printing the whole
              OPD queue list isn't a real clinical action. The new Print
              button on each row prints THAT patient's full assessment
              (SOAP + Rx + investigations) which is what the doctor
              actually needs to hand to the patient. */}
        </div>
      </div>

      {/* ── KPI strip (R7hh) ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", fontFamily: "'DM Sans',sans-serif" }}>
        {[
          { label: "Today's Patients", val: todayVisits.length,                                                  icon: "pi-users",            tone: "#0f766e", tint: "#f0fdfa", border: "#a7f3d0" },
          { label: "Waiting",          val: todayVisits.filter(v => v.status === "Waiting").length,             icon: "pi-clock",            tone: "#d97706", tint: "#fffbeb", border: "#fde68a" },
          { label: "In Progress",      val: todayVisits.filter(v => v.status === "In Progress").length,          icon: "pi-spin pi-spinner",  tone: "#1d4ed8", tint: "#eff6ff", border: "#bfdbfe" },
          { label: "Completed",        val: todayVisits.filter(v => v.status === "Completed").length,            icon: "pi-check-circle",     tone: "#16a34a", tint: "#dcfce7", border: "#bbf7d0" },
          { label: "Vitals Pending",   val: todayVisits.filter(v => v.vitalsStatus === "Pending").length,        icon: "pi-heart",            tone: "#dc2626", tint: "#fef2f2", border: "#fecaca" },
        ].map(({ label, val, icon, tone, tint, border }) => (
          <div key={label} style={{
            flex: "1 1 150px",
            minWidth: 130,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 1px 2px rgba(15,23,42,.03)",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: tint,
              border: `1px solid ${border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <i className={`pi ${icon}`} style={{ fontSize: 14, color: tone }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: tone, lineHeight: 1.1, marginTop: 1 }}>
                {val}
              </div>
            </div>
          </div>
        ))}
      </div>

      <TabView activeIndex={activeTab} onTabChange={onTabChange}>
        {/* ── Today's Patients ── */}
        <TabPanel header={`Today (${todayVisits.length})`} leftIcon="pi pi-calendar mr-2">
          <VisitList
            visits={filterVisits(todayVisits)}
            loading={loading}
            onAssess={goAssess}
            onHistory={openHistory}
            onAddNote={openAddNote}
            onPrint={goPrint}
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
            onAddNote={openAddNote}
            onPrint={goPrint}
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
            onAddNote={openAddNote}
            onPrint={goPrint}
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

      {/* R7cj — Add Additional Note dialog. Shows existing addendums for
          the visit (newest first) above a single textarea + Save button.
          Pure addendum flow — the original structured assessment is
          never touched. */}
      <Dialog
        header={noteVisit ? `Additional Note — ${noteVisit.UHID} · ${noteVisit.visitNumber}` : "Additional Note"}
        visible={noteModal}
        style={{ width: 600 }}
        onHide={() => { if (!noteSaving) setNoteModal(false); }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Existing notes timeline */}
          {noteHistory.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>
                Previous notes ({noteHistory.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
                {[...noteHistory].reverse().map((n, i) => (
                  <div key={i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{n.note}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span><strong>By:</strong> {n.addedBy || "—"}</span>
                      <span>·</span>
                      <span>{n.addedAt ? new Date(n.addedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New note textarea */}
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>
              Add new note
            </label>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Follow-up observation, lab result interpretation, family clarification, post-visit symptom update, etc."
              rows={5}
              maxLength={4000}
              disabled={noteSaving}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid #cbd5e1", fontSize: 13, lineHeight: 1.5,
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              <span>Append-only · captured with your name + employee ID + timestamp</span>
              <span>{noteDraft.length}/4000</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Close" className="p-button-text" disabled={noteSaving} onClick={() => setNoteModal(false)} />
            <Button label={noteSaving ? "Saving…" : "Save Note"}
              icon={noteSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
              disabled={noteSaving || !noteDraft.trim()}
              style={{ background: "#14b8a6", border: "none" }}
              onClick={saveAdditionalNote} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* ── Visit List ── */
function VisitList({ visits, loading, onAssess, onHistory, onAddNote, onPrint, emptyMsg, showDate = false }) {
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
              {/* R7cj — Quick "Add Note" so doctor can drop a follow-up
                  observation against this visit without re-opening the
                  full assessment screen. Posts to /additional-note
                  (append-only audit trail). */}
              {onAddNote && (
                <Button label="+ Note" icon="pi pi-plus" className="p-button-outlined"
                  style={{ fontSize: 12, padding: "5px 10px", color: "#0d9488", border: "1px solid #5eead4", whiteSpace: "nowrap" }}
                  tooltip="Add an addendum note to this visit"
                  tooltipOptions={{ position: "left" }}
                  onClick={() => onAddNote(visit)} />
              )}
              <Button label="History" icon="pi pi-clock" className="p-button-outlined"
                style={{ fontSize: 12, padding: "5px 10px", color: "#14b8a6", border: "1px solid #99f6e4", whiteSpace: "nowrap" }}
                onClick={() => onHistory(visit)} />
              {/* R7cn — Per-row Print: opens this visit's OPD assessment
                  page with autoPrint=1 so the full SOAP + Rx + investigations
                  printable fires automatically once the data loads. */}
              {onPrint && (
                <Button label="Print" icon="pi pi-print" className="p-button-outlined"
                  style={{ fontSize: 12, padding: "5px 10px", color: "#7c3aed", border: "1px solid #ddd6fe", whiteSpace: "nowrap" }}
                  tooltip="Print this patient's assessment (SOAP + Rx)"
                  tooltipOptions={{ position: "left" }}
                  onClick={() => onPrint(visit)} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
