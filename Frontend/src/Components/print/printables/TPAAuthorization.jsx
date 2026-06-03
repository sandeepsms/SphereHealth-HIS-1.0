// Components/print/printables/TPAAuthorization.jsx
// TPA / Insurance authorization request — sent to the TPA company so
// they pre-authorise cashless treatment. A4 portrait formal letter.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TPAAuthorization = ({ settings, receipt = {} }) => {
  const r = receipt;
  // R7eo-A — Pattern A fix: hardcoded "Cashless / TPA Authorization
  // Request" was reused unchanged for Approved Letters and Denial
  // Letters, which carry different legal weight than a pre-auth ask.
  // Derive the title from receipt.stage and surface approval details
  // when present. Legacy callers (no stage field) keep the original
  // pre-auth request banner.
  const stage = String(r.stage || "").toLowerCase();
  const isApproved = stage === "approved";
  const isDenied   = stage === "denied";
  const docTitle = isApproved
    ? "Cashless / TPA Approval Letter"
    : isDenied
    ? "Cashless / TPA Denial Letter"
    : "Cashless / TPA Pre-Authorization Request";
  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={r.requestNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "IPD No",      value: r.ipdNo },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Policy No",   value: r.policyNo },
        { label: "TPA / Insurer", value: r.tpaName || r.insurerName },
        { label: "Corporate",   value: r.corporateName },
        { label: "Card / ID No",value: r.tpaCardNo || r.empId },
        { label: "Request Date",value: fmtDate(r.date || new Date()) },
      ]}
      signatureLabels={["Treating Doctor", "Hospital TPA Cell"]}
    >
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "18px 22px", fontSize: 12, lineHeight: 1.6,
      }}>
        <div style={{ marginBottom: 12 }}>
          <strong>To,</strong>
          <div>{r.tpaName || "The Authorisation Officer"}</div>
          {r.tpaAddress && <div className="muted" style={{ fontSize: 11 }}>{r.tpaAddress}</div>}
        </div>

        <p style={{ margin: "0 0 12px" }}>
          <strong>Subject:</strong> Pre-authorisation request for cashless hospitalisation —
          {" "}<strong>{r.patientName}</strong> (Policy / Card: <strong>{r.policyNo || r.tpaCardNo || "—"}</strong>)
        </p>

        <p style={{ margin: "0 0 12px", textAlign: "justify" }}>
          Dear Sir / Madam,
        </p>

        <p style={{ margin: "0 0 12px", textAlign: "justify" }}>
          We request your kind authorisation for cashless treatment of the above patient under their
          health insurance / corporate scheme. Clinical details and estimated cost are provided below
          for your evaluation.
        </p>

        <div className="pr-section">
          <div className="pr-section__title">Clinical Details</div>
          <div className="pr-kv" style={{ fontSize: 11.5 }}>
            <dt>Date of admission</dt><dd>{fmtDate(r.admissionDate)}</dd>
            <dt>Provisional diagnosis</dt><dd>{r.provisionalDiagnosis || "—"}</dd>
            <dt>ICD-10</dt><dd>{r.icd10 || "—"} {r.icd10Desc ? `· ${r.icd10Desc}` : ""}</dd>
            <dt>Proposed procedure</dt><dd>{r.proposedProcedure || "Medical management"}</dd>
            <dt>Treatment line</dt><dd>{r.treatmentLine || "Medical"}</dd>
            <dt>Past history</dt><dd>{r.pastHistory || "Nil significant"}</dd>
            <dt>Co-morbidities</dt><dd>{r.comorbidities || "—"}</dd>
            <dt>Pre-existing conditions</dt><dd>{r.preExisting || "Nil declared"}</dd>
          </div>
        </div>

        {/* R7eo-A — Approval Details (rendered only on Approved Letters).
            Surfaces the TPA's approval number, sanctioned amount, validity
            window, and co-pay split so the patient + cashier can verify
            cashless coverage at admission. */}
        {isApproved && (r.approvalNumber || r.approvedAmount != null || r.validTill || r.coPayPercent != null) && (
          <div className="pr-section">
            <div className="pr-section__title">Approval Details</div>
            <div className="pr-kv" style={{ fontSize: 11.5 }}>
              {r.approvalNumber  != null && <><dt>Approval No</dt><dd style={{ fontFamily: "'DM Mono', monospace" }}>{r.approvalNumber}</dd></>}
              {r.approvedAmount  != null && <><dt>Approved Amount</dt><dd>{fmtINR(r.approvedAmount)}</dd></>}
              {r.validTill              && <><dt>Valid Till</dt><dd>{fmtDate(r.validTill)}</dd></>}
              {r.coPayPercent    != null && <><dt>Co-Pay (Patient)</dt><dd>{toNum(r.coPayPercent)}%</dd></>}
            </div>
          </div>
        )}

        <div className="pr-section">
          <div className="pr-section__title">Estimated Cost Breakdown</div>
          <table className="pr-table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>Component</th>
                <th className="right" style={{ width: 110 }}>Estimated (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(r.costBreakdown || [
                { label: "Room rent",        amount: r.roomRent },
                { label: "Consultant fees",  amount: r.consultantFees },
                { label: "Nursing / Care",   amount: r.nursingCharges },
                { label: "Investigations",   amount: r.investigationsCost },
                { label: "Pharmacy",         amount: r.pharmacyCost },
                { label: "Procedure / OT",   amount: r.procedureCost },
                { label: "Consumables",      amount: r.consumablesCost },
                { label: "Other",            amount: r.otherCost },
              ]).filter(x => x.amount != null && x.amount !== "").map((x, i) => (
                <tr key={i}>
                  <td>{x.label}</td>
                  <td className="right">{fmtINR(x.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ background: "var(--pr-accent-color, #1d4ed8)", color: "white" }}>
                  TOTAL ESTIMATED COST
                </td>
                <td className="right" style={{ background: "var(--pr-accent-color, #1d4ed8)", color: "white" }}>
                  {fmtINR(r.totalEstimated)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p style={{ margin: "16px 0 8px" }}>
          We request you to kindly approve the above amount as per the patient's policy entitlements.
          Necessary documents (clinical photographs, investigation reports, consent forms) can be
          forwarded on request. Please send the authorisation letter / query at the earliest to enable
          timely treatment.
        </p>

        <p style={{ margin: "12px 0 4px" }}>Thanking you,<br />Yours faithfully,</p>

        <div style={{ marginTop: 28 }}>
          <strong>{r.doctorName || "—"}</strong>
          <div className="muted" style={{ fontSize: 11 }}>{r.doctorQualifications || ""}</div>
          {r.doctorReg && <div className="muted" style={{ fontSize: 11 }}>Reg. No: {r.doctorReg}</div>}
        </div>
      </div>
    </PrintShell>
  );
};

export default TPAAuthorization;
