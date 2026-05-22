/**
 * PhysiotherapistConsole.jsx — R7bj-F1.
 *
 * URL:  /physiotherapist            (query ?tab=patients|sessions|plans)
 *
 * Three tabs (defined in PhysiotherapistConsoleTabs.jsx):
 *   1. My Patients     — active IPD admissions with an active physio plan,
 *                        plus admissions referred via doctor-order but with
 *                        no plan yet. Click a row → opens the plan editor.
 *   2. Today's Sessions — schedule for the IST calendar day: SCHEDULED,
 *                         COMPLETED, MISSED. Sign-off button on SCHEDULED
 *                         rows fires PUT /sessions/:id/complete which both
 *                         records the signature and emits the BillingTrigger.
 *   3. Plans            — all active plans across the unit, filterable by
 *                         UHID / status; click to drill into the session
 *                         schedule for that plan.
 *
 * Polling: useVisiblePoll @ 30s on the active tab — pauses when the tab
 * is hidden so 30-tab kiosk days don't pound the API.
 *
 * Token: sessionStorage-only (R7bh-F9 / R7y migration). NO localStorage
 * fallback — see authFetch.js header for the rationale.
 *
 * Lazy-mounted in App.jsx via React.lazy.
 */
import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminPage, Hero, TabStrip, C } from "../../Components/admin-theme";
import { MyPatientsTab, TodaysSessionsTab, PlansTab } from "./PhysiotherapistConsoleTabs";

export default function PhysiotherapistConsole() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "patients");

  const onTab = (next) => {
    setTab(next);
    setParams({ tab: next }, { replace: true });
  };

  return (
    <AdminPage>
      <Hero
        icon="pi-bolt"
        color="green"
        title="Physiotherapy Console"
        subtitle="Plans · Daily sessions · Sign-off & billing handoff (NABH COP.20)"
      />

      <TabStrip
        value={tab}
        onChange={onTab}
        accent={C.green}
        accentL={C.greenL}
        tabs={[
          { id: "patients", label: "My Patients",     icon: "pi-users" },
          { id: "sessions", label: "Today's Sessions", icon: "pi-calendar" },
          { id: "plans",    label: "Plans",           icon: "pi-list" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "patients" && <MyPatientsTab onJumpToSessions={() => onTab("sessions")} />}
        {tab === "sessions" && <TodaysSessionsTab />}
        {tab === "plans"    && <PlansTab />}
      </div>
    </AdminPage>
  );
}
