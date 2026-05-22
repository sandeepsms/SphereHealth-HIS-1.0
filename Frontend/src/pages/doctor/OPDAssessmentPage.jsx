/**
 * OPDAssessmentPage.jsx
 * Doctor's SOAP note + assessment page for OPD visits.
 * Navigated from DoctorOPDPanelPage via "Assess" button:
 *   /opd-assessment?visitNumber=OPD-XXXXXX&uhid=UH-XXXXX
 *
 * Every save creates a BillingTrigger automatically (DoctorAssessment type).
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import API_ENDPOINTS from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import FingerprintConsentModal from "../../Components/clinical/FingerprintConsentModal";
import DrugAutocomplete, { parseStrength, drugDisplayName } from "../../Components/clinical/DrugAutocomplete";
import ServiceAutocomplete from "../../Components/clinical/ServiceAutocomplete";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
// R7ar-P1-14/D4-aq-02: centralised Decimal128 unwrap.
import { toMoney } from "../../utils/money";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import SignatureStamp from "../../Components/signature/SignatureStamp";
import { confirm } from "../../Components/common/ConfirmDialog";
// R7az-D4-HIGH-3: themed input dialog replaces window.prompt for the
// cancel-order reason flow (and any future reason-capturing UI).
import { promptInput } from "../../Components/common/InputDialog";

const C = {
  doctor: "#7c3aed", nurse: "#db2777", primary: "#1e40af",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
};

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: ".3px" }}>
        {label}{required && <span style={{ color: C.danger }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 13,
        color: C.dark, background: C.card, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box", outline: "none" }}
      onFocus={e => e.target.style.borderColor = C.doctor} onBlur={e => e.target.style.borderColor = C.border} />
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px",
        fontSize: 13, color: C.dark, background: C.card, boxSizing: "border-box", outline: "none" }}
      onFocus={e => e.target.style.borderColor = C.doctor} onBlur={e => e.target.style.borderColor = C.border} />
  );
}

/* Collapsible Card — every doctor asked for the OPD slip cards to
   fold up so they can hide sections they're not editing. State is
   per-card-title, persisted in localStorage so the doctor's preferred
   layout survives reloads + reopens. Each card defaults to OPEN so
   the existing flow isn't disturbed for first-time users. Click the
   header (title bar) anywhere to toggle. A chevron rotates 90° to
   signal the state. */
function Card({ title, icon, color = C.doctor, children, badge, defaultOpen = true }) {
  // localStorage key uses the title — same card across visits keeps
  // its collapsed/expanded state ("OBG always collapsed for me" etc).
  const storageKey = `sphere_opd_card_${title}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "open") return true;
      if (stored === "closed") return false;
    } catch (_) {}
    return defaultOpen;
  });
  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "open" : "closed"); } catch (_) {}
      return next;
    });
  };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.05)" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`opd-card-body-${title.replace(/\s+/g, "-")}`}
        style={{
          width: "100%", padding: "12px 18px",
          background: color + "08", borderBottom: open ? `1px solid ${C.border}` : "none",
          border: "none", textAlign: "left",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", fontFamily: "inherit",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = color + "12"; }}
        onMouseLeave={e => { e.currentTarget.style.background = color + "08"; }}
      >
        <i className={`pi ${icon}`} style={{ fontSize: 14, color }} />
        <span style={{ fontWeight: 700, fontSize: 13, color }}>{title}</span>
        {badge && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".6px", padding: "2px 8px", borderRadius: 20, background: color + "18", color, border: `1px solid ${color}30` }}>{badge}</span>}
        {/* Chevron — rotates 90° to face down (open) or right (collapsed). */}
        <i
          className="pi pi-chevron-down"
          style={{
            marginLeft: "auto", fontSize: 12, color,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.18s ease",
          }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={`opd-card-body-${title.replace(/\s+/g, "-")}`} style={{ padding: "18px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

const SOURCE_COLORS = {
  DoctorVisit: C.doctor, DoctorAssessment: C.doctor, NurseNote: C.nurse,
  DoctorNote: C.primary, MAR: C.warn, InvestigationOrder: "#0284c7",
  AutoCharge: C.success, Manual: C.muted,
};

function AuditItem({ trigger }) {
  const color = SOURCE_COLORS[trigger.sourceType] || C.muted;
  const when = new Date(trigger.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const icons = { NurseNote: "pi-heart", DoctorAssessment: "pi-file-edit", DoctorVisit: "pi-user-edit", InvestigationOrder: "pi-search" };
  return (
    <div style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: color + "18", border: `1.5px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`pi ${icons[trigger.sourceType] || "pi-receipt"}`} style={{ fontSize: 11, color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.dark }}>{trigger.serviceName}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
            background: trigger.status === "billed" ? "#d1fae5" : "#fef3c7",
            color: trigger.status === "billed" ? C.success : C.warn }}>
            {trigger.status?.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trigger.orderDetails}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, display: "flex", gap: 8 }}>
          <span>{trigger.orderedByRole} — {trigger.orderedBy}</span>
          <span>·</span><span>{when}</span>
          {/* R7az-D4-CRIT-1: trigger.totalAmount can be a Decimal128 wire
              shape — call toMoney() before formatting so we don't render
              "[object Object]" or "₹NaN" when the trigger came back
              un-transformed. */}
          {toMoney(trigger.totalAmount) > 0 && <><span>·</span><span>₹{toMoney(trigger.totalAmount).toLocaleString("en-IN")}</span></>}
        </div>
      </div>
    </div>
  );
}

