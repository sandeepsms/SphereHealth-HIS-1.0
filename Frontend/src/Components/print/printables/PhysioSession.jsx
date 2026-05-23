// Components/print/printables/PhysioSession.jsx — R7bj-F1.
// Single physiotherapy session record printable. NABH COP.20 requires the
// session sheet to carry patient identifiers, modality, duration, pain /
// tolerance scores, and the therapist's signature with IAP registration #.
//
// Half-A4 friendly (used as a bedside / handover slip). The therapist's
// IAP (Indian Association of Physiotherapists) registration number is read
// from `r.therapist.iapNumber` and printed with the signature for legal
// validity. Falls back to the user's employeeId if iapNumber is not
// populated (legacy users — credential backfill is R7bh-F1's job).

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

const MODALITY_LABELS = {
  ULTRASOUND: "Ultrasound (US)",
  SWD: "Short-wave Diathermy (SWD)",
  TENS: "TENS",
  IFC: "Interferential Current (IFC)",
  HOT_PACK: "Hot Pack (HMP)",
  CRYO: "Cryotherapy",
  MANUAL_THERAPY: "Manual Therapy",
  EXERCISE: "Therapeutic Exercise",
  MOBILIZATION: "Joint Mobilization",
  CHEST_PHYSIO: "Chest Physiotherapy",
  GAIT: "Gait Training",
  BALANCE: "Balance Training",
  STRENGTH: "Strength Training",
  ROM: "Range of Motion (ROM)",
};

const PhysioSession = ({ settings, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);
  const modalityLabel = MODALITY_LABELS[r.sessionType] || r.sessionType || "General";
  const iapNo = r.therapist?.iapNumber || r.iapNumber || r.signedByEmployeeId || "";

  return (
    <PrintShell
      settings={settings}
      documentTitle="Physiotherapy Session Record (NABH COP.20)"
      serialNo={r.sessionNo || r._id?.slice?.(-8) || ""}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.UHID || r.uhid },
        { label: "IPD No",      value: r.ipdNo || r.admissionNumber },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Session Date",value: fmtDate(r.sessionDate) },
        { label: "Time",        value: fmtTime(r.sessionDate) },
        { label: "Therapist",   value: r.signedByName || r.therapist?.name || "—" },
      ]}
      signatureLabels={[
        `Physiotherapist (IAP# ${iapNo || "—"})`,
        "Patient / Attendant",
      ]}
    >
      {/* Session body — modality + clinical findings + plan progress */}
      <div className="pr-section">
        <div className="pr-section__title">Session Details</div>
        <div className="pr-section__body">
          <table className="pr-table" style={{ fontSize: 11.5 }}>
            <tbody>
              <tr>
                <td style={{ width: "30%", fontWeight: 700 }}>Modality</td>
                <td>{modalityLabel}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Duration</td>
                <td>{r.duration_min ? `${r.duration_min} minutes` : "—"}</td>
              </tr>
              {Array.isArray(r.modalitiesUsed) && r.modalitiesUsed.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 700 }}>Modalities used</td>
                  <td>{r.modalitiesUsed.map((m) => MODALITY_LABELS[m] || m).join(", ")}</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 700 }}>Pain score (0-10)</td>
                <td>
                  Before: <strong>{r.painScoreBefore != null ? r.painScoreBefore : "—"}</strong>
                  &nbsp;&nbsp;→&nbsp;&nbsp;
                  After: <strong>{r.painScoreAfter != null ? r.painScoreAfter : "—"}</strong>
                  {r.painScoreBefore != null && r.painScoreAfter != null && (
                    <span className="muted" style={{ marginLeft: 8, fontSize: 10.5 }}>
                      (Δ {(r.painScoreAfter - r.painScoreBefore).toFixed(0)})
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Tolerance</td>
                <td>{r.tolerance || "—"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Patient compliant</td>
                <td>{r.patientCompliant === false ? "No" : "Yes"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Status</td>
                <td>{r.status || "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {r.notes && (
        <div className="pr-section">
          <div className="pr-section__title">Clinical Notes</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontSize: 11.5 }}>
            {r.notes}
          </div>
        </div>
      )}

      {/* Plan progress (if a parent plan is provided in payload) */}
      {(r.plan || r.sessionsTotal) && (
        <div className="pr-section">
          <div className="pr-section__title">Plan Progress</div>
          <div className="pr-section__body" style={{ fontSize: 11.5 }}>
            Sessions completed:&nbsp;
            <strong>{r.plan?.sessionsCompleted ?? r.sessionsCompleted ?? "—"}</strong>
            &nbsp;of&nbsp;
            <strong>{r.plan?.sessionsTotal ?? r.sessionsTotal ?? "—"}</strong>
            {r.plan?.frequency && (
              <span className="muted" style={{ marginLeft: 10 }}>· {r.plan.frequency}</span>
            )}
          </div>
        </div>
      )}

      {/* Billing line if a session fee was charged */}
      {r.sessionFee != null && Number(r.sessionFee) > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Billing</div>
          <div className="pr-section__body" style={{ fontSize: 11.5 }}>
            Session fee: <strong>₹{Number(r.sessionFee).toFixed(2)}</strong>
            <span className="muted" style={{ marginLeft: 8 }}>
              (auto-posted to IPD ledger via BillingTrigger
              {r.billingTriggerId ? ` #${String(r.billingTriggerId).slice(-8)}` : ""})
            </span>
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default PhysioSession;
