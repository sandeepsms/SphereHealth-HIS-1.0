// BedAdmissionDrawer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Right-side slide-in drawer for admitting a patient to a pre-selected bed.
// Opens from BedManagement when user clicks "Click To Admit Patient".
//
// Props:
//   visible      : bool            — open/close
//   onHide       : () => void      — close callback
//   bed          : object          — the bed object clicked { _id, bedNumber, room, ward, floor, building, ... }
//   onSuccess    : () => void      — called after successful admission (to refresh bed list)
//
// Usage in BedVisualLayout / BedManagement:
//   <BedAdmissionDrawer visible={drawerOpen} onHide={() => setDrawerOpen(false)} bed={selectedBed} onSuccess={refreshBeds} />
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from "react";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { Checkbox } from "primereact/checkbox";

import { departmentService } from "../../Services/departmentService";
import { doctorService } from "../../Services/doctors/doctorService";
import { tpaService } from "../../Services/tpa/tpaService";
import patientService from "../../Services/patient/patientService";
import { API_ENDPOINTS } from "../../config/api";

/* ── helpers ── */
const getId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.$oid) return v.$oid;
  if (v._id) return getId(v._id);
  return String(v);
};
const arr = (v) => (Array.isArray(v) ? v : v?.data || []);
const calcAge = (dob) => {
  if (!dob) return "";
  const today = new Date(),
    birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age < 0 ? "" : age;
};

/* ── admission type options ── */
const ADM_TYPES = [
  { label: "Emergency", value: "Emergency" },
  { label: "Planned", value: "Planned" },
  { label: "Day Care", value: "Day Care" },
];

const BLANK_FORM = {
  fullName: "",
  title: "",
  gender: "",
  dateOfBirth: null,
  age: "",
  contactNumber: "",
  email: "",
  bloodGroup: "",
  knownAllergies: "",
  department: "",
  doctor: "",
  paymentType: "GENERAL",
  tpa: null,
  policyNumber: "",
  policyHolderName: "",
  isMLC: false,
  mlcNumber: "",
  companionName: "",
  companionRelationship: "",
  companionContact: "",
  address: { completeAddress: "", pincode: "", city: "", state: "" },
};

const BLANK_ADM = {
  reasonForAdmission: "",
  admissionType: "Emergency",
  expectedDischargeDate: null,
  specialInstructions: "",
};

