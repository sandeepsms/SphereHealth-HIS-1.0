import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Field, FieldArray, Formik, Form, getIn } from "formik";
import * as yup from "yup";
import { toast } from "react-toastify";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { RadioButton } from "primereact/radiobutton";
import logo from "../../assets/BIMSLOGO.png";
import patientService from "../../Services/patient/patientService";
import { doctorService } from "../../Services/doctors/doctorService";
import { prescriptionService } from "../../Services/doctors/prescriptionService";
import { serviceMasterService } from "../../Services/Servicemasterservice/serviceMasterService";
import { admissionService } from "../../Services/admissionService";
import BedSelectionPanel from "../bed/BedSelectionPanel";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

// ── Dropdown options ─────────────────────────────────────────
const SCHEDULE_OPTS = [
  "1-0-0(Morning)",
  "1-0-0(Afternoon)",
  "1-0-0(Night)",
  "1-1-1",
  "OD",
  "BD",
  "TDS",
  "QID",
  "SOS",
  "STAT",
].map((v) => ({ label: v, value: v }));
const INSTRUCTION_OPTS = [
  "Before Food",
  "After Food",
  "With Food",
  "Empty Stomach",
  "At Bedtime",
  "Do Not Crush/Chew",
].map((v) => ({ label: v, value: v }));
const ROUTE_OPTS = [
  "Oral",
  "IV",
  "IM",
  "SC",
  "Topical",
  "Inhalation",
  "Sublingual",
  "Nasal",
].map((v) => ({ label: v, value: v }));
const DAYS_OPTS = [
  "1 Day",
  "3 Days",
  "5 Days",
  "7 Days",
  "10 Days",
  "14 Days",
  "30 Days",
  "Once Weekly",
  "Continue",
].map((v) => ({ label: v, value: v }));
const ADM_TYPES = ["Emergency", "Planned", "Transfer", "Day Care"].map((v) => ({
  label: v,
  value: v,
}));

const BLANK_MED = {
  medicineName: "",
  schedule: "",
  instruction: "",
  route: "",
  days: "",
};

const validationSchema = yup.object({
  provisionalDiagnosis: yup.string().required("Diagnosis required"),
  medicines: yup
    .array()
    .of(yup.object({ medicineName: yup.string().required("Required") })),
});

const FieldInput = ({ field, form, placeholder }) => {
  const err = getIn(form.errors, field.name);
  return (
    <div>
      <input
        {...field}
        placeholder={placeholder}
        className="form-control"
        style={{ height: 34, fontSize: 13 }}
      />
      {err && (
        <small className="text-danger" style={{ fontSize: 11 }}>
          {err}
        </small>
      )}
    </div>
  );
};

const SectionHeader = ({ icon, title, color = "#0891b2" }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 8,
      paddingBottom: 6,
      borderBottom: "1px solid #e5e7eb",
    }}
  >
    <i className={`pi pi-${icon}`} style={{ fontSize: 13, color }} />
    <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
      {title}
    </span>
  </div>
);

const card = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "12px 16px",
  marginBottom: 8,
};

