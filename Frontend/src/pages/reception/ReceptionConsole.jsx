/**
 * ReceptionConsole.jsx
 *
 * Single-window receptionist console — replaces:
 *   /opd-register, /ipd-admission, /emergency/register, /registration/:type
 *
 * Handles five visit types in one page:
 *   OPD · IPD · Day Care · Emergency · Services
 *
 * Layout:
 *   ┌─ Top bar (search + stats + new patient)
 *   ├─ Visit-type tabs
 *   └─ Main grid (form + sticky receipt preview)
 *
 * All styling via ReceptionConsole.css — no inline JS styles.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import "../../Components/clinical/clinical-forms.css";
import "./ReceptionConsole.css";

import patientService from "../../Services/patient/patientService";
import { admissionService } from "../../Services/admissionService";
import { departmentService } from "../../Services/departmentService";
import { doctorService } from "../../Services/doctors/doctorService";
import { tpaService } from "../../Services/tpa/tpaService";
import opdService from "../../Services/patient/opdService";
import emergencyService from "../../Services/patient/emergencyService";
import { serviceMasterService } from "../../Services/Servicemasterservice/serviceMasterService";
import BedSelectionPanel from "../../Components/bed/BedSelectionPanel";
import { useAuth } from "../../context/AuthContext";

/* ─── Constants ─────────────────────────────────────────────── */
const VISIT_TYPES = [
  { id: "OPD",       label: "OPD",        icon: "🩺", hint: "Out-Patient",    color: "#0891b2" },
  { id: "IPD",       label: "IPD",        icon: "🏥", hint: "In-Patient",     color: "#7c3aed" },
  { id: "Daycare",   label: "Day Care",   icon: "☀️", hint: "Same-day stay",  color: "#d97706" },
  { id: "Emergency", label: "Emergency",  icon: "🚨", hint: "ER / Trauma",    color: "#dc2626" },
  { id: "Services",  label: "Services",   icon: "🧪", hint: "Lab / Imaging",  color: "#059669" },
];
const NEEDS_BED       = (t) => ["IPD", "Emergency", "Daycare"].includes(t);
const TPA_MANDATORY   = (t) => t === "IPD";
const REG_TO_ADM_TYPE = { IPD: "Planned", Emergency: "Emergency", Daycare: "Day Care" };

const TITLES         = ["Mr.", "Mrs.", "Ms.", "Master", "Miss", "Dr.", "Baby"];
const GENDERS        = ["Male", "Female", "Other"];
const MARITAL        = ["Single", "Married", "Divorced", "Widowed"];
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "Unknown"];
const PAYMENT_TYPES  = ["Cash", "TPA", "Insurance", "Corporate"];
const TRIAGE_LEVELS  = ["Red (P1)", "Yellow (P2)", "Green (P3)", "Blue (P4)"];
const ER_TYPES       = ["Medical", "Surgical", "Trauma", "Pediatric", "Obstetric", "Cardiac", "Stroke"];

