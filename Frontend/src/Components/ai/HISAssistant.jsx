/**
 * HISAssistant.jsx
 * SphereAI — Intelligent HIS Assistant
 * Floating chat widget that understands natural language and can fill
 * forms, assessments, and records under the logged-in user's name.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

/* ─── page → human-readable name map ────────────────────────────────────── */
const PAGE_NAMES = {
  "/nursing-notes": "Nursing Notes",
  "/doctor-notes": "Doctor Notes",
  "/nurse-patient-panel": "Nurse Patient Panel",
  "/doctor-patient-panel": "Doctor Patient Panel",
  "/nurse-initial-assessment": "Nurse Initial Assessment",
  "/doctor-assessment": "Doctor Assessment",
  "/opd-assessment": "OPD Assessment",
  // R7hr-158 — /vitalsView retired; trend opens as a modal in Nursing Notes.
  "/vitalSheet": "Vital Sheet",
  "/pain-assessment": "Pain Assessment",
  "/nursing-care-plan": "Nursing Care Plan",
  "/patient-education": "Patient Education",
  "/daily-nursing-assessment": "Daily Nursing Assessment",
  "/nutritional-assessment": "Nutritional Assessment",
  "/fall-risk-assessment": "Fall Risk Assessment",
  "/pressure-area-care": "Pressure Area Care",
  "/discharge-summary": "Discharge Summary",
  "/mar": "MAR (Medication Administration)",
  "/dashboard": "Dashboard",
  "/mainpage": "Dashboard",
  "/dietitian": "Dietician Console",
  "/accounts": "Accounts & Finance",
};

/* ─── helpers ─────────────────────────────────────────────────────────────── */
function getActiveContext() {
  // Primary: SphereAI context saved by each page when it loads a patient
  try {
    const ctx = sessionStorage.getItem("sphereai_active_patient");
    if (ctx) return JSON.parse(ctx);
  } catch (_) {}
  // Fallback: legacy keys
  const uhid =
    sessionStorage.getItem("doctorPanel_lastUhid") ||
    sessionStorage.getItem("nursePanel_lastUhid") ||
    sessionStorage.getItem("activePatientUhid") ||
    null;
  return uhid ? { uhid, patientName: null } : null;
}

function getActiveUhid() {
  return getActiveContext()?.uhid || null;
}

function getActivePatientName() {
  return getActiveContext()?.patientName || null;
}

