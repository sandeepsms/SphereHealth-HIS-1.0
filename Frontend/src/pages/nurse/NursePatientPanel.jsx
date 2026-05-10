/**
 * NursePatientPanel.jsx  —  Full patient file for nursing staff.
 * Teal/green theme (matches NursingNotes page). Tabs: Overview | Vital Trends | Nursing Notes |
 *   Doctor Orders | Medications | Billing | Emergency
 */
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

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

const TABS = [
  { id:"overview", label:"📋 Overview"       },
  { id:"vitals",   label:"📈 Vital Trends"   },
  { id:"nursing",  label:"📝 Nursing Notes"  },
  { id:"orders",   label:"🩺 Doctor Orders"  },
  { id:"meds",     label:"💊 Medications"    },
  { id:"billing",  label:"💰 Billing"        },
  { id:"emergency",label:"🚨 Emergency"      },
];

/* ── Helpers ── */
const fmtDT   = d => { try { return d ? new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—"; } catch { return "—"; }};
const fmtDate = d => { try { return d ? new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—"; } catch { return "—"; }};
const fmtCur  = n => `₹${(Number(n)||0).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
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

/* ── Abnormal checkers ── */
const RANGES = {sbp:{lo:90,hi:140},dbp:{lo:60,hi:90},pulse:{lo:60,hi:100},temp:{lo:97,hi:99.5},spo2:{lo:95,hi:100},rr:{lo:12,hi:20},bsl:{lo:70,hi:140}};
const isAbn = (key,val) => { const n=Number(val); if(isNaN(n)||!val) return false; const r=RANGES[key]; return r?(n<r.lo||n>r.hi):false; };

/* ══════════════════════════════════════════════════ TAB: OVERVIEW */
function OverviewTab({patient,admission,nursingNotes=[],billing,doctorNotes=[]}) {
  // Latest vitals from nursing notes
  const latestVN = nursingNotes.find(n=>n.vitals && (n.vitals.bp||n.vitals.pulse||n.vitals.temp));
  const lv = latestVN?.vitals||{};
  const todayOrders = doctorNotes.flatMap(n=>n.orders||[]).filter(o=>!o.nurseStatus||o.nurseStatus==="pending");

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Allergy alert */}
      {patient?.knownAllergies && !["NKDA","None","—"].includes(patient.knownAllergies) && (
        <div style={{padding:"12px 18px",background:C.redL,border:`2px solid ${C.red}`,borderRadius:10,fontWeight:700,fontSize:13,color:C.red,display:"flex",gap:10,alignItems:"center"}}>
          ⚠️ ALLERGIES: {patient.knownAllergies}
        </div>
      )}

      {/* Stats row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:14}}>
        {[
          {label:"Nursing Notes",  val:nursingNotes.length,          icon:"📝",  color:C.primary, bg:C.primaryL},
          {label:"Pending Orders", val:todayOrders.length,           icon:"⏳",  color:C.amber,   bg:C.amberL},
          {label:"Doctor Notes",   val:doctorNotes.length,           icon:"🩺",  color:C.purple,  bg:C.purpleL},
          {label:"Balance Due",    val:billing?fmtCur(billing.balanceAmount):"—", icon:"💰", color:C.green, bg:C.greenL},
        ].map(s=>(
          <div key={s.label} style={{background:s.bg,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 18px",display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontSize:26}}>{s.icon}</span>
            <div>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,letterSpacing:".3px"}}>{s.label}</div>
              <div style={{fontSize:20,fontWeight:800,color:s.color}}>{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Patient + Admission cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <Card title="👤 Patient Demographics">
          <InfoRow label="Full Name"     value={`${patient?.title||""} ${patient?.fullName||patient?.patientName||""}`.trim()}/>
          <InfoRow label="UHID"          value={patient?.UHID||patient?.uhid}/>
          <InfoRow label="Age / Gender"  value={`${patient?.age||"—"} yrs / ${patient?.gender||"—"}`}/>
          <InfoRow label="Blood Group"   value={patient?.bloodGroup}/>
          <InfoRow label="Contact"       value={patient?.contactNumber||patient?.phone}/>
          <InfoRow label="Payment Type"  value={patient?.paymentType}/>
        </Card>
        <Card title="🏥 Admission">
          <InfoRow label="Admission No." value={admission?.admissionNumber}/>
          <InfoRow label="Type"          value={admission?.admissionType}/>
          <InfoRow label="Doctor"        value={admission?.attendingDoctor}/>
          <InfoRow label="Department"    value={admission?.department}/>
          <InfoRow label="Bed / Ward"    value={admission?.bedNumber||admission?.ward}/>
          <InfoRow label="Admitted"      value={fmtDate(admission?.admissionDate)}/>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
            <span style={{fontSize:13,color:C.muted,minWidth:130}}>Status</span>
            <SBadge status={admission?.status}/>
          </div>
        </Card>
      </div>

      {/* Latest vitals */}
      {latestVN && (
        <Card title={`💓 Latest Vitals — ${fmtDT(latestVN.createdAt)}`}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <VCard label="BP"    value={bpStr(lv.bp)}               color={C.red}/>
            {lv.pulse && <VCard label="Pulse" value={lv.pulse}  unit=" bpm" color={isAbn("pulse",lv.pulse)?C.red:C.green}/>}
            {lv.temp  && <VCard label="Temp"  value={lv.temp}   unit="°F"   color={isAbn("temp",lv.temp)?C.red:C.green}/>}
            {lv.spo2  && <VCard label="SpO₂" value={lv.spo2}   unit="%"    color={isAbn("spo2",lv.spo2)?C.red:C.green}/>}
            {lv.rr    && <VCard label="RR"    value={lv.rr}     unit="/min" color={isAbn("rr",lv.rr)?C.red:C.green}/>}
            {lv.bsl   && <VCard label="BSL"   value={lv.bsl}   unit=" mg/dL" color={C.amber}/>}
            {lv.gcs   && <VCard label="GCS"   value={String(lv.gcs)} color={C.blue}/>}
          </div>
          {latestVN.nurseName && <div style={{marginTop:8,fontSize:11,color:C.muted}}>Recorded by: {latestVN.nurseName}</div>}
        </Card>
      )}

      {/* Pending orders quick view */}
      {todayOrders.length>0 && (
        <Card title={`⏳ Pending Doctor Orders (${todayOrders.length})`} titleColor={C.amber} titleBg={C.amberL}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {todayOrders.slice(0,5).map((o,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:"#f8fafc",borderRadius:8,border:`1px solid ${C.border}`}}>
                <span style={{fontSize:16}}>{o.type==="medication"?"💊":o.type==="iv_fluid"?"💧":"📋"}</span>
                <span style={{flex:1,fontSize:13,color:C.text}}>{o.instruction||"—"}</span>
                {o.route && <Badge color={C.teal} bg={C.tealL}>{o.route}</Badge>}
                {o.frequency && <Badge color={C.muted} bg="#f1f5f9">{o.frequency}</Badge>}
              </div>
            ))}
            {todayOrders.length>5 && <div style={{fontSize:12,color:C.muted,textAlign:"center"}}>+{todayOrders.length-5} more orders</div>}
          </div>
        </Card>
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

function NursingNotesTab({notes=[]}) {
  const [expanded,  setExpanded]  = useState({});
  const [filterType,setFilterType]= useState("All");
  const toggle = id => setExpanded(p=>({...p,[id]:!p[id]}));

  const sortedNotes = [...notes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const types = ["All",...new Set(sortedNotes.map(n=>n.noteType||"general").filter(Boolean))];
  const filtered = filterType==="All"?sortedNotes:sortedNotes.filter(n=>(n.noteType||"general")===filterType);

  if (!notes.length) return <Empty icon="📝" msg="No nursing notes recorded yet for this patient"/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Summary count */}
      <div style={{display:"flex",gap:8,padding:"10px 14px",background:C.primaryL,borderRadius:10,border:`1px solid ${C.rose200}`,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:700,color:C.primaryD}}>📝 {notes.length} Nursing Notes</span>
        <span style={{fontSize:11,color:C.muted}}>across {types.length-1} categories</span>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {types.map(t=>{
          const nc = NOTE_CFG[t]||{};
          return (
            <button key={t} onClick={()=>setFilterType(t)}
              style={{padding:"4px 12px",borderRadius:20,border:`1.5px solid ${filterType===t?(nc.dot||C.primary):C.border}`,background:filterType===t?(nc.dot||C.primary):"white",color:filterType===t?"white":C.muted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              {nc.icon&&t!=="All"?<span>{nc.icon}</span>:null}
              {t==="All"?"All":nc.label||t}
              {t!=="All"&&<span style={{fontSize:10,opacity:.8}}>({sortedNotes.filter(n=>(n.noteType||"general")===t).length})</span>}
            </button>
          );
        })}
        <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{filtered.length} shown</span>
      </div>

      {/* Notes list */}
      {filtered.map((note,i)=>{
        const id    = note._id||i;
        const open  = expanded[id];
        const nt    = note.noteType||"general";
        const nc    = NOTE_CFG[nt]||{icon:"📝",label:nt,color:C.primary,bg:C.primaryL,dot:C.rose200};
        const md    = note.moduleData||{};
        // Extract vitals from multiple sources
        const vRaw  = md.vitals || {};
        const daRaw = md.dailyAssessment||{};
        const vData = {
          bp: vRaw.bp || (daRaw.bp_sys&&daRaw.bp_dia?{systolic:daRaw.bp_sys,diastolic:daRaw.bp_dia}:null),
          pulse: vRaw.pulse||daRaw.pulse, temp: vRaw.temp||daRaw.temp,
          spo2: vRaw.spo2||daRaw.spo2, rr: vRaw.rr||daRaw.rr,
          bsl: vRaw.bsl||daRaw.bsl, gcs: vRaw.gcs||daRaw.gcs,
        };
        const hasVitals = vData.bp||vData.pulse||vData.temp||vData.spo2;
        const mews = md.mewsScore;
        const mewsTotal = mews?.total;

        return (
          <div key={id} style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${nc.dot}`,borderRadius:12,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
            {/* ── Clickable header ── */}
            <div onClick={()=>toggle(id)} style={{padding:"11px 16px",background:nc.bg,borderBottom:open?`1px solid ${C.border}`:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,userSelect:"none"}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:18}}>{nc.icon}</span>
                <span style={{fontSize:12,fontWeight:800,color:nc.color}}>{nc.label||nt}</span>
                <SBadge status={note.status}/>
                {note.isCriticalEvent && <Badge color={C.red} bg={C.redL}>⚠ Critical</Badge>}
                {note.shift && <Badge color={C.muted} bg="#f1f5f9">{note.shift} Shift</Badge>}
                {note.tags?.length>0 && note.tags.slice(0,2).map(t=><Badge key={t} color={nc.color} bg="white">{t}</Badge>)}
                {mewsTotal!=null && <Badge color={mewsTotal>=5?C.red:mewsTotal>=3?C.amber:C.green} bg="white">MEWS {mewsTotal}</Badge>}
                {note.nurseName && <span style={{fontSize:11,color:nc.color,fontWeight:600}}>👩‍⚕️ {note.nurseName}</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                <span style={{fontSize:11,color:C.muted}}>{fmtDT(note.createdAt||note.submittedAt)}</span>
                <span style={{fontSize:14,color:nc.color,fontWeight:700,minWidth:16,textAlign:"center"}}>{open?"▲":"▼"}</span>
              </div>
            </div>

            {/* ── Vitals quick-strip (always visible) ── */}
            {hasVitals && <VitalsStrip v={vData}/>}

            {/* ── Expanded body ── */}
            {open && (
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <NoteModuleBody note={note}/>
              </div>
            )}
          </div>
        );
      })}
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
  const thS={padding:"7px 12px",textAlign:"left",fontWeight:700,color:C.primaryD,borderBottom:`2px solid ${C.rose200}`,fontSize:10,textTransform:"uppercase"};
  const tdS={padding:"8px 12px",borderBottom:`1px solid ${C.border}`,fontSize:12};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{background:`linear-gradient(135deg,${C.primaryD},${C.primary})`,borderRadius:14,padding:"20px 26px",color:"#fff",display:"flex",flexWrap:"wrap",gap:20,justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:11,opacity:.8,marginBottom:3}}>Bill #{billing.billNumber||"—"}</div><div style={{fontSize:18,fontWeight:800}}><SBadge status={billing.billStatus}/></div></div>
        {[{l:"Total",v:fmtCur(billing.netAmount)},{l:"Advance",v:fmtCur(billing.advancePaid)},{l:"Balance",v:fmtCur(billing.balanceAmount)}].map(s=>(
          <div key={s.l} style={{textAlign:"center"}}><div style={{fontSize:10,opacity:.8,marginBottom:3}}>{s.l}</div><div style={{fontSize:20,fontWeight:800}}>{s.v}</div></div>
        ))}
      </div>
      {(billing.billItems||[]).length>0 && (
        <Card title="🧾 Services" titleBg={C.primaryL} titleColor={C.primaryD}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:C.primaryL}}>{["Service","Category","Amount"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>
                {billing.billItems.map((item,i)=>(
                  <tr key={i} style={{background:i%2?C.primaryL:C.card}}>
                    <td style={{...tdS,fontWeight:600}}>{item.serviceName||"—"}</td>
                    <td style={tdS}><Badge color={C.primary} bg={C.primaryL}>{item.category||"—"}</Badge></td>
                    <td style={{...tdS,fontWeight:700,color:C.primary}}>{fmtCur(item.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {(billing.payments||[]).length>0 && (
        <Card title="💳 Payments" titleBg={C.primaryL} titleColor={C.primaryD}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:C.primaryL}}>{["Date","Mode","Amount","Reference"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>
                {billing.payments.map((p,i)=>(
                  <tr key={i} style={{background:i%2?C.primaryL:C.card}}>
                    <td style={tdS}>{fmtDT(p.paidAt||p.date)}</td>
                    <td style={tdS}>{p.mode||p.paymentMode||"—"}</td>
                    <td style={{...tdS,fontWeight:700,color:C.green}}>{fmtCur(p.amount)}</td>
                    <td style={{...tdS,color:C.muted}}>{p.reference||p.receiptNumber||"—"}</td>
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

/* ══════════════════════════════════════════════════ MAIN */
function NursePatientPanelContent({ selectedAdmission }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [uhidInput,  setUhidInput]  = useState(searchParams.get("uhid")||"");
  const [activeTab,  setActiveTab]  = useState("overview");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [loaded,     setLoaded]     = useState(false);

  const [patient,      setPatient]      = useState(null);
  const [admission,    setAdmission]    = useState(null);
  const [nursingNotes, setNursingNotes] = useState([]);
  const [doctorNotes,  setDoctorNotes]  = useState([]);
  const [billing,      setBilling]      = useState(null);
  const [vitalSheet,   setVitalSheet]   = useState([]);
  const [emergency,    setEmergency]    = useState([]);
  const [doctorOrders, setDoctorOrders] = useState([]);

  // Bed transfer handover state
  const [pendingTransfer,    setPendingTransfer]    = useState(null);
  const [showHandoverModal,  setShowHandoverModal]  = useState(false);
  const [handoverNotes,      setHandoverNotes]      = useState("");
  const [handoverSaving,     setHandoverSaving]     = useState(false);

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
      const pat = patList[0]||null;
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

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans','Inter',sans-serif"}}>
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,${C.primaryD},${C.primary})`,padding:"16px 24px",color:"white",boxShadow:"0 2px 8px rgba(15,118,110,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:24}}>👩‍⚕️</span>
            <div>
              <div style={{fontSize:18,fontWeight:700,letterSpacing:"-.3px"}}>Nursing Patient Panel</div>
              <div style={{fontSize:12,opacity:.8}}>Full Patient File — Nursing Staff</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginLeft:"auto",alignItems:"center"}}>
            <input value={uhidInput} onChange={e=>setUhidInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLoad()}
              placeholder="Enter UHID…"
              style={{width:200,padding:"10px 14px",borderRadius:9,border:"1.5px solid rgba(255,255,255,.4)",background:"rgba(255,255,255,.15)",color:"white",fontSize:14,outline:"none",fontFamily:"inherit"}}
            />
            <button onClick={handleLoad} disabled={loading}
              style={{padding:"10px 20px",borderRadius:9,border:"none",background:"white",color:C.primary,fontWeight:700,fontSize:13,cursor:loading?"not-allowed":"pointer",opacity:loading?.7:1}}>
              {loading?"Loading…":"Load Patient"}
            </button>
          </div>
        </div>
        {/* Quick actions */}
        {loaded && admission && (
          <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
            {[
              {label:"❤️ Record Vitals",  path:"/nursing-notes"},
              {label:"📝 Nursing Notes",  path:"/nursing-notes"},
              {label:"💊 MAR",            path:"/mar"},
            ].map(a=>(
              <button key={a.label} onClick={()=>navigate(a.path)}
                style={{padding:"6px 14px",borderRadius:7,border:"1.5px solid rgba(255,255,255,.5)",background:"rgba(255,255,255,.12)",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{maxWidth:1280,margin:"0 auto",padding:"20px 24px"}}>
        {error && <div style={{background:C.redL,border:`1px solid ${C.redB}`,borderRadius:10,padding:"12px 16px",color:C.red,fontSize:13,marginBottom:16}}>⚠️ {error}</div>}
        {loading && <Spin/>}

        {/* Empty state */}
        {!loading && !loaded && !error && (
          <Card style={{textAlign:"center",padding:"60px 24px"}}>
            <div style={{fontSize:64,marginBottom:16}}>🔍</div>
            <div style={{fontSize:18,fontWeight:700,color:C.primaryD,marginBottom:8}}>Search for a Patient</div>
            <p style={{fontSize:14,color:C.muted,maxWidth:400,margin:"0 auto"}}>Enter a UHID in the search bar above and click "Load Patient" to view the full patient file.</p>
          </Card>
        )}

        {/* Loaded */}
        {!loading && loaded && (
          <>
            {/* Patient banner */}
            <div style={{background:`linear-gradient(135deg,${C.primaryL},${C.rose50})`,border:`1px solid ${C.rose200}`,borderRadius:14,padding:"16px 22px",marginBottom:16,display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
              <div style={{width:52,height:52,borderRadius:"50%",background:C.primary,color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,flexShrink:0}}>
                {patName.charAt(0).toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:180}}>
                <div style={{fontSize:19,fontWeight:700,color:C.primaryD}}>{patient?.title?`${patient.title} `:""}{patName}</div>
                <div style={{fontSize:13,color:C.muted,marginTop:2}}>
                  UHID: <strong>{uhidDisplay}</strong>
                  {patient?.age && <> · {patient.age} yrs</>}
                  {patient?.gender && <> · {patient.gender}</>}
                  {patient?.bloodGroup && <> · 🩸 {patient.bloodGroup}</>}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {admission?.admissionNumber && <Badge color={C.primaryD} bg={C.primaryL}>IPD: {admission.admissionNumber}</Badge>}
                <SBadge status={admission?.status}/>
                {admission?.department && <Badge color={C.muted} bg="#f1f5f9">{admission.department}</Badge>}
              </div>
            </div>

            {/* ── HANDOVER REQUIRED banner (shown before assessment gate) ── */}
            {pendingTransfer && (
              <div style={{background:"#fff7ed",border:"2px solid #f97316",borderRadius:12,padding:"16px 20px",marginBottom:16,display:"flex",alignItems:"flex-start",gap:14}}>
                <div style={{width:44,height:44,borderRadius:"50%",background:"#f97316",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:22}}>🔄</span>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14,color:"#9a3412",marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{background:"#f97316",color:"white",borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:.5}}>ACTION REQUIRED</span>
                    Bed Transfer Handover Pending — Write Handover Notes to Complete
                  </div>
                  <div style={{fontSize:13,color:"#7c2d12",marginBottom:10}}>
                    Patient is being transferred from{" "}
                    <strong>{pendingTransfer.fromBedNumber || pendingTransfer.fromBed || "current bed"}</strong> →{" "}
                    <strong>{pendingTransfer.toBedNumber || pendingTransfer.toBed || "new bed"}</strong>
                    {pendingTransfer.toWardName && <> · Ward: <strong>{pendingTransfer.toWardName}</strong></>}
                    {pendingTransfer.shiftingNotes && (
                      <div style={{marginTop:4,fontStyle:"italic",opacity:.85}}>Doctor note: "{pendingTransfer.shiftingNotes.substring(0,120)}{pendingTransfer.shiftingNotes.length>120?"…":""}"</div>
                    )}
                  </div>
                  <button onClick={()=>{ setHandoverNotes(""); setShowHandoverModal(true); }}
                    style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#f97316",color:"white",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    ✍️ Write Handover Notes
                  </button>
                </div>
              </div>
            )}

            {/* ── Mandatory Initial Assessment gate ── */}
            {admission && admission.initialAssessment?.nurseCompleted !== true ? (
              <div style={{background:"#fef2f2",border:"2px solid #fca5a5",borderRadius:12,padding:"16px 20px",marginBottom:16,display:"flex",alignItems:"flex-start",gap:14}}>
                <div style={{width:44,height:44,borderRadius:"50%",background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <i className="pi pi-lock" style={{fontSize:20,color:"#dc2626"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14,color:"#991b1b",marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{background:"#dc2626",color:"white",borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:.5}}>MANDATORY</span>
                    Nursing Initial Assessment not completed — NABH COP.2
                  </div>
                  <div style={{fontSize:13,color:"#7f1d1d",marginBottom:10}}>All nursing documentation is locked until the Initial Assessment is completed. This is required by NABH standards before any care can be documented.</div>
                  <button onClick={()=>navigate(`/nursing-notes?uhid=${uhidDisplay}`)}
                    style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#dc2626",color:"white",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    📋 Write Initial Assessment
                  </button>
                </div>
              </div>
            ) : (
              <div style={{background:"#dcfce7",border:"1.5px solid #86efac",borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10,fontSize:13}}>
                <i className="pi pi-check-circle" style={{color:"#16a34a",fontSize:16}}/>
                <span style={{color:"#14532d",fontWeight:600}}>Nursing Initial Assessment completed — all modules unlocked.</span>
              </div>
            )}

            {/* Tab bar */}
            <div style={{display:"flex",borderBottom:`2px solid ${C.rose100}`,marginBottom:20,overflowX:"auto",gap:0}}>
              {TABS.map(tab=>{
                const isActive = activeTab===tab.id;
                return (
                  <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
                    style={{padding:"12px 18px",fontSize:13,fontWeight:isActive?700:500,color:isActive?C.primary:C.muted,background:isActive?C.primaryL:"transparent",border:"none",borderBottom:isActive?`3px solid ${C.primary}`:"3px solid transparent",cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s",borderRadius:"6px 6px 0 0",fontFamily:"inherit"}}>
                    {tab.label}
                    {tab.id==="nursing"   && nursingNotes.length>0 && <span style={{marginLeft:5,fontSize:10,background:C.rose200,color:C.primaryD,borderRadius:10,padding:"0 6px",fontWeight:700}}>{nursingNotes.length}</span>}
                    {tab.id==="orders"    && (() => { const p=doctorNotes.flatMap(n=>n.orders||[]).filter(o=>!o.nurseStatus||o.nurseStatus==="pending").length; return p>0?<span style={{marginLeft:5,fontSize:10,background:C.amberL,color:C.amber,borderRadius:10,padding:"0 6px",fontWeight:700}}>{p}</span>:null; })()}
                    {tab.id==="emergency" && emergency.length>0 && <span style={{marginLeft:5,fontSize:10,background:C.redL,color:C.red,borderRadius:10,padding:"0 6px",fontWeight:700}}>{emergency.length}</span>}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            {activeTab==="overview"  && <OverviewTab patient={patient} admission={admission} nursingNotes={nursingNotes} billing={billing} doctorNotes={doctorNotes}/>}
            {activeTab==="vitals"    && <VitalTrendsTab vitalSheet={vitalSheet}/>}
            {activeTab==="nursing"   && <NursingNotesTab notes={nursingNotes}/>}
            {activeTab==="orders"    && <DoctorOrdersTab doctorNotes={doctorNotes}/>}
            {activeTab==="meds"      && <MedicationsTab doctorNotes={doctorNotes} doctorOrders={doctorOrders}/>}
            {activeTab==="billing"   && <BillingTab billing={billing}/>}
            {activeTab==="emergency" && <EmergencyTab emergency={emergency}/>}
          </>
        )}
      </div>

      {/* ── Handover Notes Modal ── */}
      {showHandoverModal && pendingTransfer && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"white",borderRadius:16,width:"100%",maxWidth:560,boxShadow:"0 20px 60px rgba(0,0,0,.25)",overflow:"hidden"}}>
            {/* Modal header */}
            <div style={{background:"linear-gradient(135deg,#ea580c,#f97316)",padding:"18px 24px",color:"white"}}>
              <div style={{fontSize:17,fontWeight:800,marginBottom:2}}>✍️ Nursing Handover Notes</div>
              <div style={{fontSize:12,opacity:.85}}>Transfer #{pendingTransfer.transferNo || pendingTransfer._id?.slice(-6)}</div>
            </div>

            <div style={{padding:"20px 24px"}}>
              {/* Transfer info */}
              <div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13}}>
                <div style={{fontWeight:700,color:"#9a3412",marginBottom:6}}>Transfer Details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px",color:"#7c2d12"}}>
                  <div>From bed: <strong>{pendingTransfer.fromBedNumber || pendingTransfer.fromBed || "—"}</strong></div>
                  <div>To bed: <strong>{pendingTransfer.toBedNumber || pendingTransfer.toBed || "—"}</strong></div>
                  {pendingTransfer.toWardName && <div>Ward: <strong>{pendingTransfer.toWardName}</strong></div>}
                  {pendingTransfer.reason && <div>Reason: <strong>{pendingTransfer.reason}</strong></div>}
                </div>
                {pendingTransfer.shiftingNotes && (
                  <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #fed7aa"}}>
                    <div style={{fontWeight:600,marginBottom:2}}>Doctor's Shifting Notes:</div>
                    <div style={{fontStyle:"italic"}}>{pendingTransfer.shiftingNotes}</div>
                  </div>
                )}
              </div>

              {/* Handover notes textarea */}
              <div style={{marginBottom:16}}>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#1e293b",marginBottom:6}}>
                  Handover Notes <span style={{color:"#dc2626"}}>*</span>
                  <span style={{fontWeight:400,color:"#64748b",marginLeft:6,fontSize:12}}>(Required to complete transfer)</span>
                </label>
                <textarea
                  value={handoverNotes}
                  onChange={e=>setHandoverNotes(e.target.value)}
                  rows={5}
                  placeholder="Document patient condition at handover, ongoing treatments, pending orders, any concerns, IV access, monitoring parameters..."
                  style={{width:"100%",padding:"10px 14px",borderRadius:9,border:`2px solid ${handoverNotes.trim() ? "#86efac" : "#fca5a5"}`,fontSize:13,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box",transition:"border-color .15s"}}
                />
                {!handoverNotes.trim() && (
                  <div style={{fontSize:12,color:"#dc2626",marginTop:4}}>⚠️ Handover notes are mandatory. The bed transfer will not be completed without this.</div>
                )}
              </div>

              {/* Info box */}
              <div style={{background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:9,padding:"10px 14px",fontSize:12,color:"#1d4ed8",marginBottom:20}}>
                <strong>ℹ️ On completion:</strong> Patient will be officially moved to the new bed, bed records will be updated, and the transfer will be marked complete.
              </div>

              {/* Action buttons */}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>{ setShowHandoverModal(false); setHandoverNotes(""); }}
                  disabled={handoverSaving}
                  style={{padding:"10px 20px",borderRadius:9,border:"1.5px solid #e2e8f0",background:"white",color:"#64748b",fontWeight:600,fontSize:13,cursor:"pointer"}}>
                  Cancel
                </button>
                <button
                  disabled={!handoverNotes.trim() || handoverSaving}
                  onClick={async () => {
                    if (!handoverNotes.trim()) return;
                    setHandoverSaving(true);
                    try {
                      await axios.put(`${BASE}/bed-transfers/${pendingTransfer._id}/handover`, {
                        handoverNotes: handoverNotes.trim(),
                        handoverBy: "Nurse",
                      });
                      setPendingTransfer(null);
                      setShowHandoverModal(false);
                      setHandoverNotes("");
                      // Refresh admission data to reflect new bed
                      if (admission?._id) {
                        const r = await axios.get(`${BASE}/admissions?uhid=${uhidDisplay}`).catch(()=>({data:[]}));
                        const admList = Array.isArray(r.data?.admissions)?r.data.admissions:Array.isArray(r.data)?r.data:[];
                        const adm = admList.find(a=>["active","admitted"].includes((a.status||"").toLowerCase()))||admList[0]||null;
                        if (adm) setAdmission(adm);
                      }
                      alert("✅ Handover complete! Bed transfer has been finalised.");
                    } catch(e) {
                      alert("Failed to submit handover notes: " + (e.response?.data?.message || e.message));
                    } finally {
                      setHandoverSaving(false);
                    }
                  }}
                  style={{padding:"10px 22px",borderRadius:9,border:"none",background: handoverNotes.trim() ? "#f97316" : "#e2e8f0",color: handoverNotes.trim() ? "white" : "#94a3b8",fontWeight:700,fontSize:13,cursor: handoverNotes.trim() && !handoverSaving ? "pointer" : "not-allowed",transition:"all .15s"}}>
                  {handoverSaving ? "Submitting…" : "✅ Complete Handover"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
