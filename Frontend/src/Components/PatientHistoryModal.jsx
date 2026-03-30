// PatientHistoryModal.jsx — Complete A to Z patient history

import React, { useState, useEffect } from "react";
import axios from "axios";
import patientService from "../Services/patient/patientService";
import { API_ENDPOINTS } from "../config/api";

const TYPE_COLOR = {
  OPD: "#0891b2",
  Emergency: "#dc2626",
  IPD: "#7c3aed",
  Daycare: "#d97706",
  Services: "#059669",
};
const TYPE_BG = {
  OPD: "#e0f2fe",
  Emergency: "#fee2e2",
  IPD: "#ede9fe",
  Daycare: "#fef3c7",
  Services: "#d1fae5",
};
const TYPE_ICON = {
  OPD: "pi-user-plus",
  Emergency: "pi-bolt",
  IPD: "pi-home",
  Daycare: "pi-sun",
  Services: "pi-cog",
};

const fmt = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtFull = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const getDeptName = (d) =>
  !d ? "—" : typeof d === "object" ? d.departmentName || d.name || "—" : d;
const getDocName = (d) =>
  !d
    ? "—"
    : typeof d === "object"
      ? d.personalInfo?.fullName ||
        `${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim() ||
        d.name ||
        "—"
      : d;

const fetchAdmissions = async (patientId, uhid) => {
  const BASE = API_ENDPOINTS.ADMISSIONS;
  const extract = (res) => {
    const d = res?.data?.admissions || res?.data?.data || res?.data;
    return Array.isArray(d) ? d : null;
  };

  try {
    const r = await axios.get(`${BASE}/patient/${patientId}/history`);
    const d = extract(r);
    if (d) return d;
  } catch (_) {}
  try {
    const r = await axios.get(BASE, { params: { patientId, limit: 200 } });
    const d = extract(r);
    if (d) return d;
  } catch (_) {}
  if (uhid) {
    try {
      const r = await axios.get(BASE, { params: { UHID: uhid, limit: 200 } });
      const d = extract(r);
      if (d) return d;
    } catch (_) {}
  }
  try {
    const [aRes, dRes] = await Promise.allSettled([
      axios.get(`${BASE}/active`),
      axios.get(BASE, { params: { status: "Discharged", limit: 500 } }),
    ]);
    const active =
      aRes.status === "fulfilled"
        ? aRes.value.data?.data || aRes.value.data?.admissions || []
        : [];
    const discharge =
      dRes.status === "fulfilled"
        ? dRes.value.data?.admissions || dRes.value.data?.data || []
        : [];
    return [...active, ...discharge].filter((a) => {
      const pid = String(a.patientId?._id || a.patientId || "");
      const uid = String(a.UHID || "");
      return pid === String(patientId) || (uhid && uid === uhid);
    });
  } catch (_) {}
  return [];
};

export default function PatientHistoryModal({ patientId, visible, onHide }) {
  const [patient, setPatient] = useState(null);
  const [adms, setAdms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("timeline");

  useEffect(() => {
    if (visible && patientId) loadAll();
  }, [visible, patientId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const patRes = await patientService
        .getPatientById(patientId)
        .catch(() => null);
      const p = patRes?.data || patRes;
      setPatient(p);
      const list = await fetchAdmissions(patientId, p?.UHID);
      setAdms(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e?.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const p = patient;
  const opdVisits = p?.totalOPDVisits || 0;
  const emgVisits = p?.totalEmergencyVisits || 0;
  const ipdVisits = p?.totalIPDVisits || 0;
  const dayVisits = p?.totalDaycareVisits || 0;
  const svcVisits = p?.totalServicesVisits || 0;
  const totalVis = opdVisits + emgVisits + ipdVisits + dayVisits + svcVisits;
  const deptName = getDeptName(p?.department);
  const docName = getDocName(p?.doctor);

  const buildTimeline = () => {
    const entries = [];
    adms.forEach((a) =>
      entries.push({
        type: "admission",
        date: new Date(a.admissionDate),
        data: a,
      }),
    );

    const regDate = p?.registrationDate || p?.createdAt;
    const lastVisit = p?.lastVisitDate;
    const realDates = adms.map((a) => new Date(a.admissionDate).toDateString());

    [
      { key: "OPD", count: opdVisits },
      { key: "Emergency", count: emgVisits },
      { key: "IPD", count: ipdVisits },
      { key: "Daycare", count: dayVisits },
      { key: "Services", count: svcVisits },
    ].forEach(({ key, count }) => {
      if (count <= 0) return;
      if (regDate && !realDates.includes(new Date(regDate).toDateString())) {
        entries.push({
          type: "visit",
          date: new Date(regDate),
          data: {
            visitType: key,
            department: deptName,
            doctor: docName,
            date: regDate,
            note:
              count > 1 ? `Visit 1 of ${count} ${key} visits` : `${key} Visit`,
            isFirst: true,
          },
        });
      }
      if (
        count > 1 &&
        lastVisit &&
        lastVisit !== regDate &&
        !realDates.includes(new Date(lastVisit).toDateString())
      ) {
        entries.push({
          type: "visit",
          date: new Date(lastVisit),
          data: {
            visitType: key,
            department: deptName,
            doctor: docName,
            date: lastVisit,
            note: `Visit ${count} of ${count} (Latest) — ${key}`,
            isFirst: false,
          },
        });
      }
    });

    entries.sort((a, b) => b.date - a.date);
    return entries;
  };

  const timeline = buildTimeline();

  const InfoGrid = ({ items }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: "5px 14px",
      }}
    >
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k}>
          <div
            style={{
              fontSize: 9,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: ".03em",
            }}
          >
            {k}
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#0f172a",
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={String(v)}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onHide();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter',-apple-system,sans-serif",
      }}
    >
      <div
        style={{
          width: 740,
          maxWidth: "96vw",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 24px 60px rgba(0,0,0,.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "hi .22s cubic-bezier(.34,1.3,.64,1)",
        }}
      >
        <style>{`@keyframes hi{from{opacity:0;transform:scale(.91)}to{opacity:1;transform:scale(1)}}`}</style>

        {/* HEADER */}
        <div
          style={{
            background: "linear-gradient(135deg,#0f766e,#0891b2)",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(255,255,255,.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <i
                className="pi pi-history"
                style={{ color: "#fff", fontSize: 15 }}
              />
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>
                Patient Visit History
              </div>
              {p && (
                <div
                  style={{
                    color: "rgba(255,255,255,.75)",
                    fontSize: 11,
                    marginTop: 1,
                  }}
                >
                  {p.fullName} · UHID:{" "}
                  <strong style={{ fontFamily: "monospace" }}>{p.UHID}</strong>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={loadAll}
              style={{
                background: "rgba(255,255,255,.15)",
                border: "none",
                borderRadius: 7,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              <i
                className="pi pi-refresh"
                style={{ color: "#fff", fontSize: 12 }}
              />
            </button>
            <button
              onClick={onHide}
              style={{
                background: "rgba(255,255,255,.2)",
                border: "none",
                borderRadius: 7,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              <i
                className="pi pi-times"
                style={{ color: "#fff", fontSize: 12 }}
              />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {loading && (
            <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
              <i
                className="pi pi-spin pi-spinner" 
                style={{ fontSize: 30, color: "#0891b2" }}
              />
              <p style={{ marginTop: 10, fontSize: 13 }}>Loading history…</p>
            </div>
          )}

          {!loading && error && (
            <div style={{ textAlign: "center", padding: 40, color: "#ef4444" }}>
              <i
                className="pi pi-exclamation-circle"
                style={{ fontSize: 28, display: "block", marginBottom: 8 }}
              />
              <p style={{ fontSize: 13, marginBottom: 10 }}>{error}</p>
              <button
                onClick={loadAll}
                style={{
                  padding: "7px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#0891b2",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && p && (
            <>
              {/* Patient Info */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "12px 16px",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: "8px 14px",
                    marginBottom: 10,
                  }}
                >
                  {[
                    ["UHID", p.UHID],
                    ["Name", p.fullName],
                    [
                      "Age / Gender",
                      `${p.age || "—"} Yrs / ${p.gender || "—"}`,
                    ],
                    ["Blood Group", p.bloodGroup || "—"],
                    ["Contact", p.contactNumber || "—"],
                    ["Email", p.email || "—"],
                    [
                      "Address",
                      [p.address?.city, p.address?.state]
                        .filter(Boolean)
                        .join(", ") || "—",
                    ],
                    ["Allergies", p.knownAllergies || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div
                        style={{
                          fontSize: 9,
                          color: "#9ca3af",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".05em",
                        }}
                      >
                        {k}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#0f172a",
                          marginTop: 1,
                        }}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: "6px 14px",
                    paddingTop: 8,
                    borderTop: "1px solid #f1f5f9",
                  }}
                >
                  {[
                    ["Department", deptName],
                    ["Doctor", docName],
                    [
                      "TPA",
                      typeof p.tpa === "object"
                        ? p.tpa?.tpaName || "—"
                        : p.tpa || "Cash",
                    ],
                    ["Registered On", fmt(p.registrationDate || p.createdAt)],
                    ["Last Visit", fmt(p.lastVisitDate)],
                    [
                      "MLC Case",
                      p.isMLC ? `Yes (${p.mlcNumber || "—"})` : "No",
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div
                        style={{
                          fontSize: 9,
                          color: "#9ca3af",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".05em",
                        }}
                      >
                        {k}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color:
                            k === "MLC Case" && p.isMLC ? "#dc2626" : "#0f172a",
                          marginTop: 1,
                        }}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visit Counters */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6,1fr)",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {[
                  ["Total", totalVis, "#0f172a", "#f8fafc", "#e2e8f0"],
                  ["OPD", opdVisits, "#0891b2", "#e0f2fe", "#bae6fd"],
                  ["Emergency", emgVisits, "#dc2626", "#fee2e2", "#fecaca"],
                  ["IPD", ipdVisits, "#7c3aed", "#ede9fe", "#ddd6fe"],
                  ["Daycare", dayVisits, "#d97706", "#fef3c7", "#fde68a"],
                  ["Services", svcVisits, "#059669", "#d1fae5", "#a7f3d0"],
                ].map(([l, v, c, bg, border]) => (
                  <div
                    key={l}
                    style={{
                      background: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 10,
                      padding: "10px 8px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 900, color: c }}>
                      {v}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: c,
                        fontWeight: 700,
                        marginTop: 1,
                      }}
                    >
                      {l}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div
                style={{
                  display: "flex",
                  marginBottom: 12,
                  background: "#f1f5f9",
                  borderRadius: 10,
                  padding: 3,
                }}
              >
                {[
                  ["timeline", "pi-list-check", "Full Timeline"],
                  ["admissions", "pi-bed", `Admissions (${adms.length})`],
                ].map(([key, icon, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    style={{
                      flex: 1,
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: tab === key ? "#fff" : "transparent",
                      color: tab === key ? "#0f172a" : "#64748b",
                      fontWeight: tab === key ? 700 : 500,
                      fontSize: 12,
                      cursor: "pointer",
                      boxShadow:
                        tab === key ? "0 1px 4px rgba(0,0,0,.1)" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <i className={`pi ${icon}`} style={{ fontSize: 11 }} />{" "}
                    {label}
                  </button>
                ))}
              </div>

              {/* TIMELINE TAB */}
              {tab === "timeline" && (
                <div>
                  {timeline.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "24px 20px",
                        background: "#f8fafc",
                        borderRadius: 10,
                        border: "1px dashed #e2e8f0",
                      }}
                    >
                      <i
                        className="pi pi-calendar"
                        style={{
                          fontSize: 28,
                          color: "#cbd5e1",
                          display: "block",
                          marginBottom: 8,
                        }}
                      />
                      <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
                        No visit records found.
                      </p>
                    </div>
                  ) : (
                    <div style={{ position: "relative" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 17,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: "#e2e8f0",
                          zIndex: 0,
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        {timeline.map((entry, i) => {
                          /* Synthetic visit entry */
                          if (entry.type === "visit") {
                            const d = entry.data;
                            const col = TYPE_COLOR[d.visitType] || "#0891b2";
                            const bg = TYPE_BG[d.visitType] || "#e0f2fe";
                            return (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  gap: 12,
                                  position: "relative",
                                  zIndex: 1,
                                }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: "50%",
                                    background: bg,
                                    border: `3px solid ${col}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                    zIndex: 1,
                                  }}
                                >
                                  <i
                                    className={`pi ${TYPE_ICON[d.visitType] || "pi-calendar"}`}
                                    style={{ color: col, fontSize: 12 }}
                                  />
                                </div>
                                <div
                                  style={{
                                    flex: 1,
                                    background: "#fff",
                                    border: `1px solid ${col}30`,
                                    borderLeft: `4px solid ${col}`,
                                    borderRadius: 10,
                                    padding: "10px 14px",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      marginBottom: 6,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span
                                        style={{
                                          background: bg,
                                          color: col,
                                          borderRadius: 20,
                                          padding: "2px 10px",
                                          fontSize: 11,
                                          fontWeight: 700,
                                        }}
                                      >
                                        {d.visitType} Visit
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: "#94a3b8",
                                          fontStyle: "italic",
                                        }}
                                      >
                                        {d.note}
                                      </span>
                                    </div>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "#94a3b8",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {fmtFull(d.date)}
                                    </span>
                                  </div>
                                  <InfoGrid
                                    items={[
                                      ["Department", d.department || "—"],
                                      ["Doctor", d.doctor || "—"],
                                      ["Visit Type", d.visitType],
                                    ]}
                                  />
                                  {!d.isFirst && (
                                    <div
                                      style={{
                                        marginTop: 5,
                                        fontSize: 10,
                                        color: "#94a3b8",
                                        background: "#f8fafc",
                                        borderRadius: 5,
                                        padding: "3px 8px",
                                        display: "inline-block",
                                      }}
                                    >
                                      ⚠️ No detailed record — only visit counter
                                      available
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          /* Real admission entry */
                          const a = entry.data;
                          const rt =
                            a.admissionType === "Day Care"
                              ? "Daycare"
                              : a.admissionType || "Emergency";
                          const col = TYPE_COLOR[rt] || "#dc2626";
                          const bg = TYPE_BG[rt] || "#fee2e2";
                          const discharged =
                            a.status === "Discharged" ||
                            !!a.actualDischargeDate;
                          const dName = getDeptName(a.department);

                          return (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                gap: 12,
                                position: "relative",
                                zIndex: 1,
                              }}
                            >
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  background: bg,
                                  border: `3px solid ${col}`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                  zIndex: 1,
                                }}
                              >
                                <i
                                  className="pi pi-home"
                                  style={{ color: col, fontSize: 13 }}
                                />
                              </div>
                              <div
                                style={{
                                  flex: 1,
                                  background: "#fff",
                                  border: `1px solid ${col}25`,
                                  borderLeft: `4px solid ${col}`,
                                  borderRadius: 10,
                                  padding: "10px 14px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    marginBottom: 8,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <span
                                      style={{
                                        background: bg,
                                        color: col,
                                        borderRadius: 20,
                                        padding: "2px 10px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                      }}
                                    >
                                      {a.admissionType || "Emergency"}
                                    </span>
                                    <span
                                      style={{
                                        background: discharged
                                          ? "#d1fae5"
                                          : "#fef9c3",
                                        color: discharged
                                          ? "#065f46"
                                          : "#854d0e",
                                        borderRadius: 20,
                                        padding: "2px 10px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                      }}
                                    >
                                      {discharged ? "✓ Discharged" : "● Active"}
                                    </span>
                                    {a.admissionNumber && (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: "#94a3b8",
                                          fontFamily: "monospace",
                                        }}
                                      >
                                        {a.admissionNumber}
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {fmtFull(a.admissionDate)}
                                  </span>
                                </div>
                                <InfoGrid
                                  items={[
                                    [
                                      "Bed",
                                      a.bedId?.bedNumber || a.bedNumber || "—",
                                    ],
                                    ["Department", dName],
                                    ["Doctor", a.attendingDoctor || "—"],
                                    ["Diagnosis", a.reasonForAdmission || "—"],
                                    discharged && [
                                      "Discharged On",
                                      fmtFull(a.actualDischargeDate),
                                    ],
                                    discharged &&
                                      a.conditionOnDischarge && [
                                        "Condition",
                                        a.conditionOnDischarge,
                                      ],
                                    a.totalCost && [
                                      "Total Cost",
                                      `₹ ${Number(a.totalCost).toLocaleString("en-IN")}`,
                                    ],
                                  ]}
                                />
                                {discharged && a.dischargeSummary && (
                                  <div
                                    style={{
                                      marginTop: 7,
                                      padding: "6px 10px",
                                      background: "#f0fdf4",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      color: "#374151",
                                      borderLeft: "3px solid #22c55e",
                                    }}
                                  >
                                    <strong>Discharge Summary:</strong>{" "}
                                    {a.dischargeSummary.slice(0, 150)}
                                    {a.dischargeSummary.length > 150 ? "…" : ""}
                                  </div>
                                )}
                                {discharged && a.followUpInstructions && (
                                  <div
                                    style={{
                                      marginTop: 5,
                                      padding: "5px 10px",
                                      background: "#fffbeb",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      color: "#374151",
                                      borderLeft: "3px solid #f59e0b",
                                    }}
                                  >
                                    <strong>Follow-up:</strong>{" "}
                                    {a.followUpInstructions}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ADMISSIONS TAB */}
              {tab === "admissions" && (
                <div>
                  {adms.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "24px 20px",
                        background: "#f8fafc",
                        borderRadius: 10,
                        border: "1px dashed #e2e8f0",
                      }}
                    >
                      <i
                        className="pi pi-bed"
                        style={{
                          fontSize: 28,
                          color: "#cbd5e1",
                          display: "block",
                          marginBottom: 8,
                        }}
                      />
                      <p
                        style={{
                          fontSize: 13,
                          color: "#94a3b8",
                          margin: "0 0 6px",
                          fontWeight: 600,
                        }}
                      >
                        No detailed admission records found in database.
                      </p>
                      {(emgVisits > 0 || ipdVisits > 0) && (
                        <p
                          style={{
                            fontSize: 12,
                            color: "#f59e0b",
                            margin: "0 0 4px",
                            fontWeight: 600,
                          }}
                        >
                          ⚠️ {emgVisits > 0 ? `${emgVisits} Emergency` : ""}
                          {emgVisits > 0 && ipdVisits > 0 ? " + " : ""}
                          {ipdVisits > 0 ? `${ipdVisits} IPD` : ""} visit
                          counter — but no bed admission was created.
                        </p>
                      )}
                      <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0 }}>
                        Check Full Timeline tab.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {adms.map((a, i) => {
                        const rt =
                          a.admissionType === "Day Care"
                            ? "Daycare"
                            : a.admissionType || "Emergency";
                        const col = TYPE_COLOR[rt] || "#dc2626";
                        const bg = TYPE_BG[rt] || "#fee2e2";
                        const discharged =
                          a.status === "Discharged" || !!a.actualDischargeDate;
                        const dName = getDeptName(a.department);
                        return (
                          <div
                            key={a._id || i}
                            style={{
                              border: `1px solid ${col}25`,
                              borderLeft: `4px solid ${col}`,
                              borderRadius: 10,
                              background: "#fff",
                              padding: "12px 14px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    background: bg,
                                    color: col,
                                    borderRadius: 20,
                                    padding: "2px 10px",
                                    fontSize: 11,
                                    fontWeight: 700,
                                  }}
                                >
                                  {a.admissionType}
                                </span>
                                <span
                                  style={{
                                    background: discharged
                                      ? "#d1fae5"
                                      : "#fef9c3",
                                    color: discharged ? "#065f46" : "#854d0e",
                                    borderRadius: 20,
                                    padding: "2px 10px",
                                    fontSize: 11,
                                    fontWeight: 700,
                                  }}
                                >
                                  {discharged ? "✓ Discharged" : "● Active"}
                                </span>
                                {a.admissionNumber && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#94a3b8",
                                      fontFamily: "monospace",
                                    }}
                                  >
                                    {a.admissionNumber}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                                {fmtFull(a.admissionDate)}
                              </span>
                            </div>
                            <InfoGrid
                              items={[
                                [
                                  "Bed No.",
                                  a.bedId?.bedNumber || a.bedNumber || "—",
                                ],
                                ["Department", dName],
                                ["Doctor", a.attendingDoctor || "—"],
                                ["Diagnosis", a.reasonForAdmission || "—"],
                                ["Admission Type", a.admissionType || "—"],
                                discharged && [
                                  "Discharged On",
                                  fmtFull(a.actualDischargeDate),
                                ],
                                discharged &&
                                  a.conditionOnDischarge && [
                                    "Condition",
                                    a.conditionOnDischarge,
                                  ],
                                a.totalCost && [
                                  "Total Cost",
                                  `₹ ${Number(a.totalCost).toLocaleString("en-IN")}`,
                                ],
                                a.estimatedCost && [
                                  "Estimated",
                                  `₹ ${Number(a.estimatedCost).toLocaleString("en-IN")}`,
                                ],
                              ]}
                            />
                            {a.dischargeSummary && (
                              <div
                                style={{
                                  padding: "6px 10px",
                                  background: "#f0fdf4",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: "#374151",
                                  borderLeft: "3px solid #22c55e",
                                  marginTop: 4,
                                }}
                              >
                                <strong>Discharge Summary:</strong>{" "}
                                {a.dischargeSummary}
                              </div>
                            )}
                            {a.followUpInstructions && (
                              <div
                                style={{
                                  padding: "6px 10px",
                                  background: "#fffbeb",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: "#374151",
                                  borderLeft: "3px solid #f59e0b",
                                  marginTop: 4,
                                }}
                              >
                                <strong>Follow-up:</strong>{" "}
                                {a.followUpInstructions}
                              </div>
                            )}
                            {a.dischargeNotes && (
                              <div
                                style={{
                                  padding: "6px 10px",
                                  background: "#f8fafc",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: "#374151",
                                  borderLeft: "3px solid #94a3b8",
                                  marginTop: 4,
                                }}
                              >
                                <strong>Notes:</strong> {a.dischargeNotes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!loading && !error && !p && (
            <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
              <i
                className="pi pi-user"
                style={{
                  fontSize: 30,
                  display: "block",
                  marginBottom: 8,
                  opacity: 0.3,
                }}
              />
              <p style={{ fontSize: 13 }}>Patient data not available.</p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onHide}
            style={{
              padding: "8px 22px",
              borderRadius: 9,
              border: "1.5px solid #e2e8f0",
              background: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: "#374151",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
