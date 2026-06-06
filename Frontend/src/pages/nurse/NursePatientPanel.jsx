/**
 * NursePatientPanel.jsx  —  Full patient file for nursing staff.
 * Teal/green theme (matches NursingNotes page). Tabs: Overview | Vital Trends | Nursing Notes |
 *   Doctor Orders | Medications | Billing | Emergency
 */
import React, { useState, useEffect, useCallback, useRef, lazy } from "react";
// Roadmap E17 + A2 — Med Reconciliation tab is lazy-loaded.
const MedReconciliationTab = lazy(() => import("../../Components/clinical/tabs/MedReconciliationTab"));
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import PatientFileExport from "../../Components/clinical/PatientFileExport";
// R7gx-UI — Mirror Doctor panel: nurse panel surfaces the canonical
// Treatment Chart MAR view. Shared TreatmentChart component handles
// medication + infusion administration; nurseMode=true gives full
// write access (Given / Hold / Not-Available / Partial / Refused).
import TreatmentChart from "../../Components/clinical/TreatmentChart";
// Phase 2 shell — pf-* design system shared with DoctorPatientPanel.
import PatientPanelShell from "../../Components/clinical/PatientPanelShell";
// Phase 3 — log every nurse-side UI event into the patient activity feed.
import { useBoundLogger } from "../../utils/activityLogger";
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

import { API_BASE_URL as BASE } from "../../config/api";
// R7az-D5-CRIT-4 / D5-HIGH-1 — centralised vital reference bands so
// every surface in the HIS classifies vitals the same way (and respects
// the patient's age band). Local RANGES below is kept as a back-compat
// fallback / alias map for legacy callers using "sbp"/"dbp" keys.
import { tier as vitalTier } from "../../utils/vitalRanges";
// R7az-D4-CRIT-1 — Decimal128 unwrap for the billing rendering paths.
import { toMoney } from "../../utils/money";

/* ── Design tokens — teal/green theme matching NursingNotes ── */
const C = {
  primary:"#0f766e", primaryD:"#134e4a", primaryL:"#f0fdfa", primaryM:"#ccfbf1",
  rose50:"#f0fdfa",  rose100:"#ccfbf1",  rose200:"#5eead4",   // kept for prop names; values are teal
  green:"#16a34a",   greenL:"#dcfce7",   greenB:"#86efac",
  red:"#dc2626",     redL:"#fef2f2",     redB:"#fca5a5",
  amber:"#d97706",   amberL:"#fffbeb",   amberB:"#fde68a",
  blue:"#1d4ed8",    blueL:"#eff6ff",    blueB:"#93c5fd",
  teal:"#0d9488",    tealL:"#f0fdfa",    tealB:"#99f6e4",
  purple:"#7c3aed",  purpleL:"#f5f3ff",  purpleB:"#c4b5fd",
  muted:"#64748b",   dark:"#0f172a",     text:"#1e293b",
  card:"#ffffff",    bg:"#f8fafc",       border:"#e2e8f0",
};

// R7gm — Mirrors DoctorPatientPanel.TABS exactly so the patient panel pill
// strip is consistent across both roles. Role-aware enforcement still happens
// inside each module (e.g. discharge-summary write is gated by
// ipd.discharge-summary on the backend; medical-certificates by
// patient.write-clinical). Hiding tabs would prevent nurses from
// VIEWING / printing — that is not the desired behaviour.
const TABS = [
  { id:"overview",    label:"📋 Overview"             },
  { id:"initial",     label:"🩺 Initial Assessment"   },
  { id:"consent",     label:"📜 Consent Forms"        },
  { id:"mlc",         label:"⚖ MLC / Doctor Notes"   },
  { id:"nursing",     label:"📝 Nursing Notes"        },
  { id:"vitals",      label:"📈 Vital Chart"          },
  { id:"io",          label:"💧 Intake / Output"      },
  { id:"blood",       label:"🩸 Blood Transfusion"    },
  { id:"rbs",         label:"🩸 RBS Monitoring"       },
  { id:"handover",    label:"🔄 Handover Notes"       },
  { id:"icubundles",  label:"🛡 ICU Bundles"         },
  // R7gx-UI — Treatment Chart pill (mirrors Doctor panel position).
  // Single source of truth for medication administration; nurses chart
  // every dose here. Pill position kept identical to Doctor panel so
  // muscle memory transfers between roles.
  { id:"treatment",   label:"💉 Treatment Chart"      },
  { id:"orders",      label:"📋 Doctor Orders"        },
  // R7gx-UI — Medications pill removed (mirror of Doctor panel cleanup).
  { id:"medrecon",    label:"⚖ Med Reconciliation"   },
  { id:"discharge",   label:"🚪 Discharge Summary"    },
  { id:"medcerts",    label:"📑 Medical Certificates" },
  { id:"billing",     label:"💰 Billing"              },
  { id:"emergency",   label:"🚨 Emergency"            },
  { id:"patientfile", label:"📁 Complete File"        },
];

