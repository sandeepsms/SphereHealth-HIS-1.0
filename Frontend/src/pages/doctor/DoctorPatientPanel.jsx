/**
 * DoctorPatientPanel.jsx  —  Full 360° patient file for doctors.
 * Purple/indigo theme. Tabs: Overview | Clinical Notes | Nursing Records |
 *   Vital Trends | Medications & Orders | Billing | Emergency
 */
import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";

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

const TABS = [
  { id:"overview",  label:"📋 Overview"        },
  { id:"clinical",  label:"🩺 Clinical Notes"  },
  { id:"nursing",   label:"📝 Nursing Records" },
  { id:"vitals",    label:"📈 Vital Trends"    },
  { id:"meds",      label:"💊 Medications"     },
  { id:"orders",    label:"📋 Orders"          },
  { id:"billing",   label:"💰 Billing"         },
  { id:"emergency", label:"🚨 Emergency"       },
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

function ClinicalNotesTab({notes=[]}) {
  const [expanded, setExpanded] = useState({});
  const toggle = id => setExpanded(p=>({...p,[id]:!p[id]}));
  const [filterType, setFilterType] = useState("All");

  const types = ["All",...new Set(notes.map(n=>n.noteType||"daily").filter(Boolean))];
  const filtered = filterType==="All" ? notes : notes.filter(n=>(n.noteType||"daily")===filterType);

  if (!notes.length) return <Empty icon="🩺" msg="No clinical notes recorded yet"/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Filter bar */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {types.map(t=>(
          <button key={t} onClick={()=>setFilterType(t)}
            style={{padding:"5px 14px",borderRadius:20,border:`1.5px solid ${filterType===t?C.primary:C.border}`,
              background:filterType===t?C.primary:"white",color:filterType===t?"white":C.muted,
              cursor:"pointer",fontSize:12,fontWeight:600}}>
            {t}
          </button>
        ))}
        <span style={{marginLeft:"auto",fontSize:12,color:C.muted,alignSelf:"center"}}>{filtered.length} note{filtered.length!==1?"s":""}</span>
      </div>

      {filtered.map((note,i)=>{
        const id = note._id||i;
        const open = expanded[id];
        const nc = NOTE_COLOR[note.noteType]||NOTE_COLOR.daily;
        const isSigned = note.status==="signed";
        const v = note.vitals;

        return (
          <div key={id} style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${nc.dot}`,borderRadius:12,overflow:"hidden"}}>
            {/* Header — always visible, clickable to expand */}
            <div onClick={()=>toggle(id)} style={{padding:"12px 18px",background:nc.bg,borderBottom:open?`1px solid ${C.border}`:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:700,padding:"2px 10px",borderRadius:999,background:nc.dot+"44",color:nc.color}}>{note.noteType||"note"}</span>
                <SBadge status={note.status}/>
                {(note.isCritical||note.isCriticalEvent) && <Badge color={C.red} bg={C.redL}>⚠ Critical</Badge>}
                {note.shift && <Badge color={C.muted} bg="#f1f5f9">{note.shift}</Badge>}
                {note.doctorName && <span style={{fontSize:12,color:nc.color,fontWeight:600}}>Dr. {note.doctorName}</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                <span style={{fontSize:11,color:C.muted}}>{fmtDT(note.createdAt)}</span>
                <span style={{fontSize:12,color:nc.color,fontWeight:700}}>{open?"▲":"▼"}</span>
              </div>
            </div>

            {/* Vitals strip — always visible if present */}
            {v && Object.values(v).some(x=>x) && (
              <div style={{padding:"8px 18px",background:"#eff6ff",borderBottom:`1px solid #bfdbfe`,display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:800,textTransform:"uppercase",color:C.blue,letterSpacing:".5px"}}>Vitals</span>
                {[
                  {l:"BP",   val:bpStr(v.bp)},
                  {l:"Pulse",val:v.pulse?`${v.pulse}/min`:null},
                  {l:"Temp", val:v.temp?`${v.temp}°F`:null},
                  {l:"SpO₂",val:v.spo2?`${v.spo2}%`:null},
                  {l:"RR",   val:v.rr?`${v.rr}/min`:null},
                  {l:"BSL",  val:v.bsl?`${v.bsl}mg/dL`:null},
                  {l:"GCS",  val:v.gcs?String(v.gcs):null},
                  {l:"Urine",val:v.urine?`${v.urine}mL/hr`:null},
                ].filter(f=>f.val).map(f=>(
                  <Chip key={f.l} label={f.l} value={f.val} color={C.blue}/>
                ))}
              </div>
            )}

            {/* Expanded body */}
            {open && (
              <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:10}}>
                {/* SOAP */}
                {[
                  {label:"S — Subjective", val:note.soap?.subjective, color:"#1e40af", bg:"#eff6ff"},
                  {label:"O — Objective",  val:note.soap?.objective,  color:"#0f766e", bg:"#f0fdfa"},
                  {label:"A — Assessment", val:note.soap?.assessment||(note.provisionalDiagnosis&&`Provisional: ${note.provisionalDiagnosis}`), color:"#9a3412", bg:"#fff7ed"},
                  {label:"P — Plan",       val:note.soap?.plan,       color:"#166534", bg:"#f0fdf4"},
                ].filter(s=>s.val).map((s,j)=>(
                  <div key={j} style={{padding:"10px 14px",borderRadius:8,background:s.bg,borderLeft:`3px solid ${s.color}`}}>
                    <div style={{fontSize:10,fontWeight:700,color:s.color,marginBottom:4,letterSpacing:".3px"}}>{s.label}</div>
                    <div style={{fontSize:13,color:C.dark,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{s.val}</div>
                  </div>
                ))}

                {/* Diagnosis */}
                {(note.provisionalDiagnosis||note.finalDiagnosis) && !note.soap?.assessment && (
                  <div style={{padding:"10px 14px",borderRadius:8,background:"#fdf4ff",border:`1.5px solid #e9d5ff`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.primary,marginBottom:5}}>🏷️ DIAGNOSIS</div>
                    {note.provisionalDiagnosis && <div style={{fontSize:13,color:C.dark,marginBottom:2}}><b>Provisional:</b> {note.provisionalDiagnosis}</div>}
                    {note.finalDiagnosis && <div style={{fontSize:13,color:C.dark}}><b>Final:</b> {note.finalDiagnosis}</div>}
                  </div>
                )}

                {/* Investigations */}
                {note.investigations?.length > 0 && (
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.muted}}>Investigations:</span>
                    {note.investigations.map((inv,ii)=>(
                      <span key={ii} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.primaryL,color:C.primary,border:`1px solid ${C.primaryM}`}}>{inv}</span>
                    ))}
                  </div>
                )}

                {/* Orders */}
                {note.orders?.length > 0 && (
                  <div style={{padding:"8px 12px",background:"#f8fafc",borderRadius:8,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8}}>Orders ({note.orders.length})</div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {note.orders.map((o,oi)=>(
                        <div key={oi} style={{display:"flex",gap:8,alignItems:"center",fontSize:12}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:C.primary,flexShrink:0}}/>
                          <span style={{flex:1,color:C.text}}>{o.instruction||o.type}</span>
                          {o.dose     && <Badge color={C.blue}  bg={C.blueL}>{o.dose}</Badge>}
                          {o.route    && <Badge color={C.teal}  bg={C.tealL}>{o.route}</Badge>}
                          {o.frequency&& <Badge color={C.muted} bg="#f1f5f9">{o.frequency}</Badge>}
                          <SBadge status={o.nurseStatus||"pending"}/>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {note.tags?.length > 0 && (
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {note.tags.map(t=><span key={t} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:C.greenL,color:C.green,border:`1px solid ${C.greenB}`}}>{t}</span>)}
                  </div>
                )}

                {/* Note details generic */}
                {note.noteDetails && typeof note.noteDetails==="object" && !Array.isArray(note.noteDetails) && (
                  <div style={{padding:"10px 14px",background:C.primaryL,borderRadius:8}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.primary,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>
                      {(note.noteType||"note").toUpperCase()} DETAILS
                    </div>
                    <div style={{display:"flex",gap:"6px 16px",flexWrap:"wrap"}}>
                      {Object.entries(note.noteDetails)
                        .filter(([k])=>!["medicationOrders","infusionOrders","bp_sys","bp_dia"].includes(k))
                        .filter(([,v])=>v!==null&&v!==undefined&&v!==""&&v!==false)
                        .slice(0,20)
                        .map(([k,v])=>{
                          const fv = typeof v==="boolean"?"✓":Array.isArray(v)?v.slice(0,2).join(", "):typeof v==="object"&&v!==null?JSON.stringify(v).slice(0,40):String(v).slice(0,60);
                          const lbl = k.replace(/([A-Z])/g," $1").trim();
                          return (
                            <div key={k} style={{display:"flex",flexDirection:"column",gap:1}}>
                              <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.muted}}>{lbl}</span>
                              <span style={{fontSize:11,fontWeight:500,color:C.dark}}>{fv}</span>
                            </div>
                          );
                        })
                      }
                    </div>
                    {/* Medication orders */}
                    {note.noteDetails.medicationOrders?.length>0 && (
                      <div style={{marginTop:10,padding:"6px 10px",background:"white",borderRadius:6,border:`1px solid ${C.blueB}`}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.blue,textTransform:"uppercase",marginBottom:5}}>MEDICATIONS ({note.noteDetails.medicationOrders.length})</div>
                        {note.noteDetails.medicationOrders.map((m,mi)=>(
                          <div key={mi} style={{fontSize:11,color:C.text,marginBottom:3}}>
                            <b>{m.drug||"—"}</b>{m.dose?` ${m.dose}`:""}{m.route?` · ${m.route}`:""}{m.frequency?` · ${m.frequency}`:""}
                            {m.status && <span style={{marginLeft:8,fontSize:10,color:m.status==="Active"?C.green:C.muted}}>({m.status})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Remarks */}
                {note.remarks && <div style={{fontSize:13,color:C.muted,fontStyle:"italic",borderTop:`1px solid ${C.border}`,paddingTop:8,marginTop:4}}>Remarks: {note.remarks}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ TAB: NURSING RECORDS */
function NursingRecordsTab({notes=[]}) {
  const [expanded, setExpanded] = useState({});
  const toggle = id => setExpanded(p=>({...p,[id]:!p[id]}));

  if (!notes.length) return <Empty icon="📝" msg="No nursing records found"/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {notes.map((note,i)=>{
        const id = note._id||i;
        const open = expanded[id];
        const v = note.vitals||{};

        return (
          <div key={id} style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${C.pink}`,borderRadius:12,overflow:"hidden"}}>
            <div onClick={()=>toggle(id)} style={{padding:"11px 16px",background:C.pinkL,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:999,background:`${C.pink}22`,color:C.pink}}>{note.noteType||"nursing"}</span>
                <SBadge status={note.status}/>
                {note.isCriticalEvent && <Badge color={C.red} bg={C.redL}>⚠ Critical</Badge>}
                {note.shift && <Badge color={C.muted} bg="#f1f5f9">{note.shift}</Badge>}
                {note.nurseName && <span style={{fontSize:12,color:C.pink,fontWeight:600}}>{note.nurseName}</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                <span style={{fontSize:11,color:C.muted}}>{fmtDT(note.createdAt)}</span>
                <span style={{fontSize:12,color:C.pink,fontWeight:700}}>{open?"▲":"▼"}</span>
              </div>
            </div>

            {/* Vitals strip */}
            {v.bp && (
              <div style={{padding:"7px 16px",background:"#fdf2f8",borderBottom:`1px solid ${C.pinkL}`,display:"flex",gap:14,flexWrap:"wrap"}}>
                {[
                  {l:"BP",   val:bpStr(v.bp)},
                  {l:"Pulse",val:v.pulse?`${v.pulse}/min`:null},
                  {l:"Temp", val:v.temp?`${v.temp}°F`:null},
                  {l:"SpO₂",val:v.spo2?`${v.spo2}%`:null},
                ].filter(f=>f.val).map(f=><Chip key={f.l} label={f.l} value={f.val} color={C.pink}/>)}
              </div>
            )}

            {open && (
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
                {note.remarks && <div style={{fontSize:13,color:C.text,lineHeight:1.7}}>{note.remarks}</div>}
                {note.generalCondition && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:C.muted}}>Condition:</span>
                    {Object.entries(note.generalCondition).filter(([,v])=>v).map(([k])=>(
                      <Badge key={k} color={C.green} bg={C.greenL}>{k}</Badge>
                    ))}
                  </div>
                )}
                {note.ordersExecuted?.length>0 && (
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:6}}>Orders Executed ({note.ordersExecuted.length})</div>
                    {note.ordersExecuted.map((o,oi)=>(
                      <div key={oi} style={{display:"flex",gap:8,alignItems:"center",fontSize:12,marginBottom:4}}>
                        <span style={{fontSize:14}}>{o.status==="done"?"✅":o.status==="skipped"?"⏭️":"⚡"}</span>
                        <span style={{flex:1}}>{o.instruction}</span>
                        <SBadge status={o.status}/>
                      </div>
                    ))}
                  </div>
                )}
                {note.nursingCare && Object.values(note.nursingCare).some(v=>v) && (
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:C.muted}}>Care done:</span>
                    {Object.entries(note.nursingCare).filter(([,v])=>v===true).map(([k])=>(
                      <Badge key={k} color={C.green} bg={C.greenL}>{k.replace(/([A-Z])/g," $1").trim()}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
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

/* ═══════════════════════════════════════════════════════ TAB: ORDERS TIMELINE */
function OrdersTab({doctorNotes=[]}) {
  // Collect all orders from doctor notes
  const allOrders = [];
  doctorNotes.forEach(note=>{
    (note.orders||[]).forEach(o=>{
      allOrders.push({...o, noteDate:note.createdAt, doctorName:note.doctorName, noteType:note.noteType});
    });
  });
  allOrders.sort((a,b)=>new Date(b.noteDate)-new Date(a.noteDate));

  if (!allOrders.length) return <Empty icon="📋" msg="No doctor orders found in notes"/>;

  const pending = allOrders.filter(o=>!o.nurseStatus||o.nurseStatus==="pending");
  const done    = allOrders.filter(o=>o.nurseStatus==="done"||o.nurseStatus==="partial");

  const statColor = s => s==="done"?"#059669":s==="partial"?"#d97706":s==="skipped"?"#94a3b8":C.amber;

  const OrderGroup = ({title,orders,color}) => orders.length===0?null:(
    <Card title={title} titleColor={color}>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {orders.map((o,i)=>(
          <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:`1px solid ${C.border}`}}>
            <div style={{width:36,height:36,borderRadius:8,background:o.nurseStatus==="done"?C.greenL:C.amberL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
              {o.type==="medication"?"💊":o.type==="iv_fluid"?"💧":o.type==="procedure"?"🔧":o.type==="diet"?"🍽️":"📋"}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.dark}}>{o.instruction||"—"}</div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                {o.dose      && <Badge color={C.teal}   bg={C.tealL}>{o.dose}</Badge>}
                {o.route     && <Badge color={C.blue}   bg={C.blueL}>{o.route}</Badge>}
                {o.frequency && <Badge color={C.muted}  bg="#f1f5f9">{o.frequency}</Badge>}
                {o.duration  && <Badge color={C.muted}  bg="#f1f5f9">{o.duration}</Badge>}
                {o.priority  && o.priority!=="ROUTINE" && <Badge color={C.red} bg={C.redL}>{o.priority}</Badge>}
              </div>
              {o.notes && <div style={{fontSize:11,color:C.muted,marginTop:4}}>{o.notes}</div>}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:700,color:statColor(o.nurseStatus),marginBottom:4}}>{(o.nurseStatus||"PENDING").toUpperCase()}</div>
              <div style={{fontSize:10,color:C.muted}}>{fmtDate(o.noteDate)}</div>
              {o.doctorName && <div style={{fontSize:10,color:C.muted}}>Dr. {o.doctorName}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <OrderGroup title={`⏳ Pending Orders (${pending.length})`} orders={pending} color={C.amber}/>
      <OrderGroup title={`✅ Completed Orders (${done.length})`}  orders={done}    color={C.green}/>
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
export default function DoctorPatientPanel() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState(searchParams.get("uhid")||"");
  const [activeUhid,  setActiveUhid]  = useState(searchParams.get("uhid")||"");
  const [activeTab,   setActiveTab]   = useState("overview");

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
      const pat = patList[0]||null;
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
    const u = searchParams.get("uhid");
    if (u) { setSearchInput(u); setActiveUhid(u); loadAll(u); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = () => {
    const u = searchInput.trim().toUpperCase();
    if (!u) return;
    setActiveUhid(u);
    loadAll(u);
  };

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

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter','DM Sans',sans-serif"}}>
      {/* ── Header */}
      <div style={{background:`linear-gradient(135deg,${C.primaryD},${C.primary})`,padding:"16px 28px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap",boxShadow:"0 4px 20px rgba(124,58,237,.35)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flex:"0 0 auto"}}>
          <span style={{fontSize:26}}>🩺</span>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:17,letterSpacing:"-.2px"}}>Doctor Patient Panel</div>
            <div style={{color:"#c4b5fd",fontSize:11}}>Full patient file — clinical, vitals & audit</div>
          </div>
        </div>
        <div style={{flex:1,display:"flex",gap:10,maxWidth:480,marginLeft:"auto"}}>
          <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLoad()}
            placeholder="Enter UHID (e.g. UH-00001)"
            style={{flex:1,padding:"10px 16px",borderRadius:10,border:"2px solid rgba(255,255,255,.3)",background:"rgba(255,255,255,.12)",color:"#fff",fontSize:14,outline:"none",fontFamily:"inherit",letterSpacing:".5px"}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,.7)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,.3)"}
          />
          <button onClick={handleLoad} disabled={loading}
            style={{padding:"10px 22px",borderRadius:10,border:"none",background:loading?"rgba(255,255,255,.3)":"#fff",color:loading?"#fff":C.primary,fontWeight:700,fontSize:14,cursor:loading?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
            {loading?"Loading…":"Load Patient"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && <div style={{margin:"16px 28px 0",padding:"12px 16px",background:C.redL,border:`1px solid ${C.redB}`,borderRadius:10,color:C.red,fontSize:13}}> ⚠️ {error}</div>}

      {loading && <Spin/>}

      {!loading && loaded && (
        <>
          {/* Patient strip */}
          <div style={{margin:"16px 28px 0",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 22px",display:"flex",gap:18,alignItems:"center",flexWrap:"wrap",boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
            <div style={{width:50,height:50,borderRadius:"50%",background:C.primaryM,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>👤</div>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontWeight:800,fontSize:18,color:C.dark}}>{patient?.title?`${patient.title} `:""}{patient?.fullName||admission?.patientName||"—"}</div>
              <div style={{fontSize:13,color:C.muted,marginTop:2}}>
                UHID: <strong style={{color:C.primary}}>{activeUhid}</strong>
                {patient?.age && <span style={{marginLeft:10}}>{patient.age} yrs</span>}
                {patient?.gender && <span style={{marginLeft:8}}>· {patient.gender}</span>}
                {patient?.bloodGroup && <span style={{marginLeft:10}}>🩸 {patient.bloodGroup}</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {admission?.admissionNumber && <Badge color={C.blue} bg={C.blueL}>IPD: {admission.admissionNumber}</Badge>}
              <SBadge status={admission?.status||"Active"}/>
              {admission?.department && <span style={{fontSize:12,color:C.muted}}>{admission.department}</span>}
            </div>
          </div>

          {/* Assessment gate banner */}
          {admission && !admission.initialAssessment?.doctorCompleted && (
            <div style={{margin:"10px 28px 0",padding:"14px 20px",background:"#fef2f2",border:"2px solid #fca5a5",borderRadius:12,display:"flex",alignItems:"center",gap:14,boxShadow:"0 4px 16px rgba(220,38,38,.1)"}}>
              <div style={{width:42,height:42,borderRadius:10,background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:20}}>🔒</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:14,color:"#991b1b",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{background:"#dc2626",color:"white",fontSize:9,fontWeight:900,padding:"2px 7px",borderRadius:4,letterSpacing:".5px"}}>MANDATORY</span>
                  Initial Assessment not recorded — NABH COP.2
                </div>
                <div style={{fontSize:12,color:"#b91c1c",marginTop:3}}>Doctor's Initial Assessment must be completed before writing daily notes, ICU notes, or any other documentation for this patient.</div>
              </div>
              <button onClick={()=>navigate(`/doctor-notes?uhid=${activeUhid}`)}
                style={{padding:"9px 20px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0,boxShadow:"0 4px 12px rgba(220,38,38,.3)"}}>
                Write Now
              </button>
            </div>
          )}
          {admission && admission.initialAssessment?.doctorCompleted && (
            <div style={{margin:"10px 28px 0",padding:"10px 18px",background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:10,display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#15803d",fontWeight:600}}>
              ✅ Initial Assessment completed — full documentation unlocked
            </div>
          )}

          {/* Tab bar */}
          <div style={{margin:"16px 28px 0",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
            <div style={{display:"flex",overflowX:"auto",borderBottom:`2px solid ${C.border}`,background:"#fafaf9"}}>
              {TABS.map(tab=>{
                const isActive = activeTab===tab.id;
                return (
                  <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
                    style={{padding:"14px 18px",border:"none",background:"transparent",cursor:"pointer",fontSize:13,fontWeight:isActive?700:500,color:isActive?C.primary:C.muted,borderBottom:isActive?`3px solid ${C.primary}`:"3px solid transparent",marginBottom:-2,whiteSpace:"nowrap",transition:"all .15s"}}>
                    {tab.label}
                    {tab.id==="clinical"   && doctorNotes.length>0  && <span style={{marginLeft:5,fontSize:10,background:C.primaryM,color:C.primary,borderRadius:10,padding:"0 6px",fontWeight:700}}>{doctorNotes.length}</span>}
                    {tab.id==="nursing"    && nursingNotes.length>0  && <span style={{marginLeft:5,fontSize:10,background:"#fdf2f8",color:C.pink,borderRadius:10,padding:"0 6px",fontWeight:700}}>{nursingNotes.length}</span>}
                    {tab.id==="emergency"  && emergency.length>0     && <span style={{marginLeft:5,fontSize:10,background:C.redL,color:C.red,borderRadius:10,padding:"0 6px",fontWeight:700}}>{emergency.length}</span>}
                  </button>
                );
              })}
            </div>
            <div style={{padding:"22px 22px",minHeight:200}}>
              {activeTab==="overview"   && <OverviewTab patient={patient} admission={admission} opdVisits={opdVisits} billing={billing} doctorNotes={doctorNotes} nursingNotes={nursingNotes} onShiftBed={openShiftModal} pendingTransfer={pendingTransfer} onCancelTransfer={cancelTransfer}/>}
              {activeTab==="clinical"   && <ClinicalNotesTab notes={doctorNotes}/>}
              {activeTab==="nursing"    && <NursingRecordsTab notes={nursingNotes}/>}
              {activeTab==="vitals"     && <VitalTrendsTab vitalSheet={vitalSheet}/>}
              {activeTab==="meds"       && <MedicationsTab doctorNotes={doctorNotes} doctorOrders={doctorOrders}/>}
              {activeTab==="orders"     && <OrdersTab doctorNotes={doctorNotes}/>}
              {activeTab==="billing"    && <BillingTab billing={billing}/>}
              {activeTab==="emergency"  && <EmergencyTab emergency={emergency}/>}
            </div>
          </div>
          <div style={{height:40}}/>
        </>
      )}

      {/* Empty state */}
      {!loading && !loaded && !error && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 24px",color:C.muted}}>
          <div style={{width:80,height:80,borderRadius:"50%",background:C.primaryM,display:"flex",alignItems:"center",justifyContent:"center",fontSize:40,marginBottom:20}}>🩺</div>
          <div style={{fontSize:20,fontWeight:700,color:C.primaryD,marginBottom:8}}>Enter a Patient UHID</div>
          <div style={{fontSize:14,maxWidth:360,textAlign:"center",lineHeight:1.7}}>Type a UHID in the search bar and click <strong>Load Patient</strong> to view the complete patient file — clinical notes, vitals, billing, and more.</div>
        </div>
      )}

      {/* ── Shift Bed Modal ── */}
      {showShiftModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={()=>!shiftSaving&&setShowShiftModal(false)}>
          <div style={{background:"white",borderRadius:16,width:580,maxWidth:"96vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}
            onClick={e=>e.stopPropagation()}>

            {/* Modal header */}
            <div style={{padding:"16px 22px",background:`linear-gradient(135deg,${C.primaryD},${C.primary})`,color:"white",borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:800,fontSize:16}}>🔄 Shift Patient Bed</div>
                <div style={{fontSize:11,opacity:.8,marginTop:2}}>Doctor must add shifting notes · Nurse will write handover notes to complete</div>
              </div>
              <button onClick={()=>setShowShiftModal(false)} style={{background:"rgba(255,255,255,.2)",border:"none",color:"white",width:30,height:30,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            <div style={{padding:"20px 22px",display:"flex",flexDirection:"column",gap:16}}>
              {/* Current bed info */}
              <div style={{padding:"10px 14px",background:C.primaryL,borderRadius:8,fontSize:12,color:C.primary,fontWeight:600}}>
                📍 Current Bed: <strong>{admission?.bedNumber||"Not assigned"}</strong>
                {(admission?.wardName||admission?.ward) && <span> — {admission.wardName||admission.ward}</span>}
              </div>

              {/* Select new bed */}
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".6px",marginBottom:6}}>
                  Select New Bed <span style={{color:C.red}}>*</span>
                </label>
                {bedsLoading ? (
                  <div style={{padding:"12px",color:C.muted,fontSize:13}}>Loading available beds…</div>
                ) : availableBeds.length === 0 ? (
                  <div style={{padding:"12px",color:C.red,fontSize:13,background:C.redL,borderRadius:8}}>⚠ No available beds found. All beds are occupied or reserved.</div>
                ) : (
                  <select value={shiftForm.toBedId} onChange={e=>setShiftForm(f=>({...f,toBedId:e.target.value}))}
                    style={{width:"100%",padding:"9px 12px",border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:13,outline:"none",background:"white",cursor:"pointer"}}>
                    <option value="">— Select available bed —</option>
                    {availableBeds.map(b=>(
                      <option key={b._id} value={b._id}>
                        {b.bedNumber} — {b.wardName||b.ward?.name||""} {b.roomNumber?`(Room ${b.roomNumber})`:""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Reason */}
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".6px",marginBottom:6}}>Reason for Transfer</label>
                <select value={shiftForm.reason} onChange={e=>setShiftForm(f=>({...f,reason:e.target.value}))}
                  style={{width:"100%",padding:"9px 12px",border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:13,outline:"none",background:"white",cursor:"pointer"}}>
                  <option value="">— Select reason —</option>
                  {["Clinical need","ICU transfer","HDU transfer","Ward upgrade","Ward downgrade","Patient request","Isolation required","Bed availability","Discharge planning","Other"].map(r=>(
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Shifting notes — MANDATORY */}
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:".6px",marginBottom:6}}>
                  Shifting Notes <span style={{color:C.red}}>* (REQUIRED)</span>
                </label>
                <textarea value={shiftForm.shiftingNotes} onChange={e=>setShiftForm(f=>({...f,shiftingNotes:e.target.value}))}
                  placeholder="Document the clinical reason for the bed shift, patient's current condition, any special requirements for the new bed/ward, equipment being transferred, etc."
                  style={{width:"100%",minHeight:120,padding:"10px 12px",border:`1.5px solid ${shiftForm.shiftingNotes?C.border:C.redB}`,borderRadius:8,fontSize:13,outline:"none",resize:"vertical",boxSizing:"border-box",lineHeight:1.6}}
                />
                {!shiftForm.shiftingNotes?.trim() && <div style={{fontSize:11,color:C.red,marginTop:4}}>⚠ Shifting notes are mandatory. Nurse cannot complete handover without this information.</div>}
              </div>

              {/* Info box */}
              <div style={{padding:"10px 14px",background:"#fffbeb",border:"1.5px solid #fbbf24",borderRadius:8,fontSize:12,color:"#92400e",lineHeight:1.6}}>
                <strong>Workflow:</strong> After you submit, the selected bed will be reserved.
                Nurse must then write <strong>Handover Notes</strong> to complete the transfer and actually move the patient's record to the new bed.
              </div>

              {/* Actions */}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowShiftModal(false)} disabled={shiftSaving}
                  style={{padding:"9px 20px",borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",fontSize:13,fontWeight:700,cursor:"pointer",color:C.muted}}>
                  Cancel
                </button>
                <button onClick={submitShift} disabled={shiftSaving||!shiftForm.toBedId||!shiftForm.shiftingNotes?.trim()}
                  style={{padding:"9px 24px",borderRadius:8,border:"none",background:shiftSaving||!shiftForm.toBedId||!shiftForm.shiftingNotes?.trim()?C.muted:C.primary,color:"white",fontSize:13,fontWeight:700,cursor:shiftSaving||!shiftForm.toBedId||!shiftForm.shiftingNotes?.trim()?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:8}}>
                  {shiftSaving ? "Initiating…" : "🔄 Initiate Transfer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
