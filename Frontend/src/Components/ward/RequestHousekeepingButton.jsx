/**
 * RequestHousekeepingButton — drop-in widget to request a cleaning
 * task. Same pattern as RequestWardBoyButton. POSTs to
 * /api/housekeeping/tasks.
 */
import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Modal, Field, C } from "../admin-theme";
import { useAuth } from "../../context/AuthContext";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const TYPES = [
  { value: "routine",         label: "🧹 Routine clean" },
  { value: "terminal",        label: "🧴 Terminal clean (ICU/OT/isolation)" },
  { value: "spillage",        label: "🟥 Spillage cleanup" },
  { value: "restroom",        label: "🚻 Restroom" },
  { value: "public-area",     label: "🏢 Public area / corridor" },
  { value: "bed-turnover",    label: "🛏️ Bed turnover" },
  { value: "discharge-clean", label: "🚪 Post-discharge clean" },
  { value: "other",           label: "📋 Other" },
];

export default function RequestHousekeepingButton({ patient = {}, defaultType = "routine", compact = false, color = "#0d9488", labelOverride }) {
  const { can } = useAuth();
  if (!can("house.create")) return null;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Request a cleaning task"
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: compact ? "4px 9px" : "6px 12px", borderRadius: 999,
          border: `1.5px solid ${color}`, background: color + "10",
          color, fontWeight: 800, fontSize: compact ? 11 : 12, cursor: "pointer", whiteSpace: "nowrap",
        }}>
        <i className="pi pi-sparkles" style={{ fontSize: compact ? 10 : 11 }} />
        {labelOverride || (compact ? "Cleaning" : "Request Cleaning")}
      </button>
      {open && <RequestModal patient={patient} defaultType={defaultType} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestModal({ patient, defaultType, onClose }) {
  const [type, setType] = useState(defaultType);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState(patient.area || "");
  const [room, setRoom] = useState(patient.roomNumber || "");
  const [bed, setBed] = useState(patient.bedNumber || "");
  const [priority, setPriority] = useState(type === "spillage" ? "urgent" : "normal");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = title.trim() || (type === "discharge-clean" && bed ? `Discharge clean — bed ${bed}` : "");
    if (!t) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/housekeeping/tasks`, {
        type, title: t, description,
        area, roomNumber: room, bedNumber: bed,
        priority,
        UHID: patient.UHID, patientName: patient.patientName,
      }, authHdr());
      toast.success("Cleaning request raised.");
      onClose();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };

  return (
    <Modal title="Request Cleaning" icon="pi-sparkles" color="#0d9488" onClose={onClose}
      submitLabel="Send Request" submitting={saving} onSubmit={submit}>
      {patient.UHID && (
        <div style={{ marginBottom: 12, padding: "8px 10px", background: "#f0fdfa", border: "1px solid #5eead4", borderRadius: 6, fontSize: 12 }}>
          <strong>{patient.patientName || "—"}</strong>{" "}
          {patient.UHID && <span style={{ color: C.muted }}>· {patient.UHID}</span>}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Cleaning type">
          <select value={type} onChange={(e) => setType(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Short title">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={type === "spillage" ? "e.g. Blood spillage near bed 4" : type === "discharge-clean" ? "Discharge clean — bed " + (bed || "?") : "What's needed"}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
          <Field label="Area"><input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ward / OT / Lab"
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
          <Field label="Room"><input value={room} onChange={(e) => setRoom(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
          <Field label="Bed"><input value={bed} onChange={(e) => setBed(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
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
                style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1.5px solid ${priority === p.v ? p.color : C.border}`, background: priority === p.v ? p.color + "15" : "#fff", color: priority === p.v ? p.color : C.muted, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>
                {p.lbl}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Description (optional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
        </Field>
      </div>
    </Modal>
  );
}