/* ── Helpers ── */
const fmtDT   = d => { try { return d ? new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—"; } catch { return "—"; }};
const fmtDate = d => { try { return d ? new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—"; } catch { return "—"; }};
// R7az-D4-CRIT-1: route through toMoney() so Decimal128 wire shapes don't
// render as "₹NaN" (parity with DoctorPatientPanel).
const fmtCur  = n => `₹${toMoney(n).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
const bpStr   = bp => bp && typeof bp==="object" ? `${bp.systolic||"—"}/${bp.diastolic||"—"}` : (bp||"—");

/* ── Shared UI ── */
function Spin() {
  return (
    <div style={{display:"flex",justifyContent:"center",padding:48}}>
      <div style={{width:34,height:34,borderRadius:"50%",border:`3px solid ${C.rose100}`,borderTopColor:C.primary,animation:"spin .8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
function Empty({icon="📭",msg}) {
  return <div style={{textAlign:"center",padding:"40px 24px",color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>{icon}</div><div style={{fontSize:13}}>{msg}</div></div>;
}
function Badge({children,color=C.primary,bg=C.primaryL}) {
  return <span style={{display:"inline-block",padding:"2px 10px",borderRadius:999,fontSize:11,fontWeight:700,color,background:bg}}>{children}</span>;
}
function SBadge({status}) {
  const s=(status||"").toLowerCase();
  if (s==="active"||s==="admitted") return <Badge color={C.green}  bg={C.greenL}>Active</Badge>;
  if (s==="discharged")             return <Badge color={C.muted}  bg="#f1f5f9">Discharged</Badge>;
  if (s==="signed")                 return <Badge color={C.green}  bg={C.greenL}>✓ Signed</Badge>;
  if (s==="submitted")              return <Badge color={C.blue}   bg={C.blueL}>Submitted</Badge>;
  if (s==="draft")                  return <Badge color={C.amber}  bg={C.amberL}>Draft</Badge>;
  if (s==="done")                   return <Badge color={C.green}  bg={C.greenL}>Done</Badge>;
  if (s==="pending")                return <Badge color={C.amber}  bg={C.amberL}>Pending</Badge>;
  if (s==="skipped")                return <Badge color={C.muted}  bg="#f1f5f9">Skipped</Badge>;
  return <Badge color={C.muted} bg="#f1f5f9">{status||"—"}</Badge>;
}
function Card({title,titleBg=C.primaryL,titleColor=C.primaryD,children,style={}}) {
  return (
    <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:"hidden",...style}}>
      {title && <div style={{padding:"11px 18px",borderBottom:`1px solid ${C.border}`,background:titleBg,fontWeight:700,fontSize:13,color:titleColor}}>{title}</div>}
      <div style={{padding:18}}>{children}</div>
    </div>
  );
}
function InfoRow({label,value}) {
  return (
    <div style={{display:"flex",gap:8,marginBottom:8,fontSize:13}}>
      <span style={{color:C.muted,minWidth:130,flexShrink:0}}>{label}</span>
      <span style={{color:C.dark,fontWeight:500,wordBreak:"break-word"}}>{value||"—"}</span>
    </div>
  );
}
function VCard({label,value,color=C.green,unit=""}) {
  return (
    <div style={{background:C.primaryL,border:`1.5px solid ${C.rose200}`,borderRadius:10,padding:"12px 14px",textAlign:"center",minWidth:80}}>
      <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:5}}>{label}</div>
      <div style={{fontSize:18,fontWeight:800,color}}>{value||"—"}{value&&unit?<span style={{fontSize:11,fontWeight:500}}>{unit}</span>:null}</div>
    </div>
  );
}

/* ── SVG Sparkline ── */
function Sparkline({data,color=C.primary,width=120,height=40}) {
  if (!data||data.length<2) return <span style={{fontSize:11,color:C.muted}}>—</span>;
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>{
    const x=(i/(data.length-1))*width;
    const y=height-((v-min)/range)*(height-8)-4;
    return `${x},${y}`;
  }).join(" ");
  const last=pts.split(" ").at(-1).split(",").map(Number);
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={last[0]} cy={last[1]} r={3.5} fill={color}/>
    </svg>
  );
}

/* ── Abnormal checkers — R7az-D5-CRIT-4 / D5-HIGH-1
   Canonical keys mirror the centralised vitalRanges.js module so callers
   don't have to translate (`bp_sys` not `sbp`). The legacy `sbp`/`dbp`
   keys are kept as ALIASES so existing callers (line 396 etc) still work
   while we migrate. The shared three-tier `tier()` helper from
   utils/vitalRanges.js drives the danger/warn/ok colouring everywhere
   else on this page — see vitalState() below. */
const RANGES = {
  bp_sys: { lo: 90, hi: 140 }, bp_dia: { lo: 60, hi: 90 },
  // Aliases retained for back-compat — both `isAbn("sbp", v)` and
  // `isAbn("bp_sys", v)` now return the same result. Remove once all
  // call-sites migrate to the canonical key.
  sbp: { lo: 90, hi: 140 }, dbp: { lo: 60, hi: 90 },
  pulse: { lo: 60, hi: 100 }, temp: { lo: 97, hi: 99.5 },
  spo2: { lo: 95, hi: 100 }, rr: { lo: 12, hi: 20 }, bsl: { lo: 70, hi: 140 },
};
const isAbn = (key,val) => { const n=Number(val); if(isNaN(n)||!val) return false; const r=RANGES[key]; return r?(n<r.lo||n>r.hi):false; };

/* ══════════════════════════════════════════════════ TAB: OVERVIEW */
function OverviewTab({patient,admission,nursingNotes=[],billing,doctorNotes=[]}) {
  // Latest vitals from nursing notes
  const latestVN = nursingNotes.find(n=>n.vitals && (n.vitals.bp||n.vitals.pulse||n.vitals.temp));
  const lv = latestVN?.vitals||{};
  const todayOrders = doctorNotes.flatMap(n=>n.orders||[]).filter(o=>!o.nurseStatus||o.nurseStatus==="pending");
  const hasAllergy = patient?.knownAllergies && !["NKDA","None","—",""].includes(patient.knownAllergies);

  // R7az-D5-CRIT-4 / D5-HIGH-1 — delegate to the centralised vitalRanges
  // tier() so the three-tier classifier is identical across NursePanel,
  // DoctorPanel, IntegratedVitalsPanel, etc. Pre-fix this local copy
  // disagreed with RANGES below on the pulse warn band (RANGES warned at
  // <60/>100, vitalState warned at <60/>100 too, but the danger threshold
  // was different from IntegratedVitalsPanel's hardcoded adult band).
  // Now: same band for everyone, and the band auto-shifts for paeds /
  // neonates based on patient.dob.
  const vitalState = (k, v) => {
    const t = vitalTier(patient, k, v);
    return t === "unknown" ? "neutral" : t === "danger" ? "danger" : t === "warn" ? "warn" : "ok";
  };
  const bpSys = lv.bp?.systolic;

  return (
    <div className="pf-tint--nurse" style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Allergy alert */}
      {hasAllergy && (
        <div className="pf-alert pf-alert--danger">
          <span className="pf-alert__icon">⚠️</span>
          <div className="pf-alert__body">
            <div className="pf-alert__title">Known Allergies</div>
            <div className="pf-alert__msg">{patient.knownAllergies}</div>
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="pf-stats-grid">
        {[
          {label:"Nursing Notes",  val: nursingNotes.length,                        icon:"📝", tint:"primary"},
          {label:"Pending Orders", val: todayOrders.length,                         icon:"⏳", tint: todayOrders.length > 0 ? "warn" : "neutral"},
          {label:"Doctor Notes",   val: doctorNotes.length,                         icon:"🩺", tint:"info"},
          {label:"Balance Due",    val: billing ? fmtCur(billing.balanceAmount) : "—", icon:"💰", tint: billing?.balanceAmount > 0 ? "warn" : "ok"},
        ].map(s => (
          <div key={s.label} className={`pf-stat-card pf-stat-card--${s.tint}`}>
            <div className="pf-stat-card__icon">{s.icon}</div>
            <div className="pf-stat-card__body">
              <div className="pf-stat-card__label">{s.label}</div>
              <div className="pf-stat-card__val">{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Demographics + Admission */}
      <div className="pf-overview-grid">
        <div className="pf-info-card">
          <div className="pf-info-card__head">
            <span className="pf-info-card__icon">👤</span>
            <span className="pf-info-card__title">Patient Demographics</span>
          </div>
          <div className="pf-info-card__body">
            {[
              ["Full Name",    `${patient?.title || ""} ${patient?.fullName || patient?.patientName || ""}`.trim() || "—"],
              ["UHID",         patient?.UHID || patient?.uhid],
              ["Age / Gender", `${patient?.age || "—"} yrs / ${patient?.gender || "—"}`],
              ["Blood Group",  patient?.bloodGroup],
              ["Contact",      patient?.contactNumber || patient?.phone],
              ["Payment Type", patient?.paymentType],
            ].map(([l, v]) => (
              <div key={l} className="pf-info-card__row">
                <span className="pf-info-card__row-label">{l}</span>
                <span className="pf-info-card__row-value">{v || "—"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pf-info-card">
          <div className="pf-info-card__head">
            <span className="pf-info-card__icon">🏥</span>
            <span className="pf-info-card__title">Admission</span>
          </div>
          <div className="pf-info-card__body">
            {[
              ["Admission No.", admission?.admissionNumber],
              ["Type",          admission?.admissionType],
              ["Doctor",        admission?.attendingDoctor],
              ["Department",    admission?.department],
              ["Bed / Ward",    [admission?.bedNumber, admission?.wardName || admission?.ward].filter(Boolean).join(" — ")],
              ["Admitted",      fmtDate(admission?.admissionDate)],
            ].map(([l, v]) => (
              <div key={l} className="pf-info-card__row">
                <span className="pf-info-card__row-label">{l}</span>
                <span className="pf-info-card__row-value">{v || "—"}</span>
              </div>
            ))}
            <div className="pf-info-card__row">
              <span className="pf-info-card__row-label">Status</span>
              <span className="pf-info-card__row-value"><SBadge status={admission?.status}/></span>
            </div>
          </div>
        </div>
      </div>

      {/* Latest vitals */}
      {latestVN && (
        <div className="pf-vitals-block">
          <div className="pf-vitals-block__head">
            <span style={{fontSize:18}}>💓</span>
            <span className="pf-vitals-block__title">Latest Vitals</span>
            <span className="pf-vitals-block__time">{fmtDT(latestVN.createdAt)}</span>
          </div>
          <div className="pf-vitals-block__body">
            {[
              {label:"BP",    value: bpStr(lv.bp),                    unit:" mmHg",  state: vitalState("bp_sys", bpSys)},
              {label:"Pulse", value: lv.pulse,                        unit:" bpm",   state: vitalState("pulse", lv.pulse)},
              {label:"Temp",  value: lv.temp,                         unit:" °F",    state: vitalState("temp", lv.temp)},
              {label:"SpO₂",  value: lv.spo2,                         unit:" %",     state: vitalState("spo2", lv.spo2)},
              {label:"RR",    value: lv.rr,                           unit:" /min",  state: vitalState("rr", lv.rr)},
              {label:"BSL",   value: lv.bsl,                          unit:" mg/dL", state: "warn"},
              {label:"GCS",   value: lv.gcs ? String(lv.gcs) : null,  unit:"",       state: "neutral"},
            ].filter(t => t.value != null && t.value !== "" && t.value !== "—" && t.value !== "—/—").map(t => (
              <div key={t.label} className={`pf-vital-tile pf-vital-tile--${t.state}`}>
                <div className="pf-vital-tile__label">{t.label}</div>
                <div className="pf-vital-tile__val">{t.value}<span className="pf-vital-tile__unit">{t.unit}</span></div>
              </div>
            ))}
          </div>
          {latestVN.nurseName && (
            <div className="pf-vitals-block__foot">Recorded by <strong>{latestVN.nurseName}</strong></div>
          )}
        </div>
      )}

      {/* Pending orders quick view */}
      {todayOrders.length > 0 && (
        <div className="pf-info-card">
          <div className="pf-info-card__head" style={{background:"linear-gradient(180deg,#fef3c7 0%,transparent 100%)"}}>
            <span className="pf-info-card__icon" style={{background:"#d97706"}}>⏳</span>
            <span className="pf-info-card__title" style={{color:"#92400e"}}>Pending Doctor Orders</span>
            <span className="pf-badge pf-badge--warn" style={{marginLeft:"auto"}}>{todayOrders.length}</span>
          </div>
          <div className="pf-info-card__body">
            <div className="pf-order-list">
              {todayOrders.slice(0, 5).map((o, i) => (
                <div key={i} className="pf-order-row">
                  <span className="pf-order-row__icon">
                    {o.type === "medication" ? "💊" : o.type === "iv_fluid" ? "💧" : "📋"}
                  </span>
                  <span className="pf-order-row__text">{o.instruction || "—"}</span>
                  {o.route && <span className="pf-badge pf-badge--info">{o.route}</span>}
                  {o.frequency && <span className="pf-badge pf-badge--neutral">{o.frequency}</span>}
                </div>
              ))}
              {todayOrders.length > 5 && (
                <div style={{fontSize: 12, color: C.muted, textAlign: "center", padding: 6}}>
                  +{todayOrders.length - 5} more orders
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════ TAB: VITAL TRENDS */
function VitalTrendsTab({vitalSheet=[]}) {
  const allRows=[];
  vitalSheet.forEach(sheet=>{
    (sheet.tableData||[]).forEach(row=>{
      allRows.push({date:sheet.date,time:row.time,values:row.values||{},nurse:row.nurse});
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

  if (!allRows.length) return (
    <Empty icon="📈" msg="No vital sheet records found. Record vitals via Nursing Notes → Vitals tab."/>
  );

  const SPARKLINES = [
    {label:"Systolic BP",  data:sbps,   color:C.red,     unit:"mmHg", abnKey:"sbp"},
    {label:"Diastolic BP", data:dbps,   color:"#0d9488", unit:"mmHg", abnKey:"dbp"},
    {label:"Pulse",        data:pulse,  color:C.purple,  unit:"/min",  abnKey:"pulse"},
    {label:"Temperature",  data:temp,   color:C.amber,   unit:"°F",    abnKey:"temp"},
    {label:"SpO₂",        data:spo2,   color:C.teal,    unit:"%",     abnKey:"spo2"},
    {label:"Resp Rate",    data:rr,     color:C.blue,    unit:"/min",  abnKey:"rr"},
    {label:"BSL",         data:bsl,    color:C.green,   unit:"mg/dL", abnKey:"bsl"},
    {label:"Pain Score",  data:pain,   color:C.primary, unit:"/10",   abnKey:null},
  ].filter(s=>s.data.length>0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Sparkline grid */}
      <Card title="📈 Vital Trend Charts" titleBg={C.primaryL} titleColor={C.primaryD}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:16}}>
          {SPARKLINES.map(s=>{
            const latest=s.data.at(-1);
            const abn=s.abnKey?isAbn(s.abnKey,latest):false;
            return (
              <div key={s.label} style={{background:abn?C.redL:C.bg,border:`1.5px solid ${abn?C.red:C.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:abn?C.red:C.muted,letterSpacing:".5px",marginBottom:8}}>{s.label}</div>
                <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
                  <Sparkline data={s.data} color={abn?C.red:s.color} width={100} height={42}/>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:22,fontWeight:800,color:abn?C.red:s.color}}>{latest}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s.unit}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s.data.length} readings</div>
                  </div>
                </div>
                {s.data.length>1 && (
                  <div style={{fontSize:10,color:C.muted,marginTop:6}}>Min: {Math.min(...s.data)} · Max: {Math.max(...s.data)}</div>
                )}
                {abn && <div style={{marginTop:6,fontSize:10,fontWeight:700,color:C.red}}>⚠ Outside normal range</div>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Vital log table */}
      <Card title="📋 Vital Readings Log" titleBg={C.primaryL} titleColor={C.primaryD}>
        <div style={{overflowX:"auto",maxHeight:420}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead style={{position:"sticky",top:0,zIndex:1}}>
              <tr style={{background:C.primaryL}}>
                {["Date","Time","BP","Pulse","Temp °F","SpO₂%","RR/min","BSL","Pain","Nurse"].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.rose200}`,whiteSpace:"nowrap",fontSize:10,textTransform:"uppercase",letterSpacing:".4px"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...allRows].reverse().map((row,i)=>{
                const val = key=>row.values[key]?.value;
                const sbpV=val("BP Systolic"), dbpV=val("BP Diastolic"), pulseV=val("Pulse"), spo2V=val("SpO2");
                const bpDisplay = sbpV&&dbpV?`${sbpV}/${dbpV}`:sbpV||dbpV||"—";
                return (
                  <tr key={i} style={{background:i%2?C.primaryL:C.card,borderBottom:`1px solid ${C.border}`}}>
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

/* ══════════════════════════════════════════════════ TAB: NURSING NOTES */
const NOTE_CFG = {
  vitals:      {icon:"💓", label:"Vitals",              color:C.teal,    bg:C.tealL,    dot:C.tealB},
  daily:       {icon:"📋", label:"Daily Assessment",    color:C.blue,    bg:C.blueL,    dot:C.blueB},
  initial:     {icon:"🏥", label:"Initial Assessment",  color:"#92400e", bg:"#fffbeb",  dot:"#fbbf24"},
  intake:      {icon:"🧪", label:"I&O Chart",           color:C.green,   bg:C.greenL,   dot:C.greenB},
  mews:        {icon:"⚠️", label:"MEWS Score",          color:C.red,     bg:C.redL,     dot:C.redB},
  blood:       {icon:"🩸", label:"Blood Transfusion",   color:C.red,     bg:C.primaryL, dot:C.rose200},
  wound:       {icon:"🩹", label:"Wound Care",          color:"#6d28d9", bg:C.purpleL,  dot:C.purpleB},
  skin:        {icon:"🔲", label:"Skin Assessment",     color:"#7c3aed", bg:C.purpleL,  dot:C.purpleB},
  pain:        {icon:"😣", label:"Pain Assessment",     color:C.amber,   bg:C.amberL,   dot:C.amberB},
  fall:        {icon:"🚶", label:"Fall Risk",           color:"#c2410c", bg:"#fff7ed",  dot:"#fed7aa"},
  neuro:       {icon:"🧠", label:"Neuro Assessment",    color:C.purple,  bg:C.purpleL,  dot:C.purpleB},
  procedure:   {icon:"🔧", label:"Procedure",           color:C.teal,    bg:C.tealL,    dot:C.tealB},
  discharge:   {icon:"📤", label:"Discharge/Handover",  color:C.muted,   bg:"#f1f5f9",  dot:"#94a3b8"},
  careplan:    {icon:"📌", label:"Care Plan",           color:C.green,   bg:C.greenL,   dot:C.greenB},
  nutrition:   {icon:"🥗", label:"Nutritional",        color:"#065f46", bg:"#ecfdf5",  dot:"#6ee7b7"},
  iv:          {icon:"💉", label:"IV Infusion",         color:C.blue,    bg:C.blueL,    dot:C.blueB},
  education:   {icon:"📚", label:"Patient Education",  color:C.purple,  bg:C.purpleL,  dot:C.purpleB},
  general:     {icon:"📝", label:"General Note",        color:C.primary, bg:C.primaryL, dot:C.rose200},
};

/* ── Vitals strip helper ── */
function VitalsStrip({v={}}) {
  const items = [
    {l:"BP",    val: v.bp ? (typeof v.bp==="object" ? `${v.bp.systolic||v.bp_sys||""}/${v.bp.diastolic||v.bp_dia||""}` : v.bp) : (v.bp_sys&&v.bp_dia?`${v.bp_sys}/${v.bp_dia}`:null), color:C.red},
    {l:"Pulse", val: v.pulse ? `${v.pulse}/min` : null,  color:isAbn("pulse",v.pulse)?C.red:C.green},
    {l:"Temp",  val: v.temp  ? `${v.temp}°F`   : null,  color:isAbn("temp",v.temp)?C.red:C.green},
    {l:"SpO₂", val: v.spo2  ? `${v.spo2}%`    : null,  color:isAbn("spo2",v.spo2)?C.red:C.green},
    {l:"RR",    val: v.rr    ? `${v.rr}/min`   : null,  color:isAbn("rr",v.rr)?C.red:C.text},
    {l:"BSL",   val: v.bsl   ? `${v.bsl} mg/dL`: null,  color:C.amber},
    {l:"GCS",   val: v.gcs   ? `GCS ${v.gcs}`  : null,  color:C.blue},
  ].filter(f=>f.val&&f.val!=="/"&&f.val.replace(/\//g,"").trim()!=="");
  if (!items.length) return null;
  return (
    <div style={{padding:"7px 16px",background:C.primaryL,borderBottom:`1px solid ${C.rose200}`,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:9,fontWeight:800,textTransform:"uppercase",color:C.primary,letterSpacing:".5px"}}>💓 Vitals</span>
      {items.map(f=>(
        <div key={f.l} style={{display:"flex",flexDirection:"column",gap:1}}>
          <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.muted}}>{f.l}</span>
          <span style={{fontSize:12,fontWeight:700,color:f.color}}>{f.val}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Module-aware content renderer ── */
function NoteModuleBody({note}) {
  const md = note.moduleData || {};
  const blocks = [];

  // ── Remarks / free-text ──
  if (note.remarks?.trim()) {
    blocks.push(
      <div key="remarks" style={{fontSize:13,color:C.text,lineHeight:1.7,padding:"10px 14px",background:"#f8fafc",borderRadius:8,borderLeft:`3px solid ${C.border}`}}>{note.remarks}</div>
    );
  }

  // ── General condition ──
  if (note.generalCondition && Object.values(note.generalCondition).some(v=>v)) {
    blocks.push(
      <div key="gc" style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Patient condition:</span>
        {Object.entries(note.generalCondition).filter(([,v])=>v).map(([k])=>(
          <Badge key={k} color={C.green} bg={C.greenL}>✓ {k.replace(/([A-Z])/g," $1").trim()}</Badge>
        ))}
      </div>
    );
  }

  // ── Vitals (vitals note type) ──
  const mdVitals = md.vitals;
  if (mdVitals) {
    const fields = [
      ["Heart Rate",mdVitals.heartRate||mdVitals.pulse],["Rhythm",mdVitals.rhythm],
      ["Temperature Site",mdVitals.tempSite],["Pain Scale",mdVitals.painScale],
      ["AVPU",mdVitals.avpu],["Orientation",mdVitals.orientation],
    ].filter(([,v])=>v);
    if (fields.length) {
      blocks.push(
        <div key="vdet" style={{display:"flex",gap:"6px 20px",flexWrap:"wrap",padding:"8px 12px",background:C.tealL,borderRadius:8,border:`1px solid ${C.tealB}`}}>
          {fields.map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:12,fontWeight:700,color:C.teal}}>{v}</div></div>
          ))}
        </div>
      );
    }
  }

  // ── Daily Assessment ──
  const da = md.dailyAssessment;
  if (da) {
    const systems = [["Neuro",da.neuroStatus],["Respiratory",da.respiratoryStatus],["CVS",da.cardiovascularStatus],["GI",da.giStatus],["GU",da.guStatus],["Skin",da.skinStatus],["Musculo",da.musculoskeletalStatus]].filter(([,v])=>v);
    const dVitals = {bp_sys:da.bp_sys,bp_dia:da.bp_dia,pulse:da.pulse,temp:da.temp,spo2:da.spo2,rr:da.rr,bsl:da.bsl,gcs:da.gcs};
    blocks.push(
      <div key="da" style={{padding:"10px 14px",background:C.blueL,borderRadius:8,border:`1px solid ${C.blueB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.blue,textTransform:"uppercase",marginBottom:8}}>📋 Daily Assessment</div>
        <VitalsStrip v={dVitals}/>
        {systems.length>0 && (
          <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap",marginTop:8}}>
            {systems.map(([k,v])=>(
              <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:11,color:C.text}}>{v}</div></div>
            ))}
          </div>
        )}
        {da.diet && <div style={{marginTop:6,fontSize:12,color:C.muted}}>Diet: {da.diet}</div>}
        {da.mobility && <div style={{fontSize:12,color:C.muted}}>Mobility: {da.mobility}</div>}
        {da.educationGiven && <Badge color={C.green} bg={C.greenL}>📚 Education given</Badge>}
      </div>
    );
  }

  // ── Initial Assessment ──
  const ia = md.initialAssessment;
  if (ia) {
    blocks.push(
      <div key="ia" style={{padding:"10px 14px",background:"#fffbeb",borderRadius:8,border:`1px solid #fbbf24`}}>
        <div style={{fontSize:10,fontWeight:700,color:"#92400e",textTransform:"uppercase",marginBottom:8}}>🏥 Initial Assessment</div>
        {ia.chiefComplaint && <div style={{fontSize:13,fontWeight:600,color:C.dark,marginBottom:4}}>CC: {ia.chiefComplaint} {ia.duration?`(${ia.duration})`:""}</div>}
        {ia.historyOfIllness && <div style={{fontSize:12,color:C.text,lineHeight:1.6,marginBottom:6}}>{ia.historyOfIllness}</div>}
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Admission Mode",ia.admissionMode],["Allergies",ia.allergies],["Past History",ia.pastHistory],["Diet",ia.diet],["Mobility",ia.mobility]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:12,color:C.text}}>{v}</div></div>
          ))}
        </div>
      </div>
    );
  }

  // ── MEWS Score ──
  const mews = md.mewsScore;
  if (mews) {
    const total = mews.total ?? 0;
    const band  = mews.band || (total>=5?"EMERGENCY":total>=3?"URGENT":"STABLE");
    const col   = total>=5?C.red:total>=3?C.amber:C.green;
    blocks.push(
      <div key="mews" style={{padding:"10px 14px",background:total>=5?C.redL:total>=3?C.amberL:C.greenL,borderRadius:8,border:`2px solid ${col}`,display:"flex",gap:12,alignItems:"center"}}>
        <div style={{textAlign:"center",minWidth:48}}>
          <div style={{fontSize:28,fontWeight:900,color:col}}>{total}</div>
          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",color:col}}>MEWS</div>
        </div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:col}}>⚠️ {band}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
            {[["RR",mews.rr],["SpO₂",mews.spo2],["Temp",mews.temp],["SBP",mews.sbp],["HR",mews.hr],["AVPU",mews.avpu]].filter(([,v])=>v!=null).map(([k,v])=>(
              <span key={k} style={{fontSize:11,color:C.muted}}>{k}: <b>{v}</b></span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Pain Assessment ──
  const pain = md.painAssessment || note.painAssessment;
  if (pain?.score) {
    const sc = Number(pain.score);
    const col = sc>=7?C.red:sc>=4?C.amber:C.green;
    blocks.push(
      <div key="pain" style={{padding:"10px 14px",background:sc>=7?C.redL:sc>=4?C.amberL:C.greenL,borderRadius:8,border:`1px solid ${col}`}}>
        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6}}>
          <span style={{fontSize:22}}>😣</span>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:col}}>Pain Score: {pain.score}/10</div>
            {pain.scale && <div style={{fontSize:11,color:C.muted}}>Scale: {pain.scale}</div>}
          </div>
        </div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Location",pain.location],["Type",pain.type],["Character",pain.character],["Onset",pain.onset],["Duration",pain.duration],["Radiation",pain.radiation??"No"],["Aggravates",pain.aggravatingFactor],["Relieves",pain.relievingFactor]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:11,color:C.text}}>{String(v)}</div></div>
          ))}
        </div>
        {pain.interventions?.length>0 && <div style={{marginTop:6,display:"flex",gap:5,flexWrap:"wrap"}}>{pain.interventions.map(x=><Badge key={x} color={C.teal} bg={C.tealL}>{x}</Badge>)}</div>}
      </div>
    );
  }

  // ── Fall Risk ──
  const fall = md.fallRisk;
  if (fall) {
    const score = [fall.m1,fall.m2,fall.m3,fall.m4,fall.m5,fall.m6].reduce((s,v)=>s+(Number(v)||0),0);
    const risk = score>=45?"High":score>=25?"Medium":"Low";
    const col  = score>=45?C.red:score>=25?C.amber:C.green;
    const ints = Object.entries(fall).filter(([k,v])=>k.startsWith("int")&&v===true).map(([k])=>k.slice(3).replace(/([A-Z])/g," $1").trim());
    blocks.push(
      <div key="fall" style={{padding:"10px 14px",background:score>=45?C.redL:score>=25?C.amberL:C.greenL,borderRadius:8,border:`1px solid ${col}`}}>
        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:ints.length?8:0}}>
          <span style={{fontSize:22}}>🚶</span>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:col}}>Fall Risk: {risk} (Score: {score})</div>
            <div style={{fontSize:11,color:C.muted}}>Morse Fall Scale</div>
          </div>
        </div>
        {ints.length>0 && (
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:C.muted,alignSelf:"center"}}>Interventions:</span>
            {ints.map(x=><Badge key={x} color={col} bg="white">{x}</Badge>)}
          </div>
        )}
      </div>
    );
  }

  // ── Neuro Assessment ──
  const neuro = md.neuroAssessment;
  if (neuro) {
    const gcsTot = (Number(neuro.gcse)||0)+(Number(neuro.gcsv)||0)+(Number(neuro.gcsm)||0);
    blocks.push(
      <div key="neuro" style={{padding:"10px 14px",background:C.purpleL,borderRadius:8,border:`1px solid ${C.purpleB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.purple,textTransform:"uppercase",marginBottom:8}}>🧠 Neuro Assessment</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {gcsTot>0&&<div><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>GCS Total</div><div style={{fontSize:14,fontWeight:800,color:gcsTot<9?C.red:C.purple}}>{gcsTot}/15</div></div>}
          {[["E",neuro.gcse],["V",neuro.gcsv],["M",neuro.gcsm],["Pupils",neuro.pupils],["Light Reflex",neuro.lightReflex],["Orientation",neuro.orientation],["Seizure",neuro.seizure?"Yes":"No"],["UL Limbs",neuro.limbUL],["LL Limbs",neuro.limbLL]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:11,color:C.text}}>{String(v)}</div></div>
          ))}
        </div>
      </div>
    );
  }

  // ── Blood Transfusion ──
  const bt = md.bloodTransfusion;
  if (bt) {
    blocks.push(
      <div key="bt" style={{padding:"10px 14px",background:C.primaryL,borderRadius:8,border:`1px solid ${C.rose200}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.primary,textTransform:"uppercase",marginBottom:8}}>🩸 Blood Transfusion</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Product",bt.product],["Bag No",bt.bagNo],["X-Match No",bt.crossMatchNo],["Volume",bt.volume?`${bt.volume} mL`:null],["Status",bt.status],["Start Time",bt.startTime],["2nd Nurse",bt.secondNurse]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:12,color:C.text,fontWeight:600}}>{v}</div></div>
          ))}
        </div>
        {bt.groupVerified && <div style={{marginTop:6}}><Badge color={C.green} bg={C.greenL}>✓ Group & X-match verified</Badge></div>}
      </div>
    );
  }

  // ── Wound Care ──
  const wc = md.woundCare;
  if (wc) {
    blocks.push(
      <div key="wc" style={{padding:"10px 14px",background:C.purpleL,borderRadius:8,border:`1px solid ${C.purpleB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:"#6d28d9",textTransform:"uppercase",marginBottom:8}}>🩹 Wound Care</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Type",wc.type],["Site",wc.site],["Size",wc.length&&wc.width?`${wc.length}×${wc.width}×${wc.depth||0} cm`:null],["Stage",wc.healingStage],["Exudate",`${wc.exudateAmt||""} ${wc.exudateType||""}`.trim()||null],["Surrounding",wc.surroundingSkin],["Dressing",wc.dressingUsed]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:11,color:C.text}}>{v}</div></div>
          ))}
        </div>
        {wc.intervention && <div style={{marginTop:6,fontSize:12,color:C.text,fontStyle:"italic"}}>Intervention: {wc.intervention}</div>}
      </div>
    );
  }

  // ── Skin Assessment (Braden) ──
  const skin = md.skinAssessment;
  if (skin) {
    const bTotal = [skin.b1,skin.b2,skin.b3,skin.b4,skin.b5,skin.b6].reduce((s,v)=>s+(Number(v)||0),0);
    const bRisk = bTotal<=9?"High":bTotal<=12?"Medium-High":bTotal<=14?"Medium":"Low";
    const bCol  = bTotal<=9?C.red:bTotal<=14?C.amber:C.green;
    blocks.push(
      <div key="skin" style={{padding:"10px 14px",background:C.purpleL,borderRadius:8,border:`1px solid ${C.purpleB}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>🔲</span>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:bCol}}>Braden Score: {bTotal} — {bRisk} Risk</div>
            {skin.stage && <div style={{fontSize:11,color:C.muted}}>Pressure Ulcer: {skin.stage}</div>}
          </div>
        </div>
        {skin.intervention && <div style={{marginTop:6,fontSize:12,color:C.text}}>{skin.intervention}</div>}
        {skin.area && <div style={{fontSize:12,color:C.muted,marginTop:4}}>Area: {skin.area}</div>}
      </div>
    );
  }

  // ── IV Infusion ──
  const ivInf = md.ivInfusion;
  if (ivInf) {
    blocks.push(
      <div key="iv" style={{padding:"10px 14px",background:C.blueL,borderRadius:8,border:`1px solid ${C.blueB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.blue,textTransform:"uppercase",marginBottom:8}}>💉 IV Infusion</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Fluid",ivInf.fluid],["Volume",ivInf.volume?`${ivInf.volume} mL`:null],["Rate",ivInf.rate?`${ivInf.rate} mL/hr`:null],["Drops/min",ivInf.dropsPerMin],["Route",ivInf.route],["Site",ivInf.site],["Cannula Date",ivInf.cannulaDate],["Set Change",ivInf.setChangeDate]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:12,color:C.text,fontWeight:600}}>{v}</div></div>
          ))}
        </div>
        {ivInf.additive && <div style={{marginTop:4,fontSize:11,color:C.muted}}>Additive: {ivInf.additive}</div>}
      </div>
    );
  }

  // ── Intake/Output ──
  const io = md.intakeOutput || note.intakeOutput;
  if (io) {
    const intake = (Number(io.oral)||0)+(Number(io.ivFluids)||0)+(Number(io.ivMedFluids)||0);
    const output = (Number(io.urineOutput)||0)+(Number(io.nasogastricOutput)||0)+(Number(io.otherOutput)||0);
    const balance = intake - output;
    blocks.push(
      <div key="io" style={{padding:"10px 14px",background:C.greenL,borderRadius:8,border:`1px solid ${C.greenB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.green,textTransform:"uppercase",marginBottom:8}}>🧪 Intake / Output</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          {[["Oral",io.oral],["IV Fluids",io.ivFluids],["IV Meds",io.ivMedFluids],["Urine",io.urineOutput],["NG Out",io.nasogastricOutput],["Other Out",io.otherOutput]].filter(([,v])=>Number(v)>0).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:13,fontWeight:800,color:C.green}}>{v} mL</div></div>
          ))}
          {(intake>0||output>0)&&<div style={{borderLeft:`2px solid ${C.greenB}`,paddingLeft:12}}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Balance</div><div style={{fontSize:13,fontWeight:800,color:balance>=0?C.green:C.red}}>{balance>=0?"+":""}{balance} mL</div></div>}
        </div>
      </div>
    );
  }

  // ── Care Plan ──
  const cp = md.carePlan;
  if (cp?.problems?.length>0) {
    blocks.push(
      <div key="cp" style={{padding:"10px 14px",background:C.greenL,borderRadius:8,border:`1px solid ${C.greenB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.green,textTransform:"uppercase",marginBottom:8}}>📌 Care Plan ({cp.problems.length} problems)</div>
        {cp.problems.slice(0,5).map((p,pi)=>(
          <div key={pi} style={{marginBottom:8,padding:"6px 10px",background:"white",borderRadius:6,border:`1px solid ${C.greenB}`}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
              <Badge color={p.priority==="High"?C.red:p.priority==="Medium"?C.amber:C.green} bg="white">{p.priority||"Routine"}</Badge>
              <span style={{fontSize:12,fontWeight:700,color:C.dark}}>{p.statement}</span>
            </div>
            {p.relatedTo && <div style={{fontSize:11,color:C.muted}}>Related to: {p.relatedTo}</div>}
            {p.goals && <div style={{fontSize:11,color:C.green}}>Goal: {p.goals}</div>}
          </div>
        ))}
      </div>
    );
  }

  // ── Nutritional Assessment ──
  const nut = md.nutritionalAssessment;
  if (nut) {
    const nutScore = (Number(nut.nutritionScore)||0)+(Number(nut.diseaseScore)||0);
    blocks.push(
      <div key="nut" style={{padding:"10px 14px",background:"#ecfdf5",borderRadius:8,border:`1px solid #6ee7b7`}}>
        <div style={{fontSize:10,fontWeight:700,color:"#065f46",textTransform:"uppercase",marginBottom:8}}>🥗 Nutritional Assessment</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Weight",nut.weight?`${nut.weight} kg`:null],["Height",nut.height?`${nut.height} cm`:null],["BMI",nut.bmi],["NRS Score",nutScore||null],["Diet Type",nut.dietType],["Oral Intake",nut.oralIntake]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:12,color:"#065f46",fontWeight:600}}>{v}</div></div>
          ))}
        </div>
        {[nut.bmiLow&&"Low BMI",nut.weightLoss&&"Weight Loss",nut.reducedIntake&&"Reduced Intake",nut.seriouslyIll&&"Seriously Ill"].filter(Boolean).length>0 && (
          <div style={{marginTop:6,display:"flex",gap:4,flexWrap:"wrap"}}>
            {[nut.bmiLow&&"Low BMI",nut.weightLoss&&"Weight Loss",nut.reducedIntake&&"Reduced Intake",nut.seriouslyIll&&"Seriously Ill"].filter(Boolean).map(x=><Badge key={x} color={C.amber} bg={C.amberL}>{x}</Badge>)}
          </div>
        )}
      </div>
    );
  }

  // ── Procedure ──
  const proc = md.procedure;
  if (proc) {
    blocks.push(
      <div key="proc" style={{padding:"10px 14px",background:C.tealL,borderRadius:8,border:`1px solid ${C.tealB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.teal,textTransform:"uppercase",marginBottom:8}}>🔧 Procedure</div>
        <div style={{fontSize:13,fontWeight:700,color:C.dark,marginBottom:4}}>{proc.procedureName}</div>
        <div style={{display:"flex",gap:"6px 20px",flexWrap:"wrap"}}>
          {[["Indication",proc.indication],["Site",proc.site],["Laterality",proc.laterality],["Time",proc.time],["Performed By",proc.performedBy],["Consent",proc.consentObtained?"Obtained":"Pending"]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k}><div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:11,color:C.text}}>{v}</div></div>
          ))}
        </div>
        {proc.complications && <div style={{marginTop:6,fontSize:12,color:C.red}}>⚠ Complications: {proc.complications}</div>}
        {proc.postProcedureInstructions && <div style={{marginTop:4,fontSize:12,color:C.text}}>Post-procedure: {proc.postProcedureInstructions}</div>}
      </div>
    );
  }

  // ── Patient Education ──
  const pe = md.patientEducation;
  if (pe) {
    blocks.push(
      <div key="pe" style={{padding:"10px 14px",background:C.purpleL,borderRadius:8,border:`1px solid ${C.purpleB}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.purple,textTransform:"uppercase",marginBottom:8}}>📚 Patient Education</div>
        {pe.topics?.length>0 && (
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
            {pe.topics.map(t=><Badge key={t} color={C.purple} bg="white">{t}</Badge>)}
          </div>
        )}
        {[["Understanding",pe.understanding],["Educator",pe.educator],["Date",pe.date]].filter(([,v])=>v).map(([k,v])=>(
          <div key={k} style={{fontSize:11,color:C.muted,marginBottom:2}}>{k}: <b style={{color:C.text}}>{v}</b></div>
        ))}
        {pe.barriers?.length>0 && <div style={{marginTop:4,fontSize:11,color:C.muted}}>Barriers: {pe.barriers.join(", ")}</div>}
      </div>
    );
  }

  // ── Discharge / SBAR Handover ──
  const disc = md.discharge;
  if (disc) {
    blocks.push(
      <div key="disc" style={{padding:"10px 14px",background:"#f8fafc",borderRadius:8,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8}}>📤 {disc.type||"Handover"}</div>
        {[["Situation",disc.situation],["Background",disc.background],["Assessment",disc.assessment],["Recommendation",disc.recommendation]].filter(([,v])=>v).map(([k,v])=>(
          <div key={k} style={{marginBottom:6}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k}</div><div style={{fontSize:12,color:C.text,lineHeight:1.6}}>{v}</div></div>
        ))}
      </div>
    );
  }

  // ── IV Line (direct field) ──
  if (note.ivLine?.site && !ivInf) {
    blocks.push(
      <div key="ivline" style={{fontSize:12,padding:"8px 12px",background:C.blueL,borderRadius:8,border:`1px solid ${C.blueB}`}}>
        <span style={{fontWeight:700,color:C.blue}}>IV Line: </span>{note.ivLine.site} — <span style={{color:note.ivLine.condition==="Patent"?C.green:C.red}}>{note.ivLine.condition||"—"}</span>
        {note.ivLine.notes && <span style={{color:C.muted}}> · {note.ivLine.notes}</span>}
      </div>
    );
  }

  // ── Nursing Care Checklist ──
  if (note.nursingCare && Object.entries(note.nursingCare).filter(([,v])=>v===true).length>0) {
    blocks.push(
      <div key="nc">
        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:5}}>Nursing Care Done</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {Object.entries(note.nursingCare).filter(([,v])=>v===true).map(([k])=>(
            <Badge key={k} color={C.green} bg={C.greenL}>✓ {k.replace(/([A-Z])/g," $1").trim()}</Badge>
          ))}
        </div>
      </div>
    );
  }

  // ── Orders Executed ──
  if (note.ordersExecuted?.length>0) {
    blocks.push(
      <div key="oe">
        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Orders Executed ({note.ordersExecuted.length})</div>
        {note.ordersExecuted.map((o,oi)=>(
          <div key={oi} style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:4,padding:"6px 10px",background:"#f8fafc",borderRadius:6}}>
            <span>{o.status==="done"?"✅":o.status==="skipped"?"⏭️":"⚡"}</span>
            <span style={{flex:1}}>{o.instruction}</span>
            <SBadge status={o.status}/>
            {o.remarks && <span style={{fontSize:11,color:C.muted}}>({o.remarks})</span>}
          </div>
        ))}
      </div>
    );
  }

  if (blocks.length===0) {
    return <div style={{fontSize:12,color:C.muted,fontStyle:"italic",padding:"8px 0"}}>No additional details recorded.</div>;
  }
  return <>{blocks}</>;
}

