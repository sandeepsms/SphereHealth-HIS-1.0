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
import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import useHospitalSettings from "../print/useHospitalSettings";
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
    const d = diagnosis;
    if (d && (d.final || d.working || d.provisional)) {
      const out = [];
      if (d.provisional) out.push({ tier: "Provisional", text: d.provisional });
      if (d.working)     out.push({ tier: "Working",     text: d.working });
      if (d.final)       out.push({ tier: "Final",       text: d.final });
      // attach ICD-10 to the highest tier present
      if (out.length && (d.icd10Code || d.icd10Description)) {
        out[out.length - 1].icd10Code = d.icd10Code;
        out[out.length - 1].icd10Description = d.icd10Description;
      }
      return out;
    }
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
  const consultant = patient.attendingDoctor || patient.doctorName || patient.consultantName || "—";
  const admType    = patient.admissionType?.toUpperCase() || "IPD";
  const allergies  = (patient.allergies || patient.knownAllergies || []).filter(Boolean);
  const dayStay    = patient.admissionDate
    ? Math.floor((Date.now() - new Date(patient.admissionDate)) / (1000 * 60 * 60 * 24))
    : null;

  // R7bn-5 / D6-fix: pull the twice-daily compliance summary so we can
  // render a red OVERDUE / amber DUE_SOON banner. Re-fetches every 60s
  // (and once on patient change) — the backend cron flips status every
  // 15 min so 60s polling on the client is sufficient.
  const [compliance, setCompliance] = useState(null);
  useEffect(() => {
    if (!patient?._id) { setCompliance(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${API_ENDPOINTS.BASE}/compliance/assessment-status/${patient._id}`);
        if (cancelled) return;
        setCompliance(res.data?.summary || null);
      } catch (_) { /* silent — compliance is a soft UX nudge */ }
    };
    load();
    const id = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [patient?._id]);

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
              {(consultant !== "—" || dxTiersFull.length > 0) && (
                <div className="phc-clinical-strip">
                  {consultant !== "—" && (
                    <div className="phc-clin-chip phc-clin-chip--consultant" title="Attending consultant">
                      <i className="pi pi-user-edit phc-clin-icon" />
                      <span className="phc-clin-label">Consultant</span>
                      <span className="phc-clin-value">{consultant}</span>
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
        <div className="phc-footer">
          {allergies.length > 0 && (
            <div className="phc-allergies">
              <span className="phc-allergy-label">
                <i className="pi pi-exclamation-triangle" /> ALLERGY:
              </span>
              {allergies.map((a) => (
                <span key={a} className="phc-allergy-chip">{a}</span>
              ))}
            </div>
          )}
          {/* R7bn-5 / D6-fix: twice-daily compliance status banner.
              Surfaces OVERDUE (red) or DUE_SOON (amber) only — when
              everything is on schedule we render nothing so the header
              stays compact. */}
          {compliance && compliance.worst !== "OK" && (
            <div className={`phc-compliance phc-compliance--${compliance.worst.toLowerCase()}`} title="Twice-daily assessment schedule (NABH COP.17)">
              <i className={`pi ${compliance.worst === "OVERDUE" ? "pi-exclamation-circle" : "pi-clock"}`} />
              <span className="phc-compliance-label">
                {compliance.worst === "OVERDUE" ? "OVERDUE" : "DUE SOON"}
              </span>
              <span className="phc-compliance-count">
                {compliance.overdue > 0 && <>{compliance.overdue} overdue</>}
                {compliance.overdue > 0 && compliance.dueSoon > 0 && " · "}
                {compliance.dueSoon > 0 && <>{compliance.dueSoon} due soon</>}
              </span>
            </div>
          )}
        </div>

        {/* R7hr-85.1 — Doctor-specific dx grid (Provisional Dx / Working
            Dx / Final Dx / ICD-10 rows) removed. The clinical strip
            above the footer now carries every filled tier with its own
            colour-coded pill + ICD-10 attached, so a second grid that
            repeats the same data was just adding vertical bloat. */}
      </div>
    </div>
  );
}
