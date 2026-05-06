import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";

const API = API_ENDPOINTS.MAR;

// ── Constants ──────────────────────────────────────────────
const FREQ_MAP   = { OD:1, BD:2, TDS:3, QID:4 };
const STD_TIMES  = { OD:[6], BD:[6,18], TDS:[6,14,22], QID:[6,12,18,0] };
const ROUTES     = ["Oral","IV","IM","SC","SL","Topical","Inhalation","Rectal","Other"];
const FREQ_COLOR = { OD:"#dbeafe:#1d4ed8", BD:"#d1fae5:#065f46", TDS:"#fef3c7:#92400e", QID:"#fce7f3:#9d174d" };

const STATUS_COLORS = {
  GIVEN:"#dcfce7:#166534", HELD:"#fef9c3:#713f12",
  REFUSED:"#fee2e2:#7f1d1d", NOT_AVAILABLE:"#f3f4f6:#374151", MISSED:"#fff7ed:#7c2d12",
};

const CAT_META = {
  injection:   { label:"Injections / IV Meds",   color:"#9d174d", bg:"#fce7f3" },
  consumable:  { label:"Consumables & Syringes",  color:"#6d28d9", bg:"#f5f3ff" },
  nebulization:{ label:"Nebulization",             color:"#166534", bg:"#f0fdf4" },
  tablet:      { label:"Tablets / Capsules",       color:"#1d4ed8", bg:"#eff6ff" },
  syrup:       { label:"Syrups / Liquids",         color:"#92400e", bg:"#fffbeb" },
};
const CAT_ORDER = ["injection","consumable","nebulization","tablet","syrup"];

const CATALOG = {
  consumable:[
    {name:"IV Cannula 18G",dose:"",qty:1,unit:"pcs",note:""},
    {name:"IV Cannula 20G",dose:"",qty:1,unit:"pcs",note:""},
    {name:"IV Infusion Set",dose:"",qty:1,unit:"set",note:""},
    {name:"Blood Transfusion Set",dose:"",qty:1,unit:"set",note:""},
    {name:"Foley Catheter 16Fr",dose:"",qty:1,unit:"pcs",note:""},
    {name:"Urobag 2L",dose:"",qty:1,unit:"pcs",note:""},
    {name:"Syringe 2ml",dose:"",qty:5,unit:"pcs",note:"single-use"},
    {name:"Syringe 5ml",dose:"",qty:5,unit:"pcs",note:"single-use"},
    {name:"Syringe 10ml",dose:"",qty:5,unit:"pcs",note:"single-use"},
    {name:"Insulin Syringe 1ml",dose:"",qty:3,unit:"pcs",note:"single-use"},
    {name:"IV Dressing (Tegaderm)",dose:"",qty:1,unit:"pcs",note:""},
    {name:"Spirit Swab / Alcowipe",dose:"",qty:10,unit:"pcs",note:""},
    {name:"Gloves (pair)",dose:"",qty:5,unit:"pair",note:""},
    {name:"Nasal Prongs O₂",dose:"",qty:1,unit:"pcs",note:""},
    {name:"Nebulizer Mask Adult",dose:"",qty:1,unit:"pcs",note:""},
    {name:"Suction Catheter 14Fr",dose:"",qty:2,unit:"pcs",note:""},
  ],
  injection:[
    {name:"Dextrose 5% 500ml",dose:"500ml",qty:1,unit:"bag",note:""},
    {name:"Normal Saline 500ml",dose:"500ml",qty:1,unit:"bag",note:""},
    {name:"RL Solution 500ml",dose:"500ml",qty:1,unit:"bag",note:""},
    {name:"Tramadol 50mg",dose:"50mg",qty:1,unit:"amp",note:"STAT"},
    {name:"Diclofenac 75mg",dose:"75mg",qty:1,unit:"amp",note:""},
    {name:"Furosemide 20mg",dose:"20mg",qty:1,unit:"amp",note:""},
    {name:"Hydrocortisone 100mg",dose:"100mg",qty:1,unit:"vial",note:"STAT"},
    {name:"KCl Correction 20mEq",dose:"20mEq",qty:1,unit:"amp",note:"ICU protocol"},
  ],
  tablet:[
    {name:"Paracetamol 500mg",dose:"500mg",qty:4,unit:"tabs",note:""},
    {name:"Ibuprofen 400mg",dose:"400mg",qty:3,unit:"tabs",note:"with food"},
    {name:"Amoxicillin 500mg",dose:"500mg",qty:3,unit:"caps",note:"ABX"},
    {name:"Omeprazole 20mg",dose:"20mg",qty:2,unit:"caps",note:""},
    {name:"Metformin 500mg",dose:"500mg",qty:2,unit:"tabs",note:""},
    {name:"Amlodipine 5mg",dose:"5mg",qty:1,unit:"tab",note:""},
  ],
  syrup:[
    {name:"Paracetamol Syrup 250mg/5ml",dose:"5ml",qty:1,unit:"bottle (60ml)",note:"once"},
    {name:"Ambroxol Syrup",dose:"5ml",qty:1,unit:"bottle (100ml)",note:"once"},
    {name:"Antacid Syrup",dose:"10ml",qty:1,unit:"bottle (170ml)",note:"once"},
    {name:"Lactulose Syrup",dose:"15ml",qty:1,unit:"bottle (200ml)",note:""},
    {name:"Iron + Folic Acid Syrup",dose:"5ml",qty:1,unit:"bottle (200ml)",note:"once"},
  ],
  nebulization:[
    {name:"Ipratropium Bromide 0.5mg",dose:"0.5mg",qty:4,unit:"respules",note:""},
    {name:"Budesonide 0.5mg",dose:"0.5mg",qty:2,unit:"respules",note:""},
    {name:"Levosalbutamol 1.25mg",dose:"1.25mg",qty:3,unit:"respules",note:""},
    {name:"Normal Saline Neb. 3ml",dose:"3ml",qty:4,unit:"vials",note:""},
  ],
  custom:[],
};

