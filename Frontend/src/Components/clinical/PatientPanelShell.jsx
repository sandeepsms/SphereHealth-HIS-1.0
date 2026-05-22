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

import React, { useEffect, useRef, useState, useMemo, Suspense } from "react";
import PatientFileExport from "./PatientFileExport";
import { useBoundLogger } from "../../utils/activityLogger";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../hooks/useTheme";
import { useDensity } from "../../hooks/useDensity";
import { useIdleLock } from "../../hooks/useIdleLock";
import { useLiveUpdates } from "../../hooks/useLiveUpdates";
import { IdleLockOverlay, PinnedVitals, BreakGlassModal, SurgicalChecklistModal } from "../safety/SafetyComponents";
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
  surgicalChecklistEligible = false,
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

  // ── Roadmap G24/G26: theme + density toggles persisted in localStorage.
  const { theme, toggle: toggleTheme }     = useTheme();
  const { density, toggle: toggleDensity } = useDensity();

  // ── Roadmap D15: full-screen idle lock after 10 minutes.
  const { locked, unlock } = useIdleLock(10 * 60_000);

  // ── Roadmap E20: live SSE subscription. When another user signs a note
  // or fires an action against this patient, briefly flash a "live" badge.
  const [livePulse, setLivePulse] = useState(0);
  useLiveUpdates(patient?.UHID, () => {
    setLivePulse((n) => n + 1);
    setTimeout(() => setLivePulse((n) => Math.max(0, n - 1)), 5000);
  });

  // ── Roadmap G27: derive vitals for the pinned strip. Latest record
  // from the patient passed in (panels already compute one).
  const pinnedVitals = patient?.latestVitals || admission?.latestVitals || null;

  // ── Roadmap D14: Break-glass gate. If the logged-in user is NOT the
  // attending doctor (or in the treating team) for this patient, render
  // a justification modal before showing the chart. Once the user
  // submits a reason, we remember it for the session (per UHID) so the
  // modal doesn't keep popping up while the user is actively reviewing.
  const { user } = useAuth() || {};
  const isPrivilegedRole = ["Admin", "MedicalSuperintendent", "QualityCoordinator"].includes(user?.role);
  const treatingTeam = useMemo(() => {
    if (!admission) return [];
    const list = [
      admission.attendingDoctor,
      admission.attendingDoctorName,
      ...(Array.isArray(admission.consultants) ? admission.consultants : []),
      admission.admittedBy,
      admission.createdByName,
    ].filter(Boolean).map((s) => String(s).toLowerCase().trim());
    return list;
  }, [admission]);
  const currentUserName = (user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`).trim().toLowerCase();
  const isOnTreatingTeam = !!currentUserName && treatingTeam.some((n) => n.includes(currentUserName) || currentUserName.includes(n));
  const needsBreakGlass = !!patient?.UHID && !isPrivilegedRole && !isOnTreatingTeam && (admission?.attendingDoctor || treatingTeam.length > 0);

  const [breakGlassAcked, setBreakGlassAcked] = useState(false);
  // Reset the ack flag whenever the patient changes — each new chart load
  // requires its own justification.
  useEffect(() => {
    setBreakGlassAcked(false);
    try {
      // Survive page refresh within the same browser session.
      if (patient?.UHID && sessionStorage.getItem(`break-glass:${patient.UHID}`)) {
        setBreakGlassAcked(true);
      }
    } catch {}
  }, [patient?.UHID]);
  const handleBreakGlassAllow = (reason) => {
    setBreakGlassAcked(true);
    try { sessionStorage.setItem(`break-glass:${patient.UHID}`, reason || "1"); } catch {}
    // Persist the break-glass justification to the backend audit log so an
    // out-of-scope chart peek is traceable beyond the user's own
    // sessionStorage. Security audit 2026-05-17 finding E-02. Fire-and-
    // forget — never blocks the clinician's workflow if the log endpoint
    // is down, but logs the failure so SOC can spot dropped events.
    try {
      const t = (sessionStorage.getItem("his_token") || localStorage.getItem("his_token"));
      fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"}/patient-file/${encodeURIComponent(patient.UHID)}/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: JSON.stringify({
          action: "BREAK_GLASS",
          summary: `Break-glass access granted: ${reason || "(no reason given)"}`,
          severity: "HIGH",
          isFlagged: true,
          metadata: { reason: reason || null, role, admissionId: admission?._id || null },
        }),
      }).catch((e) => console.error("[BreakGlass] backend audit failed:", e?.message));
    } catch (e) {
      console.error("[BreakGlass] audit dispatch error:", e?.message);
    }
  };

  // ── Roadmap A4: WHO Surgical Safety Checklist. Caller (panel) supplies
  // `surgicalChecklistTrigger` — usually derived from "does the patient
  // have an active Procedure order today?". If true, we offer a Start
  // Checklist button in the strip; clicking opens the 3-phase modal.
  const [showSSC, setShowSSC] = useState(false);
  const sscProcedureId = patient?.activeProcedureId || admission?.activeProcedureId || null;

  // ── Auto-instrument the panel: every meaningful UI event from the shell
  // flows into PatientActivityLog. This is the catch-net the user asked for:
  // "har dropdown selection, har button click" lands in the patient file.
  const activity = useBoundLogger(patient?.UHID, {
    module:      `PatientPanel.${role === "nurse" ? "Nurse" : "Doctor"}`,
    admissionId: admission?._id || null,
    ipdNo:       admission?.admissionNumber || "",
  });

  // Log a single "view" event the first time a new patient is loaded —
  // tracks "Dr X opened patient Y at 09:42" across the team.
  const loggedPatientRef = useRef(null);
  useEffect(() => {
    if (!patient?.UHID || loggedPatientRef.current === patient.UHID) return;
    loggedPatientRef.current = patient.UHID;
    activity.view("panel.open", { summary: `${role === "nurse" ? "Nurse" : "Doctor"} opened patient panel` });
  }, [patient?.UHID, activity, role]);

  // Wrap tab change so every switch logs as a "navigation" event.
  const handleTabChange = (id) => {
    if (id !== activeTab) {
      activity.nav(`tab:${id}`, { summary: `Switched to tab "${id}"` });
    }
    onTabChange(id);
  };

  // ── Roadmap C9: keyboard navigation on the tab strip. ←/→ moves
  // focus between tabs, Home/End jump to first/last. Tabs themselves
  // have role="tab" + aria-selected, the strip is role="tablist".
  const tabRefs = useRef([]);
  const handleTabKey = (e, idx) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft")  next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home")       next = 0;
    else if (e.key === "End")        next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    handleTabChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  // Wrap Complete File so the click is captured.
  const handleCompleteFile = () => {
    activity.click("complete-file.open", { summary: "Opened consolidated Complete File view" });
    window.open(`/patient-file/${patient.UHID}?role=${role}`, "_blank", "noopener");
  };

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
            {/* Theme + density quick-toggle toolbar (roadmap G24 + G26) */}
            <div className="pf-toolbar" role="toolbar" aria-label="Display preferences">
              <button
                className={`pf-toolbar__btn ${theme === "dark" ? "pf-toolbar__btn--active" : ""}`}
                onClick={toggleTheme}
                title={`Theme: ${theme} (click to toggle)`}
                aria-label="Toggle dark mode"
              >{theme === "dark" ? "🌙" : "☀️"}</button>
              <button
                className={`pf-toolbar__btn ${density === "compact" ? "pf-toolbar__btn--active" : ""}`}
                onClick={toggleDensity}
                title={`Density: ${density}`}
                aria-label="Toggle compact density"
              >{density === "compact" ? "▤" : "▦"}</button>
              {livePulse > 0 && (
                <span className="pf-toolbar__btn" title="Live updates streaming" aria-label="Live updates">🟢</span>
              )}
            </div>
            <input
              className="pf-shell__search-input"
              value={searchValue || ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearchSubmit?.()}
              placeholder={searchPlaceholder}
              aria-label="Patient UHID search"
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
              <button
                key={a.label}
                className="pf-shell__quick-btn"
                onClick={() => {
                  activity.click(`quick-action:${a.label}`, { summary: `Quick action — ${a.label}` });
                  a.onClick?.();
                }}
              >
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
                      onClick={handleCompleteFile}
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
                  {/* Roadmap A4 — surgical checklist launcher, only when there's
                      an active procedure on this admission. */}
                  {surgicalChecklistEligible && (
                    <button
                      className="pf-action pf-action--ghost"
                      onClick={() => setShowSSC(true)}
                      title="WHO Surgical Safety Checklist (Sign In / Time Out / Sign Out)"
                    >
                      ⚕ Surgical Checklist
                    </button>
                  )}
                  {/* Caller-supplied extra actions (e.g. doctor's "Shift Bed") */}
                  {stripActions}
                </div>
              </div>

              {/* Caller-supplied gate banners (assessment gate, handover pending, etc.) */}
              {gateBanners}

              {/* Pinned vitals strip (G27) — visible only when patient has vitals */}
              <PinnedVitals vitals={pinnedVitals?.vitals || pinnedVitals} recordedAt={pinnedVitals?.recordedAt || pinnedVitals?.createdAt} visible={!!pinnedVitals} />

              {/* Tab strip — proper ARIA roles, keyboard nav (C9 + C10) */}
              <div className="pf-tabs">
                <div className="pf-tabs__bar" role="tablist" aria-label={`${role === "nurse" ? "Nursing" : "Doctor"} patient panel tabs`}>
                  {tabs.map((t, i) => {
                    const isActive = t.id === activeTab;
                    const count = tabCounts[t.id];
                    return (
                      <button
                        key={t.id}
                        ref={(el) => (tabRefs.current[i] = el)}
                        className={`pf-tabs__btn ${isActive ? "pf-tabs__btn--active" : ""}`}
                        onClick={() => handleTabChange(t.id)}
                        onKeyDown={(e) => handleTabKey(e, i)}
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`panel-${t.id}`}
                        id={`tab-${t.id}`}
                        tabIndex={isActive ? 0 : -1}
                      >
                        {t.label}
                        {count != null && count > 0 && (
                          <span className="pf-tabs__count" aria-label={`${count} records`}>{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="pf-tabs__content"
                  role="tabpanel"
                  id={`panel-${activeTab}`}
                  aria-labelledby={`tab-${activeTab}`}
                  tabIndex={0}
                >
                  {/* Roadmap E17 — Suspense boundary so any tab the caller
                      returns via React.lazy() can stream in without
                      blocking the rest of the panel. The fallback is a
                      lightweight pf-spinner so the user sees motion while
                      a tab chunk arrives over the wire. */}
                  <Suspense fallback={<div className="pf-spin-row"><div className="pf-spinner" /></div>}>
                    {renderTab(activeTab)}
                  </Suspense>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Role-specific modals rendered at the end so they overlay everything */}
        {modals}

        {/* Roadmap D14 — break-glass justification when non-attending opens the chart.
            Rendered after the body so the modal stacks above content but visitor is
            still gently blocked: the body renders behind a slight backdrop until the
            user submits a reason. */}
        {loaded && needsBreakGlass && !breakGlassAcked && (
          <BreakGlassModal
            patient={patient}
            onAllow={handleBreakGlassAllow}
            onCancel={() => {
              // Sending the user back home if they refuse to justify access.
              try { window.history.back(); } catch {}
            }}
          />
        )}

        {/* Roadmap A4 — WHO Surgical Safety Checklist modal */}
        {showSSC && patient && (
          <SurgicalChecklistModal
            patient={patient}
            procedureId={sscProcedureId}
            onClose={() => setShowSSC(false)}
            onComplete={() => activity.submit("surgical-checklist.complete", { summary: "WHO Surgical Safety Checklist completed" })}
          />
        )}

        {/* Roadmap D15 — full-screen idle lock overlay */}
        {locked && <IdleLockOverlay onUnlock={unlock} />}
      </div>
    </>
  );
}
