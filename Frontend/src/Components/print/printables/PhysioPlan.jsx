// Components/print/printables/PhysioPlan.jsx — R7bj-F1.
// Physiotherapy plan printable — the umbrella document handed to the
// patient / next of kin on admission to the rehab service. NABH COP.20
// requires the plan to capture diagnosis, treatment goals, modality mix,
// session count, frequency, and discharge advice.
//
// Optionally renders the session schedule + completion progress when
// `r.sessions[]` is included in the payload (set by the IPD file
// "complete physio history" print, used at discharge).

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

const FREQUENCY_LABELS = {
  BD: "Twice a day (BD)",
  OD: "Once a day (OD)",
  "2D": "Every 2 days",
  "3D": "Every 3 days",
  WEEKLY: "Weekly",
  PRN: "PRN — as needed",
};

const PhysioPlan = ({ settings, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);
  const iapNo = r.therapist?.iapNumber || r.iapNumber || r.createdByEmployeeId || "";
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];

  const total = Number(r.sessionsTotal || 0);
  const done  = Number(r.sessionsCompleted || 0);
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Physiotherapy Plan & Course (NABH COP.20)"
      serialNo={r.planNo || r._id?.slice?.(-8) || ""}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.UHID || r.uhid },
        { label: "IPD No",      value: r.ipdNo || r.admissionNumber },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Plan Date",   value: fmtDate(r.createdAt || r.startDate || new Date()) },
        { label: "Therapist",   value: r.createdByName || r.therapist?.name || "—" },
        { label: "Status",      value: r.status || "—" },
      ]}
      signatureLabels={[
        `Physiotherapist (IAP# ${iapNo || "—"})`,
        "Patient / Attendant",
      ]}
    >
      {/* Diagnosis */}
      <div className="pr-section">
        <div className="pr-section__title">Clinical Indication</div>
        <div className="pr-section__body" style={{ fontSize: 12 }}>
          <strong>Diagnosis:</strong> {r.diagnosis || "—"}
        </div>
      </div>

      {/* Goals */}
      {Array.isArray(r.goals) && r.goals.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Treatment Goals</div>
          <div className="pr-section__body">
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 11.5, lineHeight: 1.6 }}>
              {r.goals.map((g, i) => <li key={i}>{g}</li>)}
            </ol>
          </div>
        </div>
      )}

      {/* Schedule */}
      <div className="pr-section">
        <div className="pr-section__title">Course Schedule</div>
        <div className="pr-section__body">
          <table className="pr-table" style={{ fontSize: 11.5 }}>
            <tbody>
              <tr>
                <td style={{ width: "30%", fontWeight: 700 }}>Total sessions</td>
                <td>{total || "—"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Frequency</td>
                <td>{FREQUENCY_LABELS[r.frequency] || r.frequency || "—"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Progress</td>
                <td>
                  <strong>{done} of {total} completed</strong> ({pct}%)
                  <div style={{
                    display: "inline-block", marginLeft: 12, width: 140, height: 8,
                    background: "#e2e8f0", borderRadius: 4, overflow: "hidden", verticalAlign: "middle",
                  }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#16a34a" : "#4f46e5" }} />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Modalities */}
      {Array.isArray(r.modalitySet) && r.modalitySet.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Modalities Prescribed</div>
          <div className="pr-section__body">
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11.5, lineHeight: 1.6 }}>
              {r.modalitySet.map((m) => <li key={m}>{MODALITY_LABELS[m] || m}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Session log (optional — included when printing the full course at discharge) */}
      {sessions.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Session Log ({sessions.length})</div>
          <div className="pr-section__body">
            <table className="pr-table" style={{ fontSize: 10.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Modality</th>
                  <th style={{ width: 60 }} className="center">Dur</th>
                  <th style={{ width: 70 }} className="center">Pain B/A</th>
                  <th style={{ width: 60 }} className="center">Tol</th>
                  <th style={{ width: 80 }} className="center">Status</th>
                  <th style={{ width: 120 }}>Therapist</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={s._id || i}>
                    <td>{i + 1}</td>
                    <td>{fmtDate(s.sessionDate)} {fmtTime(s.sessionDate)}</td>
                    <td>{MODALITY_LABELS[s.sessionType] || s.sessionType || "—"}</td>
                    <td className="center">{s.duration_min || "—"}</td>
                    <td className="center">
                      {s.painScoreBefore ?? "—"}/{s.painScoreAfter ?? "—"}
                    </td>
                    <td className="center">{s.tolerance || "—"}</td>
                    <td className="center">{s.status || "—"}</td>
                    <td>{s.signedByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Discharge advice */}
      {r.dischargeAdvice && (
        <div className="pr-section">
          <div className="pr-section__title">Discharge / Home Exercise Advice</div>
          <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
            {r.dischargeAdvice}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default PhysioPlan;