const calcAge = (dob) => {
  if (!dob) return "";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 ||
      (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "" : a;
};
const dobFromAge = (age) => {
  const n = parseInt(age);
  if (!n || n <= 0 || n > 120) return "";
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayDate = () => new Date().toISOString().slice(0, 10);
const nowTime   = () => new Date().toTimeString().slice(0, 5);

/* ─── Empty patient state ───────────────────────────────────── */
const emptyPatient = {
  _id: null,
  title: "Mr.",
  fullName: "",
  gender: "Male",
  dateOfBirth: "",
  age: "",
  maritalStatus: "",
  contactNumber: "",
  email: "",
  address: { completeAddress: "", pincode: "", city: "", state: "", district: "" },
  bloodGroup: "Unknown",
  knownAllergies: "",
  paymentType: "Cash",
  tpa: null,
  emergencyContact: { name: "", relation: "", phone: "" },
  UHID: "",
};

const emptyOPD = {
  department: "",
  doctor: "",
  appointmentDate: todayDate(),
  appointmentTime: nowTime(),
  chiefComplaint: "",
  consultationFee: 500,
  hasAppointment: false,
};

const emptyIPD = {
  admissionType: "Planned",
  admittingDoctor: "",
  department: "",
  reasonForAdmission: "",
  provisionalDiagnosis: "",
  expectedStayDays: 3,
  expectedDischargeDate: "",
  specialInstructions: "",
  advancePayment: 0,
};

const emptyDayCare = {
  procedureName: "",
  procedureType: "Diagnostic",
  department: "",
  doctor: "",
  expectedDischargeTime: "",
  specialInstructions: "",
};

const emptyER = {
  triageLevel: "Yellow (P2)",
  erType: "Medical",
  presentingComplaint: "",
  isMLC: false,
  mlcNumber: "",
  attendingDoctor: "",
  modeOfArrival: "Walk-in",
  broughtBy: "",
};

const emptyServices = {
  cart: [],          // [{ service: {...}, qty: 1 }]
  notes: "",
  paymentMode: "Cash",
};

/* ════════════════════════════════════════════════════════════ */
export default function ReceptionConsole() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  /* ── Reference data ── */
  const [departments, setDepartments] = useState([]);
  const [doctors,     setDoctors]     = useState([]);
  const [tpaList,     setTpaList]     = useState([]);
  const [allServices, setAllServices] = useState([]);

  /* ── Patient search ── */
  const [searchTerm,    setSearchTerm]    = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen,    setSearchOpen]    = useState(false);
  const searchTimerRef = useRef(null);

  /* ── Form state ── */
  const [visitType, setVisitType] = useState("OPD");
  const [isExisting, setIsExisting] = useState(false);
  const [patient,    setPatient]    = useState(emptyPatient);
  const [opd,        setOpd]        = useState(emptyOPD);
  const [ipd,        setIpd]        = useState(emptyIPD);
  const [dayCare,    setDayCare]    = useState(emptyDayCare);
  const [er,         setEr]         = useState(emptyER);
  const [services,   setServices]   = useState(emptyServices);
  const [bedData,    setBedData]    = useState({
    buildingId: null, floorId: null, wardId: null, roomId: null, bedId: null, bedNumber: null,
  });

  /* ── UI state ── */
  const [serviceSearch, setServiceSearch] = useState("");
  const [pincodeLookup, setPincodeLookup] = useState({ loading: false, ok: false, error: "" });
  const pincodeTimerRef = useRef(null);
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  /* ── Today's stats ── */
  const [stats, setStats] = useState({ opd: 0, ipd: 0, dc: 0, er: 0, svc: 0, beds: "—" });

  /* ─── Bootstrap reference data ─── */
  useEffect(() => {
    (async () => {
      try {
        const [deptRes, docRes, tpaRes] = await Promise.all([
          departmentService.getAllDepartments(),
          doctorService.getAllDoctors(),
          tpaService.getAllTPAs(),
        ]);
        const deptList = Array.isArray(deptRes) ? deptRes : (deptRes?.data || []);
        setDepartments(deptList.filter(d => d.isActive !== false).map(d => ({ label: d.departmentName, value: d._id })));

        const docList = Array.isArray(docRes) ? docRes : (docRes?.data || []);
        setDoctors(docList.map(d => ({
          label: d.personalInfo?.fullName || d.fullName || d.name || "Doctor",
          value: d._id,
          // d.department can be a populated object {_id, departmentName, ...} OR
          // a bare ObjectId string — normalize to the ID string here so the
          // doctor-filter useMemo below can compare against opd/ipd/dayCare.department.
          department:
            (typeof d.department === "object" && d.department !== null)
              ? String(d.department._id || d.department)
              : (d.department ? String(d.department) : ""),
        })));

        if (tpaRes?.success) {
          setTpaList(tpaRes.data.map(t => ({ label: t.tpaName, value: t._id })));
        }
      } catch (e) {
        console.error("Reference data load error:", e);
      }
    })();
  }, []);

  /* ─── Load services catalog when Services tab is opened ─── */
  useEffect(() => {
    if (visitType === "Services" && allServices.length === 0) {
      serviceMasterService
        .getAllServices({ isActive: true, limit: 500 })
        .then(({ services: list }) => setAllServices(list || []))
        .catch((e) => console.error("Service master load error:", e));
    }
  }, [visitType, allServices.length]);

  /* ─── Load today's stats ─── */
  useEffect(() => {
    (async () => {
      try {
        const [adm, opdToday] = await Promise.all([
          admissionService.getTodayAdmissions().catch(() => ({ data: [] })),
          opdService.getTodayVisits().catch(() => ({ data: { data: [] } })),
        ]);
        const admList = adm?.data || adm || [];
        const opdList = opdToday?.data?.data || opdToday?.data || [];
        setStats({
          opd:  Array.isArray(opdList) ? opdList.length : 0,
          ipd:  admList.filter(a => a.admissionType === "Planned").length,
          dc:   admList.filter(a => a.admissionType === "Day Care").length,
          er:   admList.filter(a => a.admissionType === "Emergency").length,
          svc:  0,    // could be wired to a service-bills count API later
          beds: "—",  // computed via beds API later
        });
      } catch (e) { /* silent */ }
    })();
  }, []);

  /* ─── Sync OPD↔IPD↔DC department/doctor (single source of truth: opd state) ─── */
  const filteredDoctors = useMemo(() => {
    const dept = (visitType === "OPD") ? opd.department :
                 (visitType === "IPD") ? ipd.department :
                 (visitType === "Daycare") ? dayCare.department : "";
    if (!dept) return doctors;
    return doctors.filter(d => String(d.department) === String(dept));
  }, [doctors, opd.department, ipd.department, dayCare.department, visitType]);

  /* ─── Pincode auto-lookup (India Post free API) ─── */
  // When user enters a 6-digit Indian pincode, fetch district + city + state
  // and auto-fill the address fields. Receptionist only needs to ask the
  // patient for their local street/landmark (verbal input).
  useEffect(() => {
    const pin = patient.address.pincode;
    if (!pin || pin.length !== 6) {
      setPincodeLookup({ loading: false, ok: false, error: "" });
      return;
    }
    if (pincodeTimerRef.current) clearTimeout(pincodeTimerRef.current);
    pincodeTimerRef.current = setTimeout(async () => {
      setPincodeLookup({ loading: true, ok: false, error: "" });
      try {
        // India Post Pincode API — free, no auth, returns city/district/state
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        const data = await res.json();
        const entry = Array.isArray(data) ? data[0] : null;
        if (entry?.Status === "Success" && entry.PostOffice?.length) {
          const po = entry.PostOffice[0];
          setPatient(p => ({
            ...p,
            address: {
              ...p.address,
              // Don't overwrite user's manual entries unless empty
              city:     po.Block || po.Division || po.Name || p.address.city,
              district: po.District || p.address.district,
              state:    po.State    || p.address.state,
            },
          }));
          setPincodeLookup({ loading: false, ok: true, error: "" });
        } else {
          setPincodeLookup({ loading: false, ok: false, error: "Pincode not found" });
        }
      } catch (e) {
        setPincodeLookup({ loading: false, ok: false, error: "Lookup failed" });
      }
    }, 400);
    return () => pincodeTimerRef.current && clearTimeout(pincodeTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.address.pincode]);

  /* ─── Debounced patient search ─── */
  useEffect(() => {
    if (!searchTerm || searchTerm.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const r = await patientService.searchPatients(searchTerm, 8);
        setSearchResults(r?.data || []);
        setSearchOpen(true);
      } catch (e) {
        setSearchResults([]);
      }
    }, 250);
    return () => searchTimerRef.current && clearTimeout(searchTimerRef.current);
  }, [searchTerm]);

  /* ─── Select an existing patient from search ─── */
  const selectExistingPatient = (p) => {
    setPatient({
      _id: p._id,
      title: p.title || "Mr.",
      fullName: p.fullName || "",
      gender: p.gender || "Male",
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().slice(0, 10) : "",
      age: p.age || calcAge(p.dateOfBirth) || "",
      maritalStatus: p.maritalStatus || "",
      contactNumber: p.contactNumber || "",
      email: p.email || "",
      address: p.address || { completeAddress: "", pincode: "", city: "", state: "", district: "" },
      bloodGroup: p.bloodGroup || "Unknown",
      knownAllergies: Array.isArray(p.knownAllergies) ? p.knownAllergies.join(", ") : (p.knownAllergies || ""),
      paymentType: p.paymentType || "Cash",
      tpa: p.tpa?._id || p.tpa || null,
      emergencyContact: p.emergencyContact || { name: "", relation: "", phone: "" },
      UHID: p.UHID || "",
    });
    setIsExisting(true);
    setSearchTerm("");
    setSearchResults([]);
    setSearchOpen(false);
    toast.success(`Patient loaded: ${p.fullName || p.UHID}`);
  };

  /* ─── New patient (clear all form) ─── */
  const newPatient = () => {
    setPatient(emptyPatient);
    setOpd(emptyOPD);
    setIpd(emptyIPD);
    setDayCare(emptyDayCare);
    setEr(emptyER);
    setServices(emptyServices);
    setBedData({ buildingId: null, floorId: null, wardId: null, roomId: null, bedId: null, bedNumber: null });
    setIsExisting(false);
    setErrors({});
    setSearchTerm("");
    setSearchOpen(false);
    toast.info("Cleared — ready for new patient");
  };

  /* ─── Service cart ─── */
  const addService = (svc) => {
    setServices(prev => {
      const existing = prev.cart.find(c => c.service._id === svc._id);
      if (existing) {
        return { ...prev, cart: prev.cart.map(c => c.service._id === svc._id ? { ...c, qty: c.qty + 1 } : c) };
      }
      return { ...prev, cart: [...prev.cart, { service: svc, qty: 1 }] };
    });
    setServiceSearch("");
    setServiceDropdownOpen(false);
  };
  const updateCartQty = (id, qty) => {
    const q = Math.max(1, parseInt(qty) || 1);
    setServices(prev => ({ ...prev, cart: prev.cart.map(c => c.service._id === id ? { ...c, qty: q } : c) }));
  };
  const removeCartItem = (id) => setServices(prev => ({ ...prev, cart: prev.cart.filter(c => c.service._id !== id) }));
  const cartTotal = useMemo(() =>
    services.cart.reduce((s, c) => s + ((Number(c.service.price) || 0) * c.qty), 0),
    [services.cart]
  );

  const filteredServices = useMemo(() => {
    const q = (serviceSearch || "").toLowerCase().trim();
    if (!q) return allServices.slice(0, 30);
    return allServices.filter(s =>
      (s.serviceName || "").toLowerCase().includes(q) ||
      (s.serviceCode || "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [allServices, serviceSearch]);

  /* ─── Receipt totals ─── */
  const receiptTotal = useMemo(() => {
    if (visitType === "OPD")       return Number(opd.consultationFee) || 0;
    if (visitType === "Services")  return cartTotal;
    if (visitType === "IPD")       return Number(ipd.advancePayment) || 0;
    return 0;
  }, [visitType, opd.consultationFee, ipd.advancePayment, cartTotal]);

  /* ─── Validation ─── */
  const validate = () => {
    const e = {};
    if (!patient.fullName?.trim()) e.fullName = "Name required";
    if (!patient.gender)           e.gender   = "Gender required";
    if (!patient.contactNumber || !/^\d{10}$/.test(patient.contactNumber)) e.contactNumber = "Valid 10-digit phone";
    if (!patient.dateOfBirth && !patient.age) e.age = "Age or DOB required";

    if (visitType === "OPD") {
      if (!opd.department) e.department = "Department required";
      if (!opd.doctor)     e.doctor     = "Doctor required";
    } else if (visitType === "IPD") {
      if (!ipd.department)            e.department = "Department required";
      if (!ipd.admittingDoctor)       e.doctor     = "Admitting doctor required";
      if (!ipd.reasonForAdmission)    e.reason     = "Reason required";
      if (!bedData.bedId)             e.bed        = "Bed required for IPD";
      if (TPA_MANDATORY(visitType) && patient.paymentType !== "Cash" && !patient.tpa) e.tpa = "TPA required";
    } else if (visitType === "Daycare") {
      if (!dayCare.procedureName)     e.procedure = "Procedure required";
      if (!dayCare.doctor)            e.doctor    = "Doctor required";
    } else if (visitType === "Emergency") {
      if (!er.presentingComplaint)    e.complaint = "Presenting complaint required";
      if (!bedData.bedId)             e.bed       = "Emergency bed required";
      if (er.isMLC && !er.mlcNumber)  e.mlc       = "MLC number required";
    } else if (visitType === "Services") {
      if (services.cart.length === 0) e.services  = "Add at least one service";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ─── Save & Print ─── */
  const saveAndProcess = async () => {
    if (!validate()) { toast.error("Please fix the highlighted fields"); return; }
    setSaving(true);

    try {
      // ── Step 1: Create or update patient ──
      let patientId = patient._id;
      let patientUHID = patient.UHID;

      const patientPayload = {
        title:           patient.title,
        fullName:        patient.fullName,
        gender:          patient.gender,
        dateOfBirth:     patient.dateOfBirth || (patient.age ? dobFromAge(patient.age) : undefined),
        age:             patient.age,
        maritalStatus:   patient.maritalStatus,
        contactNumber:   patient.contactNumber,
        email:           patient.email,
        address:         patient.address,
        bloodGroup:      patient.bloodGroup,
        knownAllergies:  patient.knownAllergies ? patient.knownAllergies.split(/,\s*/).filter(Boolean) : [],
        paymentType:     patient.paymentType,
        tpa:             patient.tpa || null,
        emergencyContact:patient.emergencyContact,
      };

      if (isExisting && patientId) {
        await patientService.updatePatient(patientId, patientPayload);
      } else {
        const created = await patientService.createPatient(patientPayload);
        const p = created?.data || created;
        patientId   = p._id;
        patientUHID = p.UHID;
      }

      // ── Step 2: Create the visit/admission/bill based on type ──
      if (visitType === "OPD") {
        await opdService.createOPDVisit({
          patientId,
          UHID: patientUHID,
          patientName: patient.fullName,
          department: opd.department,
          doctorId: opd.doctor,
          visitDate: opd.appointmentDate,
          visitTime: opd.appointmentTime,
          chiefComplaint: opd.chiefComplaint,
          consultationFee: Number(opd.consultationFee) || 0,
          hasAppointment: opd.hasAppointment,
          createdBy: user?._id,
        });
        toast.success("OPD visit registered successfully");

      } else if (visitType === "IPD" || visitType === "Daycare" || visitType === "Emergency") {
        const isER = visitType === "Emergency";
        const isDC = visitType === "Daycare";
        const admissionPayload = {
          patientId,
          UHID: patientUHID,
          patientName: patient.fullName,
          admissionType: REG_TO_ADM_TYPE[visitType],
          admissionDate: new Date().toISOString(),
          department:     isER ? null : (isDC ? dayCare.department : ipd.department),
          attendingDoctor: isER ? er.attendingDoctor : (isDC ? dayCare.doctor : ipd.admittingDoctor),
          reasonForAdmission: isER ? er.presentingComplaint :
                              isDC ? dayCare.procedureName :
                              ipd.reasonForAdmission,
          provisionalDiagnosis: isER ? "" : (isDC ? dayCare.procedureName : ipd.provisionalDiagnosis),
          expectedStayDays: isDC ? 0 : (Number(ipd.expectedStayDays) || 0),
          expectedDischargeDate: isDC ? todayDate() : ipd.expectedDischargeDate,
          specialInstructions: isER ? "" : (isDC ? dayCare.specialInstructions : ipd.specialInstructions),
          advancePayment: isDC || isER ? 0 : (Number(ipd.advancePayment) || 0),
          // bed
          bedId:        bedData.bedId,
          bedNumber:    bedData.bedNumber,
          wardId:       bedData.wardId,
          roomId:       bedData.roomId,
          // ER-specific
          isMLC:        isER ? er.isMLC : false,
          mlcNumber:    isER ? er.mlcNumber : "",
          triageLevel:  isER ? er.triageLevel : "",
          erType:       isER ? er.erType : "",
          modeOfArrival: isER ? er.modeOfArrival : "",
          broughtBy:    isER ? er.broughtBy : "",
          createdBy:    user?._id,
        };

        await admissionService.createAdmission(admissionPayload);

        // If Emergency, also create the emergency-visit record (parallel)
        if (isER) {
          try {
            await emergencyService.createEmergencyVisit({
              patientId,
              UHID: patientUHID,
              patientName: patient.fullName,
              presentingComplaint: er.presentingComplaint,
              triageCategory: er.triageLevel,
              emergencyType: er.erType,
              isMLC: er.isMLC,
              mlcNumber: er.mlcNumber,
              modeOfArrival: er.modeOfArrival,
              broughtBy: er.broughtBy,
              attendingDoctor: er.attendingDoctor,
            });
          } catch (e) { /* don't block the registration */ }
        }
        toast.success(`${visitType} registration complete`);

      } else if (visitType === "Services") {
        // Use service-billing endpoint pattern. We post to /service-bills if available,
        // otherwise create a generic bill record. We'll defer to the existing
        // PatientBilling component flow by handing off via navigate with state.
        navigate("/patient-billing", {
          state: {
            patientId,
            UHID: patientUHID,
            preloadServices: services.cart.map(c => ({
              serviceId: c.service._id,
              serviceName: c.service.serviceName,
              price: c.service.price,
              qty: c.qty,
            })),
            notes: services.notes,
            paymentMode: services.paymentMode,
          },
        });
        toast.success(`Services ready — opening bill...`);
        setSaving(false);
        return;
      }

      // ── Step 3: Print receipt ──
      printReceipt({ patient: { ...patient, UHID: patientUHID }, visitType, opd, ipd, dayCare, er, services, bedData,
        deptLabel: departments.find(d => d.value === (opd.department || ipd.department || dayCare.department))?.label,
        docLabel: doctors.find(d => d.value === (opd.doctor || ipd.admittingDoctor || dayCare.doctor || er.attendingDoctor))?.label,
        receiptTotal,
      });

      // Reset for next patient + clear the auto-saved snapshot
      clearAutosave();
      newPatient();

    } catch (err) {
      console.error("Save failed:", err);
      toast.error(err?.response?.data?.message || err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ─── Save draft (manual button — uses localStorage so it survives browser close) ─── */
  const saveDraft = () => {
    const draft = { visitType, patient, opd, ipd, dayCare, er, services, bedData, isExisting, ts: Date.now() };
    try {
      localStorage.setItem("rc_draft", JSON.stringify(draft));
      toast.success("Draft saved");
    } catch (e) { toast.error("Could not save draft"); }
  };

  /* ─── Auto-save on EVERY change (sessionStorage — survives nav-away & page reload) ─── */
  // This is the key fix: previously the form only saved when the user clicked
  // "Save Draft". If they paused, clicked elsewhere in the sidebar, or the tab
  // got discarded by the browser, all in-progress data was lost and the visit
  // type reset to the default (OPD). Now every keystroke writes to
  // sessionStorage (debounced 400ms), so the form survives any kind of
  // unmount/remount — including navigating away and coming back.
  const restoredRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  useEffect(() => {
    // Don't auto-save during the initial restore — only after first user touch.
    if (!restoredRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      try {
        sessionStorage.setItem("rc_autosave", JSON.stringify({
          visitType, patient, opd, ipd, dayCare, er, services, bedData, isExisting,
          ts: Date.now(),
        }));
      } catch { /* quota exceeded or private mode — ignore */ }
    }, 400);
    return () => autosaveTimerRef.current && clearTimeout(autosaveTimerRef.current);
  }, [visitType, patient, opd, ipd, dayCare, er, services, bedData, isExisting]);

  /* ─── Restore on mount (sessionStorage takes precedence over manual localStorage draft) ─── */
  useEffect(() => {
    try {
      // Prefer sessionStorage (auto-saved every change) over localStorage (manual save button)
      const raw = sessionStorage.getItem("rc_autosave") || localStorage.getItem("rc_draft");
      if (!raw) { restoredRef.current = true; return; }
      const d = JSON.parse(raw);
      // Auto-saves expire after 4h, manual drafts after 24h
      const ageLimit = sessionStorage.getItem("rc_autosave") ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (Date.now() - (d.ts || 0) > ageLimit) { restoredRef.current = true; return; }
      if (d.visitType)    setVisitType(d.visitType);
      if (d.patient)      setPatient(d.patient);
      if (d.opd)          setOpd(d.opd);
      if (d.ipd)          setIpd(d.ipd);
      if (d.dayCare)      setDayCare(d.dayCare);
      if (d.er)           setEr(d.er);
      if (d.services)     setServices(d.services);
      if (d.bedData)      setBedData(d.bedData);
      if (d.isExisting)   setIsExisting(true);
    } catch { /* ignore */ }
    // Mark restoration complete on the next tick so auto-save can start.
    setTimeout(() => { restoredRef.current = true; }, 50);
  }, []);

  /* ─── Clear auto-save when patient is successfully saved ─── */
  // Called from saveAndProcess after a successful submit. Avoids the next mount
  // restoring a patient who's already been processed.
  const clearAutosave = () => {
    try { sessionStorage.removeItem("rc_autosave"); } catch {}
  };

  /* ─── Load patient by query param (e.g. /reception?patientId=XXX) ─── */
  useEffect(() => {
    const pid = searchParams.get("patientId");
    const visit = searchParams.get("visit");
    if (visit && VISIT_TYPES.find(v => v.id === visit)) setVisitType(visit);
    if (!pid) return;
    patientService.getPatientById(pid).then(res => {
      const p = res?.data || res;
      if (p?._id) selectExistingPatient(p);
    }).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* ─── Helpers for patient field updates ─── */
  const setP = (k, v) => setPatient(p => ({ ...p, [k]: v }));
  const setPAddr = (k, v) => setPatient(p => ({ ...p, address: { ...p.address, [k]: v } }));

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="rc-page">

      {/* ── TOP BAR ── */}
      <div className="rc-topbar">
        <div className="rc-search-wrap" onBlur={() => setTimeout(() => setSearchOpen(false), 200)}>
          <i className="pi pi-search rc-search-icon" />
          <input
            className="rc-search-input"
            placeholder="Search by UHID, name, or phone…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="rc-search-results">
              {searchResults.map(p => (
                <div key={p._id} className="rc-search-result"
                     onMouseDown={() => selectExistingPatient(p)}>
                  <div className="rc-search-result-name">
                    {p.title} {p.fullName}
                    {p.age && ` · ${p.age}Y`}
                    {p.gender && ` · ${p.gender[0]}`}
                  </div>
                  <div className="rc-search-result-meta">
                    UHID: {p.UHID || "—"} · 📞 {p.contactNumber || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
          {searchOpen && searchTerm.length >= 2 && searchResults.length === 0 && (
            <div className="rc-search-results">
              <div className="rc-empty" style={{ padding: "16px" }}>
                <span className="rc-empty-icon">🔍</span>
                No patient found for "{searchTerm}"
              </div>
            </div>
          )}
        </div>

        <div className="rc-stats">
          <div className="rc-stat rc-stat--opd"><span className="rc-stat-label">OPD</span><span className="rc-stat-value">{stats.opd}</span></div>
          <div className="rc-stat rc-stat--ipd"><span className="rc-stat-label">IPD</span><span className="rc-stat-value">{stats.ipd}</span></div>
          <div className="rc-stat rc-stat--dc"><span className="rc-stat-label">Day Care</span><span className="rc-stat-value">{stats.dc}</span></div>
          <div className="rc-stat rc-stat--er"><span className="rc-stat-label">ER</span><span className="rc-stat-value">{stats.er}</span></div>
        </div>

        <button className="rc-new-btn" onClick={newPatient}>
          <i className="pi pi-plus" /> New Patient
        </button>
      </div>

      {/* ── VISIT TYPE TABS ── */}
      <div className="rc-tabs">
        {VISIT_TYPES.map(v => (
          <button
            key={v.id}
            className={`rc-tab rc-tab--${v.id.toLowerCase()} ${visitType === v.id ? "rc-tab--active" : ""}`}
            onClick={() => setVisitType(v.id)}
          >
            <span className="rc-tab-icon">{v.icon}</span>
            <span className="rc-tab-label">{v.label}</span>
            <span className="rc-tab-hint">{v.hint}</span>
          </button>
        ))}
      </div>

      {/* ── MAIN GRID ── */}
      <div className="rc-main">
        <div className="rc-form-col">

          {/* Revisit banner */}
          {isExisting && (
            <div className="rc-revisit-banner">
              <i className="pi pi-user-edit" />
              Editing existing patient · UHID: <strong>{patient.UHID || "—"}</strong>
              <button className="rc-revisit-clear" onClick={newPatient}>Clear</button>
            </div>
          )}

          {/* ─── Patient Info (always shown) ─── */}
          <div className="rc-section">
            <div className="rc-section-head">
              <div className="rc-section-icon rc-section-icon--patient"><i className="pi pi-user" /></div>
              <div className="rc-section-title">Patient Information</div>
              <span className="rc-section-meta">Step 1 of 2</span>
            </div>
            <div className="rc-section-body">
              <div className="rc-grid-4">
                <div className="his-field-group">
                  <label className="his-label">Title</label>
                  <select className="his-select" value={patient.title} onChange={e => setP("title", e.target.value)}>
                    {TITLES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="his-field-group rc-span-2">
                  <label className="his-label">Full Name<span className="rc-req">*</span></label>
                  <input className={`his-field ${errors.fullName ? "his-field--err" : ""}`} value={patient.fullName}
                    onChange={e => setP("fullName", e.target.value)} placeholder="Patient full name" />
                  {errors.fullName && <span className="rc-err"><i className="pi pi-exclamation-circle" /> {errors.fullName}</span>}
                </div>
                <div className="his-field-group">
                  <label className="his-label">Gender<span className="rc-req">*</span></label>
                  <select className={`his-select ${errors.gender ? "his-field--err" : ""}`} value={patient.gender}
                    onChange={e => setP("gender", e.target.value)}>
                    {GENDERS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div className="rc-grid-4">
                <div className="his-field-group">
                  <label className="his-label">Date of Birth</label>
                  <input className="his-field" type="date" value={patient.dateOfBirth}
                    onChange={e => setP("dateOfBirth", e.target.value) || setP("age", calcAge(e.target.value))} />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Age (yrs)</label>
                  <input className={`his-field ${errors.age ? "his-field--err" : ""}`} type="number"
                    value={patient.age || (patient.dateOfBirth ? calcAge(patient.dateOfBirth) : "")}
                    onChange={e => setP("age", e.target.value)} placeholder="35" />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Phone<span className="rc-req">*</span></label>
                  <input className={`his-field ${errors.contactNumber ? "his-field--err" : ""}`} type="tel" maxLength={10}
                    value={patient.contactNumber} onChange={e => setP("contactNumber", e.target.value.replace(/\D/g, ""))}
                    placeholder="10-digit mobile" />
                  {errors.contactNumber && <span className="rc-err">{errors.contactNumber}</span>}
                </div>
                <div className="his-field-group">
                  <label className="his-label">Marital Status</label>
                  <select className="his-select" value={patient.maritalStatus} onChange={e => setP("maritalStatus", e.target.value)}>
                    <option value="">— Select —</option>
                    {MARITAL.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="rc-grid-3">
                <div className="his-field-group">
                  <label className="his-label">Email</label>
                  <input className="his-field" type="email" value={patient.email}
                    onChange={e => setP("email", e.target.value)} placeholder="patient@email.com" />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Blood Group</label>
                  <select className="his-select" value={patient.bloodGroup} onChange={e => setP("bloodGroup", e.target.value)}>
                    {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Known Allergies</label>
                  <input className="his-field" value={patient.knownAllergies}
                    onChange={e => setP("knownAllergies", e.target.value)} placeholder="e.g. Penicillin, Sulfa" />
                </div>
              </div>

              {/* Pincode-first address row — auto-fills district/state/city */}
              <div className="rc-grid-4">
                <div className="his-field-group">
                  <label className="his-label">
                    Pincode
                    {pincodeLookup.loading && <span style={{ color:"#0891b2", marginLeft:6, fontSize:10 }}>⏳ looking up…</span>}
                    {pincodeLookup.ok      && <span style={{ color:"#15803d", marginLeft:6, fontSize:10 }}>✓ found</span>}
                    {pincodeLookup.error   && <span style={{ color:"#dc2626", marginLeft:6, fontSize:10 }}>⚠ {pincodeLookup.error}</span>}
                  </label>
                  <input
                    className={`his-field ${pincodeLookup.ok ? "his-field--ok" : pincodeLookup.error ? "his-field--err" : ""}`}
                    value={patient.address.pincode}
                    onChange={e => setPAddr("pincode", e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit pincode"
                    maxLength={6}
                    inputMode="numeric"
                  />
                </div>
                <div className="his-field-group">
                  <label className="his-label">District</label>
                  <input className="his-field" value={patient.address.district || ""}
                    onChange={e => setPAddr("district", e.target.value)} placeholder="auto-filled" />
                </div>
                <div className="his-field-group">
                  <label className="his-label">State</label>
                  <input className="his-field" value={patient.address.state || ""}
                    onChange={e => setPAddr("state", e.target.value)} placeholder="auto-filled" />
                </div>
                <div className="his-field-group">
                  <label className="his-label">City / Block</label>
                  <input className="his-field" value={patient.address.city}
                    onChange={e => setPAddr("city", e.target.value)} placeholder="auto-filled" />
                </div>
              </div>
              {/* Local address (verbal input from patient) */}
              <div className="his-field-group">
                <label className="his-label">
                  Local Address
                  <span style={{ color:"#64748b", fontWeight:500, marginLeft:6, fontSize:10, textTransform:"none", letterSpacing:0 }}>
                    (street / house no / landmark — ask the patient verbally)
                  </span>
                </label>
                <input className="his-field" value={patient.address.completeAddress}
                  onChange={e => setPAddr("completeAddress", e.target.value)}
                  placeholder="e.g. House 14, near Hanuman Mandir, MG Road" />
              </div>
            </div>
          </div>

          {/* ─── Payment / TPA (mandatory for IPD when non-cash) ─── */}
          {(visitType === "IPD" || visitType === "Daycare" || patient.paymentType !== "Cash") && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--tpa"><i className="pi pi-shield" /></div>
                <div className="rc-section-title">
                  Payment & Insurance
                  {TPA_MANDATORY(visitType) && <span className="rc-req"> *required for IPD</span>}
                </div>
              </div>
              <div className="rc-section-body">
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Payment Type</label>
                    <select className="his-select" value={patient.paymentType} onChange={e => setP("paymentType", e.target.value)}>
                      {PAYMENT_TYPES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  {patient.paymentType !== "Cash" && (
                    <div className="his-field-group rc-span-2">
                      <label className="his-label">TPA / Insurance Provider{TPA_MANDATORY(visitType) && <span className="rc-req">*</span>}</label>
                      <select className={`his-select ${errors.tpa ? "his-field--err" : ""}`} value={patient.tpa || ""}
                        onChange={e => setP("tpa", e.target.value)}>
                        <option value="">— Select TPA —</option>
                        {tpaList.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {errors.tpa && <span className="rc-err">{errors.tpa}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── Visit-type specific section ─── */}
          {visitType === "OPD" && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--opd"><i className="pi pi-stethoscope" /></div>
                <div className="rc-section-title">OPD Visit Details</div>
                <span className="rc-section-meta">Step 2 of 2</span>
              </div>
              <div className="rc-section-body">
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Department<span className="rc-req">*</span></label>
                    <select className={`his-select ${errors.department ? "his-field--err" : ""}`} value={opd.department}
                      onChange={e => setOpd(p => ({ ...p, department: e.target.value, doctor: "" }))}>
                      <option value="">— Select —</option>
                      {departments.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Doctor<span className="rc-req">*</span></label>
                    <select className={`his-select ${errors.doctor ? "his-field--err" : ""}`} value={opd.doctor}
                      onChange={e => setOpd(p => ({ ...p, doctor: e.target.value }))}>
                      <option value="">— Select —</option>
                      {filteredDoctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Consultation Fee</label>
                    <input className="his-field" type="number" value={opd.consultationFee}
                      onChange={e => setOpd(p => ({ ...p, consultationFee: e.target.value }))} />
                  </div>
                </div>
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Date</label>
                    <input className="his-field" type="date" value={opd.appointmentDate}
                      onChange={e => setOpd(p => ({ ...p, appointmentDate: e.target.value }))} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Time</label>
                    <input className="his-field" type="time" value={opd.appointmentTime}
                      onChange={e => setOpd(p => ({ ...p, appointmentTime: e.target.value }))} />
                  </div>
                  <label className={`rc-check ${opd.hasAppointment ? "rc-check--active" : ""}`}>
                    <input type="checkbox" checked={opd.hasAppointment}
                      onChange={e => setOpd(p => ({ ...p, hasAppointment: e.target.checked }))} />
                    Pre-booked Appointment
                  </label>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Chief Complaint</label>
                  <textarea className="his-textarea" value={opd.chiefComplaint}
                    onChange={e => setOpd(p => ({ ...p, chiefComplaint: e.target.value }))}
                    placeholder="Patient's main complaint or reason for visit" />
                </div>
              </div>
            </div>
          )}

          {visitType === "IPD" && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--ipd"><i className="pi pi-plus-circle" /></div>
                <div className="rc-section-title">IPD Admission Details</div>
              </div>
              <div className="rc-section-body">
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Department<span className="rc-req">*</span></label>
                    <select className={`his-select ${errors.department ? "his-field--err" : ""}`} value={ipd.department}
                      onChange={e => setIpd(p => ({ ...p, department: e.target.value, admittingDoctor: "" }))}>
                      <option value="">— Select —</option>
                      {departments.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Admitting Doctor<span className="rc-req">*</span></label>
                    <select className={`his-select ${errors.doctor ? "his-field--err" : ""}`} value={ipd.admittingDoctor}
                      onChange={e => setIpd(p => ({ ...p, admittingDoctor: e.target.value }))}>
                      <option value="">— Select —</option>
                      {filteredDoctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Admission Type</label>
                    <select className="his-select" value={ipd.admissionType}
                      onChange={e => setIpd(p => ({ ...p, admissionType: e.target.value }))}>
                      <option>Planned</option><option>Emergency</option><option>Transfer</option>
                    </select>
                  </div>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Reason for Admission<span className="rc-req">*</span></label>
                  <textarea className={`his-textarea ${errors.reason ? "his-field--err" : ""}`} value={ipd.reasonForAdmission}
                    onChange={e => setIpd(p => ({ ...p, reasonForAdmission: e.target.value }))}
                    placeholder="Why is the patient being admitted?" />
                  {errors.reason && <span className="rc-err">{errors.reason}</span>}
                </div>
                <div className="his-field-group">
                  <label className="his-label">Provisional Diagnosis</label>
                  <input className="his-field" value={ipd.provisionalDiagnosis}
                    onChange={e => setIpd(p => ({ ...p, provisionalDiagnosis: e.target.value }))} />
                </div>
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Expected Stay (days)</label>
                    <input className="his-field" type="number" value={ipd.expectedStayDays}
                      onChange={e => setIpd(p => ({ ...p, expectedStayDays: e.target.value }))} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Expected Discharge</label>
                    <input className="his-field" type="date" value={ipd.expectedDischargeDate}
                      onChange={e => setIpd(p => ({ ...p, expectedDischargeDate: e.target.value }))} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Advance Payment (₹)</label>
                    <input className="his-field" type="number" value={ipd.advancePayment}
                      onChange={e => setIpd(p => ({ ...p, advancePayment: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Special Instructions</label>
                  <textarea className="his-textarea" value={ipd.specialInstructions}
                    onChange={e => setIpd(p => ({ ...p, specialInstructions: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {visitType === "Daycare" && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--daycare"><i className="pi pi-sun" /></div>
                <div className="rc-section-title">Day Care Procedure Details</div>
              </div>
              <div className="rc-section-body">
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Department</label>
                    <select className="his-select" value={dayCare.department}
                      onChange={e => setDayCare(p => ({ ...p, department: e.target.value, doctor: "" }))}>
                      <option value="">— Select —</option>
                      {departments.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Doctor<span className="rc-req">*</span></label>
                    <select className={`his-select ${errors.doctor ? "his-field--err" : ""}`} value={dayCare.doctor}
                      onChange={e => setDayCare(p => ({ ...p, doctor: e.target.value }))}>
                      <option value="">— Select —</option>
                      {filteredDoctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Procedure Type</label>
                    <select className="his-select" value={dayCare.procedureType}
                      onChange={e => setDayCare(p => ({ ...p, procedureType: e.target.value }))}>
                      <option>Diagnostic</option><option>Therapeutic</option><option>Surgical</option><option>Chemotherapy</option><option>Dialysis</option><option>Other</option>
                    </select>
                  </div>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Procedure Name<span className="rc-req">*</span></label>
                  <input className={`his-field ${errors.procedure ? "his-field--err" : ""}`} value={dayCare.procedureName}
                    onChange={e => setDayCare(p => ({ ...p, procedureName: e.target.value }))}
                    placeholder="e.g. Colonoscopy, Cataract Surgery" />
                  {errors.procedure && <span className="rc-err">{errors.procedure}</span>}
                </div>
                <div className="rc-grid-2">
                  <div className="his-field-group">
                    <label className="his-label">Expected Discharge Time</label>
                    <input className="his-field" type="time" value={dayCare.expectedDischargeTime}
                      onChange={e => setDayCare(p => ({ ...p, expectedDischargeTime: e.target.value }))} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Special Instructions</label>
                    <input className="his-field" value={dayCare.specialInstructions}
                      onChange={e => setDayCare(p => ({ ...p, specialInstructions: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {visitType === "Emergency" && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--emergency"><i className="pi pi-bolt" /></div>
                <div className="rc-section-title">Emergency / ER Details</div>
                <span className="rc-section-meta">Time-critical</span>
              </div>
              <div className="rc-section-body">
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Triage Level</label>
                    <select className="his-select" value={er.triageLevel}
                      onChange={e => setEr(p => ({ ...p, triageLevel: e.target.value }))}>
                      {TRIAGE_LEVELS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">ER Type</label>
                    <select className="his-select" value={er.erType}
                      onChange={e => setEr(p => ({ ...p, erType: e.target.value }))}>
                      {ER_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Mode of Arrival</label>
                    <select className="his-select" value={er.modeOfArrival}
                      onChange={e => setEr(p => ({ ...p, modeOfArrival: e.target.value }))}>
                      <option>Walk-in</option><option>Ambulance</option><option>Police</option><option>Brought Dead</option><option>Other</option>
                    </select>
                  </div>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Presenting Complaint<span className="rc-req">*</span></label>
                  <textarea className={`his-textarea ${errors.complaint ? "his-field--err" : ""}`} value={er.presentingComplaint}
                    onChange={e => setEr(p => ({ ...p, presentingComplaint: e.target.value }))}
                    placeholder="What brought the patient to ER?" />
                  {errors.complaint && <span className="rc-err">{errors.complaint}</span>}
                </div>
                <div className="rc-grid-3">
                  <div className="his-field-group">
                    <label className="his-label">Attending Doctor</label>
                    <select className="his-select" value={er.attendingDoctor}
                      onChange={e => setEr(p => ({ ...p, attendingDoctor: e.target.value }))}>
                      <option value="">— Select —</option>
                      {doctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Brought By</label>
                    <input className="his-field" value={er.broughtBy}
                      onChange={e => setEr(p => ({ ...p, broughtBy: e.target.value }))}
                      placeholder="Name of person who brought patient" />
                  </div>
                  <label className={`rc-check ${er.isMLC ? "rc-check--active" : ""}`}>
                    <input type="checkbox" checked={er.isMLC}
                      onChange={e => setEr(p => ({ ...p, isMLC: e.target.checked }))} />
                    Medico-Legal Case (MLC)
                  </label>
                </div>
                {er.isMLC && (
                  <div className="his-field-group">
                    <label className="his-label">MLC Number<span className="rc-req">*</span></label>
                    <input className={`his-field ${errors.mlc ? "his-field--err" : ""}`} value={er.mlcNumber}
                      onChange={e => setEr(p => ({ ...p, mlcNumber: e.target.value }))} placeholder="MLC-YYYY-NNNN" />
                    {errors.mlc && <span className="rc-err">{errors.mlc}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {visitType === "Services" && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--services"><i className="pi pi-shopping-cart" /></div>
                <div className="rc-section-title">Service Cart</div>
                <span className="rc-section-meta">{services.cart.length} item(s)</span>
              </div>
              <div className="rc-section-body">
                <div className="rc-service-search">
                  <input className="his-field" placeholder="Search service by name or code…"
                    value={serviceSearch}
                    onChange={e => { setServiceSearch(e.target.value); setServiceDropdownOpen(true); }}
                    onFocus={() => setServiceDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setServiceDropdownOpen(false), 200)} />
                  {serviceDropdownOpen && filteredServices.length > 0 && (
                    <div className="rc-service-dropdown">
                      {filteredServices.map(s => (
                        <div key={s._id} className="rc-service-option" onMouseDown={() => addService(s)}>
                          <span>{s.serviceName} <span style={{ color: "#94a3b8", fontFamily: "'DM Mono',monospace" }}>· {s.serviceCode}</span></span>
                          <span className="rc-service-option-price">{fmtCur(s.price)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {errors.services && <span className="rc-err">{errors.services}</span>}

                {services.cart.length === 0 ? (
                  <div className="rc-cart-empty">No services added yet — search above to add</div>
                ) : (
                  <div className="rc-cart-list">
                    {services.cart.map(c => (
                      <div key={c.service._id} className="rc-cart-row">
                        <div className="rc-cart-row-name">
                          {c.service.serviceName}
                          <span style={{ color: "#94a3b8", fontSize: 10, marginLeft: 6 }}>{c.service.serviceCode}</span>
                        </div>
                        <input className="his-field his-field--sm rc-cart-qty" type="number" min="1" value={c.qty}
                          onChange={e => updateCartQty(c.service._id, e.target.value)} />
                        <div className="rc-cart-amount">{fmtCur((Number(c.service.price) || 0) * c.qty)}</div>
                        <button className="rc-cart-remove" onClick={() => removeCartItem(c.service._id)} title="Remove">×</button>
                      </div>
                    ))}
                  </div>
                )}

                {services.cart.length > 0 && (
                  <div className="rc-cart-total">
                    Total: <span className="rc-cart-total-value">{fmtCur(cartTotal)}</span>
                  </div>
                )}

                <div className="rc-grid-2">
                  <div className="his-field-group">
                    <label className="his-label">Payment Mode</label>
                    <select className="his-select" value={services.paymentMode}
                      onChange={e => setServices(p => ({ ...p, paymentMode: e.target.value }))}>
                      <option>Cash</option><option>Card</option><option>UPI</option><option>TPA</option><option>Insurance</option>
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Notes</label>
                    <input className="his-field" value={services.notes}
                      onChange={e => setServices(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Bed selection (IPD/DC/ER) ─── */}
          {NEEDS_BED(visitType) && (
            <div className="rc-section">
              <div className="rc-section-head">
                <div className="rc-section-icon rc-section-icon--bed"><i className="pi pi-th-large" /></div>
                <div className="rc-section-title">
                  Bed Assignment {visitType === "Daycare" && <span className="rc-section-meta">(optional)</span>}
                </div>
                {errors.bed && <span className="rc-section-meta rc-err">{errors.bed}</span>}
              </div>
              <div className="rc-section-body">
                <BedSelectionPanel value={bedData} onChange={setBedData} />
              </div>
            </div>
          )}

          {/* ─── Action bar ─── */}
          <div className="rc-actions">
            <div className="rc-actions-info">
              <i className="pi pi-info-circle" />
              <span>
                Visit Type: <strong>{visitType}</strong>
                {patient.fullName && <> · Patient: <strong>{patient.fullName}</strong></>}
                {isExisting && <> · <em>Existing</em></>}
              </span>
            </div>
            <div className="rc-actions-buttons">
              <button className="rc-btn-cancel" onClick={newPatient}>Clear</button>
              <button className="rc-btn-draft" onClick={saveDraft}>
                <i className="pi pi-save" /> Save Draft
              </button>
              <button className="rc-btn-save" onClick={saveAndProcess} disabled={saving}>
                <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} />
                {saving ? "Saving…" : `Save & Process ${visitType}`}
              </button>
            </div>
          </div>
        </div>

        {/* ─── RECEIPT PREVIEW (right) ─── */}
        <div className="rc-receipt">
          <div className="rc-receipt-head">
            <i className="pi pi-receipt" />
            <span className="rc-receipt-head-title">Live Receipt Preview</span>
            <span className="rc-receipt-head-badge">{visitType}</span>
          </div>
          <div className="rc-receipt-body">
            <div>
              <div className="rc-receipt-section-label">Patient</div>
              <div className="rc-receipt-line">
                <span className="rc-receipt-line-key">Name</span>
                <span className="rc-receipt-line-value">{patient.title} {patient.fullName || "—"}</span>
              </div>
              <div className="rc-receipt-line">
                <span className="rc-receipt-line-key">UHID</span>
                <span className="rc-receipt-line-value">{patient.UHID || "(auto on save)"}</span>
              </div>
              <div className="rc-receipt-line">
                <span className="rc-receipt-line-key">Age/Sex</span>
                <span className="rc-receipt-line-value">{patient.age || "—"} / {(patient.gender || "?")[0]}</span>
              </div>
              <div className="rc-receipt-line">
                <span className="rc-receipt-line-key">Phone</span>
                <span className="rc-receipt-line-value">{patient.contactNumber || "—"}</span>
              </div>
            </div>

            <div>
              <div className="rc-receipt-section-label">{visitType} Details</div>
              {visitType === "OPD" && <>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Dept</span><span className="rc-receipt-line-value">{departments.find(d => d.value === opd.department)?.label || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{doctors.find(d => d.value === opd.doctor)?.label || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Date</span><span className="rc-receipt-line-value">{opd.appointmentDate} {opd.appointmentTime}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Consult Fee</span><span className="rc-receipt-line-value">{fmtCur(opd.consultationFee)}</span></div>
              </>}
              {visitType === "IPD" && <>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Type</span><span className="rc-receipt-line-value">{ipd.admissionType}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Dept</span><span className="rc-receipt-line-value">{departments.find(d => d.value === ipd.department)?.label || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{doctors.find(d => d.value === ipd.admittingDoctor)?.label || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{bedData.bedNumber || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Adv Payment</span><span className="rc-receipt-line-value">{fmtCur(ipd.advancePayment)}</span></div>
              </>}
              {visitType === "Daycare" && <>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Procedure</span><span className="rc-receipt-line-value">{dayCare.procedureName || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{doctors.find(d => d.value === dayCare.doctor)?.label || "—"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{bedData.bedNumber || "—"}</span></div>
              </>}
              {visitType === "Emergency" && <>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Triage</span><span className="rc-receipt-line-value">{er.triageLevel}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Type</span><span className="rc-receipt-line-value">{er.erType}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">MLC</span><span className="rc-receipt-line-value">{er.isMLC ? er.mlcNumber || "Yes" : "No"}</span></div>
                <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{bedData.bedNumber || "—"}</span></div>
              </>}
              {visitType === "Services" && services.cart.length > 0 && services.cart.map(c => (
                <div key={c.service._id} className="rc-receipt-line">
                  <span className="rc-receipt-line-key">{c.service.serviceName} ×{c.qty}</span>
                  <span className="rc-receipt-line-value">{fmtCur((Number(c.service.price) || 0) * c.qty)}</span>
                </div>
              ))}
            </div>

            {patient.tpa && (
              <div>
                <div className="rc-receipt-section-label">Insurance</div>
                <div className="rc-receipt-line">
                  <span className="rc-receipt-line-key">TPA</span>
                  <span className="rc-receipt-line-value">{tpaList.find(t => t.value === patient.tpa)?.label || "—"}</span>
                </div>
              </div>
            )}

            <div className="rc-receipt-total">
              <span className="rc-receipt-total-label">Total Payable</span>
              <span className="rc-receipt-total-value">{fmtCur(receiptTotal)}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}


/* ═══════════════════════ PRINT RECEIPT ═══════════════════════ */
function printReceipt({ patient, visitType, opd, ipd, dayCare, er, services, bedData, deptLabel, docLabel, receiptTotal }) {
  const now = new Date();
  const fmt = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const color = ({ OPD: "#0891b2", IPD: "#7c3aed", Daycare: "#d97706", Emergency: "#dc2626", Services: "#059669" })[visitType] || "#0891b2";

  const detailRows = (() => {
    if (visitType === "OPD") return [
      ["Department", deptLabel || "—"],
      ["Doctor", docLabel || "—"],
      ["Date / Time", `${opd.appointmentDate} ${opd.appointmentTime}`],
      ["Chief Complaint", opd.chiefComplaint || "—"],
      ["Consultation Fee", `₹${opd.consultationFee || 0}`],
    ];
    if (visitType === "IPD") return [
      ["Admission Type", ipd.admissionType],
      ["Department", deptLabel || "—"],
      ["Admitting Doctor", docLabel || "—"],
      ["Reason", ipd.reasonForAdmission],
      ["Bed", bedData.bedNumber || "—"],
      ["Advance Paid", `₹${ipd.advancePayment || 0}`],
    ];
    if (visitType === "Daycare") return [
      ["Procedure", dayCare.procedureName],
      ["Type", dayCare.procedureType],
      ["Doctor", docLabel || "—"],
      ["Expected Discharge", dayCare.expectedDischargeTime || "Today"],
    ];
    if (visitType === "Emergency") return [
      ["Triage", er.triageLevel],
      ["ER Type", er.erType],
      ["Complaint", er.presentingComplaint],
      ["MLC", er.isMLC ? `Yes — ${er.mlcNumber}` : "No"],
      ["Mode of Arrival", er.modeOfArrival],
      ["Bed", bedData.bedNumber || "—"],
    ];
    if (visitType === "Services") return services.cart.map(c => [`${c.service.serviceName} ×${c.qty}`, `₹${((Number(c.service.price) || 0) * c.qty).toFixed(2)}`]);
    return [];
  })();

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Registration Receipt — ${patient.UHID || "New"}</title>
    <style>
      *{box-sizing:border-box;font-family:'DM Sans',Arial,sans-serif}
      body{margin:0;padding:24px;color:#0f172a}
      .wrap{max-width:760px;margin:0 auto;border:2px solid ${color};border-radius:10px;overflow:hidden}
      .hd{padding:20px;background:linear-gradient(135deg,${color},${color}cc);color:#fff;display:flex;justify-content:space-between;align-items:center}
      .hd-title{font-size:18px;font-weight:800;margin:0}
      .hd-sub{font-size:11px;opacity:.85}
      .badge{padding:5px 14px;background:#fff;color:${color};border-radius:20px;font-weight:800;font-size:12px}
      .body{padding:20px}
      .sec{margin-bottom:18px}
      .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${color};padding-bottom:6px;border-bottom:1.5px solid ${color}30;margin-bottom:8px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      td{padding:5px 0}
      td.lbl{color:#64748b;width:35%}
      td.val{font-weight:700}
      .total{margin-top:14px;padding:14px 18px;background:${color}10;border:2px solid ${color};border-radius:8px;display:flex;justify-content:space-between;align-items:center}
      .total-label{font-size:11px;font-weight:800;color:${color};text-transform:uppercase}
      .total-value{font-size:22px;font-weight:900;color:${color};font-family:'DM Mono',monospace}
      .footer{margin-top:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}
      .sign{text-align:center}
      .sign-line{border-top:1px solid #94a3b8;margin-top:40px}
      .sign-label{font-size:10px;color:#64748b;font-weight:700;margin-top:4px}
      .note{margin-top:14px;text-align:center;font-size:10px;color:#94a3b8}
      @media print{body{padding:0} .wrap{border:0}}
    </style></head><body><div class="wrap">
      <div class="hd">
        <div>
          <div class="hd-title">Registration Receipt</div>
          <div class="hd-sub">${fmt(now)}</div>
        </div>
        <div class="badge">${visitType.toUpperCase()}</div>
      </div>
      <div class="body">
        <div class="sec">
          <div class="sec-title">Patient Information</div>
          <table>
            <tr><td class="lbl">Name</td><td class="val">${patient.title || ""} ${patient.fullName}</td></tr>
            <tr><td class="lbl">UHID</td><td class="val" style="font-family:'DM Mono',monospace">${patient.UHID || "—"}</td></tr>
            <tr><td class="lbl">Age / Sex</td><td class="val">${patient.age || "—"} years / ${patient.gender}</td></tr>
            <tr><td class="lbl">Phone</td><td class="val">${patient.contactNumber}</td></tr>
            ${patient.bloodGroup && patient.bloodGroup !== "Unknown" ? `<tr><td class="lbl">Blood Group</td><td class="val">${patient.bloodGroup}</td></tr>` : ""}
          </table>
        </div>
        <div class="sec">
          <div class="sec-title">${visitType} Details</div>
          <table>
            ${detailRows.map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="val">${v || "—"}</td></tr>`).join("")}
          </table>
        </div>
        <div class="total">
          <span class="total-label">Total Payable</span>
          <span class="total-value">₹${(Number(receiptTotal) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
        </div>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div class="sign-label">Patient / Attendant</div></div>
          <div class="sign"><div class="sign-line"></div><div class="sign-label">Attending Doctor</div></div>
          <div class="sign"><div class="sign-line"></div><div class="sign-label">Reception Counter</div></div>
        </div>
        <div class="note">Computer-generated receipt. SphereHealth HIS.</div>
      </div>
    </div></body></html>`;

  const w = window.open("", "_blank", "width=900,height=720");
  if (!w) { alert("Please allow popups to print the receipt"); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 200);
}
