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
 *     diagnosis={diag}               // optional (doctor)
 *     actions={[{ label, icon, onClick, variant }]}
 *     onChangePatient={() => ...}
 *   />
 */
import React from "react";
import "./PatientHeaderCard.css";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const admTypeClass = (admType) => {
  const t = (admType || "").toUpperCase();
  if (t === "EMERGENCY") return "phc-chip-emergency";
  if (t === "DAY CARE" || t === "DAYCARE") return "phc-chip-daycare";
  return "phc-chip-ipd";
};

export default function PatientHeaderCard({
  patient,
  searchUHID = "",
  onSearchChange = () => {},
  onLoad,
  loading = false,
  diagnosis = null,
  actions = [],
  onChangePatient,
  loadPlaceholder = "UHID / Admission No...",
  loadSubtitle = "Enter UHID or Admission No to begin",
}) {
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
  const age        = patient.patientId?.age ?? patient.age ?? patient.patient?.age ?? "?";
  const gender     = (patient.patientId?.gender || patient.gender || patient.patient?.gender || "?")[0]?.toUpperCase();
  const uhidVal    = patient.UHID || patient.uhid || patient.patientUHID || searchUHID || "—";
  const bedVal     = patient.bedId?.bedNumber || patient.bedNumber ? `Bed ${patient.bedId?.bedNumber || patient.bedNumber}` : "—";
  const wardVal    = patient.wardId?.wardName || patient.wardName || patient.department || "—";
  const admDate    = fmtDate(patient.admissionDate);
  const diagText   = patient.diagnosis || patient.admittingDiagnosis || patient.provisionalDiagnosis || "—";
  const consultant = patient.attendingDoctor || patient.doctorName || patient.consultantName || "—";
  const admType    = patient.admissionType?.toUpperCase() || "IPD";
  const allergies  = (patient.allergies || patient.knownAllergies || []).filter(Boolean);
  const dayStay    = patient.admissionDate
    ? Math.floor((Date.now() - new Date(patient.admissionDate)) / (1000 * 60 * 60 * 24))
    : null;

  /* Doctor-specific diagnosis fields (optional) */
  const dxFields = diagnosis ? [
    { label: "Provisional Dx", value: diagnosis.provisional || patient.admittingDiagnosis || patient.provisionalDiagnosis || "" },
    { label: "Working Dx",     value: diagnosis.working || "" },
    { label: "Final Dx",       value: diagnosis.final || "" },
    { label: "ICD-10",         value: diagnosis.icd10Code ? `${diagnosis.icd10Code}${diagnosis.icd10Description ? " — " + diagnosis.icd10Description : ""}` : "" },
  ].filter(f => f.value) : [];

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
                {patient.bloodGroup && (
                  <span className="phc-chip phc-chip-blood">🩸 {patient.bloodGroup}</span>
                )}
                {dayStay !== null && (
                  <span className="phc-chip phc-chip-day">Day {dayStay + 1}</span>
                )}
              </div>
              <div className="phc-meta-row">
                <span className="phc-meta"><strong>{age}Y / {gender}</strong></span>
                <span className="phc-meta">ID: <span className="phc-meta-id">{uhidVal}</span></span>
                <span className="phc-meta">🏥 <strong>{wardVal}</strong> · <strong>{bedVal}</strong></span>
                <span className="phc-meta">📅 <strong>{admDate}</strong></span>
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
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

        {/* Footer: consultant + diagnosis + allergies */}
        <div className="phc-footer">
          <div className="phc-footer-item">
            <i className="pi pi-stethoscope phc-footer-icon" />
            <span className="phc-footer-label">Consultant:</span>
            <span className="phc-footer-value">{consultant}</span>
          </div>
          <div className="phc-footer-item">
            <i className="pi pi-tag phc-footer-icon" />
            <span className="phc-footer-label">Diagnosis:</span>
            <span className="phc-footer-value">{diagText}</span>
          </div>
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
        </div>

        {/* Doctor-specific extended diagnosis fields */}
        {dxFields.length > 0 && (
          <div className="phc-dx-grid">
            {dxFields.map((f) => (
              <div key={f.label} className="phc-dx-item">
                <div className="phc-dx-label">{f.label}</div>
                <div className="phc-dx-value">{f.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
