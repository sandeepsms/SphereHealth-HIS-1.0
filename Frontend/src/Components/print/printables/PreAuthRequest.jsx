// Components/print/printables/PreAuthRequest.jsx
// R7hr(CLAIM-P1.3) — TPA/insurer cashless pre-authorisation REQUEST, sent
// before/at admission. Auto-filled from patient policy + admission +
// estimated cost; clinical justification from the diagnosis.
import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { toNum } from "../../../utils/printUtils";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const Row = ({ label, value, blank }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 4 }}>
    <div style={{ width: 185, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, fontWeight: 600, color: blank ? "#cbd5e1" : "#0f172a", borderBottom: blank ? "1px dashed #cbd5e1" : "none", minHeight: blank ? 15 : "auto" }}>{blank ? "" : (value || "—")}</div>
  </div>
);

const PreAuthRequest = ({ settings, receipt = {} }) => {
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  const pa = receipt.preAuth || {};
  const est = toNum(receipt.estimatedCost) || pa.sanctionedAmount || null;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Cashless Pre-Authorisation Request"
      serialNo={pa.number || a.admissionNumber}
      infoItems={[
        { label: "TPA / Insurer", value: p.tpaName },
        { label: "Policy No",     value: p.policyNumber },
        { label: "Patient",       value: p.name },
        { label: "UHID",          value: p.uhid },
      ]}
      signatureLabels={["Treating Doctor", "Hospital Seal"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Patient & Policy</div>
        <div className="pr-section__body">
          <Row label="Patient Name" value={p.name} />
          <Row label="Age / Gender" value={[p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / ")} />
          <Row label="Policy Holder" value={p.policyHolderName || p.name} />
          <Row label="Policy No" value={p.policyNumber} />
          <Row label="Sum Insured" value={p.sumInsured ? fmtINR(p.sumInsured) : "—"} />
          <Row label="Card / Member ID" blank />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Proposed Hospitalisation</div>
        <div className="pr-section__body">
          <Row label="Hospital" value={receipt.hospital?.name} />
          <Row label="ROHINI ID" value={receipt.hospital?.rohiniId} />
          <Row label="Expected Date of Admission" value={fmtD(a.admissionDate)} />
          <Row label="Admission Type" value={a.type} />
          <Row label="Room Category Requested" value={a.roomCategory} />
          <Row label="Treating Consultant" value={a.consultant} />
          <Row label="Provisional Diagnosis" value={a.provisionalDiagnosis || a.finalDiagnosis} />
          <Row label="Proposed Line of Treatment" value={a.reasonForAdmission} />
          <Row label="Nature of Illness" value={a.isMLC ? "Accident / MLC" : "Illness"} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Estimated Cost</div>
        <div className="pr-section__body">
          <Row label="Estimated Total (₹)" value={est != null ? fmtINR(est) : "—"} />
          <Row label="Expected Length of Stay" value={a.estimatedDays ? `${a.estimatedDays} day(s)` : "—"} />
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Indicative estimate — final billing may vary with length of stay, investigations, consumables or
            complications. This request seeks cashless authorisation up to the sanctioned limit.
          </div>
        </div>
      </div>
    </PrintShell>
  );
};

export default PreAuthRequest;
