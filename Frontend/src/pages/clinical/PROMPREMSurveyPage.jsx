/**
 * R7hr-113 — Paperless PROM / PREM Survey
 * ─────────────────────────────────────────
 * Captures Patient-Reported Outcome (PROM) and Patient-Reported
 * Experience (PREM) surveys before discharge. Mirrors the consent
 * ceremony — patient signature + staff witness — and gates discharge
 * finalization.
 *
 * URL: /clinical/prom-prem-survey?uhid=UH02&admissionId=...&type=PROM
 *
 * Supported instruments:
 *   PROM: EQ-5D-5L (5 dims × 5 levels + VAS 0-100), SF-36, PROMIS,
 *         Oxford-Knee, Oxford-Hip, VAS-Pain (0-10), Other
 *   PREM: NABH-PSQ (Hospital experience, 10 questions), HCAHPS,
 *         NHS-FFT (single-Q), Custom-PREM, Other
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

// ──────────────────────────────────────────────────────────────
// Instrument question banks
// ──────────────────────────────────────────────────────────────
const EQ5D5L_DIMS = [
  { key: "mobility", label: "Mobility", help: "Walking about" },
  { key: "selfCare", label: "Self-Care", help: "Washing / dressing" },
  { key: "usualActivities", label: "Usual Activities", help: "Work, study, housework, family / leisure" },
  { key: "pain", label: "Pain / Discomfort" },
  { key: "anxiety", label: "Anxiety / Depression" },
];
const EQ5D5L_LEVELS = [
  { v: 1, label: "No problems" },
  { v: 2, label: "Slight problems" },
  { v: 3, label: "Moderate problems" },
  { v: 4, label: "Severe problems" },
  { v: 5, label: "Unable / extreme problems" },
];

// NABH PSQ — short 10-item hospital experience scale
const NABH_PSQ_QUESTIONS = [
  { key: "courtesy", label: "Courtesy of doctors and nurses" },
  { key: "communication", label: "Clarity of information about treatment / diagnosis" },
  { key: "painManagement", label: "How well your pain was managed" },
  { key: "cleanliness", label: "Cleanliness of room / ward / bathroom" },
  { key: "foodQuality", label: "Quality and timing of meals" },
  { key: "billingClarity", label: "Transparency of bills and charges" },
  { key: "discharge", label: "Discharge process — explanation and timing" },
  { key: "privacy", label: "Privacy and dignity during care" },
  { key: "responsiveness", label: "How quickly staff responded to call bell" },
  { key: "overall", label: "Overall hospital experience" },
];
const PSQ_LEVELS = [
  { v: 1, label: "Poor" },
  { v: 2, label: "Fair" },
  { v: 3, label: "Good" },
  { v: 4, label: "Very Good" },
  { v: 5, label: "Excellent" },
];

const VAS_PAIN_QUESTIONS = [{ key: "vas", label: "Pain Score (0 = no pain, 10 = worst imaginable)", scale: 10 }];

// Generic free-text fallback for Other / unsupported instruments
const GENERIC_PROMPT = {
  PROM: "Describe in your own words how your health / function has changed since admission.",
  PREM: "Describe in your own words your experience of being a patient here.",
};

const INSTRUMENT_OPTIONS = {
  PROM: ["EQ-5D-5L", "SF-36", "PROMIS", "Oxford-Knee", "Oxford-Hip", "VAS-Pain", "Other"],
  PREM: ["NABH-PSQ", "HCAHPS", "NHS-FFT", "Custom-PREM", "Other"],
};

// ──────────────────────────────────────────────────────────────
// Signature pad — small reusable canvas component
// ──────────────────────────────────────────────────────────────
function SignaturePad({ onChange, value, height = 120, disabled = false }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    if (value && typeof value === "string" && value.startsWith("data:image")) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = value;
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [value]);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return { x: ((pt.clientX - rect.left) * canvas.width) / rect.width, y: ((pt.clientY - rect.top) * canvas.height) / rect.height };
  };
  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    drawingRef.current = true;
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const draw = (e) => {
    if (!drawingRef.current || disabled) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const dataURL = canvasRef.current.toDataURL("image/png");
    onChange?.(dataURL);
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange?.("");
  };

  return (
    <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
      <canvas
        ref={canvasRef}
        width={480}
        height={height}
        style={{ display: "block", width: "100%", height, cursor: disabled ? "not-allowed" : "crosshair", touchAction: "none", opacity: disabled ? 0.6 : 1 }}
        onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchMove={draw} onTouchEnd={stop}
      />
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontSize: 12, color: "#64748b" }}>
        <span>Sign with mouse / finger / stylus</span>
        <button type="button" onClick={clear} disabled={disabled} style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>Clear</button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────
export default function PROMPREMSurveyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const urlUHID = (params.get("uhid") || "").toUpperCase();
  const urlAdmId = params.get("admissionId") || "";
  const urlType = (params.get("type") || "PROM").toUpperCase();
  const initialInstrument = params.get("instrument") || (urlType === "PROM" ? "EQ-5D-5L" : "NABH-PSQ");

  const [admission, setAdmission] = useState(null);
  const [type, setType] = useState(urlType === "PREM" ? "PREM" : "PROM");
  const [instrument, setInstrument] = useState(initialInstrument);
  const [otherLabel, setOtherLabel] = useState("");
  const [responses, setResponses] = useState({});
  const [comments, setComments] = useState("");
  const [staffRecommendation, setStaffRecommendation] = useState("");

  // Patient signature
  const [patientSigMethod, setPatientSigMethod] = useState("DIGITAL_PAD");
  const [patientSigImage, setPatientSigImage] = useState("");
  const [attestedByName, setAttestedByName] = useState("");
  const [attestedByRelation, setAttestedByRelation] = useState("SELF");
  const [attestedByContact, setAttestedByContact] = useState("");

  // Staff witness
  const [staffSigImage, setStaffSigImage] = useState("");

  const [savedDoc, setSavedDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [readiness, setReadiness] = useState(null);

  // Load patient + admission + existing surveys
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!urlUHID && !urlAdmId) return;
      try {
        let adm = null;
        if (urlAdmId) {
          const r = await axios.get(`${API_ENDPOINTS.BASE}/admissions/${urlAdmId}`);
          adm = r.data?.data || r.data;
        }
        if (!adm && urlUHID) {
          const r = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active?UHID=${urlUHID}`).catch(() => null);
          adm = r?.data?.data?.[0] || r?.data?.[0] || null;
        }
        if (!cancelled && adm) setAdmission(adm);
        // Fetch existing surveys for this admission
        if (adm?._id) {
          try {
            const r = await axios.get(`${API_ENDPOINTS.BASE}/prom-prem-surveys?admissionId=${adm._id}`);
            if (!cancelled) setReadiness(r.data?.readiness || null);
          } catch (_) {/* no surveys yet */}
        }
      } catch (err) {
        if (!cancelled) toast.error(err?.response?.data?.message || "Could not load admission");
      }
    })();
    return () => { cancelled = true; };
  }, [urlUHID, urlAdmId]);

  // Instrument-specific rendered question block
  const questionBlock = useMemo(() => {
    if (instrument === "EQ-5D-5L") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          {EQ5D5L_DIMS.map((dim) => (
            <div key={dim.key} style={{ padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{dim.label}</div>
              {dim.help && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{dim.help}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {EQ5D5L_LEVELS.map((lvl) => (
                  <label key={lvl.v} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", border: "1px solid", borderColor: responses[dim.key] === lvl.v ? "#2563eb" : "#e2e8f0", borderRadius: 6, background: responses[dim.key] === lvl.v ? "#dbeafe" : "white", cursor: "pointer", fontSize: 13 }}>
                    <input type="radio" checked={responses[dim.key] === lvl.v} onChange={() => setResponses((r) => ({ ...r, [dim.key]: lvl.v }))} />
                    <span><strong>{lvl.v}</strong> · {lvl.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ padding: 12, background: "#fef3c7", borderRadius: 8, border: "1px solid #fde68a" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Visual Analog Scale (VAS)</div>
            <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>How good or bad is your health TODAY? 0 = worst, 100 = best</div>
            <input type="range" min="0" max="100" value={responses.vas ?? 50} onChange={(e) => setResponses((r) => ({ ...r, vas: Number(e.target.value) }))} style={{ width: "100%" }} />
            <div style={{ textAlign: "center", fontSize: 20, fontWeight: 800, color: "#92400e" }}>{responses.vas ?? 50} / 100</div>
          </div>
        </div>
      );
    }
    if (instrument === "NABH-PSQ") {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {NABH_PSQ_QUESTIONS.map((q) => (
            <div key={q.key} style={{ padding: 10, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{q.label}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PSQ_LEVELS.map((lvl) => (
                  <label key={lvl.v} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid", borderColor: responses[q.key] === lvl.v ? "#16a34a" : "#e2e8f0", borderRadius: 6, background: responses[q.key] === lvl.v ? "#dcfce7" : "white", cursor: "pointer", fontSize: 12 }}>
                    <input type="radio" checked={responses[q.key] === lvl.v} onChange={() => setResponses((r) => ({ ...r, [q.key]: lvl.v }))} />
                    <span><strong>{lvl.v}</strong> {lvl.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (instrument === "VAS-Pain") {
      return (
        <div style={{ padding: 16, background: "#fee2e2", borderRadius: 8, border: "1px solid #fecaca" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{VAS_PAIN_QUESTIONS[0].label}</div>
          <input type="range" min="0" max="10" step="1" value={responses.vas ?? 0} onChange={(e) => setResponses((r) => ({ ...r, vas: Number(e.target.value) }))} style={{ width: "100%" }} />
          <div style={{ textAlign: "center", fontSize: 28, fontWeight: 800, color: "#991b1b" }}>{responses.vas ?? 0} / 10</div>
        </div>
      );
    }
    // Generic free-text fallback for less-common instruments
    return (
      <div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>{GENERIC_PROMPT[type]}</div>
        <textarea
          value={responses.freeText || ""}
          onChange={(e) => setResponses((r) => ({ ...r, freeText: e.target.value }))}
          rows={6}
          style={{ width: "100%", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, fontFamily: "inherit", fontSize: 14 }}
          placeholder="Write here..."
        />
      </div>
    );
  }, [instrument, responses, type]);

  // Save draft (create or update)
  const saveDraft = useCallback(async () => {
    if (!admission?._id) return toast.error("Load an admission first");
    setLoading(true);
    try {
      const payload = {
        UHID: admission.UHID,
        admissionId: admission._id,
        type, instrument,
        otherInstrumentLabel: instrument === "Other" ? otherLabel : "",
        responses, scores: {},
        comments, staffRecommendation,
      };
      if (!savedDoc?._id) {
        const r = await axios.post(`${API_ENDPOINTS.BASE}/prom-prem-surveys`, payload);
        setSavedDoc(r.data?.data);
        toast.success(r.data?.reopened ? "Re-opened existing draft" : "Draft created");
      } else {
        const r = await axios.patch(`${API_ENDPOINTS.BASE}/prom-prem-surveys/${savedDoc._id}`, payload);
        setSavedDoc(r.data?.data);
        toast.success("Draft updated");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }, [admission, type, instrument, otherLabel, responses, comments, staffRecommendation, savedDoc]);

  // Sign + emit register
  const signSurvey = useCallback(async () => {
    if (!admission?._id) return toast.error("Load an admission first");
    if (!staffSigImage) return toast.warn("Staff witness signature required");
    if (!patientSigImage && patientSigMethod !== "VERBAL_ATTESTED") {
      return toast.warn("Patient signature required (or switch to Verbal Attested with caregiver name)");
    }
    if (patientSigMethod === "VERBAL_ATTESTED" && !attestedByName.trim()) {
      return toast.warn("Attesting caregiver name required");
    }

    setLoading(true);
    try {
      // Ensure draft exists
      let doc = savedDoc;
      if (!doc?._id) {
        const r = await axios.post(`${API_ENDPOINTS.BASE}/prom-prem-surveys`, {
          UHID: admission.UHID, admissionId: admission._id,
          type, instrument, otherInstrumentLabel: instrument === "Other" ? otherLabel : "",
          responses, scores: {}, comments, staffRecommendation,
        });
        doc = r.data?.data;
        setSavedDoc(doc);
      }
      // Patch signatures
      const sigPatch = {
        patientSignature: {
          method: patientSigMethod,
          signatureImage: patientSigImage || null,
          signedAt: new Date().toISOString(),
          attestedByName: patientSigMethod === "VERBAL_ATTESTED" ? attestedByName : null,
          attestedByRelation: patientSigMethod === "VERBAL_ATTESTED" ? attestedByRelation : null,
          attestedByContact: patientSigMethod === "VERBAL_ATTESTED" ? attestedByContact : null,
        },
        staffWitness: {
          userId: user?._id,
          userName: user?.fullName || user?.name,
          userRole: user?.role,
          employeeId: user?.employeeId || "",
          signatureImage: staffSigImage,
          signedAt: new Date().toISOString(),
        },
        responses, comments, staffRecommendation,
      };
      await axios.patch(`${API_ENDPOINTS.BASE}/prom-prem-surveys/${doc._id}`, sigPatch);
      // Final sign
      const signRes = await axios.post(`${API_ENDPOINTS.BASE}/prom-prem-surveys/${doc._id}/sign`);
      setSavedDoc(signRes.data?.data);
      toast.success(`${type} survey signed — register emitted`);
      // Refresh readiness
      try {
        const r = await axios.get(`${API_ENDPOINTS.BASE}/prom-prem-surveys?admissionId=${admission._id}`);
        setReadiness(r.data?.readiness || null);
      } catch (_) {}
    } catch (err) {
      toast.error(err?.response?.data?.message || "Sign failed");
    } finally {
      setLoading(false);
    }
  }, [admission, type, instrument, otherLabel, responses, comments, staffRecommendation, patientSigMethod, patientSigImage, attestedByName, attestedByRelation, attestedByContact, staffSigImage, savedDoc, user]);

  const signed = savedDoc?.status === "SIGNED";

  return (
    <div style={{ maxWidth: 960, margin: "20px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>📝 Patient-Reported Survey ({type})</h1>
        <button onClick={() => navigate(-1)} style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", cursor: "pointer" }}>← Back</button>
      </div>

      {/* Patient banner */}
      {admission ? (
        <div style={{ padding: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div><strong>{admission.patientName || admission.fullName}</strong></div>
            <div>UHID: <code>{admission.UHID}</code></div>
            <div>IPD: <code>{admission.admissionNumber || admission.ipdNo}</code></div>
            <div>Ward: {admission.wardName || "—"} · Bed: {admission.bedNumber || "—"}</div>
          </div>
          {readiness && (
            <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 13 }}>
              <span>Discharge readiness:</span>
              <span style={{ color: readiness.prom ? "#15803d" : "#b45309", fontWeight: 600 }}>{readiness.prom ? "✓" : "○"} PROM</span>
              <span style={{ color: readiness.prem ? "#15803d" : "#b45309", fontWeight: 600 }}>{readiness.prem ? "✓" : "○"} PREM</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 12, background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 16 }}>
          ⚠ No admission loaded. Open this page from a patient context (`?uhid=&admissionId=`).
        </div>
      )}

      {/* Type + instrument */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Survey Type</label>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {["PROM", "PREM"].map((t) => (
              <button key={t} disabled={signed} onClick={() => { setType(t); setInstrument(t === "PROM" ? "EQ-5D-5L" : "NABH-PSQ"); setResponses({}); }} style={{ flex: 1, padding: "8px 12px", border: "1px solid", borderColor: type === t ? "#2563eb" : "#cbd5e1", borderRadius: 6, background: type === t ? "#dbeafe" : "white", cursor: signed ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {t === "PROM" ? "PROM — Outcome" : "PREM — Experience"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Instrument</label>
          <select disabled={signed} value={instrument} onChange={(e) => { setInstrument(e.target.value); setResponses({}); }} style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, marginTop: 4 }}>
            {INSTRUMENT_OPTIONS[type].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          {instrument === "Other" && (
            <input value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} disabled={signed} placeholder="Specify instrument name…" style={{ width: "100%", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, marginTop: 4 }} />
          )}
        </div>
      </div>

      {/* Questions */}
      <div style={{ padding: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>{type === "PROM" ? "Outcome Questions" : "Experience Questions"} — {instrument}</h2>
        <div style={{ pointerEvents: signed ? "none" : "auto", opacity: signed ? 0.7 : 1 }}>
          {questionBlock}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Comments (patient's own words)</label>
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} disabled={signed} rows={3} style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, marginTop: 4, fontFamily: "inherit" }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Staff Recommendation (optional)</label>
          <textarea value={staffRecommendation} onChange={(e) => setStaffRecommendation(e.target.value)} disabled={signed} rows={2} style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, marginTop: 4, fontFamily: "inherit" }} placeholder="e.g. follow-up at OPD in 2 weeks for ongoing pain" />
        </div>
      </div>

      {/* Signature ceremony */}
      <div style={{ padding: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>✍ Signature Ceremony (NABH PSQ + AAC.7)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Patient signature</div>
            <select value={patientSigMethod} onChange={(e) => setPatientSigMethod(e.target.value)} disabled={signed} style={{ width: "100%", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
              <option value="DIGITAL_PAD">Digital signature pad</option>
              <option value="BIOMETRIC">Fingerprint (biometric)</option>
              <option value="VERBAL_ATTESTED">Verbal attested (caregiver signs)</option>
            </select>
            {patientSigMethod === "VERBAL_ATTESTED" ? (
              <div style={{ display: "grid", gap: 6 }}>
                <select value={attestedByRelation} onChange={(e) => setAttestedByRelation(e.target.value)} disabled={signed} style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}>
                  {["SELF", "SPOUSE", "FATHER", "MOTHER", "SON", "DAUGHTER", "GUARDIAN", "OTHER"].map((r) => <option key={r}>{r}</option>)}
                </select>
                <input value={attestedByName} onChange={(e) => setAttestedByName(e.target.value)} disabled={signed} placeholder="Attesting caregiver name" style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }} />
                <input value={attestedByContact} onChange={(e) => setAttestedByContact(e.target.value)} disabled={signed} placeholder="Contact (optional)" style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }} />
                <SignaturePad value={patientSigImage} onChange={setPatientSigImage} disabled={signed} />
              </div>
            ) : (
              <SignaturePad value={patientSigImage} onChange={setPatientSigImage} disabled={signed} />
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Staff witness — {user?.fullName || "—"}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{user?.role || ""} · EmpID: {user?.employeeId || "—"}</div>
            <SignaturePad value={staffSigImage} onChange={setStaffSigImage} disabled={signed} />
          </div>
        </div>
        {signed && (
          <div style={{ marginTop: 12, padding: 10, background: "#dcfce7", border: "1px solid #86efac", borderRadius: 8, color: "#15803d", fontWeight: 600 }}>
            ✓ Signed at {savedDoc?.signedAt ? new Date(savedDoc.signedAt).toLocaleString() : "—"} by {savedDoc?.signedByName || "—"}. Locked. NABH register emitted.
          </div>
        )}
      </div>

      {/* Actions */}
      {!signed && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={saveDraft} disabled={loading || !admission} style={{ padding: "10px 18px", border: "1px solid #2563eb", borderRadius: 8, background: "white", color: "#2563eb", fontWeight: 600, cursor: "pointer" }}>💾 Save Draft</button>
          <button onClick={signSurvey} disabled={loading || !admission} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: "#16a34a", color: "white", fontWeight: 700, cursor: "pointer" }}>✓ Sign & Submit</button>
        </div>
      )}
    </div>
  );
}
