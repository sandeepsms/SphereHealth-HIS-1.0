/**
 * BillingAuditTrailPage.jsx
 * Full clinical billing audit trail — every charge shows when ordered,
 * who completed it, when billed, and full source context.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", slate: "#1e293b", slateMid: "#334155",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red:   "#dc2626", redL:   "#fef2f2", redB:   "#fecaca",
  blue:  "#1d4ed8", blueL:  "#eff6ff", blueB:  "#bfdbfe",
  purple:"#7c3aed", purpleL:"#f5f3ff", purpleB:"#ddd6fe",
  indigo:"#4f46e5", indigoL:"#eef2ff",
  orange:"#ea580c", orangeL:"#fff7ed",
  teal:  "#0d9488",
};
const fld = { padding:"9px 12px", border:`1.5px solid ${C.border}`, borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:C.text, outline:"none", background:"white", width:"100%", boxSizing:"border-box" };
const sel = { ...fld, cursor:"pointer" };
const lbl = { display:"block", fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:4 };

// ─── Source type metadata ──────────────────────────────────────────────────────
const SOURCE_META = {
  NurseNote:          { icon:"pi-heart",              color:C.teal,   bg:C.primaryL,  label:"Nurse Note"        },
  DoctorNote:         { icon:"pi-file-edit",          color:C.blue,   bg:C.blueL,     label:"Doctor Note"       },
  DoctorAssessment:   { icon:"pi-user-plus",          color:C.blue,   bg:C.blueL,     label:"Doctor Assessment" },
  DoctorVisit:        { icon:"pi-user",               color:C.indigo, bg:C.indigoL,   label:"Doctor Visit"      },
  MAR:                { icon:"pi-plus-circle",        color:C.green,  bg:C.greenL,    label:"Medication (MAR)"  },
  InvestigationOrder: { icon:"pi-desktop",            color:C.purple, bg:C.purpleL,   label:"Investigation"     },
  Equipment:          { icon:"pi-bolt",               color:C.orange, bg:C.orangeL,   label:"Equipment"         },
  CarePlan:           { icon:"pi-clipboard",          color:C.amber,  bg:C.amberL,    label:"Care Plan"         },
  Discharge:          { icon:"pi-sign-out",           color:C.red,    bg:C.redL,      label:"Discharge"         },
  Procedure:          { icon:"pi-cog",                color:C.orange, bg:C.orangeL,   label:"Procedure"         },
  AutoCharge:         { icon:"pi-sync",               color:C.muted,  bg:"#f1f5f9",   label:"Auto-Charge"       },
  Manual:             { icon:"pi-pencil",             color:C.slate,  bg:"#f1f5f9",   label:"Manual"            },
};

// ─── Status metadata ──────────────────────────────────────────────────────────
const STATUS_META = {
  pending:     { color:C.amber,   bg:C.amberL,  border:C.amberB,  icon:"pi-clock",         label:"Pending"     },
  in_progress: { color:C.blue,    bg:C.blueL,   border:C.blueB,   icon:"pi-spin pi-spinner",label:"In Progress" },
  completed:   { color:C.primary, bg:C.primaryL,border:"#99f6e4", icon:"pi-check",          label:"Completed"   },
  billed:      { color:C.green,   bg:C.greenL,  border:C.greenB,  icon:"pi-receipt",        label:"Billed"      },
  cancelled:   { color:C.red,     bg:C.redL,    border:C.redB,    icon:"pi-times",          label:"Cancelled"   },
  voided:      { color:C.muted,   bg:"#f1f5f9", border:C.border,  icon:"pi-ban",            label:"Voided"      },
  skipped:     { color:C.muted,   bg:"#f1f5f9", border:C.border,  icon:"pi-minus-circle",   label:"Skipped"     },
};

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_COLOR = { Doctor:"#1d4ed8", Nurse:"#0d9488", Lab:"#16a34a", System:"#64748b", Receptionist:"#7c3aed", Auto:"#64748b" };

function RoleBadge({ role, name }) {
  const col = ROLE_COLOR[role] || C.muted;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:col+"14", color:col, border:`1px solid ${col}30`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:700 }}>
      <i className={`pi ${role==="Doctor"?"pi-user":role==="Nurse"?"pi-heart":role==="Lab"?"pi-desktop":"pi-bolt"}`} style={{ fontSize:9 }} />
      {name || role}
    </span>
  );
}

// ─── Timeline step ────────────────────────────────────────────────────────────
function TimelineStep({ icon, color, done, last }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
      <div style={{ width:32, height:32, borderRadius:"50%", border:`2px solid ${done?color:C.border}`, background:done?color+"18":"white", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>
        <i className={`pi ${icon}`} style={{ fontSize:12, color:done?color:C.border }} />
      </div>
      {!last && <div style={{ width:2, flexGrow:1, minHeight:20, background:done?color+"40":C.border, margin:"2px 0" }} />}
    </div>
  );
}

// ─── Audit row ────────────────────────────────────────────────────────────────
function AuditRow({ trigger, onConfirm, confirmingId }) {
  const [expanded, setExpanded] = useState(false);
  const src  = SOURCE_META[trigger.sourceType] || SOURCE_META.Manual;
  const stat = STATUS_META[trigger.status]     || STATUS_META.pending;

  const fmtDt = (dt) => dt ? new Date(dt).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit", hour12:true }) : "—";
  const fmtTime = (dt) => dt ? new Date(dt).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true }) : null;

  // Timeline states
  const isOrdered    = !!trigger.orderedAt;
  const isCompleted  = !!trigger.completedAt || ["completed","billed"].includes(trigger.status);
  const isBilled     = trigger.status === "billed";
  const isPending    = trigger.status === "pending" && trigger.requiresConfirmation;

  return (
    <div style={{ background:C.card, border:`1.5px solid ${expanded?src.color:C.border}`, borderRadius:12, marginBottom:8, overflow:"hidden", transition:"border-color .15s", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>

      {/* ── Row header ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding:"12px 16px", display:"grid", gridTemplateColumns:"40px 1fr auto auto auto", gap:12, alignItems:"center", cursor:"pointer" }}
      >
        {/* Source icon */}
        <div style={{ width:36, height:36, borderRadius:9, background:src.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <i className={`pi ${src.icon}`} style={{ fontSize:14, color:src.color }} />
        </div>

        {/* Service name + source label */}
        <div style={{ minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:13, color:C.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {trigger.serviceName || trigger.serviceCode || "Unknown Service"}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, fontWeight:700, color:src.color, background:src.bg, padding:"1px 7px", borderRadius:5 }}>
              {src.label}
            </span>
            {trigger.serviceCode && (
              <span style={{ fontSize:10, color:C.muted, fontFamily:"monospace" }}>{trigger.serviceCode}</span>
            )}
            {trigger.isDailyCharge && (
              <span style={{ fontSize:9, color:C.amber, background:C.amberL, padding:"1px 6px", borderRadius:4, fontWeight:700 }}>1×/DAY</span>
            )}
          </div>
        </div>

        {/* Amount */}
        <div style={{ textAlign:"right", flexShrink:0 }}>
          {(trigger.totalAmount || 0) > 0 ? (
            <span style={{ fontWeight:800, fontSize:14, color:isBilled?C.green:C.text }}>
              ₹{(trigger.totalAmount || 0).toLocaleString("en-IN")}
            </span>
          ) : (
            <span style={{ fontSize:12, color:C.muted }}>—</span>
          )}
        </div>

        {/* Status badge */}
        <span style={{ background:stat.bg, color:stat.color, border:`1.5px solid ${stat.border}`, padding:"4px 10px", borderRadius:20, fontSize:10, fontWeight:700, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
          <i className={`pi ${stat.icon}`} style={{ fontSize:9 }} />
          {stat.label}
        </span>

        {/* Expand toggle */}
        <i className={`pi pi-chevron-${expanded?"up":"down"}`} style={{ fontSize:11, color:C.muted }} />
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ borderTop:`1px solid ${C.border}`, padding:"16px 16px" }}>

          {/* Audit timeline */}
          <div style={{ display:"grid", gridTemplateColumns:"32px 1fr", gap:"0 12px", marginBottom:16 }}>

            {/* ORDERED */}
            <TimelineStep icon="pi-file-edit" color={C.blue} done={isOrdered} last={false} />
            <div style={{ paddingBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:12, color:isOrdered?C.blue:C.muted, marginBottom:4 }}>
                <i className="pi pi-file-edit" style={{ marginRight:5, fontSize:11 }} />
                Ordered / Advised
              </div>
              {isOrdered ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <RoleBadge role={trigger.orderedByRole} name={trigger.orderedBy} />
                  <span style={{ fontSize:11, color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
                    <i className="pi pi-calendar" style={{ fontSize:9 }} />{fmtDt(trigger.orderedAt)}
                  </span>
                  {trigger.orderDetails && (
                    <span style={{ fontSize:11, color:C.slateMid, background:"#f1f5f9", padding:"2px 8px", borderRadius:6, flex:"1 1 100%" }}>
                      {trigger.orderDetails}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize:11, color:C.muted, fontStyle:"italic" }}>Not yet ordered</div>
              )}
            </div>

            {/* COMPLETED */}
            <TimelineStep icon="pi-check-circle" color={C.primary} done={isCompleted} last={false} />
            <div style={{ paddingBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:12, color:isCompleted?C.primary:C.muted, marginBottom:4 }}>
                <i className="pi pi-check-circle" style={{ marginRight:5, fontSize:11 }} />
                Completed / Performed
              </div>
              {isCompleted && trigger.completedBy ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <RoleBadge role={trigger.completedByRole} name={trigger.completedBy} />
                  <span style={{ fontSize:11, color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
                    <i className="pi pi-clock" style={{ fontSize:9 }} />{fmtDt(trigger.completedAt)}
                  </span>
                  {trigger.completionNotes && (
                    <span style={{ fontSize:11, color:C.slateMid, background:"#f1f5f9", padding:"2px 8px", borderRadius:6, flex:"1 1 100%" }}>
                      {trigger.completionNotes}
                    </span>
                  )}
                </div>
              ) : isCompleted ? (
                <div style={{ fontSize:11, color:C.muted }}>Completed (auto)</div>
              ) : (
                <div style={{ fontSize:11, color:C.muted, fontStyle:"italic" }}>Awaiting completion</div>
              )}
            </div>

            {/* BILLED */}
            <TimelineStep icon="pi-receipt" color={C.green} done={isBilled} last={true} />
            <div>
              <div style={{ fontWeight:700, fontSize:12, color:isBilled?C.green:C.muted, marginBottom:4 }}>
                <i className="pi pi-receipt" style={{ marginRight:5, fontSize:11 }} />
                Billed to Ledger
              </div>
              {isBilled ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ fontSize:11, color:C.green, fontWeight:700, display:"flex", alignItems:"center", gap:4 }}>
                    <i className="pi pi-check-circle" style={{ fontSize:11 }} />
                    ₹{(trigger.totalAmount || 0).toLocaleString("en-IN")} billed
                  </span>
                  <span style={{ fontSize:11, color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
                    <i className="pi pi-clock" style={{ fontSize:9 }} />{fmtDt(trigger.billedAt)}
                  </span>
                  {trigger.billedBy && <RoleBadge role="System" name={trigger.billedBy} />}
                  {trigger.billId?.billNumber && (
                    <span style={{ fontSize:10, fontFamily:"monospace", color:C.indigo, background:C.indigoL, padding:"1px 7px", borderRadius:5 }}>
                      {trigger.billId.billNumber}
                    </span>
                  )}
                  {trigger.autoCharged && (
                    <span style={{ fontSize:9, color:C.primary, background:C.primaryL, padding:"1px 6px", borderRadius:4, fontWeight:700 }}>
                      AUTO-BILLED
                    </span>
                  )}
                </div>
              ) : isPending ? (
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:11, color:C.amber, fontStyle:"italic" }}>Awaiting confirmation</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfirm(trigger._id); }}
                    disabled={confirmingId === trigger._id}
                    style={{
                      padding:"5px 14px", background:`linear-gradient(135deg,${C.primary},${C.primaryMid})`,
                      color:"white", border:"none", borderRadius:7, fontSize:11, fontWeight:700,
                      cursor:confirmingId===trigger._id?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:5,
                    }}>
                    <i className={`pi ${confirmingId===trigger._id?"pi-spin pi-spinner":"pi-check"}`} style={{ fontSize:10 }} />
                    {confirmingId===trigger._id?"Billing…":"Confirm & Bill"}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize:11, color:C.muted, fontStyle:"italic" }}>Not yet billed</div>
              )}
            </div>
          </div>

          {/* Metadata chips */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingTop:10, borderTop:`1px solid ${C.border}` }}>
            {trigger.shift && (
              <span style={{ fontSize:10, color:C.muted, background:"#f1f5f9", padding:"2px 8px", borderRadius:5 }}>
                <i className="pi pi-clock" style={{ fontSize:9, marginRight:3 }} />{trigger.shift}
              </span>
            )}
            {trigger.dateKey && (
              <span style={{ fontSize:10, color:C.muted, background:"#f1f5f9", padding:"2px 8px", borderRadius:5 }}>
                <i className="pi pi-calendar" style={{ fontSize:9, marginRight:3 }} />{trigger.dateKey}
              </span>
            )}
            {trigger.quantity > 1 && (
              <span style={{ fontSize:10, color:C.muted, background:"#f1f5f9", padding:"2px 8px", borderRadius:5 }}>
                ×{trigger.quantity} units
              </span>
            )}
            {trigger.sourceDocumentId && (
              <span style={{ fontSize:10, fontFamily:"monospace", color:C.muted, background:"#f1f5f9", padding:"2px 8px", borderRadius:5 }}>
                src: {trigger.sourceDocumentModel} · {trigger.sourceDocumentId.toString().slice(-6)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, color, sub }) {
  return (
    <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14, boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
      <div style={{ width:44, height:44, borderRadius:12, background:color+"18", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <i className={`pi ${icon}`} style={{ fontSize:20, color }} />
      </div>
      <div>
        <div style={{ fontSize:22, fontWeight:800, color:C.text, lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{label}</div>
        {sub && <div style={{ fontSize:11, fontWeight:700, color, marginTop:1 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function BillingAuditTrailPage() {
  const { user } = useAuth();
  const { uhid: uhidParam } = useParams();

  const [searchVal,    setSearchVal]    = useState(uhidParam || "");
  const [admission,    setAdmission]    = useState(null);
  const [loadingPt,    setLoadingPt]    = useState(false);

  const [triggers,     setTriggers]     = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [loading,      setLoading]      = useState(false);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [searchTerm,   setSearchTerm]   = useState("");

  const [confirmingId, setConfirmingId] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);
  const showToast = (msg, type="success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const authHeader = useCallback(() => {
    const t = localStorage.getItem("his_token");
    return t ? { Authorization:`Bearer ${t}` } : {};
  }, []);

  // ── Load audit trail ────────────────────────────────────────────────────────
  const loadAuditTrail = useCallback(async (admId) => {
    if (!admId) return;
    setLoading(true);
    try {
      const [trailRes, summaryRes] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BILLING_AUDIT_TRAIL}/${admId}`, { params:{ limit:500 }, headers:authHeader() }),
        axios.get(`${API_ENDPOINTS.BILLING_AUDIT_SUMMARY}/${admId}`, { headers:authHeader() }),
      ]);
      setTriggers(Array.isArray(trailRes.data?.triggers) ? trailRes.data.triggers : []);
      setSummary(summaryRes.data?.data || null);
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to load audit trail", "error");
    } finally { setLoading(false); }
  }, []);

  // ── Search patient ──────────────────────────────────────────────────────────
  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!searchVal.trim()) return;
    setLoadingPt(true);
    setAdmission(null); setTriggers([]); setSummary(null);
    try {
      const { data } = await axios.get(API_ENDPOINTS.ADMISSIONS, {
        params:{ uhid: searchVal.trim(), status:"Active", limit:1 },
        headers: authHeader(),
      });
      const arr = Array.isArray(data) ? data : data?.data || data?.admissions || [];
      if (arr[0]) {
        setAdmission(arr[0]);
        await loadAuditTrail(arr[0]._id);
        showToast(`Loaded: ${arr[0].patientName}`);
      } else {
        showToast("No active admission found for this UHID", "warn");
      }
    } catch {
      showToast("Patient not found", "error");
    } finally { setLoadingPt(false); }
  };

  // ── Auto-load when UHID is in URL ──────────────────────────────────────────
  useEffect(() => {
    if (uhidParam) handleSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhidParam]);

  // ── Confirm & bill a pending trigger ────────────────────────────────────────
  const handleConfirm = async (triggerId) => {
    setConfirmingId(triggerId);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING_CONFIRM_TRIGGER}/${triggerId}/confirm-bill`, {
        confirmedBy:   user?.fullName || `${user?.firstName||""} ${user?.lastName||""}`.trim(),
        confirmedByRole: user?.role || "Receptionist",
      }, { headers: authHeader() });
      showToast("Charge confirmed and billed");
      await loadAuditTrail(admission._id);
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to confirm charge", "error");
    } finally { setConfirmingId(null); }
  };

  // ── Filtered triggers ───────────────────────────────────────────────────────
  const filtered = triggers.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterSource !== "all" && t.sourceType !== filterSource) return false;
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      return (t.serviceName||"").toLowerCase().includes(s) ||
             (t.orderedBy||"").toLowerCase().includes(s) ||
             (t.completedBy||"").toLowerCase().includes(s) ||
             (t.serviceCode||"").toLowerCase().includes(s);
    }
    return true;
  });

  // Group filtered triggers by date
  const groupedByDate = filtered.reduce((acc, t) => {
    const key = t.dateKey || new Date(t.createdAt).toISOString().slice(0,10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});
  const sortedDates = Object.keys(groupedByDate).sort((a,b) => b.localeCompare(a));

  const uniqueSources = [...new Set(triggers.map(t => t.sourceType))];

  const fmtDate = () => new Date().toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"long", year:"numeric" });
  const fmtDateKey = (k) => new Date(k + "T00:00:00").toLocaleDateString("en-IN", { weekday:"short", day:"2-digit", month:"short", year:"numeric" });

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ background:C.bg, minHeight:"100vh", fontFamily:"'DM Sans',sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:20, right:20, zIndex:9999,
          background: toast.type==="error"?C.redL: toast.type==="warn"?C.amberL:C.greenL,
          border:`1.5px solid ${toast.type==="error"?C.redB:toast.type==="warn"?C.amberB:C.greenB}`,
          color: toast.type==="error"?C.red:toast.type==="warn"?C.amber:C.green,
          borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600,
          boxShadow:"0 4px 16px rgba(0,0,0,.12)", display:"flex", alignItems:"center", gap:8, minWidth:280,
        }}>
          <i className={`pi ${toast.type==="error"?"pi-times-circle":toast.type==="warn"?"pi-exclamation-triangle":"pi-check-circle"}`} style={{ fontSize:15 }} />
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        position:"sticky", top:0, zIndex:50,
        background:"linear-gradient(135deg,#1e293b,#0f766e)",
        padding:"14px 28px", display:"flex", justifyContent:"space-between", alignItems:"center",
        boxShadow:"0 4px 20px rgba(15,118,110,.2)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:42, height:42, borderRadius:12, background:"rgba(255,255,255,.15)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <i className="pi pi-list" style={{ fontSize:19, color:"#fff" }} />
          </div>
          <div>
            <div style={{ color:"#fff", fontWeight:800, fontSize:18 }}>Billing Audit Trail</div>
            <div style={{ color:"rgba(255,255,255,.65)", fontSize:12 }}>
              Every clinical charge — ordered · completed · billed · by whom · when
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {admission && (
            <div style={{ background:"rgba(255,255,255,.12)", border:"1px solid rgba(255,255,255,.2)", borderRadius:10, padding:"6px 14px" }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>{admission.patientName}</span>
              <span style={{ color:"rgba(255,255,255,.5)", fontSize:11, marginLeft:8 }}>· {admission.UHID}</span>
            </div>
          )}
          <div style={{ background:"rgba(255,255,255,.15)", borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:700, color:"#fff" }}>
            {fmtDate()}
          </div>
        </div>
      </div>

      <div style={{ padding:"20px 24px" }}>

        {/* ── Patient search ── */}
        <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"16px 18px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
          <form onSubmit={handleSearch} style={{ display:"flex", gap:10 }}>
            <input
              value={searchVal}
              onChange={e => setSearchVal(e.target.value.toUpperCase())}
              placeholder="Enter UHID to load audit trail…"
              style={{ ...fld, flex:1 }}
              autoFocus
            />
            <button type="submit" disabled={loadingPt} style={{
              padding:"10px 28px", background:`linear-gradient(135deg,${C.primary},${C.primaryMid})`,
              color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:700,
              cursor:loadingPt?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8,
              boxShadow:`0 4px 12px ${C.primary}30`, whiteSpace:"nowrap",
            }}>
              <i className={`pi ${loadingPt?"pi-spin pi-spinner":"pi-search"}`} style={{ fontSize:13 }} />
              {loadingPt?"Loading…":"Load Audit Trail"}
            </button>
            {admission && (
              <button type="button" onClick={() => loadAuditTrail(admission._id)} style={{
                padding:"10px 18px", border:`1.5px solid ${C.border}`, borderRadius:8,
                background:"white", fontSize:13, fontWeight:600, cursor:"pointer",
                color:C.muted, display:"flex", alignItems:"center", gap:6,
              }}>
                <i className="pi pi-refresh" style={{ fontSize:12 }} /> Refresh
              </button>
            )}
          </form>
        </div>

        {/* ── Patient info + summary cards ── */}
        {admission && summary && (
          <>
            {/* Patient strip */}
            <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"12px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
              <div style={{ width:42, height:42, borderRadius:11, background:`linear-gradient(135deg,${C.primary},${C.primaryMid})`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <i className="pi pi-user" style={{ fontSize:19, color:"white" }} />
              </div>
              <div>
                <div style={{ fontWeight:800, fontSize:16, color:C.text }}>{admission.patientName}</div>
                <div style={{ fontSize:12, color:C.muted }}>{admission.UHID} · Adm: {admission.admissionNumber} · {admission.admissionType || "IPD"}</div>
              </div>
              {[
                admission.wardId?.wardName && `Ward: ${admission.wardId.wardName}`,
                admission.bedId?.bedNumber && `Bed: ${admission.bedId.bedNumber}`,
                admission.department       && `Dept: ${admission.department}`,
              ].filter(Boolean).map(v => (
                <span key={v} style={{ fontSize:11, color:C.muted, background:"#f1f5f9", padding:"4px 10px", borderRadius:8 }}>{v}</span>
              ))}
            </div>

            {/* Summary cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:12, marginBottom:20 }}>
              <SummaryCard icon="pi-list"    label="Total Triggers"       value={summary.total}               color={C.blue}   />
              <SummaryCard icon="pi-receipt" label="Billed Charges"       value={summary.billed}              color={C.green}  sub={`₹${(summary.totalBilledAmount||0).toLocaleString("en-IN")}`} />
              <SummaryCard icon="pi-clock"   label="Pending"              value={summary.pending}             color={C.amber}  />
              <SummaryCard icon="pi-bell"    label="Needs Confirmation"   value={summary.pendingConfirmation} color={C.red}    />
            </div>
          </>
        )}

        {/* ── Filters ── */}
        {triggers.length > 0 && (
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 16px", marginBottom:16, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search service, doctor, nurse…"
              style={{ ...fld, maxWidth:260 }}
            />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...sel, maxWidth:160 }}>
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_META).map(([k,v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={{ ...sel, maxWidth:200 }}>
              <option value="all">All Sources</option>
              {uniqueSources.map(s => (
                <option key={s} value={s}>{SOURCE_META[s]?.label || s}</option>
              ))}
            </select>
            <span style={{ fontSize:12, color:C.muted, marginLeft:"auto" }}>
              Showing {filtered.length} of {triggers.length} entries
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ textAlign:"center", padding:"48px 0" }}>
            <div style={{ width:44, height:44, borderRadius:"50%", border:`3px solid ${C.border}`, borderTopColor:C.primary, animation:"spin 1s linear infinite", margin:"0 auto 14px" }} />
            <div style={{ fontSize:13, color:C.muted }}>Loading audit trail…</div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* ── Audit trail grouped by date ── */}
        {!loading && sortedDates.map(dateKey => {
          const dayTriggers = groupedByDate[dateKey];
          const dayTotal    = dayTriggers.filter(t => t.status==="billed").reduce((s,t) => s+(t.totalAmount||0), 0);
          const dayPending  = dayTriggers.filter(t => t.status==="pending").length;

          return (
            <div key={dateKey} style={{ marginBottom:24 }}>
              {/* Date divider */}
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                <div style={{ background:C.slate, color:"white", borderRadius:8, padding:"5px 14px", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
                  <i className="pi pi-calendar" style={{ fontSize:11, marginRight:5 }} />
                  {fmtDateKey(dateKey)}
                </div>
                <div style={{ flex:1, height:1, background:C.border }} />
                <div style={{ display:"flex", gap:8 }}>
                  {dayTotal > 0 && (
                    <span style={{ fontSize:11, fontWeight:700, color:C.green, background:C.greenL, padding:"3px 10px", borderRadius:20, border:`1px solid ${C.greenB}` }}>
                      ₹{dayTotal.toLocaleString("en-IN")} billed
                    </span>
                  )}
                  {dayPending > 0 && (
                    <span style={{ fontSize:11, fontWeight:700, color:C.amber, background:C.amberL, padding:"3px 10px", borderRadius:20, border:`1px solid ${C.amberB}` }}>
                      {dayPending} pending
                    </span>
                  )}
                </div>
              </div>

              {/* Triggers for this date */}
              {dayTriggers.map(t => (
                <AuditRow
                  key={t._id}
                  trigger={t}
                  onConfirm={handleConfirm}
                  confirmingId={confirmingId}
                />
              ))}
            </div>
          );
        })}

        {/* ── Empty state ── */}
        {!loading && triggers.length === 0 && !admission && (
          <div style={{ textAlign:"center", padding:"60px 24px" }}>
            <div style={{ width:72, height:72, borderRadius:18, background:`linear-gradient(135deg,${C.primary},${C.primaryMid})`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", boxShadow:`0 8px 24px ${C.primary}30` }}>
              <i className="pi pi-list" style={{ fontSize:32, color:"white" }} />
            </div>
            <div style={{ fontWeight:800, fontSize:20, color:C.slateMid, marginBottom:8 }}>Clinical Billing Audit Trail</div>
            <div style={{ fontSize:14, color:C.muted, maxWidth:500, margin:"0 auto 28px" }}>
              Enter a patient UHID to see the complete billing timeline — every charge automatically captured from doctor notes, nursing actions, MAR administration, investigations, and equipment use.
            </div>
            <div style={{ display:"flex", justifyContent:"center", gap:12, flexWrap:"wrap" }}>
              {[
                { icon:"pi-file-edit", color:C.blue,   label:"Doctor Notes",       desc:"Assessment & visit charges" },
                { icon:"pi-heart",     color:C.teal,   label:"Nurse Actions",       desc:"Procedures, dressings, IV" },
                { icon:"pi-plus-circle",color:C.green, label:"MAR Administration",  desc:"Drug administration fees" },
                { icon:"pi-desktop",   color:C.purple, label:"Investigations",      desc:"Lab orders → bill on result" },
                { icon:"pi-bolt",      color:C.orange, label:"Equipment",           desc:"Devices used this shift" },
              ].map(f => (
                <div key={f.label} style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"16px 18px", width:160, textAlign:"left" }}>
                  <div style={{ width:36, height:36, borderRadius:9, background:f.color+"18", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:10 }}>
                    <i className={`pi ${f.icon}`} style={{ fontSize:16, color:f.color }} />
                  </div>
                  <div style={{ fontWeight:700, fontSize:12, color:C.text, marginBottom:4 }}>{f.label}</div>
                  <div style={{ fontSize:11, color:C.muted }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && triggers.length === 0 && admission && (
          <div style={{ textAlign:"center", padding:"40px 0", color:C.muted }}>
            <i className="pi pi-inbox" style={{ fontSize:36, display:"block", marginBottom:12, opacity:.4 }} />
            <div style={{ fontSize:14, fontWeight:600 }}>No billing triggers yet</div>
            <div style={{ fontSize:12, marginTop:4 }}>Triggers will appear here as doctors and nurses complete clinical actions</div>
          </div>
        )}
      </div>
    </div>
  );
}
