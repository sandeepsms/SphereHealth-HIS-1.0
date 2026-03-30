// PatientRegistration.jsx
// ✅ Fixed: uses patientService (axios) instead of raw fetch
// ✅ Header removed, search kept in top bar
// ✅ Compact professional UI

import React, { useState, useEffect, useRef, useCallback } from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { useNavigate, useParams } from "react-router-dom";
import { BreadCrumb } from 'primereact/breadcrumb';
import { departmentService } from "../Services/departmentService";
import { doctorService } from "../Services/doctors/doctorService";
import { tpaService } from "../Services/tpa/tpaService";
import { admissionService } from "../Services/admissionService";
import patientService from "../Services/patient/patientService";
import PatientSearchBar from "./Search/PatientSearchBar";
import BedSelectionPanel from "../Components/bed/BedSelectionPanel";
import PatientHistoryModal from "./PatientHistoryModal";


import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../css/Radiobutton.css";

/* ── Constants ── */
const BED_REQUIRED = ["IPD", "Emergency"];
const BED_OPTIONAL = ["Daycare"];
const NEEDS_BED = (t) => BED_REQUIRED.includes(t) || BED_OPTIONAL.includes(t);
const REG_TO_ADM = {
  IPD: "Planned",
  Emergency: "Emergency",
  Daycare: "Day Care",
};
const REG_COLOR = {
  OPD: "#0891b2",
  Emergency: "#dc2626",
  IPD: "#7c3aed",
  Daycare: "#d97706",
  Services: "#059669",
};

const calcAge = (dob) => {
  if (!dob) return "";
  const t = new Date(),
    b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (
    t.getMonth() - b.getMonth() < 0 ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())
  )
    a--;
  return a < 0 ? "" : a;
};

// From age (years) → approximate DOB (1st Jan of that year)
const dobFromAge = (age) => {
  const n = parseInt(age);
  if (!n || n <= 0 || n > 120) return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
};

