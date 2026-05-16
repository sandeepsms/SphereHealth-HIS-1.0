/**
 * RequestWardBoyButton — drop-in widget for any clinical page where a
 * nurse / doctor / receptionist might want to raise a ward-boy task.
 *
 * Usage:
 *   <RequestWardBoyButton
 *     patient={{ UHID, patientName, admissionId, fromLocation }}
 *     defaultType="transport"
 *     compact
 *   />
 *
 * Renders as a small pill button; click opens a modal pre-filled with
 * the patient context. Submits to POST /api/ward-tasks.
 */
import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Modal, Field, C } from "../admin-theme";
import { useAuth } from "../../context/AuthContext";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const TYPES = [
  { value: "transport", label: "🚪 Transport (wheelchair / stretcher)" },
  { value: "equipment", label: "🔌 Equipment (BP cuff / suction / ECG…)" },
  { value: "sample",    label: "🧪 Sample drop / report pickup" },
  { value: "errand",    label: "🛒 Pharmacy / store errand" },
  { value: "linen",     label: "🧺 Linen change / pickup" },
  { value: "bmw",       label: "🗑️  BMW disposal" },
  { value: "other",     label: "📋 Other" },
];

export default function RequestWardBoyButton({ patient = {}, defaultType = "transport", compact = false, color = "#0d9488", labelOverride }) {
  const { can } = useAuth();
  if (!can("ward.create")) return null;   // hide for roles that can't request

  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Request a ward boy"
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: compact ? "4px 9px" : "6px 12px", borderRadius: 999,
          border: `1.5px solid ${color}`,
          background: color + "10",
          color, fontWeight: 800, fontSize: compact ? 11 : 12, cursor: "pointer",
          whiteSpace: "nowrap",
        }}>
        <i className="pi pi-user" style={{ fontSize: compact ? 10 : 11 }} />
        {labelOverride || (compact ? "Ward Boy" : "Request Ward Boy")}
      </button>

      {open && <RequestModal patient={patient} defaultType={defaultType} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestModal({ patient, defaultType, onClose }) {
  const [type,        setType]        = useState(defaultType);
  const [title,       setTitle]       = useState("");
  const [from,        setFrom]        = useState(patient.fromLocation || "");
  const [to,          setTo]          = useState("");
  const [priority,    setPriority]    = useState("normal");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Auto-suggest a title for the most common case: transport with both ends.
  const suggestedTitle = (() => {
    if (type === "transport" && (to || patient.toLocation)) {
      return `${patient.patientName ? patient.patientName + " — " : ""}wheelchair to ${to || patient.toLocation}`;
    }
    return title;
  })();

  const submit = async () => {
    const t = title.trim() || suggestedTitle;
    if (!t) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/ward-tasks`, {
        type, title: t, description,
        fromLocation: from, toLocation: to,
        priority,
        UHID: patient.UHID,
        patientName: patient.patientName,
        admissionId: patient.admissionId,
      }, authHdr());
      toast.success("Ward boy request raised.");
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not raise task");
    }
    setSaving(false);
  };

  return (
    <Modal title="Request Ward Boy" icon="pi-user" color="#0d9488" onClose={onClose}
      submitLabel="Send Request" submitting={saving} onSubmit={submit}>
      {patient.UHID && (
        <div style={{ marginBottom: 12, padding: "8px 10px", background: "#f0fdfa", border: "1px solid #5eead4", borderRadius: 6, fontSize: 12 }}>
          <strong>{patient.patientName || "—"}</strong>{" "}
          {patient.UHID && <span style={{ color: C.muted }}>· {patient.UHID}</span>}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Task type">
          <select value={type} onChange={(e) => setType(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Short title (what's needed)">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={suggestedTitle || "e.g. Wheelchair to Radiology"}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="From">
            <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Ward / Bed / Room"
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
          </Field>
          <Field label="To">
            <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="OT / Lab / Radiology"
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
          </Field>
        </div>

        <Field label="Priority">
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { v: "urgent", lbl: "Urgent", color: "#dc2626" },
              { v: "high",   lbl: "High",   color: "#d97706" },
              { v: "normal", lbl: "Normal", color: "#0d9488" },
              { v: "low",    lbl: "Low",    color: "#6b7280" },
            ].map(p => (
              <button key={p.v} type="button" onClick={() => setPriority(p.v)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 7,
                  border: `1.5px solid ${priority === p.v ? p.color : C.border}`,
                  background: priority === p.v ? p.color + "15" : "#fff",
                  color: priority === p.v ? p.color : C.muted,
                  fontWeight: 800, fontSize: 11.5, cursor: "pointer",
                }}>{p.lbl}</button>
            ))}
          </div>
        </Field>

        <Field label="Description (optional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="Additional context — e.g. attendant unavailable, oxygen needed during transport, etc."
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
        </Field>
      </div>
    </Modal>
  );
}