// ══════════════════════════════════════════════════════════════
export default function DoctorPrescription() {
  const { UHID } = useParams();
  const navigate = useNavigate();

  const [patientData, setPatientData] = useState(null);
  const [doctorData, setDoctorData] = useState(null);
  const [invOpts, setInvOpts] = useState([]);
  const [serviceOpts, setServiceOpts] = useState([]);
  const [editData, setEditData] = useState(null);
  const [buttonMode, setButtonMode] = useState("CREATE");
  const [loading, setLoading] = useState(false);

  // Admit flow
  const [admitAnswer, setAdmitAnswer] = useState(null); // null | "YES" | "NO"
  const [bedData, setBedData] = useState({
    buildingId: null,
    floorId: null,
    wardId: null,
    roomId: null,
    bedId: null,
    bedNumber: null,
  });
  const [admData, setAdmData] = useState({
    reasonForAdmission: "",
    admissionType: "Planned",
    expectedDischargeDate: "",
  });

  // ── Load all data ──────────────────────────────────────────
  useEffect(() => {
    if (UHID) loadAll();
  }, [UHID]);

  const loadAll = async () => {
    setLoading(true);
    try {
      // Patient
      const pRes = await patientService.getPatientByUHID(UHID);
      const p = pRes.data;
      setPatientData(p);

      // Doctor
      if (p?.doctor?._id) {
        const dRes = await doctorService.getDoctorById(p.doctor._id);
        setDoctorData(dRes.data || dRes);
      }

      // InvestigationMaster
      const iRes = await fetch(`${API}/investigations?limit=300&isActive=true`);
      const iData = await iRes.json();
      setInvOpts(
        (iData.data || []).map((i) => ({
          label: `${i.investigationCode} — ${i.investigationName}`,
          value: i._id,
          code: i.investigationCode,
          name: i.investigationName,
          category: i.category,
          performedAt: i.performedAt,
        })),
      );

      // ServiceMaster — use serviceMasterService (returns { services, total })
      const sResult = await serviceMasterService.getAllServices({
        limit: 300,
        isActive: true,
      });
      setServiceOpts(
        (sResult.services || []).map((s) => ({
          label: `${s.serviceCode} — ${s.serviceName}`,
          value: s._id,
          code: s.serviceCode,
          name: s.serviceName,
          category: s.category,
          domain: s.domain,
        })),
      );

      // Check CREATE or UPDATE
      const cRes = await prescriptionService.checkCreateOrUpdate(UHID);
      const mode = cRes.data?.mode || cRes.data?.data?.mode || "CREATE";
      setButtonMode(mode);

      if (mode === "UPDATE") {
        const eRes = await prescriptionService.getPrescriptionsByUHID(UHID);
        const ep = Array.isArray(eRes.data) ? eRes.data[0] : eRes.data;
        setEditData(ep || null);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  // ── Initial values ────────────────────────────────────────
  const initialValues = {
    patient: patientData?._id || "",
    UHID: patientData?.UHID || UHID || "",
    patientName: patientData?.fullName || "",
    age: patientData?.age || "",
    gender: patientData?.gender || "",
    contactNumber: patientData?.contactNumber || "",
    fatherName: patientData?.companionName || "",
    department: patientData?.department?.departmentName || "",
    registrationType: patientData?.registrationType || "OPD",
    doctor: patientData?.doctor?._id || "",
    referredBy: patientData?.referredBy || "Self",
    historyOfAllergy: patientData?.knownAllergies || "",
    historyOfPresentIllness:
      editData?.clinicalDetails?.historyOfPresentIllness || "",
    physicalExamination: editData?.clinicalDetails?.physicalExamination || "",
    // HOPI — structured
    hopiOnset:              editData?.clinicalDetails?.hopiOnset || "",
    hopiDurationValue:      editData?.clinicalDetails?.hopiDurationValue || "",
    hopiDurationUnit:       editData?.clinicalDetails?.hopiDurationUnit || "Days",
    hopiProgression:        editData?.clinicalDetails?.hopiProgression || "",
    hopiCharacter:          editData?.clinicalDetails?.hopiCharacter || "",
    hopiAssociatedSymptoms: editData?.clinicalDetails?.hopiAssociatedSymptoms || [],
    hopiAggravating:        editData?.clinicalDetails?.hopiAggravating || "",
    hopiRelieving:          editData?.clinicalDetails?.hopiRelieving || "",
    // Chronic illnesses
    chronicConditions:      editData?.clinicalDetails?.chronicConditions || [],
    chronicOthers:          editData?.clinicalDetails?.chronicOthers || "",
    weight: editData?.vitals?.weight || "",
    temperature: editData?.vitals?.temperature || "",
    bloodPressure: editData?.vitals?.bloodPressure || "",
    pulse: editData?.vitals?.pulse || "",
    spo2: editData?.vitals?.spo2 || "",
    provisionalDiagnosis: editData?.provisionalDiagnosis || "",
    medicines:
      editData?.medicines?.length > 0 ? editData.medicines : [{ ...BLANK_MED }],
    investigations: editData?.investigations || [],
    selectedServices: editData?.selectedServices || [],
    advice: editData?.advice || "",
  };

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = async (values, { setSubmitting }) => {
    if (!values.UHID) {
      toast.error("UHID missing");
      setSubmitting(false);
      return;
    }
    if (!values.patient) {
      toast.error("Patient ID missing");
      setSubmitting(false);
      return;
    }
    if (admitAnswer === "YES" && !bedData.bedId) {
      toast.error("Please select a bed");
      setSubmitting(false);
      return;
    }

    setLoading(true);
    try {
      const doctorName = doctorData
        ? `Dr. ${doctorData.personalInfo?.firstName || ""} ${doctorData.personalInfo?.lastName || ""}`.trim()
        : "";

      const payload = {
        patient: values.patient,
        patientName: values.patientName,
        age: values.age,
        gender: values.gender,
        contactNumber: values.contactNumber,
        fatherName: values.fatherName,
        department: values.department,
        doctor: values.doctor,
        doctorName,
        referredBy: values.referredBy,
        registrationType: values.registrationType,
        clinicalDetails: {
          historyOfAllergy: values.historyOfAllergy,
          historyOfPresentIllness: values.historyOfPresentIllness,
          physicalExamination: values.physicalExamination,
          hopiOnset:              values.hopiOnset,
          hopiDurationValue:      values.hopiDurationValue,
          hopiDurationUnit:       values.hopiDurationUnit,
          hopiProgression:        values.hopiProgression,
          hopiCharacter:          values.hopiCharacter,
          hopiAssociatedSymptoms: values.hopiAssociatedSymptoms,
          hopiAggravating:        values.hopiAggravating,
          hopiRelieving:          values.hopiRelieving,
          chronicConditions:      values.chronicConditions,
          chronicOthers:          values.chronicOthers,
        },
        vitals: {
          weight: values.weight,
          temperature: values.temperature,
          bloodPressure: values.bloodPressure,
          pulse: values.pulse,
          spo2: values.spo2,
        },
        provisionalDiagnosis: values.provisionalDiagnosis,
        medicines: values.medicines.filter((m) => m.medicineName),
        investigations: values.investigations,
        selectedServices: values.selectedServices,
        advice: values.advice,
      };

      const res = await prescriptionService.createPrescription(
        values.UHID,
        payload,
      );
      if (!res.success) throw new Error(res.message || "Failed");

      // Admit if YES
      if (admitAnswer === "YES" && bedData.bedId && patientData) {
        try {
          await admissionService.createAdmission({
            patientId: patientData._id,
            UHID: patientData.UHID,
            patientName: patientData.fullName,
            contactNumber: patientData.contactNumber,
            bedId: bedData.bedId,
            department:
              patientData.department?._id || patientData.department || "",
            admissionDate: new Date().toISOString(),
            reasonForAdmission: values.provisionalDiagnosis,
            admissionType: admData.admissionType,
            expectedDischargeDate: admData.expectedDischargeDate || undefined,
            attendingDoctor: doctorName,
            hasBed: true,
          });
          toast.success("Patient admitted & bed booked");
        } catch (admErr) {
          toast.warn(
            "Prescription saved but admission failed: " + admErr.message,
          );
        }
      }

      toast.success(res.message || "Prescription saved");
      setTimeout(() => navigate(`/preceptionprint/${values.UHID}`), 600);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || "Failed");
    } finally {
      setLoading(false);
      setSubmitting(false);
    }
  };

  if (loading && !patientData) {
    return (
      <div className="text-center p-5">
        <i className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  return (
    <Formik
      enableReinitialize
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {({ values, handleChange, setFieldValue, errors }) => (
        <Form>
          <div
            style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 10px" }}
          >
            {/* ── HEADER ── */}
            <div
              style={{
                ...card,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "10px 16px",
              }}
            >
              <img src={logo} alt="Logo" style={{ width: 52 }} />
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontWeight: 900, fontSize: 16, color: "#0891b2" }}
                >
                  BIMS
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Bright Institute of Medical Sciences
                </div>
              </div>
              <div
                style={{ textAlign: "right", fontSize: 11, color: "#64748b" }}
              >
                <div>📞 +91-7988307850</div>
                <div>📍 Gau Shala Road, Jatawara, Sonipat</div>
              </div>
            </div>

            {/* ── PATIENT INFO + VITALS ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <div style={card}>
                <SectionHeader icon="user" title="Patient Information" />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "6px 10px",
                    fontSize: 12,
                    marginBottom: 8,
                  }}
                >
                  {[
                    ["Name", values.patientName],
                    ["UHID", values.UHID],
                    [
                      "Age / Gender",
                      `${values.age || "—"} / ${values.gender || "—"}`,
                    ],
                    ["Contact", values.contactNumber],
                    ["Department", values.department],
                    ["Reg. Type", values.registrationType],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div
                        style={{
                          color: "#94a3b8",
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {k}
                      </div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {v || "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 10px",
                  }}
                >
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600 }}>
                      History of Allergy
                    </label>
                    <InputTextarea
                      name="historyOfAllergy"
                      value={values.historyOfAllergy}
                      onChange={handleChange}
                      rows={2}
                      style={{ width: "100%", fontSize: 12 }}
                      placeholder="Known allergies..."
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600 }}>
                      Present Illness
                    </label>
                    <InputTextarea
                      name="historyOfPresentIllness"
                      value={values.historyOfPresentIllness}
                      onChange={handleChange}
                      rows={2}
                      style={{ width: "100%", fontSize: 12 }}
                      placeholder="Chief complaints..."
                    />
                  </div>
                </div>
              </div>

              <div style={card}>
                <SectionHeader icon="heart" title="Vitals" />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "8px 12px",
                  }}
                >
                  {[
                    ["Weight (kg)", "weight", "Kgs"],
                    ["Temp (°F)", "temperature", "°F"],
                    ["B.P.", "bloodPressure", "mmHg"],
                    ["Pulse", "pulse", "bpm"],
                    ["SpO2 (%)", "spo2", "%"],
                    ["Referred By", "referredBy", "Self"],
                  ].map(([label, name, ph]) => (
                    <div key={name}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 2,
                        }}
                      >
                        {label}
                      </label>
                      <InputText
                        name={name}
                        value={values[name] || ""}
                        onChange={handleChange}
                        placeholder={ph}
                        style={{ width: "100%", height: 32, fontSize: 12 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── HOPI — structured History of Present Illness ── */}
            <div style={{ ...card, borderLeft: "3px solid #7c3aed" }}>
              <SectionHeader icon="calendar" title="History of Present Illness (HOPI)" color="#7c3aed" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px 12px", marginBottom: 12 }}>
                {/* Onset */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Onset</label>
                  {["Sudden", "Gradual", "Intermittent"].map(opt => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 3, cursor: "pointer" }}>
                      <input type="radio" name="hopiOnset" value={opt}
                        checked={values.hopiOnset === opt}
                        onChange={() => setFieldValue("hopiOnset", opt)}
                        style={{ accentColor: "#7c3aed" }} />
                      {opt}
                    </label>
                  ))}
                </div>
                {/* Duration */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Duration</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <InputText name="hopiDurationValue" value={values.hopiDurationValue} onChange={handleChange}
                      placeholder="e.g. 3" style={{ width: "45%", height: 32, fontSize: 12 }} />
                    <Dropdown value={values.hopiDurationUnit}
                      onChange={e => setFieldValue("hopiDurationUnit", e.value)}
                      options={["Hours","Days","Weeks","Months"].map(v => ({ label: v, value: v }))}
                      style={{ width: "55%", fontSize: 12 }} />
                  </div>
                </div>
                {/* Progression */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Progression</label>
                  <Dropdown value={values.hopiProgression}
                    onChange={e => setFieldValue("hopiProgression", e.value)}
                    options={["Improving","Stable","Worsening","Fluctuating"].map(v => ({ label: v, value: v }))}
                    placeholder="Select…"
                    style={{ width: "100%", fontSize: 12 }} />
                </div>
                {/* Character */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Character of Complaint</label>
                  <InputText name="hopiCharacter" value={values.hopiCharacter} onChange={handleChange}
                    placeholder="Sharp / Dull / Burning…"
                    style={{ width: "100%", height: 32, fontSize: 12 }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px 12px" }}>
                {/* Associated symptoms */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Associated Symptoms</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                    {["Fever","Vomiting","Nausea","Diarrhea","Cough","Headache","Dizziness","Dyspnea","Chest Pain","Abdominal Pain","Weakness","Loss of Appetite"].map(sym => (
                      <label key={sym} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
                        <input type="checkbox"
                          checked={values.hopiAssociatedSymptoms.includes(sym)}
                          onChange={e => {
                            const arr = e.target.checked
                              ? [...values.hopiAssociatedSymptoms, sym]
                              : values.hopiAssociatedSymptoms.filter(s => s !== sym);
                            setFieldValue("hopiAssociatedSymptoms", arr);
                          }}
                          style={{ accentColor: "#7c3aed" }} />
                        {sym}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Aggravating Factors</label>
                  <InputTextarea name="hopiAggravating" value={values.hopiAggravating} onChange={handleChange}
                    rows={3} style={{ width: "100%", fontSize: 12 }} placeholder="What makes it worse…" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>Relieving Factors</label>
                  <InputTextarea name="hopiRelieving" value={values.hopiRelieving} onChange={handleChange}
                    rows={3} style={{ width: "100%", fontSize: 12 }} placeholder="What makes it better…" />
                </div>
              </div>
            </div>

            {/* ── CHRONIC ILLNESSES ── */}
            <div style={{ ...card, borderLeft: "3px solid #dc2626" }}>
              <SectionHeader icon="heart" title="Chronic Illnesses / Past Medical History" color="#dc2626" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginBottom: 10 }}>
                {["DM (Diabetes)","HTN (Hypertension)","CAD / IHD","CKD","COPD","Asthma","Epilepsy","Hypothyroidism","Hyperthyroidism","TB","Stroke","Cancer"].map(cond => {
                  const entry = values.chronicConditions.find(c => c.condition === cond);
                  return (
                    <label key={cond} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox"
                        checked={!!entry}
                        onChange={e => {
                          const arr = e.target.checked
                            ? [...values.chronicConditions, { condition: cond, duration: "" }]
                            : values.chronicConditions.filter(c => c.condition !== cond);
                          setFieldValue("chronicConditions", arr);
                        }}
                        style={{ accentColor: "#dc2626" }} />
                      <span style={{ fontWeight: entry ? 700 : 400, color: entry ? "#dc2626" : "#374151" }}>{cond}</span>
                      {entry && (
                        <InputText
                          value={entry.duration}
                          onChange={e => {
                            const arr = values.chronicConditions.map(c =>
                              c.condition === cond ? { ...c, duration: e.target.value } : c
                            );
                            setFieldValue("chronicConditions", arr);
                          }}
                          placeholder="Since…"
                          style={{ width: 72, height: 24, fontSize: 11, marginLeft: 2 }}
                          onClick={ev => ev.stopPropagation()}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600 }}>Other conditions / Surgical History</label>
                <InputText name="chronicOthers" value={values.chronicOthers} onChange={handleChange}
                  placeholder="Other conditions, previous surgeries…"
                  style={{ width: "100%", height: 32, marginTop: 4, fontSize: 12 }} />
              </div>
            </div>

            {/* ── DIAGNOSIS ── */}
            <div style={card}>
              <SectionHeader icon="file-edit" title="Plan of Care" />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Provisional Diagnosis *
              </label>
              <InputText
                name="provisionalDiagnosis"
                value={values.provisionalDiagnosis}
                onChange={handleChange}
                placeholder="Enter diagnosis"
                style={{ width: "100%", height: 36, marginTop: 4 }}
                className={errors.provisionalDiagnosis ? "p-invalid" : ""}
              />
              {errors.provisionalDiagnosis && (
                <small className="text-danger" style={{ fontSize: 11 }}>
                  {errors.provisionalDiagnosis}
                </small>
              )}
            </div>

            {/* ── MEDICINES ── */}
            <div style={card}>
              <FieldArray name="medicines">
                {({ remove, push }) => (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <SectionHeader icon="list" title="Medicines Advised" />
                      <Button
                        type="button"
                        severity="success"
                        size="small"
                        icon="pi pi-plus"
                        label="Add Medicine"
                        onClick={() => push({ ...BLANK_MED })}
                        style={{ height: 30, fontSize: 12 }}
                      />
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table
                        className="table table-bordered"
                        style={{ minWidth: 800, fontSize: 12, marginBottom: 0 }}
                      >
                        <thead
                          className="table-primary"
                          style={{ fontSize: 11 }}
                        >
                          <tr>
                            <th style={{ minWidth: 180 }}>Medicine Name</th>
                            <th style={{ minWidth: 120 }}>Schedule</th>
                            <th style={{ minWidth: 130 }}>Instruction</th>
                            <th style={{ minWidth: 110 }}>Route</th>
                            <th style={{ minWidth: 110 }}>Days</th>
                            <th style={{ width: 40 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {values.medicines.map((_, idx) => (
                            <tr key={idx} style={{ verticalAlign: "middle" }}>
                              <td>
                                <Field
                                  name={`medicines[${idx}].medicineName`}
                                  component={FieldInput}
                                  placeholder="Medicine name"
                                />
                              </td>
                              <td>
                                <Dropdown
                                  value={values.medicines[idx].schedule}
                                  options={SCHEDULE_OPTS}
                                  onChange={(e) =>
                                    setFieldValue(
                                      `medicines[${idx}].schedule`,
                                      e.value,
                                    )
                                  }
                                  placeholder="Schedule"
                                  style={{ width: "100%", fontSize: 12 }}
                                />
                              </td>
                              <td>
                                <Dropdown
                                  value={values.medicines[idx].instruction}
                                  options={INSTRUCTION_OPTS}
                                  onChange={(e) =>
                                    setFieldValue(
                                      `medicines[${idx}].instruction`,
                                      e.value,
                                    )
                                  }
                                  placeholder="Instruction"
                                  style={{ width: "100%", fontSize: 12 }}
                                />
                              </td>
                              <td>
                                <Dropdown
                                  value={values.medicines[idx].route}
                                  options={ROUTE_OPTS}
                                  onChange={(e) =>
                                    setFieldValue(
                                      `medicines[${idx}].route`,
                                      e.value,
                                    )
                                  }
                                  placeholder="Route"
                                  style={{ width: "100%", fontSize: 12 }}
                                />
                              </td>
                              <td>
                                <Dropdown
                                  value={values.medicines[idx].days}
                                  options={DAYS_OPTS}
                                  onChange={(e) =>
                                    setFieldValue(
                                      `medicines[${idx}].days`,
                                      e.value,
                                    )
                                  }
                                  placeholder="Days"
                                  style={{ width: "100%", fontSize: 12 }}
                                />
                              </td>
                              <td className="text-center">
                                <Button
                                  type="button"
                                  icon="pi pi-trash"
                                  severity="danger"
                                  text
                                  onClick={() => remove(idx)}
                                  style={{ height: 28 }}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </FieldArray>
            </div>

            {/* ── INVESTIGATIONS + SERVICES (side by side) ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginBottom: 8,
              }}
            >
              {/* Investigations */}
              <div style={card}>
                <SectionHeader icon="search" title="Investigations Advised" />
                <MultiSelect
                  value={values.investigations
                    .map((i) => i.investigationId)
                    .filter(Boolean)}
                  options={invOpts}
                  onChange={(e) => {
                    const sel = e.value.map((id) => {
                      const opt = invOpts.find((o) => o.value === id);
                      return {
                        investigationId: id,
                        investigationName: opt?.name || "",
                        investigationCode: opt?.code || "",
                        chargedPrice: 0,
                        tariffType: "CASH",
                      };
                    });
                    setFieldValue("investigations", sel);
                  }}
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Search tests..."
                  filter
                  display="chip"
                  style={{ width: "100%" }}
                  itemTemplate={(opt) => (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        width: "100%",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>{opt.label}</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 4,
                          padding: "1px 6px",
                          background:
                            opt.performedAt === "EXTERNAL"
                              ? "#fef3c7"
                              : "#e0f2fe",
                          color:
                            opt.performedAt === "EXTERNAL"
                              ? "#92400e"
                              : "#0369a1",
                        }}
                      >
                        {opt.performedAt}
                      </span>
                    </div>
                  )}
                />
                {values.investigations.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#0369a1" }}>
                    {values.investigations.map((i) => (
                      <span
                        key={i.investigationId}
                        style={{
                          display: "inline-block",
                          background: "#e0f2fe",
                          color: "#0369a1",
                          borderRadius: 4,
                          padding: "2px 8px",
                          marginRight: 4,
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {i.investigationCode} {i.investigationName}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Services */}
              <div style={card}>
                <SectionHeader icon="th-large" title="Services Advised" />
                <MultiSelect
                  value={values.selectedServices
                    .map((s) => s.serviceId)
                    .filter(Boolean)}
                  options={serviceOpts}
                  onChange={(e) => {
                    const sel = e.value.map((id) => {
                      const opt = serviceOpts.find((o) => o.value === id);
                      return {
                        serviceId: id,
                        serviceName: opt?.name || "",
                        serviceCode: opt?.code || "",
                      };
                    });
                    setFieldValue("selectedServices", sel);
                  }}
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Search services..."
                  filter
                  display="chip"
                  style={{ width: "100%" }}
                  itemTemplate={(opt) => (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        width: "100%",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>{opt.label}</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 4,
                          padding: "1px 6px",
                          background: "#f3e8ff",
                          color: "#7c3aed",
                        }}
                      >
                        {opt.domain}
                      </span>
                    </div>
                  )}
                />
                {values.selectedServices.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11 }}>
                    {values.selectedServices.map((s) => (
                      <span
                        key={s.serviceId}
                        style={{
                          display: "inline-block",
                          background: "#f3e8ff",
                          color: "#7c3aed",
                          borderRadius: 4,
                          padding: "2px 8px",
                          marginRight: 4,
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {s.serviceCode} {s.serviceName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── ADVICE ── */}
            <div style={card}>
              <SectionHeader icon="comment" title="Advice & Follow-up" />
              <InputTextarea
                name="advice"
                value={values.advice}
                onChange={handleChange}
                placeholder="Advice, follow-up instructions..."
                rows={2}
                style={{ width: "100%", fontSize: 12 }}
              />
            </div>

            {/* ── ADMIT SECTION ── */}
            <div style={{ ...card, border: "1.5px solid #e9d5ff" }}>
              <SectionHeader icon="home" title="Admission" color="#7c3aed" />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: admitAnswer === "YES" ? 14 : 0,
                }}
              >
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}
                >
                  Does this patient need to be admitted?
                </span>
                {["YES", "NO"].map((opt) => (
                  <div
                    key={opt}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <RadioButton
                      inputId={`admit_${opt}`}
                      value={opt}
                      onChange={(e) => {
                        setAdmitAnswer(e.value);
                        if (e.value === "NO")
                          setBedData({
                            buildingId: null,
                            floorId: null,
                            wardId: null,
                            roomId: null,
                            bedId: null,
                            bedNumber: null,
                          });
                      }}
                      checked={admitAnswer === opt}
                    />
                    <label
                      htmlFor={`admit_${opt}`}
                      style={{
                        fontSize: 13,
                        cursor: "pointer",
                        fontWeight: admitAnswer === opt ? 700 : 500,
                        color:
                          opt === "YES"
                            ? admitAnswer === "YES"
                              ? "#7c3aed"
                              : "#374151"
                            : admitAnswer === "NO"
                              ? "#dc2626"
                              : "#374151",
                      }}
                    >
                      {opt}
                    </label>
                  </div>
                ))}
              </div>

              {admitAnswer === "YES" && (
                <div style={{ borderTop: "1px solid #e9d5ff", paddingTop: 12 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "8px 12px",
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 3,
                        }}
                      >
                        Admission Type
                      </label>
                      <Dropdown
                        value={admData.admissionType}
                        options={ADM_TYPES}
                        onChange={(e) =>
                          setAdmData((p) => ({ ...p, admissionType: e.value }))
                        }
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 3,
                        }}
                      >
                        Expected Discharge
                      </label>
                      <InputText
                        type="date"
                        value={admData.expectedDischargeDate}
                        onChange={(e) =>
                          setAdmData((p) => ({
                            ...p,
                            expectedDischargeDate: e.target.value,
                          }))
                        }
                        style={{ width: "100%", height: 36 }}
                        min={new Date().toISOString().slice(0, 10)}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          display: "block",
                          marginBottom: 3,
                        }}
                      >
                        Reason
                      </label>
                      <InputText
                        value={admData.reasonForAdmission}
                        onChange={(e) =>
                          setAdmData((p) => ({
                            ...p,
                            reasonForAdmission: e.target.value,
                          }))
                        }
                        placeholder="From diagnosis"
                        style={{ width: "100%", height: 36, fontSize: 12 }}
                      />
                    </div>
                  </div>
                  <BedSelectionPanel
                    value={bedData}
                    onChange={setBedData}
                    disabled={loading}
                  />
                  {bedData.bedId && (
                    <div
                      style={{
                        marginTop: 8,
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        color: "#166534",
                        fontWeight: 600,
                      }}
                    >
                      ✓ Bed selected: <b>{bedData.bedNumber}</b>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── DOCTOR + SUBMIT ── */}
            <div
              style={{
                ...card,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}
                >
                  Prescribing Doctor
                </div>
                <div
                  style={{ fontWeight: 700, color: "#0891b2", fontSize: 13 }}
                >
                  Dr. {doctorData?.personalInfo?.firstName}{" "}
                  {doctorData?.personalInfo?.lastName}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {doctorData?.professional?.specialization || ""}
                  {doctorData?.professional?.qualification
                    ? ` · ${doctorData.professional.qualification}`
                    : ""}
                </div>
              </div>
              <Button
                type="submit"
                label={
                  loading
                    ? "Saving..."
                    : buttonMode === "CREATE"
                      ? "Create & Print"
                      : "Update & Print"
                }
                icon={loading ? "pi pi-spin pi-spinner" : "pi pi-check"}
                style={{
                  background: "#0891b2",
                  border: "none",
                  fontWeight: 700,
                  padding: "10px 28px",
                }}
                loading={loading}
                disabled={loading}
              />
            </div>
          </div>
        </Form>
      )}
    </Formik>
  );
}
