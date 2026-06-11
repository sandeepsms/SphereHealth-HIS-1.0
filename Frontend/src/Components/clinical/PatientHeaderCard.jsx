/**
 * PatientHeaderCard
 * Shared patient banner for Doctor and Nursing panels (identical UI).
 *
 * Two modes:
 *   • Loader   — shown when no patient is selected (UHID input form)
 *   • Banner   — shown when a patient is loaded (avatar + chips + actions)
 *
 * All visuals are in PatientHeaderCard.css.
 *
 * Usage:
 *   <PatientHeaderCard
 *     patient={patient}
 *     searchUHID={searchUHID}
 *     onSearchChange={setSearchUHID}
 *     onLoad={loadPatient}
 *     loading={loading}
 *     diagnosis={diag}               // optional (doctor extended dx)
 *     latestDiagnosis={{ text, tier }} // optional (nurse pulls from doctor notes)
 *     actions={[{ label, icon, onClick, variant }]}
 *     onChangePatient={() => ...}
 *   />
 *
 * R7bi — Promoted from NursingNotes-only inline JSX to the shared
 * component used by both Doctor + Nursing. Adds:
 *   • QR code on the right (qrcode.react, client-side render only)
 *   • Separate IPD admission-number pill (chart + pharmacy use it)
 *   • DOB-derived age fallback for admissions where `age` wasn't snapshot
 *   • Optional diagnosis tier pill (Final / Working / Provisional)
 *   • Ward fallback chain — wardName → wardId.wardName → department
 */
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import useHospitalSettings from "../print/useHospitalSettings";
import PatientDevicesStrip from "./PatientDevicesStrip"; // R7hr-184
import "./PatientHeaderCard.css";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const admTypeClass = (admType) => {
  const t = (admType || "").toUpperCase();
  if (t === "EMERGENCY") return "phc-chip-emergency";
  if (t === "DAY CARE" || t === "DAYCARE") return "phc-chip-daycare";
  return "phc-chip-ipd";
};

const tierClass = (tier) => {
  if (tier === "Final")   return "phc-tier-final";
  if (tier === "Working") return "phc-tier-working";
  return "phc-tier-provisional";
};

