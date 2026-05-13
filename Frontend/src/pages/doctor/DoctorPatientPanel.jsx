/**
 * DoctorPatientPanel.jsx  —  Full 360° patient file for doctors.
 * Purple/indigo theme. Tabs: Overview | Clinical Notes | Nursing Records |
 *   Vital Trends | Medications & Orders | Billing | Emergency
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import PatientFileExport from "../../Components/clinical/PatientFileExport";
// Phase 2 shell — the pf-* design system, shared with NursePatientPanel.
// Replaces ~225 lines of inline-styled chrome with a declarative invocation.
import PatientPanelShell from "../../Components/clinical/PatientPanelShell";
import {
  InitialAssessmentTab,
  MLCOrDoctorNotesTab,
  NursingNotesExpandedTab,
  VitalChartTab,
  IntakeOutputChartTab,
  BloodTransfusionRecordsTab,
  RBSMonitoringTab,
  HandoverNotesTab,
} from "../../Components/clinical/PatientPanelTabs";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

/* ── Design tokens ──────────────────────────────────────────────────────────── */
const C = {
  primary:"#7c3aed", primaryD:"#4c1d95", primaryL:"#f5f3ff", primaryM:"#ede9fe",
  blue:"#1e40af",    blueL:"#dbeafe",    blueB:"#93c5fd",
  green:"#059669",   greenL:"#d1fae5",   greenB:"#6ee7b7",
  red:"#dc2626",     redL:"#fee2e2",     redB:"#fca5a5",
  amber:"#d97706",   amberL:"#fef3c7",   amberB:"#fde68a",
  teal:"#0d9488",    tealL:"#f0fdfa",    tealB:"#99f6e4",
  pink:"#db2777",    pinkL:"#fdf2f8",
  muted:"#64748b",   dark:"#0f172a",     text:"#1e293b",
  card:"#ffffff",    bg:"#f8fafc",       border:"#e2e8f0",
};

// Tab order per user spec (May-12 patient-panel restructure):
//   1. Overview — keep the at-a-glance summary
//   2. Initial Assessment — combined doctor + nursing intake (NABH COP.2/IPSG.6)
//   3. MLC / Doctor Notes — MLC if cut, otherwise doctor notes timeline
//   4. Nursing Notes — fully-expanded categorised list
//   5. Vital Chart — every vital ever recorded, table view
//   6. Input/Output Chart — daily I/O with totals + net balance
//   7. Blood Transfusion — every transfusion record
//   8. RBS Monitoring — sugar readings + antidiabetic doses given
//   9. Treatment Chart — existing orders + admin audit trail
//  10. Orders / Medications / Billing / Emergency — kept
const TABS = [
  { id:"overview",   label:"📋 Overview"             },
  { id:"initial",    label:"🩺 Initial Assessment"   },
  { id:"mlc",        label:"⚖ MLC / Doctor Notes"   },
  { id:"nursing",    label:"📝 Nursing Notes"        },
  { id:"vitals",     label:"📈 Vital Chart"          },
  { id:"io",         label:"💧 Intake / Output"      },
  { id:"blood",      label:"🩸 Blood Transfusion"    },
  { id:"rbs",        label:"🩸 RBS Monitoring"       },
  { id:"handover",   label:"🔄 Handover Notes"       },
  { id:"treatment",  label:"💉 Treatment Chart"      },
  { id:"orders",     label:"📋 Orders"               },
  { id:"meds",       label:"💊 Medications"          },
  { id:"billing",    label:"💰 Billing"              },
  { id:"emergency",  label:"🚨 Emergency"            },
];