/* ── Timeline note styles (matches NursingNotes.jsx) ── */
const NOTE_STYLE_TL = {
  vitals:    {bg:"#dbeafe", color:"#1e40af",  dot:"#3b82f6"},
  blood:     {bg:"#fecaca", color:"#9f1239",  dot:"#dc2626"},
  iv:        {bg:C.tealL,  color:C.teal,     dot:C.teal},
  wound:     {bg:C.redL,   color:C.red,      dot:C.red},
  pain:      {bg:C.amberL, color:"#92400e",  dot:C.amber},
  procedure: {bg:C.purpleL,color:C.purple,   dot:C.purple},
  neuro:     {bg:C.purpleL,color:C.purple,   dot:C.purple},
  fall:      {bg:"#fff7ed",color:"#ea580c",  dot:"#ea580c"},
  skin:      {bg:C.greenL, color:C.green,    dot:C.green},
  intake:    {bg:C.blueL,  color:C.blue,     dot:C.blue},
  general:   {bg:"#f9fafb",color:"#374151",  dot:"#9ca3af"},
  discharge: {bg:C.greenL, color:C.green,    dot:C.green},
  mews:      {bg:C.amberL, color:"#92400e",  dot:C.amber},
  daily:     {bg:"#e0f2fe",color:"#0369a1",  dot:"#0ea5e9"},
  initial:   {bg:"#fdf2f8",color:"#be185d",  dot:"#ec4899"},
  careplan:  {bg:"#ecfdf5",color:"#065f46",  dot:"#10b981"},
  nutrition: {bg:"#dcfce7",color:"#15803d",  dot:"#22c55e"},
  education: {bg:"#f5f3ff",color:"#6d28d9",  dot:"#8b5cf6"},
};
const TL_MODULES = [
  {id:"vitals",    label:"Vital Signs",                icon:"pi-heart"},
  {id:"neuro",     label:"Neuro / GCS",                icon:"pi-eye"},
  {id:"pain",      label:"Pain Assessment",             icon:"pi-exclamation-circle"},
  {id:"intake",    label:"Intake / Output",             icon:"pi-sort-alt"},
  {id:"iv",        label:"IV Infusion",                 icon:"pi-plus-circle"},
  {id:"blood",     label:"Blood Transfusion",           icon:"pi-heart-fill"},
  {id:"wound",     label:"Wound / Dressing",            icon:"pi-pencil"},
  {id:"skin",      label:"Skin / Pressure Assessment",  icon:"pi-th-large"},
  {id:"fall",      label:"Fall Risk (Morse)",           icon:"pi-exclamation-triangle"},
  {id:"procedure", label:"Procedure / Intervention",    icon:"pi-cog"},
  {id:"discharge", label:"Discharge / Handover (SBAR)", icon:"pi-sign-out"},
  {id:"mews",      label:"MEWS Score",                  icon:"pi-chart-bar"},
  {id:"general",   label:"General Observation",         icon:"pi-file"},
  {id:"daily",     label:"Daily Assessment",            icon:"pi-calendar-plus"},
  {id:"initial",   label:"Initial Assessment",          icon:"pi-clipboard"},
  {id:"careplan",  label:"Care Plan",                   icon:"pi-heart-fill"},
  {id:"nutrition", label:"Nutritional Assessment",      icon:"pi-apple"},
  {id:"education", label:"Patient Education",           icon:"pi-book"},
];
const mewsBandTL = s => s<=1?{label:"Normal",color:C.green,bg:C.greenL}:s<=4?{label:"Increased Monitoring",color:C.amber,bg:C.amberL}:s<=6?{label:"Urgent Review",color:"#ea580c",bg:"#fff7ed"}:{label:"EMERGENCY",color:C.red,bg:C.redL};

