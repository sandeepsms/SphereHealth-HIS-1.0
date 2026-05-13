/**
 * PatientPanelShell.jsx
 * ════════════════════════════════════════════════════════════════
 * Shared shell for DoctorPatientPanel + NursePatientPanel.
 *
 * Renders the chrome (header, search, identity strip, gate banners,
 * tab nav, content frame, empty/loading/error states) — everything
 * styled with the pf-* design system (see patient-file.css).
 *
 * Both panels stay role-specific for:
 *   • Data fetching (each owns its axios calls)
 *   • Modals (bed-transfer initiation vs. handover completion)
 *   • Tab content (passed in via renderTab prop)
 *
 * The shell is intentionally dumb — every behaviour comes through
 * props. That keeps the doctor / nurse files lean and prevents this
 * file from growing into a god-component.
 *
 * Usage:
 *   <PatientPanelShell
 *     role="doctor"                                  // sets pf-tint--doctor
 *     title="Doctor Patient Panel"
 *     subtitle="Full patient file — clinical, vitals & audit"
 *     icon="🩺"
 *     searchValue={uhidInput} onSearchChange={...} onSearchSubmit={...}
 *     searchPlaceholder="Enter UHID (e.g. UH-00001)"
 *     loading={loading} error={error} loaded={loaded}
 *     patient={patient} admission={admission}
 *     printRef={printAreaRef}
 *     quickActions={[{ label: "💊 MAR", onClick: () => navigate("/mar") }, ...]}
 *     gateBanners={<>...assessment gate + handover banner...</>}
 *     tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}
 *     tabCounts={{ nursing: nursingNotes.length, ... }}
 *     renderTab={(id) => <SomeTab />}
 *     stripActions={<button>📂 Complete File</button>}
 *     modals={<>...</>}
 *   />
 */

import React from "react";
import PatientFileExport from "./PatientFileExport";
import "../../pages/patient/patient-file.css";

// NOTE: This shell deliberately does NOT wrap in ClinicalLayout — the
// parent (DoctorPatientPanel / NursePatientPanel) wraps in ClinicalLayout
// so it can pass `onPatientSelect` / `selectedId` to the sidebar. Wrapping
// here would double-nest and break the sidebar wiring.

/* ── Status pill colour map (kept inline; trivial enough) ── */
function StatusBadge({ status }) {
  const s = String(status || "Active").toLowerCase();
  const cls =
    s === "active" || s === "admitted" ? "pf-badge--ok" :
    s === "discharged"                 ? "pf-badge--neutral" :
    s === "cancelled" || s === "transferred" ? "pf-badge--warn" :
    "pf-badge--info";
  return <span className={`pf-badge ${cls}`}>{status || "—"}</span>;
}

function Avatar({ name }) {
  const initial = (name || "P").trim().charAt(0).toUpperCase() || "P";
  return <div className="pf-strip__avatar">{initial}</div>;
}

