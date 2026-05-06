/**
 * DoctorOrdersPanel.jsx
 * Comprehensive doctor order entry + full audit trail viewer
 * NABH COP.2 / MOM.3 / SRC.1 compliant
 * Supports 12 order types — each with dedicated form fields
 * Audit trail: who ordered (doctor) + each nurse step + completion timestamp
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#1e40af", primaryL: "#eff6ff", primaryMid: "#2563eb",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#dbeafe", blueB: "#93c5fd",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#c4b5fd",
  teal: "#0d9488", tealL: "#f0fdfa", tealB: "#99f6e4",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  pink: "#db2777", pinkL: "#fdf2f8", pinkB: "#fbcfe8",
  slate: "#1e293b", gray: "#9ca3af", grayL: "#f9fafb",
  indigo: "#4f46e5", indigoL: "#eef2ff",
  cyan: "#0891b2", cyanL: "#ecfeff", cyanB: "#a5f3fc",
  lime: "#65a30d", limeL: "#f7fee7", limeB: "#d9f99d",
};

const fld = { padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text, outline: "none", background: "white", width: "100%", boxSizing: "border-box" };
const sel = { ...fld, cursor: "pointer" };
const ta  = { ...fld, resize: "vertical", minHeight: 68 };
const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4 };
const row = { display: "grid", gap: 10, marginBottom: 10 };

/* ── Order type registry ── */
const ORDER_TYPES = [
  { id: "Medication",      label: "Medication",          icon: "pi-tablets",        color: C.purple,  bg: C.purpleL, border: C.purpleB },
  { id: "IV_Fluid",        label: "IV Fluid",            icon: "pi-inbox",          color: C.blue,    bg: C.blueL,   border: C.blueB   },
  { id: "Lab",             label: "Lab Investigation",   icon: "pi-search",         color: C.teal,    bg: C.tealL,   border: C.tealB   },
  { id: "Radiology",       label: "Imaging / Radiology", icon: "pi-eye",            color: C.indigo,  bg: C.indigoL, border: "#a5b4fc"  },
  { id: "Procedure",       label: "Procedure",           icon: "pi-cog",            color: C.orange,  bg: C.orangeL, border: C.orangeB },
  { id: "BloodTransfusion",label: "Blood Transfusion",   icon: "pi-heart",          color: C.red,     bg: C.redL,    border: C.redB    },
  { id: "Diet",            label: "Diet / Nutrition",    icon: "pi-star",           color: C.green,   bg: C.greenL,  border: C.greenB  },
  { id: "Oxygen",          label: "Oxygen Therapy",      icon: "pi-cloud",          color: C.cyan,    bg: C.cyanL,   border: C.cyanB   },
  { id: "Physiotherapy",   label: "Physiotherapy",       icon: "pi-user",           color: C.lime,    bg: C.limeL,   border: C.limeB   },
  { id: "Activity",        label: "Activity / Mobility", icon: "pi-arrows-alt",     color: C.amber,   bg: C.amberL,  border: C.amberB  },
  { id: "Nursing",         label: "Nursing Care",        icon: "pi-heart-fill",     color: C.pink,    bg: C.pinkL,   border: C.pinkB   },
  { id: "Consultation",    label: "Consultation Request",icon: "pi-users",          color: C.slate,   bg: "#f1f5f9", border: "#cbd5e1" },
];

const TYPE_MAP = Object.fromEntries(ORDER_TYPES.map(t => [t.id, t]));

/* ── Step definitions (mirrors NurseOrdersPanel) ── */
const STEPS = {
  Medication:       ["Prepared", "Administered"],
  IV_Fluid:         ["Prepared", "Line Checked", "Infusion Started", "Completed"],
  Lab:              ["Sample Collected", "Sample Sent", "Report Received"],
  Radiology:        ["Scheduled", "Patient Sent", "Scan Done", "Report Received"],
  Procedure:        ["Consent Taken", "Patient Prepped", "Procedure Done", "Patient Returned"],
  BloodTransfusion: ["Cross-Match Verified", "Blood Issued", "Transfusion Started", "Transfusion Completed"],
  Diet:             ["Ordered", "Prepared", "Delivered"],
  Oxygen:           ["Equipment Set", "O₂ Started", "Target Achieved"],
  Physiotherapy:    ["Scheduled", "Session Started", "Session Completed"],
  Activity:         ["Instructed", "Started", "Goal Met"],
  Nursing:          ["Acknowledged", "In Progress", "Done"],
  Consultation:     ["Referral Sent", "Consultant Informed", "Consultation Done", "Advice Received"],
};

