/**
 * TreatmentChartMarPrint.jsx — R7hr-152
 *
 * Print-ready wrapper around TreatmentChartDayStack so the Nursing
 * Treatment Chart → "Print MAR" button surfaces the SAME day-wise
 * digest the patient panel shows (Vitals / Medications Administered
 * / Infusions / Intake-Output / Other Observations) — page-friendly,
 * with a hospital letterhead, patient strip, NABH footer.
 *
 * URL: /print/treatment-chart?uhid=...&visitId=...&admissionId=...&
 *      admissionDate=ISO&patientName=&ipdNo=&ward=&bed=&consultant=
 *
 * The print fires window.print() once TreatmentChartDayStack signals
 * data is loaded (printReady), and the window closes after the user
 * cancels or completes the print dialog.
 *
 * R25-safe: reuses the existing day-stack component instead of forking
 * a duplicate print-only renderer, so any change to the day digest
 * shape is automatically reflected in the printed MAR.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import TreatmentChartDayStack from "../../Components/clinical/TreatmentChartDayStack";
import { API_BASE_URL as API } from "../../config/api";

const PRINT_CSS = `
  @page { size: A4; margin: 14mm 10mm 14mm 10mm; }
  html, body { background: #fff !important; }
  body { font-family: 'DM Sans', system-ui, sans-serif; color: #0f172a; }
  .mar-print-shell { max-width: 200mm; margin: 0 auto; padding: 0 8px; }
  .mar-print-head { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .mar-print-title { font-size: 20px; font-weight: 800; letter-spacing: .3px; }
  .mar-print-sub { font-size: 11px; color: #475569; margin-top: 2px; }
  .mar-print-pt {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 8px 0 16px;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #f8fafc;
    font-size: 11.5px;
  }
  .mar-print-pt .lbl { font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .5px; }
  .mar-print-pt .val { font-weight: 700; color: #0f172a; }
  .mar-print-footer { margin-top: 14px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
  @media print {
    .mar-print-noprint { display: none !important; }
    .mar-print-shell { max-width: 100%; }
  }
`;

export default function TreatmentChartMarPrint() {
  const [sp] = useSearchParams();

  // ── URL params → component props ───────────────────────────────
  const params = useMemo(() => ({
    uhid:          sp.get("uhid")          || "",
    visitId:       sp.get("visitId")       || "",
    admissionId:   sp.get("admissionId")   || "",
    admissionDate: sp.get("admissionDate") || "",
    patientName:   sp.get("patientName")   || "",
    ipdNo:         sp.get("ipdNo")         || "",
    ward:          sp.get("ward")          || "",
    bed:           sp.get("bed")           || "",
    consultant:    sp.get("consultant")    || "",
    age:           sp.get("age")           || "",
    gender:        sp.get("gender")        || "",
    diagnosis:     sp.get("diagnosis")     || "",
  }), [sp]);

  // ── Hospital letterhead from settings (best-effort) ────────────
  const [hospital, setHospital] = useState({ hospitalName: "", address: "" });
  useEffect(() => {
    axios.get(`${API}/hospital-settings`)
      .then((r) => {
        const h = r.data?.data || r.data || {};
        setHospital({
          hospitalName: h.hospitalName || h.name || "Hospital",
          address:      h.address      || h.fullAddress || "",
          phone:        h.phone        || h.contactPhone || "",
          gstin:        h.gstin        || "",
          logoUrl:      h.logoUrl      || h.logo       || "",
        });
      })
      .catch(() => { /* best-effort only */ });
  }, []);

  // ── Admission lookup: pull admissionDate, ward, bed, consultant
  // from the active admission when the caller (TreatmentChart "Print
  // MAR" button) didn't pass them. The day-stack needs admissionDate
  // to compute the day-wise slices, so this is non-negotiable. ─────
  const [admission, setAdmission] = useState(null);
  const [admissionResolved, setAdmissionResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const uhid = params.uhid;
    const aId  = params.admissionId;
    if (!uhid && !aId) { setAdmissionResolved(true); return; }
    // Prefer admissionId when present; fallback to active-by-UHID.
    const url = aId
      ? `${API}/admissions/${aId}`
      : `${API}/admissions/active?UHID=${encodeURIComponent(uhid)}&hasBed=true`;
    axios.get(url)
      .then((r) => {
        if (cancelled) return;
        const d = r.data?.data || r.data || {};
        // Active list returns { data: [...] }; single get returns the doc.
        const adm = Array.isArray(d) ? d[0]
                  : (Array.isArray(d?.admissions) ? d.admissions[0] : d);
        setAdmission(adm || null);
      })
      .catch(() => { /* admission absent — fall through to URL params */ })
      .finally(() => { if (!cancelled) setAdmissionResolved(true); });
    return () => { cancelled = true; };
  }, [params.uhid, params.admissionId]);

  // Merge URL params + admission lookup. URL wins when both present.
  const merged = useMemo(() => {
    const a = admission || {};
    const at = a?.attendingDoctor || a?.attendingDoctorId || {};
    return {
      uhid:          params.uhid          || a.UHID || a.patientUHID || "",
      ipdNo:         params.ipdNo         || a.ipdNo || a.admissionNumber || "",
      visitId:       params.visitId       || a.ipdNo || a.admissionNumber || "",
      admissionId:   params.admissionId   || a._id || "",
      admissionDate: params.admissionDate || a.admissionDate || a.createdAt || "",
      patientName:   params.patientName   || a.patientName || a?.patientId?.fullName || "",
      ward:          params.ward          || a.wardName || a?.wardId?.name || "",
      bed:           params.bed           || a.bedNumber || a?.bedId?.bedNumber || "",
      consultant:    params.consultant    || at.fullName || a.attendingDoctorName || "",
      age:           params.age           || a.age || a?.patientId?.age || "",
      gender:        params.gender        || a.gender || a?.patientId?.gender || "",
      diagnosis:     params.diagnosis     || a.diagnosis?.provisional || a.provisionalDiagnosis || "",
    };
  }, [params, admission]);

  // ── Fire print() once the stack signals ready ──────────────────
  // We gate on admissionResolved too so the print dialog never opens
  // while the patient strip is still rendering "—".
  const [stackReady, setStackReady] = useState(false);
  const onPrintReady = useCallback(() => { setStackReady(true); }, []);
  useEffect(() => {
    if (!stackReady || !admissionResolved) return;
    const t = setTimeout(() => {
      try { window.print(); } catch { /* silent */ }
    }, 350);
    return () => clearTimeout(t);
  }, [stackReady, admissionResolved]);

  // Close the window after the user dismisses the print dialog (most
  // browsers fire afterprint — if not, the user can close manually).
  useEffect(() => {
    const onAfter = () => { setTimeout(() => { try { window.close(); } catch {} }, 200); };
    window.addEventListener("afterprint", onAfter);
    return () => window.removeEventListener("afterprint", onAfter);
  }, []);

  const printedAt = (() => {
    try {
      return new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  })();

  if (!merged.uhid) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2>Treatment Chart — Print MAR</h2>
        <p style={{ color: "#b91c1c" }}>Missing UHID in URL. Reopen the print from the Nursing Notes page.</p>
      </div>
    );
  }

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="mar-print-shell">
        {/* Letterhead */}
        <div className="mar-print-head">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {hospital.logoUrl && (
              <img src={hospital.logoUrl} alt="logo" style={{ width: 54, height: 54, objectFit: "contain" }} />
            )}
            <div>
              <div className="mar-print-title">{hospital.hospitalName || "Hospital"}</div>
              <div className="mar-print-sub">
                {hospital.address}{hospital.phone ? ` · ☎ ${hospital.phone}` : ""}
              </div>
              <div className="mar-print-sub" style={{ marginTop: 4 }}>
                <strong style={{ color: "#0f172a" }}>Treatment Chart — Medication Administration Record (MAR)</strong>
                {" · NABH MOM.2 / MOM.3 / COP.3"}
              </div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 10, color: "#64748b" }}>
              Printed: <strong>{printedAt}</strong>
            </div>
          </div>
        </div>

        {/* Patient strip */}
        <div className="mar-print-pt">
          <div><div className="lbl">Patient</div><div className="val">{merged.patientName || "—"}</div></div>
          <div><div className="lbl">UHID / IPD No.</div><div className="val">{merged.uhid}{merged.ipdNo ? ` · ${merged.ipdNo}` : ""}</div></div>
          <div><div className="lbl">Age / Sex</div><div className="val">{merged.age || "—"}{merged.gender ? ` / ${merged.gender}` : ""}</div></div>
          <div><div className="lbl">Ward / Bed</div><div className="val">{merged.ward || "—"}{merged.bed ? ` · Bed ${merged.bed}` : ""}</div></div>
          <div><div className="lbl">Consultant</div><div className="val">{merged.consultant || "—"}</div></div>
          <div><div className="lbl">Diagnosis</div><div className="val" style={{ gridColumn: "span 3" }}>{merged.diagnosis || "—"}</div></div>
        </div>

        {/* Loading banner while the admission lookup resolves so the
            stack doesn't render with a stale fallback admissionDate. */}
        {!admissionResolved && (
          <div style={{ padding: 18, color: "#64748b", textAlign: "center", fontSize: 12 }}>
            Resolving admission details for the day-wise digest…
          </div>
        )}

        {/* The actual day-wise digest — same UI the patient panel shows */}
        {admissionResolved && (
          <TreatmentChartDayStack
            UHID={merged.uhid}
            visitId={merged.visitId}
            admissionId={merged.admissionId}
            admissionDate={merged.admissionDate || new Date().toISOString()}
            patientName={merged.patientName}
            nurseMode={true}
            printMode={true}
            onPrintReady={onPrintReady}
          />
        )}

        {/* Footer */}
        <div className="mar-print-footer">
          <span>This is a system-generated MAR. Verify against the live record before clinical decisions.</span>
          <span>NABH AAC.7 / MOM.2</span>
        </div>
      </div>
    </>
  );
}
