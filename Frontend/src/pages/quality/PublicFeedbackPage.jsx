/**
 * PublicFeedbackPage — the no-login page a patient opens on their phone via a
 * shared link / QR (/feedback/:token). Rendered OUTSIDE the authenticated app
 * shell (see App.jsx), so it carries its own minimal chrome. Talks only to the
 * public, rate-limited, token-scoped endpoints — never sends a JWT.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API_BASE_URL } from "../../config/api";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import { CategoryRatings, NpsScale, FeedbackTextFields, emptyRatings } from "./feedbackShared";

const PUBLIC = `${API_BASE_URL}/public-feedback`;

export default function PublicFeedbackPage() {
  const { token } = useParams();
  const { settings } = useHospitalSettings();
  const hospital = settings?.hospitalName || "Our Hospital";

  const [phase, setPhase] = useState("loading"); // loading | form | done | already | error
  const [errMsg, setErrMsg] = useState("");
  const [ctx, setCtx] = useState({});
  const [saving, setSaving] = useState(false);

  const [ratings, setRatings] = useState(emptyRatings());
  const [npsScore, setNpsScore] = useState(null);
  const [text, setText] = useState({ wentWell: "", improvements: "" });
  const [contactConsent, setContactConsent] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await axios.get(`${PUBLIC}/${token}`);
        if (!alive) return;
        if (data?.data?.alreadySubmitted) { setPhase("already"); return; }
        setCtx(data?.data || {});
        setPhase("form");
      } catch (e) {
        if (!alive) return;
        setErrMsg(e?.response?.data?.message || "This feedback link could not be opened.");
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const answered = useMemo(() => Object.values(ratings).some((v) => v > 0) || npsScore != null, [ratings, npsScore]);

  const setRating = (k, v) => setRatings((r) => ({ ...r, [k]: v }));
  const setField = (k, v) => setText((t) => ({ ...t, [k]: v }));

  const submit = async () => {
    if (!answered) { setErrMsg("Please rate at least one item before submitting."); return; }
    setErrMsg("");
    setSaving(true);
    try {
      await axios.post(`${PUBLIC}/${token}`, { ratings, npsScore, ...text, contactConsent });
      setPhase("done");
    } catch (e) {
      const msg = e?.response?.data?.message || "Could not submit your feedback. Please try again.";
      if (e?.response?.data?.code === "ALREADY_SUBMITTED") { setPhase("already"); return; }
      setErrMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  const Shell = ({ children }) => (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#eef2ff,#f8fafc 240px)", fontFamily: "'DM Sans',system-ui,sans-serif", padding: "0 0 48px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ textAlign: "center", padding: "28px 0 14px" }}>
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt="" style={{ height: 54, objectFit: "contain", marginBottom: 8 }} />
          ) : null}
          <div style={{ fontSize: 20, fontWeight: 800, color: "#3730a3" }}>{hospital}</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Patient Feedback</div>
        </div>
        {children}
      </div>
    </div>
  );

  const Card = ({ children }) => (
    <div style={{ background: "#fff", borderRadius: 18, boxShadow: "0 10px 30px rgba(30,41,59,.08)", border: "1px solid #eef2f7", padding: 20 }}>
      {children}
    </div>
  );

  if (phase === "loading") {
    return <Shell><Card><div style={{ textAlign: "center", color: "#64748b", padding: 30 }}><i className="pi pi-spin pi-spinner" style={{ fontSize: 26, color: "#4338ca" }} /><div style={{ marginTop: 10 }}>Loading…</div></div></Card></Shell>;
  }

  if (phase === "error") {
    return <Shell><Card><div style={{ textAlign: "center", padding: 24 }}>
      <i className="pi pi-exclamation-triangle" style={{ fontSize: 34, color: "#dc2626" }} />
      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 12, color: "#1e293b" }}>Link unavailable</div>
      <div style={{ color: "#64748b", marginTop: 6 }}>{errMsg}</div>
    </div></Card></Shell>;
  }

  if (phase === "already" || phase === "done") {
    return <Shell><Card><div style={{ textAlign: "center", padding: 24 }}>
      <i className="pi pi-check-circle" style={{ fontSize: 40, color: "#16a34a" }} />
      <div style={{ fontWeight: 800, fontSize: 18, marginTop: 12, color: "#1e293b" }}>
        {phase === "done" ? "Thank you!" : "Already submitted"}
      </div>
      <div style={{ color: "#64748b", marginTop: 6 }}>
        {phase === "done"
          ? "Your feedback has been recorded. We truly appreciate you taking the time — it helps us serve you better."
          : "This feedback has already been submitted. Thank you for your time!"}
      </div>
    </div></Card></Shell>;
  }

  // phase === "form"
  return (
    <Shell>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>
            {ctx.greetingName ? `${ctx.greetingName}, how was your experience?` : "How was your experience?"}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>
            Please rate each below. It only takes a minute — your honest feedback is anonymous unless you choose to share contact details.
          </div>
        </div>

        <CategoryRatings ratings={ratings} setRating={setRating} />

        <div style={{ marginTop: 22 }}>
          <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 15, marginBottom: 8 }}>
            How likely are you to recommend us to family & friends?
          </div>
          <NpsScale value={npsScore} onChange={setNpsScore} />
        </div>

        <div style={{ marginTop: 22 }}>
          <FeedbackTextFields wentWell={text.wentWell} improvements={text.improvements} setField={setField} />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, fontSize: 13, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={contactConsent} onChange={(e) => setContactConsent(e.target.checked)} />
          You may contact me about this feedback.
        </label>

        {errMsg ? <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>{errMsg}</div> : null}

        <button
          type="button"
          onClick={submit}
          disabled={saving}
          style={{
            width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 12, border: "none",
            background: saving ? "#a5b4fc" : "linear-gradient(135deg,#4f46e5,#4338ca)",
            color: "#fff", fontWeight: 800, fontSize: 16, cursor: saving ? "default" : "pointer",
            boxShadow: "0 8px 20px rgba(67,56,202,.35)",
          }}
        >
          {saving ? "Submitting…" : "Submit feedback"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 12 }}>
          <i className="pi pi-lock" style={{ fontSize: 10 }} /> Your responses are confidential.
        </div>
      </Card>
    </Shell>
  );
}