/* ════════════════════════════════════════════════════════════════════════════ */
export default function BedAdmissionDrawer({
  visible,
  onHide,
  bed,
  onSuccess,
}) {
  const toast = useRef(null);

  /* ── master data ── */
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [allDoctors, setAllDoctors] = useState([]);
  const [tpaList, setTpaList] = useState([]);
  const [masterLoading, setMasterLoading] = useState(false);

  /* ── patient search ── */
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [existingPatient, setExistingPatient] = useState(null); // if found via search

  /* ── form state ── */
  const [formData, setFormData] = useState({ ...BLANK_FORM });
  const [admData, setAdmData] = useState({ ...BLANK_ADM });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  /* ── tab: "new" | "existing" ── */
  const [tab, setTab] = useState("existing"); // default: search existing first

  /* ── Load master data once ── */
  useEffect(() => {
    (async () => {
      setMasterLoading(true);
      try {
        const [depts, docs, tpas] = await Promise.all([
          departmentService.getAllDepartments(),
          doctorService.getAllDoctors(),
          tpaService.getAllTPAs().catch(() => []),
        ]);
        setDepartments(
          arr(depts).map((d) => ({
            label: d.departmentName,
            value: getId(d._id),
          })),
        );
        const docArr = arr(docs);
        setAllDoctors(docArr);
        setTpaList(
          arr(tpas)
            .filter((t) => t.isActive !== false)
            .map((t) => ({ label: t.tpaName, value: getId(t._id) })),
        );
      } catch (e) {
        console.error("[BedAdmissionDrawer] master load:", e);
      } finally {
        setMasterLoading(false);
      }
    })();
  }, []);

  /* ── Filter doctors by department ── */
  useEffect(() => {
    if (!formData.department) {
      setDoctors([]);
      return;
    }
    const filtered = allDoctors
      .filter((d) => getId(d.department) === formData.department)
      .map((d) => ({
        label: d.personalInfo?.fullName || d.name || "Doctor",
        value: getId(d._id),
      }));
    setDoctors(filtered);
  }, [formData.department, allDoctors]);

  /* ── Reset when drawer opens/closes ── */
  useEffect(() => {
    if (visible) {
      setFormData({ ...BLANK_FORM });
      setAdmData({ ...BLANK_ADM });
      setErrors({});
      setExistingPatient(null);
      setSearchQuery("");
      setSearchResults([]);
      setTab("existing");
    }
  }, [visible]);

  /* ── Patient search ── */
  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await patientService.searchPatients(q.trim());
      setSearchResults(arr(res).slice(0, 8));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const selectExistingPatient = (p) => {
    setExistingPatient(p);
    setSearchResults([]);
    setSearchQuery("");
    // Prefill form
    setFormData((prev) => ({
      ...prev,
      fullName: p.fullName || "",
      title: p.title || "",
      gender: p.gender || "",
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
      age: p.age || calcAge(p.dateOfBirth),
      contactNumber: p.contactNumber || "",
      email: p.email || "",
      bloodGroup: p.bloodGroup || "",
      knownAllergies: p.knownAllergies || "",
      department: getId(p.department) || "",
      doctor: getId(p.doctor) || "",
      paymentType: p.paymentType || "GENERAL",
      tpa: getId(p.tpa) || null,
      policyNumber: p.policyNumber || "",
      isMLC: p.isMLC || false,
      address: p.address || {
        completeAddress: "",
        pincode: "",
        city: "",
        state: "",
      },
    }));
    setAdmData((prev) => ({
      ...prev,
      admissionType: "Emergency",
    }));
  };

  const clearExisting = () => {
    setExistingPatient(null);
    setFormData({ ...BLANK_FORM });
    setAdmData({ ...BLANK_ADM });
    setErrors({});
  };

  /* ── Field handlers ── */
  const hc = (name, value) => {
    if (name === "title") {
      const map = {
        "Mr.": "Male",
        Master: "Male",
        "Mrs.": "Female",
        Miss: "Female",
      };
      setFormData((p) => ({
        ...p,
        title: value,
        gender: map[value] || p.gender,
      }));
    } else if (name === "dateOfBirth") {
      setFormData((p) => ({ ...p, dateOfBirth: value, age: calcAge(value) }));
    } else if (name.startsWith("addr.")) {
      const f = name.split(".")[1];
      setFormData((p) => ({ ...p, address: { ...p.address, [f]: value } }));
    } else {
      setFormData((p) => ({ ...p, [name]: value }));
    }
    if (errors[name]) setErrors((p) => ({ ...p, [name]: "" }));
  };

  const ha = (name, value) => {
    setAdmData((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((p) => ({ ...p, [name]: "" }));
  };

  /* ── Validation ── */
  const validate = () => {
    const e = {};
    if (!formData.fullName.trim()) e.fullName = "Required";
    if (!formData.gender) e.gender = "Required";
    if (!formData.contactNumber.trim()) e.contactNumber = "Required";
    if (!formData.department) e.department = "Required";
    if (!formData.doctor) e.doctor = "Required";
    if (!admData.reasonForAdmission.trim()) e.reasonForAdmission = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!validate()) {
      toast.current?.show({
        severity: "error",
        summary: "Validation Error",
        detail: "Please fill required fields",
        life: 3000,
      });
      return;
    }
    if (!bed?._id) {
      toast.current?.show({
        severity: "error",
        summary: "No Bed",
        detail: "Bed information missing",
        life: 3000,
      });
      return;
    }

    setLoading(true);
    try {
      let patient = existingPatient;

      /* STEP 1: Create / update patient */
      if (!existingPatient) {
        const payload = {
          ...formData,
          registrationType: "IPD",
          tpa: formData.tpa || null,
          email: formData.email || null,
          mlcNumber: formData.mlcNumber || null,
        };
        const res = await fetch(API_ENDPOINTS.PATIENTS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success)
          throw new Error(data.message || "Registration failed");
        patient = data.data;
      } else {
        // Update registrationType + visit counter on existing patient
        const res = await fetch(
          `${API_ENDPOINTS.PATIENTS}/${existingPatient._id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registrationType: "IPD",
              department: formData.department,
              doctor: formData.doctor,
              _incrementVisit: "totalIPDVisits",
            }),
          },
        );
        const data = await res.json();
        if (!data.success)
          throw new Error(data.message || "Patient update failed");
        patient = data.data || existingPatient;
        patient.UHID = patient.UHID || existingPatient.UHID;
        patient._id = patient._id || existingPatient._id;
      }

      /* STEP 2: Create admission + book bed */
      const admRes = await fetch(
        `${API_ENDPOINTS.BASE_URL || ""}/api/admissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId: patient._id,
            UHID: patient.UHID,
            bedId: getId(bed._id),
            department: formData.department,
            admissionDate: new Date().toISOString(),
            expectedDischargeDate: admData.expectedDischargeDate || undefined,
            reasonForAdmission: admData.reasonForAdmission,
            admissionType: admData.admissionType,
            attendingDoctor:
              doctors.find((d) => d.value === formData.doctor)?.label || "",
            specialInstructions: admData.specialInstructions,
          }),
        },
      );
      const admJson = await admRes.json();
      if (!admJson.success && !admJson.admissionNumber && !admJson._id) {
        throw new Error(admJson.message || "Admission creation failed");
      }

      toast.current?.show({
        severity: "success",
        summary: "Patient Admitted! 🎉",
        detail: `UHID: ${patient.UHID} | Bed: ${bed.bedNumber}`,
        life: 4000,
      });

      setTimeout(() => {
        onSuccess?.();
        onHide();
      }, 1500);
    } catch (err) {
      console.error("[BedAdmissionDrawer] submit:", err);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: err.message || "Something went wrong",
        life: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  /* ── Styles ── */
  const lbl = {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    display: "block",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
  const fld = { marginBottom: 12 };
  const err = { fontSize: 11, color: "#ef4444", marginTop: 3 };
  const inp = { width: "100%" };
  const sectionTitle = (icon, text, color = "#0e7490") => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 0 6px",
        borderBottom: "2px solid " + color + "22",
        marginBottom: 10,
      }}
    >
      <i className={icon} style={{ color, fontSize: 13 }} />
      <span
        style={{
          fontWeight: 700,
          fontSize: 12,
          color,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {text}
      </span>
    </div>
  );

  if (!visible) return null;

  return (
    <>
      <Toast ref={toast} position="top-right" />

      {/* ── Backdrop ── */}
      <div
        onClick={onHide}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(2px)",
          zIndex: 1000,
          animation: "fadeIn 0.2s ease",
        }}
      />

      {/* ── Drawer Panel ── */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(580px, 95vw)",
          background: "#f8fafc",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
          animation: "slideInRight 0.28s cubic-bezier(0.34,1.2,0.64,1)",
          overflow: "hidden",
        }}
      >
        {/* ══ HEADER ══ */}
        <div
          style={{
            background: "linear-gradient(135deg, #0e7490, #0891b2)",
            padding: "14px 18px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <i
                  className="fas fa-bed"
                  style={{ color: "#fff", fontSize: 16 }}
                />
              </div>
              <div>
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>
                  Admit Patient
                </div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11 }}>
                  Spherehealth Medical Solutions
                </div>
              </div>
            </div>
            <button
              onClick={onHide}
              style={{
                background: "rgba(255,255,255,0.18)",
                border: "none",
                borderRadius: 8,
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#fff",
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>

          {/* Bed info strip */}
          {bed && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "rgba(255,255,255,0.15)",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.25)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <i
                className="fas fa-bed"
                style={{ color: "#86efac", fontSize: 15 }}
              />
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                Bed {bed.bedNumber}
              </span>
              <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                |
              </span>
              {[
                bed.buildingName || bed.building?.buildingName,
                bed.floorNumber != null
                  ? `Floor ${bed.floorNumber}`
                  : bed.floor?.floorName,
                bed.wardName || bed.ward?.wardName,
                bed.roomNumber || bed.room?.roomNumber
                  ? `Room ${bed.roomNumber || bed.room?.roomNumber}`
                  : null,
              ]
                .filter(Boolean)
                .map((s, i) => (
                  <span
                    key={i}
                    style={{ color: "rgba(255,255,255,0.82)", fontSize: 11 }}
                  >
                    {i > 0 && (
                      <span style={{ marginRight: 5, opacity: 0.4 }}>›</span>
                    )}
                    {s}
                  </span>
                ))}
              <span
                style={{
                  marginLeft: "auto",
                  background: "#22c55e",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 20,
                  padding: "2px 10px",
                }}
              >
                ✓ Available
              </span>
            </div>
          )}
        </div>

        {/* ══ TABS ══ */}
        <div
          style={{
            display: "flex",
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          {[
            {
              key: "existing",
              icon: "pi pi-search",
              label: "Existing Patient",
            },
            { key: "new", icon: "pi pi-user-plus", label: "New Patient" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                clearExisting();
              }}
              style={{
                flex: 1,
                padding: "11px 0",
                background: "transparent",
                border: "none",
                borderBottom:
                  tab === t.key ? "3px solid #0891b2" : "3px solid transparent",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: tab === t.key ? "#0891b2" : "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.15s",
              }}
            >
              <i className={t.icon} style={{ fontSize: 12 }} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ══ SCROLLABLE BODY ══ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {masterLoading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <ProgressSpinner style={{ width: 36, height: 36 }} />
              <div style={{ color: "#94a3b8", marginTop: 10, fontSize: 13 }}>
                Loading...
              </div>
            </div>
          ) : (
            <>
              {/* ── EXISTING PATIENT SEARCH ── */}
              {tab === "existing" && !existingPatient && (
                <div style={{ marginBottom: 16 }}>
                  {sectionTitle("pi pi-search", "Search Patient", "#7c3aed")}
                  <div style={{ position: "relative" }}>
                    <InputText
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      placeholder="Search by Name, UHID or Phone..."
                      style={{ ...inp, paddingRight: 36 }}
                    />
                    {searching && (
                      <ProgressSpinner
                        style={{
                          width: 18,
                          height: 18,
                          position: "absolute",
                          right: 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                      />
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div
                      style={{
                        marginTop: 6,
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        overflow: "hidden",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                    >
                      {searchResults.map((p) => (
                        <div
                          key={getId(p._id)}
                          onClick={() => selectExistingPatient(p)}
                          style={{
                            padding: "10px 14px",
                            cursor: "pointer",
                            background: "#fff",
                            borderBottom: "1px solid #f1f5f9",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#f0f9ff")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "#fff")
                          }
                        >
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 8,
                              background:
                                "linear-gradient(135deg,#7c3aed,#6d28d9)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: 12,
                              flexShrink: 0,
                            }}
                          >
                            {(p.fullName || "?")[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: "#1e293b",
                              }}
                            >
                              {p.fullName}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {p.UHID} &nbsp;|&nbsp; {p.gender} &nbsp;|&nbsp;{" "}
                              {p.contactNumber}
                              {p.bloodGroup && (
                                <>&nbsp;|&nbsp; 🩸 {p.bloodGroup}</>
                              )}
                            </div>
                          </div>
                          <i
                            className="pi pi-arrow-right"
                            style={{ color: "#0891b2", fontSize: 12 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {searchQuery.length >= 2 &&
                    !searching &&
                    searchResults.length === 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 14,
                          textAlign: "center",
                          background: "#fef9c3",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#92400e",
                        }}
                      >
                        No patient found. Switch to{" "}
                        <strong>"New Patient"</strong> tab to register.
                      </div>
                    )}
                </div>
              )}

              {/* ── EXISTING PATIENT SELECTED BANNER ── */}
              {existingPatient && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "10px 14px",
                    background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
                    borderRadius: 8,
                    border: "1.5px solid #86efac",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "linear-gradient(135deg,#059669,#047857)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {(existingPatient.fullName || "?")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "#065f46",
                      }}
                    >
                      {existingPatient.fullName}
                    </div>
                    <div style={{ fontSize: 11, color: "#047857" }}>
                      UHID:{" "}
                      <strong
                        style={{ fontFamily: "monospace", letterSpacing: 1 }}
                      >
                        {existingPatient.UHID}
                      </strong>
                      &nbsp;|&nbsp; {existingPatient.gender}
                      {existingPatient.age && (
                        <>&nbsp;|&nbsp; Age: {existingPatient.age}</>
                      )}
                      {existingPatient.bloodGroup && (
                        <>&nbsp;|&nbsp; 🩸 {existingPatient.bloodGroup}</>
                      )}
                    </div>
                    <div
                      style={{ fontSize: 10, color: "#059669", marginTop: 2 }}
                    >
                      ✓ Existing patient — same UHID will be used. No new UHID
                      generated.
                    </div>
                  </div>
                  <button
                    onClick={clearExisting}
                    style={{
                      background: "none",
                      border: "1px solid #86efac",
                      borderRadius: 6,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "#065f46",
                    }}
                  >
                    ✕ Clear
                  </button>
                </div>
              )}

              {/* ── PATIENT FIELDS (new patient only) ── */}
              {(tab === "new" || existingPatient) && (
                <>
                  {tab === "new" && (
                    <>
                      {sectionTitle("pi pi-user", "Patient Details", "#0891b2")}

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px 1fr 1fr",
                          gap: 10,
                          ...fld,
                        }}
                      >
                        {/* Title */}
                        <div>
                          <label style={lbl}>Title *</label>
                          <Dropdown
                            value={formData.title}
                            options={[
                              "Mr.",
                              "Mrs.",
                              "Miss",
                              "Master",
                              "Dr.",
                              "Prof.",
                            ].map((t) => ({ label: t, value: t }))}
                            onChange={(e) => hc("title", e.value)}
                            placeholder="Title"
                            style={inp}
                          />
                        </div>
                        {/* Full Name */}
                        <div style={{ gridColumn: "span 2" }}>
                          <label style={lbl}>Full Name *</label>
                          <InputText
                            value={formData.fullName}
                            onChange={(e) => hc("fullName", e.target.value)}
                            style={inp}
                            placeholder="Patient full name"
                          />
                          {errors.fullName && (
                            <div style={err}>{errors.fullName}</div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 80px",
                          gap: 10,
                          ...fld,
                        }}
                      >
                        <div>
                          <label style={lbl}>Gender *</label>
                          <Dropdown
                            value={formData.gender}
                            options={["Male", "Female", "Other"].map((g) => ({
                              label: g,
                              value: g,
                            }))}
                            onChange={(e) => hc("gender", e.value)}
                            placeholder="Gender"
                            style={inp}
                          />
                          {errors.gender && (
                            <div style={err}>{errors.gender}</div>
                          )}
                        </div>
                        <div>
                          <label style={lbl}>Date of Birth</label>
                          <Calendar
                            value={formData.dateOfBirth}
                            onChange={(e) => hc("dateOfBirth", e.value)}
                            showIcon
                            dateFormat="dd/mm/yy"
                            style={inp}
                            maxDate={new Date()}
                          />
                        </div>
                        <div>
                          <label style={lbl}>Age</label>
                          <InputText
                            value={formData.age}
                            onChange={(e) => hc("age", e.target.value)}
                            style={inp}
                            placeholder="Age"
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                          ...fld,
                        }}
                      >
                        <div>
                          <label style={lbl}>Contact * </label>
                          <InputText
                            value={formData.contactNumber}
                            onChange={(e) =>
                              hc("contactNumber", e.target.value)
                            }
                            style={inp}
                            placeholder="Mobile number"
                            maxLength={10}
                          />
                          {errors.contactNumber && (
                            <div style={err}>{errors.contactNumber}</div>
                          )}
                        </div>
                        <div>
                          <label style={lbl}>Blood Group</label>
                          <Dropdown
                            value={formData.bloodGroup}
                            options={[
                              "A+",
                              "A-",
                              "B+",
                              "B-",
                              "AB+",
                              "AB-",
                              "O+",
                              "O-",
                              "Not Known",
                            ].map((b) => ({ label: b, value: b }))}
                            onChange={(e) => hc("bloodGroup", e.value)}
                            placeholder="Select"
                            showClear
                            style={inp}
                          />
                        </div>
                      </div>

                      <div style={fld}>
                        <label style={lbl}>Known Allergies</label>
                        <InputText
                          value={formData.knownAllergies}
                          onChange={(e) => hc("knownAllergies", e.target.value)}
                          style={inp}
                          placeholder="None / list allergies"
                        />
                      </div>

                      {/* MLC */}
                      <div
                        style={{
                          ...fld,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Checkbox
                          inputId="isMLC"
                          checked={formData.isMLC}
                          onChange={(e) => hc("isMLC", e.checked)}
                        />
                        <label
                          htmlFor="isMLC"
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#dc2626",
                            cursor: "pointer",
                          }}
                        >
                          MLC Case (Medico Legal)
                        </label>
                      </div>
                      {formData.isMLC && (
                        <div style={fld}>
                          <label style={lbl}>MLC Number</label>
                          <InputText
                            value={formData.mlcNumber}
                            onChange={(e) => hc("mlcNumber", e.target.value)}
                            style={inp}
                            placeholder="MLC/Police case number"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {/* ── DEPARTMENT + DOCTOR (always shown) ── */}
                  {sectionTitle(
                    "pi pi-building",
                    "Department & Doctor",
                    "#059669",
                  )}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      ...fld,
                    }}
                  >
                    <div>
                      <label style={lbl}>Department *</label>
                      <Dropdown
                        value={formData.department}
                        options={departments}
                        onChange={(e) => {
                          hc("department", e.value);
                          hc("doctor", "");
                        }}
                        placeholder="Select Department"
                        filter
                        style={inp}
                      />
                      {errors.department && (
                        <div style={err}>{errors.department}</div>
                      )}
                    </div>
                    <div>
                      <label style={lbl}>Doctor *</label>
                      <Dropdown
                        value={formData.doctor}
                        options={doctors}
                        onChange={(e) => hc("doctor", e.value)}
                        placeholder={
                          formData.department
                            ? "Select Doctor"
                            : "Select dept first"
                        }
                        disabled={!formData.department}
                        filter
                        style={inp}
                      />
                      {errors.doctor && <div style={err}>{errors.doctor}</div>}
                    </div>
                  </div>

                  {/* ── PAYMENT ── */}
                  {sectionTitle("pi pi-credit-card", "Payment", "#d97706")}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      ...fld,
                    }}
                  >
                    <div>
                      <label style={lbl}>Payment Type</label>
                      <Dropdown
                        value={formData.paymentType}
                        options={["GENERAL", "TPA", "CORPORATE"].map((p) => ({
                          label: p,
                          value: p,
                        }))}
                        onChange={(e) => hc("paymentType", e.value)}
                        style={inp}
                      />
                    </div>
                    {formData.paymentType === "TPA" && (
                      <div>
                        <label style={lbl}>TPA</label>
                        <Dropdown
                          value={formData.tpa}
                          options={tpaList}
                          onChange={(e) => hc("tpa", e.value)}
                          placeholder="Select TPA"
                          filter
                          showClear
                          style={inp}
                        />
                      </div>
                    )}
                  </div>
                  {formData.paymentType === "TPA" && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 10,
                        ...fld,
                      }}
                    >
                      <div>
                        <label style={lbl}>Policy Number</label>
                        <InputText
                          value={formData.policyNumber}
                          onChange={(e) => hc("policyNumber", e.target.value)}
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lbl}>Policy Holder</label>
                        <InputText
                          value={formData.policyHolderName}
                          onChange={(e) =>
                            hc("policyHolderName", e.target.value)
                          }
                          style={inp}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── ADMISSION DETAILS (always) ── */}
              {(tab === "new" || existingPatient) && (
                <>
                  {sectionTitle(
                    "fas fa-hospital-user",
                    "Admission Details",
                    "#dc2626",
                  )}

                  <div style={fld}>
                    <label style={lbl}>
                      Diagnosis / Reason for Admission *
                    </label>
                    <InputTextarea
                      value={admData.reasonForAdmission}
                      onChange={(e) => ha("reasonForAdmission", e.target.value)}
                      rows={2}
                      style={inp}
                      placeholder="Primary diagnosis / reason for admission"
                      autoResize
                    />
                    {errors.reasonForAdmission && (
                      <div style={err}>{errors.reasonForAdmission}</div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      ...fld,
                    }}
                  >
                    <div>
                      <label style={lbl}>Admission Type</label>
                      <Dropdown
                        value={admData.admissionType}
                        options={ADM_TYPES}
                        onChange={(e) => ha("admissionType", e.value)}
                        style={inp}
                      />
                    </div>
                    <div>
                      <label style={lbl}>Expected Discharge</label>
                      <Calendar
                        value={admData.expectedDischargeDate}
                        onChange={(e) => ha("expectedDischargeDate", e.value)}
                        showIcon
                        dateFormat="dd/mm/yy"
                        style={inp}
                        minDate={new Date()}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div style={fld}>
                    <label style={lbl}>Special Instructions</label>
                    <InputTextarea
                      value={admData.specialInstructions}
                      onChange={(e) =>
                        ha("specialInstructions", e.target.value)
                      }
                      rows={2}
                      style={inp}
                      placeholder="Diet, care instructions, allergies to watch..."
                      autoResize
                    />
                  </div>
                </>
              )}

              {/* ── PLACEHOLDER when tab=existing and no patient yet ── */}
              {tab === "existing" &&
                !existingPatient &&
                searchQuery.length < 2 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "30px 20px",
                      color: "#94a3b8",
                    }}
                  >
                    <i
                      className="pi pi-search"
                      style={{
                        fontSize: 32,
                        display: "block",
                        marginBottom: 10,
                        opacity: 0.4,
                      }}
                    />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Search for an existing patient
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      Type name, UHID, or phone number (min. 2 chars)
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        {/* ══ FOOTER ══ */}
        {(tab === "new" || existingPatient) && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid #e2e8f0",
              background: "#fff",
              display: "flex",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <Button
              label="Cancel"
              icon="pi pi-times"
              severity="secondary"
              outlined
              onClick={onHide}
              style={{ flex: 1 }}
              disabled={loading}
            />
            <Button
              label={
                loading
                  ? "Admitting..."
                  : existingPatient
                    ? `Admit Existing (${existingPatient.UHID})`
                    : "Register & Admit"
              }
              icon={loading ? "pi pi-spin pi-spinner" : "fas fa-hospital-user"}
              onClick={handleSubmit}
              style={{
                flex: 2,
                background: "linear-gradient(135deg,#0e7490,#0891b2)",
                border: "none",
                fontWeight: 700,
              }}
              disabled={loading}
            />
          </div>
        )}
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity:0 }
          to   { transform: translateX(0);   opacity:1 }
        }
      `}</style>
    </>
  );
}