export default function OPDAssessmentPage() {
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const visitNumber = params.get("visitNumber") || "";
  const uhid        = params.get("uhid") || "";
  const { settings: hs } = useHospitalSettings();

  const [visit,   setVisit]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [audit,   setAudit]   = useState([]);

  const [soap, setSoap] = useState({
    subjectiveNote: "", objectiveNote: "", assessmentNote: "", planNote: "",
    // Three-tier diagnosis (Provisional / Working / Final) + a SHARED
    // ICD-10 code applied to the patient's overall episode (matches the
    // DoctorNotes "Patient Diagnosis" panel layout). patientStatus is
    // a clinical trajectory chip — Stable / Improving / Unchanged /
    // Deteriorating / Critical / Ready for Discharge — saved alongside
    // the diagnosis so handover docs + discharge summary auto-fill.
    provisionalDiagnosis: "",
    workingDiagnosis:     "",
    finalDiagnosis:       "",
    icd10Code:            "",
    icd10Description:     "",
    patientStatus:        "",
    generalExamination: "",
    systemicExamination: "",
    // Structured Gen-Ex + Sys-Ex — let the doctor tick the typical
    // findings instead of re-typing them every visit. The free-text
    // generalExamination / systemicExamination fields stay too (used
    // as "Other findings" so a doctor can record anything not in the
    // standard list). When the visit saves we serialise both — the
    // structured checkboxes feed audit & analytics; the free text is
    // the human-readable summary on printed slips.
    genExam: {
      built:           "",     // Average / Lean / Obese / Cachectic
      nourishment:     "",     // Well / Moderate / Poor
      consciousness:   "",     // Conscious / Drowsy / Stuporous / Comatose
      orientation:     "",     // Oriented / Disoriented
      hydration:       "",     // Well hydrated / Mild / Moderate / Severe
      pallor:          "",     // None / + / ++ / +++
      pedalEdema:      "",     // None / + / ++ / +++ Pitting / Non-pitting
      icterus:         false,
      cyanosis:        false,
      clubbing:        false,
      lymphadenopathy: false,
      lymphLocation:   "",     // free text — e.g. "cervical, axillary"
      jvp:             "",     // Normal / Raised
      febrile:         false,  // afebrile by default
    },
    sysExam: {
      cvs: {
        s1s2:      "",          // Normal / Muffled / Abnormal
        murmur:    false,
        murmurDetails: "",
        rhythm:    "",          // Regular / Irregular
        other:     "",
      },
      rs: {
        airEntry:      "",      // Bilateral equal / Decreased on R / Decreased on L / Unequal
        breathSounds:  "",      // Vesicular / Bronchial / Bronchovesicular
        crepts:        false,
        wheeze:        false,
        rhonchi:       false,
        other:         "",
      },
      cns: {
        gcs:       "",          // e.g. E4V5M6
        speech:    "",          // Normal / Slurred / Aphasia
        tone:      "",          // Normal / Hypertonia / Hypotonia
        power:     "",          // 5/5 all / weak side
        reflexes:  "",          // Normal / Brisk / Absent
        plantar:   "",          // Flexor / Extensor / Equivocal
        other:     "",
      },
      pa: {
        soft:        false,
        tender:      false,
        tenderLocation: "",
        distended:   false,
        bowelSounds: "",        // Present / Sluggish / Absent / Hyperactive
        organomegaly: false,
        organomegalyDetails: "",
        mass:        false,
        other:       "",
      },
    },
    advice: "", followUpDate: "", doctorNotes: "",
  });

  const [hopi, setHopi] = useState({
    onset: "", durationValue: "", durationUnit: "Days", progression: "",
    character: "", associatedSymptoms: [], aggravating: "", relieving: "",
  });

  const [chronic, setChronic] = useState({ conditions: [], others: "" });

  /* ── Obstetric & Gynaecological History ────────────────────────
   * Surfaces only for female patients (or any Gynae / OBG consult)
   * — the rest of the form is gender-neutral. Fields chosen from
   * the standard Indian Gynae OPD slip:
   *
   *   Menstrual: LMP, EDD (estimated due date if pregnant), menarche
   *              age, cycle length (days between periods), flow days,
   *              regularity, dysmenorrhea, menopausal status
   *
   *   Obstetric: G/P/A/L formula (Gravida / Para / Abortion / Living),
   *              last child birth, mode of delivery, complications
   *
   *   Sexual / Marital: married, years married, contraception method
   *
   *   Past Gynae: Pap smear date, USG date, prior surgery (D&C,
   *              hysterectomy, LSCS), other gynae conditions */
  const [obg, setObg] = useState({
    lmp: "",                  // YYYY-MM-DD
    edd: "",                  // computed from LMP+280d if pregnant
    menarche: "",             // age in years
    cycleLength: "",          // days between cycles, e.g. "28"
    flowDays: "",             // duration of flow in days
    regularity: "",           // Regular / Irregular
    dysmenorrhea: "",         // None / Mild / Moderate / Severe
    menopause: "",            // Pre / Peri / Post (with age)
    gravida: "",              // total pregnancies
    para: "",                 // birth events ≥20 wk
    abortion: "",             // spontaneous or induced
    living: "",               // children alive
    lastChildBirth: "",       // YYYY-MM-DD
    deliveryMode: "",         // Normal / LSCS / Forceps / Vacuum / Other
    obComplications: "",      // free text
    married: "",              // Yes / No
    yearsMarried: "",         // numeric
    contraception: "",        // None / OCP / IUD / Tubectomy / Vasectomy / Barrier / Other
    lastPapSmear: "",         // YYYY-MM-DD
    lastUSG: "",              // YYYY-MM-DD
    priorSurgery: "",         // free text
    notes: "",                // anything else
  });

  const [meds,     setMeds]     = useState([]);
  // mealStatus is its own field because frequency answers "how often"
  // while meal status answers "WHEN relative to food" — they're
  // orthogonal (e.g. "TDS, after food"). Keeping them separate lets
  // the Pharmacy / MAR / print receipt consume each independently.
  const [newMed,   setNewMed]   = useState({ name: "", dose: "", frequency: "", mealStatus: "", duration: "", route: "Oral" });
  const [invests,  setInvests]  = useState([]);
  const [newInvest,setNewInvest]= useState({ name: "", urgency: "Routine", instructions: "" });

  // R7v: Infusions for OPD / Day-care patients. Day-care + ER-conversion
  // OPD frequently needs IV fluids (NS / RL / DNS / Mannitol etc.) and
  // continuous infusions (insulin drip, calcium correction). Captured
  // here and sent as orderType=IV_Fluid in the bulk POST — the same
  // route TreatmentChart's Infusion tab consumes when the nurse starts
  // running it. Rate is captured in ml/hr; totalVolume optional for
  // bolus orders. Mirrors the IPD infusion entry pattern.
  const [infusions,  setInfusions]  = useState([]);
  const [newInfusion, setNewInfusion] = useState({
    name: "", totalVolume: "", rate: "", duration: "", route: "IV Infusion", additives: "", instructions: "",
  });

  const [procedures,   setProcedures]   = useState([]);
  const [newProc,      setNewProc]      = useState({ procedureName: "", procedureType: "Minor", consentRequired: true, estimatedDuration: "", notes: "" });
  const [consentModal, setConsentModal] = useState({ open: false, order: null });

  // ── Unified "Services & Orders" line (LAB / RADIOLOGY / PROCEDURE /
  // CONSUMABLE / etc.). Doctor picks from ServiceMaster, an OPD DRAFT
  // bill auto-spins-up if there isn't one yet, and the service goes
  // straight onto the bill so the receptionist sees it the moment the
  // patient reaches the counter. `service` holds the picked ServiceMaster
  // doc; `qty`/`urgency`/`instructions` are the row-level extras.
  const [newOrder, setNewOrder] = useState({ service: null, name: "", qty: 1, urgency: "Routine", instructions: "" });
  // Line items the doctor has added in THIS session. Mirrors the bill's
  // billItems for the same DRAFT — refreshed after every add/remove.
  const [orderItems,    setOrderItems]    = useState([]);
  const [orderBillId,   setOrderBillId]   = useState(null);   // /api/billing DRAFT id
  const [orderBillNum,  setOrderBillNum]  = useState("");     // human-readable bill number
  const [orderSaving,   setOrderSaving]   = useState(false);

  // R7az-D4-HIGH-2 — Per-button double-tap guards. Pre-fix, fast double
  // clicks on "Add Medication" / "Add Investigation" / "Add Infusion"
  // pushed duplicate rows into the local arrays and fired duplicate POSTs.
  const [isAddingMed,   setIsAddingMed]   = useState(false);
  const [isAddingInv,   setIsAddingInv]   = useState(false);
  const [isAddingInfusion, setIsAddingInfusion] = useState(false);

  // R7az-D4-CRIT-2 — Abort controllers for loadVisit + loadAudit so a
  // navigation away from the page (or visitNumber change) doesn't leave
  // a late axios setState-ing on an unmounted component.
  const loadVisitAbortRef = useRef(null);
  const loadAuditAbortRef = useRef(null);

  /* ── Auto-save draft ── */
  const draftKey = visitNumber ? `sphere_draft_opd_${visitNumber}` : null;
  // R7v: infusions added to the autosaved snapshot so they restore across
  // sessions just like meds + invests do.
  const { savedAt, hasDraft, loadDraft, clearDraft } = useAutoSave(
    draftKey,
    { soap, hopi, chronic, meds, invests, infusions, procedures, obg },
    2000
  );

  /* ── Digital signature ── */
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  const loadVisit = useCallback(async () => {
    if (!visitNumber) { setLoading(false); return; }
    // R7az-D4-CRIT-2 — Abort any stale loadVisit before issuing a new one
    // (visitNumber switch while the previous fetch is still in flight).
    if (loadVisitAbortRef.current) {
      try { loadVisitAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    const ctrl = new AbortController();
    loadVisitAbortRef.current = ctrl;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.OPD}/${visitNumber}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const v = data.data || data;
      setVisit(v);
      // Functional setSoap so we can merge new visit data into the
      // default structured Gen-Ex / Sys-Ex skeletons — otherwise a
      // visit that's never been touched by the new UI would drop
      // back to undefined nested objects and crash the JSX below.
      setSoap(s => ({
        subjectiveNote:       v.subjectiveNote || v.chiefComplaint || "",
        objectiveNote:        v.objectiveNote || "",
        assessmentNote:       v.assessmentNote || "",
        planNote:             v.planNote || "",
        provisionalDiagnosis: v.provisionalDiagnosis || "",
        workingDiagnosis:     v.workingDiagnosis     || "",
        finalDiagnosis:       v.finalDiagnosis       || "",
        icd10Code:            v.icd10Code            || "",
        icd10Description:     v.icd10Description     || "",
        patientStatus:        v.patientStatus        || "",
        genExam: { ...s.genExam, ...(v.genExam || {}) },
        sysExam: {
          cvs: { ...s.sysExam.cvs, ...((v.sysExam && v.sysExam.cvs) || {}) },
          rs:  { ...s.sysExam.rs,  ...((v.sysExam && v.sysExam.rs)  || {}) },
          cns: { ...s.sysExam.cns, ...((v.sysExam && v.sysExam.cns) || {}) },
          pa:  { ...s.sysExam.pa,  ...((v.sysExam && v.sysExam.pa)  || {}) },
        },
        generalExamination:   v.generalExamination || "",
        systemicExamination:  v.systemicExamination || "",
        advice:               v.advice || "",
        followUpDate:         v.followUpDate ? v.followUpDate.slice(0, 10) : "",
        doctorNotes:          v.doctorNotes || "",
      }));
      setMeds(v.prescribedMedications || []);
      setInvests(v.investigationsOrdered || []);
      setHopi({
        onset:              v.hopiOnset              || "",
        durationValue:      v.hopiDurationValue      || "",
        durationUnit:       v.hopiDurationUnit       || "Days",
        progression:        v.hopiProgression        || "",
        character:          v.hopiCharacter          || "",
        associatedSymptoms: v.hopiAssociatedSymptoms || [],
        aggravating:        v.hopiAggravating        || "",
        relieving:          v.hopiRelieving          || "",
      });
      setChronic({ conditions: v.chronicConditions || [], others: v.chronicOthers || "" });

      // Hydrate OBG history from whatever the backend already stored.
      // The fields are stored flat on the visit doc (prefixed obg*) so a
      // future printable / discharge summary / referral can pull them
      // without reaching into a nested object.
      if (v.obgLmp || v.obgGravida || v.obgMenarche || v.obgNotes) {
        setObg(o => ({
          ...o,
          lmp:             v.obgLmp             ? String(v.obgLmp).slice(0, 10) : "",
          edd:             v.obgEdd             ? String(v.obgEdd).slice(0, 10) : "",
          menarche:        v.obgMenarche        || "",
          cycleLength:     v.obgCycleLength     || "",
          flowDays:        v.obgFlowDays        || "",
          regularity:      v.obgRegularity      || "",
          dysmenorrhea:    v.obgDysmenorrhea    || "",
          menopause:       v.obgMenopause       || "",
          gravida:         v.obgGravida         || "",
          para:            v.obgPara            || "",
          abortion:        v.obgAbortion        || "",
          living:          v.obgLiving          || "",
          lastChildBirth:  v.obgLastChildBirth  ? String(v.obgLastChildBirth).slice(0, 10) : "",
          deliveryMode:    v.obgDeliveryMode    || "",
          obComplications: v.obgObComplications || "",
          married:         v.obgMarried         || "",
          yearsMarried:    v.obgYearsMarried    || "",
          contraception:   v.obgContraception   || "",
          lastPapSmear:    v.obgLastPapSmear    ? String(v.obgLastPapSmear).slice(0, 10) : "",
          lastUSG:         v.obgLastUSG         ? String(v.obgLastUSG).slice(0, 10) : "",
          priorSurgery:    v.obgPriorSurgery    || "",
          notes:           v.obgNotes           || "",
        }));
      }

      // Restore draft if one exists (unsaved form data)
      const dKey = visitNumber ? `sphere_draft_opd_${visitNumber}` : null;
      if (dKey) {
        try {
          const raw = localStorage.getItem(dKey);
          if (raw) {
            const { _meta, soap: ds, hopi: dh, chronic: dc, meds: dm, invests: di, infusions: dif, procedures: dp, obg: dob } = JSON.parse(raw);
            if (ds) setSoap(s => ({ ...s, ...ds }));
            if (dh) setHopi(h => ({ ...h, ...dh }));
            if (dc) setChronic(dc);
            if (dm) setMeds(dm);
            if (di) setInvests(di);
            if (dif) setInfusions(dif); // R7v: restore infusion draft rows
            if (dp) setProcedures(dp);
            if (dob) setObg(o => ({ ...o, ...dob }));
            toast.info(`📝 Draft restored (${_meta?.savedAt ? new Date(_meta.savedAt).toLocaleTimeString() : "last session"})`, { autoClose: 3000 });
          }
        } catch (_) {}
      }
    } catch (err) {
      if (axios.isCancel?.(err) || ctrl.signal.aborted) return;
      toast.error("Could not load visit: " + (err.response?.data?.message || err.message));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [visitNumber]);

  const loadAudit = useCallback(async () => {
    if (!visitNumber) return;
    // R7az-D4-CRIT-2 — same abort pattern.
    if (loadAuditAbortRef.current) {
      try { loadAuditAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    const ctrl = new AbortController();
    loadAuditAbortRef.current = ctrl;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.OPD}/${visitNumber}/audit-trail`, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setAudit(data.data?.triggers || []);
    } catch (_) { /* silent — audit refresh is non-critical */ }
  }, [visitNumber]);

  useEffect(() => { loadVisit(); loadAudit(); }, [loadVisit, loadAudit]);

  // R7az-D4-CRIT-2 — Abort any in-flight loadVisit / loadAudit when this
  // page unmounts so we don't setState on a dead component.
  useEffect(() => () => {
    if (loadVisitAbortRef.current) { try { loadVisitAbortRef.current.abort(); } catch (_) {} }
    if (loadAuditAbortRef.current) { try { loadAuditAbortRef.current.abort(); } catch (_) {} }
  }, []);

  const handleSave = async () => {
    if (!soap.provisionalDiagnosis.trim()) return toast.warn("Please enter a provisional diagnosis");
    setSaving(true);
    try {
      const user = (() => { try { return JSON.parse(sessionStorage.getItem("his_user") || "{}"); } catch { return {}; } })();
      await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/assessment`, {
        // ...soap already includes the 6 new diagnosis fields
        // (provisionalDiagnosis + ICD, workingDiagnosis + ICD, finalDiagnosis + ICD)
        // because they all live inside the soap object — no separate
        // payload mapping needed.
        ...soap,
        doctorName: user.fullName || user.name || "Doctor",
        hopiOnset:              hopi.onset,
        hopiDurationValue:      hopi.durationValue,
        hopiDurationUnit:       hopi.durationUnit,
        hopiProgression:        hopi.progression,
        hopiCharacter:          hopi.character,
        hopiAssociatedSymptoms: hopi.associatedSymptoms,
        hopiAggravating:        hopi.aggravating,
        hopiRelieving:          hopi.relieving,
        chronicConditions:      chronic.conditions,
        chronicOthers:          chronic.others,
        // OBG history — flat fields prefixed obg* so the print receipt
        // and discharge summary can read them without nesting. Empty
        // strings still go through so the backend can clear a previously-
        // populated field if the doctor edits and removes a value.
        obgLmp:             obg.lmp,
        obgEdd:             obg.edd,
        obgMenarche:        obg.menarche,
        obgCycleLength:     obg.cycleLength,
        obgFlowDays:        obg.flowDays,
        obgRegularity:      obg.regularity,
        obgDysmenorrhea:    obg.dysmenorrhea,
        obgMenopause:       obg.menopause,
        obgGravida:         obg.gravida,
        obgPara:            obg.para,
        obgAbortion:        obg.abortion,
        obgLiving:          obg.living,
        obgLastChildBirth:  obg.lastChildBirth,
        obgDeliveryMode:    obg.deliveryMode,
        obgObComplications: obg.obComplications,
        obgMarried:         obg.married,
        obgYearsMarried:    obg.yearsMarried,
        obgContraception:   obg.contraception,
        obgLastPapSmear:    obg.lastPapSmear,
        obgLastUSG:         obg.lastUSG,
        obgPriorSurgery:    obg.priorSurgery,
        obgNotes:           obg.notes,
      });
      // Push meds + investigations as DoctorOrders (bulk)
      const baseOrder = {
        UHID: visit?.UHID || uhid, visitId: visitNumber, visitType: "OPD",
        patientName: visit?.patientName || "",
        orderedBy: user.fullName || "Doctor", orderedByRole: "Doctor",
      };
      const medOrders = meds.filter(m => m.name && !m._orderId).map(m => ({
        ...baseOrder, orderType: "Medication",
        orderDetails: { medicineName: m.name, dose: m.dose, frequency: m.frequency, duration: m.duration, route: m.route || "Oral", displayName: m.name },
        consentStatus: "NotRequired",
      }));
      const invOrders = invests.filter(i => i.name && !i._orderId).map(i => ({
        ...baseOrder, orderType: "Investigation",
        orderDetails: { testName: i.name, urgency: i.urgency || "Routine", instructions: i.instructions, displayName: i.name },
        consentStatus: "NotRequired",
        priority: i.urgency === "STAT" ? "STAT" : "Routine",
      }));
      // R7v: Infusion orders land as orderType=IV_Fluid so they route into
      // the nurse's "Infusion Orders & Monitoring" tab (NOT Medication MAR).
      // frequency hard-set to Continuous mirrors the IPD pattern.
      const infOrders = infusions.filter(f => f.name && !f._orderId).map(f => ({
        ...baseOrder, orderType: "IV_Fluid",
        orderDetails: {
          medicineName: f.name, displayName: f.name,
          route: f.route || "IV Infusion",
          frequency: "Continuous",
          totalVolume: f.totalVolume,
          rate: f.rate,
          duration: f.duration,
          additives: f.additives,
          instructions: f.instructions,
        },
        consentStatus: "NotRequired",
      }));
      const allOrders = [...medOrders, ...invOrders, ...infOrders];
      // R7az-D4-CRIT-3 — Pre-fix: this POST was wrapped in `try { … } catch (_) {}`
      // so a 500 / 401 / network error on the bulk-orders endpoint was
      // swallowed and the doctor saw "Assessment saved" even though the
      // pharmacy never got the meds. We now surface the failure with a
      // partial-save warning and keep the local meds / invests / infusions
      // arrays so the doctor can retry rather than re-typing them from
      // scratch. clearDraft() is only called on full success.
      if (allOrders.length > 0) {
        try {
          await axios.post(`${API_ENDPOINTS.BASE}/doctor-orders/bulk`, { orders: allOrders });
        } catch (bulkErr) {
          toast.error(
            "Assessment saved, but orders did NOT reach pharmacy/lab: "
            + (bulkErr.response?.data?.message || bulkErr.message)
            + " — please click Save again to retry."
          );
          loadVisit();              // refresh server-side fields
          setTimeout(loadAudit, 1500);
          return;                   // exit before clearDraft / success toast
        }
      }
      clearDraft(); // clear auto-saved draft on successful submit
      toast.success("Assessment saved — audit trail updated");
      loadVisit();
      setTimeout(loadAudit, 1500);
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addMed = async () => {
    if (isAddingMed) return;                       // R7az-D4-HIGH-2: double-tap guard
    if (!newMed.name.trim()) return toast.warn("Medicine name required");
    setIsAddingMed(true);
    try {
      // Note: the legacy POST /prescription endpoint may not always be
      // available — the final source-of-truth is the bulk POST in
      // handleSave(). Keep the optimistic UI; surface failures via toast
      // (R7az-D4-HIGH-5: was silently swallowed pre-fix).
      try { await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/prescription`, newMed); }
      catch (e) {
        if (e.response?.status && e.response?.status >= 500) {
          toast.warn("Could not sync to server immediately — will save on next Save click.");
        }
      }
      setMeds(p => [...p, { ...newMed }]);
      // Reset must mirror the initial state — including mealStatus, else
      // the new field stays sticky across rows.
      setNewMed({ name: "", dose: "", frequency: "", mealStatus: "", duration: "", route: "Oral" });
      toast.success("Medication added");
    } finally {
      setIsAddingMed(false);
    }
  };

  const addInvestigation = async () => {
    if (isAddingInv) return;                       // R7az-D4-HIGH-2: double-tap guard
    if (!newInvest.name.trim()) return toast.warn("Investigation name required");
    setIsAddingInv(true);
    try {
      try { await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/investigation`, { ...newInvest, status: "Ordered" }); }
      catch (e) {
        if (e.response?.status && e.response?.status >= 500) {
          toast.warn("Could not sync to server immediately — will save on next Save click.");
        }
      }
      setInvests(p => [...p, { ...newInvest, status: "Ordered" }]);
      setNewInvest({ name: "", urgency: "Routine", instructions: "" });
      toast.success("Investigation ordered");
    } finally {
      setIsAddingInv(false);
    }
  };

  // Row-level remove handlers. Doctor sometimes mis-picks (e.g. wrong
  // strength, wrong patient) or the patient declines a med after
  // counselling — clicking the red × on a row drops it. We optimistically
  // update local state, then attempt the backend DELETE; if the endpoint
  // isn't wired yet the catch keeps the UI clean (matches the same
  // silent-fallback pattern in addMed / addInvestigation). Confirmation
  // dialog prevents accidental click-throughs on a touchscreen.
  const removeMed = async (idx) => {
    const m = meds[idx];
    if (!m) return;
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Remove medication?",
      body: `${m.name || "This medication"} will be removed from the prescription and any pending pharmacy indent.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    try {
      await axios.delete(`${API_ENDPOINTS.OPD}/${visitNumber}/prescription/${m._id || idx}`);
    } catch (_) { /* backend may not expose DELETE — fail silently, UI still updates */ }
    setMeds(p => p.filter((_, i) => i !== idx));
    toast.success("Medication removed");
  };

  const removeInvestigation = async (idx) => {
    const i = invests[idx];
    if (!i) return;
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Remove investigation?",
      body: `${i.name || "This investigation"} will be removed from the order list and won't be sent to the lab.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    try {
      await axios.delete(`${API_ENDPOINTS.OPD}/${visitNumber}/investigation/${i._id || idx}`);
    } catch (_) { /* same as above */ }
    setInvests(p => p.filter((_, x) => x !== idx));
    toast.success("Investigation removed");
  };

  // R7v: Infusion add/remove. Unlike medications + investigations the OPD
  // visit endpoints don't have dedicated /infusion sub-routes, so we only
  // mutate local state — the bulk POST /doctor-orders at save-time wires
  // it into the nurse's Infusion tab. Doctor still gets immediate visual
  // confirmation in the row table below.
  const addInfusion = () => {
    if (isAddingInfusion) return;                  // R7az-D4-HIGH-2: double-tap guard
    if (!newInfusion.name.trim()) return toast.warn("Fluid / infusion name required");
    if (!newInfusion.rate.trim())  return toast.warn("Rate (ml/hr) required");
    setIsAddingInfusion(true);
    try {
      setInfusions(p => [...p, { ...newInfusion }]);
      setNewInfusion({ name: "", totalVolume: "", rate: "", duration: "", route: "IV Infusion", additives: "", instructions: "" });
      toast.success("Infusion added");
    } finally {
      setIsAddingInfusion(false);
    }
  };
  const removeInfusion = async (idx) => {
    const f = infusions[idx];
    if (!f) return;
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Remove infusion?",
      body: `${f.name || "This infusion"} will be removed from the order list and won't appear in the nurse's infusion tab.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    setInfusions(p => p.filter((_, x) => x !== idx));
    toast.success("Infusion removed");
  };

  // ── Unified Services & Orders → DRAFT bill flow ────────────────
  // When the doctor adds ANY chargeable line (lab test, imaging,
  // procedure, consumable, etc.) we want the receptionist to see it
  // immediately as a draft bill on /reception-billing. The flow:
  //   1. Get-or-create an OPD DRAFT bill for this UHID (idempotent —
  //      backend's getOrCreateDraftBill returns the existing draft if
  //      one already exists for the same patient + visitType).
  //   2. Append the picked ServiceMaster row via add-service.
  //   3. Refresh local orderItems from the bill response so the table
  //      below stays in sync.
  // Patient pays at reception — receptionist clicks Generate + Collect
  // on the same DRAFT and we're done.
  const ensureDraftBill = async () => {
    if (orderBillId) return orderBillId;
    const uhidValue = visit?.UHID || uhid;
    if (!uhidValue) throw new Error("Patient UHID unknown — cannot create bill");
    const { data } = await axios.post(`${API_ENDPOINTS.BASE}/billing/create`, {
      UHID:      uhidValue,
      visitType: "OPD",
    });
    const bill = data?.data || data;
    if (!bill?._id) throw new Error("Could not create draft bill");
    setOrderBillId(bill._id);
    setOrderBillNum(bill.billNumber || "(DRAFT)");
    setOrderItems(Array.isArray(bill.billItems) ? bill.billItems : []);
    return bill._id;
  };

  const addOrderToBill = async () => {
    const svc = newOrder.service;
    if (!svc?._id) return toast.warn("Pick a service from the list first");
    const qty = Math.max(1, Number(newOrder.qty) || 1);

    setOrderSaving(true);
    try {
      const billId = await ensureDraftBill();
      const { data } = await axios.post(
        `${API_ENDPOINTS.BASE}/billing/${billId}/add-service`,
        {
          serviceId: svc._id,
          quantity: qty,
          remarks: [newOrder.urgency, newOrder.instructions].filter(Boolean).join(" · ") || undefined,
          addedBySource: "Doctor",
          addedBy:       visit?.consultantName || "Doctor",
          addedByRole:   "Doctor",
          // No explicit orderStatus — backend infers "Ordered" from
          // addedBySource === "Doctor". The line sits in Active Orders
          // until the lab / radiologist / proceduralist confirms
          // completion, at which point it becomes billable.
        },
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      setOrderBillNum(bill?.billNumber || orderBillNum || "(DRAFT)");
      setNewOrder({ service: null, name: "", qty: 1, urgency: "Routine", instructions: "" });
      toast.success(`${svc.serviceName} ordered — will bill once completed`);
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || "Could not add to bill");
    } finally {
      setOrderSaving(false);
    }
  };

  const removeOrderFromBill = async (item) => {
    if (!orderBillId || !item?._id) return;
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Remove from bill?",
      body: `"${item.serviceName}" will be removed from the draft bill. If the lab has already started this order, ask reception before removing.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    try {
      const { data } = await axios.delete(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}`,
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success("Removed from bill");
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not remove — bill may already be generated");
    }
  };

  /* ─── Mark Active Order → Completed ─────────────────────────
     Flips the BillItem's orderStatus to Completed on the backend, which
     in turn triggers the bill's pre-save recalc — moving the charge
     from the "Pending Orders" bucket into the billable total. Used when
     the lab/imaging team confirms the test was performed, or when the
     doctor performs the procedure themselves and wants to charge it. */
  const completeOrderItem = async (item) => {
    if (!orderBillId || !item?._id) return;
    try {
      const { data } = await axios.patch(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}/complete`,
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success(`${item.serviceName} marked completed — now billable`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not complete order");
    }
  };

  /* ─── Soft-cancel an Active Order ───────────────────────────
     Sets orderStatus → "Cancelled" so the line is preserved for audit
     but excluded from both billable and pending totals. Distinct from
     remove (DELETE) — refuses on Completed lines so a charge that's
     already on the patient's bill must go through accountant refund
     instead. */
  const cancelOrderItem = async (item) => {
    if (!orderBillId || !item?._id) return;
    // R7az-D4-HIGH-3 — Replaced native window.prompt with the themed
    // InputDialog so this looks like every other dialog in the HIS and
    // doesn't break out of the modal layer / steal browser focus.
    const reason = await promptInput({
      title: `Cancel order "${item.serviceName}"?`,
      body:  "Enter a brief reason. This goes into the bill's audit trail and is visible to reception.",
      placeholder: "e.g. Doctor advised to defer — repeat next visit",
      required: true,
      multiline: false,
      confirmLabel: "Cancel order",
      cancelLabel: "Keep order",
      danger: true,
    });
    if (reason == null) return;       // user pressed Cancel / ESC
    try {
      const { data } = await axios.patch(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}/cancel-order`,
        { cancelReason: reason },
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success(`Order cancelled: ${item.serviceName}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not cancel order");
    }
  };

  // On mount / visit change, look for an existing OPD DRAFT for this UHID
  // so the doctor sees the partial bill if (s)he revisits the page or
  // another team member already started the bill. Silent fallback when
  // no DRAFT — the next add-service click will spin one up.
  useEffect(() => {
    const u = visit?.UHID || uhid;
    if (!u) return;
    const ac = new AbortController();
    (async () => {
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(u)}`,
          { signal: ac.signal },
        );
        const bills = data?.bills || data?.data?.bills || [];
        const draft = bills.find(b => b.visitType === "OPD" && b.billStatus === "DRAFT");
        if (draft) {
          setOrderBillId(draft._id);
          setOrderBillNum(draft.billNumber || "(DRAFT)");
          setOrderItems(Array.isArray(draft.billItems) ? draft.billItems : []);
        }
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[OPDAssessment] draft bill lookup:", e?.message);
      }
    })();
    return () => ac.abort();
  }, [visit?.UHID, uhid]);

  const addProcedure = async () => {
    if (!newProc.procedureName.trim()) return toast.warn("Procedure name required");
    const order = {
      UHID: visit?.UHID || uhid,
      patientName: visit?.patientName || "",
      visitId: visitNumber,
      visitType: "OPD",
      orderType: "Procedure",
      orderDetails: { ...newProc, displayName: newProc.procedureName, consentRequired: newProc.consentRequired },
      orderedBy: (() => { try { return JSON.parse(sessionStorage.getItem("his_user") || "{}").fullName || "Doctor"; } catch { return "Doctor"; } })(),
      orderedByRole: "Doctor",
      consentStatus: newProc.consentRequired ? "Pending" : "NotRequired",
      priority: "Routine",
    };
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BASE}/doctor-orders`, order);
      setProcedures(p => [...p, { ...newProc, _id: data.data._id, consentStatus: order.consentStatus }]);
    } catch {
      setProcedures(p => [...p, { ...newProc, consentStatus: order.consentStatus }]);
    }
    setNewProc({ procedureName: "", procedureType: "Minor", consentRequired: true, estimatedDuration: "", notes: "" });
    toast.success("Procedure added");
  };

  /* ── OPD Paper Print ──
   * Builds a print-ready prescription with everything the doctor just
   * entered: diagnosis (provisional/working/final + ICD-10), structured
   * gen-ex/sys-ex findings, full Rx list (form prefix + meal status),
   * Obs/Gynae history when applicable, and the unified Services & Orders
   * lines from the auto-DRAFT bill. Uses the CSS-driven OPD Prescription
   * printable which pulls hospital header/footer from Hospital Settings
   * and supports the paper-size selector (A4 / Half-A4 / A5). */
  const handlePrint = () => {
    const v   = visit || {};
    const vit = v.vitals || {};
    const docUser = (() => { try { return JSON.parse(sessionStorage.getItem("his_user") || "{}"); } catch { return {}; } })();
    const drName = v.consultantName || docUser?.fullName || docUser?.name || "Consultant";

    // Build a one-line summary of the structured Gen-Ex checklist so
    // the printable doesn't have to know about every checkbox. Skips
    // empty selects and false booleans.
    const genExBits = [];
    const g = soap.genExam || {};
    if (g.built)         genExBits.push(`Built: ${g.built}`);
    if (g.nourishment)   genExBits.push(`Nourishment: ${g.nourishment}`);
    if (g.consciousness) genExBits.push(g.consciousness);
    if (g.orientation)   genExBits.push(g.orientation);
    if (g.hydration)     genExBits.push(g.hydration);
    if (g.pallor)        genExBits.push(`Pallor ${g.pallor}`);
    if (g.pedalEdema)    genExBits.push(`Pedal Edema ${g.pedalEdema}`);
    if (g.jvp)           genExBits.push(`JVP ${g.jvp}`);
    if (g.icterus)         genExBits.push("Icterus +");
    if (g.cyanosis)        genExBits.push("Cyanosis +");
    if (g.clubbing)        genExBits.push("Clubbing +");
    if (g.lymphadenopathy) genExBits.push(`Lymphadenopathy${g.lymphLocation ? ` (${g.lymphLocation})` : ""}`);
    if (g.febrile)         genExBits.push("Febrile");
    const genExStructured = genExBits.join(", ");
    const generalExamLine = [genExStructured, soap.generalExamination].filter(s => s && s.trim()).join(" · ");

    // System examination — same compaction trick, but per system so
    // each line on the printable reads "CVS: S1 S2 normal, Regular, Murmur".
    const sx = soap.sysExam || {};
    const sysLines = [];
    const cvs = sx.cvs || {};
    const cvsBits = [cvs.s1s2, cvs.rhythm, cvs.murmur && `Murmur${cvs.murmurDetails ? ` (${cvs.murmurDetails})` : ""}`, cvs.other].filter(Boolean);
    if (cvsBits.length) sysLines.push(`CVS: ${cvsBits.join(", ")}`);
    const rs = sx.rs || {};
    const rsBits = [rs.airEntry, rs.breathSounds, rs.crepts && "Crepts +", rs.wheeze && "Wheeze +", rs.rhonchi && "Rhonchi +", rs.other].filter(Boolean);
    if (rsBits.length) sysLines.push(`RS: ${rsBits.join(", ")}`);
    const cns = sx.cns || {};
    const cnsBits = [cns.gcs && `GCS ${cns.gcs}`, cns.speech, cns.tone && `Tone ${cns.tone}`, cns.power && `Power ${cns.power}`, cns.reflexes && `Reflexes ${cns.reflexes}`, cns.plantar && `Plantar ${cns.plantar}`, cns.other].filter(Boolean);
    if (cnsBits.length) sysLines.push(`CNS: ${cnsBits.join(", ")}`);
    const pa = sx.pa || {};
    const paBits = [
      pa.soft && "Soft", pa.tender && `Tender${pa.tenderLocation ? ` (${pa.tenderLocation})` : ""}`,
      pa.distended && "Distended", pa.bowelSounds && `BS ${pa.bowelSounds}`,
      pa.organomegaly && `Organomegaly${pa.organomegalyDetails ? ` (${pa.organomegalyDetails})` : ""}`,
      pa.mass && "Mass", pa.other,
    ].filter(Boolean);
    if (paBits.length) sysLines.push(`P/A: ${paBits.join(", ")}`);
    if (soap.systemicExamination?.trim()) sysLines.push(soap.systemicExamination.trim());
    const systemicExamLine = sysLines.join("\n");

    // OBG history — only included on the printout when the doctor
    // actually filled something in (avoids printing an empty section
    // for non-gynae cases).
    const o = obg || {};
    const obgSummary = [];
    if (o.lmp)       obgSummary.push(`LMP: ${o.lmp}`);
    if (o.edd)       obgSummary.push(`EDD: ${o.edd}`);
    if (o.menarche)  obgSummary.push(`Menarche: ${o.menarche}y`);
    if (o.cycleLength || o.flowDays) obgSummary.push(`Cycle: ${o.cycleLength || "?"}/${o.flowDays || "?"} days`);
    if (o.regularity)   obgSummary.push(o.regularity);
    if (o.dysmenorrhea && o.dysmenorrhea !== "None") obgSummary.push(`Dysmenorrhea ${o.dysmenorrhea}`);
    if (o.menopause)    obgSummary.push(o.menopause);
    if (o.gravida || o.para || o.abortion || o.living) obgSummary.push(`G${o.gravida || 0}P${o.para || 0}A${o.abortion || 0}L${o.living || 0}`);
    if (o.deliveryMode)  obgSummary.push(`Last delivery: ${o.deliveryMode}`);
    if (o.contraception) obgSummary.push(`Contraception: ${o.contraception}`);
    if (o.lastPapSmear)  obgSummary.push(`Last Pap: ${o.lastPapSmear}`);
    if (o.lastUSG)       obgSummary.push(`Last USG: ${o.lastUSG}`);
    if (o.priorSurgery)  obgSummary.push(`Prior surgery: ${o.priorSurgery}`);
    if (o.notes)         obgSummary.push(o.notes);
    const obgLine = obgSummary.join(" · ");

    // HOPI — one-line summary the printable can render as a single
    // "History of Present Illness" row. Each token is skipped if empty
    // so the line never reads "Onset: , Duration: ".
    const h = hopi || {};
    const hopiBits = [];
    if (h.onset)         hopiBits.push(`Onset: ${h.onset}`);
    if (h.durationValue) hopiBits.push(`Duration: ${h.durationValue} ${h.durationUnit || ""}`.trim());
    if (h.progression)   hopiBits.push(`Progression: ${h.progression}`);
    if (h.character)     hopiBits.push(`Character: ${h.character}`);
    if (Array.isArray(h.associatedSymptoms) && h.associatedSymptoms.length)
      hopiBits.push(`Associated: ${h.associatedSymptoms.join(", ")}`);
    if (h.aggravating)   hopiBits.push(`Aggravating: ${h.aggravating}`);
    if (h.relieving)     hopiBits.push(`Relieving: ${h.relieving}`);
    const hopiLine = hopiBits.join(" · ");

    // Chronic comorbidities — merges the picklist + any "others" free
    // text into a single comma-separated string for the printable.
    const chronicAll = [
      ...(Array.isArray(chronic?.conditions) ? chronic.conditions : []),
      chronic?.others,
    ].filter(s => s && String(s).trim()).join(", ");

    // Map meds → the shape the printable consumes. Includes the new
    // mealStatus field as part of the Instructions column.
    const drugs = (meds || []).map(m => ({
      name:       m.name,
      generic:    m.genericName,
      dose:       m.dose,
      frequency:  m.frequency,
      duration:   m.duration,
      instructions: [m.mealStatus, m.route && `Route: ${m.route}`, m.instructions].filter(Boolean).join(" · "),
    }));

    // Investigations from the existing free-text list PLUS the
    // structured Services & Orders bill items (so labs / imaging
    // ordered via the unified panel print too).
    const investigationsForPrint = [
      ...(invests || []).map(i => ({ name: i.name || i.testName, urgent: (i.urgency || "").toUpperCase() === "STAT", notes: i.instructions })),
      ...(orderItems || []).filter(it => /LAB|RADIOLOGY|IMAGING|SUPPORT/i.test(it.category || "")).map(it => ({
        name: it.serviceName, notes: it.remarks,
      })),
    ];

    // Procedures advised — combines the standalone procedures card
    // (with consent state) and any PROCEDURE/SURGERY/PHYSIOTHERAPY rows
    // booked from the unified Services & Orders panel.
    const proceduresForPrint = [
      ...(procedures || []).map(p => ({
        name:     p.procedureName,
        type:     p.procedureType,
        duration: p.estimatedDuration,
        consent:  p.consentStatus,
        notes:    p.notes,
      })),
      ...(orderItems || []).filter(it => /PROCEDURE|SURGERY|PHYSIOTHERAPY/i.test(it.category || "")).map(it => ({
        name: it.serviceName, type: it.category, notes: it.remarks,
      })),
    ];

    // Consumables / packages / room from the bill — anything that's
    // not a lab/imaging/procedure goes into a "Services Billed" section
    // so the patient sees on the slip exactly what's been raised on
    // the receptionist's draft bill.
    const otherServicesForPrint = (orderItems || [])
      .filter(it => !/LAB|RADIOLOGY|IMAGING|SUPPORT|PROCEDURE|SURGERY|PHYSIOTHERAPY/i.test(it.category || ""))
      .map(it => ({
        name:     it.serviceName,
        category: it.category,
        qty:      it.quantity,
        price:    it.unitPrice,
        total:    it.totalAmount,
        notes:    it.remarks,
      }));

    openPrint("opd-prescription", {
      rxNo:         v.visitNumber,
      patientName:  v.patientName || v.UHID,
      uhid:         v.UHID,
      age:          v.age,
      gender:       v.gender,
      mobile:       v.contactNumber || v.mobile,
      doctorName:   drName,
      doctorReg:    docUser?.registrationNo || "",
      department:   v.department || docUser?.department || "",
      visitDate:    v.visitDate || new Date().toISOString(),
      vitals: {
        bp:     vit.bloodPressure,
        pulse:  vit.pulse,
        temp:   vit.temperature,
        spo2:   vit.oxygenSaturation,
        rr:     vit.respiratoryRate,
        weight: vit.weight,
        height: vit.height,
        bmi:    vit.bmi,
      },
      chiefComplaints: v.chiefComplaint || soap.subjectiveNote,
      // HOPI compacted one-line + chronic comorbidities for the history block
      hopi:            hopiLine,
      chronic:         chronicAll,
      history:         soap.objectiveNote,
      // Three-tier diagnosis + ICD coding — matches the on-screen card
      provisionalDx:   soap.provisionalDiagnosis,
      workingDx:       soap.workingDiagnosis,
      diagnosis:       soap.finalDiagnosis,
      icd10:           soap.icd10Code,
      icd10Desc:       soap.icd10Description,
      patientStatus:   soap.patientStatus,
      // SOAP narrative — Assessment & Plan notes (separate from the
      // structured diagnosis & advice; doctors use these for the
      // clinical reasoning that doesn't fit elsewhere)
      assessmentNote:  soap.assessmentNote,
      planNote:        soap.planNote,
      // Structured + free-text examination findings, compacted
      generalExam:     generalExamLine,
      systemicExam:    systemicExamLine,
      // Obs/Gynae one-liner (rendered only when populated)
      obgHistory:      obgLine,
      drugs,
      investigations:  investigationsForPrint,
      // Procedures advised + non-lab/non-procedure services billed
      procedures:      proceduresForPrint,
      otherServices:   otherServicesForPrint,
      // Plan-side fields still live on soap (Advice / Follow-up / Notes)
      advice:          soap.advice ? String(soap.advice).split("\n").filter(Boolean) : [],
      followUpDate:    soap.followUpDate,
      followUpNotes:   soap.doctorNotes,
      // R7bh-F1 / META-1: PrintAudit anchor — Prescription maps to
      // OPDPrescription in ENTITY_MODEL. Visit/Prescription _id may
      // not exist on a freshly drafted visit, fall back to visit _id.
      printAudit: {
        entityType:   "Prescription",
        entityId:     v.prescriptionId || v._id,
        entityNumber: v.visitNumber,
        UHID:         v.UHID,
        patientName:  v.patientName || v.UHID,
      },
    });
  };

  const vitals = visit?.vitals || {};
  const vitInfo = [
    { label: "BP",    value: vitals.bloodPressure || "—" },
    { label: "Pulse", value: vitals.pulse ? `${vitals.pulse} bpm` : "—" },
    { label: "Temp",  value: vitals.temperature ? `${vitals.temperature} °F` : "—" },
    { label: "SpO₂",  value: vitals.oxygenSaturation ? `${vitals.oxygenSaturation}%` : "—" },
    { label: "Wt",    value: vitals.weight ? `${vitals.weight} kg` : "—" },
    { label: "BMI",   value: vitals.bmi || "—" },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 32, color: C.doctor }} />
    </div>
  );

  if (!visitNumber) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
      <i className="pi pi-exclamation-triangle" style={{ fontSize: 40, marginBottom: 16, display: "block" }} />
      <p>No visit number provided. Navigate from the Doctor OPD Panel.</p>
      <button onClick={() => navigate("/doctor-opd-panel")}
        style={{ marginTop: 12, padding: "10px 24px", background: C.doctor, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
        Go to OPD Panel
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, #4c1d95, ${C.doctor})`,
        borderRadius: 14, padding: "20px 24px", marginBottom: 24, color: "#fff",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        boxShadow: "0 4px 20px rgba(124,58,237,.25)",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <button onClick={() => navigate("/doctor-opd-panel")}
              style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              ← OPD Panel
            </button>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", background: "rgba(255,255,255,.2)", padding: "2px 10px", borderRadius: 20 }}>
              OPD ASSESSMENT
            </span>
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>
            {visit?.patientName || uhid || "Patient"}
          </h1>
          <div style={{ display: "flex", gap: 16, fontSize: 12, opacity: .85, flexWrap: "wrap" }}>
            <span><i className="pi pi-id-card" style={{ marginRight: 4 }} />{visit?.UHID || uhid}</span>
            <span><i className="pi pi-tag" style={{ marginRight: 4 }} />{visitNumber}</span>
            <span><i className="pi pi-calendar" style={{ marginRight: 4 }} />{new Date(visit?.visitDate || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
            <span><i className="pi pi-building" style={{ marginRight: 4 }} />{visit?.department || "General"}</span>
            <span><i className="pi pi-user-edit" style={{ marginRight: 4 }} />{visit?.consultantName || "—"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handlePrint} style={{
            background: "rgba(255,255,255,.15)", color: "#fff",
            border: "1.5px solid rgba(255,255,255,.6)", padding: "11px 20px", borderRadius: 10,
            cursor: "pointer", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <i className="pi pi-print" /> Print OPD Paper
          </button>
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => !signature ? setShowSetup(true) : undefined} title={signature ? "Signature set ✓" : "Setup signature"}
            style={{ padding: "8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border: `1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius: 8, cursor: signature ? "default" : "pointer", fontSize: 11, fontWeight: 700, color: signature ? "#16a34a" : "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
            {signature ? <><i className="pi pi-verified" /> Signed</> : <><i className="pi pi-pen-to-square" /> Add Signature</>}
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            background: saving ? "rgba(255,255,255,.25)" : "#fff", color: C.doctor,
            border: "none", padding: "11px 24px", borderRadius: 10,
            cursor: saving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 8, boxShadow: "0 2px 8px rgba(0,0,0,.1)",
          }}>
            {saving ? <><i className="pi pi-spin pi-spinner" /> Saving…</> : <><i className="pi pi-save" /> Save Assessment</>}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

        {/* LEFT: Forms */}
        <div>

          {/* Nurse Pre-Assessment Strip */}
          <Card title="Nurse Pre-Assessment" icon="pi-heart" color={C.nurse}>
            {/* Chief Complaint + Allergy */}
            {(visit?.chiefComplaint || visit?.allergyHistory) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                {visit.chiefComplaint && (
                  <div style={{ background: "#fdf4ff", border: "1px solid #e9d5ff", borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, color: "#9333ea", fontWeight: 700, marginBottom: 3 }}>CHIEF COMPLAINT</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.dark }}>{visit.chiefComplaint}</div>
                  </div>
                )}
                {visit.allergyHistory && (
                  <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, color: "#e11d48", fontWeight: 700, marginBottom: 3 }}>KNOWN ALLERGIES</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.dark }}>{visit.allergyHistory}</div>
                  </div>
                )}
              </div>
            )}
            {/* Vitals */}
            {visit?.vitalsStatus === "Done" ? (
              <>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: ".5px", marginBottom: 8 }}>VITALS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                  {vitInfo.map(v => (
                    <div key={v.label} style={{ background: C.bg, borderRadius: 8, padding: "9px 12px", border: `1px solid ${C.border}`, textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 600, marginBottom: 2 }}>{v.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>{v.value}</div>
                    </div>
                  ))}
                </div>
                {visit.vitalsEnteredBy && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                    <i className="pi pi-check-circle" style={{ marginRight: 5, color: C.success }} />
                    Entered by <strong>{visit.vitalsEnteredBy}</strong>
                    {visit.vitalsEnteredAt ? ` at ${new Date(visit.vitalsEnteredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </div>
                )}
              </>
            ) : (
              <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <i className="pi pi-clock" style={{ color: "#d97706", fontSize: 16 }} />
                <span style={{ color: "#92400e", fontSize: 13, fontWeight: 600 }}>Vitals not yet recorded by nursing staff.</span>
              </div>
            )}
          </Card>

          {/* HOPI — History of Present Illness */}
          <Card title="History of Present Illness (HOPI)" icon="pi-calendar" color="#7c3aed">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 14px", marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Onset</label>
                {["Sudden","Gradual","Intermittent"].map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
                    <input type="radio" checked={hopi.onset === opt} onChange={() => setHopi(p => ({ ...p, onset: opt }))}
                      style={{ accentColor: "#7c3aed" }} />
                    {opt}
                  </label>
                ))}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Duration</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={hopi.durationValue} onChange={e => setHopi(p => ({ ...p, durationValue: e.target.value }))}
                    placeholder="e.g. 3"
                    style={{ width: "45%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "inherit" }} />
                  <select value={hopi.durationUnit} onChange={e => setHopi(p => ({ ...p, durationUnit: e.target.value }))}
                    style={{ width: "55%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 8px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer" }}>
                    {["Hours","Days","Weeks","Months"].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Progression</label>
                <select value={hopi.progression} onChange={e => setHopi(p => ({ ...p, progression: e.target.value }))}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer" }}>
                  <option value="">Select…</option>
                  {["Improving","Stable","Worsening","Fluctuating"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Character of Complaint</label>
                <input value={hopi.character} onChange={e => setHopi(p => ({ ...p, character: e.target.value }))}
                  placeholder="Sharp / Dull / Burning…"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "10px 14px" }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Associated Symptoms</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px" }}>
                  {["Fever","Vomiting","Nausea","Diarrhea","Cough","Headache","Dizziness","Dyspnea","Chest Pain","Abdominal Pain","Weakness","Loss of Appetite"].map(sym => (
                    <label key={sym} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox"
                        checked={hopi.associatedSymptoms.includes(sym)}
                        onChange={e => {
                          const arr = e.target.checked
                            ? [...hopi.associatedSymptoms, sym]
                            : hopi.associatedSymptoms.filter(s => s !== sym);
                          setHopi(p => ({ ...p, associatedSymptoms: arr }));
                        }}
                        style={{ accentColor: "#7c3aed" }} />
                      {sym}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Aggravating Factors</label>
                <textarea value={hopi.aggravating} onChange={e => setHopi(p => ({ ...p, aggravating: e.target.value }))}
                  placeholder="What makes it worse…" rows={3}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Relieving Factors</label>
                <textarea value={hopi.relieving} onChange={e => setHopi(p => ({ ...p, relieving: e.target.value }))}
                  placeholder="What makes it better…" rows={3}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
          </Card>

          {/* Chronic Illnesses */}
          <Card title="Chronic Illnesses / Past Medical History" icon="pi-heart-fill" color={C.danger}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginBottom: 12 }}>
              {["DM (Diabetes)","HTN (Hypertension)","CAD / IHD","CKD","COPD","Asthma","Epilepsy","Hypothyroidism","Hyperthyroidism","TB","Stroke","Cancer"].map(cond => {
                const entry = chronic.conditions.find(c => c.condition === cond);
                return (
                  <label key={cond} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!entry}
                      onChange={e => {
                        const arr = e.target.checked
                          ? [...chronic.conditions, { condition: cond, duration: "" }]
                          : chronic.conditions.filter(c => c.condition !== cond);
                        setChronic(p => ({ ...p, conditions: arr }));
                      }}
                      style={{ accentColor: C.danger }} />
                    <span style={{ fontWeight: entry ? 700 : 400, color: entry ? C.danger : C.dark }}>{cond}</span>
                    {entry && (
                      <input value={entry.duration}
                        onChange={e => {
                          const arr = chronic.conditions.map(c => c.condition === cond ? { ...c, duration: e.target.value } : c);
                          setChronic(p => ({ ...p, conditions: arr }));
                        }}
                        placeholder="Since…"
                        onClick={ev => ev.stopPropagation()}
                        style={{ width: 70, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 6px", fontSize: 11, marginLeft: 3, outline: "none", fontFamily: "inherit" }} />
                    )}
                  </label>
                );
              })}
            </div>
            <Field label="Other conditions / Surgical History">
              <Input value={chronic.others} onChange={v => setChronic(p => ({ ...p, others: v }))}
                placeholder="Other conditions, previous surgeries, major illnesses…" />
            </Field>
          </Card>

          {/* ─── Obstetric & Gynaecological History ──────────────────
              Surfaces ONLY for cases where it actually matters: female
              patients, or any consult tagged Gynae / Obstetrics / OBG /
              Women's Health regardless of patient gender (covers cases
              like trans / non-binary patients seen for gynae issues).
              The data is structured (24 fields) so a future Gynae
              referral letter or pre-natal record can pull from it. */}
          {(() => {
            const dept = String(visit?.department || "").toLowerCase();
            const isFemale = String(visit?.gender || "").toLowerCase() === "female";
            const isGynaeDept = /gynae|obstetric|obg|women/.test(dept);
            if (!isFemale && !isGynaeDept) return null;
            return (
              <Card title="Obstetric & Gynaecological History" icon="pi-female" color="#be185d">
                {/* Menstrual history */}
                <div style={{ fontSize: 11, fontWeight: 800, color: "#be185d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Menstrual
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
                  <Field label="LMP (Last Menstrual Period)">
                    <input type="date" value={obg.lmp}
                      onChange={e => setObg(p => ({ ...p, lmp: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </Field>
                  <Field label="EDD (if pregnant)">
                    <input type="date" value={obg.edd}
                      onChange={e => setObg(p => ({ ...p, edd: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </Field>
                  <Field label="Menarche (age yrs)">
                    <Input type="number" value={obg.menarche}
                      onChange={v => setObg(p => ({ ...p, menarche: v }))}
                      placeholder="e.g. 13" />
                  </Field>
                  <Field label="Cycle / Flow (days)">
                    <div style={{ display: "flex", gap: 6 }}>
                      <input type="number" value={obg.cycleLength}
                        onChange={e => setObg(p => ({ ...p, cycleLength: e.target.value }))}
                        placeholder="28"
                        style={{ width: "50%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                      <span style={{ alignSelf: "center", fontSize: 12, color: C.muted }}>/</span>
                      <input type="number" value={obg.flowDays}
                        onChange={e => setObg(p => ({ ...p, flowDays: e.target.value }))}
                        placeholder="4"
                        style={{ width: "50%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                    </div>
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
                  <Field label="Regularity">
                    <select value={obg.regularity} onChange={e => setObg(p => ({ ...p, regularity: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="Regular">Regular</option>
                      <option value="Irregular">Irregular</option>
                      <option value="Oligomenorrhea">Oligomenorrhea</option>
                      <option value="Polymenorrhea">Polymenorrhea</option>
                      <option value="Amenorrhea">Amenorrhea</option>
                    </select>
                  </Field>
                  <Field label="Dysmenorrhea">
                    <select value={obg.dysmenorrhea} onChange={e => setObg(p => ({ ...p, dysmenorrhea: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="None">None</option>
                      <option value="Mild">Mild</option>
                      <option value="Moderate">Moderate</option>
                      <option value="Severe">Severe</option>
                    </select>
                  </Field>
                  <Field label="Menopausal status">
                    <select value={obg.menopause} onChange={e => setObg(p => ({ ...p, menopause: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="Pre-menopausal">Pre-menopausal</option>
                      <option value="Peri-menopausal">Peri-menopausal</option>
                      <option value="Post-menopausal">Post-menopausal</option>
                    </select>
                  </Field>
                </div>

                {/* Obstetric history — G/P/A/L formula */}
                <div style={{ fontSize: 11, fontWeight: 800, color: "#be185d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Obstetric (G / P / A / L)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
                  <Field label="Gravida (G)">
                    <Input type="number" value={obg.gravida}
                      onChange={v => setObg(p => ({ ...p, gravida: v }))}
                      placeholder="Total pregnancies" />
                  </Field>
                  <Field label="Para (P)">
                    <Input type="number" value={obg.para}
                      onChange={v => setObg(p => ({ ...p, para: v }))}
                      placeholder="Births ≥ 20 wk" />
                  </Field>
                  <Field label="Abortion (A)">
                    <Input type="number" value={obg.abortion}
                      onChange={v => setObg(p => ({ ...p, abortion: v }))}
                      placeholder="Spontaneous + induced" />
                  </Field>
                  <Field label="Living children (L)">
                    <Input type="number" value={obg.living}
                      onChange={v => setObg(p => ({ ...p, living: v }))}
                      placeholder="Alive today" />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
                  <Field label="Last child birth">
                    <input type="date" value={obg.lastChildBirth}
                      onChange={e => setObg(p => ({ ...p, lastChildBirth: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </Field>
                  <Field label="Mode of last delivery">
                    <select value={obg.deliveryMode} onChange={e => setObg(p => ({ ...p, deliveryMode: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="Normal vaginal">Normal vaginal</option>
                      <option value="LSCS">LSCS</option>
                      <option value="Forceps">Forceps</option>
                      <option value="Vacuum">Vacuum</option>
                      <option value="Breech">Breech</option>
                      <option value="Twin">Twin</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="Obstetric complications">
                    <Input value={obg.obComplications}
                      onChange={v => setObg(p => ({ ...p, obComplications: v }))}
                      placeholder="GDM, PIH, PPH, stillbirth…" />
                  </Field>
                </div>

                {/* Marital + Contraception + Past Gynae */}
                <div style={{ fontSize: 11, fontWeight: 800, color: "#be185d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Marital · Contraception · Past Gynae
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
                  <Field label="Married">
                    <select value={obg.married} onChange={e => setObg(p => ({ ...p, married: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Widowed">Widowed</option>
                      <option value="Divorced">Divorced</option>
                    </select>
                  </Field>
                  <Field label="Years married">
                    <Input type="number" value={obg.yearsMarried}
                      onChange={v => setObg(p => ({ ...p, yearsMarried: v }))}
                      placeholder="e.g. 7" />
                  </Field>
                  <Field label="Contraception">
                    <select value={obg.contraception} onChange={e => setObg(p => ({ ...p, contraception: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                      <option value="">—</option>
                      <option value="None">None</option>
                      <option value="OCP">OCP — Oral Contraceptive</option>
                      <option value="IUCD">IUCD / Copper-T</option>
                      <option value="Tubectomy">Tubectomy</option>
                      <option value="Vasectomy">Vasectomy (partner)</option>
                      <option value="Barrier">Barrier (Condom / Diaphragm)</option>
                      <option value="Injection">Hormonal Injection</option>
                      <option value="Implant">Implant</option>
                      <option value="Natural">Natural / Rhythm</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="Last Pap smear">
                    <input type="date" value={obg.lastPapSmear}
                      onChange={e => setObg(p => ({ ...p, lastPapSmear: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
                  <Field label="Last USG">
                    <input type="date" value={obg.lastUSG}
                      onChange={e => setObg(p => ({ ...p, lastUSG: e.target.value }))}
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </Field>
                  <Field label="Prior gynae surgery">
                    <Input value={obg.priorSurgery}
                      onChange={v => setObg(p => ({ ...p, priorSurgery: v }))}
                      placeholder="D&C, hysterectomy, myomectomy, LSCS yr…" />
                  </Field>
                </div>
                <Field label="Additional notes">
                  <Textarea value={obg.notes}
                    onChange={v => setObg(p => ({ ...p, notes: v }))}
                    placeholder="Discharge, IMB, dyspareunia, infertility workup, family planning counselling, vaccination status (HPV / Tdap)…"
                    rows={2} />
                </Field>
              </Card>
            );
          })()}

          {/* SOAP */}
          <Card title="SOAP Assessment" icon="pi-file-edit" color={C.doctor} badge="NABH">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="S — Subjective (Chief Complaint)">
                <Textarea value={soap.subjectiveNote} onChange={v => setSoap(p => ({ ...p, subjectiveNote: v }))}
                  placeholder={visit?.chiefComplaint || "Chief complaint, history…"} rows={4} />
              </Field>
              <Field label="O — Objective (Examination)">
                <Textarea value={soap.objectiveNote} onChange={v => setSoap(p => ({ ...p, objectiveNote: v }))}
                  placeholder="Physical findings, vitals, lab…" rows={4} />
              </Field>
              <Field label="A — Assessment (Diagnosis)">
                <Textarea value={soap.assessmentNote} onChange={v => setSoap(p => ({ ...p, assessmentNote: v }))}
                  placeholder="Clinical assessment, differentials…" rows={4} />
              </Field>
              <Field label="P — Plan">
                <Textarea value={soap.planNote} onChange={v => setSoap(p => ({ ...p, planNote: v }))}
                  placeholder="Treatment plan, medications, follow-up…" rows={4} />
              </Field>
            </div>
          </Card>

          {/* ─── Clinical Examination (structured) ─────────────────
              Doctor-of-the-day checklist replaces the old free-text
              boxes: tick the common findings (Pallor / Icterus / Edema
              etc.) and the severity, drop a one-liner in "Other"
              for anything not in the list. Same idea on the systemic
              side — 4 mini blocks for CVS / RS / CNS / P-A each with
              their typical quick-picks. The free-text "Other findings"
              still lives at the bottom so a surgical reg can paste
              an entire detailed exam if needed.
              All structured fields live under soap.genExam /
              soap.sysExam — the existing soap.generalExamination /
              soap.systemicExamination free-text fields are kept for
              backward compat + the "Other findings" textareas below. */}
          <Card title="Clinical Examination" icon="pi-search" color={C.primary}>
            {/* ── General Examination ── */}
            <div style={{ fontSize: 11, fontWeight: 800, color: C.primary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              General Examination
            </div>

            {/* Row 1 — categorical dropdowns */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
              {[
                ["Built",         "built",         ["Average","Lean","Obese","Cachectic"]],
                ["Nourishment",   "nourishment",   ["Well-nourished","Moderate","Poor"]],
                ["Consciousness", "consciousness", ["Conscious","Drowsy","Stuporous","Comatose"]],
                ["Orientation",   "orientation",   ["Oriented","Disoriented (Time)","Disoriented (Place)","Disoriented (Person)"]],
              ].map(([lbl, key, opts]) => (
                <Field key={key} label={lbl}>
                  <select value={soap.genExam[key]}
                    onChange={e => setSoap(p => ({ ...p, genExam: { ...p.genExam, [key]: e.target.value } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">—</option>
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              ))}
            </div>

            {/* Row 2 — severity-scaled findings + JVP */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
              {[
                ["Pallor",      "pallor",      ["None","+","++","+++"]],
                ["Pedal Edema", "pedalEdema",  ["None","+ Pitting","++ Pitting","+++ Pitting","Non-pitting"]],
                ["Hydration",   "hydration",   ["Well hydrated","Mild dehydration","Moderate","Severe"]],
                ["JVP",         "jvp",         ["Normal","Raised"]],
              ].map(([lbl, key, opts]) => (
                <Field key={key} label={lbl}>
                  <select value={soap.genExam[key]}
                    onChange={e => setSoap(p => ({ ...p, genExam: { ...p.genExam, [key]: e.target.value } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">—</option>
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              ))}
            </div>

            {/* Row 3 — quick checkbox findings */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", padding: "10px 12px", background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10 }}>
              {[
                ["Icterus",         "icterus"],
                ["Cyanosis",        "cyanosis"],
                ["Clubbing",        "clubbing"],
                ["Lymphadenopathy", "lymphadenopathy"],
                ["Febrile",         "febrile"],
              ].map(([lbl, key]) => (
                <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox"
                    checked={!!soap.genExam[key]}
                    onChange={e => setSoap(p => ({ ...p, genExam: { ...p.genExam, [key]: e.target.checked } }))} />
                  {lbl}
                </label>
              ))}
            </div>

            {/* Conditional: lymph node location if lymphadenopathy ticked */}
            {soap.genExam.lymphadenopathy && (
              <div style={{ marginBottom: 10 }}>
                <Field label="Lymph node location">
                  <Input value={soap.genExam.lymphLocation}
                    onChange={v => setSoap(p => ({ ...p, genExam: { ...p.genExam, lymphLocation: v } }))}
                    placeholder="e.g. Cervical, axillary, inguinal — single / matted / firm…" />
                </Field>
              </div>
            )}

            {/* Other gen-ex findings (free text) */}
            <Field label="Other General Findings">
              <Textarea value={soap.generalExamination}
                onChange={v => setSoap(p => ({ ...p, generalExamination: v }))}
                placeholder="Anything not in the standard checklist (skin lesions, pulse character, scars, oedema location, etc.)"
                rows={2} />
            </Field>

            {/* ── Systemic Examination ── */}
            <div style={{ fontSize: 11, fontWeight: 800, color: C.primary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 }}>
              Systemic Examination
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* CVS */}
              <div style={{ padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>♥ CVS — Cardiovascular</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                  <select value={soap.sysExam.cvs.s1s2}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cvs: { ...p.sysExam.cvs, s1s2: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">S1 S2 —</option>
                    <option>S1 S2 Normal</option>
                    <option>S1 S2 Muffled</option>
                    <option>S1 S2 Abnormal</option>
                  </select>
                  <select value={soap.sysExam.cvs.rhythm}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cvs: { ...p.sysExam.cvs, rhythm: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Rhythm —</option>
                    <option>Regular</option>
                    <option>Irregular</option>
                  </select>
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
                  <input type="checkbox" checked={soap.sysExam.cvs.murmur}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cvs: { ...p.sysExam.cvs, murmur: e.target.checked } } }))} />
                  Murmur
                </label>
                {soap.sysExam.cvs.murmur && (
                  <input value={soap.sysExam.cvs.murmurDetails}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cvs: { ...p.sysExam.cvs, murmurDetails: e.target.value } } }))}
                    placeholder="Site, grade, systolic/diastolic, radiation…"
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }} />
                )}
                <input value={soap.sysExam.cvs.other}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cvs: { ...p.sysExam.cvs, other: e.target.value } } }))}
                  placeholder="Other CVS findings"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
              </div>

              {/* RS */}
              <div style={{ padding: "10px 12px", background: "#ecfeff", border: "1px solid #67e8f9", borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🫁 RS — Respiratory</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                  <select value={soap.sysExam.rs.airEntry}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, rs: { ...p.sysExam.rs, airEntry: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Air entry —</option>
                    <option>B/L equal</option>
                    <option>Decreased R</option>
                    <option>Decreased L</option>
                    <option>Unequal</option>
                  </select>
                  <select value={soap.sysExam.rs.breathSounds}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, rs: { ...p.sysExam.rs, breathSounds: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Breath sounds —</option>
                    <option>Vesicular</option>
                    <option>Bronchial</option>
                    <option>Broncho-vesicular</option>
                    <option>Diminished</option>
                  </select>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
                  {[["Crepts","crepts"],["Wheeze","wheeze"],["Rhonchi","rhonchi"]].map(([lbl, k]) => (
                    <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={soap.sysExam.rs[k]}
                        onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, rs: { ...p.sysExam.rs, [k]: e.target.checked } } }))} />
                      {lbl}
                    </label>
                  ))}
                </div>
                <input value={soap.sysExam.rs.other}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, rs: { ...p.sysExam.rs, other: e.target.value } } }))}
                  placeholder="Other RS findings"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
              </div>

              {/* CNS */}
              <div style={{ padding: "10px 12px", background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🧠 CNS — Neurological</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                  <input value={soap.sysExam.cns.gcs}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, gcs: e.target.value } } }))}
                    placeholder="GCS (E4V5M6)"
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
                  <select value={soap.sysExam.cns.speech}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, speech: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Speech —</option>
                    <option>Normal</option>
                    <option>Slurred</option>
                    <option>Aphasia (Expressive)</option>
                    <option>Aphasia (Receptive)</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                  <select value={soap.sysExam.cns.tone}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, tone: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Tone —</option>
                    <option>Normal</option>
                    <option>Hypertonia</option>
                    <option>Hypotonia</option>
                  </select>
                  <select value={soap.sysExam.cns.reflexes}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, reflexes: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Reflexes —</option>
                    <option>Normal</option>
                    <option>Brisk</option>
                    <option>Absent</option>
                  </select>
                  <select value={soap.sysExam.cns.plantar}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, plantar: e.target.value } } }))}
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}>
                    <option value="">Plantar —</option>
                    <option>Flexor</option>
                    <option>Extensor</option>
                    <option>Equivocal</option>
                  </select>
                </div>
                <input value={soap.sysExam.cns.power}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, power: e.target.value } } }))}
                  placeholder="Power (e.g. 5/5 all limbs, or 3/5 R UL)"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }} />
                <input value={soap.sysExam.cns.other}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, cns: { ...p.sysExam.cns, other: e.target.value } } }))}
                  placeholder="Other CNS findings"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
              </div>

              {/* P/A — Abdomen */}
              <div style={{ padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#a16207", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🫃 P/A — Per Abdomen</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
                  {[["Soft","soft"],["Tender","tender"],["Distended","distended"],["Organomegaly","organomegaly"],["Mass","mass"]].map(([lbl, k]) => (
                    <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={soap.sysExam.pa[k]}
                        onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, pa: { ...p.sysExam.pa, [k]: e.target.checked } } }))} />
                      {lbl}
                    </label>
                  ))}
                </div>
                <select value={soap.sysExam.pa.bowelSounds}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, pa: { ...p.sysExam.pa, bowelSounds: e.target.value } } }))}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff", marginBottom: 6 }}>
                  <option value="">Bowel sounds —</option>
                  <option>Present</option>
                  <option>Sluggish</option>
                  <option>Absent</option>
                  <option>Hyperactive</option>
                </select>
                {soap.sysExam.pa.tender && (
                  <input value={soap.sysExam.pa.tenderLocation}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, pa: { ...p.sysExam.pa, tenderLocation: e.target.value } } }))}
                    placeholder="Tenderness location (RIF, epigastric, McBurney's…)"
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }} />
                )}
                {soap.sysExam.pa.organomegaly && (
                  <input value={soap.sysExam.pa.organomegalyDetails}
                    onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, pa: { ...p.sysExam.pa, organomegalyDetails: e.target.value } } }))}
                    placeholder="Organomegaly (Hepato- / Spleno- + size in cm)"
                    style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }} />
                )}
                <input value={soap.sysExam.pa.other}
                  onChange={e => setSoap(p => ({ ...p, sysExam: { ...p.sysExam, pa: { ...p.sysExam.pa, other: e.target.value } } }))}
                  placeholder="Other P/A findings"
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
              </div>
            </div>

            {/* Catch-all for systems not covered above */}
            <div style={{ marginTop: 10 }}>
              <Field label="Other Systemic Findings (ENT, Musculoskeletal, Skin, etc.)">
                <Textarea value={soap.systemicExamination}
                  onChange={v => setSoap(p => ({ ...p, systemicExamination: v }))}
                  placeholder="Anything not covered by the CVS / RS / CNS / P-A blocks above"
                  rows={2} />
              </Field>
            </div>
          </Card>

          {/* ─── Diagnosis (Provisional → Working → Final) ──────────
              Per user's clinical convention, the OPD/IPD chart should
              carry THREE distinct diagnosis tiers:
                • Provisional — best guess at first contact
                • Working     — current best impression as lab/imaging
                                results refine the picture
                • Final       — confirmed at discharge / case closure
              Each row pairs a free-text description with the ICD-10
              code so the coding desk, insurance claim, and hospital
              epidemiology stats all align to a real ontology rather
              than "viral fever" vs "URTI" vs "fever NOS" free-text
              chaos.
              Advice / Follow-up / Additional Notes that used to live
              here have moved to the SOAP card's Plan section — they
              were duplicating that field. */}
          {/* Visual style matches the Doctor Notes "Patient Diagnosis"
              panel so the same fields look the same wherever the doctor
              edits them — orange Provisional, blue Working, green Final,
              purple ICD-10 row, and a status pill strip. Wrapped in the
              OPD page's <Card> so collapsibility + section ordering stay
              consistent with the rest of the OPD slip. */}
          <Card title="Patient Diagnosis" icon="pi-bookmark" color="#1d4ed8">
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500, marginBottom: 12, marginTop: -6 }}>
              Provisional → Working → Final + ICD-10 coding
            </div>

            {/* Three diagnosis tiers — color-coded by clinical certainty */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {/* Provisional (orange) — first-contact impression */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: ".6px" }}>Provisional Dx *</span>
                </div>
                <input
                  value={soap.provisionalDiagnosis}
                  onChange={e => setSoap(p => ({ ...p, provisionalDiagnosis: e.target.value }))}
                  placeholder="Suspected diagnosis on first contact"
                  style={{ width: "100%", border: "1.5px solid #fcd34d", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#fffbeb", boxSizing: "border-box" }}
                />
              </div>
              {/* Working (blue) — evolving impression */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".6px" }}>Working Dx</span>
                </div>
                <input
                  value={soap.workingDiagnosis}
                  onChange={e => setSoap(p => ({ ...p, workingDiagnosis: e.target.value }))}
                  placeholder="Current evolving diagnosis"
                  style={{ width: "100%", border: "1.5px solid #93c5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#eff6ff", boxSizing: "border-box" }}
                />
              </div>
              {/* Final (green) — confirmed at closure */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: ".6px" }}>Final Dx</span>
                </div>
                <input
                  value={soap.finalDiagnosis}
                  onChange={e => setSoap(p => ({ ...p, finalDiagnosis: e.target.value }))}
                  placeholder="Confirmed final diagnosis"
                  style={{ width: "100%", border: "1.5px solid #86efac", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#f0fdf4", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* ICD-10 row — single coding applied to the episode */}
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Code</span>
                </div>
                <input
                  value={soap.icd10Code}
                  onChange={e => setSoap(p => ({ ...p, icd10Code: e.target.value }))}
                  placeholder="e.g. J18.9"
                  style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: "#5b21b6", outline: "none", background: "#faf5ff", boxSizing: "border-box", letterSpacing: ".5px" }}
                />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Description</span>
                </div>
                <input
                  value={soap.icd10Description}
                  onChange={e => setSoap(p => ({ ...p, icd10Description: e.target.value }))}
                  placeholder="e.g. Unspecified pneumonia, AGE with dehydration, Type 2 DM…"
                  style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#faf5ff", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* Patient status chips — clinical trajectory at a glance.
                Click an already-selected chip to clear it (toggle), since
                "no status set" is a valid state for an OPD walk-in. */}
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>Patient Status:</span>
              {["Stable","Improving","Unchanged","Deteriorating","Critical","Ready for Discharge"].map(s => (
                <button key={s} type="button"
                  onClick={() => setSoap(p => ({ ...p, patientStatus: p.patientStatus === s ? "" : s }))}
                  style={{
                    padding: "4px 13px", borderRadius: 20,
                    border: `1.5px solid ${soap.patientStatus === s ? "#2563eb" : "#e2e8f0"}`,
                    background: soap.patientStatus === s ? "#2563eb" : "white",
                    color: soap.patientStatus === s ? "white" : "#64748b",
                    fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s ease",
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </Card>

          {/* Prescription */}
          <Card title="Prescription" icon="pi-pencil" color={C.warn}>
            {/* Grid widened to 7 cells (Med | Dose | Freq | Meal | Duration | Route | + Add).
                Each fr column wrapped in minmax(0, …) so cells actually
                shrink to their fr share instead of defaulting to
                min-content (which left the Medicine column collapsed
                to ~20px and unusable). Med gets 1.8fr because the
                auto-completed name (e.g. "Tab Paracetamol 500mg") is
                the longest string. */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(0,0.7fr) minmax(0,1fr) minmax(0,0.95fr) minmax(0,0.95fr) minmax(0,1fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
              {/* Medicine name now searches the pharmacy drug master so the
                  doctor picks a real SKU instead of free-typing. Picking
                  a row mirrors generic + strength into dose, and brand
                  spelling is locked to whatever pharmacy stocks. */}
              <DrugAutocomplete
                value={newMed.name}
                onChange={(v) => setNewMed(p => ({ ...p, name: v }))}
                onPick={(d) => {
                  setNewMed(p => {
                    // Write the form-prefixed name into Medicine (per Indian
                    // Rx convention: "Tab Paracetamol 500mg", "Cap Amoxicillin
                    // 500mg", "Syp Crocin 60ml"). The dose / generic / form
                    // mirrored alongside so audit + print receipt have the
                    // structured fields too — Medicine is the human-readable
                    // line; the others power downstream automation.
                    const next = { ...p, name: drugDisplayName(d) };
                    if (d.genericName) next.genericName = d.genericName;
                    const { value, unit } = parseStrength(d.strength);
                    if (value && unit) next.dose = `${value}${unit}`;
                    else if (d.strength) next.dose = d.strength;
                    if (d.form) next.form = d.form;
                    return next;
                  });
                }}
                placeholder="Medicine * — start typing"
                inputStyle={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, width: "100%" }}
                inputClassName=""
                showLabel={false}
              />
              {/* Dose — free text; doctor types "500mg", "5ml", "1 tab", etc.
                  Pre-filled by the autocomplete pick handler from drug.strength. */}
              <input
                value={newMed.dose}
                onChange={e => setNewMed(p => ({ ...p, dose: e.target.value }))}
                placeholder="Dose"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              {/* Frequency — common Indian Rx schedules. <select> with empty
                  default so the doctor sees "Frequency" placeholder until
                  picking. Covers everything from STAT (single dose) through
                  multi-times-daily, hourly, and as-needed (SOS/PRN). The
                  ─── divider options force a logical grouping inside the
                  native dropdown without needing optgroup overhead. */}
              <select
                value={newMed.frequency}
                onChange={e => setNewMed(p => ({ ...p, frequency: e.target.value }))}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.frequency ? C.dark : "#94a3b8", background: "#fff" }}
              >
                <option value="">Frequency</option>
                <optgroup label="Common">
                  <option value="OD">OD — Once daily</option>
                  <option value="BD">BD — Twice daily (1-0-1)</option>
                  <option value="TDS">TDS — Thrice daily (1-1-1)</option>
                  <option value="QID">QID — Four times daily</option>
                  <option value="HS">HS — At bedtime</option>
                  <option value="SOS">SOS — As needed (PRN)</option>
                  <option value="Stat">Stat — Single dose now</option>
                  {/* Common combo for symptomatic relief — e.g. pain meds,
                      antihistamines, anti-nausea: give the first dose
                      immediately, repeat only if the symptom returns. */}
                  <option value="Stat & SOS">Stat & SOS — First dose now, repeat PRN</option>
                </optgroup>
                <optgroup label="Hourly">
                  <option value="q1h">q1h — Every 1 hour</option>
                  <option value="q2h">q2h — Every 2 hours</option>
                  <option value="q4h">q4h — Every 4 hours</option>
                  <option value="q6h">q6h — Every 6 hours</option>
                  <option value="q8h">q8h — Every 8 hours</option>
                  <option value="q12h">q12h — Every 12 hours</option>
                </optgroup>
                <optgroup label="Less frequent">
                  <option value="Alt day">Alt day — Every other day</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Twice weekly">Twice weekly</option>
                  <option value="Monthly">Monthly</option>
                </optgroup>
              </select>
              {/* Meal status — separate from Frequency because they answer
                  different questions. Frequency = how often (TDS / BD /
                  q6h …); Meal = relative to food (after / before / with /
                  empty stomach / bedtime). Empty option lets the doctor
                  leave it unspecified (most acute meds don't care).
                  The shown labels include the Latin/abbreviated form in
                  parentheses so PC / AC / HS still work as a quick
                  visual cue. */}
              <select
                value={newMed.mealStatus}
                onChange={e => setNewMed(p => ({ ...p, mealStatus: e.target.value }))}
                title="Meal status"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.mealStatus ? C.dark : "#94a3b8", background: "#fff" }}
              >
                <option value="">Meal status</option>
                <option value="After Food">After Food (PC)</option>
                <option value="Before Food">Before Food (AC)</option>
                <option value="With Food">With Food</option>
                <option value="Empty Stomach">Empty Stomach</option>
                <option value="Before Breakfast">Before Breakfast (BBF)</option>
                <option value="After Breakfast">After Breakfast (ABF)</option>
                <option value="Bedtime">At Bedtime (HS)</option>
                <option value="Any Time">Any Time</option>
              </select>
              {/* Duration — common course lengths. Free-text via datalist so
                  the doctor can pick "5 days" / "1 week" with one click but
                  also type "Until reviewed" or a custom value. Datalist
                  options appear as a native dropdown below the input. */}
              <input
                list="rx-duration-options"
                value={newMed.duration}
                onChange={e => setNewMed(p => ({ ...p, duration: e.target.value }))}
                placeholder="Duration"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <datalist id="rx-duration-options">
                <option value="1 day" />
                <option value="3 days" />
                <option value="5 days" />
                <option value="7 days" />
                <option value="10 days" />
                <option value="14 days" />
                <option value="1 week" />
                <option value="2 weeks" />
                <option value="3 weeks" />
                <option value="1 month" />
                <option value="2 months" />
                <option value="3 months" />
                <option value="6 months" />
                <option value="1 year" />
                <option value="Single dose" />
                <option value="Until reviewed" />
                <option value="Continuous / Long-term" />
              </datalist>
              {/* Route — WHO administration routes. Default "Oral" since
                  that's >80% of OPD prescriptions; doctor changes only when
                  IV/IM/topical applies. */}
              <select
                value={newMed.route}
                onChange={e => setNewMed(p => ({ ...p, route: e.target.value }))}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.route ? C.dark : "#94a3b8", background: "#fff" }}
              >
                <option value="">Route</option>
                <optgroup label="Enteral">
                  <option value="Oral">Oral (PO)</option>
                  <option value="Sublingual">Sublingual (SL)</option>
                  <option value="Buccal">Buccal</option>
                  <option value="NG Tube">NG Tube</option>
                  <option value="PEG Tube">PEG Tube</option>
                  <option value="Per Rectum">Per Rectum (PR)</option>
                </optgroup>
                <optgroup label="Parenteral">
                  <option value="IV">IV — Intravenous</option>
                  <option value="IM">IM — Intramuscular</option>
                  <option value="SC">SC — Subcutaneous</option>
                  <option value="Intradermal">Intradermal (ID)</option>
                  <option value="Intra-articular">Intra-articular</option>
                  <option value="Epidural">Epidural</option>
                  <option value="Spinal">Spinal / Intrathecal</option>
                </optgroup>
                <optgroup label="Topical / Local">
                  <option value="Topical">Topical (skin)</option>
                  <option value="Transdermal">Transdermal Patch</option>
                  <option value="Eye drops">Eye drops</option>
                  <option value="Ear drops">Ear drops</option>
                  <option value="Nasal">Nasal</option>
                  <option value="Inhalation">Inhalation</option>
                  <option value="Nebulization">Nebulization</option>
                  <option value="Per Vagina">Per Vagina (PV)</option>
                  <option value="Local infiltration">Local infiltration</option>
                </optgroup>
              </select>
              {/* R7az-D4-HIGH-2: disable while a previous Add is in flight to
                  block double-tap duplicates. */}
              <button onClick={addMed} disabled={isAddingMed} style={{ background: C.warn, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: isAddingMed ? "wait" : "pointer", fontWeight: 600, fontSize: 12, opacity: isAddingMed ? 0.6 : 1 }}>
                {isAddingMed ? "Adding…" : "+ Add"}
              </button>
            </div>
            {meds.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No medications prescribed.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Medicine","Dose","Frequency","Meal","Duration","Route"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                  {/* Trailing action column — narrow, right-aligned. No
                      heading text (icon-only column header would just be
                      noise) but kept on the header row so column widths
                      align with the body rows below. */}
                  <th style={{ width: 36, borderBottom: `1px solid ${C.border}` }} aria-label="Remove" />
                </tr></thead>
                <tbody>{meds.map((m, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["name","dose","frequency","mealStatus","duration","route"].map(k => (
                      <td key={k} style={{ padding: "7px 10px", color: C.dark }}>{m[k] || "—"}</td>
                    ))}
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => removeMed(i)}
                        title={`Remove ${m.name || "this medication"}`}
                        aria-label="Remove medication"
                        style={{
                          width: 24, height: 24, border: "1px solid #fca5a5",
                          background: "#fef2f2", color: "#b91c1c",
                          borderRadius: 6, cursor: "pointer",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1,
                          padding: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#fef2f2"; }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          {/* ─── Infusions / IV Fluids (R7v) ─────────────────────────
              Sometimes an OPD or day-care patient needs IV fluids — NS
              for dehydration, KCl correction, mannitol, an insulin
              drip, etc. Captured here so the order routes correctly
              into the nurse's "Infusion Orders & Monitoring" tab (NOT
              Medication MAR — they're different things with different
              titration / monitoring requirements). Mirrors the IPD
              infusion form fields. */}
          <Card title="Infusions / IV Fluids" icon="pi-tint" color="#0d9488">
            <p style={{ color: C.muted, fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              For day-care / hydration / corrections. Routes to the nurse's
              <strong> Infusion Orders & Monitoring </strong> tab on save.
              Routine fluids are non-HAM; insulin / KCl / heparin drips auto-tag
              as <strong>HAM</strong> requiring 2-nurse verification.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 110px 100px 110px minmax(0,1.5fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <input
                value={newInfusion.name}
                onChange={e => setNewInfusion(p => ({ ...p, name: e.target.value }))}
                placeholder="Fluid / drug — e.g. NS 0.9%, RL, Insulin drip"
                list="rx-infusion-options"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <datalist id="rx-infusion-options">
                <option value="Normal Saline 0.9% (NS)" />
                <option value="Ringer Lactate (RL)" />
                <option value="Dextrose Normal Saline (DNS)" />
                <option value="5% Dextrose (D5W)" />
                <option value="25% Dextrose" />
                <option value="50% Dextrose" />
                <option value="Mannitol 20%" />
                <option value="3% Hypertonic Saline" />
                <option value="Insulin drip" />
                <option value="Heparin drip" />
                <option value="Noradrenaline drip" />
                <option value="KCl correction" />
                <option value="Magnesium Sulphate" />
                <option value="Calcium Gluconate" />
              </datalist>
              <input
                value={newInfusion.totalVolume}
                onChange={e => setNewInfusion(p => ({ ...p, totalVolume: e.target.value }))}
                placeholder="Vol (ml)"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <input
                value={newInfusion.rate}
                onChange={e => setNewInfusion(p => ({ ...p, rate: e.target.value }))}
                placeholder="Rate ml/hr *"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <input
                list="rx-infusion-duration-options"
                value={newInfusion.duration}
                onChange={e => setNewInfusion(p => ({ ...p, duration: e.target.value }))}
                placeholder="Duration"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <datalist id="rx-infusion-duration-options">
                <option value="STAT — 1 dose" />
                <option value="Over 1 hour" />
                <option value="Over 2 hours" />
                <option value="Over 4 hours" />
                <option value="Over 6 hours" />
                <option value="Over 8 hours" />
                <option value="Over 12 hours" />
                <option value="Over 24 hours" />
                <option value="Continuous — titrate" />
              </datalist>
              <input
                value={newInfusion.additives}
                onChange={e => setNewInfusion(p => ({ ...p, additives: e.target.value }))}
                placeholder="Additives / instructions (e.g. + KCl 20 mEq)"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              {/* R7az-D4-HIGH-2: disable while in-flight to block dup rows. */}
              <button
                onClick={addInfusion}
                disabled={isAddingInfusion}
                style={{ background: "#0d9488", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: isAddingInfusion ? "wait" : "pointer", fontWeight: 600, fontSize: 12, opacity: isAddingInfusion ? 0.6 : 1 }}
              >
                {isAddingInfusion ? "Adding…" : "+ Add"}
              </button>
            </div>
            {infusions.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No infusions ordered.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Fluid / Drug", "Volume", "Rate", "Duration", "Additives"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                  <th style={{ width: 36, borderBottom: `1px solid ${C.border}` }} aria-label="Remove" />
                </tr></thead>
                <tbody>{infusions.map((f, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: C.dark, fontWeight: 600 }}>{f.name || "—"}</td>
                    <td style={{ padding: "7px 10px", color: C.dark }}>{f.totalVolume ? `${f.totalVolume} ml` : "—"}</td>
                    <td style={{ padding: "7px 10px", color: C.dark, fontFamily: "'DM Mono', monospace" }}>{f.rate ? `${f.rate} ml/hr` : "—"}</td>
                    <td style={{ padding: "7px 10px", color: C.dark }}>{f.duration || "—"}</td>
                    <td style={{ padding: "7px 10px", color: C.muted, fontSize: 11 }}>{f.additives || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => removeInfusion(i)}
                        title={`Remove ${f.name || "this infusion"}`}
                        aria-label="Remove infusion"
                        style={{
                          width: 24, height: 24, border: "1px solid #fca5a5",
                          background: "#fef2f2", color: "#b91c1c",
                          borderRadius: 6, cursor: "pointer",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1,
                          padding: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#fef2f2"; }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          {/* ─── Unified Services & Orders → DRAFT bill ──────────────
              Replaces the old Investigation Orders + Procedures cards
              with a single space. Doctor picks ANY chargeable line
              (lab / imaging / consumable / minor procedure / consult)
              from the ServiceMaster autocomplete; clicking Add appends
              it to a DRAFT OPD bill (auto-spun-up the first time).
              Receptionist sees the same DRAFT on /reception-billing →
              clicks Generate + Collect → done. The flow eliminates the
              "doctor wrote it in notes but it never reached the cashier"
              gap that needed daily reconciliation. */}
          <Card title="Services & Orders — bills on completion" icon="pi-list" color="#0284c7">
            {/* Status banner — shows the linked DRAFT bill number so
                the doctor can verbally tell the patient "show this at
                reception". Hidden until the first add. */}
            {orderBillId && (
              <div style={{
                marginBottom: 10, padding: "8px 12px",
                background: "#f0f9ff", border: "1px solid #bae6fd",
                borderRadius: 8, fontSize: 12, color: "#075985",
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                <i className="pi pi-receipt" style={{ color: "#0284c7" }} />
                <span>
                  Linked to DRAFT bill <strong style={{ fontFamily: "'DM Mono', monospace" }}>{orderBillNum}</strong>
                  {" "}— orders appear under <strong>Active Orders</strong> and are billed to the patient only after the executing team marks them complete.
                </span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2.2fr) minmax(0,0.6fr) minmax(0,0.9fr) minmax(0,1.4fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <ServiceAutocomplete
                value={newOrder.name}
                applicableTo="OPD"
                onChange={(v) => setNewOrder(p => ({ ...p, name: v, service: null }))}
                onPick={(s) => setNewOrder(p => ({
                  ...p,
                  service: s,
                  name: `${s.serviceCode ? s.serviceCode + " · " : ""}${s.serviceName}`,
                }))}
                placeholder="Service / Investigation / Procedure — start typing"
                inputStyle={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, width: "100%" }}
                inputClassName=""
                showLabel={false}
              />
              <input
                type="number" min="1" step="1"
                value={newOrder.qty}
                onChange={e => setNewOrder(p => ({ ...p, qty: e.target.value === "" ? 1 : Number(e.target.value) }))}
                placeholder="Qty"
                title="Quantity / Units"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <select
                value={newOrder.urgency}
                onChange={e => setNewOrder(p => ({ ...p, urgency: e.target.value }))}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
              >
                <option value="Routine">Routine</option>
                <option value="Urgent">Urgent</option>
                <option value="STAT">STAT</option>
              </select>
              <input
                value={newOrder.instructions}
                onChange={e => setNewOrder(p => ({ ...p, instructions: e.target.value }))}
                placeholder="Special instructions (optional)"
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
              />
              <button
                onClick={addOrderToBill}
                disabled={orderSaving || !newOrder.service}
                title={newOrder.service ? "" : "Pick a service from the dropdown first"}
                style={{
                  background: !newOrder.service ? "#cbd5e1" : (orderSaving ? "#7dd3fc" : "#0284c7"),
                  color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px",
                  cursor: orderSaving || !newOrder.service ? "not-allowed" : "pointer",
                  fontWeight: 600, fontSize: 12,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <i className={`pi ${orderSaving ? "pi-spin pi-spinner" : "pi-plus"}`} />
                {orderSaving ? "Adding…" : "Add to Bill"}
              </button>
            </div>

            {orderItems.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                No orders yet. Pick a lab test, imaging, consumable, or minor procedure above —
                it'll go to Active Orders. The patient is only billed once the executing team confirms completion.
              </p>
            ) : (() => {
              // Split items into the two visual buckets. Backward compat:
              // legacy items (no orderStatus field) and explicit
              // "Completed" both go into "Billed". Active = pending work.
              const unwrap = toMoney;
              const isBillable = (it) => !it.orderStatus || it.orderStatus === "Completed";
              const isCancelled = (it) => it.orderStatus === "Cancelled";
              const activeOrders = orderItems.filter(it => !isBillable(it) && !isCancelled(it));
              const billedItems  = orderItems.filter(isBillable);
              const cancelledItems = orderItems.filter(isCancelled);
              const activeTotal = activeOrders.reduce((s, it) => s + unwrap(it.netAmount), 0);
              const billedTotal = billedItems.reduce((s, it) => s + unwrap(it.netAmount), 0);

              // Status pill colours mirror PharmacyIndentsPage URGENCY map.
              const STATUS_PILL = {
                Ordered:    { bg: "#dbeafe", fg: "#1d4ed8", label: "Ordered" },
                InProgress: { bg: "#fef3c7", fg: "#a16207", label: "In Progress" },
                Completed:  { bg: "#dcfce7", fg: "#15803d", label: "Billed" },
                Cancelled:  { bg: "#fee2e2", fg: "#b91c1c", label: "Cancelled" },
              };

              // Reusable row renderer so Active + Billed share identical
              // layout, only differing in the action buttons.
              const renderRow = (it) => {
                const status = it.orderStatus || "Completed"; // legacy fallback
                const pill = STATUS_PILL[status] || STATUS_PILL.Completed;
                return (
                  <tr key={it._id} style={{ borderBottom: `1px solid ${C.border}`, opacity: status === "Cancelled" ? 0.55 : 1 }}>
                    <td style={{ padding: "7px 10px", color: C.dark, fontWeight: 500 }}>
                      {it.serviceName}
                      {it.category && <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>· {it.category}</span>}
                      <span style={{
                        display: "inline-block", marginLeft: 8,
                        padding: "1px 7px", borderRadius: 999,
                        background: pill.bg, color: pill.fg,
                        fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                        letterSpacing: 0.3, verticalAlign: "middle",
                      }}>{pill.label}</span>
                    </td>
                    <td style={{ padding: "7px 10px", color: C.muted, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{it.serviceCode || "—"}</td>
                    <td style={{ padding: "7px 10px", color: C.dark, fontFamily: "'DM Mono', monospace" }}>{it.quantity ?? 1}</td>
                    <td style={{ padding: "7px 10px", color: C.muted, fontFamily: "'DM Mono', monospace" }}>
                      ₹{unwrap(it.unitPrice).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "7px 10px", color: status === "Completed" ? C.dark : C.muted, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
                      ₹{unwrap(it.netAmount).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "7px 10px", color: C.muted, fontSize: 11 }}>{it.remarks || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {/* Active orders get Complete (✓) + Cancel (⊘);
                          Billed + Cancelled rows just get a Remove (×)
                          on still-editable bills. Remove is intentionally
                          NOT shown on Completed rows — once billed, the
                          accountant refund path is the right tool. */}
                      {(status === "Ordered" || status === "InProgress") && (
                        <>
                          <button
                            type="button"
                            onClick={() => completeOrderItem(it)}
                            title={`Mark ${it.serviceName} completed (will charge ₹${unwrap(it.netAmount).toLocaleString("en-IN")} to the bill)`}
                            aria-label="Mark completed"
                            style={{
                              width: 26, height: 24, border: "1px solid #86efac",
                              background: "#ecfdf5", color: "#15803d",
                              borderRadius: 6, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "inherit", fontWeight: 700, fontSize: 12, lineHeight: 1,
                              padding: 0, marginRight: 4,
                            }}
                          >✓</button>
                          <button
                            type="button"
                            onClick={() => cancelOrderItem(it)}
                            title={`Cancel order ${it.serviceName} (audit-preserved, not charged)`}
                            aria-label="Cancel order"
                            style={{
                              width: 26, height: 24, border: "1px solid #fcd34d",
                              background: "#fffbeb", color: "#a16207",
                              borderRadius: 6, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1,
                              padding: 0,
                            }}
                          >⊘</button>
                        </>
                      )}
                      {(status !== "Ordered" && status !== "InProgress") && (
                        <button
                          type="button"
                          onClick={() => removeOrderFromBill(it)}
                          title={`Remove ${it.serviceName}`}
                          aria-label="Remove service"
                          style={{
                            width: 24, height: 24, border: "1px solid #fca5a5",
                            background: "#fef2f2", color: "#b91c1c",
                            borderRadius: 6, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1,
                            padding: 0,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "#fef2f2"; }}
                        >×</button>
                      )}
                    </td>
                  </tr>
                );
              };

              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: C.bg }}>
                    {["Service / Order","Code","Qty","Rate","Net","Notes"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                    <th style={{ width: 70, borderBottom: `1px solid ${C.border}` }} aria-label="Actions" />
                  </tr></thead>
                  <tbody>
                    {/* ── Active Orders (Ordered + InProgress) ── */}
                    {activeOrders.length > 0 && (
                      <tr style={{ background: "#eff6ff" }}>
                        <td colSpan={7} style={{ padding: "6px 10px", color: "#1d4ed8", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          <i className="pi pi-clock" style={{ marginRight: 6 }} />
                          Active Orders · {activeOrders.length} pending · ₹{activeTotal.toLocaleString("en-IN")} will bill on completion
                        </td>
                      </tr>
                    )}
                    {activeOrders.map(renderRow)}

                    {/* ── Billed (Completed) ── */}
                    {billedItems.length > 0 && (
                      <tr style={{ background: "#ecfdf5" }}>
                        <td colSpan={7} style={{ padding: "6px 10px", color: "#15803d", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
                          Billed (Completed) · {billedItems.length} item{billedItems.length === 1 ? "" : "s"}
                        </td>
                      </tr>
                    )}
                    {billedItems.map(renderRow)}

                    {/* ── Cancelled (audit-only, dimmed) ── */}
                    {cancelledItems.length > 0 && (
                      <tr style={{ background: "#fef2f2" }}>
                        <td colSpan={7} style={{ padding: "6px 10px", color: "#b91c1c", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          <i className="pi pi-ban" style={{ marginRight: 6 }} />
                          Cancelled · {cancelledItems.length} item{cancelledItems.length === 1 ? "" : "s"} (audit only, not charged)
                        </td>
                      </tr>
                    )}
                    {cancelledItems.map(renderRow)}

                    {/* ── Twin totals ── */}
                    <tr style={{ background: C.bg, fontWeight: 700, borderTop: `2px solid ${C.border}` }}>
                      <td colSpan={4} style={{ padding: "8px 10px", color: "#1d4ed8", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.4 }}>
                        Pending orders (not yet billed)
                      </td>
                      <td style={{ padding: "8px 10px", color: "#1d4ed8", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                        ₹{activeTotal.toLocaleString("en-IN")}
                      </td>
                      <td colSpan={2} />
                    </tr>
                    <tr style={{ background: C.bg, fontWeight: 700 }}>
                      <td colSpan={4} style={{ padding: "8px 10px", color: "#0f172a", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.4 }}>
                        Billed total (due now)
                      </td>
                      <td style={{ padding: "8px 10px", color: "#0f172a", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                        ₹{billedTotal.toLocaleString("en-IN")}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </Card>

          {/* The old standalone Procedures card was removed — its
              chargeable line items are now handled by the unified
              Services & Orders panel above. Major procedures with
              consent requirements should still go through the IPD
              admission + ConsentModal flow rather than walk-in OPD. */}

        </div>

        {/* RIGHT: Patient Info + Audit */}
        <div>

          <Card title="Patient Details" icon="pi-user" color={C.primary}>
            {[
              ["UHID", visit?.UHID || uhid],
              ["Visit Number", visitNumber],
              ["Visit Type", visit?.visitType || "Consultation"],
              ["Chief Complaint", visit?.chiefComplaint || "—"],
              ["Consultant", visit?.consultantName || "—"],
              ["Department", visit?.department || "—"],
              ["Token", visit?.tokenNumber ? `#${visit.tokenNumber}` : "—"],
              ["Status", visit?.status || "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontWeight: 500 }}>{label}</span>
                <span style={{ color: C.dark, fontWeight: 600, textAlign: "right", maxWidth: "55%", wordBreak: "break-word" }}>{value}</span>
              </div>
            ))}
          </Card>

          {/* Quick navigation
              R7p: "Patient Billing" removed — billing belongs to reception's
              workflow, not the doctor's prescription view. Doctor shouldn't
              be one click away from invoice screens while assessing a
              patient. The other two entries (Audit Trail, Patient History)
              are clinical-context-relevant and stay. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {[
              { label: "Full Audit Trail",  icon: "pi-list",    path: `/billing-audit-trail?uhid=${visit?.UHID || uhid}` },
              { label: "Patient History",   icon: "pi-clock",   path: `/patient-history?uhid=${visit?.UHID || uhid}` },
            ].map(l => (
              <button key={l.label} onClick={() => navigate(l.path)}
                style={{ padding: "9px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                  color: C.dark, fontWeight: 500, fontSize: 12, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8 }}>
                <i className={`pi ${l.icon}`} style={{ color: C.muted }} />{l.label}
              </button>
            ))}
          </div>

          {/* Audit Trail */}
          <Card title="Audit Trail" icon="pi-list" color={C.success} badge="LIVE">
            {audit.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: C.muted }}>
                <i className="pi pi-info-circle" style={{ fontSize: 28, marginBottom: 8, display: "block" }} />
                <p style={{ fontSize: 12, margin: 0 }}>No audit entries yet.<br />Save assessment to create first entry.</p>
              </div>
            ) : (
              <div>
                {audit.map((t, i) => <AuditItem key={t._id || i} trigger={t} />)}
                <button onClick={loadAudit} style={{ marginTop: 10, width: "100%", padding: "7px", background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <i className="pi pi-refresh" /> Refresh
                </button>
              </div>
            )}
          </Card>

        </div>
      </div>

      <FingerprintConsentModal
        open={consentModal.open}
        onClose={() => setConsentModal({ open: false, order: null })}
        procedure={consentModal.order?.orderDetails}
        patient={{ patientName: visit?.patientName, UHID: visit?.UHID || uhid, age: visit?.age, gender: visit?.gender }}
        onConfirm={async (consentData) => {
          // R7az-D4-CRIT-4 — Pre-fix: the PATCH error was silently swallowed
          // and we still flipped local state to "Obtained" + showed a success
          // toast. A 4xx/5xx left the order's consent status stale on the
          // server while the UI lied to the doctor. Now: only mutate local
          // state + close modal + show success on 2xx. On error, surface the
          // toast and keep the modal open so the doctor can retry.
          if (consentModal.order?._id) {
            try {
              const resp = await axios.patch(`${API_ENDPOINTS.BASE}/doctor-orders/${consentModal.order._id}`, {
                consentStatus: "Obtained",
                "consentData.obtainedAt": consentData.obtainedAt,
                "consentData.obtainedBy": consentData.obtainedBy,
                "consentData.fingerprintHash": consentData.fingerprintHash,
                "consentData.fingerprintVerified": consentData.fingerprintVerified,
                "consentData.witnessName": consentData.witnessName,
                "consentData.guardianName": consentData.guardianName,
                "consentData.guardianRelation": consentData.guardianRelation,
                "consentData.notes": consentData.notes,
              });
              if (resp.status !== 200 && resp.status !== 204) {
                toast.error("Consent could not be saved (unexpected response). Please retry.");
                return;
              }
            } catch (err) {
              toast.error("Consent save failed: " + (err.response?.data?.message || err.message));
              return;
            }
          }
          setProcedures(p => p.map(proc =>
            proc._id === consentModal.order?._id ? { ...proc, consentStatus: "Obtained" } : proc
          ));
          setConsentModal({ open: false, order: null });
          toast.success("Consent obtained and recorded");
        }}
      />

      {/* ── Digital Signature Setup Modal ── */}
      {showSetup && (
        <SignaturePad
          existing={signature}
          userName={(() => { try { return JSON.parse(sessionStorage.getItem("his_user")||"{}").fullName || "Doctor"; } catch { return "Doctor"; } })()}
          onSave={async (dataUrl) => {
            await saveSignature(dataUrl);
            setShowSetup(false);
            toast.success("Signature saved — auto-embedded in all documents");
          }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}