/* ══════════════ PRINT RECEIPT ══════════════ */
const printReceipt = ({
  patient,
  regType,
  bedData,
  admissionData,
  doctorLabel,
  departmentLabel,
  tpaLabel,
  isExisting,
}) => {
  const now = new Date();
  const fmt = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";
  const fmtDt = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const rc = REG_COLOR[regType] || "#0891b2";
  const hasBed = NEEDS_BED(regType) && bedData?.bedId;

  const dob = patient.dateOfBirth ? fmt(patient.dateOfBirth) : "—";
  const addr =
    [
      patient.address?.completeAddress,
      patient.address?.city,
      patient.address?.state,
      patient.address?.pincode,
    ]
      .filter(Boolean)
      .join(", ") || "—";

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<title>Registration Receipt — ${patient.UHID || ""}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;font-size:12px;}
  .page{width:210mm;min-height:297mm;margin:0 auto;padding:8mm 12mm;}

  /* ── HEADER ── */
  .header{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid ${rc};padding-bottom:10px;margin-bottom:12px;}
  .hosp-left{display:flex;align-items:flex-start;gap:12px;}
  .hosp-logo{width:60px;height:60px;background:${rc}18;border:2px solid ${rc};
    border-radius:8px;display:flex;align-items:center;justify-content:center;
    flex-shrink:0;}
  .hosp-logo svg{width:36px;height:36px;}
  .hosp-name{font-size:18px;font-weight:900;color:${rc};line-height:1.15;}
  .hosp-sub{font-size:10px;color:#555;margin-top:3px;}
  .hosp-contact{margin-top:5px;font-size:10px;color:#444;line-height:1.6;}
  .hosp-contact span{display:block;}
  .receipt-badge{text-align:right;}
  .receipt-title{font-size:14px;font-weight:800;color:${rc};
    text-transform:uppercase;letter-spacing:.08em;}
  .receipt-sub{font-size:10px;color:#666;margin-top:3px;}
  .receipt-uhid{margin-top:5px;font-size:11px;font-weight:700;color:#1a1a1a;
    background:${rc}15;padding:3px 10px;border-radius:4px;display:inline-block;}
  .reg-badge{margin-top:5px;display:inline-block;padding:3px 12px;
    border-radius:4px;font-size:11px;font-weight:700;
    background:${rc};color:#fff;}

  /* ── PATIENT INFO TABLE (like prescription) ── */
  .pat-info-table{width:100%;border:1px solid #ddd;border-radius:6px;
    overflow:hidden;margin-bottom:12px;}
  .pat-info-table tr td{padding:5px 10px;font-size:11px;border-bottom:1px solid #eee;}
  .pat-info-table tr:last-child td{border-bottom:none;}
  .pat-info-table .lbl{color:#666;width:130px;font-weight:600;}
  .pat-info-table .val{color:#1a1a1a;font-weight:700;}
  .pat-info-table .right-lbl{color:#666;width:100px;font-weight:600;padding-left:16px;}
  .pat-info-top{background:${rc};color:#fff;padding:5px 10px;
    font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;}

  /* ── SECTION TITLE (like prescription red headers) ── */
  .sec-title{color:${rc};font-size:11px;font-weight:800;
    text-transform:uppercase;letter-spacing:.06em;
    border-bottom:1.5px solid ${rc};padding-bottom:3px;
    margin:12px 0 8px;}

  /* ── INFO GRID ── */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin-bottom:12px;}
  .info-item .il{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.04em;}
  .info-item .iv{font-size:11px;font-weight:700;color:#1a1a1a;margin-top:1px;}

  /* ── BED BOX ── */
  .bed-box{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;
    padding:8px 12px;margin-bottom:12px;
    display:flex;align-items:center;gap:14px;}
  .bed-num{font-size:22px;font-weight:900;color:#15803d;}
  .bed-lbl{font-size:9px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}

  /* ── ADMISSION DETAILS TABLE ── */
  .adm-table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px;}
  .adm-table th{background:${rc};color:#fff;padding:5px 10px;text-align:left;font-weight:700;font-size:10px;}
  .adm-table td{padding:5px 10px;border-bottom:1px solid #eee;}
  .adm-table tr:last-child td{border-bottom:none;}

  /* ── VITALS / NOTES ── */
  .notes-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;
    padding:8px 12px;font-size:11px;color:#374151;line-height:1.6;margin-bottom:12px;}
  .notes-box .no-data{color:#9ca3af;font-style:italic;}

  /* ── FOOTER / SIGNATURE ── */
  .footer{margin-top:20px;padding-top:12px;border-top:1px solid #ddd;
    display:flex;justify-content:space-between;align-items:flex-end;}
  .sign-box{text-align:center;}
  .sign-line{width:130px;border-bottom:1px solid #374151;height:32px;margin-bottom:4px;}
  .sign-lbl{font-size:9px;color:#666;}
  .footer-note{font-size:9px;color:#9ca3af;text-align:center;margin-top:10px;}

  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{padding:5mm 8mm;}
  }
</style>
</head><body>
<div class="page">

  <!-- ══ HEADER ══ -->
  <div class="header">
    <div class="hosp-left">
      <div class="hosp-logo">
        <!-- Hospital cross/plus icon -->
        <svg viewBox="0 0 40 40" fill="none">
          <rect x="16" y="4"  width="8" height="32" rx="2" fill="${rc}"/>
          <rect x="4"  y="16" width="32" height="8"  rx="2" fill="${rc}"/>
        </svg>
      </div>
      <div>
        <div class="hosp-name">Spherehealth Medical Solutions</div>
        <div class="hosp-sub">Complete Healthcare Management System</div>
        <div class="hosp-contact">
          <span>📞 Contact: Registration Desk</span>
          <span>📧 info@spherehealth.com</span>
        </div>
      </div>
    </div>
    <div class="receipt-badge">
      <div class="receipt-title">Registration Receipt</div>
      <div class="receipt-sub">Date: ${fmt(now)}&nbsp;&nbsp;Time: ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="receipt-uhid">UHID: ${patient.UHID || "—"}</div>
      <div><span class="reg-badge">${regType}${isExisting ? " · Revisit" : ""}</span></div>
    </div>
  </div>

  <!-- ══ PATIENT INFORMATION (prescription style table) ══ -->
  <div class="sec-title">Patient Information</div>
  <table class="pat-info-table">
    <tr>
      <td class="lbl">Patient Name</td>
      <td class="val">${patient.title || ""} ${patient.fullName || "—"}</td>
      <td class="right-lbl">UHID</td>
      <td class="val">${patient.UHID || "—"}</td>
    </tr>
    <tr>
      <td class="lbl">Age / Gender</td>
      <td class="val">${patient.age ? `${patient.age} Yrs` : "—"} / ${patient.gender || "—"}</td>
      <td class="right-lbl">Blood Group</td>
      <td class="val">${patient.bloodGroup || "—"}</td>
    </tr>
    <tr>
      <td class="lbl">Contact</td>
      <td class="val">${patient.contactNumber || "—"}</td>
      <td class="right-lbl">Date of Birth</td>
      <td class="val">${dob}</td>
    </tr>
    <tr>
      <td class="lbl">Email</td>
      <td class="val">${patient.email || "—"}</td>
      <td class="right-lbl">Marital Status</td>
      <td class="val">${patient.maritalStatus || "—"}</td>
    </tr>
    <tr>
      <td class="lbl">Address</td>
      <td class="val" colspan="3">${addr}</td>
    </tr>
    ${
      patient.companionName
        ? `
    <tr>
      <td class="lbl">Attendant</td>
      <td class="val">${patient.companionName || "—"} (${patient.companionRelationship || "—"})</td>
      <td class="right-lbl">Att. Contact</td>
      <td class="val">${patient.companionContact || "—"}</td>
    </tr>`
        : ""
    }
    ${
      patient.isMLC
        ? `
    <tr>
      <td class="lbl">MLC Case</td>
      <td class="val" style="color:#dc2626;font-weight:800">YES${patient.mlcNumber ? ` — MLC No: ${patient.mlcNumber}` : ""}</td>
      <td></td><td></td>
    </tr>`
        : ""
    }
  </table>

  <!-- ══ CLINICAL / REGISTRATION DETAILS ══ -->
  <div class="sec-title">Registration Details</div>
  <table class="pat-info-table">
    <tr>
      <td class="lbl">Registration Type</td>
      <td class="val" style="color:${rc}">${regType}</td>
      <td class="right-lbl">Date &amp; Time</td>
      <td class="val">${fmt(now)}, ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
    </tr>
    <tr>
      <td class="lbl">Department</td>
      <td class="val">${departmentLabel || "—"}</td>
      <td class="right-lbl">Doctor</td>
      <td class="val">${doctorLabel || "—"}</td>
    </tr>
    ${
      tpaLabel
        ? `<tr>
      <td class="lbl">TPA / Insurance</td>
      <td class="val">${tpaLabel}</td>
      <td></td><td></td>
    </tr>`
        : ""
    }
    ${
      patient.knownAllergies
        ? `<tr>
      <td class="lbl">Known Allergies</td>
      <td class="val" style="color:#dc2626">${patient.knownAllergies}</td>
      <td></td><td></td>
    </tr>`
        : ""
    }
  </table>

  <!-- ══ BED ALLOTMENT (only for IPD/Emergency/Daycare) ══ -->
  ${
    hasBed
      ? `
  <div class="sec-title">Bed Allotment</div>
  <div class="bed-box">
    <svg width="40" height="32" viewBox="0 0 36 28" fill="none">
      <rect x="2" y="13" width="32" height="9" rx="2" fill="#22c55e"/>
      <rect x="2" y="7"  width="5"  height="15" rx="1.5" fill="#16a34a"/>
      <rect x="8" y="9"  width="9"  height="7"  rx="2"   fill="white" opacity=".9"/>
      <rect x="29" y="9" width="4"  height="13" rx="1.5" fill="#16a34a"/>
      <rect x="3"  y="22" width="4" height="5"  rx="1"   fill="#16a34a"/>
      <rect x="29" y="22" width="4" height="5"  rx="1"   fill="#16a34a"/>
    </svg>
    <div>
      <div class="bed-lbl">Bed Allotted</div>
      <div class="bed-num">${bedData.bedNumber}</div>
    </div>
    <table style="margin-left:20px;font-size:11px;flex:1">
      <tr>
        <td style="color:#666;font-weight:600;padding-right:12px">Admission Type</td>
        <td style="font-weight:700">${admissionData?.admissionType || "—"}</td>
        <td style="color:#666;font-weight:600;padding:0 12px">Admission Date</td>
        <td style="font-weight:700">${fmt(now)}</td>
      </tr>
      ${
        admissionData?.expectedDischargeDate
          ? `<tr>
        <td style="color:#666;font-weight:600;padding-right:12px">Expected Discharge</td>
        <td style="font-weight:700">${fmt(admissionData.expectedDischargeDate)}</td>
        <td></td><td></td>
      </tr>`
          : ""
      }
    </table>
  </div>

  <!-- Diagnosis -->
  ${
    admissionData?.reasonForAdmission
      ? `
  <div class="sec-title">Provisional Diagnosis / Reason for Admission</div>
  <div class="notes-box">${admissionData.reasonForAdmission}</div>`
      : ""
  }

  <!-- Special Instructions -->
  ${
    admissionData?.specialInstructions
      ? `
  <div class="sec-title">Special Instructions</div>
  <div class="notes-box">${admissionData.specialInstructions}</div>`
      : ""
  }
  `
      : ""
  }

  <!-- ══ FOOTER / SIGNATURES ══ -->
  <div class="footer">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-lbl">Patient / Attendant Signature</div>
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-lbl">Attending Doctor</div>
      <div style="font-size:10px;font-weight:700;margin-top:2px">${doctorLabel || ""}</div>
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-lbl">Registration Counter</div>
    </div>
  </div>
  <div class="footer-note">
    Computer generated receipt. No signature required for validity. | Spherehealth Medical Solutions
  </div>

</div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    alert("Please allow popups to print the receipt.");
    return;
  }
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
};

/* ══════════════ COMPONENT ══════════════ */
export default function PatientRegistration() {
  const toast = useRef(null);
  const navigate = useNavigate();
  const { typedata, id: patientId } = useParams();
  console.log("mmmmmmmmm", typedata);

  const [formData, setFormData] = useState({
    registrationType: "OPD",
    title: "",
    fullName: "",
    gender: "",
    dateOfBirth: null,
    maritalStatus: "",
    contactNumber: "",
    email: "",
    age: "",
    address: {
      completeAddress: "",
      pincode: "",
      city: "",
      state: "",
      district: "",
    },
    bloodGroup: "",
    knownAllergies: "",
    tpa: null,
    department: "",
    doctor: "",
    isMLC: false,
    mlcNumber: "",
    companionName: "",
    companionRelationship: "",
    companionContact: "",
    hasAppointment: false,
    appointmentDate: null,
    appointmentTime: null,
  });
  const [admData, setAdmData] = useState({
    reasonForAdmission: "",
    admissionType: "Emergency",
    expectedDischargeDate: "",
    specialInstructions: "",
  });
  const [bedData, setBedData] = useState({
    buildingId: null,
    floorId: null,
    wardId: null,
    roomId: null,
    bedId: null,
    bedNumber: null,
  });
  const [existing, setExisting] = useState(null);
  const [errors, setErrors] = useState({});
  const [tpaList, setTpaList] = useState([]);
  const [depts, setDepts] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [filtDocs, setFiltDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pinLoad, setPinLoad] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [opdPrice, setOpdPrice] = useState(null);
  const [success, setSuccess] = useState(null);
  // Track whether age was manually typed (to disable DOB) or DOB was picked (to disable age)
  const [ageMode, setAgeMode] = useState(null); // null | "dob" | "age"
  const [historyModal, setHistoryModal] = useState(false);

  // set the registration rotes by that method......
  useEffect(() => {
    if (typedata) {
      setFormData((prev) => ({
        ...prev,
        registrationType: typedata,
      }));
    }
  }, [typedata]);

  /* ── Bootstrap ── */
  useEffect(() => {
    (async () => {
      setInitLoad(true);
      await Promise.all([loadTPA(), loadDepts(), loadDoctors()]);
      setInitLoad(false);
    })();
  }, []);

  useEffect(() => {
    if (patientId && (depts.length > 0 || doctors.length > 0))
      loadPatient(patientId);
  }, [patientId, depts.length, doctors.length]);

  useEffect(() => {
    if (formData.department && doctors.length > 0) {
      const f = doctors.filter((d) => d.department === formData.department);
      setFiltDocs(f);
      if (formData.doctor && !f.find((d) => d.value === formData.doctor))
        setFormData((p) => ({ ...p, doctor: "" }));
    } else setFiltDocs([]);
  }, [formData.department, doctors]);

  useEffect(() => {
    setAdmData((p) => ({
      ...p,
      admissionType: REG_TO_ADM[formData.registrationType] || "Emergency",
    }));
    if (!NEEDS_BED(formData.registrationType))
      setBedData({
        buildingId: null,
        floorId: null,
        wardId: null,
        roomId: null,
        bedId: null,
        bedNumber: null,
      });
  }, [formData.registrationType]);

  /* ── Loaders ── */
  const loadTPA = async () => {
    try {
      const d = await tpaService.getAllTPAs();
      if (d.success)
        setTpaList(d.data.map((t) => ({ label: t.tpaName, value: t._id })));
    } catch {
      setTpaList([]);
    }
  };
  const loadDepts = async () => {
    try {
      const r = await departmentService.getAllDepartments();
      const l = Array.isArray(r) ? r : r.data || [];
      setDepts(
        l
          .filter((d) => d.isActive)
          .map((d) => ({ label: d.departmentName, value: d._id })),
      );
    } catch {
      setDepts([]);
    }
  };
  const loadDoctors = async () => {
    try {
      const r = await doctorService.getAllDoctors();
      const l = Array.isArray(r) ? r : r.data || [];
      setDoctors(
        l
          .filter((d) => d.isActive)
          .map((d) => ({
            label: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""} (${d.professional?.specialization || ""})`,
            value: d._id,
            department:
              typeof d.department === "object"
                ? d.department._id
                : d.department,
          })),
      );
    } catch {
      setDoctors([]);
    }
  };
  const loadOPDPrice = (id) => {
    fetch(`http://localhost:5000/api/Servicebilldata/getOPDPrice?_id=${id}`)
      .then((r) => r.json())
      .then((d) => setOpdPrice(d?.data?.opd_price?.[0]?.Totalamount || null))
      .catch(() => setOpdPrice(null));
  };
  const loadPincode = async (pin) => {
    if (pin.length !== 6) return;
    setPinLoad(true);
    try {
      const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const d = await r.json();
      if (d[0].Status === "Success") {
        const po = d[0].PostOffice[0];
        setFormData((p) => ({
          ...p,
          address: {
            ...p.address,
            city: po.District,
            state: po.State,
            district: po.Block || po.District,
          },
        }));
        toast.current?.show({
          severity: "success",
          summary: "Address auto-filled",
          life: 2000,
        });
      } else
        toast.current?.show({
          severity: "warn",
          summary: "Invalid pincode — no data found",
          life: 2000,
        });
    } catch {
    } finally {
      setPinLoad(false);
    }
  };

  const loadPatient = async (id) => {
    try {
      setLoading(true);
      const data = await patientService.getPatientById(id);
      const p = data?.data || data;
      if (p?._id) {
        setEditMode(true);
        prefill(p, true); // Edit mode: keep original registrationType
        if (p.tpa?._id || p.tpa) loadOPDPrice(p.tpa?._id || p.tpa);
      }
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Load failed",
        detail: e?.message || "Could not load patient",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const prefill = useCallback((p, keepRegType = false) => {
    console.log(p,"ooooooooooo");
    
    setAgeMode(p.dateOfBirth ? "dob" : null);
    setFormData({
      // For existing patient search: reset to OPD so user picks the new visit type
      // For edit mode: keep original registrationType
      registrationType: keepRegType ? p.registrationType || "OPD" : "OPD",
      title: p.title || "",
      fullName: p.fullName || "",
      gender: p.gender || "",
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
      maritalStatus: p.maritalStatus || "",
      contactNumber: p.contactNumber || "",
      email: p.email || "",
      age: p.age
        ? String(p.age)
        : calcAge(p.dateOfBirth) !== ""
          ? String(calcAge(p.dateOfBirth))
          : "",
      address: {
        completeAddress: p.address?.completeAddress || "",
        pincode: p.address?.pincode || "",
        city: p.address?.city || "",
        state: p.address?.state || "",
        district: p.address?.district || "",
      },
      bloodGroup: p.bloodGroup || "",
      knownAllergies: p.knownAllergies || "",
      tpa: typeof p.tpa === "object" ? p.tpa?._id : p.tpa || null,
      department:
        typeof p.department === "object"
          ? p.department?._id
          : p.department || "",
      doctor: typeof p.doctor === "object" ? p.doctor?._id : p.doctor || "",
      isMLC: p.isMLC || false,
      mlcNumber: p.mlcNumber || "",
      companionName: p.companionName || "",
      companionRelationship: p.companionRelationship || "",
      companionContact: p.companionContact || "",
      hasAppointment: false,
      appointmentDate: null,
      appointmentTime: null,
    });
    if (p.tpa?._id || p.tpa) loadOPDPrice(p.tpa?._id || p.tpa);
  }, []);

  const onSearchSelect = (patient) => {
    console.log("datatatatatata",patient);
    
    setExisting(patient);
    prefill(patient, false); // Reset registrationType — user picks new visit type
    toast.current?.show({
      severity: "info",
      summary: "Patient Found",
      detail: `${patient.fullName} (${patient.UHID}) — Select registration type for new visit`,
      life: 4000,
    });
  };
  const clearExisting = () => {
    setExisting(null);
    setAgeMode(null);
    setFormData({
      registrationType: "OPD",
      title: "",
      fullName: "",
      gender: "",
      dateOfBirth: null,
      maritalStatus: "",
      contactNumber: "",
      email: "",
      age: "",
      address: {
        completeAddress: "",
        pincode: "",
        city: "",
        state: "",
        district: "",
      },
      bloodGroup: "",
      knownAllergies: "",
      tpa: null,
      department: "",
      doctor: "",
      isMLC: false,
      mlcNumber: "",
      companionName: "",
      companionRelationship: "",
      companionContact: "",
      hasAppointment: false,
      appointmentDate: null,
      appointmentTime: null,
    });
    setBedData({
      buildingId: null,
      floorId: null,
      wardId: null,
      roomId: null,
      bedId: null,
      bedNumber: null,
    });
    setOpdPrice(null);
  };

  const handleChange = (name, value) => {
    const titleToGender = {
      "Mr.": "Male",
      Master: "Male",
      "Mrs.": "Female",
      Miss: "Female",
    };

    // Gender → Title mapping
    const genderToTitle = {
      Male: "Mr.",
      Female: "Miss",
    };

    if (name === "title") {
      setFormData((p) => ({
        ...p,
        title: value,
        gender: titleToGender[value] || p.gender,
      }));
    } else if (name === "gender") {
      setFormData((p) => ({
        ...p,
        gender: value,
        title: genderToTitle[value] || p.title,
      }));
    } else if (name === "dateOfBirth") {
      // DOB picked → auto-fill age, lock age field
      const age = calcAge(value);
      setFormData((p) => ({
        ...p,
        dateOfBirth: value,
        age: age !== "" ? String(age) : p.age,
      }));
      setAgeMode("dob");
    } else if (name === "age") {
      // Age typed → approximate DOB, lock DOB field
      const numVal = value.replace(/\D/g, "");
      const approxDob = dobFromAge(numVal);
      setFormData((p) => ({
        ...p,
        age: numVal,
        dateOfBirth: approxDob || p.dateOfBirth,
      }));
      if (numVal) setAgeMode("age");
      else setAgeMode(null);
    } else if (name.startsWith("address.")) {
      const f = name.split(".")[1];
      setFormData((p) => ({ ...p, address: { ...p.address, [f]: value } }));
      if (f === "pincode" && value.length === 6) loadPincode(value);
    } else setFormData((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((p) => ({ ...p, [name]: "" }));
  };

  // Clear age/dob lock
  const clearDobAge = () => {
    setFormData((p) => ({ ...p, dateOfBirth: null, age: "" }));
    setAgeMode(null);
  };

  const validate = () => {
    const e = {};
    if (!formData.title) e.title = "Required";
    if (!formData.fullName.trim()) e.fullName = "Required";
    if (!formData.gender) e.gender = "Required";
    if (!formData.dateOfBirth && !formData.age)
      e.dateOfBirth = "DOB or Age is required";
    if (!formData.contactNumber.trim()) e.contactNumber = "Required";
    if (!formData.address.pincode.trim()) e.pincode = "Required";
    if (!formData.bloodGroup) e.bloodGroup = "Required";
    if (!formData.knownAllergies.trim()) e.knownAllergies = "Required";
    if (!formData.department) e.department = "Required";
    if (!formData.doctor) e.doctor = "Required";
    if (BED_REQUIRED.includes(formData.registrationType) && !bedData.bedId)
      e.bedId = `Bed selection required for ${formData.registrationType}`;
    if (
      NEEDS_BED(formData.registrationType) &&
      !admData.reasonForAdmission.trim()
    )
      e.reasonForAdmission = "Diagnosis / reason is required";
    if (formData.hasAppointment) {
      if (!formData.appointmentDate) e.appointmentDate = "Required";
      if (!formData.appointmentTime) e.appointmentTime = "Required";
    }
    if (formData.companionRelationship && !formData.companionContact.trim())
      e.companionContact = "Contact required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ══════════════ SUBMIT ══════════════ */
  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) {
      toast.current?.show({
        severity: "error",
        summary: "Validation Error",
        detail: "Please fill all required fields marked with *",
        life: 3000,
      });
      return;
    }
    setLoading(true);
    try {
      const needsBed = NEEDS_BED(formData.registrationType);
      const regType = formData.registrationType;
      let patient = null;

      /* ── CASE A: Existing patient (search select) ── */
      if (existing) {
        const visitField =
          regType === "OPD"
            ? "totalOPDVisits"
            : regType === "Emergency"
              ? "totalEmergencyVisits"
              : regType === "IPD"
                ? "totalIPDVisits"
                : regType === "Daycare"
                  ? "totalDaycareVisits"
                  : regType === "Services"
                    ? "totalServicesVisits"
                    : null;
        const data = await patientService.updatePatient(existing._id, {
          registrationType: regType,
          department: formData.department,
         
          doctor: formData.doctor,
          lastVisitDate: new Date().toISOString(),
          contactNumber: formData.contactNumber,
          email: formData.email || null,
          tpa: formData.tpa || null,
          bloodGroup: formData.bloodGroup,
          knownAllergies: formData.knownAllergies,
          address: formData.address,
          companionName: formData.companionName,
          companionRelationship: formData.companionRelationship,
          companionContact: formData.companionContact,
          isMLC: formData.isMLC,
          mlcNumber: formData.mlcNumber || null,
          _incrementVisit: visitField,
        });
        if (!data.success) throw new Error(data.message || "Update failed");
        patient = {
          ...(data.data || existing),
          UHID: data.data?.UHID || existing.UHID,
          _id: data.data?._id || existing._id,
        };

        /* ── CASE B: Edit mode ── */
      } else if (editMode && patientId) {
        const data = await patientService.updatePatient(patientId, {
          ...formData,
          tpa: formData.tpa || null,
          email: formData.email || null,
          maritalStatus: formData.maritalStatus || null,
          mlcNumber: formData.mlcNumber || null,
        });
        if (!data.success) throw new Error(data.message || "Update failed");
        patient = data.data;

        /* ── CASE C: New patient ── */
      } else {
        // Pre-check: exact contact number duplicate only
        try {
          const chk = await patientService.searchPatients(
            formData.contactNumber.trim(),
            5,
          );
          const matches = Array.isArray(chk) ? chk : chk?.data || [];
          const dup = matches.find(
            (p) =>
              (p.contactNumber || "").trim() === formData.contactNumber.trim(),
          );
          if (dup) {
            setLoading(false);
            toast.current?.show({
              severity: "warn",
              summary: "Contact Number Already Registered",
              detail: `This number belongs to ${dup.fullName} (${dup.UHID}). Please search and select the existing patient from the search bar above.`,
              life: 8000,
            });
            return;
          }
        } catch (_) {
          /* search failed — proceed with create */
        }

        const data = await patientService.createPatient({
          ...formData,
          tpa: formData.tpa || null,
          email: formData.email || null,
          maritalStatus: formData.maritalStatus || null,
          mlcNumber: formData.mlcNumber || null,
        });
        if (!data.success)
          throw new Error(data.message || "Registration failed");
        patient = data.data;
      }

      /* ── Step 2: Create Admission Record (always, for all types) ── */
      // For IPD/Emergency/Daycare: create with bed if selected
      // For OPD/Services: create without bed (hasBed=false)
      // Skip for edit mode (not a new visit)
      if (!editMode) {
        try {
          const admType =
            regType === "IPD"
              ? "Planned"
              : regType === "Daycare"
                ? "Day Care"
                : regType === "OPD"
                  ? "OPD"
                  : regType === "Services"
                    ? "Services"
                    : "Emergency";

          await admissionService.createAdmission({
            patientId: patient._id,
            UHID: patient.UHID,
            bedId: bedData.bedId || null, // null if no bed
            department: formData.department,
            admissionDate: new Date().toISOString(),
            expectedDischargeDate: admData.expectedDischargeDate || undefined,
            reasonForAdmission: admData.reasonForAdmission || "",
            admissionType: admType,
            attendingDoctor:
              doctors.find((d) => d.value === formData.doctor)?.label || "",
            specialInstructions: admData.specialInstructions || "",
          });
        } catch (admErr) {
          // Don't block registration if admission record fails
          console.warn(
            "[PatientRegistration] admission record create failed:",
            admErr?.message,
          );
        }
      }

      /* ── Success ── */
      const deptLabel =
        depts.find((d) => d.value === formData.department)?.label || "";
      const docLabel =
        doctors.find((d) => d.value === formData.doctor)?.label || "";
      const tpaLbl = tpaList.find((t) => t.value === formData.tpa)?.label || "";
      setSuccess({
        patient: { ...patient, ...formData },
        regType,
        bedData: needsBed ? bedData : null,
        admissionData: needsBed ? admData : null,
        doctorLabel: docLabel,
        departmentLabel: deptLabel,
        tpaLabel: tpaLbl,
        isExisting: !!existing,
      });
    } catch (err) {
      console.error("[PatientRegistration] submit error:", err);
      const raw =
        err?.response?.data?.message || err?.message || "Something went wrong";
      const isDuplicate =
        raw.toLowerCase().includes("contact") ||
        raw.toLowerCase().includes("duplicate") ||
        raw.toLowerCase().includes("already exists") ||
        raw.toLowerCase().includes("unique");
      if (isDuplicate) {
        toast.current?.show({
          severity: "warn",
          summary: "Patient Already Registered",
          detail:
            "This contact number is already registered. Please search for the existing patient using the search bar above.",
          life: 7000,
        });
      } else {
        toast.current?.show({
          severity: "error",
          summary: "Registration Failed",
          detail: raw,
          life: 5000,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  /* ── Static options ── */
  const TITLES = [
    { label: "Mr.", value: "Mr." },
    { label: "Mrs.", value: "Mrs." },
    { label: "Miss", value: "Miss" },
    { label: "Master", value: "Master" },
    { label: "Baby", value: "Baby" },
    { label: "Dr.", value: "Dr." },
  ];
  const GENDERS = [
    { label: "Male", value: "Male" },
    { label: "Female", value: "Female" },
    { label: "Other", value: "Other" },
  ];
  const MARITAL = [
    { label: "Single", value: "Single" },
    { label: "Married", value: "Married" },
    { label: "Divorced", value: "Divorced" },
    { label: "Widowed", value: "Widowed" },
    { label: "Other", value: "Other" },
  ];
  const BLOODS = [
    "A+",
    "A-",
    "B+",
    "B-",
    "AB+",
    "AB-",
    "O+",
    "O-",
    "Not Known",
  ].map((b) => ({ label: b, value: b }));
  const RELS = [
    "Father",
    "Mother",
    "Spouse",
    "Son",
    "Daughter",
    "Brother",
    "Sister",
    "Friend",
    "Other",
  ].map((r) => ({ label: r, value: r }));

  // const ADM_TYPES = [

  //   { label: "Emergency", value: "Emergency" },
  //   { label: "Planned", value: "Planned" },
  //   { label: "Transfer", value: "Transfer" },
  //   { label: "Day Care", value: "Day Care" },
  // ];

  const ADM_TYPES = [
    { label: "Emergency", value: "Emergency" },
    { label: "Planned", value: "Planned" },
    { label: "Transfer", value: "Transfer" },
    { label: "Day Care", value: "Day Care" },
  ];

  const filteredTypes = (() => {
    const type = admData.admissionType;
    const ipdtype = formData.registrationType;

    if (type === "Emergency") {
      return ADM_TYPES.filter((item) => item.value !== "Day Care");
    }

    if (ipdtype === "IPD") {
      return ADM_TYPES.filter(
        (item) => item.value !== "Day Care" && item.value !== "Emergency",
      );
    }

    if (type === "Day Care") {
      return ADM_TYPES.filter((item) => item.value !== "Emergency");
    } else {
      return ADM_TYPES;
    }
  })();
  /* ── Style helpers ── */
  const ac = REG_COLOR[formData.registrationType] || "#0891b2";
  const lbl = {
    fontWeight: 600,
    display: "block",
    marginBottom: "3px",
    fontSize: "12px",
    color: "#374151",
  };
  const cs = {
    marginBottom: "3px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    padding: "12px 14px",
  };
  const sh = {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    marginBottom: "10px",
    paddingBottom: "7px",
    borderBottom: "1px solid #e5e7eb",
  };
  const fs = { marginBottom: "8px" };
  const err = (k) =>
    errors[k] ? (
      <small
        style={{
          color: "#ef4444",
          fontSize: 11,
          marginTop: 2,
          display: "block",
        }}
      >
        {errors[k]}
      </small>
    ) : null;

  if (initLoad)
    return (


    

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "300px",
          gap: 12,
        }}
      >
        <ProgressSpinner style={{ width: 42, height: 42 }} />
        <span style={{ color: "#64748b", fontSize: 14 }}>
          Loading registration form…
        </span>

        
      </div>
    );

  /* ══════════════ SUCCESS MODAL ══════════════ */
  if (success) {
    const {
      patient: sp,
      regType: rt,
      bedData: bd,
      admissionData: ad,
      doctorLabel: dl,
      departmentLabel: dpl,
      tpaLabel: tl,
      isExisting: ie,
    } = success;
    const rc2 = REG_COLOR[rt] || "#0891b2";
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(0,0,0,.5)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter',-apple-system,sans-serif",
        }}
      >

      
        <div
          style={{
            width: 460,
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 24px 60px rgba(0,0,0,.28)",
            overflow: "hidden",
            animation: "si .28s cubic-bezier(.34,1.3,.64,1)",
          }}
        >
          <style>{`@keyframes si{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}`}</style>

          {/* Header */}
          <div
            style={{
              background: "linear-gradient(135deg,#16a34a,#15803d)",
              padding: "22px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(255,255,255,.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <i
                className="pi pi-check"
                style={{ color: "#fff", fontSize: 24 }}
              />
            </div>
            <div
              style={{
                color: "#fff",
                fontWeight: 800,
                fontSize: 18,
                marginBottom: 4,
              }}
            >
              {ie
                ? `${rt} Visit Recorded!`
                : "Patient Registered Successfully!"}
            </div>
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: 12 }}>
              UHID:{" "}
              <strong
                style={{
                  background: "rgba(255,255,255,.2)",
                  padding: "2px 10px",
                  borderRadius: 5,
                  fontFamily: "monospace",
                  letterSpacing: 1,
                }}
              >
                {sp.UHID}
              </strong>
            </div>
          </div>

          <div style={{ padding: "18px 22px" }}>
            {/* Type badge */}
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <span
                style={{
                  background: `${rc2}12`,
                  color: rc2,
                  border: `1.5px solid ${rc2}35`,
                  borderRadius: 20,
                  padding: "4px 16px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {rt} Registration {bd ? `· Bed ${bd.bedNumber}` : ""}
              </span>
            </div>

            {/* Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 14px",
                marginBottom: 14,
              }}
            >
              {[
                ["Patient", sp.fullName || "—"],
                ["Contact", sp.contactNumber || "—"],
                ["Department", dpl || "—"],
                ["Doctor", dl || "—"],
                bd && ["Bed Allotted", bd.bedNumber],
                ad?.admissionType && ["Admission Type", ad.admissionType],
                tl && ["TPA", tl],
              ]
                .filter(Boolean)
                .map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      background: "#f8fafc",
                      borderRadius: 8,
                      padding: "8px 10px",
                      border: "1px solid #f1f5f9",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "#94a3b8",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                      }}
                    >
                      {k}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#0f172a",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v}
                    </div>
                  </div>
                ))}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => printReceipt(success)}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg,#0891b2,#0e7490)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  boxShadow: "0 4px 14px rgba(8,145,178,.3)",
                }}
              >
                <i className="pi pi-print" style={{ fontSize: 14 }} /> Print
                Receipt
              </button>
              <button
                onClick={() => {
                  setSuccess(null);
                  navigate("/allpatient");
                }}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: 10,
                  border: "1.5px solid #e2e8f0",
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: "#374151",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                }}
              >
                <i className="pi pi-users" style={{ fontSize: 14 }} /> All
                Patients
              </button>
            </div>
            <button
              onClick={() => {
                printReceipt(success);
                setTimeout(() => {
                  setSuccess(null);
                  navigate("/allpatient");
                }, 400);
              }}
              style={{
                width: "100%",
                padding: "9px",
                borderRadius: 10,
                border: "none",
                background: "#f1f5f9",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <i className="pi pi-print" style={{ fontSize: 11 }} /> Print &amp;
              Go to Patients
            </button>
            <p
              style={{
                textAlign: "center",
                fontSize: 10,
                color: "#94a3b8",
                marginTop: 8,
              }}
            >
              <i className="pi pi-info-circle" style={{ marginRight: 3 }} />
              You can also save as PDF by selecting "Save as PDF" in the print
              dialog
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════ MAIN FORM ══════════════ */
  return (

     <>
     <div style={{position:"relative", display:"flex", justifyContent:"space-between" }}>
     

      <button style={{background:"red", color:"white",padding:"5px" }} onClick={() => navigate(-1)}>⬅ Back</button>
      <button style={{background:"green", color:"white",padding:"5px" }} onClick={() => navigate("/patients")}>Next ➡</button>

      
    </div>

    <div
      style={{
        width: "100%",
        padding: "4px 10px",
        fontFamily: "'Inter',-apple-system,sans-serif",
      }}
    >
      <Toast ref={toast} position="top-right" />

      {/* ── TOP BAR: Search + existing patient chip + edit back button ── */}
      <div
        style={{
          background: "linear-gradient(135deg,#0f766e,#0891b2)",
          borderRadius: 10,
          padding: "10px 16px",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Search */}
        {!editMode && (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              transform: "scale(0.9)",
              transformOrigin: "left center",
            }}
          >
            <PatientSearchBar
              onPatientSelect={onSearchSelect}
              placeholder="🔍 Search existing patient by name, UHID or phone..."
              style={{ width: "100%" }}
            />
          </div>
        )}
        {/* Existing patient chip */}
        {existing && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,.18)",
              borderRadius: 8,
              padding: "5px 12px",
              border: "1px solid rgba(255,255,255,.3)",
              flexShrink: 0,
            }}
          >
            <i
              className="pi pi-check-circle"
              style={{ color: "#86efac", fontSize: 12 }}
            />
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>
              {existing.fullName} —{" "}
              <span style={{ fontFamily: "monospace" }}>{existing.UHID}</span>
            </span>
            <button
              type="button"
              onClick={clearExisting}
              style={{
                background: "rgba(255,255,255,.2)",
                border: "none",
                borderRadius: 4,
                padding: "2px 7px",
                color: "#fff",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}
        {editMode && (
          <Button
            label="Back"
            icon="pi pi-arrow-left"
            severity="secondary"
            outlined
            size="small"
            onClick={() => navigate("/allpatient")}
            style={{ color: "#fff", borderColor: "rgba(255,255,255,.5)" }}
          />
        )}
        {/* Registration type indicator */}
        <span
          style={{
            background: ac,
            color: "#fff",
            borderRadius: 20,
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(0,0,0,.2)",
          }}
        >
          {formData.registrationType}
          {NEEDS_BED(formData.registrationType) ? " 🛏️" : ""}
        </span>
      </div>

      {/* Existing patient info banner */}
      {existing && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: "8px 14px",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <i
            className="pi pi-check-circle"
            style={{ color: "#16a34a", fontSize: 14 }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>
            Existing Patient · UHID {existing.UHID} · No new UHID will be
            generated
          </span>
          {[
            ["OPD", existing.totalOPDVisits || 0, "#0891b2"],
            ["Emergency", existing.totalEmergencyVisits || 0, "#dc2626"],
            ["IPD", existing.totalIPDVisits || 0, "#7c3aed"],
            ["Daycare", existing.totalDaycareVisits || 0, "#d97706"],
            ["Services", existing.totalServicesVisits || 0, "#059669"],
          ].map(([l, v, c]) => (
            <span key={l} style={{ fontSize: 11, color: "#475569" }}>
              <strong style={{ color: c }}>{v}</strong> {l} visits
            </span>
          ))}
          <button
            type="button"
            onClick={() => setHistoryModal(true)}
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              borderRadius: 8,
              border: "1px solid #0891b2",
              background: "#e0f2fe",
              color: "#0891b2",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
            }}
          >
            <i className="pi pi-history" style={{ fontSize: 11 }} />
            View Full History
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ── Row 1: Reg Type + TPA ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-user-plus"
                style={{ fontSize: 13, color: ac }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                Registration Type
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                marginBottom: NEEDS_BED(formData.registrationType) ? 8 : 0,
              }}
            >
              {["OPD", "Emergency", "IPD", "Daycare", "Services"].map((t) => (
                <div
                  key={t}
                  style={{ display: "flex", alignItems: "center", gap: 5 }}
                >
                  <RadioButton
                    inputId={`rt_${t}`}
                    value={t}
                    onChange={(e) => handleChange("registrationType", e.value)}
                    checked={formData.registrationType === t}
                  />
                  <label
                    htmlFor={`rt_${t}`}
                    style={{
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: formData.registrationType === t ? 700 : 500,
                      color:
                        formData.registrationType === t
                          ? REG_COLOR[t]
                          : "#4b5563",
                    }}
                  >
                    {t}
                  </label>
                </div>
              ))}
            </div>
            {NEEDS_BED(formData.registrationType) && (
              <div
                style={{
                  padding: "5px 10px",
                  background: `${ac}12`,
                  border: `1px solid ${ac}30`,
                  borderRadius: 6,
                  fontSize: 11,
                  color: ac,
                  fontWeight: 600,
                }}
              >
                🛏️ Bed booking section will appear below. Please fill patient
                details first.
              </div>
            )}
          </div>
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-shield"
                style={{ fontSize: 13, color: "#0891b2" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                TPA (Optional)
              </span>
              {opdPrice && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: "#0891b2",
                    fontWeight: 700,
                  }}
                >
                  OPD: ₹{opdPrice}
                </span>
              )}
            </div>
            <Dropdown
              value={formData.tpa}
              options={tpaList}
              onChange={(e) => {
                handleChange("tpa", e.value);
                if (e.value) loadOPDPrice(e.value);
                else setOpdPrice(null);
              }}
              placeholder={tpaList.length ? "Select TPA" : "Loading..."}
              filter
              showClear
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* ── Personal Details ── */}
        <div style={{ ...cs, marginBottom: 6 }}>
          <div style={sh}>
            <i
              className="pi pi-user"
              style={{ fontSize: 13, color: "#0891b2" }}
            />
            <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
              Personal Details
            </span>
            {existing && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  background: "#d1fae5",
                  color: "#065f46",
                  borderRadius: 20,
                  padding: "2px 8px",
                  fontWeight: 700,
                }}
              >
                ✓ Pre-filled · {existing.UHID}
              </span>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8,1fr)",
              gap: 8,
            }}
          >
            <div style={{ gridColumn: "span 1", ...fs }}>
              <label style={lbl}>Title *</label>
              <Dropdown
                value={formData.title}
                options={TITLES}
                onChange={(e) => handleChange("title", e.value)}
                placeholder="Title"
                className={errors.title ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {err("title")}
            </div>
            <div style={{ gridColumn: "span 3", ...fs }}>
              <label style={lbl}>Full Name *</label>
              <InputText
                value={formData.fullName}
                onChange={(e) => handleChange("fullName", e.target.value)}
                placeholder="Full Name"
                className={errors.fullName ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {err("fullName")}
            </div>
            <div style={{ gridColumn: "span 2", ...fs }}>
              <label style={lbl}>Gender *</label>
              <Dropdown
                value={formData.gender}
                options={GENDERS}
                onChange={(e) => handleChange("gender", e.value)}
                placeholder="Gender"
                className={errors.gender ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {err("gender")}
            </div>
            <div style={{ gridColumn: "span 2", ...fs }}>
              <label style={lbl}>
                Date of Birth {ageMode === "age" ? "(auto from age)" : "*"}
              </label>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <Calendar
                    value={formData.dateOfBirth}
                    onChange={(e) => handleChange("dateOfBirth", e.value)}
                    dateFormat="dd/mm/yy"
                    showIcon
                    maxDate={new Date()}
                    placeholder="DD/MM/YYYY"
                    disabled={ageMode === "age"}
                    className={errors.dateOfBirth ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                    appendTo="self"
                  />
                </div>
                {ageMode && (
                  <button
                    type="button"
                    onClick={clearDobAge}
                    title="Clear DOB & Age"
                    style={{
                      padding: "8px 10px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      background: "#fff",
                      cursor: "pointer",
                      color: "#64748b",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <i className="pi pi-refresh" style={{ fontSize: 10 }} />{" "}
                    Clear
                  </button>
                )}
              </div>
              {errors.dateOfBirth && (
                <small
                  style={{
                    color: "#ef4444",
                    fontSize: 11,
                    display: "block",
                    marginTop: 2,
                  }}
                >
                  {errors.dateOfBirth}
                </small>
              )}
            </div>
            <div style={{ gridColumn: "span 1", ...fs }}>
              <label style={lbl}>
                Age {ageMode === "dob" ? "(from DOB)" : ""}
              </label>
              <InputText
                value={formData.age}
                onChange={(e) => handleChange("age", e.target.value)}
                placeholder="Years"
                maxLength={3}
                disabled={ageMode === "dob"}
                style={{
                  width: "100%",
                  background: ageMode === "dob" ? "#f1f5f9" : "#fff",
                }}
              />
              {ageMode === "dob" && (
                <small
                  style={{
                    color: "#0891b2",
                    fontSize: 10,
                    display: "block",
                    marginTop: 1,
                  }}
                >
                  Auto from DOB
                </small>
              )}
              {ageMode === "age" && (
                <small
                  style={{
                    color: "#d97706",
                    fontSize: 10,
                    display: "block",
                    marginTop: 1,
                  }}
                >
                  DOB is estimated
                </small>
              )}
            </div>
            <div style={{ gridColumn: "span 2", ...fs }}>
              <label style={lbl}>Contact *</label>
              <InputText
                value={formData.contactNumber}
                onChange={(e) => handleChange("contactNumber", e.target.value)}
                placeholder="Mobile"
                maxLength={10}
                className={errors.contactNumber ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {err("contactNumber")}
            </div>
            <div style={{ gridColumn: "span 3", ...fs }}>
              <label style={lbl}>Email</label>
              <InputText
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
                type="email"
                placeholder="Email"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ gridColumn: "span 2", ...fs }}>
              <label style={lbl}>Marital Status</label>
              <Dropdown
                value={formData.maritalStatus}
                options={MARITAL}
                onChange={(e) => handleChange("maritalStatus", e.value)}
                placeholder="Status"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        {/* ── Address + Medical ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-map-marker"
                style={{ fontSize: 13, color: "#0891b2" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                Address Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 8,
              }}
            >
              <div style={fs}>
                <label style={lbl}>Pincode *</label>
                <div style={{ position: "relative" }}>
                  <InputText
                    value={formData.address.pincode}
                    onChange={(e) =>
                      handleChange("address.pincode", e.target.value)
                    }
                    placeholder="Pincode"
                    maxLength={6}
                    className={errors.pincode ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {pinLoad && (
                    <ProgressSpinner
                      style={{
                        width: 14,
                        height: 14,
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                  )}
                </div>
                {err("pincode")}
              </div>
              {[
                ["city", "City"],
                ["state", "State"],
                ["district", "District"],
              ].map(([k, l]) => (
                <div key={k} style={fs}>
                  <label style={lbl}>{l}</label>
                  <InputText
                    value={formData.address[k]}
                    readOnly
                    placeholder="Auto"
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 6 }}>
              <label style={lbl}>Complete Address</label>
              <InputTextarea
                value={formData.address.completeAddress}
                onChange={(e) =>
                  handleChange("address.completeAddress", e.target.value)
                }
                rows={2}
                placeholder="House No, Street, Area..."
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-heart"
                style={{ fontSize: 13, color: "#0891b2" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                Medical Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <div style={fs}>
                <label style={lbl}>Department *</label>
                <Dropdown
                  value={formData.department}
                  options={depts}
                  onChange={(e) => handleChange("department", e.value)}
                  placeholder="Select Department"
                  filter
                  className={errors.department ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("department")}
              </div>
              <div style={fs}>
                <label style={lbl}>Doctor *</label>
                <Dropdown
                  value={formData.doctor}
                  options={filtDocs}
                  onChange={(e) => handleChange("doctor", e.value)}
                  placeholder={
                    formData.department ? "Select Doctor" : "Select Dept First"
                  }
                  filter
                  disabled={!formData.department}
                  className={errors.doctor ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("doctor")}
              </div>
              <div style={fs}>
                <label style={lbl}>Blood Group *</label>
                <Dropdown
                  value={formData.bloodGroup}
                  options={BLOODS}
                  onChange={(e) => handleChange("bloodGroup", e.value)}
                  placeholder="Blood Group"
                  className={errors.bloodGroup ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("bloodGroup")}
              </div>
              <div style={fs}>
                <label style={lbl}>Known Allergies *</label>
                <InputTextarea
                  value={formData.knownAllergies}
                  onChange={(e) =>
                    handleChange("knownAllergies", e.target.value)
                  }
                  rows={2}
                  placeholder="e.g. Penicillin, None"
                  className={errors.knownAllergies ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("knownAllergies")}
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Checkbox
                inputId="mlc"
                checked={formData.isMLC}
                onChange={(e) => handleChange("isMLC", e.checked)}
              />
              <label htmlFor="mlc" style={{ fontSize: 12, fontWeight: 600 }}>
                MLC Case?
              </label>
              {formData.isMLC && (
                <InputText
                  value={formData.mlcNumber}
                  onChange={(e) => handleChange("mlcNumber", e.target.value)}
                  placeholder="MLC Number"
                  style={{ width: 150 }}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Admission & Bed ── */}
        {NEEDS_BED(formData.registrationType) && (
          <div
            style={{ ...cs, border: `1.5px solid ${ac}40`, marginBottom: 6 }}
          >
            <div style={sh}>
              <svg
                width="13"
                height="10"
                viewBox="0 0 36 28"
                fill="none"
                style={{ flexShrink: 0 }}
              >
                <rect x="2" y="13" width="32" height="9" rx="2" fill={ac} />
                <rect
                  x="2"
                  y="7"
                  width="5"
                  height="15"
                  rx="1.5"
                  fill={ac}
                  opacity=".7"
                />
                <rect
                  x="8"
                  y="9"
                  width="9"
                  height="7"
                  rx="2"
                  fill="white"
                  opacity=".9"
                />
                <rect
                  x="29"
                  y="9"
                  width="4"
                  height="13"
                  rx="1.5"
                  fill={ac}
                  opacity=".7"
                />
                <rect
                  x="3"
                  y="22"
                  width="4"
                  height="5"
                  rx="1"
                  fill={ac}
                  opacity=".7"
                />
                <rect
                  x="29"
                  y="22"
                  width="4"
                  height="5"
                  rx="1"
                  fill={ac}
                  opacity=".7"
                />
              </svg>
              <span style={{ fontWeight: 700, fontSize: 13, color: ac }}>
                Admission &amp; Bed Booking
                {BED_REQUIRED.includes(formData.registrationType) && (
                  <span
                    style={{ marginLeft: 6, fontSize: 10, color: "#ef4444" }}
                  >
                    * Required
                  </span>
                )}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ gridColumn: "span 2" }}>
                <label style={lbl}>
                  Diagnosis / Reason *
                  {BED_REQUIRED.includes(formData.registrationType)
                    ? ""
                    : " (optional)"}
                </label>
                <InputTextarea
                  value={admData.reasonForAdmission}
                  onChange={(e) =>
                    setAdmData((p) => ({
                      ...p,
                      reasonForAdmission: e.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Primary diagnosis / reason for admission"
                  className={errors.reasonForAdmission ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("reasonForAdmission")}
              </div>
              <div>
                <label style={lbl}>Expected Discharge</label>
                <InputText
                  type="date"
                  value={admData.expectedDischargeDate}
                  onChange={(e) =>
                    setAdmData((p) => ({
                      ...p,
                      expectedDischargeDate: e.target.value,
                    }))
                  }
                  style={{ width: "100%" }}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label style={lbl}>Admission Typessss</label>
                {/* <Dropdown
                  value={admData.admissionType}
                  options={filteredTypes}
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Select Admission Type"
                  onChange={(e) =>
                    setAdmData((prev) => ({
                      ...prev,
                      admissionType: e.value,
                    }))
                  }
                  style={{ width: "100%" }}
                /> */}
                <Dropdown
                  value={admData.admissionType}
                  options={filteredTypes}
                  onChange={(e) =>
                    setAdmData((p) => ({ ...p, admissionType: e.value }))
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <label style={lbl}>Special Instructions</label>
                <InputTextarea
                  value={admData.specialInstructions}
                  onChange={(e) =>
                    setAdmData((p) => ({
                      ...p,
                      specialInstructions: e.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Diet, care instructions, allergies to watch..."
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <BedSelectionPanel
              value={bedData}
              onChange={(bd) => setBedData(bd)}
              disabled={loading}
            />
            {errors.bedId && (
              <div
                style={{
                  marginTop: 6,
                  color: "#ef4444",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  gap: 4,
                }}
              >
                <i className="pi pi-exclamation-circle" />
                {errors.bedId}
              </div>
            )}
          </div>
        )}

        {/* ── Companion + Appointment ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-users"
                style={{ fontSize: 13, color: "#0891b2" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                Companion Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
              }}
            >
              <div style={fs}>
                <label style={lbl}>Name</label>
                <InputText
                  value={formData.companionName}
                  onChange={(e) =>
                    handleChange("companionName", e.target.value)
                  }
                  placeholder="Name"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fs}>
                <label style={lbl}>Relationship</label>
                <Dropdown
                  value={formData.companionRelationship}
                  options={RELS}
                  onChange={(e) =>
                    handleChange("companionRelationship", e.value)
                  }
                  placeholder="Relation"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fs}>
                <label style={lbl}>
                  Contact{formData.companionRelationship && " *"}
                </label>
                <InputText
                  value={formData.companionContact}
                  onChange={(e) =>
                    handleChange("companionContact", e.target.value)
                  }
                  placeholder="Mobile"
                  maxLength={10}
                  className={errors.companionContact ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {err("companionContact")}
              </div>
            </div>
          </div>
          <div style={cs}>
            <div style={sh}>
              <i
                className="pi pi-calendar-plus"
                style={{ fontSize: 13, color: "#0891b2" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                Appointment Details
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <Checkbox
                inputId="appt"
                checked={formData.hasAppointment}
                onChange={(e) => handleChange("hasAppointment", e.checked)}
              />
              <label htmlFor="appt" style={{ fontSize: 13, fontWeight: 600 }}>
                Has Prior Appointment
              </label>
            </div>
            {formData.hasAppointment && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div style={fs}>
                  <label style={lbl}>Date *</label>
                  <Calendar
                    value={formData.appointmentDate}
                    onChange={(e) => handleChange("appointmentDate", e.value)}
                    dateFormat="dd/mm/yy"
                    showIcon
                    placeholder="Date"
                    className={errors.appointmentDate ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {err("appointmentDate")}
                </div>
                <div style={fs}>
                  <label style={lbl}>Time *</label>
                  <Calendar
                    value={formData.appointmentTime}
                    onChange={(e) => handleChange("appointmentTime", e.value)}
                    timeOnly
                    showIcon
                    placeholder="Time"
                    className={errors.appointmentTime ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {err("appointmentTime")}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Submit ── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            paddingBottom: 14,
          }}
        >
          <Button
            label="Cancel"
            icon="pi pi-times"
            severity="secondary"
            type="button"
            onClick={() => navigate("/allpatient")}
            outlined
            size="small"
          />
          <Button
            type="submit"
            loading={loading}
            disabled={loading}
            icon={loading ? "pi pi-spin pi-spinner" : "pi pi-check"}
            size="small"
            label={
              loading
                ? "Processing…"
                : existing
                  ? NEEDS_BED(formData.registrationType)
                    ? `Admit Patient (${existing.UHID})`
                    : `New Visit — ${existing.UHID}`
                  : editMode
                    ? "Update Patient"
                    : NEEDS_BED(formData.registrationType)
                      ? "Register & Book Bed"
                      : "Register Patient"
            }
            style={{
              background: loading ? undefined : ac,
              border: "none",
              fontWeight: 700,
              boxShadow: loading ? undefined : `0 4px 14px ${ac}40`,
            }}
          />
        </div>
      </form>

      {/* ── Patient History Modal ── */}
      {existing && (
        <PatientHistoryModal
          patientId={existing._id}
          visible={historyModal}
          onHide={() => setHistoryModal(false)}
        />
      )}
    </div>
      </>
  );
}
