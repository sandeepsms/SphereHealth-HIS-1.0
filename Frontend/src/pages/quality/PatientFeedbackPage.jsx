/**
 * PatientFeedbackPage — staff surface for NABH PRE.3 patient satisfaction &
 * experience feedback. Two tabs:
 *   • New Feedback — reception / discharge-desk entry, OR mint a patient
 *     link/QR the patient fills on their own phone.
 *   • Dashboard    — category averages, NPS, response mix, recent comments
 *     (gated on feedback.read).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { API_BASE_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { roleCan } from "../../config/permissions";
import { CategoryRatings, NpsScale, FeedbackTextFields, CATEGORY_META, emptyRatings } from "./feedbackShared";
import { openPrint } from "../../Components/print/openPrint";
// R7hr(FDBK-X2) — WhatsApp/SMS share of the minted link.
import { getTemplate, buildWhatsAppURL } from "../../Components/whatsapp/whatsapp-templates";

const FB = `${API_BASE_URL}/feedback`;
const authHeaders = () => ({ headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` } });
const VISIT_TYPES = ["OPD", "IPD", "Emergency", "Daycare", "Walk-in"];
const scoreColor = (v) => (v >= 4 ? "#16a34a" : v >= 3 ? "#d97706" : v > 0 ? "#dc2626" : "#94a3b8");

export default function PatientFeedbackPage() {
  const { user } = useAuth();
  const canRead = roleCan(user?.role, "feedback.read");
  const [tab, setTab] = useState("new");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 16px 60px", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <i className="pi pi-comments" style={{ fontSize: 26, color: "#4338ca" }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1e293b" }}>Patient Feedback</h1>
          <div style={{ fontSize: 13, color: "#64748b" }}>NABH PRE.3 · satisfaction &amp; experience</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "14px 0 18px", borderBottom: "1px solid #e2e8f0" }}>
        <TabBtn active={tab === "new"} onClick={() => setTab("new")} icon="pi-plus-circle" label="New Feedback" />
        {canRead && <TabBtn active={tab === "dash"} onClick={() => setTab("dash")} icon="pi-chart-bar" label="Dashboard" />}
      </div>

      {tab === "new" ? <NewFeedback user={user} /> : <Dashboard />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
      border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
      color: active ? "#4338ca" : "#64748b", borderBottom: active ? "3px solid #4338ca" : "3px solid transparent",
      marginBottom: -1,
    }}>
      <i className={`pi ${icon}`} /> {label}
    </button>
  );
}

/* ══════════════════════ NEW FEEDBACK (staff entry + link/QR) ══════════════ */
function NewFeedback({ user }) {
  const blank = { UHID: "", patientName: "", contactNumber: "", visitType: "OPD", department: "", ward: "", anonymous: false };
  const [ctx, setCtx] = useState(blank);
  const [ratings, setRatings] = useState(emptyRatings());
  const [npsScore, setNpsScore] = useState(null);
  const [text, setText] = useState({ wentWell: "", improvements: "" });
  const [contactConsent, setContactConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState(null); // { url, qr }

  const setRating = (k, v) => setRatings((r) => ({ ...r, [k]: v }));
  const setField = (k, v) => setText((t) => ({ ...t, [k]: v }));
  const setC = (k, v) => setCtx((c) => ({ ...c, [k]: v }));
  const answered = useMemo(() => Object.values(ratings).some((v) => v > 0) || npsScore != null, [ratings, npsScore]);

  const reset = () => { setCtx(blank); setRatings(emptyRatings()); setNpsScore(null); setText({ wentWell: "", improvements: "" }); setContactConsent(false); };

  const submit = async () => {
    if (!answered) { toast.warn("Rate at least one item before submitting."); return; }
    setSaving(true);
    try {
      await axios.post(FB, { ...ctx, ratings, npsScore, ...text, contactConsent }, authHeaders());
      toast.success("Feedback recorded. Thank you!");
      reset();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not save feedback.");
    } finally { setSaving(false); }
  };

  const generate = async () => {
    setSaving(true);
    try {
      const { data } = await axios.post(`${FB}/generate-link`, { ...ctx }, authHeaders());
      const url = `${window.location.origin}${data.data.path}`;
      const qr = await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } });
      setLink({ url, qr, ctx: { ...ctx }, expiresAt: data.data.expiresAt });
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not generate link.");
    } finally { setSaving(false); }
  };

  const printSlip = () => {
    if (!link) return;
    openPrint("feedback-slip", {
      url: link.url, qr: link.qr,
      patientName: link.ctx?.patientName, UHID: link.ctx?.UHID,
      visitType: link.ctx?.visitType, department: link.ctx?.department,
      date: new Date().toISOString(), validUntil: link.expiresAt,
    });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); toast.success("Link copied — share via WhatsApp / SMS"); }
    catch { toast.info("Copy manually: " + link.url); }
  };

  // R7hr(FDBK-X2) — direct share. WhatsApp: wa.me click-to-chat with the
  // shared feedback_link template (no number → WhatsApp's own contact
  // picker). SMS: sms: URI — works on the phone/tablet reception devices;
  // desktop browsers ignore it, so the copy button stays the fallback.
  const feedbackMessage = () =>
    getTemplate("feedback_link").build({
      patientName: link?.ctx?.patientName || "Sir/Madam",
      feedbackUrl: link?.url || "",
    });
  const shareWhatsApp = () => {
    const text = feedbackMessage();
    const to = buildWhatsAppURL(link?.ctx?.contactNumber, text)
      || `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(to, "_blank", "noopener");
  };
  const shareSms = () => {
    const digits = String(link?.ctx?.contactNumber || "").replace(/\D/g, "");
    window.location.href = `sms:${digits}?body=${encodeURIComponent(feedbackMessage())}`;
  };

  const field = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #e2e8f0", fontSize: 14, fontFamily: "inherit" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 18 }}>
      <Panel title="Patient / visit" icon="pi-user">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <L label="UHID (optional)"><input style={field} value={ctx.UHID} onChange={(e) => setC("UHID", e.target.value.toUpperCase())} placeholder="UH01" /></L>
          <L label="Patient name"><input style={field} value={ctx.patientName} onChange={(e) => setC("patientName", e.target.value)} disabled={ctx.anonymous} placeholder={ctx.anonymous ? "Anonymous" : ""} /></L>
          <L label="Contact number"><input style={field} value={ctx.contactNumber} onChange={(e) => setC("contactNumber", e.target.value)} disabled={ctx.anonymous} /></L>
          <L label="Visit type"><select style={field} value={ctx.visitType} onChange={(e) => setC("visitType", e.target.value)}>{VISIT_TYPES.map((v) => <option key={v}>{v}</option>)}</select></L>
          <L label="Department"><input style={field} value={ctx.department} onChange={(e) => setC("department", e.target.value)} placeholder="General Medicine" /></L>
          <L label="Ward (IPD)"><input style={field} value={ctx.ward} onChange={(e) => setC("ward", e.target.value)} /></L>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={ctx.anonymous} onChange={(e) => setC("anonymous", e.target.checked)} /> Record anonymously
        </label>
      </Panel>

      <Panel title="Ratings" icon="pi-star">
        <CategoryRatings ratings={ratings} setRating={setRating} />
      </Panel>

      <Panel title="Recommendation & comments" icon="pi-thumbs-up">
        <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14, marginBottom: 8 }}>How likely to recommend us? (0-10)</div>
        <NpsScale value={npsScore} onChange={setNpsScore} />
        <div style={{ marginTop: 18 }}><FeedbackTextFields wentWell={text.wentWell} improvements={text.improvements} setField={setField} /></div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={contactConsent} onChange={(e) => setContactConsent(e.target.checked)} /> Patient consents to follow-up contact
        </label>
      </Panel>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={submit} disabled={saving} style={btn("#4338ca")}>
          <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Submit feedback
        </button>
        <button onClick={generate} disabled={saving} style={btn("#0891b2", true)}>
          <i className="pi pi-qrcode" /> Generate patient link / QR
        </button>
      </div>

      {link && (
        <div onClick={() => setLink(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,13,28,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 24, width: 340, textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#1e293b", marginBottom: 4 }}>Patient feedback link</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>Patient scans the QR or opens the link on their phone.</div>
            <img src={link.qr} alt="Feedback QR" style={{ width: 220, height: 220, borderRadius: 12, border: "1px solid #e2e8f0" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <input readOnly value={link.url} style={{ ...field, fontSize: 12 }} onFocus={(e) => e.target.select()} />
              <button onClick={copy} style={{ ...btn("#4338ca"), padding: "9px 14px", whiteSpace: "nowrap" }}><i className="pi pi-copy" /></button>
            </div>
            <button onClick={printSlip} style={{ ...btn("#0891b2"), width: "100%", marginTop: 10, justifyContent: "center" }}>
              <i className="pi pi-print" /> Print feedback slip
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={shareWhatsApp} style={{ ...btn("#16a34a"), flex: 1, justifyContent: "center" }}>
                <i className="pi pi-whatsapp" /> WhatsApp
              </button>
              <button onClick={shareSms} style={{ ...btn("#64748b"), flex: 1, justifyContent: "center" }}>
                <i className="pi pi-envelope" /> SMS
              </button>
            </div>
            <button onClick={() => setLink(null)} style={{ marginTop: 12, background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ DASHBOARD ═══════════════════════════════════════ */
function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: monthAgo, to: today, visitType: "", department: "" });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await axios.get(`${FB}/stats`, { ...authHeaders(), params });
      setStats(data.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not load dashboard.");
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const field = { padding: "8px 10px", borderRadius: 9, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit" };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <L label="From"><input type="date" style={field} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></L>
        <L label="To"><input type="date" style={field} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></L>
        <L label="Visit type"><select style={field} value={filters.visitType} onChange={(e) => setFilters((f) => ({ ...f, visitType: e.target.value }))}><option value="">All</option>{VISIT_TYPES.map((v) => <option key={v}>{v}</option>)}</select></L>
        <L label="Department"><input style={field} value={filters.department} onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))} placeholder="All" /></L>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}><i className="pi pi-spin pi-spinner" style={{ fontSize: 24, color: "#4338ca" }} /></div>
      ) : !stats || stats.count === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 44, background: "#fff", borderRadius: 14, border: "1px dashed #e2e8f0" }}>
          <i className="pi pi-inbox" style={{ fontSize: 30 }} /><div style={{ marginTop: 8 }}>No feedback in this period yet.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <Stat label="Responses" value={stats.count} icon="pi-users" color="#4338ca" />
            <Stat label="Overall rating" value={`${stats.overallAverage || 0} / 5`} icon="pi-star-fill" color={scoreColor(stats.overallAverage)} />
            <Stat label="Net Promoter Score" value={stats.nps == null ? "—" : stats.nps} icon="pi-thumbs-up" color={stats.nps >= 30 ? "#16a34a" : stats.nps >= 0 ? "#d97706" : "#dc2626"} sub={stats.nps == null ? "" : `${stats.npsBreakdown.promoters}👍 / ${stats.npsBreakdown.detractors}👎`} />
          </div>

          <Panel title="Category averages" icon="pi-chart-bar">
            <div style={{ display: "grid", gap: 9 }}>
              {CATEGORY_META.map((c) => {
                const v = stats.categoryAverages[c.key] || 0;
                return (
                  <div key={c.key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 44px", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>{c.label}</span>
                    <div style={{ height: 12, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ width: `${(v / 5) * 100}%`, height: "100%", background: scoreColor(v), transition: "width .4s" }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: scoreColor(v), textAlign: "right" }}>{v || "—"}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {stats.byVisitType?.length > 0 && (
            <Panel title="By visit type" icon="pi-sitemap">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {stats.byVisitType.map((r) => (
                  <div key={r.visitType} style={{ padding: "10px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #eef2f7", minWidth: 120 }}>
                    <div style={{ fontWeight: 800, color: "#1e293b" }}>{r.visitType}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{r.count} responses · {r.avgOverall || "—"}/5</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title={`Recent comments (${stats.comments?.length || 0})`} icon="pi-comment">
            {stats.comments?.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {stats.comments.map((c, i) => (
                  <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #eef2f7" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>{c.name} · <span style={{ color: "#64748b", fontWeight: 500 }}>{c.visitType}{c.department ? ` · ${c.department}` : ""}</span></span>
                      <span style={{ fontSize: 12, color: scoreColor(c.overall), fontWeight: 700 }}>{c.overall ? `★ ${c.overall}/5` : ""}{c.npsScore != null ? ` · NPS ${c.npsScore}` : ""}</span>
                    </div>
                    {c.wentWell ? <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}><i className="pi pi-thumbs-up" style={{ color: "#16a34a", fontSize: 12 }} /> {c.wentWell}</div> : null}
                    {c.improvements ? <div style={{ fontSize: 13, color: "#334155", marginTop: 3 }}><i className="pi pi-wrench" style={{ color: "#d97706", fontSize: 12 }} /> {c.improvements}</div> : null}
                  </div>
                ))}
              </div>
            ) : <div style={{ color: "#94a3b8", fontSize: 13 }}>No written comments in this period.</div>}
          </Panel>
        </>
      )}
    </div>
  );
}

/* ── small shared bits ── */
function Panel({ title, icon, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eef2f7", boxShadow: "0 4px 14px rgba(30,41,59,.05)", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontWeight: 800, color: "#1e293b", fontSize: 15 }}>
        <i className={`pi ${icon}`} style={{ color: "#4338ca" }} /> {title}
      </div>
      {children}
    </div>
  );
}
function L({ label, children }) {
  return <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}{children}</label>;
}
function Stat({ label, value, icon, color, sub }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eef2f7", padding: "14px 16px", boxShadow: "0 4px 14px rgba(30,41,59,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 12, fontWeight: 600 }}><i className={`pi ${icon}`} style={{ color }} /> {label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div> : null}
    </div>
  );
}
const btn = (color, outline = false) => ({
  display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 20px", borderRadius: 11,
  border: outline ? `1.5px solid ${color}` : "none", background: outline ? "#fff" : color,
  color: outline ? color : "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer",
  boxShadow: outline ? "none" : "0 6px 16px rgba(67,56,202,.25)",
});