/* ── Priority colours ── */
const PRIO = {
  STAT:    { bg: C.redL,   color: C.red,   label: "STAT"    },
  Urgent:  { bg: C.amberL, color: C.amber, label: "Urgent"  },
  Routine: { bg: C.grayL,  color: C.muted, label: "Routine" },
};

/* ── Status pill styles ── */
const STAT_STYLE = {
  Pending:      { bg: "#fff7ed", color: C.amber  },
  Acknowledged: { bg: C.blueL,  color: C.blue   },
  InProgress:   { bg: C.tealL,  color: C.teal   },
  Completed:    { bg: C.greenL, color: C.green  },
  Cancelled:    { bg: C.redL,   color: C.red    },
  OnHold:       { bg: "#f1f5f9",color: C.muted  },
};

/* ══════════════════════════════════════════════════════════════
   ORDER FORM — dynamic fields per type
══════════════════════════════════════════════════════════════ */
function OrderForm({ typeId, form, set }) {
  const g = (cols) => ({ ...row, gridTemplateColumns: cols });

  const Field = ({ label: l, name, placeholder, type="text", options, span }) => (
    <div style={span ? { gridColumn: `span ${span}` } : {}}>
      <label style={lbl}>{l}</label>
      {options
        ? <select style={sel} value={form[name]||""} onChange={e=>set(name,e.target.value)}>
            <option value="">— select —</option>
            {options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        : type==="textarea"
          ? <textarea style={ta} placeholder={placeholder} value={form[name]||""} onChange={e=>set(name,e.target.value)}/>
          : <input style={fld} type={type} placeholder={placeholder} value={form[name]||""} onChange={e=>set(name,e.target.value)}/>
      }
    </div>
  );

  if (typeId === "Medication") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Drug Name *" name="medicineName" placeholder="e.g. Amoxicillin" span={2}/>
        <Field label="Dose *" name="dose" placeholder="e.g. 500mg"/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field label="Route" name="route" options={["IV","IM","Oral","SC","SL","Topical","Inhalation","Rectal","NG Tube"]}/>
        <Field label="Frequency" name="frequency" options={["OD","BD","TDS","QID","6 Hourly","8 Hourly","12 Hourly","SOS","Stat","Weekly"]}/>
        <Field label="Duration" name="duration" placeholder="e.g. 5 days"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Special Instructions" name="notes" placeholder="Pre/post food, monitoring, interactions…" type="textarea"/>
    </>
  );

  if (typeId === "IV_Fluid") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <Field label="Fluid / Solution *" name="medicineName" placeholder="e.g. NS 0.9%, RL, DNS, Dextrose 5%"/>
        <Field label="Volume (ml)" name="dose" placeholder="e.g. 500"/>
        <Field label="Rate (ml/hr)" name="rate" placeholder="e.g. 83"/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field label="Duration" name="duration" placeholder="e.g. 6 hrs"/>
        <Field label="Access Site" name="accessSite" options={["Peripheral IV","Central Line (CVP)","PICC","Arterial Line","Intraosseous"]}/>
        <Field label="Additives" name="additives" placeholder="KCl 20mEq, MgSO4…"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Instructions" name="notes" placeholder="Drip rate, monitoring, pump settings…" type="textarea"/>
    </>
  );

  if (typeId === "Lab") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <Field label="Test Name(s) *" name="testName" placeholder="CBC, LFT, RFT, Blood Culture, Coagulation…" span={2}/>
        <Field label="Urgency" name="urgency" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Sample Type" name="sampleType" options={["Venous Blood","Arterial Blood","Urine (Spot)","Urine (24hr)","Stool","Sputum","Swab","CSF","Pleural Fluid","Ascitic Fluid","Tissue Biopsy"]}/>
        <Field label="Fasting Required" name="fasting" options={["No","Yes — 8 hrs","Yes — 12 hrs"]}/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Clinical Details / Special Instructions" name="notes" placeholder="Pre-antibiotic, timing, paired samples…" type="textarea"/>
    </>
  );

  if (typeId === "Radiology") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <Field label="Scan / Study *" name="testName" placeholder="e.g. CECT Chest, USG Abdomen, MRI Brain, X-Ray PA"/>
        <Field label="Region / Body Part" name="region" placeholder="e.g. Chest, Abdomen-Pelvis"/>
        <Field label="Urgency" name="urgency" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field label="Contrast" name="contrast" options={["Plain (No Contrast)","With IV Contrast","With Oral Contrast","Both"]}/>
        <Field label="Sedation Required" name="sedation" options={["No","Yes"]}/>
        <Field label="Laterality" name="laterality" options={["—","Right","Left","Bilateral"]}/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Clinical Indication / History" name="notes" placeholder="Relevant clinical details, allergy to contrast, prior imaging…" type="textarea"/>
    </>
  );

  if (typeId === "Procedure") return (
    <>
      <div style={g("2fr 1fr")}>
        <Field label="Procedure Name *" name="procedureName" placeholder="e.g. Chest Drain Insertion, Lumbar Puncture, IV Cannula"/>
        <Field label="Type" name="procedureType" options={["Minor","Major","Diagnostic","Therapeutic","Bedside"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Indication *" name="indication" placeholder="e.g. Pleural Effusion, Raised ICP"/>
        <Field label="Estimated Duration" name="estimatedDuration" placeholder="e.g. 30 min"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Consent Required" name="consentRequired" options={["Yes","No"]}/>
        <Field label="Anaesthesia" name="anaesthesia" options={["None","Local","Sedation","GA"]}/>
        <Field label="Position" name="position" options={["Supine","Lateral Decubitus","Sitting","Prone","Lithotomy"]}/>
      </div>
      <Field label="Pre-procedure Instructions / Equipment Needed" name="notes" placeholder="NPO, coagulation check, equipment list…" type="textarea"/>
    </>
  );

  if (typeId === "BloodTransfusion") return (
    <>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field label="Blood Product *" name="medicineName" options={["Packed Red Cells","Whole Blood","Fresh Frozen Plasma","Platelets","Cryoprecipitate","Albumin"]}/>
        <Field label="Units / Volume" name="dose" placeholder="e.g. 2 units / 400ml"/>
        <Field label="Rate" name="rate" placeholder="e.g. 4 hrs/unit"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Blood Group (Patient)" name="bloodGroup" placeholder="e.g. B+"/>
        <Field label="Cross-Match Done" name="crossMatchDone" options={["Yes","No — Emergency"]}/>
        <Field label="Consent for Transfusion" name="consentRequired" options={["Yes","No"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field label="Pre-medications" name="premeds" placeholder="e.g. Paracetamol 1g IV, Hydrocortisone 100mg IV"/>
        <Field label="Monitoring Frequency" name="monitoring" options={["Every 15 min (1st hr)","Every 30 min","Hourly","Continuous"]}/>
      </div>
      <Field label="Special Instructions / Transfusion Notes" name="notes" placeholder="Reaction plan, warmer required, irradiated blood…" type="textarea"/>
    </>
  );

  if (typeId === "Diet") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Diet Type *" name="dietType" options={["Regular/Normal","Soft","Semi-Solid","Liquid","Clear Liquid","NPO (Nil by Mouth)","Diabetic Diet","Low Salt","Low Fat","High Protein","Renal Diet","Hepatic Diet","Enteral (NG Tube)","TPN (Total Parenteral)"]}/>
        <Field label="Caloric Target (kcal)" name="calories" placeholder="e.g. 2000"/>
        <Field label="Protein Target (g)" name="protein" placeholder="e.g. 80"/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Fluid Restriction" name="fluidRestriction" placeholder="e.g. 1500ml/day"/>
        <Field label="Consistency" name="consistency" options={["Normal","Minced","Pureed","Thickened"]}/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Specific Instructions / Allergies / Supplements" name="notes" placeholder="Food allergies, supplements, tube feeding formula…" type="textarea"/>
    </>
  );

  if (typeId === "Oxygen") return (
    <>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field label="Delivery Device *" name="deliveryDevice" options={["Nasal Prongs","Simple Face Mask","Non-Rebreather Mask","Venturi Mask","High-Flow Nasal Cannula (HFNC)","CPAP Mask","BiPAP Mask","Tracheostomy Collar","Incubator / Hood","Room Air"]}/>
        <Field label="Flow Rate (L/min)" name="flowRate" placeholder="e.g. 4"/>
        <Field label="FiO₂ (%)" name="fio2" placeholder="e.g. 40"/>
        <Field label="Target SpO₂ (%)" name="targetSpo2" placeholder="e.g. ≥95"/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="HFNC Flow (L/min)" name="hfncFlow" placeholder="e.g. 40 (if HFNC)"/>
        <Field label="Duration" name="duration" placeholder="e.g. Continuous, PRN, 6 hrs"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Weaning Instructions / Special Notes" name="notes" placeholder="Wean by 2 L/min every 4 hrs if SpO₂ stable…" type="textarea"/>
    </>
  );

  if (typeId === "Physiotherapy") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="PT Type *" name="ptType" options={["Chest Physiotherapy","Respiratory Exercises","Limb Exercises (Passive)","Limb Exercises (Active)","Ambulation","Transfer Training","Strengthening","Range of Motion","Incentive Spirometry","Postural Drainage","Traction","Ultrasound Therapy"]}/>
        <Field label="Frequency" name="frequency" options={["Once Daily","Twice Daily","Three Times Daily","PRN","Every 4 hrs","Post Op (Immediately)"]}/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field label="Goals" name="goals" placeholder="e.g. Improve sputum clearance, prevent DVT, restore ambulation"/>
        <Field label="Precautions / Contraindications" name="precautions" placeholder="e.g. Avoid vigorous chest PT if INR > 2.5"/>
      </div>
      <Field label="Instructions for Physiotherapist" name="notes" placeholder="Specific exercises, pain threshold, assistive devices…" type="textarea"/>
    </>
  );

  if (typeId === "Activity") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Activity Level *" name="activityLevel" options={["Bed Rest (Strict)","Bed Rest with Commode","Bed Rest with BRP","Dangle at Bedside","Chair Sit (30 min)","Ambulate in Room","Ambulate in Corridor","Independent Ambulation","As Tolerated"]}/>
        <Field label="Assistance Level" name="assistanceLevel" options={["Independent","Supervision Only","Minimum Assist (< 25%)","Moderate Assist (25–50%)","Maximum Assist (> 50%)","Dependent / Full Assist"]}/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field label="Restrictions" name="restrictions" placeholder="e.g. No weight bearing left leg, no bending > 90°"/>
        <Field label="Goals" name="goals" placeholder="e.g. Prevent DVT, improve lung expansion"/>
      </div>
      <Field label="Nursing / Rehab Instructions" name="notes" placeholder="Fall precautions, assistive device, reassessment…" type="textarea"/>
    </>
  );

  if (typeId === "Nursing") return (
    <>
      <div style={g("2fr 1fr")}>
        <Field label="Nursing Instruction *" name="instruction" placeholder="e.g. 2-hourly position change, hourly urine output, wound care"/>
        <Field label="Frequency" name="frequency" options={["Stat (Once)","Hourly","2-Hourly","4-Hourly","6-Hourly","8-Hourly","12-Hourly","Daily","BD","TDS","PRN","Continuous"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Care Category" name="careCategory" options={["Wound Care","Catheter Care","NG Tube Care","Tracheostomy Care","Pressure Area Care","Oral Hygiene","Eye Care","IV Site Care","Drain Care","Monitoring","Medication-Related","Other"]}/>
        <Field label="Duration" name="duration" placeholder="e.g. Until DC, 3 days"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Detailed Instructions" name="notes" placeholder="Step-by-step nursing instructions, product to use, documentation required…" type="textarea"/>
    </>
  );

  if (typeId === "Consultation") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field label="Speciality *" name="speciality" options={["Cardiology","Neurology","Nephrology","Pulmonology","Gastroenterology","Endocrinology","Haematology","Oncology","Infectious Disease","Orthopaedics","General Surgery","Urology","Gynaecology","Ophthalmology","ENT","Dermatology","Psychiatry","Anaesthesia","ICU / Critical Care","Palliative Care","Dietitian","Physiotherapy","Social Work"]}/>
        <Field label="Consultant Name" name="consultantName" placeholder="e.g. Dr. Sharma"/>
        <Field label="Urgency" name="urgency" options={["Routine (Within 24 hrs)","Urgent (Within 4 hrs)","Emergency (Immediate)"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field label="Referred By" name="referredBy" placeholder="Referring doctor name"/>
        <Field label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field label="Reason for Referral / Clinical Summary *" name="reason" placeholder="Brief history, key findings, specific question for consultant…" type="textarea"/>
      <Field label="Investigations Shared" name="notes" placeholder="CBC, CT scan, ECG reports shared…" type="textarea"/>
    </>
  );

  return null;
}

/* ══════════════════════════════════════════════════════════════
   AUDIT TRAIL DISPLAY for one order
══════════════════════════════════════════════════════════════ */
function AuditTrail({ order }) {
  const steps = STEPS[order.orderType] || ["Acknowledged", "Done"];
  const done  = order.auditLog || [];
  const meta  = ORDER_TYPES.find(t => t.id === order.orderType) || ORDER_TYPES[0];

  const fmt = (d) => d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit", hour12:true }) : "—";

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
      {/* ── Initiation row ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: meta.bg, border: `1.5px solid ${meta.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`pi ${meta.icon}`} style={{ fontSize: 12, color: meta.color }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>ORDER PLACED</div>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Dr. {order.orderedBy || "—"}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{fmt(order.createdAt)} · Role: {order.orderedByRole || "Doctor"}</div>
        </div>
        <div style={{ padding: "2px 8px", borderRadius: 12, background: PRIO[order.priority]?.bg || C.grayL, color: PRIO[order.priority]?.color || C.muted, fontSize: 10, fontWeight: 800, letterSpacing: ".5px" }}>
          {order.priority || "Routine"}
        </div>
      </div>

      {/* ── Step pipeline ── */}
      <div style={{ paddingLeft: 14, borderLeft: `2px dashed ${C.border}` }}>
        {steps.map((step, idx) => {
          const log = done[idx];
          const isDone = !!log;
          const isCurrent = !isDone && done.length === idx;
          return (
            <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, opacity: isDone ? 1 : isCurrent ? 0.75 : 0.35 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: isDone ? C.greenL : isCurrent ? C.amberL : C.grayL, border: `1.5px solid ${isDone ? C.greenB : isCurrent ? C.amberB : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                {isDone
                  ? <i className="pi pi-check" style={{ fontSize: 9, color: C.green, fontWeight: 900 }}/>
                  : isCurrent
                    ? <i className="pi pi-clock" style={{ fontSize: 9, color: C.amber }}/>
                    : <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.gray }}/>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isDone ? C.green : isCurrent ? C.amber : C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{step}</div>
                {isDone && (
                  <div style={{ fontSize: 11, color: C.text }}>
                    <span style={{ fontWeight: 600 }}>{log.doneBy || "—"}</span>
                    <span style={{ color: C.muted }}> · {fmt(log.doneAt)}</span>
                    {log.notes && <span style={{ color: C.muted }}> · "{log.notes}"</span>}
                  </div>
                )}
                {isCurrent && <div style={{ fontSize: 11, color: C.amber }}>Awaiting execution</div>}
              </div>
            </div>
          );
        })}

        {/* Final completion row */}
        {order.status === "Completed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, padding: "6px 10px", borderRadius: 8, background: C.greenL, border: `1px solid ${C.greenB}` }}>
            <i className="pi pi-check-circle" style={{ fontSize: 13, color: C.green }}/>
            <div style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: C.green }}>ORDER COMPLETED</span>
              {order.completedBy && <span style={{ color: C.muted }}> by {order.completedBy}</span>}
              {order.completedAt && <span style={{ color: C.muted }}> · {fmt(order.completedAt)}</span>}
            </div>
          </div>
        )}
        {order.status === "Cancelled" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, padding: "6px 10px", borderRadius: 8, background: C.redL, border: `1px solid ${C.redB}` }}>
            <i className="pi pi-times-circle" style={{ fontSize: 13, color: C.red }}/>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red }}>ORDER CANCELLED</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORDER CARD
══════════════════════════════════════════════════════════════ */
function OrderCard({ order, onCancel }) {
  const [expanded, setExpanded] = useState(false);
  const meta   = TYPE_MAP[order.orderType] || ORDER_TYPES[10];
  const status = STAT_STYLE[order.status] || STAT_STYLE.Pending;
  const steps  = STEPS[order.orderType] || [];
  const done   = (order.auditLog || []).length;
  const pct    = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const displayName = order.orderDetails?.medicineName
    || order.orderDetails?.testName
    || order.orderDetails?.procedureName
    || order.orderDetails?.instruction
    || order.orderDetails?.dietType
    || order.orderDetails?.ptType
    || order.orderDetails?.activityLevel
    || order.orderDetails?.deliveryDevice
    || order.orderDetails?.speciality
    || "—";

  const subtitle = [
    order.orderDetails?.dose,
    order.orderDetails?.route,
    order.orderDetails?.frequency,
    order.orderDetails?.duration,
    order.orderDetails?.urgency,
    order.orderDetails?.region,
    order.orderDetails?.flowRate && `${order.orderDetails.flowRate} L/min`,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{ background: C.card, border: `1.5px solid ${expanded ? meta.border : C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8, transition: "border-color .2s" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        {/* Type icon */}
        <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`pi ${meta.icon}`} style={{ fontSize: 13, color: meta.color }}/>
        </div>
        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg, padding: "1px 7px", borderRadius: 10, border: `1px solid ${meta.border}` }}>{meta.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{displayName}</span>
          </div>
          {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
        {/* Progress bar */}
        {steps.length > 0 && order.status !== "Cancelled" && (
          <div style={{ width: 64, flexShrink: 0, textAlign: "center" }}>
            <div style={{ height: 4, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: order.status === "Completed" ? C.green : C.teal, borderRadius: 4, transition: "width .4s" }}/>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{done}/{steps.length} steps</div>
          </div>
        )}
        {/* Status + priority */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: status.bg, color: status.color }}>{order.status}</span>
          <span style={{ fontSize: 10, color: PRIO[order.priority]?.color || C.muted }}>{order.priority || "Routine"}</span>
        </div>
        {/* Expand */}
        <i className={`pi pi-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}/>
      </div>

      {/* Expanded audit trail */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          <AuditTrail order={order}/>
          {order.status !== "Completed" && order.status !== "Cancelled" && (
            <button
              onClick={(e) => { e.stopPropagation(); if (window.confirm("Cancel this order?")) onCancel(order._id); }}
              style={{ marginTop: 10, padding: "5px 12px", border: `1px solid ${C.redB}`, borderRadius: 7, background: C.redL, color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              <i className="pi pi-times" style={{ marginRight: 5 }}/> Cancel Order
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PANEL
══════════════════════════════════════════════════════════════ */
export default function DoctorOrdersPanel({ UHID, visitId, ipdNo, patientName, refreshSignal }) {
  const { user } = useAuth();
  const doctorName = user?.name || user?.username || "Dr.";
  const doctorId   = user?.id || user?._id || "000000000000000000000001";

  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [selType,    setSelType]    = useState(null);   // chosen order type
  const [form,       setForm]       = useState({});
  const [filterType, setFilterType] = useState("All");
  const [filterStat, setFilterStat] = useState("Active");

  /* fetch orders */
  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ UHID });
      if (visitId) params.set("visitId", visitId);
      const r = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params}`);
      setOrders(r.data?.data || []);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, [UHID, visitId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshSignal]);
  useEffect(() => { const t = setInterval(fetchOrders, 30000); return () => clearInterval(t); }, [fetchOrders]);

  /* helpers */
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const resetForm = () => { setSelType(null); setForm({}); setShowForm(false); };

  /* ── map form → DoctorOrderModel shape ── */
  const buildPayload = () => {
    const base = {
      UHID, visitId: visitId || ipdNo, visitType: "IPD",
      patientName: patientName || "",
      orderType: selType,
      priority: form.priority || "Routine",
      orderedBy: doctorName, orderedByRole: "Doctor", doctor: doctorId,
      status: "Pending",
    };

    // Build orderDetails
    const d = { ...form };
    delete d.priority;
    base.orderDetails = d;

    // Specific model fields for display/query
    if (selType === "Medication" || selType === "IV_Fluid" || selType === "BloodTransfusion") {
      base.medicineName = form.medicineName;
      base.dose = form.dose;
      base.route = form.route;
      base.frequency = form.frequency;
      base.duration = form.duration;
    }
    if (selType === "Lab" || selType === "Radiology") {
      base.testName = form.testName;
      base.urgency  = form.urgency;
    }
    if (selType === "Procedure") {
      base.procedureName = form.procedureName;
      base.procedureType = form.procedureType;
      base.consentRequired = form.consentRequired === "Yes";
    }
    base.notes = form.notes || "";
    base.displayName = form.medicineName || form.testName || form.procedureName
      || form.instruction || form.dietType || form.ptType
      || form.activityLevel || form.deliveryDevice || form.speciality || selType;

    return base;
  };

  const saveOrder = async () => {
    if (!selType) return toast.error("Select an order type");
    const required = {
      Medication: "medicineName", IV_Fluid: "medicineName", Lab: "testName",
      Radiology: "testName", Procedure: "procedureName",
      BloodTransfusion: "medicineName", Diet: "dietType", Oxygen: "deliveryDevice",
      Physiotherapy: "ptType", Activity: "activityLevel", Nursing: "instruction",
      Consultation: "speciality",
    };
    const reqField = required[selType];
    if (reqField && !form[reqField]) return toast.error("Fill in the required fields (*)");

    setSaving(true);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` };
      await axios.post(API_ENDPOINTS.DOCTOR_ORDERS, buildPayload(), { headers });
      toast.success(`${TYPE_MAP[selType]?.label} order placed`);
      resetForm();
      fetchOrders();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to place order");
    } finally { setSaving(false); }
  };

  const cancelOrder = async (id) => {
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
      await axios.delete(`${API_ENDPOINTS.DOCTOR_ORDERS}/${id}`, { headers });
      toast.success("Order cancelled");
      fetchOrders();
    } catch { toast.error("Cancel failed"); }
  };

  /* ── filter ── */
  const ACTIVE_STATUSES  = ["Pending","Acknowledged","InProgress","OnHold"];
  const filtered = orders.filter(o => {
    const typeOk = filterType === "All" || o.orderType === filterType;
    const statOk = filterStat === "All"
      || (filterStat === "Active"    && ACTIVE_STATUSES.includes(o.status))
      || (filterStat === "Completed" && o.status === "Completed")
      || (filterStat === "Cancelled" && o.status === "Cancelled");
    return typeOk && statOk;
  });

  const activeCount    = orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
  const completedCount = orders.filter(o => o.status === "Completed").length;

  /* ── Priority counts for header badges ── */
  const statOrders = orders.filter(o => o.priority === "STAT" && ACTIVE_STATUSES.includes(o.status));

  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>

      {/* ── Panel header ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 100%)`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="pi pi-list" style={{ color: "white", fontSize: 16 }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 15 }}>Doctor Orders</div>
          <div style={{ color: "rgba(255,255,255,.7)", fontSize: 11 }}>NABH COP.2 · Full Audit Trail</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {statOrders.length > 0 && (
            <span style={{ background: C.red, color: "white", fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 12, letterSpacing: ".5px" }}>
              {statOrders.length} STAT
            </span>
          )}
          <span style={{ background: "rgba(255,255,255,.2)", color: "white", fontSize: 11, padding: "3px 10px", borderRadius: 10 }}>
            {activeCount} active
          </span>
          <span style={{ background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.7)", fontSize: 11, padding: "3px 10px", borderRadius: 10 }}>
            {completedCount} done
          </span>
          <button
            onClick={fetchOrders}
            style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 7, padding: "5px 8px", cursor: "pointer", color: "white" }}
          ><i className="pi pi-refresh" style={{ fontSize: 11 }}/></button>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              style={{ background: "white", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: C.primary, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
            >
              <i className="pi pi-plus" style={{ fontSize: 11 }}/> New Order
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════ ORDER FORM ═══════════════ */}
      {showForm && (
        <div style={{ padding: 16, borderBottom: `1.5px solid ${C.border}`, background: C.grayL }}>

          {/* Type selector grid */}
          {!selType ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Select Order Type</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {ORDER_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelType(t.id)}
                    style={{ padding: "10px 8px", border: `1.5px solid ${t.border}`, borderRadius: 10, background: t.bg, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "transform .15s" }}
                    onMouseEnter={e => e.currentTarget.style.transform="scale(1.04)"}
                    onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}
                  >
                    <i className={`pi ${t.icon}`} style={{ fontSize: 16, color: t.color }}/>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.color, textAlign: "center", lineHeight: 1.3 }}>{t.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={resetForm} style={{ marginTop: 10, padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 7, background: "white", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {/* Back + type title */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button onClick={() => { setSelType(null); setForm({}); }} style={{ border: `1px solid ${C.border}`, background: "white", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: C.muted }}>
                  <i className="pi pi-arrow-left" style={{ marginRight: 5 }}/>Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: TYPE_MAP[selType]?.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`pi ${TYPE_MAP[selType]?.icon}`} style={{ fontSize: 13, color: TYPE_MAP[selType]?.color }}/>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: TYPE_MAP[selType]?.color, fontSize: 14 }}>{TYPE_MAP[selType]?.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Dr. {doctorName} · {new Date().toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
                  </div>
                </div>
              </div>

              {/* Dynamic form */}
              <div style={{ background: "white", borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
                <OrderForm typeId={selType} form={form} set={setField}/>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={resetForm} style={{ padding: "8px 18px", border: `1px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={saveOrder}
                  disabled={saving}
                  style={{ padding: "8px 22px", border: "none", borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? .7 : 1, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {saving ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 12 }}/> Placing…</> : <><i className="pi pi-check" style={{ fontSize: 11 }}/> Place Order</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ FILTERS ═══════════════ */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: C.grayL }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Filter:</div>
        {["Active","Completed","Cancelled","All"].map(s => (
          <button key={s} onClick={() => setFilterStat(s)} style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${filterStat === s ? C.primary : C.border}`, background: filterStat === s ? C.primaryL : "white", color: filterStat === s ? C.primary : C.muted }}>
            {s}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }}/>
        <select style={{ ...sel, width: "auto", fontSize: 11, padding: "3px 8px", minWidth: 120 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="All">All Types</option>
          {ORDER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {/* ═══════════════ ORDERS LIST ═══════════════ */}
      <div style={{ padding: "12px 14px", maxHeight: 520, overflowY: "auto" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 24, color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 20 }}/> <div style={{ fontSize: 12, marginTop: 6 }}>Loading orders…</div>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 28, color: C.muted }}>
            <i className="pi pi-list" style={{ fontSize: 28, opacity: .3 }}/>
            <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>No orders found</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {UHID ? 'Use the "+ New Order" button above to place the first order.' : "Load a patient to view orders."}
            </div>
          </div>
        )}
        {!loading && filtered.map(order => (
          <OrderCard key={order._id} order={order} onCancel={cancelOrder}/>
        ))}
      </div>

      {/* ── Footer legend ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "7px 16px", background: C.grayL, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {[["Pending","#d97706"],["In Progress","#0d9488"],["Completed","#16a34a"],["Cancelled","#dc2626"]].map(([l,c]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }}/>
            {l}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>Auto-refreshes every 30s</span>
      </div>
    </div>
  );
}