export default function PatientPanelShell({
  role = "doctor",
  title,
  subtitle,
  icon = "🩺",
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = "Enter UHID…",
  loading = false,
  error = "",
  loaded = false,
  patient = null,
  admission = null,
  printRef = null,
  quickActions = [],
  stripActions = null,
  gateBanners = null,
  tabs = [],
  activeTab = "",
  onTabChange = () => {},
  tabCounts = {},
  renderTab = () => null,
  modals = null,
  emptyTitle = "Enter a Patient UHID",
  emptyMsg   = "Type a UHID in the search bar and click Load Patient to view the complete patient file.",
  emptyIcon  = "🔍",
}) {
  const tintClass = `pf-tint--${role === "nurse" ? "nurse" : "doctor"}`;
  const patName = patient?.fullName || patient?.patientName || admission?.patientName || "—";
  const uhid    = patient?.UHID || admission?.UHID || searchValue || "—";

  return (
    <>
      <div className={`pf-shell ${tintClass}`}>
        {/* ── Top header: title + search ── */}
        <div className="pf-shell__head">
          <div className="pf-shell__title">
            <span className="pf-shell__title-icon">{icon}</span>
            <div>
              <div className="pf-shell__title-text">{title}</div>
              {subtitle && <div className="pf-shell__title-sub">{subtitle}</div>}
            </div>
          </div>
          <div className="pf-shell__search">
            <input
              className="pf-shell__search-input"
              value={searchValue || ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearchSubmit?.()}
              placeholder={searchPlaceholder}
            />
            <button
              className="pf-shell__search-btn"
              onClick={onSearchSubmit}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load Patient"}
            </button>
          </div>
        </div>

        {/* ── Quick actions row (only shown when patient loaded) ── */}
        {loaded && quickActions.length > 0 && (
          <div className="pf-shell__quick">
            {quickActions.map((a) => (
              <button key={a.label} className="pf-shell__quick-btn" onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="pf-shell__body">
          {error && <div className="pf-error">⚠️ {error}</div>}

          {loading && (
            <div className="pf-spin-row"><div className="pf-spinner" /></div>
          )}

          {/* Empty / landing state */}
          {!loading && !loaded && !error && (
            <div className="pf-landing">
              <div className="pf-landing__icon">{emptyIcon}</div>
              <div className="pf-landing__title">{emptyTitle}</div>
              <div className="pf-landing__msg">{emptyMsg}</div>
            </div>
          )}

          {/* Loaded patient — wrap in printRef so PatientFileExport works */}
          {!loading && loaded && (
            <div ref={printRef}>
              {/* Identity strip */}
              <div className="pf-strip">
                <Avatar name={patName} />
                <div className="pf-strip__id">
                  <div className="pf-strip__name">
                    {patient?.title ? `${patient.title} ` : ""}{patName}
                  </div>
                  <div className="pf-strip__meta">
                    UHID <span className="pf-strip__uhid">{uhid}</span>
                    {patient?.age && <> · {patient.age} yrs</>}
                    {patient?.gender && <> · {patient.gender}</>}
                    {patient?.bloodGroup && <> · 🩸 {patient.bloodGroup}</>}
                  </div>
                </div>
                <div className="pf-strip__actions">
                  {admission?.admissionNumber && (
                    <span className="pf-badge pf-badge--info">IPD {admission.admissionNumber}</span>
                  )}
                  <StatusBadge status={admission?.status} />
                  {admission?.department && (
                    <span className="pf-badge pf-badge--neutral">{admission.department}</span>
                  )}
                  {/* Complete File link — always available when we have UHID */}
                  {patient?.UHID && (
                    <button
                      className="pf-action pf-action--accent"
                      onClick={() => window.open(`/patient-file/${patient.UHID}?role=${role}`, "_blank", "noopener")}
                      title="Open the consolidated patient file in a new tab"
                    >
                      📂 Complete File
                    </button>
                  )}
                  {/* Existing print/PDF/QR export keeps working */}
                  <PatientFileExport
                    patient={patient}
                    printRef={printRef}
                    title={`${patName} — ${role === "nurse" ? "Nursing" : "Doctor"} view`}
                  />
                  {/* Caller-supplied extra actions (e.g. doctor's "Shift Bed") */}
                  {stripActions}
                </div>
              </div>

              {/* Caller-supplied gate banners (assessment gate, handover pending, etc.) */}
              {gateBanners}

              {/* Tab strip */}
              <div className="pf-tabs">
                <div className="pf-tabs__bar">
                  {tabs.map((t) => {
                    const isActive = t.id === activeTab;
                    const count = tabCounts[t.id];
                    return (
                      <button
                        key={t.id}
                        className={`pf-tabs__btn ${isActive ? "pf-tabs__btn--active" : ""}`}
                        onClick={() => onTabChange(t.id)}
                      >
                        {t.label}
                        {count != null && count > 0 && <span className="pf-tabs__count">{count}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="pf-tabs__content">
                  {renderTab(activeTab)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Role-specific modals rendered at the end so they overlay everything */}
        {modals}
      </div>
    </>
  );
}
