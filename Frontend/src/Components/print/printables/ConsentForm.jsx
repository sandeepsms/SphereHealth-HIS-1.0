// Components/print/printables/ConsentForm.jsx
// Generic consent form printable. Drives multiple variants from a
// single template — the caller passes `formType` (admission / surgical
// / anesthesia / hiv / dnr / procedure / autopsy) and the right body
// text + acknowledgements are auto-selected.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const BODY_BY_TYPE = {
  admission: {
    title: "General Consent for Admission & Treatment (NABH PRE.4)",
    intro: "I hereby voluntarily consent to be admitted to this hospital and to receive medical care, " +
           "diagnostic procedures, nursing care, and treatment as deemed necessary by the attending physician(s) and consultants.",
    bullets: [
      "I understand that medicine is not an exact science and no guarantees have been made to me as to the results of treatment.",
      "I authorise routine laboratory, radiological, and other diagnostic investigations required for my care.",
      "I agree to abide by hospital rules, visiting hours, and infection-control protocols.",
      "I authorise the hospital to share my health information with insurance providers / TPAs for cashless settlement.",
      "I understand the estimated cost of treatment and agree to make timely payments as per hospital policy.",
    ],
  },
  surgical: {
    title: "Informed Consent for Surgery / Procedure (NABH COP.13)",
    intro: "I have been informed by the surgeon about the nature of my condition, the proposed surgical procedure, " +
           "its purpose, the alternatives available, the material risks and possible complications, and the expected benefits.",
    bullets: [
      "I understand that during the procedure, unforeseen conditions may require additional or different procedures than those planned.",
      "I authorise the operating team to perform such additional procedures as may be necessary in their professional judgement.",
      "I consent to the administration of anesthesia and other medications as deemed appropriate by the attending anesthesiologist.",
      "I have been informed about the post-operative care, expected recovery time, and need for follow-up visits.",
      "I understand that no guarantee has been made to me as to the outcome of the procedure.",
    ],
  },
  anesthesia: {
    title: "Informed Consent for Anesthesia",
    intro: "I have been informed by the anesthesiologist about the type of anesthesia (general / regional / local) " +
           "proposed for my procedure, the risks and possible complications, and the alternatives available.",
    bullets: [
      "I understand that all anesthesia involves some risk, including but not limited to nausea, sore throat, dental damage, allergic reactions, breathing difficulty, and in rare cases serious cardiovascular or neurological complications.",
      "I have disclosed all my current medications, allergies, prior anesthesia experiences, and existing medical conditions.",
      "I consent to such additional anesthesia services as may become necessary during the course of the planned procedure.",
      "I understand that fasting and other pre-anesthesia instructions are critical for my safety.",
    ],
  },
  hiv: {
    title: "Informed Consent for HIV Testing",
    intro: "I have been informed about the nature of the HIV test, its purpose, the meaning of the results " +
           "(reactive / non-reactive / indeterminate), and the implications for my treatment and personal life.",
    bullets: [
      "I understand that pre-test and post-test counselling is available to me at the hospital.",
      "I authorise the testing of my blood sample for HIV antibodies.",
      "I understand that the result will be kept strictly confidential as per the HIV and AIDS (Prevention and Control) Act, 2017.",
      "I have been informed about treatment options and support resources should the result be positive.",
    ],
  },
  dnr: {
    title: "Do Not Resuscitate (DNR) Order",
    intro: "Based on detailed discussion with the medical team about my (or the patient's) prognosis and quality of life, " +
           "I request that in the event of cardiac or respiratory arrest, resuscitative measures NOT be initiated.",
    bullets: [
      "This DNR order has been discussed with and acknowledged by the family / legal representative.",
      "I understand that this order does not affect other ongoing medical care, comfort measures, or pain management.",
      "This order can be revoked by me / the legal representative at any time by informing the treating physician.",
      "The order will be visibly placed in the patient's medical record.",
    ],
  },
  procedure: {
    title: "Informed Consent for Procedure / Investigation",
    intro: "I consent to the performance of the procedure / investigation described above, and have been informed " +
           "about its purpose, nature, expected duration, possible discomfort, risks, and alternatives.",
    bullets: [
      "I understand that I may withdraw consent before the procedure begins.",
      "I authorise the use of any tissue / sample obtained for diagnostic purposes.",
      "I have been given the opportunity to ask questions and have received satisfactory answers.",
    ],
  },
  autopsy: {
    title: "Consent for Autopsy / Post-Mortem Examination",
    intro: "I, being the next-of-kin / legal representative of the deceased, hereby consent to the performance of " +
           "a post-mortem examination on the body of the deceased.",
    bullets: [
      "I have been informed about the nature and purpose of the autopsy.",
      "I understand that organs / tissues may be retained for examination as required.",
      "I authorise the release of any post-mortem findings to the appropriate authorities and / or insurance company.",
    ],
  },
};

const ConsentForm = ({ settings, receipt = {} }) => {
  const r = receipt;
  const cfg = BODY_BY_TYPE[r.formType] || BODY_BY_TYPE.admission;
  const procedureGiven = r.procedure || r.investigation;

  return (
    <PrintShell
      settings={settings}
      documentTitle={cfg.title}
      serialNo={r.consentNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "IPD / OPD",   value: r.ipdNo || r.opdNo },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Consultant",  value: r.consultantName },
        ...(procedureGiven ? [{ label: "Procedure", value: procedureGiven }] : []),
        { label: "Form Date",   value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
      ]}
      signatureLabels={["Treating Doctor", r.signatoryRelation ? `Signed by (${r.signatoryRelation})` : "Patient / Attendant"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Statement of Consent</div>
        <div className="pr-section__body" style={{ fontSize: 12, lineHeight: 1.55 }}>
          {cfg.intro}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">I Acknowledge and Understand That</div>
        <ol style={{ margin: "4px 0 0 20px", padding: 0, fontSize: 11.5, lineHeight: 1.55 }}>
          {cfg.bullets.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}
        </ol>
      </div>

      {r.additionalRisks && (
        <div className="pr-section">
          <div className="pr-section__title">Procedure-Specific Risks Explained</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>{r.additionalRisks}</div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">Language &amp; Counselling</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          The above has been explained to me in <strong>{r.language || "English / Hindi"}</strong>,
          a language I understand. I have had the opportunity to ask questions and they have been
          answered to my satisfaction.
          {r.counsellor && <> Counselling was provided by <strong>{r.counsellor}</strong>.</>}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Signatures &amp; Witness</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ padding: 6, width: "33%" }}>
                <div style={{ height: 40, borderBottom: "1px solid #94a3b8" }} />
                <div style={{ fontWeight: 800, marginTop: 4 }}>Patient / Attendant</div>
                <div className="muted" style={{ fontSize: 10 }}>{r.signatoryName || ""}</div>
                {r.signatoryRelation && <div className="muted" style={{ fontSize: 10 }}>Relation: {r.signatoryRelation}</div>}
              </td>
              <td style={{ padding: 6, width: "33%" }}>
                <div style={{ height: 40, borderBottom: "1px solid #94a3b8" }} />
                <div style={{ fontWeight: 800, marginTop: 4 }}>Treating Doctor</div>
                <div className="muted" style={{ fontSize: 10 }}>{r.consultantName || ""}</div>
              </td>
              <td style={{ padding: 6, width: "33%" }}>
                <div style={{ height: 40, borderBottom: "1px solid #94a3b8" }} />
                <div style={{ fontWeight: 800, marginTop: 4 }}>Witness</div>
                <div className="muted" style={{ fontSize: 10 }}>{r.witnessName || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PrintShell>
  );
};

export default ConsentForm;