/* ── Formatters ─────────────────────────────────────────────────────────────── */
const fmtDT = d => { try { return d ? new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—"; } catch { return "—"; } };
const fmtDate = d => { try { return d ? new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—"; } catch { return "—"; } };
const fmtCur = n => `₹${(Number(n)||0).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
const bpStr = bp => bp && typeof bp === "object" ? `${bp.systolic||"—"}/${bp.diastolic||"—"}` : (bp || "—");

/* ── Shared UI ──────────────────────────────────────────────────────────────── */
function Spin() {
  return (
    <div style={{display:"flex",justifyContent:"center",padding:48}}>
      <div style={{width:34,height:34,borderRadius:"50%",border:`3px solid ${C.primaryM}`,borderTopColor:C.primary,animation:"spin .7s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
function Empty({icon="📭",msg="No data"}) {
  return <div style={{textAlign:"center",padding:"40px 24px",color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>{icon}</div><div style={{fontSize:13}}>{msg}</div></div>;
}
function Chip({label,value,color=C.primary,bg=C.primaryL}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:80}}>
      <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{label}</span>
      <span style={{fontSize:12,fontWeight:700,color}}>{value||"—"}</span>
    </div>
  );
}
function Badge({children,color=C.primary,bg=C.primaryL}) {
  return <span style={{display:"inline-block",padding:"2px 10px",borderRadius:999,fontSize:11,fontWeight:700,color,background:bg}}>{children}</span>;
}
function Card({title,titleColor=C.primaryD,children,style={}}) {
  return (
    <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:"hidden",...style}}>
      {title && <div style={{padding:"11px 18px",borderBottom:`1px solid ${C.border}`,background:C.primaryL,fontWeight:700,fontSize:13,color:titleColor}}>{title}</div>}
      <div style={{padding:18}}>{children}</div>
    </div>
  );
}
function InfoRow({label,value,wide}) {
  return (
    <div style={{display:"flex",gap:8,marginBottom:8,fontSize:13}}>
      <span style={{color:C.muted,minWidth:wide||130,flexShrink:0}}>{label}</span>
      <span style={{color:C.dark,fontWeight:500,wordBreak:"break-word"}}>{value||"—"}</span>
    </div>
  );
}

/* ── SVG Sparkline ──────────────────────────────────────────────────────────── */
function Sparkline({data,color="#7c3aed",width=120,height=38,label=""}) {
  if (!data || data.length < 2) return <span style={{fontSize:11,color:C.muted}}>—</span>;
  const min = Math.min(...data), max = Math.max(...data), range = max-min||1;
  const pts = data.map((v,i) => {
    const x = (i/(data.length-1))*width;
    const y = height - ((v-min)/range)*(height-8)-4;
    return `${x},${y}`;
  }).join(" ");
  const last = pts.split(" ").at(-1).split(",").map(Number);
  const latest = data.at(-1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2}}>
      {label && <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{label}</span>}
      <svg width={width} height={height}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx={last[0]} cy={last[1]} r={3.5} fill={color}/>
      </svg>
      <span style={{fontSize:11,fontWeight:700,color}}>{latest}</span>
    </div>
  );
}

/* ── Status badge ───────────────────────────────────────────────────────────── */
function SBadge({status}) {
  const s = (status||"").toLowerCase();
  if (s==="active"||s==="admitted") return <Badge color={C.green} bg={C.greenL}>Active</Badge>;
  if (s==="discharged")             return <Badge color={C.muted} bg="#f1f5f9">Discharged</Badge>;
  if (s==="signed")                 return <Badge color={C.green} bg={C.greenL}>✓ Signed</Badge>;
  if (s==="draft")                  return <Badge color={C.amber} bg={C.amberL}>Draft</Badge>;
  if (s==="done")                   return <Badge color={C.green} bg={C.greenL}>Done</Badge>;
  if (s==="pending")                return <Badge color={C.amber} bg={C.amberL}>Pending</Badge>;
  return <Badge color={C.muted} bg="#f1f5f9">{status||"—"}</Badge>;
}

/* ═══════════════════════════════════════════════════════ TAB: OVERVIEW */
function OverviewTab({patient, admission, opdVisits=[], billing, doctorNotes=[], nursingNotes=[], onShiftBed, pendingTransfer, onCancelTransfer}) {
  const signed   = doctorNotes.filter(n=>n.status==="signed").length;
  const drafts   = doctorNotes.filter(n=>n.status==="draft").length;
  const critical = doctorNotes.filter(n=>n.isCritical||n.isCriticalEvent).length;
  const nurseCount = nursingNotes.length;

  // Latest vitals from nursing notes
  const latestVitalNote = nursingNotes.find(n=>n.vitals && Object.values(n.vitals).some(v=>v));
  const lv = latestVitalNote?.vitals||{};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Allergy alert */}
      {patient?.knownAllergies && patient.knownAllergies !== "NKDA" && patient.knownAllergies !== "None" && (
        <div style={{padding:"12px 18px",background:C.redL,border:`2px solid ${C.red}`,borderRadius:10,fontSize:13,color:C.red,fontWeight:700,display:"flex",gap:10,alignItems:"center"}}>
          ⚠️ KNOWN ALLERGIES: {patient.knownAllergies}
        </div>
      )}

      {/* Pending bed transfer alert */}
      {pendingTransfer && (
        <div style={{padding:"14px 18px",background:"#fffbeb",border:"2px solid #f59e0b",borderRadius:12,display:"flex",alignItems:"flex-start",gap:14}}>
          <div style={{fontSize:26,flexShrink:0}}>🔄</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:14,color:"#92400e"}}>
              Bed Transfer Pending — Awaiting Nurse Handover
            </div>
            <div style={{fontSize:12,color:"#a16207",marginTop:4,lineHeight:1.5}}>
              Transfer initiated to <strong>{pendingTransfer.toBedNumber}</strong> ({pendingTransfer.toWardName}).
              Nurse must write handover notes to complete this transfer.
            </div>
            <div style={{fontSize:11,color:"#a16207",marginTop:6,fontStyle:"italic"}}>
              Shifting Notes: "{pendingTransfer.shiftingNotes?.slice(0,120)}{pendingTransfer.shiftingNotes?.length>120?"…":""}"
            </div>
          </div>
          <button onClick={()=>onCancelTransfer&&onCancelTransfer(pendingTransfer._id)}
            style={{padding:"7px 14px",background:"#fef3c7",color:"#92400e",border:"1.5px solid #fbbf24",borderRadius:7,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>
            Cancel Transfer
          </button>
        </div>
      )}

      {/* Quick stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14}}>
        {[
          {label:"Doctor Notes",   val:doctorNotes.length,  icon:"🩺", color:C.primary, bg:C.primaryL},
          {label:"Signed Notes",   val:signed,               icon:"✅", color:C.green,   bg:C.greenL},
          {label:"Draft Notes",    val:drafts,               icon:"📝", color:C.amber,   bg:C.amberL},
          {label:"Critical Events",val:critical,             icon:"⚠️", color:C.red,     bg:C.redL},
          {label:"Nursing Notes",  val:nurseCount,           icon:"👩‍⚕️", color:C.pink,    bg:C.pinkL},
          {label:"OPD Visits",     val:opdVisits.length,     icon:"📅", color:C.blue,    bg:C.blueL},
        ].map(s=>(
          <div key={s.label} style={{background:s.bg,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 18px",display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontSize:26}}>{s.icon}</span>
            <div>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,letterSpacing:".3px"}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Demographics + Admission */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <Card title="👤 Patient Demographics">
          <InfoRow label="Full Name"      value={`${patient?.title||""} ${patient?.fullName||patient?.patientName||""}`.trim()}/>
          <InfoRow label="UHID"           value={patient?.UHID||patient?.uhid}/>
          <InfoRow label="Age / Gender"   value={`${patient?.age||"—"} yrs / ${patient?.gender||"—"}`}/>
          <InfoRow label="Date of Birth"  value={fmtDate(patient?.dateOfBirth)}/>
          <InfoRow label="Blood Group"    value={patient?.bloodGroup}/>
          <InfoRow label="Contact"        value={patient?.contactNumber||patient?.phone}/>
          <InfoRow label="Payment Type"   value={patient?.paymentType}/>
        </Card>
        <Card title="🏥 Admission Details">
          <InfoRow label="IPD / Adm No."  value={admission?.admissionNumber}/>
          <InfoRow label="Type"           value={admission?.admissionType}/>
          <InfoRow label="Attending Dr."  value={admission?.attendingDoctor}/>
          <InfoRow label="Department"     value={admission?.department}/>
          <InfoRow label="Bed / Ward"     value={[admission?.bedNumber, admission?.wardName||admission?.ward].filter(Boolean).join(" — ") || "—"}/>
          <InfoRow label="Admitted"       value={fmtDate(admission?.admissionDate)}/>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
            <span style={{fontSize:13,color:C.muted,minWidth:130}}>Status</span>
            <SBadge status={admission?.status}/>
          </div>
          {["active","admitted"].includes((admission?.status||"").toLowerCase()) && onShiftBed && !pendingTransfer && (
            <button onClick={onShiftBed}
              style={{marginTop:14,width:"100%",padding:"9px",background:C.primaryL,color:C.primary,border:`1.5px solid ${C.primaryM}`,borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all .2s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=C.primaryM;}}
              onMouseLeave={e=>{e.currentTarget.style.background=C.primaryL;}}>
              🔄 Shift Bed
            </button>
          )}
          {pendingTransfer && (
            <div style={{marginTop:10,padding:"7px 10px",background:"#fffbeb",border:"1.5px solid #fbbf24",borderRadius:7,fontSize:11,color:"#92400e",fontWeight:700}}>
              🔄 Transfer pending → {pendingTransfer.toBedNumber}
            </div>
          )}
        </Card>
      </div>

      {/* Latest vitals snapshot */}
      {latestVitalNote && (
        <Card title={`💓 Latest Vitals — ${fmtDT(latestVitalNote.createdAt)}`}>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            {[
              {label:"BP",     value: bpStr(lv.bp),                    color: C.red},
              {label:"Pulse",  value: lv.pulse ? `${lv.pulse} /min` : null, color: Number(lv.pulse)>100||Number(lv.pulse)<60 ? C.red : C.green},
              {label:"Temp",   value: lv.temp  ? `${lv.temp}°F`    : null, color: Number(lv.temp)>99.5 ? C.red : C.green},
              {label:"SpO₂",  value: lv.spo2  ? `${lv.spo2}%`     : null, color: Number(lv.spo2)<95 ? C.red : C.green},
              {label:"RR",     value: lv.rr    ? `${lv.rr}/min`    : null, color: Number(lv.rr)>20||Number(lv.rr)<12 ? C.red : C.green},
              {label:"BSL",    value: lv.bsl   ? `${lv.bsl}mg/dL`  : null, color: C.text},
              {label:"GCS",    value: lv.gcs   ? String(lv.gcs)    : null, color: C.text},
            ].filter(f=>f.value).map(f=>(
              <div key={f.label} style={{background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",textAlign:"center",minWidth:80}}>
                <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>{f.label}</div>
                <div style={{fontSize:17,fontWeight:800,color:f.color}}>{f.value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent OPD visits */}
      {opdVisits.length > 0 && (
        <Card title="📅 Recent OPD Visits">
          {opdVisits.slice(0,5).map((v,i)=>(
            <div key={i} style={{padding:"10px 14px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:C.text}}>{v?.visitNumber||v?._id?.slice(-6)||"—"}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{v?.chiefComplaint||"—"}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,color:C.muted}}>{fmtDate(v?.visitDate)}</div>
                <SBadge status={v?.status}/>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: CLINICAL NOTES */
const NOTE_COLOR = {
  initial:      {color:"#92400e", bg:"#fffbeb", dot:"#fbbf24"},
  daily:        {color:C.blue,   bg:C.blueL,   dot:C.blueB},
  icu:          {color:C.red,    bg:C.redL,     dot:C.redB},
  procedure:    {color:"#c2410c",bg:"#fff7ed",  dot:"#fed7aa"},
  consultation: {color:"#6d28d9",bg:C.primaryL, dot:C.primaryM},
  preop:        {color:C.teal,   bg:C.tealL,    dot:C.tealB},
  postop:       {color:C.green,  bg:C.greenL,   dot:C.greenB},
  death:        {color:C.muted,  bg:"#f1f5f9",  dot:"#94a3b8"},
  medication:   {color:"#7c3aed",bg:C.primaryL, dot:C.primaryM},
  infusion:     {color:C.teal,   bg:C.tealL,    dot:C.tealB},
  amendment:    {color:C.amber,  bg:C.amberL,   dot:C.amberB},
};
const DR_MODULES_DP = [
  {id:"initial",      label:"Initial Assessment",    icon:"pi-clipboard"},
  {id:"medication",   label:"Medication Orders",     icon:"pi-tablet"},
  {id:"infusion",     label:"Infusion Orders",       icon:"pi-plus-circle"},
  {id:"daily",        label:"Daily Progress",        icon:"pi-file-edit"},
  {id:"icu",          label:"ICU / Critical Care",   icon:"pi-heart"},
  {id:"procedure",    label:"Procedure Note",        icon:"pi-cog"},
  {id:"consultation", label:"Consultation",          icon:"pi-users"},
  {id:"preop",        label:"Pre-operative",         icon:"pi-clock"},
  {id:"postop",       label:"Post-operative",        icon:"pi-check-circle"},
  {id:"death",        label:"Death Note",            icon:"pi-exclamation-triangle"},
  {id:"amendment",    label:"Amendment",             icon:"pi-pencil"},
];
const DR_FIELD_LBL_DP = {
  ventMode:"Vent Mode",fio2:"FiO₂ (%)",peep:"PEEP",tv:"Tidal Vol",ventRR:"Vent RR",pip:"PIP",
  map:"MAP",cvp:"CVP",rassScore:"RASS Score",bpsScore:"BPS Score",dailyGoals:"Daily Goals",
  neuro:"Neuro",cvs:"CVS",resp:"Resp",renal:"Renal",gi:"GI",haem:"Haem",infective:"Infective",
  sedation:"Sedation",vasopressors:"Vasopressors",vasopressorDetail:"Vasopressor Detail",
  procedureName:"Procedure",indication:"Indication",laterality:"Laterality",time:"Time",
  surgeon:"Surgeon",assistant:"Assistant",anaesthesia:"Anaesthesia",position:"Position",
  consentObtained:"Consent",technique:"Technique",findings:"Findings",complications:"Complications",
  bloodLoss:"Blood Loss",specimenSent:"Specimen Sent",specimenType:"Specimen Type",
  postInstructions:"Post Instructions",consultantName:"Consultant",speciality:"Speciality",
  referredBy:"Referred By",reason:"Reason",clinicalSummary:"Clinical Summary",
  impression:"Impression",recommendations:"Recommendations",followUp:"Follow-Up",
  asaGrade:"ASA Grade",plannedAnaesthesia:"Planned Anaesthesia",bloodGroup:"Blood Group",
  crossMatch:"Cross Match",comorbidities:"Comorbidities",currentMeds:"Current Meds",
  allergies:"Allergies",anaesthetist:"Anaesthetist",preopOrders:"Pre-op Orders",
  procedurePerformed:"Procedure Performed",operativeFindings:"Operative Findings",
  startTime:"Start",endTime:"End",transfusion:"Transfusion",fluidsGiven:"Fluids",
  urineOutput:"Urine Output",conditionLeavingOT:"Condition",
  recoveryInstructions:"Recovery Instructions",postopOrders:"Post-op Orders",
  causeDeath1:"Cause 1",causeDeath2:"Cause 2",causeDeath3:"Cause 3",
  contributing:"Contributing",sequenceOfEvents:"Sequence",modeOfDeath:"Mode of Death",
  dnrInPlace:"DNR",familyInformed:"Family Informed",correction:"Correction",witness:"Witness",
};
const DR_IA_SECTIONS_DP = [
  {label:"Admission Details",    keys:["admissionMode","chiefComplaint","duration","hpi"]},
  {label:"Past History",         keys:["pastMedical","pastSurgical","familyHistory","socialHistory","currentMeds","allergies"]},
  {label:"Vitals on Admission",  keys:["bp_sys","bp_dia","pulse","temp","spo2","rr","weight","height","bsl"]},
  {label:"Examination",          keys:["generalCondition","builtNutrition","pallor","icterus","cyanosis","clubbing","lymphadenopathy","oedema"]},
  {label:"System Examination",   keys:["resp","cvs","abdomen","cns"]},
  {label:"Diagnosis",            keys:["provisionalDx","differentialDx","finalDx","icd10"]},
  {label:"Management",           keys:["investigations","managementPlan"]},
];
const DR_IA_LBL_DP = {
  admissionMode:"Admission Mode",chiefComplaint:"Chief Complaint",duration:"Duration",hpi:"HPI",
  pastMedical:"Past Medical Hx",pastSurgical:"Past Surgical Hx",familyHistory:"Family History",
  socialHistory:"Social History",currentMeds:"Current Meds",allergies:"Allergies",
  bp_sys:"Systolic BP",bp_dia:"Diastolic BP",pulse:"Pulse",temp:"Temp (°F)",
  spo2:"SpO₂",rr:"Resp Rate",weight:"Weight (kg)",height:"Height (cm)",bsl:"BSL (mg/dL)",
  generalCondition:"General Condition",builtNutrition:"Built/Nutrition",pallor:"Pallor",
  icterus:"Icterus",cyanosis:"Cyanosis",clubbing:"Clubbing",lymphadenopathy:"Lymphadenopathy",
  oedema:"Oedema",resp:"Respiratory",cvs:"CVS",abdomen:"Abdomen",cns:"CNS",
  provisionalDx:"Provisional Dx",differentialDx:"Differential Dx",finalDx:"Final Dx",icd10:"ICD-10",
  investigations:"Investigations Planned",managementPlan:"Management Plan",
};
const dpFmtKey = k => DR_FIELD_LBL_DP[k] || k.replace(/([A-Z])/g," $1").trim();
const dpFmtVal = v => {
  if (v===null||v===undefined||v===""||v===false) return null;
  if (typeof v==="boolean") return "✓ Yes";
  if (Array.isArray(v)) {
    const items=v.filter(Boolean);
    if (!items.length) return null;
    return items.map(x=>typeof x==="object"?(x.drug||x.drugFluid||x.instruction||x.type||JSON.stringify(x)):String(x)).join(", ");
  }
  if (typeof v==="object") {
    if ("systolic" in v && "diastolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
    const inner=Object.entries(v).filter(([,x])=>x).map(([k2,v2])=>`${k2}:${v2}`).join(" | ");
    return inner||null;
  }
  return String(v);
};
/* Safe formatter — converts ANY noteDetails field value to a renderable string */
const dpIAFmt = v => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const items = v.filter(Boolean);
    if (!items.length) return "";
    return items.map(x =>
      typeof x === "object"
        ? (x.drug||x.name||x.instruction||x.type||x.statement||Object.values(x).filter(Boolean).join(" ")).trim()
        : String(x)
    ).filter(Boolean).join(", ");
  }
  if (typeof v === "object") {
    if ("systolic" in v && "diastolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
    return Object.entries(v).filter(([,x])=>x).map(([k2,x])=>`${k2}: ${x}`).join(" | ") || "";
  }
  return String(v);
};

function DpInitialDetails({nd, nc}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
      {DR_IA_SECTIONS_DP.map(sec=>{
        const chips = sec.keys
          .map(k=>({label:DR_IA_LBL_DP[k]||k, raw:nd[k], value:dpIAFmt(nd[k])}))
          .filter(c=>c.value);   /* dpIAFmt always returns string; empty string = falsy = skipped */
        if (!chips.length) return null;
        return (
          <div key={sec.label} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:nc.color,marginBottom:5}}>{sec.label}</div>
            <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
              {chips.map(c=>(
                <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.dark,maxWidth:260,wordBreak:"break-word"}}>{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }).filter(Boolean)}
    </div>
  );
}

function ClinicalNotesTab({notes=[]}) {
  const [filterType, setFilterType] = useState("All");
  const [collapsed,  setCollapsed]  = useState({}); // empty = all open by default

  const sortedNotes = [...notes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const types = ["All",...new Set(sortedNotes.map(n=>n.noteType||"daily").filter(Boolean))];
  const filtered = filterType==="All" ? sortedNotes : sortedNotes.filter(n=>(n.noteType||"daily")===filterType);

  if (!notes.length) return <Empty icon="🩺" msg="No clinical notes recorded yet"/>;

  const toggleNote = key => setCollapsed(p=>({...p,[key]:!p[key]}));
  const orderTypeIcon = t => t==="medication"?"💊":t==="iv_fluid"?"💧":t==="procedure"?"🔧":t==="diet"?"🍽️":"📋";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Summary strip */}
      <div style={{display:"flex",gap:8,padding:"10px 14px",background:C.primaryL,borderRadius:10,border:`1px solid ${C.primaryM}`,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:700,color:C.primary}}>🩺 {notes.length} Clinical Notes</span>
        <span style={{fontSize:11,color:C.muted}}>across {types.length-1} categor{types.length-1===1?"y":"ies"}</span>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {types.map(t=>{
          const nc = NOTE_COLOR[t]||NOTE_COLOR.daily;
          const mod = DR_MODULES_DP.find(m=>m.id===t);
          return (
            <button key={t} onClick={()=>setFilterType(t)}
              style={{padding:"4px 12px",borderRadius:20,border:`1.5px solid ${filterType===t?nc.dot:C.border}`,background:filterType===t?nc.dot:"white",color:filterType===t?"white":C.muted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              {t!=="All"&&mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
              {t==="All"?"All":(mod?.label||t)}
              {t!=="All"&&<span style={{fontSize:10,opacity:.8}}>({sortedNotes.filter(n=>(n.noteType||"daily")===t).length})</span>}
            </button>
          );
        })}
        <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{filtered.length} shown</span>
      </div>

      {/* Timeline container */}
      <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,.04)"}}>
        {/* Header */}
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.primaryL}}>
          <div style={{fontWeight:800,fontSize:14,color:C.primary}}>Clinical Notes Timeline</div>
          <span style={{fontSize:11,color:C.muted}}>{filtered.length} entries</span>
        </div>

        {filtered.map((note,i)=>{
          const noteKey = note._id||i;
          const isOpen  = !collapsed[noteKey]; // open by default
          const nc = NOTE_COLOR[note.noteType]||NOTE_COLOR.daily;
          const mod = DR_MODULES_DP.find(m=>m.id===note.noteType);
          const timeStr = note.createdAt
            ? new Date(note.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})
            : "--:--";
          const soap    = note.soap||{};
          const v       = note.vitals||null;
          const nd      = note.noteDetails||{};
          const hasSoap = soap.subjective||soap.objective||soap.assessment||soap.plan;
          const hasDiag = note.provisionalDiagnosis||note.finalDiagnosis;
          const hasInvx = note.investigations?.length>0;
          const hasOrds = note.orders?.length>0;
          const medOrds = nd.medicationOrders||[];
          const infOrds = nd.infusionOrders||[];
          const isInitial = note.noteType==="initial";

          /* Generic noteDetails blocks (non-initial) */
          const ndBlocks = isInitial ? [] : Object.entries(nd)
            .filter(([k])=>!["medicationOrders","infusionOrders"].includes(k))
            .map(([mk,mv])=>{
              if (!mv) return null;
              if (Array.isArray(mv)) {
                const items=mv.filter(Boolean);
                if (!items.length) return null;
                return {key:mk,label:DR_FIELD_LBL_DP[mk]||mk,chips:[{label:`${items.length} item(s)`,value:items.map(x=>typeof x==="object"?(x.drug||x.drugFluid||x.procedureName||x.type||"Item"):String(x)).join(" | ")}]};
              }
              if (typeof mv!=="object") {
                const val=dpFmtVal(mv);
                if (!val) return null;
                return {key:mk,label:"",chips:[{label:DR_FIELD_LBL_DP[mk]||dpFmtKey(mk),value:val}]};
              }
              const chips=Object.entries(mv).map(([k,v2])=>({label:dpFmtKey(k),value:dpFmtVal(v2)})).filter(c=>c.value!==null);
              if (!chips.length) return null;
              return {key:mk,label:DR_FIELD_LBL_DP[mk]||mk.replace(/([A-Z])/g," $1").trim(),chips};
            }).filter(Boolean);

          return (
            <div key={noteKey}
              style={{
                margin:"0 16px",padding:"0",
                borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",
                borderLeft:`4px solid ${nc.dot}`,
                transition:"background .15s",
              }}>

              {/* 3-col grid */}
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr auto",gap:16,alignItems:"start",padding:"16px 16px 0 16px"}}>

                {/* ── Time column ── */}
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,paddingTop:2}}>
                  <div style={{background:nc.bg,border:`1.5px solid ${nc.dot}30`,borderRadius:8,padding:"5px 8px",textAlign:"center",minWidth:62}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:800,color:nc.color,lineHeight:1}}>{timeStr}</div>
                    <div style={{fontSize:8,fontWeight:700,color:nc.color+"aa",textTransform:"uppercase",letterSpacing:".5px",marginTop:3}}>
                      {(note.shift||"morning").charAt(0).toUpperCase()+(note.shift||"morning").slice(1)}
                    </div>
                  </div>
                  <div style={{width:10,height:10,borderRadius:"50%",background:nc.dot,boxShadow:`0 0 0 3px ${nc.dot}30`}}/>
                  <SBadge status={note.status}/>
                </div>

                {/* ── Body ── */}
                <div>
                  {/* Clickable header — always visible */}
                  <div onClick={()=>toggleNote(noteKey)}
                    style={{display:"flex",alignItems:"center",gap:7,marginBottom:isOpen?8:0,flexWrap:"wrap",cursor:"pointer",userSelect:"none"}}>
                    <span style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontWeight:700,letterSpacing:".6px",background:nc.bg,color:nc.color,display:"flex",alignItems:"center",gap:5}}>
                      {mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
                      {mod?.label||note.noteType?.toUpperCase()||"Note"}
                    </span>
                    {(note.isCritical||note.isCriticalEvent) && (
                      <span style={{background:C.red,color:"white",padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:".5px",display:"flex",alignItems:"center",gap:4}}>
                        <i className="pi pi-exclamation-triangle" style={{fontSize:9}}/> CRITICAL EVENT
                      </span>
                    )}
                    {note.doctorName && <span style={{fontSize:11,color:C.muted,fontWeight:500}}>Dr. {note.doctorName}</span>}
                    {note.doctorRegNo && <span style={{fontSize:10,color:C.muted,opacity:.7}}>#{note.doctorRegNo}</span>}
                    <span style={{marginLeft:"auto",fontSize:11,color:nc.color,fontWeight:700,lineHeight:1}}>{isOpen?"▼":"▲"}</span>
                  </div>

                  {/* Collapsible content */}
                  {isOpen && (
                    <div>
                      {/* Vitals grid */}
                      {v && Object.values(v).some(x=>x) && (
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",padding:"10px 16px",background:`linear-gradient(to right, ${nc.bg}60, white)`,borderRadius:10,marginBottom:8}}>
                          {[
                            {label:"BP",    value:bpStr(v.bp)},
                            {label:"PULSE", value:v.pulse?`${v.pulse}/min`:"—"},
                            {label:"TEMP",  value:v.temp?`${v.temp}°F`:"—"},
                            {label:"SPO₂", value:v.spo2?`${v.spo2}%`:"—"},
                            {label:"RR",    value:v.rr?`${v.rr}/min`:"—"},
                            {label:"GCS",   value:v.gcs?String(v.gcs):"—"},
                            {label:"BSL",   value:v.bsl?`${v.bsl}mg/dL`:"—"},
                            {label:"URINE", value:v.urine?`${v.urine}mL/hr`:"—"},
                          ].filter(f=>f.value&&f.value!=="—").map(f=>(
                            <div key={f.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>{f.label}</span>
                              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,color:C.dark}}>{f.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* SOAP note */}
                      {hasSoap && (
                        <div style={{display:"flex",flexDirection:"column",gap:5,padding:"8px 12px",background:"#f9fafb",borderRadius:8,marginBottom:8,border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:nc.color,marginBottom:3}}>SOAP Note</div>
                          {[
                            {k:"S",label:"Subjective", v:soap.subjective, color:"#1e40af", bg:"#eff6ff"},
                            {k:"O",label:"Objective",  v:soap.objective,  color:"#0f766e", bg:"#f0fdfa"},
                            {k:"A",label:"Assessment", v:soap.assessment, color:"#9a3412", bg:"#fff7ed"},
                            {k:"P",label:"Plan",       v:soap.plan,       color:"#166534", bg:"#f0fdf4"},
                          ].filter(x=>x.v).map(x=>(
                            <div key={x.k} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                              <span style={{minWidth:18,height:18,borderRadius:4,background:x.color+"22",color:x.color,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{x.k}</span>
                              <span style={{fontSize:11.5,color:C.dark,lineHeight:1.55}}>{x.v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Diagnosis */}
                      {hasDiag && (
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                          {note.provisionalDiagnosis && (
                            <div style={{display:"flex",flexDirection:"column",gap:1,padding:"6px 10px",background:"#fefce8",borderRadius:6,border:"1px solid #fef08a"}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"#854d0e"}}>Provisional Dx</span>
                              <span style={{fontSize:11.5,fontWeight:600,color:"#713f12"}}>{note.provisionalDiagnosis}</span>
                            </div>
                          )}
                          {note.finalDiagnosis && (
                            <div style={{display:"flex",flexDirection:"column",gap:1,padding:"6px 10px",background:C.greenL,borderRadius:6,border:`1px solid ${C.greenB}`}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.green}}>Final Dx</span>
                              <span style={{fontSize:11.5,fontWeight:600,color:C.green}}>{note.finalDiagnosis}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Investigations */}
                      {hasInvx && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,marginBottom:4}}>Investigations Ordered</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {note.investigations.map((inv,ii)=>(
                              <span key={ii} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.primaryL,color:C.primary,border:`1px solid ${C.primaryM}`}}>{inv}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Orders */}
                      {hasOrds && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,marginBottom:4}}>Orders ({note.orders.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {note.orders.map((o,oi)=>(
                              <div key={oi} style={{display:"flex",gap:8,alignItems:"center",padding:"5px 10px",background:"#f9fafb",borderRadius:6,border:`1px solid ${C.border}`}}>
                                <span style={{fontSize:14}}>{orderTypeIcon(o.type)}</span>
                                <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{o.instruction||o.type||"—"}</span>
                                {o.dose      &&<Badge color={C.blue}  bg={C.blueL}>{o.dose}</Badge>}
                                {o.route     &&<Badge color={C.teal}  bg={C.tealL}>{o.route}</Badge>}
                                {o.frequency &&<Badge color={C.muted} bg="#f1f5f9">{o.frequency}</Badge>}
                                <SBadge status={o.nurseStatus||"pending"}/>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Medication Orders */}
                      {medOrds.length>0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.blue,marginBottom:4}}>💊 Medication Orders ({medOrds.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {medOrds.filter(m=>m.drug).map((m,mi)=>(
                              <div key={mi} style={{display:"flex",gap:6,alignItems:"center",padding:"5px 10px",background:C.blueL,borderRadius:6,border:`1px solid ${C.blueB}`}}>
                                <span style={{fontSize:12,fontWeight:600,color:C.blue,flex:1}}>{m.drug}</span>
                                {m.dose      &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.blue,fontWeight:600}}>{m.dose}</span>}
                                {m.route     &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.muted,fontWeight:600}}>{m.route}</span>}
                                {m.frequency &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.muted,fontWeight:600}}>{m.frequency}</span>}
                                <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:m.status==="Active"?C.greenL:C.redL,color:m.status==="Active"?C.green:C.red,fontWeight:700}}>{m.status||"Active"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Infusion Orders */}
                      {infOrds.length>0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.teal,marginBottom:4}}>💧 Infusion Orders ({infOrds.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {infOrds.filter(m=>m.drugFluid||m.type).map((m,mi)=>(
                              <div key={mi} style={{display:"flex",gap:6,alignItems:"center",padding:"5px 10px",background:C.tealL,borderRadius:6,border:`1px solid ${C.tealB}`}}>
                                <span style={{fontSize:12,fontWeight:600,color:C.teal,flex:1}}>{m.drugFluid||m.type||"Fluid"}</span>
                                {m.volume&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.teal,fontWeight:600}}>{m.volume} mL</span>}
                                {m.rate  &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.muted,fontWeight:600}}>{m.rate} mL/hr</span>}
                                <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:m.status==="Active"?C.greenL:C.redL,color:m.status==="Active"?C.green:C.red,fontWeight:700}}>{m.status||"Active"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Initial Assessment special renderer */}
                      {isInitial && Object.keys(nd).length>0 && <DpInitialDetails nd={nd} nc={nc}/>}

                      {/* Generic noteDetails renderer (non-initial) */}
                      {!isInitial && ndBlocks.length>0 && (
                        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:8}}>
                          {ndBlocks.map(({key,label,chips})=>(
                            <div key={key} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
                              {label&&<div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:nc.color,marginBottom:5}}>{label}</div>}
                              <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
                                {chips.map(c=>(
                                  <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                                    {c.label&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>}
                                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.dark}}>{c.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Remarks */}
                      {note.remarks && (
                        <div style={{fontSize:12.5,color:C.text,lineHeight:1.6,marginBottom:8,fontStyle:"italic"}}>{note.remarks}</div>
                      )}

                      {/* Tags */}
                      {note.tags?.length>0 && (
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                          {note.tags.map(t=>(
                            <span key={t} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.greenL,color:C.green,border:`1px solid ${C.greenB}`}}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Actions ── */}
                <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"flex-end"}}>
                  <div style={{fontSize:10,color:C.muted,textAlign:"right",marginBottom:4}}>{fmtDate(note.createdAt)}</div>
                  <button onClick={e=>{e.stopPropagation();toggleNote(noteKey);}}
                    style={{padding:"4px 10px",border:`1.5px solid ${isOpen?C.red+"60":nc.dot+"60"}`,borderRadius:6,background:isOpen?"#fff1f2":"white",fontSize:11,fontWeight:600,cursor:"pointer",color:isOpen?C.red:nc.color,display:"flex",alignItems:"center",gap:4}}>
                    <i className={`pi ${isOpen?"pi-times":"pi-chevron-down"}`} style={{fontSize:10}}/>{isOpen?" Close":" Open"}
                  </button>
                  <button style={{padding:"4px 10px",border:`1.5px solid ${C.border}`,borderRadius:6,background:"white",fontSize:11,fontWeight:600,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",gap:4}}>
                    <i className="pi pi-print" style={{fontSize:10}}/> Print
                  </button>
                </div>
              </div>
              <div style={{height:isOpen?16:12}}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: NURSING RECORDS */
const NURS_NOTE_STYLE_DP = {
  vitals:    {bg:"#dbeafe", color:"#1e40af",  dot:"#3b82f6"},
  blood:     {bg:"#fecaca", color:"#9f1239",  dot:"#dc2626"},
  iv:        {bg:"#f0fdfa", color:"#0d9488",  dot:"#0d9488"},
  wound:     {bg:"#fee2e2", color:"#b91c1c",  dot:"#ef4444"},
  pain:      {bg:"#fef3c7", color:"#92400e",  dot:"#d97706"},
  procedure: {bg:"#f5f3ff", color:"#7c3aed",  dot:"#7c3aed"},
  neuro:     {bg:"#f5f3ff", color:"#7c3aed",  dot:"#7c3aed"},
  fall:      {bg:"#fff7ed", color:"#ea580c",  dot:"#ea580c"},
  skin:      {bg:"#dcfce7", color:"#059669",  dot:"#059669"},
  intake:    {bg:"#dbeafe", color:"#1d4ed8",  dot:"#1d4ed8"},
  general:   {bg:"#f9fafb", color:"#374151",  dot:"#9ca3af"},
  discharge: {bg:"#dcfce7", color:"#059669",  dot:"#059669"},
  mews:      {bg:"#fef3c7", color:"#92400e",  dot:"#d97706"},
  daily:     {bg:"#e0f2fe", color:"#0369a1",  dot:"#0ea5e9"},
  initial:   {bg:"#fdf2f8", color:"#be185d",  dot:"#ec4899"},
  careplan:  {bg:"#ecfdf5", color:"#065f46",  dot:"#10b981"},
  nutrition: {bg:"#dcfce7", color:"#15803d",  dot:"#22c55e"},
  education: {bg:"#f5f3ff", color:"#6d28d9",  dot:"#8b5cf6"},
};
const NURS_MODULES_DP = [
  {id:"vitals",    label:"Vital Signs",                icon:"pi-heart"},
  {id:"neuro",     label:"Neuro / GCS",                icon:"pi-eye"},
  {id:"pain",      label:"Pain Assessment",             icon:"pi-exclamation-circle"},
  {id:"intake",    label:"Intake / Output",             icon:"pi-sort-alt"},
  {id:"iv",        label:"IV Infusion",                 icon:"pi-plus-circle"},
  {id:"blood",     label:"Blood Transfusion",           icon:"pi-heart-fill"},
  {id:"wound",     label:"Wound / Dressing",            icon:"pi-pencil"},
  {id:"skin",      label:"Skin / Pressure",             icon:"pi-th-large"},
  {id:"fall",      label:"Fall Risk (Morse)",           icon:"pi-exclamation-triangle"},
  {id:"procedure", label:"Procedure / Intervention",    icon:"pi-cog"},
  {id:"discharge", label:"Discharge / SBAR",            icon:"pi-sign-out"},
  {id:"mews",      label:"MEWS Score",                  icon:"pi-chart-bar"},
  {id:"general",   label:"General Observation",         icon:"pi-file"},
  {id:"daily",     label:"Daily Assessment",            icon:"pi-calendar-plus"},
  {id:"initial",   label:"Initial Assessment",          icon:"pi-clipboard"},
  {id:"careplan",  label:"Care Plan",                   icon:"pi-heart-fill"},
  {id:"nutrition", label:"Nutritional Assessment",      icon:"pi-apple"},
  {id:"education", label:"Patient Education",           icon:"pi-book"},
];
const NURS_SEC_LBL_DP = {
  painAssessment:"Pain Assessment",neuroAssessment:"Neuro / GCS",
  bloodTransfusion:"Blood Transfusion",ivInfusion:"IV Infusion",
  intakeOutput:"Intake / Output",woundCare:"Wound / Dressing",
  skinAssessment:"Skin / Pressure (Braden)",fallRisk:"Fall Risk (Morse)",
  procedure:"Procedure / Intervention",discharge:"Discharge / Handover (SBAR)",
  dailyAssessment:"Daily Assessment",initialAssessment:"Initial Assessment",
  carePlan:"Care Plan",nutritionalAssessment:"Nutritional Assessment (NRS-2002)",
  patientEducation:"Patient Education",vitals:"Vital Signs",mewsScore:"MEWS Score",
};
const nursValFmt = v => {
  if (v===null||v===undefined||v===""||v===false) return null;
  if (typeof v==="boolean") return "✓ Yes";
  if (Array.isArray(v)) {
    const items=v.filter(Boolean);
    if (!items.length) return null;
    return items.map(x=>typeof x==="object"?(x.statement||x.topic||x.name||JSON.stringify(x)):String(x)).join(", ");
  }
  if (typeof v==="object") {
    if ("systolic" in v && "diastolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
    return Object.entries(v).filter(([,x])=>x).map(([k2,v2])=>`${k2}:${v2}`).join(" | ")||null;
  }
  return String(v);
};
const nursKeyFmt = k => k.replace(/([A-Z])/g," $1").replace(/^[Ii]nt /,"").trim();

function NursingRecordsTab({notes=[]}) {
  const [filterType, setFilterType] = useState("All");
  const [collapsed,  setCollapsed]  = useState({}); // empty = all open by default

  const sorted = [...notes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const types  = ["All",...new Set(sorted.map(n=>n.noteType||"general").filter(Boolean))];
  const filtered = filterType==="All"?sorted:sorted.filter(n=>(n.noteType||"general")===filterType);

  if (!notes.length) return <Empty icon="📝" msg="No nursing records found"/>;

  const toggleNote = key => setCollapsed(p=>({...p,[key]:!p[key]}));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Summary strip */}
      <div style={{display:"flex",gap:8,padding:"10px 14px",background:C.pinkL,borderRadius:10,border:`1px solid ${C.pink}30`,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:700,color:C.pink}}>📝 {notes.length} Nursing Records</span>
        <span style={{fontSize:11,color:C.muted}}>across {types.length-1} categor{types.length-1===1?"y":"ies"}</span>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {types.map(t=>{
          const ns  = NURS_NOTE_STYLE_DP[t]||{bg:"#f9fafb",color:"#374151",dot:"#9ca3af"};
          const mod = NURS_MODULES_DP.find(m=>m.id===t);
          return (
            <button key={t} onClick={()=>setFilterType(t)}
              style={{padding:"4px 12px",borderRadius:20,border:`1.5px solid ${filterType===t?ns.dot:C.border}`,background:filterType===t?ns.dot:"white",color:filterType===t?"white":C.muted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              {t!=="All"&&mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
              {t==="All"?"All":(mod?.label||t)}
              {t!=="All"&&<span style={{fontSize:10,opacity:.8}}>({sorted.filter(n=>(n.noteType||"general")===t).length})</span>}
            </button>
          );
        })}
        <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{filtered.length} shown</span>
      </div>

      {/* Timeline container */}
      <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,.04)"}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.pinkL}}>
          <div style={{fontWeight:800,fontSize:14,color:C.pink}}>Nursing Records Timeline</div>
          <span style={{fontSize:11,color:C.muted}}>{filtered.length} entries</span>
        </div>

        {filtered.map((note,i)=>{
          const noteKey = note._id||i;
          const isOpen  = !collapsed[noteKey];
          const ns  = NURS_NOTE_STYLE_DP[note.noteType]||{bg:"#f9fafb",color:"#374151",dot:"#9ca3af"};
          const mod = NURS_MODULES_DP.find(m=>m.id===note.noteType);
          const timeStr = note.createdAt
            ? new Date(note.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})
            : "--:--";
          const v  = note.vitals||null;
          const md = note.moduleData||{};

          /* Generic module data blocks */
          const mdBlocks = Object.entries(md).map(([mk,mv])=>{
            if (!mv) return null;
            if (Array.isArray(mv)) {
              const items=mv.filter(Boolean);
              if (!items.length) return null;
              const summary=items.map((x,idx)=>typeof x==="object"?(x.statement||x.topic||x.name||`Item ${idx+1}`):String(x)).join(" | ");
              return {key:mk,label:NURS_SEC_LBL_DP[mk]||mk,chips:[{label:`${items.length} item(s)`,value:summary}]};
            }
            if (typeof mv!=="object") return null;
            const chips=Object.entries(mv).map(([k2,v2])=>({label:nursKeyFmt(k2),value:nursValFmt(v2)})).filter(c=>c.value!==null);
            if (!chips.length) return null;
            return {key:mk,label:NURS_SEC_LBL_DP[mk]||mk.replace(/([A-Z])/g," $1").trim(),chips};
          }).filter(Boolean);

          return (
            <div key={noteKey}
              style={{
                margin:"0 16px",padding:"0",
                borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",
                borderLeft:`4px solid ${ns.dot}`,
                transition:"background .15s",
              }}>

              <div style={{display:"grid",gridTemplateColumns:"80px 1fr auto",gap:16,alignItems:"start",padding:"16px 16px 0 16px"}}>

                {/* ── Time column ── */}
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,paddingTop:2}}>
                  <div style={{background:ns.bg,border:`1.5px solid ${ns.dot}30`,borderRadius:8,padding:"5px 8px",textAlign:"center",minWidth:62}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:800,color:ns.color,lineHeight:1}}>{timeStr}</div>
                    <div style={{fontSize:8,fontWeight:700,color:ns.color+"aa",textTransform:"uppercase",letterSpacing:".5px",marginTop:3}}>
                      {(note.shift||"morning").charAt(0).toUpperCase()+(note.shift||"morning").slice(1)}
                    </div>
                  </div>
                  <div style={{width:10,height:10,borderRadius:"50%",background:ns.dot,boxShadow:`0 0 0 3px ${ns.dot}30`}}/>
                  <SBadge status={note.status}/>
                </div>

                {/* ── Body ── */}
                <div>
                  {/* Clickable header */}
                  <div onClick={()=>toggleNote(noteKey)}
                    style={{display:"flex",alignItems:"center",gap:7,marginBottom:isOpen?8:0,flexWrap:"wrap",cursor:"pointer",userSelect:"none"}}>
                    <span style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontWeight:700,letterSpacing:".6px",background:ns.bg,color:ns.color,display:"flex",alignItems:"center",gap:5}}>
                      {mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
                      {mod?.label||note.noteType?.toUpperCase()||"Nursing"}
                    </span>
                    {note.isCriticalEvent && (
                      <span style={{background:C.red,color:"white",padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:".5px",display:"flex",alignItems:"center",gap:4}}>
                        <i className="pi pi-exclamation-triangle" style={{fontSize:9}}/> CRITICAL EVENT
                      </span>
                    )}
                    {note.nurseName && <span style={{fontSize:11,color:C.muted,fontWeight:500}}>{note.nurseName}</span>}
                    <span style={{marginLeft:"auto",fontSize:11,color:ns.color,fontWeight:700,lineHeight:1}}>{isOpen?"▼":"▲"}</span>
                  </div>

                  {/* Collapsible content */}
                  {isOpen && (
                    <div>
                      {/* Vitals grid */}
                      {v && Object.values(v).some(x=>x) && (
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",padding:"10px 16px",background:`linear-gradient(to right, ${ns.bg}60, white)`,borderRadius:10,marginBottom:8}}>
                          {[
                            {label:"BP",    value:bpStr(v.bp)},
                            {label:"PULSE", value:v.pulse?`${v.pulse}/min`:"—"},
                            {label:"TEMP",  value:v.temp?`${v.temp}°F`:"—"},
                            {label:"SPO₂", value:v.spo2?`${v.spo2}%`:"—"},
                            {label:"RR",    value:v.rr?`${v.rr}/min`:"—"},
                            {label:"GCS",   value:v.gcs?String(v.gcs):"—"},
                            {label:"BSL",   value:v.bsl?`${v.bsl}mg/dL`:"—"},
                          ].filter(f=>f.value&&f.value!=="—").map(f=>(
                            <div key={f.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>{f.label}</span>
                              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,color:C.dark}}>{f.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Remarks */}
                      {note.remarks && (
                        <div style={{fontSize:12.5,color:C.dark,lineHeight:1.6,marginBottom:8}}>{note.remarks}</div>
                      )}

                      {/* Orders Executed */}
                      {note.ordersExecuted?.length>0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,marginBottom:4}}>Orders Executed ({note.ordersExecuted.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {note.ordersExecuted.map((o,oi)=>(
                              <div key={oi} style={{display:"flex",gap:8,alignItems:"center",padding:"5px 10px",background:"#f9fafb",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12}}>
                                <span style={{fontSize:14}}>{o.status==="done"?"✅":o.status==="skipped"?"⏭️":"⚡"}</span>
                                <span style={{flex:1,color:C.dark}}>{o.instruction||"—"}</span>
                                <SBadge status={o.status}/>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Nursing Care */}
                      {note.nursingCare && Object.values(note.nursingCare).some(v=>v) && (
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                          <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,alignSelf:"center"}}>Care done:</span>
                          {Object.entries(note.nursingCare).filter(([,v])=>v===true).map(([k])=>(
                            <span key={k} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.greenL,color:C.green,border:`1px solid ${C.greenB}`}}>{k.replace(/([A-Z])/g," $1").trim()}</span>
                          ))}
                        </div>
                      )}

                      {/* Module data generic renderer */}
                      {mdBlocks.length>0 && (
                        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:8}}>
                          {mdBlocks.map(({key,label,chips})=>(
                            <div key={key} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
                              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:ns.color,marginBottom:5}}>{label}</div>
                              <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
                                {chips.map(c=>(
                                  <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                                    {c.label&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>}
                                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.dark}}>{c.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Tags */}
                      {note.tags?.length>0 && (
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                          {note.tags.map(t=>(
                            <span key={t} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.pinkL,color:C.pink,border:`1px solid ${C.pink}30`}}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Actions ── */}
                <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"flex-end"}}>
                  <div style={{fontSize:10,color:C.muted,textAlign:"right",marginBottom:4}}>{fmtDate(note.createdAt)}</div>
                  <button onClick={e=>{e.stopPropagation();toggleNote(noteKey);}}
                    style={{padding:"4px 10px",border:`1.5px solid ${isOpen?C.red+"60":ns.dot+"60"}`,borderRadius:6,background:isOpen?"#fff1f2":"white",fontSize:11,fontWeight:600,cursor:"pointer",color:isOpen?C.red:ns.color,display:"flex",alignItems:"center",gap:4}}>
                    <i className={`pi ${isOpen?"pi-times":"pi-chevron-down"}`} style={{fontSize:10}}/>{isOpen?" Close":" Open"}
                  </button>
                  <button style={{padding:"4px 10px",border:`1.5px solid ${C.border}`,borderRadius:6,background:"white",fontSize:11,fontWeight:600,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",gap:4}}>
                    <i className="pi pi-print" style={{fontSize:10}}/> Print
                  </button>
                </div>
              </div>
              <div style={{height:isOpen?16:12}}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: VITAL TRENDS */
function VitalTrendsTab({vitalSheet=[]}) {
  // Flatten all tableData across all dates
  const allRows = [];
  vitalSheet.forEach(sheet => {
    (sheet.tableData||[]).forEach(row => {
      allRows.push({date:sheet.date, time:row.time, values:row.values||{}, nurse:row.nurse});
    });
  });
  allRows.sort((a,b)=>(`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`));

  const extract = key => allRows.map(r=>r.values[key]?.value).filter(v=>v!=null&&!isNaN(Number(v))).map(Number);

  const sbps  = extract("BP Systolic");
  const dbps  = extract("BP Diastolic");
  const pulse = extract("Pulse");
  const temp  = extract("Temperature");
  const spo2  = extract("SpO2");
  const rr    = extract("Resp Rate");
  const bsl   = extract("BSL");
  const pain  = extract("Pain Score");

  const RANGES = {sbp:{lo:90,hi:140},dbp:{lo:60,hi:90},pulse:{lo:60,hi:100},temp:{lo:97,hi:99.5},spo2:{lo:95,hi:100},rr:{lo:12,hi:20}};
  const isAbn = (key,val) => { const r=RANGES[key]; return r&&(val<r.lo||val>r.hi); };

  if (!allRows.length) return <Empty icon="📈" msg="No vital sheet records found. Record vitals via the Vitals tab in Nursing Notes."/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Sparklines grid */}
      <Card title="📈 Vital Trends">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:20}}>
          {[
            {label:"Systolic BP",  data:sbps,   color:C.red,    unit:"mmHg"},
            {label:"Diastolic BP", data:dbps,   color:"#db2777",unit:"mmHg"},
            {label:"Pulse",        data:pulse,  color:C.primary,unit:"/min"},
            {label:"Temperature",  data:temp,   color:C.amber,  unit:"°F"},
            {label:"SpO₂",        data:spo2,   color:C.teal,   unit:"%"},
            {label:"Resp Rate",    data:rr,     color:C.blue,   unit:"/min"},
            {label:"BSL",         data:bsl,    color:C.green,  unit:"mg/dL"},
            {label:"Pain Score",  data:pain,   color:"#f59e0b",unit:"/10"},
          ].filter(s=>s.data.length>0).map(s=>{
            const latest = s.data.at(-1);
            const abn = s.label.includes("Systolic") ? isAbn("sbp",latest)
                      : s.label.includes("Diastolic") ? isAbn("dbp",latest)
                      : s.label==="Pulse" ? isAbn("pulse",latest)
                      : s.label==="SpO₂" ? isAbn("spo2",latest)
                      : s.label==="Resp Rate" ? isAbn("rr",latest) : false;
            return (
              <div key={s.label} style={{background:abn?C.redL:C.bg,border:`1.5px solid ${abn?C.red:C.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",color:abn?C.red:C.muted,letterSpacing:".5px",marginBottom:8}}>{s.label}</div>
                <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
                  <Sparkline data={s.data} color={abn?C.red:s.color} width={100} height={40}/>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:20,fontWeight:800,color:abn?C.red:s.color}}>{latest}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s.unit}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s.data.length} readings</div>
                  </div>
                </div>
                {s.data.length>1 && (
                  <div style={{fontSize:10,color:C.muted,marginTop:6}}>
                    Min: {Math.min(...s.data)} · Max: {Math.max(...s.data)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Vital table */}
      <Card title="📋 Vital Readings Log">
        <div style={{overflowX:"auto",maxHeight:400}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead style={{position:"sticky",top:0}}>
              <tr style={{background:C.primaryL}}>
                {["Date","Time","BP","Pulse","Temp °F","SpO₂%","RR/min","BSL","Pain","Nurse"].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.primaryM}`,whiteSpace:"nowrap",fontSize:11,textTransform:"uppercase",letterSpacing:".4px"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...allRows].reverse().map((row,i)=>{
                const val = key => row.values[key]?.value;
                const sbpV = val("BP Systolic"), dbpV = val("BP Diastolic");
                const bpDisplay = sbpV && dbpV ? `${sbpV}/${dbpV}` : sbpV||dbpV||"—";
                const pulseV = val("Pulse"), spo2V = val("SpO2");
                return (
                  <tr key={i} style={{background:i%2?"#fafaf9":C.card,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"7px 12px",fontWeight:600,color:C.muted}}>{row.date}</td>
                    <td style={{padding:"7px 12px",fontWeight:700,color:C.teal}}>{row.time}</td>
                    <td style={{padding:"7px 12px",fontWeight:600,color:isAbn("sbp",sbpV)?C.red:C.text}}>{bpDisplay}</td>
                    <td style={{padding:"7px 12px",color:isAbn("pulse",pulseV)?C.red:C.text}}>{pulseV||"—"}</td>
                    <td style={{padding:"7px 12px"}}>{val("Temperature")||"—"}</td>
                    <td style={{padding:"7px 12px",color:isAbn("spo2",spo2V)?C.red:C.text}}>{spo2V||"—"}</td>
                    <td style={{padding:"7px 12px"}}>{val("Resp Rate")||"—"}</td>
                    <td style={{padding:"7px 12px"}}>{val("BSL")||"—"}</td>
                    <td style={{padding:"7px 12px"}}>{val("Pain Score")||"—"}</td>
                    <td style={{padding:"7px 12px",color:C.muted,fontSize:11}}>{row.nurse||"—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: MEDICATIONS */
function MedicationsTab({doctorNotes=[], doctorOrders=[]}) {
  // Collect all medication orders from doctor notes (noteDetails.medicationOrders)
  const medNotes = doctorNotes.filter(n=>n.noteDetails?.medicationOrders?.length>0||n.noteType==="medication");
  // Also collect from doctor orders collection
  const allMeds = [];
  medNotes.forEach(note=>{
    const meds = note.noteDetails?.medicationOrders||[];
    meds.forEach(m=>{
      allMeds.push({...m, noteDate:note.createdAt, noteType:note.noteType, doctorName:note.doctorName, noteId:note._id});
    });
  });

  // Also parse from doctorOrders
  const ordMeds = (doctorOrders||[]).filter(o=>{
    const route = (o.orderDetails?.route||"").toLowerCase();
    return !route.includes("iv")||true; // include all
  });

  if (!allMeds.length && !ordMeds.length) return <Empty icon="💊" msg="No medication orders found"/>;

  // Group by status
  const active  = allMeds.filter(m=>(m.status||"Active")==="Active");
  const stopped = allMeds.filter(m=>m.status==="Stopped"||m.status==="Discontinued");
  const other   = allMeds.filter(m=>!["Active","Stopped","Discontinued"].includes(m.status||"Active"));

  const MedTable = ({title,meds,color=C.primary}) => meds.length===0 ? null : (
    <Card title={title} titleColor={color}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:C.primaryL}}>
              {["Drug","Dose","Route","Frequency","Duration","Indication","Status","Ordered By","Date"].map(h=>(
                <th key={h} style={{padding:"7px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`1.5px solid ${C.primaryM}`,whiteSpace:"nowrap",fontSize:10,textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meds.map((m,i)=>(
              <tr key={i} style={{background:i%2?"#fafaf9":C.card,borderBottom:`1px solid ${C.border}`}}>
                <td style={{padding:"7px 12px",fontWeight:700,color:C.dark}}>{m.drug||m.medicineName||"—"}</td>
                <td style={{padding:"7px 12px"}}>{m.dose||"—"}</td>
                <td style={{padding:"7px 12px"}}><Badge color={C.teal} bg={C.tealL}>{m.route||"—"}</Badge></td>
                <td style={{padding:"7px 12px"}}>{m.frequency||"—"}</td>
                <td style={{padding:"7px 12px"}}>{m.duration||"—"}</td>
                <td style={{padding:"7px 12px",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.indication||"—"}</td>
                <td style={{padding:"7px 12px"}}><SBadge status={m.status||"Active"}/></td>
                <td style={{padding:"7px 12px",fontSize:11,color:C.muted}}>{m.doctorName?"Dr. "+m.doctorName:"—"}</td>
                <td style={{padding:"7px 12px",fontSize:11,color:C.muted}}>{fmtDate(m.noteDate||m.datetime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <MedTable title={`💊 Active Medications (${active.length})`} meds={active} color={C.green}/>
      {stopped.length>0 && <MedTable title={`🚫 Stopped / Discontinued (${stopped.length})`} meds={stopped} color={C.red}/>}
      {other.length>0   && <MedTable title={`📋 Other Orders (${other.length})`}           meds={other}   color={C.amber}/>}
      {/* From treatment orders */}
      {ordMeds.length>0 && (
        <Card title={`📋 Doctor Orders — MAR (${ordMeds.length})`} titleColor={C.blue}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.blueL}}>
                  {["Medicine","Dose","Route","Frequency","Ordered","Given Today","Status"].map(h=>(
                    <th key={h} style={{padding:"7px 12px",textAlign:"left",fontWeight:700,color:C.blue,borderBottom:`1.5px solid ${C.blueB}`,whiteSpace:"nowrap",fontSize:10,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordMeds.map((o,i)=>{
                  const d = o.orderDetails||{};
                  const givenToday = (o.administrationRecord||[]).filter(r=>{
                    const dt = new Date(r.givenAt||"");
                    const t = new Date();
                    return dt.getFullYear()===t.getFullYear()&&dt.getMonth()===t.getMonth()&&dt.getDate()===t.getDate();
                  }).length;
                  return (
                    <tr key={i} style={{background:i%2?"#f0f4ff":C.card,borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:"7px 12px",fontWeight:700,color:C.dark}}>{d.medicineName||"—"}</td>
                      <td style={{padding:"7px 12px"}}>{d.dose||"—"}</td>
                      <td style={{padding:"7px 12px"}}><Badge color={C.teal} bg={C.tealL}>{d.route||"—"}</Badge></td>
                      <td style={{padding:"7px 12px"}}>{d.frequency||"—"}</td>
                      <td style={{padding:"7px 12px",fontSize:11,color:C.muted}}>{fmtDate(o.orderedAt||o.createdAt)}</td>
                      <td style={{padding:"7px 12px"}}>{givenToday>0?<Badge color={C.green} bg={C.greenL}>{givenToday}× given</Badge>:<Badge color={C.amber} bg={C.amberL}>Pending</Badge>}</td>
                      <td style={{padding:"7px 12px"}}><SBadge status={o.status||"Active"}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {allMeds.length===0 && ordMeds.length===0 && <Empty icon="💊" msg="No medication orders found"/>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: ORDERS (date-wise + audit trail) */
function OrdersTab({doctorNotes=[]}) {
  const orderTypeIcon = t => t==="medication"?"💊":t==="iv_fluid"?"💧":t==="procedure"?"🔧":t==="diet"?"🍽️":"📋";
  const statColor = s => s==="done"?C.green:s==="partial"?C.amber:s==="skipped"?C.muted:C.amber;

  /* Build date→orders map */
  const byDate = {};
  doctorNotes.forEach(note=>{
    (note.orders||[]).forEach(o=>{
      const dk = note.createdAt ? new Date(note.createdAt).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
      if (!byDate[dk]) byDate[dk]=[];
      byDate[dk].push({...o, noteDate:note.createdAt, doctorName:note.doctorName, noteType:note.noteType});
    });
  });

  const dates = Object.keys(byDate).sort().reverse();
  const today = new Date().toISOString().slice(0,10);
  const allOrders = doctorNotes.flatMap(n=>(n.orders||[]).map(o=>({...o,noteDate:n.createdAt,doctorName:n.doctorName})));
  const [selDate, setSelDate] = useState(dates[0]||today);

  if (!allOrders.length) return <Empty icon="📋" msg="No doctor orders found in notes"/>;

  const dateIdx      = dates.indexOf(selDate);
  const ordersOnDate = byDate[selDate]||[];
  const pending      = ordersOnDate.filter(o=>!o.nurseStatus||o.nurseStatus==="pending");
  const done         = ordersOnDate.filter(o=>o.nurseStatus==="done"||o.nurseStatus==="partial");
  const skipped      = ordersOnDate.filter(o=>o.nurseStatus==="skipped");

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Date navigator ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",background:C.amberL,borderRadius:12,border:`1px solid ${C.amberB}`}}>
        <button onClick={()=>setSelDate(dates[dateIdx+1])} disabled={dateIdx>=dates.length-1}
          style={{padding:"6px 16px",borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",cursor:dateIdx>=dates.length-1?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:C.amber,opacity:dateIdx>=dates.length-1?0.35:1}}>
          ◀ Prev
        </button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontWeight:800,fontSize:16,color:"#92400e"}}>
            {selDate===today?"📅 Today — ":""}{new Date(selDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            {ordersOnDate.length} order{ordersOnDate.length!==1?"s":""} · {pending.length} pending · {done.length} done{skipped.length?` · ${skipped.length} skipped`:""}
          </div>
        </div>
        <button onClick={()=>setSelDate(dates[dateIdx-1])} disabled={dateIdx<=0}
          style={{padding:"6px 16px",borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",cursor:dateIdx<=0?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:C.amber,opacity:dateIdx<=0?0.35:1}}>
          Next ▶
        </button>
      </div>

      {/* ── Date chips ── */}
      {dates.length>1 && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {dates.map(d=>{
            const cnt=(byDate[d]||[]).length;
            const isSel=selDate===d;
            return (
              <button key={d} onClick={()=>setSelDate(d)}
                style={{padding:"3px 12px",borderRadius:16,border:`1.5px solid ${isSel?C.amber:C.border}`,background:isSel?C.amber:"white",color:isSel?"white":C.muted,fontSize:10,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                {d===today?"Today":new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}
                <span style={{opacity:.8}}>({cnt})</span>
              </button>
            );
          })}
        </div>
      )}

      {ordersOnDate.length===0
        ? <Empty icon="📋" msg="No orders recorded on this date"/>
        : (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Summary pills */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[
              {label:"Total",   val:ordersOnDate.length, color:C.primary, bg:C.primaryL},
              {label:"Pending", val:pending.length,       color:C.amber,   bg:C.amberL},
              {label:"Done",    val:done.length,           color:C.green,   bg:C.greenL},
              {label:"Skipped", val:skipped.length,        color:C.muted,   bg:"#f1f5f9"},
            ].map(s=>(
              <div key={s.label} style={{padding:"8px 16px",borderRadius:10,background:s.bg,border:`1px solid ${C.border}`,display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:s.color}}>{s.label}</span>
                <span style={{fontSize:20,fontWeight:800,color:s.color}}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* Orders list */}
          <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,.04)"}}>
            <div style={{padding:"13px 18px",background:C.amberL,borderBottom:`1px solid ${C.border}`,fontWeight:800,fontSize:13,color:"#92400e"}}>
              📋 Orders — {new Date(selDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}
            </div>
            {ordersOnDate.map((o,i)=>(
              <div key={i} style={{padding:"14px 18px",borderBottom:i<ordersOnDate.length-1?`1px solid ${C.border}`:"none",background:i%2?"#fafaf9":C.card}}>
                <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                  <div style={{width:38,height:38,borderRadius:9,background:o.nurseStatus==="done"?C.greenL:C.amberL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                    {orderTypeIcon(o.type)}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.dark,marginBottom:4}}>{o.instruction||"—"}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                      {o.dose      && <Badge color={C.teal}  bg={C.tealL}>{o.dose}</Badge>}
                      {o.route     && <Badge color={C.blue}  bg={C.blueL}>{o.route}</Badge>}
                      {o.frequency && <Badge color={C.muted} bg="#f1f5f9">{o.frequency}</Badge>}
                      {o.duration  && <Badge color={C.muted} bg="#f1f5f9">{o.duration}</Badge>}
                      {o.priority && o.priority!=="ROUTINE" && <Badge color={C.red} bg={C.redL}>{o.priority}</Badge>}
                    </div>
                    {o.notes && <div style={{fontSize:11,color:C.muted,marginBottom:8,fontStyle:"italic"}}>{o.notes}</div>}

                    {/* ── Audit Trail ── */}
                    <div style={{padding:"8px 12px",background:"#f8fafc",borderRadius:8,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,marginBottom:7}}>🔍 Audit Trail</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {/* Ordered event */}
                        <div style={{display:"flex",gap:8,alignItems:"center",fontSize:11}}>
                          <span style={{width:18,height:18,borderRadius:"50%",background:C.primaryM,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,flexShrink:0,color:C.primary}}>✏</span>
                          <span style={{color:C.muted}}>Ordered by</span>
                          <span style={{fontWeight:700,color:C.dark}}>{o.doctorName?`Dr. ${o.doctorName}`:"Doctor"}</span>
                          <span style={{color:C.muted,marginLeft:4}}>{fmtDT(o.noteDate)}</span>
                        </div>
                        {/* Nurse execution event */}
                        {o.nurseStatus ? (
                          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:11}}>
                            <span style={{width:18,height:18,borderRadius:"50%",background:o.nurseStatus==="done"?C.greenL:C.amberL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,flexShrink:0,color:o.nurseStatus==="done"?C.green:C.amber}}>
                              {o.nurseStatus==="done"?"✓":"⏳"}
                            </span>
                            <span style={{color:C.muted}}>Nurse marked</span>
                            <span style={{fontWeight:700,color:statColor(o.nurseStatus)}}>{o.nurseStatus.toUpperCase()}</span>
                            {o.nurseExecutedAt&&<span style={{color:C.muted}}>at {fmtDT(o.nurseExecutedAt)}</span>}
                            {o.nurseExecutedBy&&<span style={{fontWeight:600,color:C.dark}}>by {o.nurseExecutedBy}</span>}
                          </div>
                        ) : (
                          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:11}}>
                            <span style={{width:18,height:18,borderRadius:"50%",background:C.amberL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,flexShrink:0}}>⏳</span>
                            <span style={{color:C.amber,fontWeight:600}}>Awaiting nurse action</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{textAlign:"right",flexShrink:0,minWidth:72}}>
                    <div style={{fontSize:12,fontWeight:700,color:statColor(o.nurseStatus),marginBottom:3}}>{(o.nurseStatus||"PENDING").toUpperCase()}</div>
                    {o.doctorName&&<div style={{fontSize:10,color:C.muted}}>Dr. {o.doctorName}</div>}
                    {o.noteType&&<div style={{fontSize:10,color:C.muted}}>{o.noteType}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: TREATMENT CHART (MAR) */
function TreatmentChartTab({doctorOrders=[], doctorNotes=[]}) {
  /* ── Collect medication/infusion orders from doctorOrders ── */
  const medOrders = (doctorOrders||[]).map(o=>({
    _id:      o._id,
    drug:     o.orderDetails?.medicineName || o.orderDetails?.drugFluid || o.orderDetails?.name || "—",
    dose:     o.orderDetails?.dose || o.orderDetails?.volume || "—",
    route:    o.orderDetails?.route || "—",
    freq:     o.orderDetails?.frequency || o.orderDetails?.rate || "—",
    status:   o.status||"Active",
    orderedAt:o.orderedAt||o.createdAt,
    doctorName:o.doctorName||o.orderedBy||"",
    admins:   o.administrationRecord||[],
    source:   "order",
  })).filter(o=>o.drug&&o.drug!=="—");

  /* ── Also pull medication orders embedded in doctor notes ── */
  const noteOrders = [];
  (doctorNotes||[]).forEach(note=>{
    const meds = note.noteDetails?.medicationOrders||[];
    const infs = note.noteDetails?.infusionOrders||[];
    [...meds,...infs].forEach((m,mi)=>{
      const drugName=m.drug||m.drugFluid||m.medicineName||"";
      if (!drugName) return;
      noteOrders.push({
        _id:`${note._id}_${mi}`,
        drug:drugName,
        dose:m.dose||m.volume||"—",
        route:m.route||"—",
        freq:m.frequency||m.rate||"—",
        status:m.status||"Active",
        orderedAt:note.createdAt,
        doctorName:note.doctorName||"",
        admins:[],
        source:"note",
      });
    });
  });

  const allOrders = [...medOrders, ...noteOrders];

  /* ── Build unique date list from ordered dates + admin dates ── */
  const dateSet = new Set();
  const today   = new Date().toISOString().slice(0,10);
  dateSet.add(today);
  allOrders.forEach(o=>{
    if (o.orderedAt) dateSet.add(new Date(o.orderedAt).toISOString().slice(0,10));
    o.admins.forEach(r=>{ if(r.givenAt) dateSet.add(new Date(r.givenAt).toISOString().slice(0,10)); });
  });
  const uniqueDates = [...dateSet].sort().reverse();

  const [selDate, setSelDate] = useState(uniqueDates[0]||today);

  if (!allOrders.length) return <Empty icon="💉" msg="No medication / infusion orders found. Orders created from doctor notes will appear here."/>;

  const dateIdx = uniqueDates.indexOf(selDate);

  /* Orders that were active on the selected date */
  const ordersOnDate = allOrders.filter(o=>{
    const start = o.orderedAt ? new Date(o.orderedAt).toISOString().slice(0,10) : today;
    return start<=selDate;
  });

  const getAdmins = o => o.admins.filter(r=>r.givenAt && new Date(r.givenAt).toISOString().slice(0,10)===selDate);

  const dateLabel = d => d===today?"Today":new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Date navigator ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",background:C.primaryL,borderRadius:12,border:`1px solid ${C.primaryM}`}}>
        <button onClick={()=>setSelDate(uniqueDates[dateIdx+1])} disabled={dateIdx>=uniqueDates.length-1}
          style={{padding:"6px 16px",borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",cursor:dateIdx>=uniqueDates.length-1?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:C.primary,opacity:dateIdx>=uniqueDates.length-1?0.35:1}}>
          ◀ Prev
        </button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontWeight:800,fontSize:16,color:C.primaryD}}>
            {selDate===today?"📅 Today — ":""}{new Date(selDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            {dateIdx+1} of {uniqueDates.length} date{uniqueDates.length!==1?"s":""} · {ordersOnDate.length} active medication{ordersOnDate.length!==1?"s":""}
          </div>
        </div>
        <button onClick={()=>setSelDate(uniqueDates[dateIdx-1])} disabled={dateIdx<=0}
          style={{padding:"6px 16px",borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",cursor:dateIdx<=0?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:C.primary,opacity:dateIdx<=0?0.35:1}}>
          Next ▶
        </button>
      </div>

      {/* ── Date chips ── */}
      {uniqueDates.length>1 && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {uniqueDates.slice(0,12).map(d=>{
            const isSel=selDate===d;
            return (
              <button key={d} onClick={()=>setSelDate(d)}
                style={{padding:"3px 12px",borderRadius:16,border:`1.5px solid ${isSel?C.primary:C.border}`,background:isSel?C.primary:"white",color:isSel?"white":C.muted,fontSize:10,fontWeight:600,cursor:"pointer"}}>
                {dateLabel(d)}
              </button>
            );
          })}
        </div>
      )}

      {/* ── MAR table ── */}
      <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,.04)"}}>
        <div style={{padding:"14px 18px",background:C.primaryL,borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontWeight:800,fontSize:14,color:C.primary}}>💉 Medication Administration Record</div>
          <Badge color={C.primary} bg={C.primaryM}>{ordersOnDate.length} medications</Badge>
        </div>

        {ordersOnDate.length===0
          ? <Empty icon="💊" msg="No medications were active on this date"/>
          : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.primaryL}}>
                  {["Drug / Fluid","Dose","Route","Frequency","Ordered By","Start Date",`Administrations (${dateLabel(selDate)})`,"Status"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.primaryM}`,whiteSpace:"nowrap",fontSize:10,textTransform:"uppercase",letterSpacing:".4px"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordersOnDate.map((o,i)=>{
                  const admins = getAdmins(o);
                  const isActive = (o.status||"Active")==="Active"||(o.status||"").toLowerCase()==="active";
                  return (
                    <tr key={o._id||i} style={{background:i%2?"#fafaf9":C.card,borderBottom:`1px solid ${C.border}`,verticalAlign:"top"}}>
                      <td style={{padding:"10px 12px",fontWeight:700,color:C.dark,minWidth:140}}>{o.drug}</td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>{o.dose}</td>
                      <td style={{padding:"10px 12px"}}><Badge color={C.teal} bg={C.tealL}>{o.route}</Badge></td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>{o.freq}</td>
                      <td style={{padding:"10px 12px",color:C.muted,fontSize:11,whiteSpace:"nowrap"}}>{o.doctorName?`Dr. ${o.doctorName}`:"—"}</td>
                      <td style={{padding:"10px 12px",color:C.muted,fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(o.orderedAt)}</td>
                      <td style={{padding:"10px 12px",minWidth:180}}>
                        {admins.length===0 ? (
                          <span style={{fontSize:10,padding:"2px 10px",borderRadius:4,background:isActive?C.amberL:"#f1f5f9",color:isActive?C.amber:C.muted,fontWeight:700}}>
                            {isActive?"⏳ Pending":"—"}
                          </span>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {admins.map((a,ai)=>{
                              const sc = a.status==="given"?C.green:a.status==="missed"?C.red:a.status==="skipped"?C.muted:C.green;
                              const bg = a.status==="given"?C.greenL:a.status==="missed"?C.redL:a.status==="skipped"?"#f1f5f9":C.greenL;
                              const icon = a.status==="given"?"✓":a.status==="missed"?"✗":a.status==="skipped"?"↷":"✓";
                              return (
                                <div key={ai} style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                  <span style={{padding:"1px 8px",borderRadius:4,background:bg,color:sc,fontWeight:700,fontSize:10,display:"flex",alignItems:"center",gap:4}}>
                                    {icon} {(a.status||"given").charAt(0).toUpperCase()+(a.status||"given").slice(1)}
                                  </span>
                                  {a.givenAt && <span style={{fontSize:10,color:C.muted,fontFamily:"'DM Mono',monospace"}}>{new Date(a.givenAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>}
                                  {a.givenBy && <span style={{fontSize:10,color:C.dark,fontWeight:500}}>· {a.givenBy}</span>}
                                  {a.notes   && <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>{a.notes}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td style={{padding:"10px 12px"}}><SBadge status={o.status||"Active"}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Administration audit log ── */}
      {ordersOnDate.some(o=>getAdmins(o).length>0) && (
        <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
          <div style={{padding:"13px 18px",background:C.greenL,borderBottom:`1px solid ${C.border}`,fontWeight:800,fontSize:13,color:C.green}}>
            ✅ Administration Audit Log — {new Date(selDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:0}}>
            {ordersOnDate.flatMap(o=>getAdmins(o).map(a=>({...a,drug:o.drug,dose:o.dose,route:o.route}))).sort((a,b)=>new Date(a.givenAt)-new Date(b.givenAt)).map((a,i)=>{
              const sc=a.status==="given"?C.green:a.status==="missed"?C.red:C.muted;
              return (
                <div key={i} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 18px",borderBottom:`1px solid ${C.border}`,background:i%2?"#fafaf9":C.card}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:C.teal,fontWeight:700,minWidth:50}}>
                    {a.givenAt?new Date(a.givenAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—"}
                  </div>
                  <div style={{width:8,height:8,borderRadius:"50%",background:sc,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <span style={{fontWeight:700,color:C.dark}}>{a.drug}</span>
                    {a.dose&&a.dose!=="—"&&<span style={{fontSize:11,color:C.muted,marginLeft:6}}>{a.dose}</span>}
                    {a.route&&a.route!=="—"&&<span style={{fontSize:10,marginLeft:4,padding:"1px 5px",borderRadius:3,background:C.tealL,color:C.teal,fontWeight:600}}>{a.route}</span>}
                  </div>
                  <span style={{fontSize:11,fontWeight:700,color:sc}}>{(a.status||"given").toUpperCase()}</span>
                  <span style={{fontSize:11,color:C.muted}}>{a.givenBy||"—"}</span>
                  {a.notes&&<span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>{a.notes}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: BILLING */
function BillingTab({billing}) {
  if (!billing) return <Empty icon="💰" msg="No billing record found"/>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{background:`linear-gradient(135deg,${C.primaryD},${C.primary})`,borderRadius:14,padding:"22px 28px",color:"#fff",display:"flex",flexWrap:"wrap",gap:24,justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,opacity:.8,marginBottom:3}}>Bill Number</div>
          <div style={{fontSize:20,fontWeight:800}}>{billing.billNumber||"—"}</div>
        </div>
        {[{l:"Total",v:fmtCur(billing.netAmount)},{l:"Advance",v:fmtCur(billing.advancePaid)},{l:"Balance Due",v:fmtCur(billing.balanceAmount)}].map(s=>(
          <div key={s.l} style={{textAlign:"center"}}>
            <div style={{fontSize:10,opacity:.8,marginBottom:3}}>{s.l}</div>
            <div style={{fontSize:22,fontWeight:800}}>{s.v}</div>
          </div>
        ))}
        <SBadge status={billing.billStatus}/>
      </div>
      <Card title="🧾 Itemised Bill">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:C.primaryL}}>
                {["#","Service","Category","Amount"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.primaryM}`,fontSize:10,textTransform:"uppercase"}}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(billing.billItems||[]).map((item,i)=>(
                <tr key={i} style={{background:i%2?"#fafaf9":C.card,borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"7px 12px",color:C.muted}}>{i+1}</td>
                  <td style={{padding:"7px 12px",fontWeight:600}}>{item.serviceName||"—"}</td>
                  <td style={{padding:"7px 12px"}}><Badge color={C.primary} bg={C.primaryL}>{item.category||"—"}</Badge></td>
                  <td style={{padding:"7px 12px",fontWeight:700,color:C.primary}}>{fmtCur(item.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {(billing.payments||[]).length>0 && (
        <Card title="💳 Payment History">
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:C.primaryL}}>{["Date","Mode","Amount","Reference"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.primaryM}`,fontSize:10,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>
                {billing.payments.map((p,i)=>(
                  <tr key={i} style={{background:i%2?"#fafaf9":C.card,borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:"7px 12px"}}>{fmtDT(p.paidAt||p.date)}</td>
                    <td style={{padding:"7px 12px"}}>{p.mode||p.paymentMode||"—"}</td>
                    <td style={{padding:"7px 12px",fontWeight:700,color:C.green}}>{fmtCur(p.amount)}</td>
                    <td style={{padding:"7px 12px",color:C.muted}}>{p.reference||p.receiptNumber||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: EMERGENCY */
function EmergencyTab({emergency=[]}) {
  if (!emergency.length) return <Empty icon="🚨" msg="No emergency assessment records found for this patient"/>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {emergency.map((em,i)=>(
        <Card key={i} title={`🚨 Emergency Visit — ${fmtDT(em.createdAt||em.arrivalTime)}`} titleColor={C.red}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div>
              <InfoRow label="Emergency No." value={em.emergencyNumber||em._id?.slice(-6)}/>
              <InfoRow label="Chief Complaint" value={em.chiefComplaint}/>
              <InfoRow label="Triage Category" value={em.triageCategory||em.acuity}/>
              <InfoRow label="Arrival Mode"   value={em.arrivalMode}/>
              <InfoRow label="MLC"            value={em.mlcStatus||em.isMLC?"Yes":"No"}/>
            </div>
            <div>
              {em.vitalsOnArrival && (
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8}}>Vitals on Arrival</div>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                    {[
                      {l:"BP",   v:bpStr(em.vitalsOnArrival?.bp)||`${em.vitalsOnArrival?.bpSys||""}/${em.vitalsOnArrival?.bpDia||""}`},
                      {l:"Pulse",v:em.vitalsOnArrival?.pulse},
                      {l:"Temp", v:em.vitalsOnArrival?.temp},
                      {l:"SpO₂",v:em.vitalsOnArrival?.spo2},
                    ].filter(f=>f.v&&f.v!=="/").map(f=>(
                      <div key={f.l} style={{background:C.redL,border:`1px solid ${C.redB}`,borderRadius:8,padding:"8px 12px",textAlign:"center",minWidth:64}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{f.l}</div>
                        <div style={{fontSize:15,fontWeight:700,color:C.red}}>{f.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {em.clinicalNotes && <div style={{marginTop:12,padding:"10px 14px",background:"#fff7ed",borderRadius:8,fontSize:13,color:"#9a3412",lineHeight:1.7}}><b>Notes:</b> {em.clinicalNotes}</div>}
          {em.disposition && <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center"}}><span style={{color:C.muted,fontSize:13}}>Disposition:</span><Badge color={C.blue} bg={C.blueL}>{em.disposition}</Badge></div>}
        </Card>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ MAIN COMPONENT */
function DoctorPatientPanelContent({ selectedAdmission }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState(searchParams.get("uhid")||"");
  const [activeUhid,  setActiveUhid]  = useState(searchParams.get("uhid")||"");
  const [activeTab,   setActiveTab]   = useState("overview");
  // Ref to the loaded-patient region — used by PatientFileExport
  // to print / PDF / generate a QR for the currently viewed file.
  const printAreaRef = useRef(null);

  const [patient,       setPatient]       = useState(null);
  const [admission,     setAdmission]     = useState(null);
  const [doctorNotes,   setDoctorNotes]   = useState([]);
  const [nursingNotes,  setNursingNotes]  = useState([]);
  const [billing,       setBilling]       = useState(null);
  const [opdVisits,     setOpdVisits]     = useState([]);
  const [vitalSheet,    setVitalSheet]    = useState([]);
  const [emergency,     setEmergency]     = useState([]);
  const [doctorOrders,  setDoctorOrders]  = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [loaded,        setLoaded]        = useState(false);

  /* ── Bed Transfer state ── */
  const [pendingTransfer,   setPendingTransfer]   = useState(null);
  const [showShiftModal,    setShowShiftModal]    = useState(false);
  const [availableBeds,     setAvailableBeds]     = useState([]);
  const [bedsLoading,       setBedsLoading]       = useState(false);
  const [shiftForm,         setShiftForm]         = useState({ toBedId:"", reason:"", shiftingNotes:"" });
  const [shiftSaving,       setShiftSaving]       = useState(false);

  const loadAll = useCallback(async (uhid) => {
    if (!uhid?.trim()) return;
    const u = uhid.trim().toUpperCase();
    setLoading(true); setError(""); setLoaded(false);
    setPatient(null); setAdmission(null); setDoctorNotes([]); setNursingNotes([]);
    setBilling(null); setOpdVisits([]); setVitalSheet([]); setEmergency([]); setDoctorOrders([]);
    setActiveTab("overview");
    try {
      // Core patient + admission
      const [admRes, patRes] = await Promise.all([
        axios.get(`${BASE}/admissions?uhid=${u}`).catch(()=>({data:[]})),
        axios.get(`${BASE}/patients?UHID=${u}`).catch(()=>({data:[]})),
      ]);
      const admList = Array.isArray(admRes.data?.admissions)?admRes.data.admissions:Array.isArray(admRes.data)?admRes.data:[];
      const patList = Array.isArray(patRes.data?.data)?patRes.data.data:Array.isArray(patRes.data)?patRes.data:[];
      const adm = admList.find(a=>["active","admitted"].includes((a.status||"").toLowerCase()))||admList[0]||null;
      const pat = patList.find(p=>(p.UHID||p.uhid||"").toUpperCase()===u)||patList[0]||null;
      setAdmission(adm); setPatient(pat);

      if (!adm && !pat) { setError(`No patient found for UHID: ${u}`); return; }

      const ipdNo = adm?.admissionNumber;
      const admId = adm?._id;
      const patId = pat?._id||adm?.patientId;

      // Parallel data fetches
      await Promise.all([
        // OPD
        axios.get(`${BASE}/opd?UHID=${u}&limit=10`).then(r=>{
          const l = Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setOpdVisits(l);
        }).catch(()=>{}),

        // Doctor notes
        ipdNo ? axios.get(`${BASE}/doctor-notes/ipd/${ipdNo}`).then(r=>{
          const l = r.data?.data||r.data?.notes||(Array.isArray(r.data)?r.data:[]);
          setDoctorNotes(Array.isArray(l)?l.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)):[]);
        }).catch(()=>{}) : Promise.resolve(),

        // Nursing notes
        ipdNo ? axios.get(`${BASE}/nursing-notes/ipd/${ipdNo}`).catch(()=>
          axios.get(`${BASE}/nurse-notes/ipd/${ipdNo}`).catch(()=>({data:[]}))
        ).then(r=>{
          const l = r.data?.data||r.data?.notes||(Array.isArray(r.data)?r.data:[]);
          setNursingNotes(Array.isArray(l)?l.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)):[]);
        }).catch(()=>{}) : Promise.resolve(),

        // Billing
        axios.get(`${BASE}/billing/uhid/${u}`).then(r=>{
          const bills = Array.isArray(r.data?.data?.bills)?r.data.data.bills:Array.isArray(r.data?.bills)?r.data.bills:Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setBilling(bills[0]||null);
        }).catch(()=>{}),

        // Vital sheet
        axios.get(`${BASE}/vitalsheet`, {params:{uhid:u}}).then(r=>{
          const d = Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setVitalSheet(d);
        }).catch(()=>{}),

        // Emergency
        patId ? axios.get(`${BASE}/emergency/patient/${patId}`).catch(()=>
          axios.get(`${BASE}/emergency?UHID=${u}`).catch(()=>({data:[]}))
        ).then(r=>{
          const l = Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setEmergency(l);
        }).catch(()=>{}) : Promise.resolve(),

        // Doctor orders
        axios.get(`${BASE}/doctor-orders?UHID=${u}`).then(r=>{
          const l = Array.isArray(r.data)?r.data:(r.data?.data||[]);
          setDoctorOrders(l);
        }).catch(()=>{}),
      ]);

      setLoaded(true);
    } catch(e) {
      setError("Failed to load patient data. Check the UHID and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(()=>{
    const u = searchParams.get("uhid") || localStorage.getItem("doctorPanel_lastUhid");
    if (u) { setSearchInput(u); setActiveUhid(u); loadAll(u); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = () => {
    const u = searchInput.trim().toUpperCase();
    if (!u) return;
    setActiveUhid(u);
    localStorage.setItem("doctorPanel_lastUhid", u);
    loadAll(u);
  };

  /* ── Auto-load when patient selected from sidebar ── */
  useEffect(() => {
    if (!selectedAdmission) return;
    const u = (selectedAdmission.UHID || selectedAdmission.uhid || "").trim().toUpperCase();
    if (!u) return;
    setSearchInput(u);
    setActiveUhid(u);
    localStorage.setItem("doctorPanel_lastUhid", u);
    loadAll(u);
  }, [selectedAdmission?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Fetch pending bed transfer for this patient ── */
  const fetchPendingTransfer = useCallback(async (admId) => {
    if (!admId) return;
    try {
      const r = await axios.get(`${BASE}/bed-transfers?admissionId=${admId}&status=PendingHandover`);
      const list = Array.isArray(r.data?.data) ? r.data.data : [];
      setPendingTransfer(list[0] || null);
    } catch { setPendingTransfer(null); }
  }, []);

  /* Fetch pending transfer whenever admission changes */
  useEffect(() => {
    if (admission?._id) fetchPendingTransfer(admission._id);
  }, [admission?._id, fetchPendingTransfer]);

  /* ── Open Shift Bed modal — fetch available beds ── */
  const openShiftModal = async () => {
    setShiftForm({ toBedId:"", reason:"", shiftingNotes:"" });
    setShowShiftModal(true);
    setBedsLoading(true);
    try {
      const r = await axios.get(`${BASE}/bedss?status=Available`);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      setAvailableBeds(list.filter(b => b._id !== admission?.bedId));
    } catch { setAvailableBeds([]); }
    finally { setBedsLoading(false); }
  };

  /* ── Submit shift request ── */
  const submitShift = async () => {
    if (!shiftForm.toBedId)               { alert("Please select a target bed."); return; }
    if (!shiftForm.shiftingNotes?.trim()) { alert("Shifting notes are required."); return; }
    // Fix: compare as strings to handle ObjectId vs string mismatch
    const targetBed = availableBeds.find(b => String(b._id) === String(shiftForm.toBedId));
    if (!targetBed) { alert("Selected bed not found. Please close and reopen the modal."); return; }
    setShiftSaving(true);
    try {
      await axios.post(`${BASE}/bed-transfers`, {
        UHID:           activeUhid,
        admissionId:    String(admission._id),
        patientName:    admission.patientName || patient?.fullName || "",
        fromBedId:      admission.bedId       || null,
        fromBedNumber:  admission.bedNumber   || admission.bed?.bedNumber || "",
        fromWardName:   admission.wardName    || admission.ward || "",
        fromRoomNumber: admission.roomNumber  || "",
        toBedId:        String(targetBed._id),
        toBedNumber:    targetBed.bedNumber   || "",
        toWardName:     targetBed.wardName    || targetBed.ward?.name || "",
        toRoomNumber:   targetBed.roomNumber  || "",
        reason:         shiftForm.reason      || "",
        shiftingNotes:  shiftForm.shiftingNotes.trim(),
        requestedBy:    "Doctor",
      });
      setShowShiftModal(false);
      fetchPendingTransfer(admission._id);
      alert("✅ Bed transfer initiated. Nurse must write handover notes to complete.");
    } catch (e) {
      alert("Error: " + (e.response?.data?.message || e.message));
    } finally { setShiftSaving(false); }
  };

  /* ── Cancel pending transfer ── */
  const cancelTransfer = async (transferId) => {
    if (!window.confirm("Cancel this bed transfer? The reserved bed will be released.")) return;
    try {
      await axios.put(`${BASE}/bed-transfers/${transferId}/cancel`);
      setPendingTransfer(null);
      alert("Transfer cancelled. Bed has been released.");
    } catch (e) {
      alert("Error: " + (e.response?.data?.message || e.message));
    }
  };

  // ── Tab dispatch — keeps the per-tab components untouched, just routes by id.
  const renderTab = (id) => {
    switch (id) {
      case "overview":   return <OverviewTab patient={patient} admission={admission} opdVisits={opdVisits} billing={billing} doctorNotes={doctorNotes} nursingNotes={nursingNotes} onShiftBed={openShiftModal} pendingTransfer={pendingTransfer} onCancelTransfer={cancelTransfer}/>;
      case "initial":    return <InitialAssessmentTab doctorNotes={doctorNotes} nursingNotes={nursingNotes} admission={admission}/>;
      case "mlc":        return <MLCOrDoctorNotesTab patient={patient} doctorNotes={doctorNotes}/>;
      case "nursing":    return <NursingNotesExpandedTab nursingNotes={nursingNotes}/>;
      case "vitals":     return <VitalChartTab nursingNotes={nursingNotes} vitalSheet={vitalSheet}/>;
      case "io":         return <IntakeOutputChartTab nursingNotes={nursingNotes}/>;
      case "blood":      return <BloodTransfusionRecordsTab nursingNotes={nursingNotes}/>;
      case "rbs":        return <RBSMonitoringTab nursingNotes={nursingNotes} doctorOrders={doctorOrders}/>;
      case "handover":   return <HandoverNotesTab patient={patient} admission={admission} doctorNotes={doctorNotes} nursingNotes={nursingNotes}/>;
      case "meds":       return <MedicationsTab doctorNotes={doctorNotes} doctorOrders={doctorOrders}/>;
      case "treatment":  return <TreatmentChartTab doctorOrders={doctorOrders} doctorNotes={doctorNotes}/>;
      case "orders":     return <OrdersTab doctorNotes={doctorNotes}/>;
      case "billing":    return <BillingTab billing={billing}/>;
      case "emergency":  return <EmergencyTab emergency={emergency}/>;
      default:           return null;
    }
  };

  // ── Tab counters surfaced as pf-tabs__count badges
  const tabCounts = {
    mlc:       doctorNotes.length,
    nursing:   nursingNotes.length,
    emergency: emergency.length,
  };

  // ── Doctor's "Shift Bed" extra action in the strip
  const stripActions = admission && !pendingTransfer ? (
    <button className="pf-action pf-action--ghost" onClick={openShiftModal} title="Initiate a bed transfer (nurse completes via handover)">
      🔄 Shift Bed
    </button>
  ) : null;

  // ── Assessment gate banner (doctor's initial-assessment gate)
  const gateBanners = admission ? (
    !admission.initialAssessment?.doctorCompleted ? (
      <div className="pf-gate pf-gate--danger">
        <div className="pf-gate__icon">🔒</div>
        <div className="pf-gate__body">
          <div className="pf-gate__title">
            <span className="pf-gate__tag">Mandatory</span>
            Initial Assessment not recorded — NABH COP.2
          </div>
          <div className="pf-gate__msg">
            Doctor's Initial Assessment must be completed before writing daily notes, ICU notes,
            or any other documentation for this patient.
          </div>
          <button className="pf-gate__btn" onClick={() => navigate(`/doctor-notes?uhid=${activeUhid}`)}>
            Write Now
          </button>
        </div>
      </div>
    ) : (
      <div className="pf-gate pf-gate--ok">
        <div className="pf-gate__body">
          <div className="pf-gate__title">✅ Initial Assessment completed — full documentation unlocked</div>
        </div>
      </div>
    )
  ) : null;

  // ── Shift Bed modal (kept as a child of the shell so it overlays everything)
  const shiftBedModal = showShiftModal && (
    <div className="pf-modal-backdrop" onClick={() => !shiftSaving && setShowShiftModal(false)}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pf-modal__head">
          <div>
            <div className="pf-modal__title">🔄 Shift Patient Bed</div>
            <div className="pf-modal__sub">Doctor adds shifting notes · Nurse will write handover notes to complete</div>
          </div>
          <button className="pf-modal__close" onClick={() => setShowShiftModal(false)} aria-label="close">✕</button>
        </div>

        <div className="pf-modal__body">
          {/* Current bed */}
          <div className="pf-info-box">
            📍 Current Bed: <strong>{admission?.bedNumber || "Not assigned"}</strong>
            {(admission?.wardName || admission?.ward) && <span> — {admission.wardName || admission.ward}</span>}
          </div>

          {/* Select new bed */}
          <div>
            <label className="pf-flabel pf-flabel--required">Select New Bed *</label>
            {bedsLoading ? (
              <div className="pf-fhint">Loading available beds…</div>
            ) : availableBeds.length === 0 ? (
              <div className="pf-fhint pf-fhint--error">⚠ No available beds found. All beds are occupied or reserved.</div>
            ) : (
              <select className="pf-select" value={shiftForm.toBedId} onChange={(e) => setShiftForm((f) => ({ ...f, toBedId: e.target.value }))}>
                <option value="">— Select available bed —</option>
                {availableBeds.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.bedNumber} — {b.wardName || b.ward?.name || ""} {b.roomNumber ? `(Room ${b.roomNumber})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="pf-flabel">Reason for Transfer</label>
            <select className="pf-select" value={shiftForm.reason} onChange={(e) => setShiftForm((f) => ({ ...f, reason: e.target.value }))}>
              <option value="">— Select reason —</option>
              {["Clinical need","ICU transfer","HDU transfer","Ward upgrade","Ward downgrade","Patient request","Isolation required","Bed availability","Discharge planning","Other"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Shifting notes — MANDATORY */}
          <div>
            <label className="pf-flabel pf-flabel--required">Shifting Notes * (Required)</label>
            <textarea
              className={`pf-textarea ${shiftForm.shiftingNotes ? "" : "pf-textarea--invalid"}`}
              value={shiftForm.shiftingNotes}
              onChange={(e) => setShiftForm((f) => ({ ...f, shiftingNotes: e.target.value }))}
              placeholder="Document the clinical reason for the bed shift, patient's current condition, any special requirements for the new bed/ward, equipment being transferred, etc."
            />
            {!shiftForm.shiftingNotes?.trim() && (
              <div className="pf-fhint pf-fhint--error">⚠ Shifting notes are mandatory. Nurse cannot complete handover without this information.</div>
            )}
          </div>

          {/* Workflow hint */}
          <div className="pf-info-box">
            <strong>Workflow:</strong> After you submit, the selected bed will be reserved.
            Nurse must then write <strong>Handover Notes</strong> to complete the transfer and actually move the patient's record to the new bed.
          </div>
        </div>

        <div className="pf-modal__foot">
          <button className="pf-action pf-action--quiet" onClick={() => setShowShiftModal(false)} disabled={shiftSaving}>
            Cancel
          </button>
          <button
            className="pf-action pf-action--accent"
            onClick={submitShift}
            disabled={shiftSaving || !shiftForm.toBedId || !shiftForm.shiftingNotes?.trim()}
          >
            {shiftSaving ? "Initiating…" : "🔄 Initiate Transfer"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <PatientPanelShell
      role="doctor"
      title="Doctor Patient Panel"
      subtitle="Full patient file — clinical, vitals & audit"
      icon="🩺"
      searchValue={searchInput}
      onSearchChange={setSearchInput}
      onSearchSubmit={handleLoad}
      searchPlaceholder="Enter UHID (e.g. UH-00001)"
      loading={loading}
      error={error}
      loaded={loaded}
      patient={patient}
      admission={admission}
      printRef={printAreaRef}
      stripActions={stripActions}
      gateBanners={gateBanners}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabCounts={tabCounts}
      renderTab={renderTab}
      modals={shiftBedModal}
      emptyIcon="🩺"
      emptyTitle="Enter a Patient UHID"
      emptyMsg="Type a UHID in the search bar and click Load Patient to view the complete patient file — clinical notes, vitals, billing, and more."
    />
  );
}

/* ── Layout wrapper with admitted patient sidebar ── */
export default function DoctorPatientPanel() {
  const [sel, setSel] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSel} selectedId={sel?._id} pageType="doctor-panel">
      <DoctorPatientPanelContent selectedAdmission={sel} />
    </ClinicalLayout>
  );
}
