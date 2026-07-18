// Components/scribe/AmbientScribe.jsx
// AI Clinical Documentation Assistant (ambient scribe).
//
// A reusable "🩺 AI Scribe" button + modal that turns a doctor-patient consult
// into a STRUCTURED note the doctor reviews, edits, and applies into the current
// form (OPD assessment / IPD progress note / discharge summary). Flow:
//
//   Consent  →  Capture (live mic + editable transcript)  →  Review (editable
//   structured draft)  →  Apply (host page's onApply(note) fills the form).
//
// The doctor always reviews + signs via the normal Save flow; this NEVER
// auto-saves or auto-signs. Feature-flagged: renders nothing unless the backend
// reports the model key is configured (GET /clinical-scribe/status).
//
// Capture reuses the browser Web Speech API (Chrome/Edge) + the shared
// medicalDictionary corrections. Where Web Speech is unavailable, the doctor can
// still dictate (global mic) or type/paste the transcript — the AI structuring
// works on any transcript.
import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { applyMedicalCorrections } from "../voice/medicalDictionary";

const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const LANGS = { "en-IN": "EN", "hi-IN": "हि" };

// Module-level cache so we only probe the feature flag once per session.
let _statusCache = null; // null=unknown, true/false once fetched

const C = {
  accent: "#0f766e", accentBg: "#e6f4f2", ink: "#14201d", soft: "#4a5b56",
  border: "#dbe3e0", amber: "#b45309", amberBg: "#fffbeb", amberBd: "#fde68a",
  red: "#b91c1c", surface: "#ffffff",
};

