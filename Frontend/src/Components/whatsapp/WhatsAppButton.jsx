/**
 * WhatsAppButton — reusable click-to-chat trigger
 *
 * Usage:
 *   <WhatsAppButton
 *     phone={patient.contactNumber}
 *     patientName={patient.fullName}
 *     context={{ doctorName, tokenNumber, ... }}
 *     defaultTemplate="appointment_confirmation"
 *     compact
 *   />
 *
 * Behaviour:
 *   • Disabled when no valid phone
 *   • Opens a modal with template picker + preview + Send button
 *   • Send → opens wa.me URL in new tab (user's WhatsApp Web / app)
 *   • No paid API; zero infrastructure
 */

import React, { useState } from "react";
import { toast } from "react-toastify";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import { TEMPLATES, getTemplate, buildWhatsAppURL } from "./whatsapp-templates";
import "./whatsapp.css";

export default function WhatsAppButton({
  phone,
  patientName,
  context = {},
  defaultTemplate = "appointment_confirmation",
  compact = false,
  label = "WhatsApp",
}) {
  const [open, setOpen] = useState(false);
  const valid = phone && /^\+?\d{10,15}$/.test(String(phone).replace(/\D/g, "").length >= 10 ? phone : "");
  const phoneClean = phone ? String(phone).replace(/\D/g, "") : "";
  const hasPhone = phoneClean.length >= 10;

  return (
    <>
      <button
        className={`wa-btn ${compact ? "wa-btn--icon" : ""}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        disabled={!hasPhone}
        title={hasPhone ? `Send WhatsApp to ${phoneClean}` : "No phone number"}
      >
        <i className="pi pi-whatsapp" />
        <span>{label}</span>
      </button>
      {open && (
        <WhatsAppModal
          phone={phoneClean}
          patientName={patientName}
          context={context}
          defaultTemplate={defaultTemplate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ─────────── Modal ─────────── */
function WhatsAppModal({ phone, patientName, context, defaultTemplate, onClose }) {
  const { settings } = useHospitalSettings();
  const [templateId, setTemplateId] = useState(defaultTemplate);
  const tpl = getTemplate(templateId);

  // Compose full context (patient + settings + caller-provided)
  const fullContext = {
    patientName: patientName || "Sir/Madam",
    hospitalName: settings?.hospitalName || "your hospital",
    ...context,
  };

  const [text, setText] = useState(() => tpl.build(fullContext));

  // Recompute preview when template changes
  const onTemplate = (id) => {
    const t = getTemplate(id);
    setTemplateId(id);
    setText(t.build(fullContext));
  };

  const send = () => {
    const url = buildWhatsAppURL(phone, text);
    if (!url) { toast.error("Invalid phone number"); return; }
    window.open(url, "_blank", "noopener");
    toast.success("Opening WhatsApp…");
    onClose();
  };

  return (
    <div className="wa-modal-backdrop" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <i className="pi pi-whatsapp" style={{ fontSize: 22 }} />
          <div>
            <div className="wa-modal-head-title">Send via WhatsApp</div>
            <div className="wa-modal-head-sub">Free click-to-chat · opens in your WhatsApp</div>
          </div>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="wa-modal-body">
          {/* Recipient */}
          <div className="wa-recipient">
            <div className="wa-recipient-icon"><i className="pi pi-user" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="wa-recipient-name">{patientName || "Patient"}</div>
              <div className="wa-recipient-phone">+{phone}</div>
            </div>
          </div>

          {/* Template picker */}
          <div className="wa-preview-label">Choose a template</div>
          <div className="wa-templates">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                className={`wa-template-btn ${templateId === t.id ? "wa-template-btn--active" : ""}`}
                onClick={() => onTemplate(t.id)}
              >
                <div className="wa-template-icon"><i className={`pi ${t.icon}`} /></div>
                <div className="wa-template-meta">
                  <div className="wa-template-name">{t.name}</div>
                  <div className="wa-template-desc">{t.description}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Message preview / editor */}
          <div className="wa-preview-label">Message (you can edit before sending)</div>
          <textarea
            className="wa-preview wa-preview--editable"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
          />
        </div>

        <div className="wa-modal-foot">
          <span className="wa-modal-hint">📱 Opens your WhatsApp Web / app — no SMS charges, no API fees</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="wa-btn-cancel" onClick={onClose}>Cancel</button>
            <button className="wa-btn-send" onClick={send} disabled={!text.trim()}>
              <i className="pi pi-send" /> Send via WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