export default function PatientHeaderCard({
  patient,
  searchUHID = "",
  onSearchChange = () => {},
  onLoad,
  loading = false,
  diagnosis = null,
  latestDiagnosis = null,
  actions = [],
  onChangePatient,
  loadPlaceholder = "UHID / Admission No...",
  loadSubtitle = "Enter UHID or Admission No to begin",
}) {
  /* R7cb-residual: hospital name for the QR sticker payload — pulled
     from settings so the QR carries the configured hospital identity. */
  const { settings: hospitalSettings } = useHospitalSettings();
  /* ───────── Loader ───────── */
  if (!patient) {
    return (
      <div className="phc-load-wrap">
        <div className="phc-load-card">
          <div className="phc-load-head">
            <div className="phc-load-icon">
              <i className="pi pi-user-plus" />
            </div>
            <div>
              <div className="phc-load-title">Load Patient</div>
              <div className="phc-load-sub">{loadSubtitle}</div>
            </div>
          </div>
          <div className="phc-load-divider" />
          <form onSubmit={onLoad} className="phc-load-form">
            <input
              className="phc-load-input"
              value={searchUHID}
              onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
              placeholder={loadPlaceholder}
              autoFocus
            />
            <button type="submit" disabled={loading} className="phc-load-btn">
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-search"}`} />
              Load Patient
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ───────── Banner ───────── */
  const patName    = patient.patientName || patient.patientId?.fullName || patient.patient?.name || "—";
  const initials   = patName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // R7bi — DOB-derived age fallback. Backend may not denormalise `age`
  // onto every admission; if a dob is present anywhere, compute years.
  const dob = patient.dob
    || patient.dateOfBirth
    || patient.patientId?.dob
    || patient.patientId?.dateOfBirth
    || patient.patient?.dob
    || patient.patient?.dateOfBirth;
  const ageFromDob = (() => {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
    return years >= 0 && years < 150 ? years : null;
  })();
  const ageRaw     = patient.patientId?.age ?? patient.age ?? patient.patient?.age ?? ageFromDob;
  const age        = ageRaw != null && ageRaw !== "" ? ageRaw : "?";
  const genderRaw  = patient.patientId?.gender || patient.gender || patient.patient?.gender || "";
  const gender     = (genderRaw[0] || "?").toUpperCase();
  const uhidVal    = patient.UHID || patient.uhid || patient.patientUHID || searchUHID || "—";
  const ipdNumVal  = patient.ipdNo || patient.admissionNumber || "—";
  const bedRaw     = patient.bedId?.bedNumber || patient.bedNumber;
  const bedVal     = bedRaw ? `Bed ${bedRaw}` : "—";
  // Ward fallback chain — denormalised wardName → populated Ward → department
  const wardVal    = patient.wardName || patient.wardId?.wardName || patient.department || "—";
  const admDate    = fmtDate(patient.admissionDate);
  // R7hr-84 — Pick the strongest available diagnosis tier so the
  // banner shows the doctor's most authoritative call. Priority is
  // Final → Working → Provisional. Sources, in order of trust:
  //   1. `diagnosis` prop (doctor's in-flight edit state on /doctor-notes)
  //   2. `latestDiagnosis` prop (pulled from saved notes on nursing side)
  //   3. patient.* legacy admittingDiagnosis fields
  const pickedDx = (() => {
    const d = diagnosis;
    if (d && (d.final || d.working || d.provisional)) {
      if (d.final)      return { tier: "Final",       text: d.final,       icd10Code: d.icd10Code, icd10Description: d.icd10Description };
      if (d.working)    return { tier: "Working",     text: d.working,     icd10Code: d.icd10Code, icd10Description: d.icd10Description };
      return              { tier: "Provisional", text: d.provisional, icd10Code: d.icd10Code, icd10Description: d.icd10Description };
    }
    if (latestDiagnosis?.text) return latestDiagnosis;
    return null;
  })();
  const diagTier   = pickedDx?.tier || null;
  const diagText   = (() => {
    if (pickedDx?.text) {
      const code = pickedDx.icd10Code ? ` · ${pickedDx.icd10Code}` : "";
      const desc = pickedDx.icd10Description ? ` — ${pickedDx.icd10Description}` : "";
      return `${pickedDx.text}${code}${desc}`;
    }
    return patient.diagnosis
      || patient.admittingDiagnosis
      || patient.provisionalDiagnosis
      || "—";
  })();
  // R7hr-85 — Build all three tiers (whichever are filled) for the
  // prominent in-banner clinical strip. Each tier carries its own text,
  // and the ICD-10 code+description are attached to the *highest* filled
  // tier (matches the doctor's intent — ICD-10 always belongs to the
  // most-final call).
  const dxTiersFull = (() => {
    // Inline helper: build an ordered array of per-tier chips from a
    // {provisional, working, final, icd10Code, icd10Description}
    // object. Used for BOTH the doctor's in-flight `diagnosis` prop
    // and the nurse's saved-notes `latestDiagnosis` prop so both
    // banners render identically (R7hr-87.1).
    const buildTiers = (src) => {
      const out = [];
      if (src.provisional) out.push({ tier: "Provisional", text: src.provisional });
      if (src.working)     out.push({ tier: "Working",     text: src.working });
      if (src.final)       out.push({ tier: "Final",       text: src.final });
      if (out.length && (src.icd10Code || src.icd10Description)) {
        out[out.length - 1].icd10Code = src.icd10Code;
        out[out.length - 1].icd10Description = src.icd10Description;
      }
      return out;
    };
    const d = diagnosis;
    if (d && (d.final || d.working || d.provisional)) return buildTiers(d);
    if (latestDiagnosis && (latestDiagnosis.final || latestDiagnosis.working || latestDiagnosis.provisional)) {
      return buildTiers(latestDiagnosis);
    }
    // Legacy single-tier shape (older callers): one chip for the
    // most-final tier the saved-notes pull supplied.
    if (latestDiagnosis?.text) {
      return [{
        tier: latestDiagnosis.tier || "Provisional",
        text: latestDiagnosis.text,
        icd10Code: latestDiagnosis.icd10Code,
        icd10Description: latestDiagnosis.icd10Description,
      }];
    }
    return [];
  })();
  // R7hr-87 — doctor's patient-status call (Stable / Improving /
  // Unchanged / Deteriorating / Critical / Ready for Discharge).
  // Comes from the in-flight doctor edit state OR from the saved-note
  // pull (latestDiagnosis.status, populated by NursingNotes).
  const patientStatus = diagnosis?.status || latestDiagnosis?.status || patient.patientStatus || "";
  const consultant = patient.attendingDoctor || patient.doctorName || patient.consultantName || "—";
  const admType    = patient.admissionType?.toUpperCase() || "IPD";
  const allergies  = (patient.allergies || patient.knownAllergies || []).filter(Boolean);
  const dayStay    = patient.admissionDate
    ? Math.floor((Date.now() - new Date(patient.admissionDate)) / (1000 * 60 * 60 * 24))
    : null;

  // R7hr-86 — Compliance state + 60s poll moved out into the shared
  // PatientAlertStrip component. Parents render that strip beside their
  // "All Sections" / nav bar so the patient card stays compact.

  /* QR payload — plain text so any phone-camera QR reader shows the
     patient's identity + key data on scan. Rendered client-side via
     qrcode.react so no PHI ever leaves the browser. */
  // R7cb-residual: drop hardcoded "SphereHealth HIS" claim from the QR
  // payload so the QR sticker carries the configured hospital name.
  // settings come from the print-side hook to avoid a context dependency
  // for a component used outside the HospitalSettingsProvider tree.
  const qrPayload = [
    (hospitalSettings && hospitalSettings.hospitalName) || "Hospital",
    `UHID: ${uhidVal}`,
    `IPD: ${ipdNumVal}`,
    `Name: ${patName}`,
    `Age/Sex: ${age}Y / ${gender}`,
    `Ward: ${wardVal}`,
    `Bed: ${bedRaw || "—"}`,
    `Adm: ${admDate}`,
    `Consultant: ${consultant}`,
    diagText !== "—" ? `Diagnosis: ${diagText}` : null,
    allergies.length > 0 ? `Allergies: ${allergies.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  // R7hr-85.1 — `dxFields` grid (Provisional / Working / Final / ICD-10
  // as separate rows) was redundant once the clinical strip below the
  // meta-row started showing every filled tier with its own pill. It
  // doubled the patient header's vertical footprint for no extra info.

  return (
    <div className="phc-card">
      <div className="phc-accent-bar" />
      <div className="phc-body">
        <div className="phc-row">
          {/* Left: avatar + core info */}
          <div className="phc-left">
            <div className="phc-avatar">
              <span className="phc-avatar-text">{initials}</span>
            </div>
            <div className="phc-info">
              <div className="phc-name-row">
                <span className="phc-name">{patName}</span>
                <span className={`phc-chip ${admTypeClass(admType)}`}>{admType}</span>
                {patient.bloodGroup && patient.bloodGroup !== "Unknown" && (
                  <span className="phc-chip phc-chip-blood">🩸 {patient.bloodGroup}</span>
                )}
                {dayStay !== null && (
                  <span className="phc-chip phc-chip-day">Day {dayStay + 1}</span>
                )}
              </div>
              <div className="phc-meta-row">
                <span className="phc-meta"><strong>{age}Y / {gender}</strong></span>
                <span className="phc-meta">UHID: <span className="phc-meta-id">{uhidVal}</span></span>
                <span className="phc-meta">IPD: <span className="phc-meta-ipd">{ipdNumVal}</span></span>
                <span className="phc-meta">🏥 <strong>{wardVal}</strong> · <strong>{bedVal}</strong></span>
                <span className="phc-meta">📅 <strong>{admDate}</strong></span>
              </div>
              {/* R7hr-85.1 — Clinical strip lives INSIDE the left info
                  column, directly below the meta-row. Avoids the empty
                  gap that opened up when it sat below the full row
                  (QR column on the right was taller than the info
                  column on the left, pushing the strip down). */}
              {(consultant !== "—" || dxTiersFull.length > 0 || patientStatus) && (
                <div className="phc-clinical-strip">
                  {consultant !== "—" && (
                    <div className="phc-clin-chip phc-clin-chip--consultant" title="Attending consultant">
                      <i className="pi pi-user-edit phc-clin-icon" />
                      <span className="phc-clin-label">Consultant</span>
                      <span className="phc-clin-value">{consultant}</span>
                    </div>
                  )}
                  {/* R7hr-87 — Patient Status chip (Stable / Improving /
                      Unchanged / Deteriorating / Critical / Ready for
                      Discharge). Colour matches clinical severity so
                      both doctor + nurse see it at a glance. */}
                  {patientStatus && (
                    <div
                      className={`phc-clin-chip phc-clin-chip--status phc-status--${patientStatus.toLowerCase().replace(/\s+/g, "-")}`}
                      title="Doctor's current patient-status call"
                    >
                      <i className="pi pi-heart-fill phc-clin-icon" />
                      <span className="phc-clin-tier">Status</span>
                      <span className="phc-clin-value">{patientStatus}</span>
                    </div>
                  )}
                  {dxTiersFull.map((row) => (
                    <div
                      key={row.tier}
                      className={`phc-clin-chip phc-clin-chip--dx ${tierClass(row.tier)}`}
                      title={`${row.tier} diagnosis${row.icd10Code ? ` · ICD-10 ${row.icd10Code}` : ""}`}
                    >
                      <i className="pi pi-tag phc-clin-icon" />
                      <span className="phc-clin-tier">{row.tier}</span>
                      <span className="phc-clin-value">{row.text}</span>
                      {row.icd10Code && (
                        <span className="phc-clin-icd">
                          {row.icd10Code}{row.icd10Description ? ` — ${row.icd10Description}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* R7hr-184 — Invasive-device registry strip (Intubated /
                  Foley / Cannula / Lines). IPD-only; renders nothing
                  when the admission has no IPD number or the role
                  can't read MAR-scope data. */}
              {ipdNumVal !== "—" && <PatientDevicesStrip ipdNo={ipdNumVal} />}
            </div>
          </div>

          {/* Right: QR + action buttons stacked */}
          <div className="phc-right">
            <div className="phc-qr-wrap" title="Scan with any QR reader for patient summary">
              <QRCodeSVG value={qrPayload} size={88} level="M" />
              <span className="phc-qr-label">Scan</span>
            </div>
            <div className="phc-actions">
              {actions.map((b) => (
                <button
                  key={b.label}
                  onClick={b.onClick}
                  className={`phc-btn ${b.variant === "accent" ? "phc-btn-accent" : ""} ${b.variant === "danger" ? "phc-btn-danger" : ""}`}
                >
                  <i className={`pi ${b.icon}`} />
                  {b.label}
                </button>
              ))}
              {onChangePatient && (
                <button onClick={onChangePatient} className="phc-btn phc-btn-danger">
                  <i className="pi pi-arrows-h" /> Change Patient
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer: allergies + twice-daily compliance only — consultant
            and diagnosis now live in the prominent strip above (inside
            the left info column, right under the meta-row). */}

        {/* R7hr-86 — .phc-footer dropped. Allergies + twice-daily
            compliance now live in the shared PatientAlertStrip
            component that parents render beside their "All Sections"
            back button. Saves ~50 px of vertical chrome inside the
            patient card. */}
      </div>
    </div>
  );
}