// ── Helpers ────────────────────────────────────────────────
function inferMedType(route, dose="") {
  const r = (route||"").toLowerCase();
  const d = (dose||"").toLowerCase();
  if(["iv","im","sc","sl"].includes(r)) return "injection";
  if(r==="inhalation" || r==="neb" || r==="nebulization") return "nebulization";
  if(d.includes("ml") || d.includes("syrup")) return "syrup";
  return "tablet";
}
function inferFreq(frequency="") {
  const f = frequency.toUpperCase().replace(/\s/g,"");
  if(f.includes("OD")||f==="1-0-0"||f==="ONCE"||f==="DAILY") return "OD";
  if(f.includes("BD")||f==="1-0-1"||f==="TWICE"||f==="BID") return "BD";
  if(f.includes("TDS")||f==="1-1-1"||f==="THRICE"||f==="TID") return "TDS";
  if(f.includes("QID")||f==="1-1-1-1"||f==="FOUR") return "QID";
  return "OD";
}
function pad2(n){ return String(n).padStart(2,"0"); }
function toMinutes(hhmm){ const[h,m]=(hhmm||"00:00").split(":").map(Number); return h*60+m; }
function buildSlotDt(baseDate, dayOffset, hourInt){
  const h = hourInt===0||hourInt===24 ? 0 : hourInt;
  const extraDay = hourInt===0||hourInt===24 ? 1 : 0;
  return new Date(baseDate.getTime() + ((dayOffset + extraDay)*24*3600 + h*3600)*1000);
}
function fmtTime(dt){ return dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false}); }
function escHtml(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function genDocNo(admDate, day){
  const d = admDate ? new Date(admDate) : new Date();
  const ds = `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${d.getFullYear()}`;
  return `PHM-${ds}-D${day}-${Math.floor(Math.random()*900+100)}`;
}

// ── Build schedule from medications ────────────────────────
function buildSchedule(medications, admDateStr, admTimeStr, day1Times) {
  if(!admDateStr) return {};
  const admDate = new Date(`${admDateStr}T00:00:00`);
  const schedule = {};
  medications.forEach(med => {
    if(!med.isActive) return;
    const medId = med._id || med.medicineName;
    const freq = inferFreq(med.frequency);
    const stdTimes = STD_TIMES[freq] || [6];
    schedule[medId] = {};
    for(let day=1; day<=7; day++){
      schedule[medId][day] = [];
      if(day===1){
        const d1 = day1Times[freq] || [];
        d1.forEach(t => {
          if(!t) return;
          const [h,m] = t.split(":").map(Number);
          const dt = new Date(admDate.getTime() + (h*60+m)*60*1000);
          schedule[medId][day].push({ dt, status:"pending", actionTag:null });
        });
        if(schedule[medId][day].length===0){
          stdTimes.forEach(h => {
            const dt = buildSlotDt(admDate, 0, h);
            schedule[medId][day].push({ dt, status:"pending", actionTag:null });
          });
        }
      } else {
        stdTimes.forEach(h => {
          const dt = buildSlotDt(admDate, day-1, h);
          schedule[medId][day].push({ dt, status:"pending", actionTag:null });
        });
      }
    }
  });
  return schedule;
}

// ── Auto-build indent items ─────────────────────────────────
function buildAutoItems(medications, scheduleData, day) {
  const items = [];
  let uid = 1;
  const mk = () => `auto_${day}_${uid++}`;

  medications.filter(m => m.isActive).forEach(med => {
    const medId = med._id || med.medicineName;
    const slots = (scheduleData[medId]?.[day] || []);
    const doses = slots.length;
    if(doses === 0) return;
    const type = inferMedType(med.route, med.dose);
    const freq = inferFreq(med.frequency);
    const doseStr = `${med.dose||""}${med.unit||""}`;
    const isHighAlert = med.isHighAlert;
    const isLASA = med.isLASA;

    if(type === "injection"){
      items.push({ id:mk(), category:"injection", name:med.medicineName, dose:doseStr,
        route:med.route, freq, qty:doses, unit:"vial/amp",
        note:(isHighAlert?"HIGH ALERT · ":" ")+(isLASA?"LASA":"")+` ${doses} dose${doses>1?"s":""}`.trim(),
        isStat:false, isAuto:true, _edited:false, rxd:false });
      // syringes
      const syringeType = (med.route==="IV"||med.route==="IM") ? "IV Syringe 10ml" : "Insulin Syringe 1ml";
      items.push({ id:mk(), category:"consumable", name:syringeType,
        dose:"", route:"", freq:"", qty:doses, unit:"pcs",
        note:"single-use per dose", isStat:false, isAuto:true, _edited:false, rxd:false });
    } else if(type === "nebulization"){
      items.push({ id:mk(), category:"nebulization", name:med.medicineName, dose:doseStr,
        route:"NEB", freq, qty:doses, unit:"respule",
        note:`${doses} dose${doses>1?"s":""}`, isStat:false, isAuto:true, _edited:false, rxd:false });
    } else if(type === "syrup"){
      if(day===1){
        items.push({ id:mk(), category:"syrup", name:med.medicineName, dose:doseStr,
          route:"PO", freq, qty:1, unit:"bottle",
          note:"Dispensed once — full course", isStat:false, isAuto:true, _edited:false, rxd:false });
      }
    } else {
      items.push({ id:mk(), category:"tablet", name:med.medicineName, dose:doseStr,
        route:"PO", freq, qty:doses, unit:"tabs",
        note:`${doses} dose${doses>1?"s":""}`, isStat:false, isAuto:true, _edited:false, rxd:false });
    }
  });

  // Add IV Infusion Set if any IV meds
  const hasIV = medications.some(m => m.isActive && (m.route==="IV"||m.route==="IM") &&
    (scheduleData[m._id||m.medicineName]?.[day]||[]).length > 0);
  if(hasIV){
    items.push({ id:mk(), category:"consumable", name:"IV Infusion Set",
      dose:"", route:"", freq:"", qty:1, unit:"set",
      note:"check if already in situ", isStat:false, isAuto:true, _edited:false, rxd:false });
  }
  return items;
}

// ═══════════════════════════════════════════════════════════
// PHARMACY INDENT MODAL
// ═══════════════════════════════════════════════════════════
function PharmacyIndentModal({ mar, scheduleData, admDate, onClose }) {
  const [indentDay, setIndentDay]     = useState(1);
  const [indentState, setIndentState] = useState({});
  const [showDrawer, setShowDrawer]   = useState(false);
  const [drawerCat, setDrawerCat]     = useState("consumable");
  const [cfName, setCfName]   = useState("");
  const [cfDose, setCfDose]   = useState("");
  const [cfQty, setCfQty]     = useState(1);
  const [cfUnit, setCfUnit]   = useState("");
  const [cfNote, setCfNote]   = useState("");
  const [cfStat, setCfStat]   = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef(null);

  function flash(){
    setSavedFlash(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSavedFlash(false), 1800);
  }

  function getOrBuildDay(day, currentState) {
    if(currentState[day]) return currentState;
    const items = buildAutoItems(mar.medications || [], scheduleData, day);
    const docNo = genDocNo(admDate, day);
    return { ...currentState, [day]: { items, docNo } };
  }

  useEffect(() => {
    setIndentState(prev => getOrBuildDay(indentDay, prev));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indentDay]);

  const state = indentState[indentDay];
  const items = state?.items || [];

  function mutateItems(fn) {
    setIndentState(prev => {
      const cur = prev[indentDay];
      if(!cur) return prev;
      const newItems = fn([...cur.items]);
      flash();
      return { ...prev, [indentDay]: { ...cur, items: newItems } };
    });
  }

  function updateField(id, field, value) {
    mutateItems(arr => arr.map(it => it.id===id ? {...it, [field]:value, _edited:true} : it));
  }
  function changeQty(id, delta) {
    mutateItems(arr => arr.map(it => it.id===id ? {...it, qty:Math.max(0,it.qty+delta), _edited:true} : it));
  }
  function deleteItem(id) {
    mutateItems(arr => arr.filter(it => it.id!==id));
  }
  function addCatalogItem(cat, idx) {
    const ci = CATALOG[cat][idx];
    const uid = Date.now()+"_cat";
    mutateItems(arr => [...arr, {
      id:uid, category:cat, name:ci.name, dose:ci.dose,
      route:"", freq:"", qty:ci.qty, unit:ci.unit, note:ci.note||"",
      isStat:false, isAuto:false, _edited:false, rxd:false
    }]);
    setShowDrawer(false);
  }
  function addCustomItem() {
    if(!cfName.trim()){ alert("Please enter an item name."); return; }
    const uid = Date.now()+"_custom";
    mutateItems(arr => [...arr, {
      id:uid, category: drawerCat==="custom"?"consumable":drawerCat,
      name:cfName.trim(), dose:cfDose.trim(), route:"", freq:"",
      qty:cfQty||1, unit:cfUnit||"pcs",
      note:cfNote||(cfStat?"STAT — Doctor verbal order":""),
      isStat:cfStat, isAuto:false, _edited:false, rxd:false
    }]);
    setCfName(""); setCfDose(""); setCfQty(1); setCfUnit(""); setCfNote(""); setCfStat(false);
    setShowDrawer(false);
  }
  function resetDay() {
    if(!window.confirm(`Reset Day ${indentDay} indent to auto-generated values? All manual changes will be lost.`)) return;
    const items = buildAutoItems(mar.medications || [], scheduleData, indentDay);
    setIndentState(prev => ({ ...prev, [indentDay]: { ...prev[indentDay], items } }));
    flash();
  }

  function printIndent() {
    const day = indentDay;
    const cur = indentState[day];
    if(!cur) return;
    const its = cur.items;
    const indentDt = admDate ? new Date(new Date(admDate).getTime()+(day-1)*24*3600*1000) : new Date();
    const dateStrFull = indentDt.toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    const docNo = cur.docNo;
    const patientName = mar?.patientName || "—";
    const uhid = mar?.UHID || "—";
    const ipdNo = mar?.ipdNo || "—";

    let html = `<!DOCTYPE html><html><head><title>Pharmacy Indent</title>
    <style>
    body{font-family:'Segoe UI',sans-serif;font-size:12px;color:#1a1d23;margin:0;padding:20px 28px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e293b;padding-bottom:12px;margin-bottom:16px}
    .hosp{font-size:18px;font-weight:700;color:#1e293b}.hosp-sub{font-size:10px;color:#6b7280;margin-top:2px}
    .title-block{text-align:right}.main-title{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px}
    .sub-title{font-size:10px;color:#6b7280;margin-top:2px}.doc-no{font-size:9px;color:#6b7280;margin-top:4px;font-family:monospace}
    .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:#f8faff;border:1px solid #dbeafe;border-radius:8px;padding:10px 14px;margin-bottom:16px}
    .sl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280}
    .sv{font-weight:700;font-size:13px;color:#1a1d23;margin-top:2px}
    .day-badge{display:inline-flex;align-items:center;gap:8px;background:#1e293b;color:white;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:700;margin-bottom:16px}
    .day-date{color:#94a3b8;font-weight:400;font-size:11px}
    .sec-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:6px 12px;border-radius:4px 4px 0 0;border-bottom:2px solid;margin:14px 0 0}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#f1f5f9;color:#6b7280;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;padding:7px 10px;text-align:left;border:1px solid #e2e6ea}
    td{padding:7px 10px;border:1px solid #e2e6ea;vertical-align:middle}
    tr:nth-child(even){background:#fafafa}
    .qty-cell{text-align:center;font-family:monospace;font-weight:700;font-size:13px;color:#1e40af}
    .stat-cell{color:#be185d;font-weight:700}
    .sig-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:22px;padding-top:18px;border-top:1.5px solid #e2e6ea}
    .sig-box{border:1px dashed #94a3b8;border-radius:6px;padding:12px 10px 6px;text-align:center;min-height:60px}
    .sig-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;display:block;margin-top:8px}
    .footer{margin-top:12px;font-size:8px;color:#9ca3af;text-align:center;border-top:1px solid #e2e6ea;padding-top:8px}
    </style></head><body>
    <div class="hdr">
      <div><div class="hosp">${escHtml(mar?.patientName ? "SphereHealth Hospital" : "SphereHealth Hospital")}</div>
      <div class="hosp-sub">Nursing Station — Pharmacy Requisition</div></div>
      <div class="title-block"><div class="main-title">Pharmacy Indent</div>
      <div class="sub-title">Daily Drug Requisition Slip — NABH MMU 4.0</div>
      <div class="doc-no">${escHtml(docNo)}</div></div>
    </div>
    <div class="strip">
      <div><div class="sl">Patient</div><div class="sv">${escHtml(patientName)}</div></div>
      <div><div class="sl">UHID</div><div class="sv">${escHtml(uhid)}</div></div>
      <div><div class="sl">IPD No.</div><div class="sv">${escHtml(ipdNo)}</div></div>
      <div><div class="sl">Date</div><div class="sv">${new Date().toLocaleDateString("en-IN")}</div></div>
    </div>
    <div class="day-badge">Day ${day} Indent <span class="day-date">— ${dateStrFull}</span></div>`;

    const catColors = {
      injection:["#fce7f3","#9d174d","#f9a8d4"],
      consumable:["#f5f3ff","#6d28d9","#c4b5fd"],
      nebulization:["#f0fdf4","#166534","#86efac"],
      tablet:["#eff6ff","#1d4ed8","#93c5fd"],
      syrup:["#fffbeb","#92400e","#fcd34d"],
    };
    CAT_ORDER.forEach(cat => {
      const cits = its.filter(i => i.category===cat && i.qty>0);
      if(!cits.length) return;
      const [bg,fg,border] = catColors[cat];
      const meta = CAT_META[cat];
      html += `<div class="sec-title" style="background:${bg};color:${fg};border-color:${border}">${meta.label}</div>
      <table><thead><tr><th>#</th><th>Medicine / Item</th><th>Dose</th><th style="text-align:center">Qty</th><th>Unit</th><th>Remark</th><th style="text-align:center">Dispensed ✓</th></tr></thead><tbody>`;
      cits.forEach((it,i) => {
        html += `<tr><td>${i+1}</td>
          <td>${it.isABX?'<strong style="color:#b91c1c">★ </strong>':''}${escHtml(it.name)}${it.isStat?'<strong class="stat-cell"> ⚡STAT</strong>':''}</td>
          <td>${escHtml(it.dose||"—")}</td>
          <td class="qty-cell">${it.qty}</td>
          <td style="color:#6b7280;font-size:10px">${escHtml(it.unit||"")}</td>
          <td style="font-size:10px;color:#6b7280;font-style:italic">${escHtml(it.note||"")}</td>
          <td style="text-align:center">${it.rxd?'<strong style="color:#166534">✓ Rxd</strong>':'___________'}</td></tr>`;
      });
      html += `</tbody></table>`;
    });
    html += `<div class="sig-strip">
      <div class="sig-box"><span class="sig-lbl">Prepared by (Nurse)</span></div>
      <div class="sig-box"><span class="sig-lbl">Checked by (In-charge)</span></div>
      <div class="sig-box"><span class="sig-lbl">Received from Pharmacy</span></div>
      <div class="sig-box"><span class="sig-lbl">Dispensed by Pharmacist</span></div>
    </div>
    <div class="footer">Generated: ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp; NABH MMU 4.0 Compliant &nbsp;|&nbsp; ${escHtml(docNo)}</div>
    </body></html>`;
    const w = window.open("","_blank","width=900,height=700");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  const inp = "width:100%;padding:7px 10px;border:1.5px solid #e2e6ea;border-radius:6px;font-size:12px;outline:none;font-family:inherit";
  const FREQ_COLORS = { OD:"#1d4ed8:#dbeafe", BD:"#065f46:#d1fae5", TDS:"#92400e:#fef3c7", QID:"#9d174d:#fce7f3" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", backdropFilter:"blur(3px)",
      zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"white", borderRadius:14, width:"min(1100px,97vw)", maxHeight:"93vh",
        display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"16px 22px", background:"#1e293b", color:"white", display:"flex", alignItems:"center", gap:12 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
          <span style={{ fontWeight:700, fontSize:15 }}>Pharmacy Indent — Dynamic Requisition</span>
          <span style={{ fontSize:11, background:"rgba(56,189,248,.2)", border:"1px solid rgba(56,189,248,.4)", padding:"2px 8px", borderRadius:12, color:"#7dd3fc", letterSpacing:"1px" }}>NABH MMU 4.0</span>
          {savedFlash && <span style={{ marginLeft:"auto", fontSize:11, color:"#4ade80", display:"flex", alignItems:"center", gap:4, fontWeight:700 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg> Saved
          </span>}
          <button onClick={onClose} style={{ marginLeft:"auto", background:"none", border:"none", color:"#94a3b8", fontSize:22, cursor:"pointer", lineHeight:1 }}>&times;</button>
        </div>

        {/* Toolbar */}
        <div style={{ padding:"10px 20px", borderBottom:"1px solid #e2e6ea", background:"#f8faff",
          display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:"#6b7280" }}>Day:</span>
            <select value={indentDay} onChange={e => setIndentDay(parseInt(e.target.value))}
              style={{ padding:"6px 10px", border:"1.5px solid #e2e6ea", borderRadius:7, fontSize:13, background:"white", outline:"none" }}>
              {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>Day {d}</option>)}
            </select>
          </div>
          <button onClick={resetDay} style={{ padding:"6px 14px", background:"#fffbeb", border:"1.5px solid #fcd34d", borderRadius:7, fontSize:11, color:"#92400e", fontWeight:700, cursor:"pointer" }}>
            ↺ Reset to Auto
          </button>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <button onClick={() => { setShowDrawer(true); setDrawerCat("consumable"); }}
              style={{ padding:"7px 16px", background:"#fdf2f8", color:"#be185d", border:"1.5px solid #fbcfe8", borderRadius:7, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Add Item / Stat Med
            </button>
            <button onClick={printIndent}
              style={{ padding:"7px 16px", background:"#1e40af", color:"white", border:"none", borderRadius:7, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print Indent
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY:"auto", flex:1, padding:"0 20px 20px" }}>
          {!state ? (
            <div style={{ textAlign:"center", padding:40, color:"#6b7280" }}>Loading...</div>
          ) : (
            <>
              {/* Day heading */}
              <div style={{ padding:"14px 0 10px", display:"flex", alignItems:"center", gap:12, borderBottom:"1px solid #e2e6ea", marginBottom:4 }}>
                <span style={{ fontWeight:700, fontSize:15 }}>Day {indentDay} Indent</span>
                <span style={{ fontSize:11, color:"#6b7280" }}>
                  {admDate ? new Date(new Date(admDate).getTime()+(indentDay-1)*24*3600*1000)
                    .toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}) : ""}
                </span>
                <span style={{ fontFamily:"monospace", fontSize:10, color:"#9ca3af", marginLeft:"auto" }}>{state.docNo}</span>
                {items.filter(i=>i.isStat).length > 0 && (
                  <span style={{ background:"#fdf2f8", color:"#be185d", padding:"3px 10px", borderRadius:12, fontSize:11, fontWeight:700 }}>
                    ⚡ {items.filter(i=>i.isStat).length} STAT
                  </span>
                )}
              </div>
              <div style={{ fontSize:11, color:"#9ca3af", marginBottom:16 }}>Click any field to edit inline. Use +/– for quantities. ✕ removes a row.</div>

              {/* Syrup notice for day 2+ */}
              {indentDay > 1 && items.filter(i=>i.category==="syrup").length===0 && (
                <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:8, padding:"8px 14px",
                  fontSize:12, color:"#92400e", display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                  ℹ️ Syrups dispensed on Day 1. Not re-indented. Add manually if needed.
                </div>
              )}

              {/* Tables by category */}
              {CAT_ORDER.map(cat => {
                const cits = items.filter(i => i.category===cat);
                const meta = CAT_META[cat];
                return (
                  <div key={cat}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding:"8px 12px", borderRadius:8, margin:"16px 0 0",
                      background:meta.bg, color:meta.color, fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".7px" }}>
                      <span>{meta.label} <span style={{ fontWeight:400, opacity:.7, fontSize:10 }}>({cits.length} items)</span></span>
                      <button onClick={() => { setShowDrawer(true); setDrawerCat(cat); }}
                        style={{ background:"none", border:`1.5px solid ${meta.color}`, color:meta.color, padding:"2px 10px",
                          borderRadius:6, fontSize:10, fontWeight:700, cursor:"pointer" }}>+ Add</button>
                    </div>
                    {cits.length > 0 && (
                      <table style={{ width:"100%", borderCollapse:"collapse", marginTop:0 }}>
                        <thead>
                          <tr style={{ background:"#f1f5f9" }}>
                            {["#","Medicine / Item","Dose/Strength","Quantity","Unit","Note / Remark","Rxd ✓",""].map(h => (
                              <th key={h} style={{ padding:"7px 10px", textAlign: h==="Quantity"||h==="Rxd ✓"?"center":"left",
                                fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:"#6b7280",
                                border:"1px solid #e2e6ea" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cits.map((item, idx) => (
                            <tr key={item.id} style={{ background:idx%2===1?"#fafafa":"white" }}>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea", color:"#9ca3af", fontSize:11 }}>{idx+1}</td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                  {item.isStat && <span style={{ background:"#fdf2f8", color:"#be185d", padding:"1px 6px", borderRadius:10, fontSize:9, fontWeight:700, animation:"pulse 1.5s infinite" }}>⚡ STAT</span>}
                                  {item.isAuto && !item._edited && <span style={{ background:"#dbeafe", color:"#1d4ed8", padding:"1px 6px", borderRadius:10, fontSize:9, fontWeight:700 }}>AUTO</span>}
                                  {item._edited && <span style={{ background:"#fef3c7", color:"#92400e", padding:"1px 6px", borderRadius:10, fontSize:9, fontWeight:700 }}>EDITED</span>}
                                </div>
                                <input value={item.name}
                                  onChange={e => updateField(item.id,"name",e.target.value)}
                                  style={{ border:"none", background:"transparent", fontSize:13, fontWeight:600, color:"#1a1d23", width:"100%", outline:"none", fontFamily:"inherit" }} />
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea" }}>
                                <input value={item.dose||""} onChange={e => updateField(item.id,"dose",e.target.value)}
                                  style={{ border:"none", background:"transparent", fontSize:12, color:"#6b7280", width:"100%", outline:"none", fontFamily:"inherit" }} placeholder="—" />
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"center" }}>
                                  <button onClick={() => changeQty(item.id,-1)} style={{ width:24, height:24, border:"1.5px solid #e2e6ea", borderRadius:5, background:"white", fontSize:15, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>−</button>
                                  <input type="number" min="0" value={item.qty}
                                    onChange={e => updateField(item.id,"qty",parseInt(e.target.value)||0)}
                                    style={{ width:48, textAlign:"center", padding:"4px 5px", border:"1.5px solid #e2e6ea", borderRadius:5, fontFamily:"monospace", fontSize:13, fontWeight:700, color:"#1e40af", outline:"none" }} />
                                  <button onClick={() => changeQty(item.id,+1)} style={{ width:24, height:24, border:"1.5px solid #e2e6ea", borderRadius:5, background:"white", fontSize:15, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>+</button>
                                </div>
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea" }}>
                                <input value={item.unit||""} onChange={e => updateField(item.id,"unit",e.target.value)}
                                  style={{ border:"none", background:"transparent", fontSize:11, color:"#6b7280", width:70, outline:"none", fontFamily:"inherit" }} />
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea" }}>
                                <input value={item.note||""} onChange={e => updateField(item.id,"note",e.target.value)}
                                  placeholder="add note…"
                                  style={{ border:"none", background:"transparent", fontSize:11, color:"#6b7280", fontStyle:"italic", width:"100%", outline:"none", fontFamily:"inherit", cursor:"text" }} />
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea", textAlign:"center" }}>
                                <input type="checkbox" checked={item.rxd}
                                  onChange={e => updateField(item.id,"rxd",e.target.checked)}
                                  style={{ width:16, height:16, cursor:"pointer", accentColor:"#16a34a" }} />
                              </td>
                              <td style={{ padding:"7px 10px", border:"1px solid #e2e6ea", textAlign:"center" }}>
                                <button onClick={() => deleteItem(item.id)}
                                  style={{ width:24, height:24, border:"1.5px solid #fecaca", borderRadius:5, background:"white", color:"#dc2626", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:.7 }}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {cits.length === 0 && (
                      <div style={{ padding:"10px 14px", fontSize:12, color:"#9ca3af", fontStyle:"italic" }}>
                        No items. Click "+ Add" to add {meta.label.toLowerCase()}.
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add Item Drawer */}
              {showDrawer && (
                <div style={{ marginTop:12, background:"#f8faff", border:"1.5px solid #1e40af", borderRadius:10, overflow:"hidden", animation:"fadeIn .15s ease" }}>
                  <div style={{ padding:"10px 16px", background:"#1e40af", color:"white", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span>➕ Add Item to Indent (Day {indentDay})</span>
                    <button onClick={() => setShowDrawer(false)} style={{ background:"none", border:"none", color:"white", fontSize:18, cursor:"pointer" }}>&times;</button>
                  </div>
                  <div style={{ padding:16 }}>
                    {/* Category tabs */}
                    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                      {["consumable","injection","tablet","syrup","nebulization","custom"].map(cat => (
                        <button key={cat} onClick={() => setDrawerCat(cat)}
                          style={{ padding:"5px 12px", border:`1.5px solid ${drawerCat===cat?"#1e40af":"#e2e6ea"}`,
                            borderRadius:20, fontSize:11, fontWeight:700, cursor:"pointer",
                            background: drawerCat===cat?"#1e40af":"white",
                            color: drawerCat===cat?"white":"#6b7280" }}>
                          {cat==="consumable"?"🧰 Consumables":cat==="injection"?"💉 Injections":
                           cat==="tablet"?"💊 Tablets":cat==="syrup"?"🍶 Syrups":
                           cat==="nebulization"?"💨 Nebulization":"✏️ Custom"}
                        </button>
                      ))}
                    </div>
                    {/* Catalog grid */}
                    {CATALOG[drawerCat]?.length > 0 && (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:6, marginBottom:12, maxHeight:180, overflowY:"auto" }}>
                        {CATALOG[drawerCat].map((ci,i) => (
                          <div key={i} onClick={() => addCatalogItem(drawerCat, i)}
                            style={{ padding:"7px 10px", border:"1.5px solid #e2e6ea", borderRadius:8, background:"white", cursor:"pointer", fontSize:12, transition:"all .12s" }}
                            onMouseEnter={e => { e.currentTarget.style.border="1.5px solid #1e40af"; e.currentTarget.style.background="#eff6ff"; }}
                            onMouseLeave={e => { e.currentTarget.style.border="1.5px solid #e2e6ea"; e.currentTarget.style.background="white"; }}>
                            <div style={{ fontWeight:600, color:"#1a1d23" }}>{ci.name}</div>
                            <div style={{ fontSize:10, color:"#6b7280", marginTop:2 }}>{ci.dose?ci.dose+" · ":""}{ci.qty} {ci.unit}{ci.note?" · "+ci.note:""}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Manual entry */}
                    <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280", marginBottom:8 }}>Or enter manually:</div>
                    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr auto", gap:8, alignItems:"end",
                      background:"white", border:"1.5px solid #e2e6ea", borderRadius:8, padding:12 }}>
                      <div>
                        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280", marginBottom:4 }}>Item Name *</div>
                        <input style={{ style: inp, width:"100%", padding:"7px 10px", border:"1.5px solid #e2e6ea", borderRadius:6, fontSize:12, outline:"none", fontFamily:"inherit" }}
                          value={cfName} onChange={e => setCfName(e.target.value)} placeholder="e.g. IV Cannula 18G…" />
                      </div>
                      <div>
                        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280", marginBottom:4 }}>Dose/Strength</div>
                        <input style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #e2e6ea", borderRadius:6, fontSize:12, outline:"none", fontFamily:"inherit" }}
                          value={cfDose} onChange={e => setCfDose(e.target.value)} placeholder="e.g. 500ml" />
                      </div>
                      <div>
                        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280", marginBottom:4 }}>Qty</div>
                        <input type="number" min="1" style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #e2e6ea", borderRadius:6, fontSize:12, fontFamily:"monospace", outline:"none" }}
                          value={cfQty} onChange={e => setCfQty(parseInt(e.target.value)||1)} />
                      </div>
                      <div>
                        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280", marginBottom:4 }}>Unit</div>
                        <input style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #e2e6ea", borderRadius:6, fontSize:12, outline:"none", fontFamily:"inherit" }}
                          value={cfUnit} onChange={e => setCfUnit(e.target.value)} placeholder="pcs / vial…" />
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, justifyContent:"flex-end" }}>
                        <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, color:"#be185d", cursor:"pointer" }}>
                          <input type="checkbox" checked={cfStat} onChange={e => setCfStat(e.target.checked)} style={{ width:14, height:14 }} />
                          ⚡ STAT
                        </label>
                        <button onClick={addCustomItem}
                          style={{ padding:"7px 14px", background:"#16a34a", color:"white", border:"none", borderRadius:6, fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                          Add ↵
                        </button>
                      </div>
                    </div>
                    <div style={{ marginTop:8, display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#6b7280" }}>Note:</span>
                      <input value={cfNote} onChange={e => setCfNote(e.target.value)}
                        placeholder="e.g. Doctor order by Dr Mehta at 14:30, Stat dose given"
                        style={{ flex:1, padding:"6px 10px", border:"1.5px solid #e2e6ea", borderRadius:6, fontSize:12, outline:"none", fontFamily:"inherit" }} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAR CHART VIEW (day × time grid)
// ═══════════════════════════════════════════════════════════
function MARChartView({ medications, scheduleData, viewDay, graceMin }) {
  const now = new Date();
  const grace = (graceMin||30) * 60000;

  return (
    <div style={{ overflowX:"auto", background:"white", borderRadius:12, border:"1px solid #e2e6ea", marginBottom:16 }}>
      <div style={{ padding:"12px 18px", borderBottom:"1px solid #e2e6ea", background:"#f8faff",
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontWeight:700, fontSize:13, color:"#1e293b" }}>Medication Administration Chart — Days 1–7</span>
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          {[["#16a34a","Given"],["#dc2626","Missed"],["#1e40af","Active"],["#d1d5db","Future"]].map(([c,l]) => (
            <div key={l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#6b7280" }}>
              <div style={{ width:10, height:10, borderRadius:2, background:c }} />{l}
            </div>
          ))}
        </div>
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ background:"#1e293b" }}>
            <th style={{ padding:"10px 14px", textAlign:"left", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".8px", color:"#cbd5e1", minWidth:200 }}>Medicine</th>
            <th style={{ padding:"10px 14px", textAlign:"center", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".8px", color:"#cbd5e1", minWidth:55 }}>Freq</th>
            <th style={{ padding:"10px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".8px", color:"#cbd5e1" }}>Administration — Days 1–7</th>
          </tr>
        </thead>
        <tbody>
          {medications.filter(m=>m.isActive).map((med, mi) => {
            const medId = med._id || med.medicineName;
            const slots  = scheduleData[medId] || {};
            const freq   = inferFreq(med.frequency);
            const [fc, fb] = (FREQ_COLOR[freq]||"#9ca3af:#f9fafb").split(":");
            const type   = inferMedType(med.route, med.dose);
            const isABX  = med.isHighAlert;
            return (
              <tr key={mi} style={{ background: isABX ? "#fff8f8" : "white", borderTop:"1px solid #f1f5f9" }}>
                {/* Medicine cell */}
                <td style={{ padding:"10px 14px", minWidth:200, verticalAlign:"middle" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {isABX && <span style={{ background:"#b91c1c", color:"white", padding:"1px 6px", borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:".8px" }}>HIGH</span>}
                    {med.isLASA && <span style={{ background:"#ea580c", color:"white", padding:"1px 6px", borderRadius:4, fontSize:9, fontWeight:700 }}>LASA</span>}
                    <span style={{ fontWeight:600, color: isABX?"#b91c1c":"#1a1d23", fontSize:13 }}>{med.medicineName}</span>
                  </div>
                  <div style={{ fontSize:11, color:"#6b7280", marginTop:3, display:"flex", gap:8, alignItems:"center" }}>
                    <span>{med.dose}{med.unit}</span>
                    <span style={{ background:"#f0f9ff", color:"#0ea5e9", padding:"1px 5px", borderRadius:3, fontSize:10, fontWeight:600 }}>{med.route}</span>
                    <span style={{ background: type==="injection"?"#fce7f3":type==="nebulization"?"#f0fdf4":type==="syrup"?"#fffbeb":"#eff6ff",
                      color: type==="injection"?"#9d174d":type==="nebulization"?"#166534":type==="syrup"?"#92400e":"#1d4ed8",
                      padding:"1px 5px", borderRadius:3, fontSize:9, fontWeight:700 }}>
                      {type==="injection"?"INJ":type==="nebulization"?"NEB":type==="syrup"?"SYR":"TAB"}
                    </span>
                  </div>
                  {med.prescribedByName && <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>Dr. {med.prescribedByName}</div>}
                </td>
                {/* Freq */}
                <td style={{ padding:"10px 14px", textAlign:"center", verticalAlign:"middle" }}>
                  <span style={{ display:"inline-block", padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700, background:fb, color:fc }}>{freq}</span>
                </td>
                {/* Day blocks */}
                <td style={{ padding:"10px 14px", verticalAlign:"middle" }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"nowrap" }}>
                    {[1,2,3,4,5,6,7].map(day => {
                      const daySlots = slots[day] || [];
                      const isCurrentDay = day === viewDay;
                      return (
                        <div key={day} style={{ border:`1.5px solid ${isCurrentDay?"#16a34a":"#e2e6ea"}`,
                          borderRadius:8, padding:"7px 8px", minWidth:110, flexShrink:0,
                          background: isCurrentDay?"#f0fdf4":"#f9fafb",
                          boxShadow: isCurrentDay?"0 0 0 2px rgba(22,163,74,.1)":"none" }}>
                          <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".7px",
                            color: isCurrentDay?"#16a34a":"#9ca3af", marginBottom:5, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                            <span>Day {day}</span>
                            {isCurrentDay && <span style={{ background:"#16a34a", color:"white", padding:"1px 5px", borderRadius:3, fontSize:7, fontWeight:700 }}>TODAY</span>}
                          </div>
                          {daySlots.length === 0 ? (
                            <div style={{ fontSize:9, color:"#d1d5db", fontStyle:"italic" }}>No doses</div>
                          ) : daySlots.map((slot, si) => {
                            const diffMin = (slot.dt - now) / 60000;
                            const isPast  = diffMin < -(graceMin||30);
                            const isCur   = diffMin >= -(graceMin||30) && diffMin <= (graceMin||30);
                            const isFut   = diffMin > (graceMin||30);
                            const given   = slot.status === "given";
                            return (
                              <div key={si} style={{ marginBottom: si<daySlots.length-1?5:0 }}>
                                <div style={{ fontFamily:"monospace", fontSize:10, color:"#6b7280", marginBottom:2 }}>{fmtTime(slot.dt)}</div>
                                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                  <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${given?"#16a34a":isCur&&day===viewDay?"#1e40af":isPast?"#dc2626":"#d1d5db"}`,
                                    background: given?"#16a34a":isCur&&day===viewDay?"white":isPast?"#fef2f2":"#f9fafb",
                                    display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                                    {given && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                                    {!given && isPast && <div style={{ width:8, height:8, background:"#dc2626", borderRadius:1 }} />}
                                  </div>
                                  {slot.actionTag && (
                                    <span style={{ fontSize:8, fontWeight:700, padding:"1px 4px", borderRadius:3,
                                      background:"#f3f4f6", color:"#374151" }}>{slot.actionTag}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN MAR PAGE CONTENT
// ═══════════════════════════════════════════════════════════
function MARPageContent({ selectedPatient }) {
  const [searchIPD, setSearchIPD]   = useState("");
  const [searchDate, setSearchDate] = useState(new Date().toISOString().slice(0,10));
  const [mar, setMAR]               = useState(null);
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState("");
  const [showAddMed, setShowAddMed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ UHID:"", patientName:"", ipdNo:"", allergies:"" });
  const [newMed, setNewMed]         = useState({ medicineName:"", genericName:"", dose:"", unit:"", route:"Oral", frequency:"", scheduledTimes:"", startDate:searchDate, isHighAlert:false, isLASA:false, specialInstructions:"", prescribedByName:"" });
  const [adminDialog, setAdminDialog] = useState(null);
  const [adminEntry, setAdminEntry] = useState({ scheduledTime:"", status:"GIVEN", nurseName:"", batchNumber:"", reason:"", remarks:"" });

  // Chart setup
  const today = new Date().toISOString().slice(0,10);
  const [admDate, setAdmDate]       = useState(today);
  const [admTime, setAdmTime]       = useState(() => { const n=new Date(); return `${pad2(n.getHours())}:${pad2(n.getMinutes())}`; });
  const [viewDay, setViewDay]       = useState(1);
  const [graceMin, setGraceMin]     = useState(30);
  const [day1Times, setDay1Times]   = useState({ OD:[""], BD:["",""], TDS:["","",""], QID:["","","",""] });
  const [scheduleData, setScheduleData] = useState({});
  const [chartBuilt, setChartBuilt] = useState(false);
  const [viewMode, setViewMode]     = useState("list"); // "list" | "chart"
  const [showIndent, setShowIndent] = useState(false);

  // Auto-save draft for add-medication form
  const draftKey = mar?._id ? `sphere_draft_mar_${mar._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { newMed }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if(selectedPatient?.ipdNo || selectedPatient?.bedNumber || selectedPatient?.UHID) {
      const id = selectedPatient.ipdNo || selectedPatient.bedNumber || selectedPatient.UHID;
      setSearchIPD(id);
      setTimeout(() => document.getElementById("mar-search-btn")?.click(), 100);
    }
  }, [selectedPatient]);

  async function search() {
    if(!searchIPD.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ipd/${searchIPD.trim()}/date/${searchDate}`);
      const marData = res.data.data;
      setMAR(marData);
      setMsg("");
      setShowCreate(false);
      // Restore draft for this MAR if available
      const dKey = `sphere_draft_mar_${marData._id}`;
      const raw = localStorage.getItem(dKey);
      if (raw) {
        try {
          const { data } = JSON.parse(raw);
          if (data?.newMed) {
            setNewMed(data.newMed);
            setShowAddMed(true);
          }
        } catch { /* ignore */ }
      }
    } catch {
      setMAR(null);
      setMsg("No MAR found for this date. You can create one below.");
      setShowCreate(true);
    }
    setLoading(false);
  }

  async function createMAR() {
    setLoading(true);
    try {
      const res = await axios.post(API, {
        ...createForm, ipdNo:searchIPD, date:searchDate,
        allergies: createForm.allergies ? createForm.allergies.split(",").map(s=>s.trim()).filter(Boolean) : [],
      });
      setMAR(res.data.data); setShowCreate(false); setMsg("MAR created.");
    } catch(e) { setMsg(e.response?.data?.message || "Error creating MAR"); }
    setLoading(false);
  }

  async function addMedication() {
    if(!mar?._id) return;
    setLoading(true);
    try {
      const med = { ...newMed, scheduledTimes: newMed.scheduledTimes ? newMed.scheduledTimes.split(",").map(s=>s.trim()).filter(Boolean) : [], startDate: newMed.startDate || searchDate };
      const res = await axios.post(`${API}/${mar._id}/medication`, med);
      setMAR(res.data.data); setShowAddMed(false);
      clearDraft();
      setNewMed({ medicineName:"", genericName:"", dose:"", unit:"", route:"Oral", frequency:"", scheduledTimes:"", startDate:searchDate, isHighAlert:false, isLASA:false, specialInstructions:"", prescribedByName:"" });
      setMsg("Medication added."); setChartBuilt(false);
    } catch(e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  }

  async function recordAdmin() {
    if(!adminDialog) return;
    setLoading(true);
    try {
      const res = await axios.patch(`${API}/${mar._id}/medication/${adminDialog}/administer`, { ...adminEntry, ...(signature ? { nurseSignature: signature } : {}) });
      setMAR(res.data.data); setAdminDialog(null);
      setAdminEntry({ scheduledTime:"", status:"GIVEN", nurseName:"", batchNumber:"", reason:"", remarks:"" });
      setMsg("Administration recorded.");
    } catch(e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  }

  async function discontinue(medId) {
    const reason = window.prompt("Reason for discontinuation:");
    if(reason === null) return;
    setLoading(true);
    try {
      const res = await axios.patch(`${API}/${mar._id}/medication/${medId}/discontinue`, { discontinuedBy:"Nurse", discontinueReason:reason });
      setMAR(res.data.data); setMsg("Medication discontinued."); setChartBuilt(false);
    } catch(e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  }

  function buildChart() {
    if(!admDate) { alert("Please enter admission date."); return; }
    const filled = day1Times;
    const sched = buildSchedule(mar?.medications||[], admDate, admTime, filled);
    setScheduleData(sched);
    setChartBuilt(true);
    setViewMode("chart");
  }

  function autofillDay1() {
    if(!admTime) { alert("Please enter admission time first."); return; }
    const [aH, aM] = admTime.split(":").map(Number);
    const admMin = aH*60+aM;
    const nextSlot = from => Math.ceil((from+15)/15)*15;
    const toStr = m => m >= 24*60 ? "" : `${pad2(Math.floor(m/60))}:${pad2(m%60)}`;
    const d1 = nextSlot(admMin);
    setDay1Times({
      OD:  [toStr(d1)],
      BD:  [toStr(d1), toStr(d1+8*60)],
      TDS: [toStr(d1), toStr(d1+6*60), toStr(d1+12*60)],
      QID: [toStr(d1), toStr(d1+5*60), toStr(d1+10*60), toStr(d1+15*60)],
    });
  }

  const iCls = "width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit";
  const lCls = { display:"block", fontSize:11, fontWeight:600, color:"#4b5563", marginBottom:4 };
  const sectionStyle = { background:"white", borderRadius:12, boxShadow:"0 1px 4px rgba(0,0,0,.07)", padding:18, marginBottom:14, border:"1px solid #e5e7eb" };

  return (
    <div style={{ padding:0, minHeight:"100vh", background:"#f4f6fb" }}>
      {/* Title */}
      <div style={{ marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, color:"#1e293b", margin:0 }}>Medication Administration Record</h2>
          <p style={{ fontSize:12, color:"#6b7280", margin:"4px 0 0" }}>NABH MMU.4 — Medication chart with pharmacy indent system</p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={() => setShowSetup(true)}
            style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          {mar && chartBuilt && (
            <>
              <button onClick={() => setViewMode(v => v==="list"?"chart":"list")}
                style={{ padding:"8px 18px", background:"white", border:"1.5px solid #e2e6ea", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", color:"#374151" }}>
                {viewMode==="list" ? "📊 Chart View" : "📋 List View"}
              </button>
              <button onClick={() => setShowIndent(true)}
                style={{ padding:"8px 18px", background:"#16a34a", color:"white", border:"none", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                Pharmacy Indent
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <div style={{ marginBottom:12, padding:"10px 16px", background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, fontSize:13, color:"#1d4ed8" }}>{msg}</div>}

      {/* Search */}
      <div style={sectionStyle}>
        <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div>
            <label style={lCls}>IPD No.</label>
            <input style={{ width:180, border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
              value={searchIPD} onChange={e => setSearchIPD(e.target.value)} onKeyDown={e => e.key==="Enter" && search()} placeholder="IPD No..." />
          </div>
          <div>
            <label style={lCls}>Date</label>
            <input type="date" style={{ width:160, border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
              value={searchDate} onChange={e => setSearchDate(e.target.value)} />
          </div>
          <button id="mar-search-btn" onClick={search} disabled={loading}
            style={{ padding:"9px 22px", background:"#1e40af", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            {loading ? "Loading…" : "Load MAR"}
          </button>
        </div>
      </div>

      {/* Create MAR */}
      {showCreate && !mar && (
        <div style={{ ...sectionStyle, border:"2px solid #fcd34d", background:"#fffbeb" }}>
          <h3 style={{ fontWeight:700, color:"#92400e", marginBottom:14, paddingBottom:10, borderBottom:"1px solid #fcd34d", fontSize:14 }}>
            Create New MAR for {searchDate}
          </h3>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px,1fr))", gap:12 }}>
            {[["UHID","UHID"],["patientName","Patient Name"],["ipdNo","IPD No"]].map(([name,label]) => (
              <div key={name}>
                <label style={lCls}>{label}</label>
                <input style={{ width:"100%", border:"1px solid #fcd34d", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit", background:"white" }}
                  value={createForm[name]} name={name}
                  onChange={e => setCreateForm(p => ({...p, [e.target.name]:e.target.value}))} />
              </div>
            ))}
            <div>
              <label style={lCls}>Known Allergies (comma separated)</label>
              <input style={{ width:"100%", border:"1px solid #fcd34d", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit", background:"white" }}
                value={createForm.allergies} onChange={e => setCreateForm(p => ({...p, allergies:e.target.value}))} placeholder="Penicillin, Sulfa…" />
            </div>
          </div>
          <div style={{ marginTop:14, display:"flex", gap:10 }}>
            <button onClick={createMAR} disabled={loading} style={{ padding:"9px 22px", background:"#16a34a", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Create MAR</button>
            <button onClick={() => setShowCreate(false)} style={{ padding:"9px 18px", background:"white", border:"1px solid #d1d5db", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* MAR loaded */}
      {mar && (
        <>
          {/* Patient header */}
          <div style={sectionStyle}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
              <div>
                <h3 style={{ fontWeight:700, fontSize:16, margin:"0 0 4px" }}>MAR — {new Date(mar.date).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</h3>
                <p style={{ fontSize:13, color:"#6b7280", margin:0 }}>
                  Patient: <strong>{mar.patientName}</strong> &nbsp;|&nbsp; UHID: {mar.UHID} &nbsp;|&nbsp; IPD: {mar.ipdNo}
                </p>
                {mar.allergies?.length > 0 && (
                  <div style={{ marginTop:8, display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ fontSize:11, fontWeight:700, color:"#dc2626" }}>ALLERGIES:</span>
                    {mar.allergies.map((a,i) => (
                      <span key={i} style={{ padding:"2px 8px", background:"#fef2f2", color:"#dc2626", borderRadius:20, fontSize:11, fontWeight:600 }}>{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setShowAddMed(v => !v)}
                style={{ padding:"9px 18px", background:"#16a34a", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                {showAddMed ? "✕ Cancel" : "+ Add Medication"}
              </button>
            </div>
          </div>

          {/* Add Medication */}
          {showAddMed && (
            <div style={{ ...sectionStyle, border:"2px solid #bbf7d0", background:"#f0fdf4" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, paddingBottom:10, borderBottom:"1px solid #bbf7d0" }}>
                <h3 style={{ fontWeight:700, fontSize:14, color:"#166534", margin:0 }}>Add Medication to MAR</h3>
                <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px,1fr))", gap:12, marginBottom:12 }}>
                {[["medicineName","Medicine Name *"],["genericName","Generic Name"],["dose","Dose"],["unit","Unit (mg/ml)"],["frequency","Frequency"],["scheduledTimes","Scheduled Times (comma sep.)"],["prescribedByName","Prescribed By"]].map(([name,label]) => (
                  <div key={name}>
                    <label style={lCls}>{label}</label>
                    <input style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                      name={name} value={newMed[name]} onChange={e => setNewMed(p => ({...p, [e.target.name]:e.target.value}))} />
                  </div>
                ))}
                <div>
                  <label style={lCls}>Route</label>
                  <select style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                    value={newMed.route} onChange={e => setNewMed(p => ({...p, route:e.target.value}))}>
                    {ROUTES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lCls}>Start Date</label>
                  <input type="date" style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                    value={newMed.startDate} onChange={e => setNewMed(p => ({...p, startDate:e.target.value}))} />
                </div>
              </div>
              <div style={{ display:"flex", gap:16, marginBottom:12 }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={newMed.isHighAlert} onChange={e => setNewMed(p => ({...p, isHighAlert:e.target.checked}))} />
                  <span style={{ color:"#dc2626", fontWeight:600 }}>High Alert Medication</span>
                </label>
                <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={newMed.isLASA} onChange={e => setNewMed(p => ({...p, isLASA:e.target.checked}))} />
                  <span style={{ color:"#ea580c", fontWeight:600 }}>LASA Drug</span>
                </label>
              </div>
              {(newMed.isHighAlert || newMed.isLASA) && (
                <div style={{ marginBottom:12 }}>
                  <label style={lCls}>Special Instructions</label>
                  <textarea style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit", resize:"vertical", minHeight:60 }}
                    rows={2} value={newMed.specialInstructions} onChange={e => setNewMed(p => ({...p, specialInstructions:e.target.value}))} />
                </div>
              )}
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={addMedication} disabled={loading} style={{ padding:"9px 22px", background:"#16a34a", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Add to MAR</button>
                <button onClick={() => setShowAddMed(false)} style={{ padding:"9px 18px", background:"white", border:"1px solid #d1d5db", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── STEP 1: Admission Chart Setup ── */}
          <div style={{ ...sectionStyle, background:"#fffbeb", border:"1px solid #fcd34d" }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#92400e", textTransform:"uppercase", letterSpacing:".8px", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Step 1 — Admission Details &amp; Day 1 Dose Timing
            </div>
            <div style={{ display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap", marginBottom:14 }}>
              <div>
                <label style={{ ...lCls, color:"#92400e" }}>Admission Date</label>
                <input type="date" value={admDate} onChange={e => setAdmDate(e.target.value)}
                  style={{ padding:"8px 12px", border:"1.5px solid #fcd34d", borderRadius:8, fontSize:13, outline:"none", fontFamily:"inherit", background:"white" }} />
              </div>
              <div>
                <label style={{ ...lCls, color:"#92400e" }}>Admission Time</label>
                <input type="time" value={admTime} onChange={e => setAdmTime(e.target.value)}
                  style={{ padding:"8px 12px", border:"1.5px solid #fcd34d", borderRadius:8, fontSize:13, outline:"none", fontFamily:"monospace", background:"white" }} />
              </div>
              <div>
                <label style={{ ...lCls, color:"#92400e" }}>View Day</label>
                <select value={viewDay} onChange={e => setViewDay(parseInt(e.target.value))}
                  style={{ padding:"8px 12px", border:"1.5px solid #fcd34d", borderRadius:8, fontSize:13, outline:"none", fontFamily:"inherit", background:"white" }}>
                  {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>Day {d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...lCls, color:"#92400e" }}>Grace Window</label>
                <select value={graceMin} onChange={e => setGraceMin(parseInt(e.target.value))}
                  style={{ padding:"8px 12px", border:"1.5px solid #fcd34d", borderRadius:8, fontSize:13, outline:"none", fontFamily:"inherit", background:"white" }}>
                  <option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option>
                </select>
              </div>
            </div>

            {/* Day 1 custom times */}
            <div style={{ background:"white", border:"1px solid #fcd34d", borderRadius:10, padding:"14px 16px", marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#92400e", textTransform:"uppercase", letterSpacing:".7px", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Day 1 Custom Dose Times — Doctor fills once
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px,1fr))", gap:12 }}>
                {Object.entries(FREQ_MAP).map(([freq, count]) => {
                  const [fc, fb] = (FREQ_COLOR[freq]||"#9ca3af:#f9fafb").split(":");
                  return (
                    <div key={freq} style={{ border:"1.5px solid #e2e6ea", borderRadius:8, padding:"10px 12px", background:"#f9fafb" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700, background:fb, color:fc }}>{freq}</span>
                        <span style={{ fontSize:11, color:"#6b7280" }}>{count} dose{count>1?"s":""}/day</span>
                      </div>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        {(day1Times[freq]||[]).map((t, idx) => (
                          <div key={idx} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                            <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"#9ca3af" }}>Dose {idx+1}</span>
                            <input type="time" value={t}
                              onChange={e => {
                                const vals = [...(day1Times[freq]||[])];
                                vals[idx] = e.target.value;
                                setDay1Times(prev => ({...prev, [freq]: vals}));
                              }}
                              style={{ padding:"6px 8px", border:`1.5px solid ${t?"#16a34a":"#e2e6ea"}`, borderRadius:6, fontSize:12, outline:"none", fontFamily:"monospace", width:94, background: t?"#f0fdf4":"white" }} />
                          </div>
                        ))}
                      </div>
                      {count > 1 && <div style={{ fontSize:10, color:"#9ca3af", marginTop:6, fontStyle:"italic" }}>Leave blank = skip that dose today</div>}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop:10, fontSize:11, color:"#92400e" }}>
                <strong>Day 2+ standard times:</strong> OD: 06:00 | BD: 06:00, 18:00 | TDS: 06:00, 14:00, 22:00 | QID: 06:00, 12:00, 18:00, 00:00
              </div>
            </div>

            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <button onClick={autofillDay1}
                style={{ padding:"9px 20px", background:"#1e40af", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                ⚡ Auto-fill Day 1
              </button>
              <button onClick={buildChart}
                style={{ padding:"9px 22px", background:"#16a34a", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>
                ✓ Build Chart
              </button>
              {chartBuilt && (
                <span style={{ fontSize:12, color:"#16a34a", fontWeight:700, display:"flex", alignItems:"center", gap:5 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  Chart ready — {(mar.medications||[]).filter(m=>m.isActive).length} active medications
                </span>
              )}
            </div>
          </div>

          {/* Chart or List View */}
          {viewMode === "chart" && chartBuilt && (
            <MARChartView
              medications={mar.medications || []}
              scheduleData={scheduleData}
              viewDay={viewDay}
              graceMin={graceMin}
            />
          )}

          {/* Medication List */}
          {(viewMode === "list" || !chartBuilt) && (
            <>
              {(mar.medications||[]).length === 0 ? (
                <div style={{ ...sectionStyle, textAlign:"center", color:"#6b7280" }}>No medications added yet.</div>
              ) : (
                (mar.medications||[]).map((med, mi) => (
                  <div key={med._id||mi} style={{ ...sectionStyle, opacity: med.isActive?1:.6 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{med.medicineName}</span>
                          {med.genericName && <span style={{ fontSize:12, color:"#6b7280" }}>({med.genericName})</span>}
                          {med.isHighAlert && <span style={{ padding:"2px 8px", background:"#fee2e2", color:"#dc2626", borderRadius:6, fontSize:11, fontWeight:700 }}>HIGH ALERT</span>}
                          {med.isLASA && <span style={{ padding:"2px 8px", background:"#fff7ed", color:"#ea580c", borderRadius:6, fontSize:11, fontWeight:700 }}>LASA</span>}
                          {!med.isActive && <span style={{ padding:"2px 8px", background:"#f3f4f6", color:"#6b7280", borderRadius:6, fontSize:11 }}>DISCONTINUED</span>}
                        </div>
                        <p style={{ fontSize:12, color:"#6b7280", margin:"4px 0 0" }}>
                          {med.dose}{med.unit} &nbsp;•&nbsp; {med.route} &nbsp;•&nbsp; {med.frequency}
                          {med.scheduledTimes?.length > 0 && ` • Times: ${med.scheduledTimes.join(", ")}`}
                        </p>
                        {med.prescribedByName && <p style={{ fontSize:11, color:"#9ca3af", margin:"2px 0 0" }}>Prescribed by: {med.prescribedByName}</p>}
                        {med.specialInstructions && <p style={{ fontSize:11, color:"#d97706", margin:"4px 0 0" }}>⚠ {med.specialInstructions}</p>}
                        {!med.isActive && med.discontinueReason && <p style={{ fontSize:11, color:"#dc2626", margin:"4px 0 0" }}>Discontinued: {med.discontinueReason}</p>}
                      </div>
                      {med.isActive && (
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={() => setAdminDialog(med._id)}
                            style={{ padding:"6px 14px", background:"#1e40af", color:"white", border:"none", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer" }}>
                            Record Admin
                          </button>
                          <button onClick={() => discontinue(med._id)}
                            style={{ padding:"6px 12px", background:"#fef2f2", color:"#dc2626", border:"1px solid #fecaca", borderRadius:7, fontSize:12, cursor:"pointer" }}>
                            Discontinue
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Admin log */}
                    {med.administrations?.length > 0 && (
                      <div>
                        <p style={{ fontSize:11, fontWeight:600, color:"#6b7280", marginBottom:6 }}>Administration Log:</p>
                        <div style={{ overflowX:"auto" }}>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                            <thead>
                              <tr style={{ background:"#f9fafb" }}>
                                {["Scheduled","Actual Time","Status","Nurse","Batch No.","Remarks"].map(h => (
                                  <th key={h} style={{ border:"1px solid #e5e7eb", padding:"7px 10px", textAlign:"left", fontSize:11 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {med.administrations.map((a, ai) => {
                                const [sc, sb] = (STATUS_COLORS[a.status]||"#9ca3af:#f9fafb").split(":");
                                return (
                                  <tr key={ai} style={{ borderTop:"1px solid #e5e7eb" }}>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>{a.scheduledTime||"-"}</td>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>{a.actualTime ? new Date(a.actualTime).toLocaleTimeString() : "-"}</td>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>
                                      <span style={{ padding:"2px 8px", borderRadius:20, fontSize:11, background:sb, color:sc, fontWeight:600 }}>{a.status}</span>
                                    </td>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>{a.nurseName||"-"}</td>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>{a.batchNumber||"-"}</td>
                                    <td style={{ border:"1px solid #e5e7eb", padding:"7px 10px" }}>{a.remarks||a.reason||"-"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {/* Nurse Signatures */}
          <div style={sectionStyle}>
            <h3 style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Nurse Verification &amp; Signatures</h3>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12 }}>
              {[["Morning Shift (6 AM – 2 PM)"],["Evening Shift (2 PM – 10 PM)"],["Night Shift (10 PM – 6 AM)"]].map(([label]) => (
                <div key={label} style={{ border:"1.5px dashed #d1d5db", borderRadius:8, padding:12 }}>
                  <label style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:"#6b7280", display:"block", marginBottom:8 }}>{label}</label>
                  <input style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:6, fontSize:12, outline:"none", fontFamily:"inherit" }}
                    placeholder="Name + Employee ID" />
                </div>
              ))}
            </div>
          </div>

          {/* Administration Dialog */}
          {adminDialog && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500 }}>
              <div style={{ background:"white", borderRadius:14, boxShadow:"0 20px 60px rgba(0,0,0,.25)", padding:28, width:"min(440px,94vw)" }}>
                <h3 style={{ fontWeight:700, color:"#1e293b", marginBottom:18, fontSize:15 }}>Record Medication Administration</h3>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  {[["scheduledTime","Scheduled Time","text","08:00"],["nurseName","Nurse Name","text",""],["batchNumber","Batch / Lot No.","text",""]].map(([name,label,type,ph]) => (
                    <div key={name}>
                      <label style={lCls}>{label}</label>
                      <input type={type} placeholder={ph}
                        style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                        value={adminEntry[name]} onChange={e => setAdminEntry(p => ({...p, [name]:e.target.value}))} />
                    </div>
                  ))}
                  <div>
                    <label style={lCls}>Status *</label>
                    <select style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                      value={adminEntry.status} onChange={e => setAdminEntry(p => ({...p, status:e.target.value}))}>
                      {["GIVEN","HELD","REFUSED","NOT_AVAILABLE","MISSED"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  {adminEntry.status !== "GIVEN" && (
                    <div style={{ gridColumn:"1/-1" }}>
                      <label style={lCls}>Reason (for Hold/Refuse/Miss)</label>
                      <input style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit" }}
                        value={adminEntry.reason} onChange={e => setAdminEntry(p => ({...p, reason:e.target.value}))} />
                    </div>
                  )}
                  <div style={{ gridColumn:"1/-1" }}>
                    <label style={lCls}>Remarks</label>
                    <textarea style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 12px", fontSize:13, outline:"none", fontFamily:"inherit", resize:"vertical", minHeight:60 }}
                      rows={2} value={adminEntry.remarks} onChange={e => setAdminEntry(p => ({...p, remarks:e.target.value}))} />
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:18 }}>
                  <button onClick={() => setAdminDialog(null)} style={{ padding:"9px 18px", background:"white", border:"1px solid #d1d5db", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
                  <button onClick={recordAdmin} disabled={loading} style={{ padding:"9px 22px", background:"#1e40af", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Record</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pharmacy Indent Modal */}
      {showIndent && mar && (
        <PharmacyIndentModal
          mar={mar}
          scheduleData={scheduleData}
          admDate={admDate}
          onClose={() => setShowIndent(false)}
        />
      )}
      {showSetup && (
        <SignaturePad
          existing={signature}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export default function MARPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={adm => setSelectedPatient(adm)} selectedId={selectedPatient?._id} pageType="MAR">
      <MARPageContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
