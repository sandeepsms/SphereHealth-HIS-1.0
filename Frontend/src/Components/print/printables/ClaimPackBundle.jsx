// Components/print/printables/ClaimPackBundle.jsx
// R7hr(CLAIM-P3.3) — one-click combined Claim Pack. Instead of opening N
// separate print tabs, this stacks the payer's whole form set into ONE
// document (page-break between forms) so the claims desk gets the complete
// pack in a single Print / single PDF. Which forms make up the pack is
// decided by payer scheme — the same routing the IPD Ledger button used,
// now centralised here so there is one source of truth.
import React from "react";
import ClaimFormPartB from "./ClaimFormPartB";
import ClaimFormPartA from "./ClaimFormPartA";
import CghsMrc        from "./CghsMrc";
import EsicClaim      from "./EsicClaim";
import ClaimDocket    from "./ClaimDocket";

// Payer scheme → ordered list of form components that make up its pack.
export function claimPackForms(scheme = "CASH") {
  switch (scheme) {
    case "CGHS":                    return [CghsMrc, ClaimDocket];
    case "ESIC":                    return [EsicClaim, ClaimDocket];
    case "PMJAY": case "STATE": case "ECHS":
                                    return [ClaimDocket];          // portal-filed → proof-pack only
    default:                        return [ClaimFormPartB, ClaimFormPartA]; // private / TPA — IRDAI set
  }
}

const ClaimPackBundle = ({ settings, receipt = {} }) => {
  const scheme = receipt.patient?.payerScheme || "CASH";
  const forms = claimPackForms(scheme);
  return (
    <>
      {forms.map((Form, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div className="pr-page-break" aria-hidden />}
          <Form settings={settings} receipt={receipt} />
        </React.Fragment>
      ))}
    </>
  );
};

export default ClaimPackBundle;