/* ─── Action executor ─────────────────────────────────────────────────────── */
async function executeAction(action, user, uhid) {
  const ctx = getActiveContext();
  const patientUHID = uhid || ctx?.uhid;

  switch (action.type) {
    case "fill_nursing_note": {
      if (!patientUHID) throw new Error("No patient loaded. Open Nursing Notes and load a patient first.");
      // Dispatch to NursingNotes page via window event (page handles save with its own context)
      window.dispatchEvent(new CustomEvent("sphereai:fill_nursing_note", {
        detail: {
          noteType: action.data.noteType || "General",
          content: action.data.content || "",
          vitals: action.data.vitals || {},
          autoSave: true,
        }
      }));
      return { dispatched: true, target: "nursing-notes" };
    }

    case "fill_doctor_note": {
      if (!patientUHID) throw new Error("No patient loaded. Open Doctor Notes and load a patient first.");
      window.dispatchEvent(new CustomEvent("sphereai:fill_doctor_note", {
        detail: {
          noteType: action.data.noteType || "Progress Note",
          content: action.data.content || "",
          chiefComplaints: action.data.chiefComplaints || "",
          diagnosis: action.data.diagnosis || "",
          treatmentPlan: action.data.treatmentPlan || "",
          autoSave: true,
        }
      }));
      return { dispatched: true, target: "doctor-notes" };
    }

    case "fill_vitals": {
      if (!patientUHID) throw new Error("No patient loaded. Open Nursing Notes and load a patient first.");
      window.dispatchEvent(new CustomEvent("sphereai:fill_nursing_note", {
        detail: {
          noteType: "Vital Signs Note",
          content: "",
          vitals: action.data || {},
          autoSave: true,
        }
      }));
      return { dispatched: true, target: "nursing-notes" };
    }

    case "navigate": {
      return { navigateTo: action.data?.path };
    }

    default:
      return null;
  }
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */
const S = {
  fab: (open) => ({
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: 9999,
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: open
      ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
      : "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 20px rgba(37,99,235,0.45)",
    transition: "all 0.25s cubic-bezier(.34,1.56,.64,1)",
    transform: open ? "rotate(0deg)" : "rotate(0deg)",
    color: "#fff",
    fontSize: 22,
  }),
  panel: (open) => ({
    position: "fixed",
    bottom: 90,
    right: 24,
    zIndex: 9998,
    width: 380,
    height: 560,
    background: "#fff",
    borderRadius: 20,
    boxShadow: "0 24px 80px rgba(0,0,0,0.18), 0 4px 20px rgba(0,0,0,0.08)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    opacity: open ? 1 : 0,
    transform: open ? "translateY(0) scale(1)" : "translateY(16px) scale(0.96)",
    pointerEvents: open ? "all" : "none",
    transition: "all 0.25s cubic-bezier(.34,1.56,.64,1)",
  }),
  header: {
    background: "linear-gradient(135deg, #1e40af 0%, #2563eb 100%)",
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "rgba(255,255,255,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    lineHeight: 1.2,
  },
  headerSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  contextBadge: {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 99,
    border: "1px solid rgba(255,255,255,0.25)",
    flexShrink: 0,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    scrollbarWidth: "thin",
    scrollbarColor: "#e2e8f0 transparent",
  },
  msgBubble: (role) => ({
    maxWidth: "85%",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user"
      ? "linear-gradient(135deg, #2563eb, #1d4ed8)"
      : role === "error"
      ? "#fef2f2"
      : role === "system"
      ? "#f0f9ff"
      : "#f8fafc",
    color: role === "user" ? "#fff" : role === "error" ? "#dc2626" : "#1e293b",
    borderRadius: role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
    padding: "10px 13px",
    fontSize: 13,
    lineHeight: 1.5,
    boxShadow: role === "user"
      ? "0 2px 8px rgba(37,99,235,0.3)"
      : "0 1px 4px rgba(0,0,0,0.06)",
    border: role === "error" ? "1px solid #fecaca" : role === "system" ? "1px solid #bae6fd" : "none",
    wordBreak: "break-word",
  }),
  confirmCard: {
    background: "#fffbeb",
    border: "1px solid #fcd34d",
    borderRadius: 12,
    padding: "12px 13px",
    fontSize: 12,
    alignSelf: "flex-start",
    maxWidth: "95%",
  },
  confirmTitle: {
    fontWeight: 700,
    color: "#92400e",
    fontSize: 12,
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  confirmField: {
    background: "#fff",
    border: "1px solid #fde68a",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 11.5,
    color: "#374151",
    marginBottom: 4,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  confirmBtns: {
    display: "flex",
    gap: 6,
    marginTop: 8,
  },
  btnConfirm: {
    flex: 1,
    background: "linear-gradient(135deg, #059669, #047857)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  btnCancel: {
    flex: 1,
    background: "#f1f5f9",
    color: "#475569",
    border: "none",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  inputRow: {
    padding: "10px 12px",
    borderTop: "1px solid #f1f5f9",
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    background: "#fff",
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    border: "1.5px solid #e2e8f0",
    borderRadius: 12,
    padding: "9px 12px",
    fontSize: 13,
    resize: "none",
    outline: "none",
    fontFamily: "inherit",
    lineHeight: 1.5,
    color: "#1e293b",
    background: "#f8fafc",
    transition: "border-color 0.15s",
    maxHeight: 100,
    overflow: "auto",
  },
  sendBtn: (disabled) => ({
    width: 38,
    height: 38,
    borderRadius: 10,
    background: disabled
      ? "#e2e8f0"
      : "linear-gradient(135deg, #2563eb, #1d4ed8)",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "#94a3b8" : "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    flexShrink: 0,
    transition: "all 0.15s",
    boxShadow: disabled ? "none" : "0 2px 8px rgba(37,99,235,0.3)",
  }),
  dots: {
    display: "flex",
    gap: 4,
    padding: "8px 4px",
    alignSelf: "flex-start",
  },
  dot: (i) => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#94a3b8",
    animation: "hisDotBounce 1.2s ease-in-out infinite",
    animationDelay: `${i * 0.2}s`,
  }),
  actionTypeChip: (type) => {
    const colors = {
      fill_nursing_note: { bg: "#ecfdf5", color: "#059669", border: "#6ee7b7" },
      fill_doctor_note: { bg: "#eff6ff", color: "#2563eb", border: "#93c5fd" },
      fill_vitals: { bg: "#faf5ff", color: "#7c3aed", border: "#c4b5fd" },
      navigate: { bg: "#fff7ed", color: "#ea580c", border: "#fdba74" },
      default: { bg: "#f8fafc", color: "#475569", border: "#e2e8f0" },
    };
    const c = colors[type] || colors.default;
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      marginBottom: 6,
    };
  },
};

/* ─── Action type labels ─────────────────────────────────────────────────── */
const ACTION_LABELS = {
  fill_nursing_note: "📝 Nursing Note",
  fill_doctor_note: "🩺 Doctor Note",
  fill_vitals: "💉 Vital Signs",
  fill_pain_assessment: "😣 Pain Assessment",
  fill_nursing_care_plan: "📋 Care Plan",
  navigate: "🔗 Navigate",
};

/* ─── Confirmation card ──────────────────────────────────────────────────── */
function ConfirmCard({ actions, onConfirm, onCancel, loading }) {
  return (
    <div style={S.confirmCard}>
      <div style={S.confirmTitle}>
        <span>⚠️</span>
        <span>Confirm before saving</span>
      </div>

      {actions.map((action, i) => (
        <div key={i} style={{ marginBottom: i < actions.length - 1 ? 10 : 0 }}>
          <span style={S.actionTypeChip(action.type)}>
            {ACTION_LABELS[action.type] || action.type}
          </span>

          {action.type === "fill_nursing_note" && (
            <>
              <div style={S.confirmField}>
                <strong>Type:</strong> {action.data.noteType}
              </div>
              {action.data.content && (
                <div style={S.confirmField}>
                  <strong>Note:</strong> {action.data.content}
                </div>
              )}
              {action.data.vitals && Object.values(action.data.vitals).some(Boolean) && (
                <div style={S.confirmField}>
                  <strong>Vitals:</strong>{" "}
                  {Object.entries(action.data.vitals)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")}
                </div>
              )}
            </>
          )}

          {action.type === "fill_doctor_note" && (
            <>
              {action.data.noteType && (
                <div style={S.confirmField}><strong>Type:</strong> {action.data.noteType}</div>
              )}
              {action.data.chiefComplaints && (
                <div style={S.confirmField}><strong>Chief Complaints:</strong> {action.data.chiefComplaints}</div>
              )}
              {action.data.diagnosis && (
                <div style={S.confirmField}><strong>Diagnosis:</strong> {action.data.diagnosis}</div>
              )}
              {action.data.content && (
                <div style={S.confirmField}><strong>Note:</strong> {action.data.content}</div>
              )}
            </>
          )}

          {action.type === "fill_vitals" && (
            <div style={S.confirmField}>
              {Object.entries(action.data)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
                .join(" | ")}
            </div>
          )}

          {action.type === "navigate" && (
            <div style={S.confirmField}>
              Navigate to: <strong>{action.data?.path}</strong>
            </div>
          )}
        </div>
      ))}

      <div style={S.confirmBtns}>
        <button style={S.btnConfirm} onClick={onConfirm} disabled={loading}>
          {loading ? "⏳" : "✅"} {loading ? "Saving…" : "Yes, Save"}
        </button>
        <button style={S.btnCancel} onClick={onCancel} disabled={loading}>
          ✕ Cancel
        </button>
      </div>
    </div>
  );
}

/* ─── Typing indicator ───────────────────────────────────────────────────── */
function TypingDots() {
  return (
    <div style={S.dots}>
      <span style={S.dot(0)} />
      <span style={S.dot(1)} />
      <span style={S.dot(2)} />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function HISAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  // pending = { actions, msgIndex } — waiting for user confirm
  const [pending, setPending] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const historyRef = useRef([]); // Anthropic-format message history

  /* scroll to bottom on new messages */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /* auto-resize textarea */
  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
  };

  /* welcome message when first opened */
  useEffect(() => {
    if (open && messages.length === 0) {
      const pageName = PAGE_NAMES[location.pathname] || location.pathname;
      const uhid = getActiveUhid();
      const patName = getActivePatientName();
      const patStr = uhid ? ` Patient: ${patName ? patName + " (" + uhid + ")" : uhid}.` : "";
      addMsg("system",
        `Namaste! 👋 I'm SphereAI, your HIS assistant.\n\nCurrent page: ${pageName}.${patStr}\n\nTell me what to do — e.g. "Add a nursing note: patient is stable, BP 120/80, SpO2 98%" or "Doctor note: patient complaints of headache, diagnosed with migraine, prescribed paracetamol".`
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function addMsg(role, content, extra = {}) {
    setMessages((prev) => [...prev, { role, content, ...extra }]);
  }

  /* ── Send message to AI ─────────────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    addMsg("user", text);

    // Track in history for multi-turn context
    historyRef.current.push({ role: "user", content: text });

    setLoading(true);

    try {
      const uhid = getActiveUhid();
      const patName = getActivePatientName();
      const pageName = PAGE_NAMES[location.pathname] || location.pathname;

      const { data } = await axios.post(API_ENDPOINTS.AI_CHAT, {
        message: text,
        context: {
          page: pageName,
          uhid: uhid || undefined,
          patientName: patName || undefined,
          form: pageName,
        },
        history: historyRef.current.slice(-8),
      });

      // Add AI message text
      if (data.message) {
        addMsg("assistant", data.message);
        historyRef.current.push({ role: "assistant", content: data.message });
      }

      // Ask clarification if needed
      if (data.clarification_needed) {
        addMsg("system", "❓ " + data.clarification_needed);
        return;
      }

      // If there are actions → show confirm card
      const actions = data.actions || [];
      if (actions.length > 0 && actions[0].type !== "none") {
        // Find the confirm message index
        const confirmIdx = messages.length + (data.message ? 2 : 1);
        addMsg("confirm", null, { actions, confirmIdx });
        setPending({ actions, uhid });
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || "Connection error";
      addMsg("error", "❌ " + errMsg);
    } finally {
      setLoading(false);
    }
  }, [input, loading, location.pathname, messages.length]);

  /* ── Execute confirmed actions ──────────────────────────────────────── */
  const handleConfirm = async () => {
    if (!pending) return;
    setExecuting(true);

    const results = [];
    let navigateTo = null;
    let errorMsg = null;

    for (const action of pending.actions) {
      try {
        const result = await executeAction(action, user, pending.uhid);
        if (result?.navigateTo) navigateTo = result.navigateTo;
        results.push({ action, success: true, result });
      } catch (err) {
        errorMsg = err.message;
        results.push({ action, success: false, error: err.message });
        break;
      }
    }

    setExecuting(false);
    setPending(null);

    // Replace the confirm card with result
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "confirm" ? { ...m, role: "done" } : m
      )
    );

    if (errorMsg) {
      addMsg("error", "❌ Failed: " + errorMsg);
    } else {
      const dispatched = results.some((r) => r.result?.dispatched);
      // AuthContext exposes `fullName` / `firstName` / `lastName` — not
      // `name` / `username` (those were never set).
      const userName = user?.fullName || user?.firstName || "you";
      if (dispatched) {
        addMsg("system",
          `✅ Sent to the form! Saving under ${userName}… check the page in a moment.`
        );
      } else {
        const successCount = results.filter((r) => r.success).length;
        addMsg("system",
          `✅ Done! ${successCount} action${successCount > 1 ? "s" : ""} saved under ${userName}.${navigateTo ? " Navigating…" : ""}`
        );
      }
      if (navigateTo) {
        setTimeout(() => navigate(navigateTo), 800);
      }
    }
  };

  const handleCancel = () => {
    setPending(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "confirm" ? { ...m, role: "done", cancelled: true } : m
      )
    );
    addMsg("system", "Cancelled. Let me know if you need anything else.");
  };

  /* ── Keyboard submit ─────────────────────────────────────────────────── */
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  const pageName = PAGE_NAMES[location.pathname] || "";
  const uhid = getActiveUhid();

  return (
    <>
      {/* Bounce animation */}
      <style>{`
        @keyframes hisDotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        .his-textarea:focus { border-color: #2563eb !important; background: #fff !important; }
        .his-textarea::placeholder { color: #94a3b8; }
        .his-msg-pre { white-space: pre-wrap; margin: 0; font-family: inherit; font-size: inherit; }
        .his-fab-pulse {
          box-shadow: 0 0 0 0 rgba(37,99,235,0.5);
          animation: hisFabPulse 2s ease-out infinite;
        }
        @keyframes hisFabPulse {
          0% { box-shadow: 0 4px 20px rgba(37,99,235,0.45), 0 0 0 0 rgba(37,99,235,0.4); }
          70% { box-shadow: 0 4px 20px rgba(37,99,235,0.45), 0 0 0 12px rgba(37,99,235,0); }
          100% { box-shadow: 0 4px 20px rgba(37,99,235,0.45), 0 0 0 0 rgba(37,99,235,0); }
        }
      `}</style>

      {/* FAB */}
      <button
        style={S.fab(open)}
        className={!open ? "his-fab-pulse" : ""}
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close SphereAI" : "Open SphereAI Assistant"}
      >
        {open ? "✕" : "🤖"}
      </button>

      {/* Chat panel */}
      <div style={S.panel(open)}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerAvatar}>🤖</div>
          <div style={S.headerText}>
            <div style={S.headerTitle}>SphereAI</div>
            <div style={S.headerSub}>
              {pageName
                ? `${pageName}${uhid ? " · " + uhid : ""}`
                : "HIS Intelligent Assistant"}
            </div>
          </div>
          {user && (
            <div style={S.contextBadge}>
              {user.fullName || user.firstName || "User"}
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={S.messages}>
          {messages.map((msg, i) => {
            if (msg.role === "confirm") {
              return (
                <ConfirmCard
                  key={i}
                  actions={msg.actions}
                  onConfirm={handleConfirm}
                  onCancel={handleCancel}
                  loading={executing}
                />
              );
            }
            if (msg.role === "done") {
              return (
                <div key={i} style={{
                  ...S.confirmCard,
                  background: msg.cancelled ? "#f8fafc" : "#f0fdf4",
                  borderColor: msg.cancelled ? "#e2e8f0" : "#bbf7d0",
                  color: msg.cancelled ? "#94a3b8" : "#166534",
                  fontSize: 11.5,
                }}>
                  {msg.cancelled ? "⊘ Action cancelled" : "✅ Saved successfully"}
                </div>
              );
            }
            if (!msg.content) return null;
            return (
              <div key={i} style={S.msgBubble(msg.role)}>
                <pre className="his-msg-pre">{msg.content}</pre>
              </div>
            );
          })}

          {loading && (
            <div style={{ ...S.msgBubble("assistant"), padding: "6px 12px" }}>
              <TypingDots />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={S.inputRow}>
          <textarea
            ref={textareaRef}
            className="his-textarea"
            style={S.textarea}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type instruction… (Enter to send)"
            disabled={loading || executing}
          />
          <button
            style={S.sendBtn(!input.trim() || loading || executing)}
            onClick={sendMessage}
            disabled={!input.trim() || loading || executing}
            title="Send"
          >
            ➤
          </button>
        </div>
      </div>
    </>
  );
}
