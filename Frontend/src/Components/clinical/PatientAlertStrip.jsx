/**
 * PatientAlertStrip — R7hr-86
 *
 * Small inline strip of patient-safety alerts (allergies + twice-daily
 * assessment compliance). Designed to sit beside the "All Sections"
 * back button on Doctor/Nursing Notes so the alerts stay visible
 * without inflating the patient header card's vertical footprint.
 *
 * Replaces the .phc-footer block inside PatientHeaderCard.jsx.
 *
 * Props:
 *   patientId   — Mongo ObjectId of the patient/admission (used for
 *                 the compliance fetch).
 *   allergies   — Array of allergy strings. If empty/undefined, the
 *                 allergy chip won't render.
 *
 * Renders nothing when there are no allergies AND no OVERDUE/DUE_SOON
 * compliance status — so it doesn't add visual chrome when there's
 * nothing to alert about.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import "./PatientAlertStrip.css";

export default function PatientAlertStrip({ patientId, allergies = [] }) {
  const [compliance, setCompliance] = useState(null);

  // R7bn-5 / D6-fix pattern reused — poll every 60 s so the OVERDUE
  // counter stays close to live without hammering the backend.
  useEffect(() => {
    if (!patientId) { setCompliance(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${API_ENDPOINTS.BASE}/compliance/assessment-status/${patientId}`);
        if (cancelled) return;
        setCompliance(res.data?.summary || null);
      } catch (_) { /* silent — compliance is a soft UX nudge */ }
    };
    load();
    const id = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [patientId]);

  const clean = (allergies || []).filter(Boolean);
  const hasAllergy = clean.length > 0;
  const showCompliance = compliance && compliance.worst && compliance.worst !== "OK";

  if (!hasAllergy && !showCompliance) return null;

  return (
    <div className="pas-strip" role="region" aria-label="Patient safety alerts">
      {hasAllergy && (
        <div className="pas-chip pas-chip--allergy" title="Known allergies">
          <i className="pi pi-exclamation-triangle pas-chip-icon" />
          <span className="pas-chip-label">ALLERGY</span>
          <span className="pas-chip-value">{clean.join(", ")}</span>
        </div>
      )}
      {showCompliance && (
        <div
          className={`pas-chip pas-chip--compliance pas-chip--${compliance.worst.toLowerCase()}`}
          title="Twice-daily assessment schedule (NABH COP.17)"
        >
          <i className={`pi ${compliance.worst === "OVERDUE" ? "pi-exclamation-circle" : "pi-clock"} pas-chip-icon`} />
          <span className="pas-chip-label">
            {compliance.worst === "OVERDUE" ? "OVERDUE" : "DUE SOON"}
          </span>
          <span className="pas-chip-value">
            {compliance.overdue > 0 && `${compliance.overdue} overdue`}
            {compliance.overdue > 0 && compliance.dueSoon > 0 && " · "}
            {compliance.dueSoon > 0 && `${compliance.dueSoon} due soon`}
          </span>
        </div>
      )}
    </div>
  );
}