function NursingNotesTab({notes=[]}) {
  const [filterType, setFilterType] = useState("All");

  const sortedNotes = [...notes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const types = ["All",...new Set(sortedNotes.map(n=>n.noteType||"general").filter(Boolean))];
  const filtered = filterType==="All"?sortedNotes:sortedNotes.filter(n=>(n.noteType||"general")===filterType);

  if (!notes.length) return <Empty icon="📝" msg="No nursing notes recorded yet for this patient"/>;

  /* ── field label map (matches NursingNotes.jsx) ── */
  const FIELD_LBL = {
    m1:"History of Falls",m2:"Secondary Dx",m3:"Ambul. Aid",m4:"IV / Heparin Lock",m5:"Gait / Transfer",m6:"Mental Status",
    intBedRails:"Bed Rails ↑",intCallBell:"Call Bell",intNonSlip:"Non-Slip",intBedLowest:"Bed Lowest",intSupervision:"Supervision",intPatientEd:"Pt. Edu.",intFamilyEd:"Family Edu.",
    gcse:"Eyes (E)",gcsv:"Verbal (V)",gcsm:"Motor (M)",scale:"Scale",score:"Score",location:"Location",character:"Character",onset:"Onset",frequency:"Frequency",duration:"Duration",
    analgesicGiven:"Analgesic Given",analgesic:"Drug",analgesicRoute:"Route",painOnMovement:"Pain on Movement",reassessScore:"Reassess Score",reassessTime:"Reassess Time",
    nonPharmacological:"Non-Pharm",aggravatingFactors:"Aggravating",pupils:"Pupils",pupilSizeL:"Pupil L (mm)",pupilSizeR:"Pupil R (mm)",lightReflex:"Light Reflex",
    orientation:"Orientation",seizure:"Seizure",limbUL:"Upper-L",limbUR:"Upper-R",limbLL:"Lower-L",limbLR:"Lower-R",
    product:"Product",bagNo:"Bag No.",crossMatchNo:"X-Match No.",volume:"Volume (mL)",groupVerified:"Group Verified",secondNurse:"2nd Nurse",
    startTime:"Start",endTime:"End",reactionType:"Reaction",preBP_sys:"Pre-Sys BP",preBP_dia:"Pre-Dia BP",prePulse:"Pre-Pulse",postBP_sys:"Post-Sys BP",postBP_dia:"Post-Dia BP",postPulse:"Post-Pulse",
    fluid:"Fluid",rate:"Rate (mL/hr)",dropsPerMin:"gtts/min",route:"Route",site:"Site",cannulaDate:"Cannula Date",setChangeDate:"Set Change",additive:"Additive",
    oral:"Oral (mL)",ivFluids:"IV Fluids (mL)",urineOutput:"Urine (mL)",otherOutput:"Other Out (mL)",nasogastricOutput:"NGT Out (mL)",ivMedFluids:"IV Med (mL)",
    type:"Type",length:"Length (cm)",width:"Width (cm)",depth:"Depth (cm)",exudateAmt:"Exudate Amt",exudateType:"Exudate Type",healingStage:"Healing Stage",
    surroundingSkin:"Surrounding Skin",tunneling:"Tunneling",undermining:"Undermining",odour:"Odour",dressingUsed:"Dressing Used",painDuring:"Pain During",nextDressingDate:"Next Dressing",swabSent:"Swab Sent",
    area:"Area",b1:"Sensory",b2:"Moisture",b3:"Activity",b4:"Mobility",b5:"Nutrition(Braden)",b6:"Friction/Shear",stage:"Pressure Stage",repositioned:"Repositioned",repositionFreq:"Freq.",
    procedureName:"Procedure",indication:"Indication",laterality:"Laterality",time:"Time",consentObtained:"Consent",performedBy:"Performed By",designation:"Designation",assistant:"Assistant",
    sterile:"Sterile",position:"Position",outcome:"Outcome",complications:"Complications",specimenSent:"Specimen Sent",specimenType:"Specimen Type",postProcVitals:"Post-Proc Vitals",followUp:"Follow-Up",
    situation:"S – Situation",background:"B – Background",assessment:"A – Assessment",recommendation:"R – Recommendation",incomingNurse:"Incoming Nurse",patientStatus:"Patient Status",
    educationGiven:"Edu. Given",educationTopics:"Topics",followUpDate:"Follow-Up Date",valuablesHandedOver:"Valuables",
    neuroStatus:"Neuro",respiratoryStatus:"Respiratory",cardiovascularStatus:"CVS",giStatus:"GI",guStatus:"GU",musculoskeletalStatus:"MSK",skinStatus:"Skin",
    intReposition:"Reposition",intOralCare:"Oral Care",intPressureRelief:"Pressure Relief",intRangeOfMotion:"ROM",intFallPrecautions:"Fall Precautions",intMedAdministered:"Meds Given",
    intWoundCare:"Wound Care",intIVCheck:"IV Check",intNGTCheck:"NGT Check",intFoleyCheck:"Foley Check",intOxygenCheck:"O₂ Check",intPatientEducation:"Pt. Edu.",
    intFamilyUpdate:"Family Update",intDoctorNotified:"Dr. Notified",intDocumented:"Documented",
    dietType:"Diet",appetite:"Appetite",feedingMode:"Mode",swallowing:"Swallowing",ngtPresent:"NGT Present",caloriesToday:"Calories",proteinToday:"Protein",fluidToday:"Fluid",
    dietitianReferral:"Dietitian Ref.",referralReason:"Ref. Reason",nutritionScore:"Nutrition Score",diseaseScore:"Disease Score",ageScore:"Age Score (>70yr)",weight:"Weight",height:"Height",
    topics:"Topics",methods:"Methods",understanding:"Understanding",language:"Language",response:"Response",barriers:"Barriers",sessionNotes:"Session Notes",nextSessionDate:"Next Session",
    bmiLow:"BMI Low",weightLoss:"Weight Loss",reducedIntake:"Reduced Intake",seriouslyIll:"Seriously Ill",midArmCirc:"Mid Arm Circ",consistency:"Consistency",dietitianRef:"Dietitian Ref.",
    nrsTotal:"NRS Total",calories:"Calories",protein:"Protein",
  };
  const MOD_SECTION_LBL = {
    painAssessment:"Pain Assessment",neuroAssessment:"Neuro / GCS",bloodTransfusion:"Blood Transfusion",ivInfusion:"IV Infusion",
    intakeOutput:"Intake / Output",woundCare:"Wound / Dressing",skinAssessment:"Skin / Pressure (Braden)",fallRisk:"Fall Risk (Morse Scale)",
    procedure:"Procedure / Intervention",discharge:"Discharge / Handover (SBAR)",dailyAssessment:"Daily Assessment",initialAssessment:"Initial Assessment",
    carePlan:"Care Plan",nutritionalAssessment:"Nutritional Assessment (NRS-2002)",patientEducation:"Patient Education",
  };
  const fmtKey = k => FIELD_LBL[k] || k.replace(/([A-Z])/g," $1").replace(/^[Ii]nt /,"").trim();
  const fmtVal = v => {
    if (v===null||v===undefined||v===""||v===false) return null;
    if (typeof v==="boolean") return "✓ Yes";
    if (Array.isArray(v)) { if (!v.length) return null; return v.map(x=>typeof x==="object"?(x.statement||x.topic||x.name||JSON.stringify(x)):String(x)).join(", "); }
    if (typeof v==="object") {
      if ("systolic" in v && "diastolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
      const inner = Object.entries(v).filter(([,x])=>x).map(([k2,v2])=>`${k2}:${v2}`).join(" | ");
      return inner||null;
    }
    return String(v);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Summary */}
      <div style={{display:"flex",gap:8,padding:"10px 14px",background:C.primaryL,borderRadius:10,border:`1px solid ${C.rose200}`,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:700,color:C.primaryD}}>📝 {notes.length} Nursing Notes</span>
        <span style={{fontSize:11,color:C.muted}}>across {types.length-1} categories</span>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {types.map(t=>{
          const ns = NOTE_STYLE_TL[t]||NOTE_STYLE_TL.general;
          const mod = TL_MODULES.find(m=>m.id===t);
          return (
            <button key={t} onClick={()=>setFilterType(t)}
              style={{padding:"4px 12px",borderRadius:20,border:`1.5px solid ${filterType===t?ns.dot:C.border}`,background:filterType===t?ns.dot:"white",color:filterType===t?"white":C.muted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              {t!=="All"&&mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
              {t==="All"?"All":(mod?.label||t)}
              {t!=="All"&&<span style={{fontSize:10,opacity:.8}}>({sortedNotes.filter(n=>(n.noteType||"general")===t).length})</span>}
            </button>
          );
        })}
        <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{filtered.length} shown</span>
      </div>

      {/* Timeline container */}
      <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,.04)"}}>
        {/* Timeline header */}
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.primaryL}}>
          <div style={{fontWeight:800,fontSize:14,color:C.primaryD}}>Nursing Notes Timeline</div>
          <span style={{fontSize:11,color:C.muted}}>{filtered.length} entries</span>
        </div>

        {filtered.map((note, i) => {
          const ns  = NOTE_STYLE_TL[note.noteType] || NOTE_STYLE_TL.general;
          const mod = TL_MODULES.find(m=>m.id===note.noteType);
          const timeStr = note.createdAt
            ? new Date(note.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})
            : "--:--";
          const mData = note.moduleData||{};
          const SKIP = new Set(note.noteType==="mews"?["mewsScore"]:note.noteType==="vitals"?["vitals"]:[]);

          return (
            <div key={note._id||i}
              style={{
                margin:"0 16px",padding:"16px 16px 16px 0",
                borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",
                display:"grid",gridTemplateColumns:"80px 1fr auto",gap:16,alignItems:"start",
                borderLeft:`4px solid ${ns.dot}`,paddingLeft:16,
                transition:"background .15s,border-radius .15s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${ns.bg}50`;e.currentTarget.style.borderRadius="12px";e.currentTarget.style.margin="2px 16px";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderRadius="0";e.currentTarget.style.margin="0 16px";}}>

              {/* ── Time column ── */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,paddingTop:2}}>
                <div style={{background:ns.bg,border:`1.5px solid ${ns.dot}30`,borderRadius:8,padding:"5px 8px",textAlign:"center",minWidth:62}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:800,color:ns.color,lineHeight:1}}>{timeStr}</div>
                  <div style={{fontSize:8,fontWeight:700,color:ns.color+"aa",textTransform:"uppercase",letterSpacing:".5px",marginTop:3}}>
                    {(note.shift||"morning").charAt(0).toUpperCase()+(note.shift||"morning").slice(1)}
                  </div>
                </div>
                <div style={{width:10,height:10,borderRadius:"50%",background:ns.dot,boxShadow:`0 0 0 3px ${ns.dot}30`}}/>
              </div>

              {/* ── Body ── */}
              <div>
                {/* Header row */}
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8,flexWrap:"wrap"}}>
                  <span style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontWeight:700,letterSpacing:".6px",background:ns.bg,color:ns.color,display:"flex",alignItems:"center",gap:5}}>
                    {mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
                    {mod?.label||note.noteType?.toUpperCase()||"General"}
                  </span>
                  {note.isCriticalEvent && (
                    <span style={{background:C.red,color:"white",padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:".5px",display:"flex",alignItems:"center",gap:4}}>
                      <i className="pi pi-exclamation-triangle" style={{fontSize:9}}/> CRITICAL EVENT
                    </span>
                  )}
                  {note.nurseName && <span style={{fontSize:11,color:C.muted,fontWeight:500}}>{note.nurseName}</span>}
                </div>

                {/* Vitals structured data (vitals note type) */}
                {note.vitals && note.noteType==="vitals" && (
                  <div style={{display:"flex",gap:12,flexWrap:"wrap",padding:"10px 16px",background:`linear-gradient(to right, ${ns.bg}60, white)`,borderRadius:10,marginBottom:8}}>
                    {[
                      {label:"BP",     value:`${note.vitals.bp?.systolic||"—"}/${note.vitals.bp?.diastolic||"—"}`, abnormal:isAbn("bp_sys",note.vitals.bp?.systolic)},
                      {label:"PULSE",  value:`${note.vitals.pulse||"—"} /min`, abnormal:isAbn("pulse",note.vitals.pulse)},
                      {label:"TEMP",   value:note.vitals.temp?`${note.vitals.temp}°F`:"—", abnormal:isAbn("temp",note.vitals.temp)},
                      {label:"SPO₂",  value:note.vitals.spo2?`${note.vitals.spo2}%`:"—", abnormal:isAbn("spo2",note.vitals.spo2)},
                      {label:"RR",     value:note.vitals.rr?`${note.vitals.rr} /min`:"—"},
                      {label:"GCS",    value:note.moduleData?.vitals?.gcs||note.vitals.gcs||"—"},
                      {label:"BSL",    value:(note.moduleData?.vitals?.bsl||note.vitals.bsl)?`${note.moduleData?.vitals?.bsl||note.vitals.bsl} mg/dL`:"—", abnormal:isAbn("bsl",note.moduleData?.vitals?.bsl||note.vitals.bsl)},
                    ].map(v=>(
                      <div key={v.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                        <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>{v.label}</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:v.abnormal?700:500,color:v.abnormal?C.red:C.text}}>{v.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* MEWS score band */}
                {mData.mewsScore && note.noteType==="mews" && (()=>{
                  const ms = mData.mewsScore;
                  const band = mewsBandTL(ms.total||0);
                  return (
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",padding:"8px 14px",background:band.bg,borderRadius:7,marginBottom:8,alignItems:"center",border:`1px solid ${band.color}20`}}>
                      <div style={{display:"flex",flexDirection:"column",gap:1}}>
                        <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>MEWS TOTAL</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:20,fontWeight:900,color:band.color}}>{ms.total}</span>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:800,color:band.color}}>{ms.band||band.label}</div>
                      </div>
                      {[{l:"RR",v:ms.rr},{l:"SpO₂",v:ms.spo2},{l:"Temp",v:ms.temp},{l:"SBP",v:ms.sbp},{l:"HR",v:ms.hr},{l:"AVPU",v:ms.avpu}].filter(x=>x.v).map(v=>(
                        <div key={v.l} style={{display:"flex",flexDirection:"column",gap:1}}>
                          <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>{v.l}</span>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500}}>{v.v}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Generic module data renderer */}
                {note.moduleData && (()=>{
                  const blocks = Object.entries(note.moduleData)
                    .filter(([k])=>!SKIP.has(k))
                    .map(([mk,mv])=>{
                      if (!mv) return null;
                      if (Array.isArray(mv)) {
                        const items = mv.filter(Boolean);
                        if (!items.length) return null;
                        const summary = items.map((x,idx)=>typeof x==="object"?(x.statement||x.topic||x.name||`Item ${idx+1}`):String(x)).join(" | ");
                        return {key:mk,label:MOD_SECTION_LBL[mk]||mk,chips:[{label:`${items.length} item(s)`,value:summary}]};
                      }
                      if (typeof mv!=="object") return null;
                      const chips = Object.entries(mv).map(([k,v])=>({label:fmtKey(k),value:fmtVal(v)})).filter(c=>c.value!==null);
                      if (!chips.length) return null;
                      return {key:mk,label:MOD_SECTION_LBL[mk]||mk.replace(/([A-Z])/g," $1").trim(),chips};
                    }).filter(Boolean);
                  if (!blocks.length) return null;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:8}}>
                      {blocks.map(({key,label,chips})=>(
                        <div key={key} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:ns.color,marginBottom:5}}>{label}</div>
                          <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
                            {chips.map(c=>(
                              <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                                <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>
                                <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.text}}>{c.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Remarks */}
                {note.remarks && (
                  <div style={{fontSize:12.5,color:C.text,lineHeight:1.6,marginBottom:8}}>{note.remarks}</div>
                )}

                {/* Tags */}
                {note.tags?.length>0 && (
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {note.tags.map(t=>(
                      <span key={t} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"#f9fafb",color:C.muted,border:`1px solid ${C.border}`}}>{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Actions ── */}
              <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"flex-end"}}>
                <button style={{padding:"4px 10px",border:`1.5px solid ${C.border}`,borderRadius:6,background:"white",fontSize:11,fontWeight:600,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",gap:4}}>
                  <i className="pi pi-pencil" style={{fontSize:10}}/> Edit
                </button>
                <button style={{padding:"4px 10px",border:`1.5px solid ${C.border}`,borderRadius:6,background:"white",fontSize:11,fontWeight:600,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",gap:4}}>
                  <i className="pi pi-print" style={{fontSize:10}}/> Print
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════ TAB: DOCTOR NOTES TIMELINE */
const DR_NOTE_STYLE = {
  initial:      {bg:"#fffbeb",  color:"#92400e",  dot:"#f59e0b"},
  medication:   {bg:"#dbeafe",  color:"#1e40af",  dot:"#3b82f6"},
  infusion:     {bg:"#f0fdfa",  color:"#0d9488",  dot:"#0d9488"},
  daily:        {bg:"#dbeafe",  color:"#1e40af",  dot:"#1d4ed8"},
  icu:          {bg:"#fef2f2",  color:"#dc2626",  dot:"#dc2626"},
  procedure:    {bg:"#fff7ed",  color:"#ea580c",  dot:"#ea580c"},
  consultation: {bg:"#f5f3ff",  color:"#7c3aed",  dot:"#7c3aed"},
  preop:        {bg:"#f0fdfa",  color:"#0d9488",  dot:"#0d9488"},
  postop:       {bg:"#dcfce7",  color:"#16a34a",  dot:"#16a34a"},
  death:        {bg:"#f1f5f9",  color:"#1e293b",  dot:"#94a3b8"},
  amendment:    {bg:"#fffbeb",  color:"#d97706",  dot:"#d97706"},
};
const DR_MODULES = [
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
const DR_FIELD_LBL = {
  subjective:"Subjective (S)",objective:"Objective (O)",assessment:"Assessment (A)",plan:"Plan (P)",
  provisional:"Provisional Dx",final:"Final Dx",icd10:"ICD-10",status:"Clinical Status",
  ventMode:"Vent Mode",fio2:"FiO₂ (%)",peep:"PEEP",tv:"Tidal Vol",ventRR:"Vent RR",pip:"PIP",
  map:"MAP",cvp:"CVP",rassScore:"RASS Score",bpsScore:"BPS Score",dailyGoals:"Daily Goals",
  neuro:"Neuro",cvs:"CVS",resp:"Resp",renal:"Renal",gi:"GI",haem:"Haem",infective:"Infective",
  sedation:"Sedation",vasopressors:"Vasopressors",vasopressorDetail:"Vasopressor Detail",
  procedureName:"Procedure",indication:"Indication",laterality:"Laterality",time:"Time",
  surgeon:"Surgeon",assistant:"Assistant",anaesthesia:"Anaesthesia",position:"Position",
  consentObtained:"Consent",technique:"Technique",findings:"Findings",complications:"Complications",
  bloodLoss:"Blood Loss",specimenSent:"Specimen Sent",specimenType:"Specimen Type",
  postInstructions:"Post Instructions",consultantName:"Consultant",speciality:"Speciality",
  consultantRegNo:"Reg. No.",referredBy:"Referred By",reason:"Reason",
  clinicalSummary:"Clinical Summary",impression:"Impression",recommendations:"Recommendations",
  followUp:"Follow-Up",procedure:"Procedure",preopDiagnosis:"Pre-op Diagnosis",
  asaGrade:"ASA Grade",plannedAnaesthesia:"Planned Anaesthesia",bloodGroup:"Blood Group",
  crossMatch:"Cross Match",comorbidities:"Comorbidities",currentMeds:"Current Meds",
  allergies:"Allergies",anaesthetist:"Anaesthetist",preopOrders:"Pre-op Orders",
  procedurePerformed:"Procedure Performed",operativeFindings:"Operative Findings",
  startTime:"Start",endTime:"End",transfusion:"Transfusion",fluidsGiven:"Fluids",
  urineOutput:"Urine Output",postopDiagnosis:"Post-op Diagnosis",conditionLeavingOT:"Condition",
  recoveryInstructions:"Recovery Instructions",postopOrders:"Post-op Orders",
  dateTime:"Date/Time",causeDeath1:"Cause 1",causeDeath2:"Cause 2",causeDeath3:"Cause 3",
  contributing:"Contributing",sequenceOfEvents:"Sequence of Events",modeOfDeath:"Mode of Death",
  dnrInPlace:"DNR in Place",familyInformed:"Family Informed",familyInformedBy:"Informed By",
  familyInformedTime:"Informed Time",mlc:"MLC",pmAdvised:"PM Advised",
  certificateIssued:"Certificate Issued",originalNoteId:"Original Note ID",
  correction:"Correction",witness:"Witness",
};
const drFmtKey = k => DR_FIELD_LBL[k] || k.replace(/([A-Z])/g," $1").trim();
const drFmtVal = v => {
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

/* Initial Assessment grouped sections */
const DR_IA_SECTIONS = [
  {label:"Admission Details",    keys:["admissionMode","chiefComplaint","duration","hpi"]},
  {label:"Past History",         keys:["pastMedical","pastSurgical","familyHistory","socialHistory","currentMeds","allergies"]},
  {label:"Vitals on Admission",  keys:["bp_sys","bp_dia","pulse","temp","spo2","rr","weight","height","bsl"]},
  {label:"Examination",          keys:["generalCondition","builtNutrition","pallor","icterus","cyanosis","clubbing","lymphadenopathy","oedema"]},
  {label:"System Examination",   keys:["resp","cvs","abdomen","cns"]},
  {label:"Diagnosis",            keys:["provisionalDx","differentialDx","finalDx","icd10"]},
  {label:"Management",           keys:["investigations","managementPlan"]},
];
const DR_IA_LBL = {
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
/* Safe formatter for IA fields — converts arrays/objects to plain string so React doesn't throw */
const drIAFmt = v => {
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

function DrInitialDetails({nd, ns}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
      {DR_IA_SECTIONS.map(sec=>{
        const chips = sec.keys
          .map(k=>({label:DR_IA_LBL[k]||k, value:drIAFmt(nd[k])}))
          .filter(c=>c.value);
        if (!chips.length) return null;
        return (
          <div key={sec.label} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:ns.color,marginBottom:5}}>{sec.label}</div>
            <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
              {chips.map(c=>(
                <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.text,maxWidth:260,wordBreak:"break-word"}}>{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }).filter(Boolean)}
    </div>
  );
}

function DoctorNotesTab({doctorNotes=[]}) {
  const [filterType, setFilterType] = useState("All");
  const [collapsed, setCollapsed]   = useState({}); // empty = all open by default

  const sortedNotes = [...doctorNotes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const types = ["All",...new Set(sortedNotes.map(n=>n.noteType||"daily").filter(Boolean))];
  const filtered = filterType==="All"?sortedNotes:sortedNotes.filter(n=>(n.noteType||"daily")===filterType);

  if (!doctorNotes.length) return <Empty icon="🩺" msg="No doctor notes recorded yet for this patient"/>;

  const orderTypeIcon = t => t==="medication"?"💊":t==="iv_fluid"?"💧":t==="procedure"?"🔧":t==="diet"?"🍽️":"📋";
  const toggleNote = key => setCollapsed(p=>({...p,[key]:!p[key]}));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Summary strip */}
      <div style={{display:"flex",gap:8,padding:"10px 14px",background:C.purpleL,borderRadius:10,border:`1px solid ${C.purple}30`,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:700,color:C.purple}}>🩺 {doctorNotes.length} Doctor Notes</span>
        <span style={{fontSize:11,color:C.muted}}>across {types.length-1} categor{types.length-1===1?"y":"ies"}</span>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {types.map(t=>{
          const ns=DR_NOTE_STYLE[t]||{bg:"#f9fafb",color:"#374151",dot:"#9ca3af"};
          const mod=DR_MODULES.find(m=>m.id===t);
          return (
            <button key={t} onClick={()=>setFilterType(t)}
              style={{padding:"4px 12px",borderRadius:20,border:`1.5px solid ${filterType===t?ns.dot:C.border}`,background:filterType===t?ns.dot:"white",color:filterType===t?"white":C.muted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
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
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.purpleL}}>
          <div style={{fontWeight:800,fontSize:14,color:C.purple}}>Doctor Notes Timeline</div>
          <span style={{fontSize:11,color:C.muted}}>{filtered.length} entries</span>
        </div>

        {filtered.map((note,i)=>{
          const noteKey = note._id||i;
          const isOpen  = !collapsed[noteKey]; // empty map = all open by default
          const ns  = DR_NOTE_STYLE[note.noteType]||{bg:"#f9fafb",color:"#374151",dot:"#9ca3af"};
          const mod = DR_MODULES.find(m=>m.id===note.noteType);
          const timeStr = note.createdAt
            ? new Date(note.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})
            : "--:--";
          const soap = note.soap||{};
          const vitals = note.vitals||null;
          const nd = note.noteDetails||{};
          const hasSoap = soap.subjective||soap.objective||soap.assessment||soap.plan;
          const hasDiag = note.provisionalDiagnosis||note.finalDiagnosis;
          const hasInvx = note.investigations?.length>0;
          const hasOrders = note.orders?.length>0;
          const medOrders = nd.medicationOrders||[];
          const infOrders = nd.infusionOrders||[];
          const isInitial = note.noteType==="initial";

          /* Generic noteDetails blocks for non-initial types */
          const ndBlocks = isInitial ? [] : Object.entries(nd)
            .filter(([k])=>!["medicationOrders","infusionOrders"].includes(k))
            .map(([mk,mv])=>{
              if (!mv) return null;
              if (Array.isArray(mv)) {
                const items=mv.filter(Boolean);
                if (!items.length) return null;
                return {key:mk,label:DR_FIELD_LBL[mk]||mk,chips:[{label:`${items.length} item(s)`,value:items.map(x=>typeof x==="object"?(x.drug||x.drugFluid||x.procedureName||x.type||"Item"):String(x)).join(" | ")}]};
              }
              if (typeof mv!=="object") {
                const val=drFmtVal(mv);
                if (!val) return null;
                return {key:mk,label:"",chips:[{label:DR_FIELD_LBL[mk]||drFmtKey(mk),value:val}]};
              }
              const chips=Object.entries(mv).map(([k,v])=>({label:drFmtKey(k),value:drFmtVal(v)})).filter(c=>c.value!==null);
              if (!chips.length) return null;
              return {key:mk,label:DR_FIELD_LBL[mk]||mk.replace(/([A-Z])/g," $1").trim(),chips};
            }).filter(Boolean);

          return (
            <div key={noteKey}
              style={{
                margin:"0 16px",padding:"0",
                borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",
                borderLeft:`4px solid ${ns.dot}`,
                transition:"background .15s",
              }}>

              {/* ── 3-col grid row ── */}
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
                  {/* Clickable header row — always visible */}
                  <div onClick={()=>toggleNote(noteKey)}
                    style={{display:"flex",alignItems:"center",gap:7,marginBottom:isOpen?8:0,flexWrap:"wrap",cursor:"pointer",userSelect:"none"}}>
                    <span style={{padding:"3px 10px",borderRadius:5,fontSize:10,fontWeight:700,letterSpacing:".6px",background:ns.bg,color:ns.color,display:"flex",alignItems:"center",gap:5}}>
                      {mod&&<i className={`pi ${mod.icon}`} style={{fontSize:10}}/>}
                      {mod?.label||note.noteType?.toUpperCase()||"Note"}
                    </span>
                    {note.isCritical && (
                      <span style={{background:C.red,color:"white",padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:".5px",display:"flex",alignItems:"center",gap:4}}>
                        <i className="pi pi-exclamation-triangle" style={{fontSize:9}}/> CRITICAL EVENT
                      </span>
                    )}
                    {note.doctorName && <span style={{fontSize:11,color:C.muted,fontWeight:500}}>Dr. {note.doctorName}</span>}
                    {note.doctorRegNo && <span style={{fontSize:10,color:C.muted,opacity:.7}}>#{note.doctorRegNo}</span>}
                    <span style={{marginLeft:"auto",fontSize:11,color:ns.color,fontWeight:700,lineHeight:1}}>{isOpen?"▼":"▲"}</span>
                  </div>

                  {/* Collapsible content */}
                  {isOpen && (
                    <div>
                      {/* Vitals grid */}
                      {vitals && (
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",padding:"10px 16px",background:`linear-gradient(to right, ${ns.bg}60, white)`,borderRadius:10,marginBottom:8}}>
                          {[
                            {label:"BP",    value:`${vitals.bp?.systolic||"—"}/${vitals.bp?.diastolic||"—"}`},
                            {label:"PULSE", value:`${vitals.pulse||"—"} /min`},
                            {label:"TEMP",  value:vitals.temp?`${vitals.temp}°F`:"—"},
                            {label:"SPO₂", value:vitals.spo2?`${vitals.spo2}%`:"—"},
                            {label:"RR",    value:vitals.rr?`${vitals.rr} /min`:"—"},
                            {label:"GCS",   value:vitals.gcs||"—"},
                            {label:"BSL",   value:vitals.bsl?`${vitals.bsl} mg/dL`:"—"},
                          ].map(v=>(
                            <div key={v.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:C.muted}}>{v.label}</span>
                              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,color:C.text}}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* SOAP note */}
                      {hasSoap && (
                        <div style={{display:"flex",flexDirection:"column",gap:5,padding:"8px 12px",background:"#f9fafb",borderRadius:8,marginBottom:8,border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:ns.color,marginBottom:3}}>SOAP Note</div>
                          {[
                            {k:"S",v:soap.subjective},
                            {k:"O",v:soap.objective},
                            {k:"A",v:soap.assessment},
                            {k:"P",v:soap.plan},
                          ].filter(x=>x.v).map(x=>(
                            <div key={x.k} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                              <span style={{minWidth:18,height:18,borderRadius:4,background:ns.dot+"22",color:ns.color,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{x.k}</span>
                              <span style={{fontSize:11.5,color:C.text,lineHeight:1.55}}>{x.v}</span>
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
                            <div style={{display:"flex",flexDirection:"column",gap:1,padding:"6px 10px",background:C.greenL,borderRadius:6,border:`1px solid ${C.green}30`}}>
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
                              <span key={ii} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.blueL,color:C.blue,border:`1px solid ${C.blue}30`}}>{inv}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Inline orders */}
                      {hasOrders && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted,marginBottom:4}}>Orders ({note.orders.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {note.orders.map((o,oi)=>(
                              <div key={oi} style={{display:"flex",gap:8,alignItems:"center",padding:"5px 10px",background:"#f9fafb",borderRadius:6,border:`1px solid ${C.border}`}}>
                                <span style={{fontSize:14}}>{orderTypeIcon(o.type)}</span>
                                <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{o.instruction||"—"}</span>
                                {o.dose      &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:C.tealL,color:C.teal,fontWeight:600}}>{o.dose}</span>}
                                {o.route     &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:C.blueL,color:C.blue,fontWeight:600}}>{o.route}</span>}
                                {o.frequency &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"#f1f5f9",color:C.muted,fontWeight:600}}>{o.frequency}</span>}
                                {(!o.nurseStatus||o.nurseStatus==="pending")&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:C.amberL,color:C.amber,fontWeight:700}}>PENDING</span>}
                                {o.nurseStatus==="done"&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:C.greenL,color:C.green,fontWeight:700}}>DONE</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Medication Orders (from noteDetails) */}
                      {medOrders.length>0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.blue,marginBottom:4}}>💊 Medication Orders ({medOrders.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {medOrders.filter(m=>m.drug).map((m,mi)=>(
                              <div key={mi} style={{display:"flex",gap:6,alignItems:"center",padding:"5px 10px",background:C.blueL,borderRadius:6,border:`1px solid ${C.blue}20`}}>
                                <span style={{fontSize:12,fontWeight:600,color:C.blue,flex:1}}>{m.drug}</span>
                                {m.dose      &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.blue,fontWeight:600,border:`1px solid ${C.blue}30`}}>{m.dose}</span>}
                                {m.route     &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.muted,fontWeight:600}}>{m.route}</span>}
                                {m.frequency &&<span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:"white",color:C.muted,fontWeight:600}}>{m.frequency}</span>}
                                <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:m.status==="Active"?C.greenL:C.redL,color:m.status==="Active"?C.green:C.red,fontWeight:700}}>{m.status||"Active"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Infusion Orders (from noteDetails) */}
                      {infOrders.length>0 && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.teal,marginBottom:4}}>💧 Infusion Orders ({infOrders.length})</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {infOrders.filter(m=>m.drugFluid||m.type).map((m,mi)=>(
                              <div key={mi} style={{display:"flex",gap:6,alignItems:"center",padding:"5px 10px",background:C.tealL,borderRadius:6,border:`1px solid ${C.teal}20`}}>
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
                      {isInitial && Object.keys(nd).length>0 && <DrInitialDetails nd={nd} ns={ns}/>}

                      {/* Generic noteDetails renderer (non-initial) */}
                      {!isInitial && ndBlocks.length>0 && (
                        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:8}}>
                          {ndBlocks.map(({key,label,chips})=>(
                            <div key={key} style={{padding:"7px 12px",background:"#f9fafb",borderRadius:7,border:`1px solid ${C.border}`}}>
                              {label&&<div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:ns.color,marginBottom:5}}>{label}</div>}
                              <div style={{display:"flex",gap:"5px 14px",flexWrap:"wrap"}}>
                                {chips.map(c=>(
                                  <div key={c.label} style={{display:"flex",flexDirection:"column",gap:1}}>
                                    {c.label&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.muted}}>{c.label}</span>}
                                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:C.text}}>{c.value}</span>
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
                            <span key={t} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"#f9fafb",color:C.muted,border:`1px solid ${C.border}`}}>{t}</span>
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

/* ══════════════════════════════════════════════════ TAB: DOCTOR ORDERS */
function DoctorOrdersTab({doctorNotes=[]}) {
  // Extract all orders from all doctor notes
  const allOrders = [];
  doctorNotes.forEach(note=>{
    (note.orders||[]).forEach(o=>{
      allOrders.push({...o, noteDate:note.createdAt, doctorName:note.doctorName, noteType:note.noteType, shift:note.shift});
    });
  });
  allOrders.sort((a,b)=>new Date(b.noteDate)-new Date(a.noteDate));

  if (!allOrders.length) return <Empty icon="🩺" msg="No doctor orders found"/>;

  const pending = allOrders.filter(o=>!o.nurseStatus||o.nurseStatus==="pending");
  const done    = allOrders.filter(o=>o.nurseStatus==="done"||o.nurseStatus==="partial");
  const skipped = allOrders.filter(o=>o.nurseStatus==="skipped");

  const typeIcon = t => t==="medication"?"💊":t==="iv_fluid"?"💧":t==="procedure"?"🔧":t==="diet"?"🍽️":"📋";
  const statColor = s => s==="done"?C.green:s==="partial"?C.amber:s==="skipped"?C.muted:C.amber;

  const Section = ({title,orders,borderColor}) => !orders.length?null:(
    <div>
      <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",color:borderColor,letterSpacing:".5px",marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:3,height:14,background:borderColor,borderRadius:2}}/>
        {title}
        <span style={{background:`${borderColor}22`,color:borderColor,borderRadius:10,padding:"1px 8px",fontSize:11}}>{orders.length}</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {orders.map((o,i)=>(
          <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 14px",background:C.card,borderRadius:10,border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
            <div style={{width:36,height:36,borderRadius:8,background:o.nurseStatus==="done"?C.greenL:C.primaryL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
              {typeIcon(o.type)}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.dark,marginBottom:4}}>{o.instruction||"—"}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {o.dose      && <Badge color={C.teal}   bg={C.tealL}>{o.dose}</Badge>}
                {o.route     && <Badge color={C.blue}   bg={C.blueL}>{o.route}</Badge>}
                {o.frequency && <Badge color={C.muted}  bg="#f1f5f9">{o.frequency}</Badge>}
                {o.duration  && <Badge color={C.muted}  bg="#f1f5f9">{o.duration}</Badge>}
                {o.priority  && o.priority!=="ROUTINE" && <Badge color={C.red} bg={C.redL}>{o.priority}</Badge>}
              </div>
              {o.notes && <div style={{fontSize:11,color:C.muted,marginTop:4}}>{o.notes}</div>}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:700,color:statColor(o.nurseStatus)}}>{(o.nurseStatus||"PENDING").toUpperCase()}</div>
              {o.nurseConfirmedAt && <div style={{fontSize:10,color:C.muted}}>Done: {fmtDT(o.nurseConfirmedAt)}</div>}
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmtDate(o.noteDate)}</div>
              {o.doctorName && <div style={{fontSize:10,color:C.muted}}>Dr. {o.doctorName}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <Section title="⏳ Pending Orders" orders={pending} borderColor={C.amber}/>
      <Section title="✅ Completed Orders" orders={done}    borderColor={C.green}/>
      <Section title="⏭️ Skipped Orders"  orders={skipped} borderColor={C.muted}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════ TAB: MEDICATIONS */
function MedicationsTab({doctorNotes=[], doctorOrders=[]}) {
  // From doctor notes noteDetails.medicationOrders
  const allMeds=[];
  doctorNotes.forEach(note=>{
    (note.noteDetails?.medicationOrders||[]).forEach(m=>{
      allMeds.push({...m, noteDate:note.createdAt, doctorName:note.doctorName});
    });
  });

  // From doctor orders
  const active  = allMeds.filter(m=>(m.status||"Active")==="Active");
  const stopped = allMeds.filter(m=>["Stopped","Discontinued"].includes(m.status||""));

  if (!allMeds.length && !doctorOrders.length) return <Empty icon="💊" msg="No medication orders found. Check Doctor Orders tab for all orders."/>;

  const thStyle={padding:"7px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.rose200}`,fontSize:10,textTransform:"uppercase",letterSpacing:".4px",whiteSpace:"nowrap"};
  const tdStyle={padding:"8px 12px",borderBottom:`1px solid ${C.border}`,fontSize:12};

  const MedTable = ({title,meds,titleColor,titleBg}) => !meds.length?null:(
    <Card title={title} titleColor={titleColor} titleBg={titleBg}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:titleBg||C.primaryL}}>
              {["Drug","Dose","Route","Frequency","Duration","Indication","Status","Date"].map(h=><th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {meds.map((m,i)=>(
              <tr key={i} style={{background:i%2?C.primaryL:C.card}}>
                <td style={{...tdStyle,fontWeight:700,color:C.dark}}>{m.drug||m.medicineName||"—"}</td>
                <td style={tdStyle}>{m.dose||"—"}</td>
                <td style={tdStyle}><Badge color={C.teal} bg={C.tealL}>{m.route||"—"}</Badge></td>
                <td style={tdStyle}>{m.frequency||"—"}</td>
                <td style={tdStyle}>{m.duration||"—"}</td>
                <td style={{...tdStyle,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.indication||"—"}</td>
                <td style={tdStyle}><SBadge status={m.status||"Active"}/></td>
                <td style={{...tdStyle,color:C.muted}}>{fmtDate(m.noteDate||m.datetime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <MedTable title={`💊 Active Medications (${active.length})`} meds={active} titleColor={C.green} titleBg={C.greenL}/>
      {stopped.length>0 && <MedTable title={`🚫 Stopped (${stopped.length})`} meds={stopped} titleColor={C.red} titleBg={C.redL}/>}
      {doctorOrders.length>0 && (
        <Card title={`📋 Treatment Orders — MAR View (${doctorOrders.length})`} titleColor={C.blue} titleBg={C.blueL}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:C.blueL}}>{["Medicine","Dose","Route","Frequency","Status","Given Today"].map(h=><th key={h} style={{...thStyle,color:C.blue}}>{h}</th>)}</tr></thead>
              <tbody>
                {doctorOrders.map((o,i)=>{
                  const d=o.orderDetails||{};
                  const givenToday=(o.administrationRecord||[]).filter(r=>{
                    const dt=new Date(r.givenAt||""),t=new Date();
                    return dt.getFullYear()===t.getFullYear()&&dt.getMonth()===t.getMonth()&&dt.getDate()===t.getDate();
                  }).length;
                  return (
                    <tr key={i} style={{background:i%2?C.blueL:C.card}}>
                      <td style={{...tdStyle,fontWeight:700}}>{d.medicineName||"—"}</td>
                      <td style={tdStyle}>{d.dose||"—"}</td>
                      <td style={tdStyle}><Badge color={C.teal} bg={C.tealL}>{d.route||"—"}</Badge></td>
                      <td style={tdStyle}>{d.frequency||"—"}</td>
                      <td style={tdStyle}><SBadge status={o.status||"Active"}/></td>
                      <td style={tdStyle}>{givenToday>0?<Badge color={C.green} bg={C.greenL}>{givenToday}× given</Badge>:<Badge color={C.amber} bg={C.amberL}>Pending</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════ TAB: BILLING */
function BillingTab({billing}) {
  if (!billing) return <Empty icon="💰" msg="No billing record found"/>;
  const dueClass = (billing.balanceAmount || 0) > 0 ? "pf-bill-header__kpi pf-bill-header__kpi--due" : "pf-bill-header__kpi";
  return (
    <div className="pf-tint--nurse" style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="pf-bill-header">
        <div>
          <div className="pf-bill-header__id-label">Bill Number</div>
          <div className="pf-bill-header__id-val">{billing.billNumber || "—"}</div>
        </div>
        <div className="pf-bill-header__kpi">
          <div className="pf-bill-header__kpi-label">Total</div>
          <div className="pf-bill-header__kpi-val">{fmtCur(billing.netAmount)}</div>
        </div>
        <div className="pf-bill-header__kpi">
          <div className="pf-bill-header__kpi-label">Advance</div>
          <div className="pf-bill-header__kpi-val">{fmtCur(billing.advancePaid)}</div>
        </div>
        <div className={dueClass}>
          <div className="pf-bill-header__kpi-label">Balance Due</div>
          <div className="pf-bill-header__kpi-val">{fmtCur(billing.balanceAmount)}</div>
        </div>
        <div><SBadge status={billing.billStatus}/></div>
      </div>

      {(billing.billItems || []).length > 0 && (
        <div className="pf-section-card">
          <div className="pf-section-card__head">
            <span className="pf-section-card__icon">🧾</span>
            <span className="pf-section-card__title">Services</span>
            <span className="pf-section-card__count">{billing.billItems.length}</span>
          </div>
          <div className="pf-data-table-wrap">
            <table className="pf-data-table">
              <thead>
                <tr><th>Service</th><th>Category</th><th style={{textAlign:"right"}}>Amount</th></tr>
              </thead>
              <tbody>
                {billing.billItems.map((item, i) => (
                  <tr key={i}>
                    <td className="pf-cell-strong">{item.serviceName || "—"}</td>
                    <td><Badge color={C.primary} bg={C.primaryL}>{item.category || "—"}</Badge></td>
                    <td className="pf-cell-num pf-currency">{fmtCur(item.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(billing.payments || []).length > 0 && (
        <div className="pf-section-card pf-section-card--ok">
          <div className="pf-section-card__head">
            <span className="pf-section-card__icon">💳</span>
            <span className="pf-section-card__title">Payments</span>
            <span className="pf-section-card__count">{billing.payments.length}</span>
          </div>
          <div className="pf-data-table-wrap">
            <table className="pf-data-table">
              <thead>
                <tr><th>Date</th><th>Mode</th><th style={{textAlign:"right"}}>Amount</th><th>Reference</th></tr>
              </thead>
              <tbody>
                {billing.payments.map((p, i) => (
                  <tr key={i}>
                    <td>{fmtDT(p.paidAt || p.date)}</td>
                    <td>{p.mode || p.paymentMode || "—"}</td>
                    <td className="pf-cell-num pf-currency pf-currency--ok">{fmtCur(p.amount)}</td>
                    <td className="pf-cell-muted">{p.reference || p.receiptNumber || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════ TAB: EMERGENCY */
function EmergencyTab({emergency=[]}) {
  if (!emergency.length) return <Empty icon="🚨" msg="No emergency records found for this patient"/>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {emergency.map((em,i)=>(
        <Card key={i} title={`🚨 Emergency — ${fmtDT(em.createdAt||em.arrivalTime)}`} titleColor={C.red} titleBg={C.redL}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div>
              <InfoRow label="Emergency No."  value={em.emergencyNumber||em._id?.slice(-6)}/>
              <InfoRow label="Chief Complaint" value={em.chiefComplaint}/>
              <InfoRow label="Triage"         value={em.triageCategory||em.acuity}/>
              <InfoRow label="Arrival Mode"   value={em.arrivalMode}/>
              <InfoRow label="MLC"            value={em.mlcStatus||(em.isMLC?"Yes":"No")}/>
            </div>
            <div>
              {em.vitalsOnArrival && (
                <>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8}}>Vitals on Arrival</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[
                      {l:"BP",  v:bpStr(em.vitalsOnArrival?.bp)||`${em.vitalsOnArrival?.bpSys||""}/${em.vitalsOnArrival?.bpDia||""}`},
                      {l:"Pulse",v:em.vitalsOnArrival?.pulse},
                      {l:"SpO₂",v:em.vitalsOnArrival?.spo2},
                    ].filter(f=>f.v&&f.v!=="/").map(f=>(
                      <div key={f.l} style={{background:C.redL,border:`1px solid ${C.redB}`,borderRadius:8,padding:"8px 12px",textAlign:"center",minWidth:60}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{f.l}</div>
                        <div style={{fontSize:14,fontWeight:700,color:C.red}}>{f.v}</div>
                      </div>
                    ))}
                  </div>
                </>
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

/* ══════════════════════════════════════════════════ TAB: CONSENT FORMS
   R7hr-75 — Mirrors the DoctorPatientPanel.ConsentFormsTab.
   R7hr-76 — Render full consent document inline (body / risks / benefits /
   alternatives / consent-given-by / witness / biometric / staff sig)
   instead of just a summary card. */
function ConsentFormsTab({ consents = [], uhid, patient, admission }) {
  const STATUS_STYLE = {
    SIGNED:  { bg: C.greenL, color: C.green,  label: "✓ SIGNED"   },
    PENDING: { bg: C.amberL, color: C.amber,  label: "⌛ PENDING"  },
    REFUSED: { bg: C.redL,   color: C.red,    label: "✕ REFUSED"  },
    REVOKED: { bg: "#f1f5f9",color: C.muted,  label: "↶ REVOKED"  },
  };
  const openConsent = () => {
    const u = uhid ? `?uhid=${encodeURIComponent(uhid)}` : "";
    window.open(`/consent-forms${u}`, "_blank", "noopener");
  };
  if (!consents.length) {
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Empty icon="📜" msg="No consent forms recorded for this patient yet"/>
        <div style={{display:"flex",justifyContent:"center"}}>
          <button
            onClick={openConsent}
            style={{background:C.teal,color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontWeight:700,fontSize:13,cursor:"pointer",boxShadow:"0 2px 6px rgba(13,148,136,0.25)"}}
          >📜 Capture New Consent ↗</button>
        </div>
      </div>
    );
  }
  const liveWardBed = [admission?.wardName, admission?.bedNumber].filter(Boolean).join(" / ");
  const liveAdmDate = admission?.admissionDate ? new Date(admission.admissionDate).toLocaleDateString("en-IN") : "";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:C.dark}}>📜 Consent Forms</div>
          <div style={{fontSize:11,color:C.muted}}>NABH PRE.3 / PRE.4 · {consents.length} record{consents.length===1?"":"s"}</div>
        </div>
        <button onClick={openConsent}
          style={{background:C.teal,color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}
        >+ New Consent</button>
      </div>
      {consents.map((c, i) => {
        const st = STATUS_STYLE[c.status] || STATUS_STYLE.PENDING;
        const ts = c.signedAt || c.createdAt;
        const wardBed = c.wardBed || liveWardBed || "—";
        const admDate = c.admissionDate || liveAdmDate || "—";
        const dept    = c.department    || admission?.department || "—";
        const doctor  = c.doctorName    || admission?.attendingDoctor || "—";
        return (
          <div key={c._id || i}
            style={{background:"#fff",border:`1px solid ${C.border}`,borderLeft:`4px solid ${st.color}`,borderRadius:10,padding:"16px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:`1px dashed ${C.border}`}}>
              <span style={{fontSize:22}}>📜</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:15,color:C.dark}}>{c.consentTitle || c.consentType || "Consent Form"}</div>
                <div style={{fontSize:11,color:C.muted}}>
                  NABH {c.consentType || "—"} · Consent ID <span style={{fontFamily:"monospace",fontWeight:700,color:C.text}}>{c._id?.slice(-8).toUpperCase() || "—"}</span> · {ts ? fmtDT(ts) : "—"}
                </div>
              </div>
              <span style={{padding:"4px 11px",borderRadius:999,background:st.bg,color:st.color,fontWeight:800,fontSize:11}}>{st.label}</span>
              <button onClick={openConsent}
                title="Open consent in the standalone module to print or re-sign"
                style={{background:"#fff",border:`1px solid ${C.border}`,color:C.dark,borderRadius:6,padding:"5px 11px",fontWeight:700,fontSize:11,cursor:"pointer"}}>🖨 Print ↗</button>
            </div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",background:"#f8fafc",marginBottom:14,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px 18px"}}>
              {[
                ["UHID",              c.UHID || patient?.UHID],
                ["Patient Name",      c.patientName || patient?.fullName],
                ["Age / Gender",      `${c.age || patient?.age || "—"} / ${c.gender || patient?.gender || "—"}`],
                ["IPD / OPD No.",     c.ipdNo || admission?.admissionNumber],
                ["Ward / Bed",        wardBed],
                ["Date of Admission", admDate],
                ["Attending Doctor",  doctor],
                ["Department",        dept],
              ].map(([label, value], idx) => (
                <div key={idx}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".3px"}}>{label}</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginTop:2}}>{value || "—"}</div>
                </div>
              ))}
            </div>
            {c.procedureDescription && (
              <div style={{marginBottom:14,padding:"10px 14px",background:"#fafafa",border:`1px solid ${C.border}`,borderRadius:8,lineHeight:1.7,fontSize:13,fontFamily:"serif",whiteSpace:"pre-line"}}>{c.procedureDescription}</div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              {[
                {title:"Risks & Complications", icon:"⚠", color:C.red,   items:c.risksDisclosed || []},
                {title:"Benefits",               icon:"✓", color:C.green, items:c.benefitsExplained || []},
                {title:"Alternatives",           icon:"⇄", color:C.blue,  items:c.alternativesDisclosed || []},
              ].map((sec, ix) => (
                <div key={ix} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",background:"#fff"}}>
                  <div style={{fontWeight:800,fontSize:12,color:sec.color,marginBottom:8,letterSpacing:".2px"}}>
                    <span style={{marginRight:6}}>{sec.icon}</span>{sec.title}
                  </div>
                  {sec.items.length ? (
                    <ul style={{paddingLeft:18,margin:0}}>
                      {sec.items.map((x, j) => <li key={j} style={{fontSize:12,marginBottom:4,color:C.text,lineHeight:1.5}}>{x}</li>)}
                    </ul>
                  ) : (
                    <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>None recorded</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px 16px",marginBottom:14}}>
              <div>
                <div style={{fontSize:10,color:C.muted,fontWeight:700}}>CONSENT GIVEN BY</div>
                <div style={{fontSize:13,fontWeight:700}}>{c.consentGivenBy === "GUARDIAN" ? "Guardian / Legal Rep" : "Self (Patient)"}</div>
              </div>
              {c.consentGivenBy === "GUARDIAN" && (
                <>
                  <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>GUARDIAN NAME</div><div style={{fontSize:13,fontWeight:700}}>{c.guardianName || "—"}</div></div>
                  <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>RELATION</div><div style={{fontSize:13,fontWeight:700}}>{c.guardianRelation || "—"}</div></div>
                  <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>GUARDIAN CONTACT</div><div style={{fontSize:13,fontWeight:700}}>{c.guardianContact || "—"}</div></div>
                </>
              )}
              <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>LANGUAGE</div><div style={{fontSize:13,fontWeight:700}}>{c.languageUsed || "—"}</div></div>
              {c.interpreterRequired && (
                <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>INTERPRETER</div><div style={{fontSize:13,fontWeight:700}}>{c.interpreterName || "Required"}</div></div>
              )}
              {(c.witnessName || c.witnessRelation) && (
                <>
                  <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>WITNESS</div><div style={{fontSize:13,fontWeight:700}}>{c.witnessName || "—"}</div></div>
                  <div><div style={{fontSize:10,color:C.muted,fontWeight:700}}>WITNESS RELATION</div><div style={{fontSize:13,fontWeight:700}}>{c.witnessRelation || "—"}</div></div>
                </>
              )}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:8}}>
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",background:c.biometric?.hardwareVerified?C.tealL:"#fafafa"}}>
                <div style={{fontWeight:800,fontSize:12,color:c.biometric?.hardwareVerified?C.teal:C.muted,marginBottom:6}}>🔒 Patient / Consenter Biometric</div>
                {c.biometric ? (
                  <div style={{fontSize:11,lineHeight:1.6,color:C.text}}>
                    <div><b>Vendor:</b> {c.biometric.vendor || c.biometric.authenticatorName || "—"}</div>
                    <div><b>Hardware verified:</b> {c.biometric.hardwareVerified ? "✓ YES (TPM)" : "✗ Software"}</div>
                    {c.biometric.aaguid && <div><b>AAGUID:</b> <span style={{fontFamily:"monospace",fontSize:10}}>{String(c.biometric.aaguid).slice(0,18)}…</span></div>}
                    {c.biometric.capturedAt && <div><b>Captured:</b> {fmtDT(c.biometric.capturedAt)}</div>}
                  </div>
                ) : c.bypass ? (
                  <div style={{fontSize:11,color:C.amber}}>
                    <b>BYPASS:</b> {c.bypass.reason || "Captured on paper"} ({c.bypass.byName || "—"})
                  </div>
                ) : (
                  <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No biometric on file</div>
                )}
              </div>
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",background:c.staffSignature?"#f0fdf4":"#fafafa"}}>
                <div style={{fontWeight:800,fontSize:12,color:c.staffSignature?C.green:C.muted,marginBottom:6}}>✍ Staff e-Signature</div>
                {c.staffSignature || c.signedByName ? (
                  <div style={{fontSize:11,lineHeight:1.6,color:C.text}}>
                    <div><b>Name:</b> {c.staffSignature?.userName || c.signedByName || "—"}</div>
                    <div><b>Role:</b> {c.staffSignature?.userRole || c.signedByRole || "—"}</div>
                    {c.staffSignature?.employeeId && <div><b>Emp ID:</b> {c.staffSignature.employeeId}</div>}
                    {c.signedAt && <div><b>Signed at:</b> {fmtDT(c.signedAt)}</div>}
                  </div>
                ) : (
                  <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Not signed yet</div>
                )}
              </div>
            </div>
            {c.additionalNotes && (
              <div style={{marginTop:12,padding:"10px 12px",background:"#fffbeb",border:`1px solid ${C.amberB}`,borderRadius:8}}>
                <div style={{fontSize:11,fontWeight:800,color:C.amber,marginBottom:4}}>📝 Additional Notes</div>
                <div style={{fontSize:12,color:C.text,whiteSpace:"pre-line"}}>{c.additionalNotes}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════ MAIN */
function NursePatientPanelContent({ selectedAdmission }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [uhidInput,  setUhidInput]  = useState(searchParams.get("uhid")||"");
  const [activeTab,  setActiveTab]  = useState("overview");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [loaded,     setLoaded]     = useState(false);
  // Print / PDF / QR-share target
  const printAreaRef = useRef(null);

  const [patient,      setPatient]      = useState(null);
  const [admission,    setAdmission]    = useState(null);
  const [nursingNotes, setNursingNotes] = useState([]);
  const [doctorNotes,  setDoctorNotes]  = useState([]);
  const [billing,      setBilling]      = useState(null);
  const [vitalSheet,   setVitalSheet]   = useState([]);
  // R7hr-75 — Real saved-consent list for the Consent Forms tab (mirrors
  // DoctorPatientPanel). Replaces the bare launcher card so a nurse who
  // just witnessed a consent immediately sees it here.
  const [consents,     setConsents]     = useState([]);
  const [emergency,    setEmergency]    = useState([]);
  const [doctorOrders, setDoctorOrders] = useState([]);

  // Bed transfer handover state
  const [pendingTransfer,    setPendingTransfer]    = useState(null);
  const [showHandoverModal,  setShowHandoverModal]  = useState(false);
  const [handoverNotes,      setHandoverNotes]      = useState("");
  const [handoverSaving,     setHandoverSaving]     = useState(false);

  /* ── Activity logger — every nurse-side UI event lands in PatientActivityLog. */
  const audit = useBoundLogger(patient?.UHID || uhidInput, {
    module: "PatientPanel.Nurse",
    admissionId: admission?._id || null,
    ipdNo: admission?.admissionNumber || "",
  });

  const fetchPendingTransfer = useCallback(async (admId) => {
    if (!admId) return;
    try {
      const r = await axios.get(`${BASE}/bed-transfers?admissionId=${admId}&status=PendingHandover`);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      setPendingTransfer(list[0] || null);
    } catch { setPendingTransfer(null); }
  }, []);

  const fetchAll = useCallback(async (uhid) => {
    if (!uhid?.trim()) { setError("Please enter a UHID."); return; }
    const u = uhid.trim().toUpperCase();
    setLoading(true); setError(""); setLoaded(false);
    setPatient(null); setAdmission(null); setNursingNotes([]); setDoctorNotes([]);
    setBilling(null); setVitalSheet([]); setEmergency([]); setDoctorOrders([]);
    setConsents([]);
    setPendingTransfer(null);
    setActiveTab("overview");
    try {
      // Admission + patient
      const [admRes, patRes] = await Promise.all([
        axios.get(`${BASE}/admissions?uhid=${u}`).catch(()=>({data:[]})),
        axios.get(`${BASE}/patients?UHID=${u}`).catch(()=>({data:[]})),
      ]);
      const admList = Array.isArray(admRes.data?.admissions)?admRes.data.admissions:Array.isArray(admRes.data)?admRes.data:[];
      const patList = Array.isArray(patRes.data?.data)?patRes.data.data:Array.isArray(patRes.data)?patRes.data:[];
      const adm = admList.find(a=>["active","admitted"].includes((a.status||"").toLowerCase()))||admList[0]||null;
      // Only accept a patient whose UHID matches the searched UHID
      // (the /patients?UHID= endpoint may return unfiltered results)
      const pat = patList.find(p=>(p.UHID||p.uhid||"").toUpperCase()===u)||null;
      setAdmission(adm); setPatient(pat);

      if (!adm && !pat) { setError(`No patient found for UHID: ${u}`); return; }

      const ipdNo = adm?.admissionNumber;
      const patId = pat?._id||adm?.patientId;

      await Promise.all([
        // Nursing notes
        ipdNo ? axios.get(`${BASE}/nursing-notes/ipd/${ipdNo}`).catch(()=>
          axios.get(`${BASE}/nurse-notes/ipd/${ipdNo}`).catch(()=>({data:[]}))
        ).then(r=>{
          const l=r.data?.data||r.data?.notes||(Array.isArray(r.data)?r.data:[]);
          setNursingNotes(Array.isArray(l)?l.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)):[]);
        }).catch(()=>{}) : Promise.resolve(),

        // Doctor notes
        ipdNo ? axios.get(`${BASE}/doctor-notes/ipd/${ipdNo}`).then(r=>{
          const l=r.data?.data||r.data?.notes||(Array.isArray(r.data)?r.data:[]);
          setDoctorNotes(Array.isArray(l)?l.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)):[]);
        }).catch(()=>{}) : Promise.resolve(),

        // Billing
        axios.get(`${BASE}/billing/uhid/${u}`).then(r=>{
          const bills=Array.isArray(r.data?.data?.bills)?r.data.data.bills:Array.isArray(r.data?.bills)?r.data.bills:Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setBilling(bills[0]||null);
        }).catch(()=>{}),

        // Vital sheet
        axios.get(`${BASE}/vitalsheet`, {params:{uhid:u}}).then(r=>{
          const d=Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setVitalSheet(d);
        }).catch(()=>{}),

        // Emergency
        patId ? axios.get(`${BASE}/emergency/patient/${patId}`).catch(()=>
          axios.get(`${BASE}/emergency?UHID=${u}`).catch(()=>({data:[]}))
        ).then(r=>{
          const l=Array.isArray(r.data?.data)?r.data.data:Array.isArray(r.data)?r.data:[];
          setEmergency(l);
        }).catch(()=>{}) : Promise.resolve(),

        // Doctor orders
        axios.get(`${BASE}/doctor-orders?UHID=${u}`).then(r=>{
          const l=Array.isArray(r.data)?r.data:(r.data?.data||[]);
          setDoctorOrders(l);
        }).catch(()=>{}),

        // R7hr-75 — Consent forms (used by the Consent Forms tab list view).
        axios.get(`${BASE}/consent-forms/uhid/${u}`).then(r=>{
          const l=Array.isArray(r.data)?r.data:(r.data?.data||[]);
          setConsents(l.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)));
        }).catch(()=>{}),
      ]);

      setLoaded(true);

      // Fetch pending bed transfer for handover (after adm is set above)
      if (adm?._id) fetchPendingTransfer(adm._id);
    } catch(e) {
      setError("Failed to load patient data. Check UHID and try again.");
    } finally {
      setLoading(false);
    }
  }, [fetchPendingTransfer]);

  useEffect(()=>{
    const u = searchParams.get("uhid");
    if (u) { setUhidInput(u); fetchAll(u); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = () => fetchAll(uhidInput);

  /* ── Auto-load when patient selected from sidebar ── */
  useEffect(() => {
    if (!selectedAdmission) return;
    const u = (selectedAdmission.UHID || selectedAdmission.uhid || "").trim().toUpperCase();
    if (!u) return;
    setUhidInput(u);
    fetchAll(u);
  }, [selectedAdmission?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patName = patient?.fullName||patient?.patientName||admission?.patientName||"—";
  const uhidDisplay = patient?.UHID||patient?.uhid||admission?.UHID||uhidInput||"—";

  // R7gm — Shared launcher card for deep-linked modules (same UX as
  // DoctorPatientPanel). Pre-builds the URL with the current patient's
  // UHID so the destination page lands on the right patient. Opens in a
  // new tab so the nurse doesn't lose her place in the panel.
  const renderLauncher = (cfg) => {
    const uhid = patient?.UHID || patient?.uhid || admission?.UHID || uhidInput || "";
    const aid  = admission?._id || "";
    const url  = typeof cfg.url === "function" ? cfg.url({ uhid, admissionId: aid }) : cfg.url;
    const accent = cfg.color || C.primary;
    return (
      <div style={{ padding: 32, display:"flex", justifyContent:"center" }}>
        <div style={{
          background: "#fff",
          border: `2px solid ${accent}`,
          borderRadius: 16,
          padding: 36,
          maxWidth: 640,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 8px 28px rgba(15,23,42,.08)",
        }}>
          <div style={{ fontSize: 64, marginBottom: 12, lineHeight: 1 }}>{cfg.icon}</div>
          <h2 style={{ color: accent, margin: "0 0 8px", fontSize: 22 }}>{cfg.title}</h2>
          <p style={{ color: C.muted, margin: "0 0 24px", lineHeight: 1.55 }}>{cfg.description}</p>
          {cfg.nabh && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18, letterSpacing: ".5px" }}>
              {cfg.nabh}
            </div>
          )}
          <button
            onClick={() => {
              try { audit?.nav?.(`launch.${cfg.id}`, { admissionId: aid, area: cfg.title }); } catch {}
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            disabled={!uhid && cfg.requiresPatient !== false}
            style={{
              background: !uhid && cfg.requiresPatient !== false ? "#cbd5e1" : accent,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 15,
              fontWeight: 600,
              cursor: !uhid && cfg.requiresPatient !== false ? "not-allowed" : "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            }}
            title={!uhid && cfg.requiresPatient !== false ? "Load a patient first" : "Opens in a new tab"}
          >
            {cfg.cta || "Open Module ↗"}
          </button>
          {cfg.note && (
            <div style={{ marginTop: 18, fontSize: 12, color: C.muted, fontStyle: "italic" }}>
              {cfg.note}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Tab dispatch
  const renderTab = (id) => {
    switch (id) {
      case "overview":   return <OverviewTab patient={patient} admission={admission} nursingNotes={nursingNotes} billing={billing} doctorNotes={doctorNotes}/>;
      case "initial":    return <InitialAssessmentTab doctorNotes={doctorNotes} nursingNotes={nursingNotes} admission={admission}/>;
      case "mlc":        return <MLCOrDoctorNotesTab patient={patient} doctorNotes={doctorNotes} admission={admission}/>;
      case "nursing":    return <NursingNotesExpandedTab nursingNotes={nursingNotes} admission={admission}/>;
      case "vitals":     return <VitalChartTab nursingNotes={nursingNotes} vitalSheet={vitalSheet}/>;
      case "io":         return <IntakeOutputChartTab nursingNotes={nursingNotes}/>;
      case "blood":      return <BloodTransfusionRecordsTab nursingNotes={nursingNotes}/>;
      case "rbs":        return <RBSMonitoringTab nursingNotes={nursingNotes} doctorOrders={doctorOrders}/>;
      case "handover":   return <HandoverNotesTab patient={patient} admission={admission} doctorNotes={doctorNotes} nursingNotes={nursingNotes}/>;
      // R7gx-UI — Treatment Chart (MAR) via shared component, nurse-mode on.
      case "treatment":  return <TreatmentChart UHID={patient?.UHID} admissionId={admission?._id} patientName={patient?.fullName || patient?.name} nurseMode={true} />;
      case "orders":     return <DoctorOrdersTab doctorNotes={doctorNotes}/>;
      // R7gx-UI — "meds" tab removed.
      case "medrecon":   return <MedReconciliationTab admission={admission} patient={patient}/>;
      case "billing":    return <BillingTab billing={billing}/>;
      case "emergency":  return <EmergencyTab emergency={emergency}/>;

      // R7gm — Deep-link tabs. Nurse role can VIEW + initiate (e.g. raise
      // consent, view discharge summary, fill ICU bundle daily checklist).
      // Backend gating decides what writes are allowed.
      // R7hr-75 — Real saved-consent list (mirrors doctor panel) so a nurse
      // who just witnessed a consent immediately sees it here.
      case "consent":    return <ConsentFormsTab consents={consents} uhid={patient?.UHID || activeUhid} patient={patient} admission={admission}/>;
      case "icubundles": return renderLauncher({
        id: "icubundles", icon: "🛡", color: "#0ea5e9",
        title: "Bundles of Care — ICU",
        description: "Daily VAP / CLABSI / CAUTI / DVT prophylaxis bundle compliance checklist with auto-emit to Infection Control (HIC.5) register.",
        nabh: "NABH HIC.5 · ICU Care Bundles",
        url: ({ uhid }) => `/icu-bundles?uhid=${encodeURIComponent(uhid)}`,
        cta: "Open ICU Bundles ↗",
        note: "Nurse can chart daily compliance; doctor signs off.",
      });
      case "discharge":  return renderLauncher({
        id: "discharge", icon: "🚪", color: "#dc2626",
        title: "Discharge Summary",
        description: "View / print the discharge summary built by the treating doctor. Nurse cannot finalise but can read and print after sign-off.",
        nabh: "NABH AAC.7 · COP-7 · Discharge Documentation",
        url: ({ uhid }) => `/discharge-summary?uhid=${encodeURIComponent(uhid)}`,
        cta: "Open Discharge Summary ↗",
      });
      case "medcerts":   return renderLauncher({
        id: "medcerts", icon: "📑", color: "#7c3aed",
        title: "Medical Certificates",
        description: "Fitness, sickness, MTP, disability, death certificates. Nurse can view; doctor issues + signs.",
        nabh: "NABH PRE.5 / Legal documentation",
        url: ({ uhid }) => `/medical-certificates?uhid=${encodeURIComponent(uhid)}`,
        cta: "Open Certificates ↗",
      });
      case "patientfile":return renderLauncher({
        id: "patientfile", icon: "📁", color: "#0f172a",
        title: "Complete Patient File",
        description: "Chronological full file — every assessment, doctor + nursing note, vitals, I/O, transfusion, RBS, treatment chart, billing audit — printable.",
        nabh: "NABH MOM (Medico-legal) · Complete File View",
        url: ({ uhid }) => `/patient-file/${encodeURIComponent(uhid)}`,
        cta: "Open Complete File ↗",
      });

      default:           return null;
    }
  };

  // R7hr-73 — surface a count for every nurse-panel tab we can cheaply
  // compute from already-loaded state. Empty tabs (count===0) are dimmed
  // by the shell so the nurse can tell at a glance which sections have
  // data. Fixes the stale "docnotes" key (no such tab id) → use "mlc".
  // Launcher tabs (consent / icubundles / discharge / medcerts / patientfile)
  // intentionally have no count.
  const _initialCount = doctorNotes.filter((n) => n.noteType === "initial" || n.noteType === "initialAssessment").length
                      + nursingNotes.filter((n) => n.noteType === "initial" || n.noteType === "initialAssessment").length;
  const _handoverCount = doctorNotes.filter((n) => n.noteType === "handover").length
                       + nursingNotes.filter((n) => ["handover","discharge","sbar"].includes(n.noteType)).length;
  const _allOrders = doctorNotes.flatMap((n) => n.orders || []);
  const _pendingOrderCount = _allOrders.filter((o) => !o.nurseStatus || o.nurseStatus === "pending").length;
  const _treatmentCount = (doctorOrders || []).filter((o) =>
    ["Medication","IV_Fluid","Infusion","Procedure","Diet"].includes(o.orderType)
  ).length;
  const _billingCount = billing?.items?.length || (Number(billing?.totalAmount) > 0 ? 1 : 0);

  const tabCounts = {
    initial:   _initialCount,
    consent:   consents.length, // R7hr-75
    mlc:       doctorNotes.length,
    nursing:   nursingNotes.length,
    vitals:    vitalSheet.length,
    handover:  _handoverCount,
    treatment: _treatmentCount,
    orders:    _pendingOrderCount,
    billing:   _billingCount,
    emergency: emergency.length,
  };

  // Quick actions row under the search header
  const quickActions = admission ? [
    { label: "❤️ Record Vitals", onClick: () => navigate("/nursing-notes") },
    { label: "📝 Nursing Notes", onClick: () => navigate("/nursing-notes") },
    { label: "💊 MAR",           onClick: () => navigate("/mar") },
  ] : [];

  // Gate banners: handover-pending (if any) + initial assessment gate
  const gateBanners = (
    <>
      {pendingTransfer && (
        <div className="pf-gate pf-gate--warning">
          <div className="pf-gate__icon">🔄</div>
          <div className="pf-gate__body">
            <div className="pf-gate__title">
              <span className="pf-gate__tag">Action Required</span>
              Bed Transfer Handover Pending — Write Handover Notes to Complete
            </div>
            <div className="pf-gate__msg">
              Patient is being transferred from{" "}
              <strong>{pendingTransfer.fromBedNumber || pendingTransfer.fromBed || "current bed"}</strong> →{" "}
              <strong>{pendingTransfer.toBedNumber || pendingTransfer.toBed || "new bed"}</strong>
              {pendingTransfer.toWardName && <> · Ward: <strong>{pendingTransfer.toWardName}</strong></>}
              {pendingTransfer.shiftingNotes && (
                <div style={{ marginTop: 4, fontStyle: "italic", opacity: .85 }}>
                  Doctor note: "{pendingTransfer.shiftingNotes.substring(0, 120)}{pendingTransfer.shiftingNotes.length > 120 ? "…" : ""}"
                </div>
              )}
            </div>
            <button
              className="pf-gate__btn"
              onClick={() => {
                audit.click("handover.open", {
                  summary: `Nurse opened handover modal for transfer ${pendingTransfer.transferNo || pendingTransfer._id}`,
                  sourceModel: "BedTransfer", sourceId: pendingTransfer._id,
                });
                setHandoverNotes("");
                setShowHandoverModal(true);
              }}
            >
              ✍️ Write Handover Notes
            </button>
          </div>
        </div>
      )}
      {admission && admission.initialAssessment?.nurseCompleted !== true ? (
        <div className="pf-gate pf-gate--danger">
          <div className="pf-gate__icon">🔒</div>
          <div className="pf-gate__body">
            <div className="pf-gate__title">
              <span className="pf-gate__tag">Mandatory</span>
              Nursing Initial Assessment not completed — NABH COP.2
            </div>
            <div className="pf-gate__msg">
              All nursing documentation is locked until the Initial Assessment is completed.
              This is required by NABH standards before any care can be documented.
            </div>
            <button className="pf-gate__btn" onClick={() => navigate(`/nursing-notes?uhid=${uhidDisplay}`)}>
              📋 Write Initial Assessment
            </button>
          </div>
        </div>
      ) : admission ? (
        <div className="pf-gate pf-gate--ok">
          <div className="pf-gate__body">
            <div className="pf-gate__title">✅ Nursing Initial Assessment completed — all modules unlocked</div>
          </div>
        </div>
      ) : null}
    </>
  );

  // Handover modal — kept in this file because the submit handler closes over
  // local state (admission, uhidDisplay) and refreshes admission after success.
  const handoverModal = showHandoverModal && pendingTransfer && (
    <div className="pf-modal-backdrop" onClick={() => !handoverSaving && setShowHandoverModal(false)}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pf-modal__head" style={{ background: "linear-gradient(135deg,#ea580c,#f97316)" }}>
          <div>
            <div className="pf-modal__title">✍️ Nursing Handover Notes</div>
            <div className="pf-modal__sub">Transfer #{pendingTransfer.transferNo || pendingTransfer._id?.slice(-6)}</div>
          </div>
          <button
            className="pf-modal__close"
            onClick={() => { audit.click("handover.close-x", { summary: "Nurse closed handover modal via ✕" }); setShowHandoverModal(false); }}
            aria-label="close"
          >✕</button>
        </div>

        <div className="pf-modal__body">
          {/* Transfer details */}
          <div className="pf-info-box">
            <div style={{ fontWeight: 700, color: "#9a3412", marginBottom: 6 }}>Transfer Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", color: "#7c2d12" }}>
              <div>From bed: <strong>{pendingTransfer.fromBedNumber || pendingTransfer.fromBed || "—"}</strong></div>
              <div>To bed: <strong>{pendingTransfer.toBedNumber || pendingTransfer.toBed || "—"}</strong></div>
              {pendingTransfer.toWardName && <div>Ward: <strong>{pendingTransfer.toWardName}</strong></div>}
              {pendingTransfer.reason && <div>Reason: <strong>{pendingTransfer.reason}</strong></div>}
            </div>
            {pendingTransfer.shiftingNotes && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #fed7aa" }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Doctor's Shifting Notes:</div>
                <div style={{ fontStyle: "italic" }}>{pendingTransfer.shiftingNotes}</div>
              </div>
            )}
          </div>

          {/* Handover textarea */}
          <div>
            <label className="pf-flabel pf-flabel--required">Handover Notes * (Required to complete transfer)</label>
            <textarea
              className={`pf-textarea ${handoverNotes.trim() ? "" : "pf-textarea--invalid"}`}
              value={handoverNotes}
              onChange={(e) => setHandoverNotes(e.target.value)}
              placeholder="Document patient condition at handover, ongoing treatments, pending orders, any concerns, IV access, monitoring parameters..."
            />
            {!handoverNotes.trim() && (
              <div className="pf-fhint pf-fhint--error">⚠️ Handover notes are mandatory. The bed transfer will not be completed without this.</div>
            )}
          </div>

          <div className="pf-info-box pf-info-box--blue">
            <strong>ℹ️ On completion:</strong> Patient will be officially moved to the new bed,
            bed records will be updated, and the transfer will be marked complete.
          </div>
        </div>

        <div className="pf-modal__foot">
          <button
            className="pf-action pf-action--quiet"
            disabled={handoverSaving}
            onClick={() => {
              audit.cancel("handover.cancel-button", { summary: "Nurse pressed Cancel on handover modal" });
              setShowHandoverModal(false);
              setHandoverNotes("");
            }}
          >
            Cancel
          </button>
          <button
            className="pf-action"
            style={{ background: handoverNotes.trim() ? "#f97316" : "#e2e8f0", color: handoverNotes.trim() ? "#fff" : "#94a3b8" }}
            disabled={!handoverNotes.trim() || handoverSaving}
            onClick={async () => {
              if (!handoverNotes.trim()) {
                audit.click("handover.submit-blocked", { summary: "Submit blocked — handover notes empty" });
                return;
              }
              audit.submit("handover.submit", {
                summary: `Nurse submitting handover for transfer ${pendingTransfer.transferNo || pendingTransfer._id}`,
                sourceModel: "BedTransfer", sourceId: pendingTransfer._id,
                after: { handoverNotes: handoverNotes.trim().slice(0, 200) },
              });
              setHandoverSaving(true);
              try {
                await axios.put(`${BASE}/bed-transfers/${pendingTransfer._id}/handover`, {
                  handoverNotes: handoverNotes.trim(),
                  handoverBy: "Nurse",
                });
                setPendingTransfer(null);
                setShowHandoverModal(false);
                setHandoverNotes("");
                // Refresh admission so the new bed appears in the strip immediately.
                if (admission?._id) {
                  const r = await axios.get(`${BASE}/admissions?uhid=${uhidDisplay}`).catch(() => ({ data: [] }));
                  const admList = Array.isArray(r.data?.admissions) ? r.data.admissions : Array.isArray(r.data) ? r.data : [];
                  const adm = admList.find((a) => ["active", "admitted"].includes((a.status || "").toLowerCase())) || admList[0] || null;
                  if (adm) setAdmission(adm);
                }
                alert("✅ Handover complete! Bed transfer has been finalised.");
              } catch (e) {
                alert("Failed to submit handover notes: " + (e.response?.data?.message || e.message));
              } finally {
                setHandoverSaving(false);
              }
            }}
          >
            {handoverSaving ? "Submitting…" : "✅ Complete Handover"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <PatientPanelShell
      role="nurse"
      title="Nursing Patient Panel"
      subtitle="Full Patient File — Nursing Staff"
      icon="👩‍⚕️"
      searchValue={uhidInput}
      onSearchChange={setUhidInput}
      onSearchSubmit={handleLoad}
      searchPlaceholder="Enter UHID…"
      loading={loading}
      error={error}
      loaded={loaded}
      patient={patient}
      admission={admission}
      printRef={printAreaRef}
      quickActions={quickActions}
      surgicalChecklistEligible={(doctorOrders || []).some(
        (o) => (o.orderType || "").toLowerCase().includes("procedure")
            && !["Completed","Cancelled","Stopped"].includes(o.status)
      )}
      gateBanners={gateBanners}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabCounts={tabCounts}
      renderTab={renderTab}
      modals={handoverModal}
      emptyIcon="🔍"
      emptyTitle="Search for a Patient"
      emptyMsg='Enter a UHID in the search bar above and click "Load Patient" to view the full patient file.'
    />
  );
}

/* ── Layout wrapper with admitted patient sidebar ── */
export default function NursePatientPanel() {
  const [sel, setSel] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSel} selectedId={sel?._id} pageType="nurse-panel">
      <NursePatientPanelContent selectedAdmission={sel} />
    </ClinicalLayout>
  );
}