/* minimal spoken-punctuation commands (ambient speech rarely needs more). */
function applyCommands(s) {
  return ` ${s} `
    .replace(/\s+(new paragraph)\s+/gi, "\n\n")
    .replace(/\s+(new line|next line)\s+/gi, "\n")
    .replace(/\s+(full stop)\s+/gi, ". ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/g, "");
}

const SURFACE_LABEL = { opd: "OPD assessment", ipd: "progress note", discharge: "discharge summary" };

export default function AmbientScribe({ surface = "opd", context = {}, onApply, style }) {
  const [enabled, setEnabled] = useState(_statusCache);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("consent"); // consent | capture | review
  const [consent, setConsent] = useState(false);

  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("en-IN");
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(null); // structured note under review

  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const langRef = useRef("en-IN");

  // Feature-flag probe (once). Renders nothing if the model key isn't set.
  useEffect(() => {
    if (_statusCache !== null) { setEnabled(_statusCache); return; }
    let alive = true;
    axios
      .get(`${API_ENDPOINTS.BASE}/clinical-scribe/status`)
      .then((r) => { _statusCache = !!(r.data && r.data.data && r.data.data.enabled); if (alive) setEnabled(_statusCache); })
      .catch(() => { _statusCache = false; if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, []);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setInterim("");
    const rec = recRef.current;
    if (rec) { rec.onend = null; try { rec.stop(); } catch { /* not started */ } }
  }, []);

  const startListening = useCallback(() => {
    if (!SR) { setErr("Live capture needs Chrome or Edge — type/paste the transcript below instead."); return; }
    setErr("");
    let rec;
    try { rec = new SR(); } catch { setErr("Could not start the microphone."); return; }
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk.trim()) {
        const processed = applyMedicalCorrections(applyCommands(finalChunk));
        setTranscript((prev) => (prev ? prev.replace(/\s*$/, "") + " " : "") + processed);
      }
      setInterim(interimChunk);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setErr("Microphone blocked — allow mic access for this site."); stopListening();
      } else if (e.error === "network") { setErr("Speech service unreachable (network)."); }
    };
    rec.onend = () => { if (listeningRef.current) { try { rec.start(); } catch { /* race */ } } else setInterim(""); };
    recRef.current = rec;
    listeningRef.current = true;
    setListening(true);
    try { rec.start(); } catch { /* already started */ }
  }, [stopListening]);

  const toggleLang = useCallback(() => {
    const next = langRef.current === "en-IN" ? "hi-IN" : "en-IN";
    langRef.current = next; setLang(next);
    if (listeningRef.current) { stopListening(); setTimeout(() => startListening(), 180); }
  }, [startListening, stopListening]);

  useEffect(() => () => { // cleanup recogniser on unmount
    listeningRef.current = false;
    const r = recRef.current;
    if (r) { r.onend = null; try { r.stop(); } catch { /* noop */ } }
  }, []);

  const reset = useCallback(() => {
    stopListening();
    setOpen(false); setPhase("consent"); setConsent(false);
    setTranscript(""); setInterim(""); setDraft(null); setErr(""); setBusy(false);
  }, [stopListening]);

  const generate = useCallback(async () => {
    stopListening();
    if (transcript.trim().length < 15) { setErr("Record or type a bit more of the consultation first."); return; }
    setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API_ENDPOINTS.BASE}/clinical-scribe/structure`, {
        transcript,
        surface,
        context: { age: context.age, sex: context.sex },
      });
      setDraft(r.data && r.data.data);
      setPhase("review");
    } catch (e) {
      const code = e.response && e.response.data && e.response.data.code;
      const msg = e.response && e.response.data && e.response.data.message;
      setErr(msg || (code === "SCRIBE_NOT_CONFIGURED" ? "AI scribe is not enabled on this deployment." : "The AI scribe could not structure this transcript."));
    } finally { setBusy(false); }
  }, [transcript, surface, context.age, context.sex, stopListening]);

  const apply = useCallback(() => {
    if (draft && typeof onApply === "function") onApply(draft);
    reset();
  }, [draft, onApply, reset]);

  if (!enabled) return null; // disabled-safe: hidden unless the model key is set

  const btn = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="AI Scribe — dictate the consult, get a structured note draft"
      style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accentBg, color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, ...style }}
    >
      🩺 AI Scribe
    </button>
  );

  if (!open) return btn;

  return (
    <>
      {btn}
      <div style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) reset(); }}>
        <div style={S.modal} role="dialog" aria-label="AI clinical scribe">
          <div style={S.head}>
            <div style={{ fontWeight: 700, color: C.ink }}>🩺 AI Scribe — {SURFACE_LABEL[surface] || "note"}</div>
            <button type="button" onClick={reset} style={S.x} aria-label="Close">×</button>
          </div>

          {/* ── CONSENT ── */}
          {phase === "consent" && (
            <div style={S.body}>
              <div style={S.notice}>
                <b>Before you record:</b> the consultation audio is transcribed by your browser's speech
                service (a third-party cloud STT). Use the AI scribe only with the patient's knowledge and
                consent, and avoid it for highly sensitive cases until a self-hosted transcription service is
                configured. The AI produces a <b>draft</b> — you review, edit, and sign it as always.
              </div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, cursor: "pointer" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ color: C.soft, fontSize: 13.5 }}>The patient consents to AI-assisted documentation of this consultation.</span>
              </label>
              <div style={S.actions}>
                <button type="button" onClick={reset} style={S.ghost}>Cancel</button>
                <button type="button" disabled={!consent} onClick={() => setPhase("capture")} style={{ ...S.primary, opacity: consent ? 1 : 0.5, cursor: consent ? "pointer" : "not-allowed" }}>Continue</button>
              </div>
            </div>
          )}

          {/* ── CAPTURE ── */}
          {phase === "capture" && (
            <div style={S.body}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button type="button" onClick={listening ? stopListening : startListening} style={{ ...S.mic, background: listening ? "#b91c1c" : C.accent }}>
                  {listening ? "■ Stop" : "🎤 Record consult"}
                </button>
                <button type="button" onClick={toggleLang} title="Speech language" style={S.lang}>{LANGS[lang]}</button>
                {listening && <span style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>● listening…</span>}
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => setTranscript("")} style={S.ghost} disabled={!transcript}>Clear</button>
              </div>
              {interim && <div style={{ color: C.soft, fontSize: 12, fontStyle: "italic", marginBottom: 6 }}>…{interim}</div>}
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Speak the consultation, or type / paste the transcript here. The AI will structure it into a clinical note you can review."
                style={S.transcript}
              />
              {err && <div style={S.err}>{err}</div>}
              <div style={S.actions}>
                <button type="button" onClick={reset} style={S.ghost}>Cancel</button>
                <button type="button" onClick={generate} disabled={busy || transcript.trim().length < 15} style={{ ...S.primary, opacity: busy || transcript.trim().length < 15 ? 0.5 : 1 }}>
                  {busy ? "Structuring…" : "Generate note ✨"}
                </button>
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {phase === "review" && draft && (
            <ReviewEditor draft={draft} setDraft={setDraft} surface={surface} onBack={() => setPhase("capture")} onApply={apply} />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Editable review of the structured draft ── */
function ReviewEditor({ draft, setDraft, surface, onBack, onApply }) {
  const set = (path, val) => setDraft((d) => {
    const next = JSON.parse(JSON.stringify(d));
    const keys = path.split(".");
    let o = next; for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = val; return next;
  });
  const setArr = (key, arr) => setDraft((d) => ({ ...d, [key]: arr }));
  const conf = Math.round((draft.confidence || 0) * 100);
  const confColor = conf >= 70 ? "#2f8f6b" : conf >= 40 ? C.amber : C.red;

  return (
    <div style={{ ...S.body, overflowY: "auto" }}>
      {/* provenance + confidence + red flags */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentBg, borderRadius: 20, padding: "3px 10px" }}>AI DRAFT — review before signing</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: confColor, border: `1px solid ${confColor}`, borderRadius: 20, padding: "3px 10px" }}>confidence {conf}%</span>
      </div>
      {Array.isArray(draft.redFlags) && draft.redFlags.length > 0 && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amberBd}`, color: C.amber, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12.5 }}>
          <b>⚠️ Flags for your attention:</b> {draft.redFlags.join(" · ")}
        </div>
      )}
      {draft.notes && (
        <div style={{ background: "#f5f8f7", border: `1px solid ${C.border}`, color: C.soft, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12 }}>
          <b>Scribe notes:</b> {draft.notes}
        </div>
      )}

      <Field label="Chief complaint" value={draft.chiefComplaint} onChange={(v) => set("chiefComplaint", v)} />
      <Field label="HOPI (narrative)" value={draft.hopi && draft.hopi.narrative} onChange={(v) => set("hopi.narrative", v)} area />
      <Row>
        <Field label="Examination — general" value={draft.examination && draft.examination.general} onChange={(v) => set("examination.general", v)} area />
        <Field label="Examination — systemic" value={draft.examination && draft.examination.systemic} onChange={(v) => set("examination.systemic", v)} area />
      </Row>

      <ListEditor
        label="Diagnoses" rows={draft.diagnoses || []} onChange={(rows) => setArr("diagnoses", rows)}
        cols={[{ k: "text", ph: "diagnosis", flex: 3 }, { k: "type", ph: "type", flex: 1, select: ["provisional", "working", "final", "differential"] }, { k: "icd10Hint", ph: "ICD-10", flex: 1 }]}
        blank={{ text: "", type: "provisional", icd10Hint: "" }}
      />
      <ListEditor
        label="Medications" rows={draft.medications || []} onChange={(rows) => setArr("medications", rows)}
        cols={[{ k: "name", ph: "drug", flex: 3 }, { k: "dose", ph: "dose", flex: 1 }, { k: "frequency", ph: "freq", flex: 1 }, { k: "duration", ph: "duration", flex: 1 }, { k: "route", ph: "route", flex: 1 }]}
        blank={{ name: "", dose: "", frequency: "", duration: "", route: "Oral", instructions: "" }}
      />
      <ListEditor
        label="Investigations" rows={draft.investigations || []} onChange={(rows) => setArr("investigations", rows)}
        cols={[{ k: "name", ph: "test", flex: 3 }, { k: "urgency", ph: "urgency", flex: 1, select: ["Routine", "STAT"] }]}
        blank={{ name: "", urgency: "Routine", instructions: "" }}
      />

      {(surface === "ipd" || surface === "discharge") && (
        <Field label="Course in hospital" value={draft.courseInHospital} onChange={(v) => set("courseInHospital", v)} area />
      )}
      <Row>
        <Field label="Advice / plan" value={draft.advice} onChange={(v) => set("advice", v)} area />
        <Field label="Follow-up" value={draft.followUp} onChange={(v) => set("followUp", v)} />
      </Row>
      {surface === "discharge" && (
        <Field label="Condition on discharge" value={draft.conditionOnDischarge} onChange={(v) => set("conditionOnDischarge", v)} />
      )}

      <div style={S.actions}>
        <button type="button" onClick={onBack} style={S.ghost}>← Transcript</button>
        <button type="button" onClick={onApply} style={S.primary}>Apply to form →</button>
      </div>
      <div style={{ fontSize: 11, color: C.soft, textAlign: "right", marginTop: 6 }}>
        Fills empty fields + adds meds/tests. It won't overwrite what you've already typed; review &amp; sign as usual.
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, area }) => (
  <label style={{ display: "block", marginBottom: 10, flex: 1 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: C.soft, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3 }}>{label}</div>
    {area
      ? <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...S.input, minHeight: 56, resize: "vertical" }} />
      : <input value={value || ""} onChange={(e) => onChange(e.target.value)} style={S.input} />}
  </label>
);
const Row = ({ children }) => <div style={{ display: "flex", gap: 10 }}>{children}</div>;

function ListEditor({ label, rows, onChange, cols, blank }) {
  const upd = (i, k, v) => { const n = rows.slice(); n[i] = { ...n[i], [k]: v }; onChange(n); };
  const rm = (i) => onChange(rows.filter((_, idx) => idx !== i));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.soft, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
        <button type="button" onClick={() => onChange([...rows, { ...blank }])} style={{ ...S.ghost, padding: "1px 8px", fontSize: 11 }}>+ add</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: "#9aa5a1", fontStyle: "italic" }}>none</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 5, alignItems: "center" }}>
          {cols.map((c) => c.select
            ? <select key={c.k} value={r[c.k] || c.select[0]} onChange={(e) => upd(i, c.k, e.target.value)} style={{ ...S.input, flex: c.flex, padding: "5px 6px" }}>{c.select.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            : <input key={c.k} value={r[c.k] || ""} placeholder={c.ph} onChange={(e) => upd(i, c.k, e.target.value)} style={{ ...S.input, flex: c.flex, padding: "5px 8px" }} />)}
          <button type="button" onClick={() => rm(i)} title="remove" style={{ border: "none", background: "transparent", color: C.red, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ))}
    </div>
  );
}

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,32,29,.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { width: "min(720px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", background: C.surface, borderRadius: 14, boxShadow: "0 20px 60px -20px rgba(0,0,0,.4)", overflow: "hidden" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${C.border}` },
  x: { border: "none", background: "transparent", fontSize: 22, lineHeight: 1, color: C.soft, cursor: "pointer" },
  body: { padding: 18, overflowY: "auto" },
  notice: { background: C.amberBg, border: `1px solid ${C.amberBd}`, color: C.amber, borderRadius: 10, padding: "12px 14px", fontSize: 13, lineHeight: 1.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  primary: { padding: "9px 18px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 },
  ghost: { padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.soft, fontWeight: 600, cursor: "pointer", fontSize: 13 },
  mic: { padding: "9px 16px", borderRadius: 9, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 },
  lang: { padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.accent, fontWeight: 700, cursor: "pointer" },
  transcript: { width: "100%", minHeight: 180, maxHeight: 300, resize: "vertical", padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, lineHeight: 1.5, fontFamily: "inherit" },
  input: { width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" },
  err: { color: C.red, fontSize: 12.5, marginTop: 8, fontWeight: 600 },
};
