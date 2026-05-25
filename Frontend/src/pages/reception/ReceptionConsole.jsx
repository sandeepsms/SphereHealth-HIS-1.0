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

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { fetchHospitalSettings } from "../../Components/print/useHospitalSettings";
import { buildPrintIssuerHtml } from "../../Components/print/printIssuer";
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
import WhatsAppButton from "../../Components/whatsapp/WhatsAppButton";
import { useAuth } from "../../context/AuthContext";
import { useReceptionistPresence } from "../../hooks/useReceptionistPresence";
// R7ar-P1-14/D4-aq-02: centralised Decimal128 unwrap.
import { toMoney } from "../../utils/money";

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
  policyNumber: "", // mandatory when paymentType === "TPA" (backend validation)
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
  // procedureType field removed 2026-05-17 — never sent to the
  // /api/admissions payload (audit confirmed via grep). Leaving it
  // in the form added a useless dropdown the receptionist had to
  // click past on every Day Care registration.
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
  policeStation: "",     // captured for MLC cases (NABH IPC.6)
  informedPolice: false, // whether police have been informed
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
  const [pincodeRetryNonce, setPincodeRetryNonce] = useState(0);
  const pincodeTimerRef = useRef(null);
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  /* ── Just-registered receipt snapshot ────────────────────────────
     After a successful registration we wipe the form so the receptionist
     can start the next patient, but we ALSO keep a frozen snapshot of
     everything needed to reprint the cash/payment slip. The Live Receipt
     Preview panel flips into a "Registered ✓" confirmation card with a
     Print Slip button until the receptionist either prints, dismisses,
     or starts typing a new patient — covering the two failure modes that
     surfaced in practice:
       1. Browser blocks the auto-popup → no slip printed → receptionist
          needs an explicit re-fire path.
       2. Patient asks for a duplicate copy a minute later (one for the
          ward, one for the file) — saves a round-trip to billing. */
  const [lastSaved, setLastSaved] = useState(null);

  /* ── Today's stats ── */
  const [stats, setStats] = useState({ opd: 0, ipd: 0, dc: 0, er: 0, svc: 0, beds: "—" });

  /* ─── Live presence — broadcasts heartbeat so the other receptionist
         can see what we're working on (Phase 4 coordination) ─── */
  useReceptionistPresence({
    type:   patient._id ? "patient" : "idle",
    id:     patient._id || null,
    label:  patient.fullName || "New patient",
    action: isExisting ? "editing" : (patient.fullName ? "registering" : "idle"),
  });

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
        // IPD = an admission with a bed actually assigned (`hasBed` is
        // the indexed boolean on admissionModel.js). The previous logic
        // filtered by admissionType exclusion which mis-categorised
        // OPD / Daycare / Services rows (all of which now also live in
        // the Admission collection) as IPD. See models/Patient/admissionModel.js.
        setStats({
          opd:  Array.isArray(opdList) ? opdList.length : 0,
          ipd:  admList.filter(a => a.hasBed === true).length,
          dc:   admList.filter(a => a.admissionType === "Day Care" || a.admissionType === "Daycare").length,
          er:   admList.filter(a => a.admissionType === "Emergency").length,
          svc:  admList.filter(a => a.admissionType === "Services").length,
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

  /* ─── Pincode auto-lookup (R7dn — backend endpoint with multi-source cache) ─── */
  // When user enters a 6-digit Indian pincode, hit our backend's
  // /api/pincode/:pin endpoint. The backend tries postalpincode.in,
  // Nominatim/OSM, and zippopotam.us in sequence and caches every
  // successful lookup in MongoDB forever — so the second-ever hit
  // for a given pincode is instant for every receptionist.
  //
  // Client-side layers retained:
  //   1. localStorage cache — extra speed-up so repeat visits in the
  //      same browser don't even need to hit our backend
  //   2. AbortController 10s timeout — generous since backend does
  //      all the multi-source chasing for us
  //   3. Manual retry button — clears cache + bumps nonce
  useEffect(() => {
    const pin = patient.address.pincode;
    if (!pin || pin.length !== 6) {
      setPincodeLookup({ loading: false, ok: false, error: "" });
      return;
    }

    // 1. localStorage cache — instant fill, no network at all.
    //    R7do — Direct assignment (no `||` fallback) so a new pincode
    //    ALWAYS overwrites the prior auto-filled fields. Otherwise
    //    stale data persists when switching from e.g. 110001 (Delhi)
    //    to 282001 (Agra).
    try {
      const cached = JSON.parse(localStorage.getItem(`pincode:${pin}`) || "null");
      if (cached?.city && cached?.state) {
        setPatient(p => ({
          ...p,
          address: {
            ...p.address,
            city:     cached.city     || "",
            district: cached.district || "",
            state:    cached.state    || "",
          },
        }));
        setPincodeLookup({ loading: false, ok: true, error: "" });
        return;
      }
    } catch (_) { /* cache miss / parse fail — fall through */ }

    if (pincodeTimerRef.current) clearTimeout(pincodeTimerRef.current);
    const ctrl = new AbortController();
    pincodeTimerRef.current = setTimeout(async () => {
      setPincodeLookup({ loading: true, ok: false, error: "" });
      const timer = setTimeout(() => ctrl.abort(), 10000); // 10s — backend chases 3 sources

      try {
        const res = await fetch(`${API_ENDPOINTS.BASE}/pincode/${pin}`, {
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          setPincodeLookup({
            loading: false, ok: false,
            error: res.status === 404 ? "Pincode not found — fill manually" : "Lookup failed — fill manually",
          });
          return;
        }
        const json = await res.json();
        const data = json?.data;
        if (data && (data.city || data.state)) {
          // R7do — Always overwrite all 3 fields (no `||` fallback).
          // A new pincode means a new location; stale district/city/state
          // from a previous pincode must NOT persist.
          setPatient(p => ({
            ...p,
            address: {
              ...p.address,
              city:     data.city     || "",
              district: data.district || "",
              state:    data.state    || "",
            },
          }));
          try {
            localStorage.setItem(`pincode:${pin}`, JSON.stringify({
              city: data.city, district: data.district, state: data.state,
            }));
          } catch (_) { /* quota / private — non-fatal */ }
          setPincodeLookup({ loading: false, ok: true, error: "" });
          return;
        }
        setPincodeLookup({ loading: false, ok: false, error: "Pincode not found — fill manually" });
      } catch (e) {
        clearTimeout(timer);
        setPincodeLookup({
          loading: false, ok: false,
          error: ctrl.signal.aborted ? "Lookup timed out — try again or fill manually" : "Lookup failed — fill manually",
        });
      }
    }, 400);
    return () => {
      if (pincodeTimerRef.current) clearTimeout(pincodeTimerRef.current);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.address.pincode, pincodeRetryNonce]);

  // Manual retry — clears cache for this pincode + bumps the nonce so the
  // useEffect re-fires even though the pincode string is unchanged.
  const retryPincodeLookup = useCallback(() => {
    const pin = patient.address.pincode;
    if (!pin || pin.length !== 6) return;
    try { localStorage.removeItem(`pincode:${pin}`); } catch (_) {}
    setPincodeRetryNonce(n => n + 1);
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
      policyNumber: p.policyNumber || "",
      emergencyContact: p.emergencyContact || { name: "", relation: "", phone: "" },
      UHID: p.UHID || "",
    });
    setIsExisting(true);
    setSearchTerm("");
    setSearchResults([]);
    setSearchOpen(false);
    toast.success(`Patient loaded: ${p.fullName || p.UHID}`);
  };

  /* ─── Auto-dismiss the post-save success card the moment the
         receptionist starts typing the next patient's name (or picks one
         from the search dropdown). Without this, the success card would
         linger until manually dismissed and could be confused with the
         next registration. Guarded by `lastSaved` so it stays a no-op
         when there's nothing to dismiss. ─── */
  useEffect(() => {
    if (lastSaved && patient.fullName) setLastSaved(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.fullName]);

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
    // Backend requires both TPA and policyNumber whenever paymentType === "TPA"
    if (patient.paymentType === "TPA" && !patient.tpa)          e.tpa          = "TPA provider required";
    if (patient.paymentType === "TPA" && !patient.policyNumber) e.policyNumber = "Policy number required for TPA";

    if (visitType === "OPD") {
      if (!opd.department)        e.department = "Department required";
      if (!opd.doctor)            e.doctor     = "Doctor required";
      if (!opd.chiefComplaint?.trim()) e.complaint = "Chief complaint required";
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
      if (!er.attendingDoctor)        e.doctor    = "Attending doctor required";
      if (er.isMLC && !er.mlcNumber)  e.mlc       = "MLC number required";
    } else if (visitType === "Services") {
      if (services.cart.length === 0) e.services  = "Add at least one service";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ─── Save & Print ─── */
  const saveAndProcess = async () => {
    if (!validate()) {
      // The old toast just said "fix the highlighted fields" — useless
      // when the field in question is below the fold (Department /
      // Doctor / Chief Complaint sit under the address block). Name the
      // exact fields so the receptionist knows what to fill, and try to
      // scroll the first failing input into view.
      // Note: validate() has already called setErrors(e) with the same
      // error object we mirror here. We rebuild the list locally because
      // setState is async, so the snapshot we just set isn't readable
      // synchronously yet.
      const missing = [];
      if (!patient.fullName?.trim()) missing.push("Full Name");
      if (!patient.gender) missing.push("Gender");
      if (!patient.contactNumber || !/^\d{10}$/.test(patient.contactNumber)) missing.push("Phone (10 digits)");
      if (!patient.dateOfBirth && !patient.age) missing.push("Age or DOB");
      if (patient.paymentType === "TPA" && !patient.tpa) missing.push("TPA Provider");
      if (patient.paymentType === "TPA" && !patient.policyNumber) missing.push("Policy Number");
      if (visitType === "OPD") {
        if (!opd.department) missing.push("Department");
        if (!opd.doctor) missing.push("Doctor");
        if (!opd.chiefComplaint?.trim()) missing.push("Chief Complaint");
      } else if (visitType === "IPD") {
        if (!ipd.department) missing.push("Department");
        if (!ipd.admittingDoctor) missing.push("Admitting Doctor");
        if (!ipd.reasonForAdmission) missing.push("Reason for Admission");
        if (!bedData.bedId) missing.push("Bed");
      } else if (visitType === "Daycare") {
        if (!dayCare.procedureName) missing.push("Procedure Name");
        if (!dayCare.doctor) missing.push("Doctor");
      } else if (visitType === "Emergency") {
        if (!er.presentingComplaint) missing.push("Presenting Complaint");
        if (!bedData.bedId) missing.push("Emergency Bed");
        if (!er.attendingDoctor) missing.push("Attending Doctor");
        if (er.isMLC && !er.mlcNumber) missing.push("MLC Number");
      } else if (visitType === "Services") {
        if (services.cart.length === 0) missing.push("at least one Service");
      }
      const list = missing.length ? missing.join(", ") : "the highlighted fields";
      toast.error(`Please fill: ${list}`, { autoClose: 6000 });
      // Scroll the first required label without a filled value into the
      // middle of the viewport so the cashier doesn't have to hunt.
      // Match against the label text so we don't need ref plumbing into
      // each subform.
      requestAnimationFrame(() => {
        const FIELD_LABEL_MAP = {
          "Full Name": "Full Name",
          "Gender": "Gender",
          "Phone (10 digits)": "Phone",
          "Department": "Department",
          "Doctor": "Doctor",
          "Admitting Doctor": "Admitting Doctor",
          "Attending Doctor": "Attending Doctor",
          "Chief Complaint": "Chief Complaint",
          "Presenting Complaint": "Presenting Complaint",
          "Procedure Name": "Procedure",
          "Reason for Admission": "Reason",
          "Bed": "Bed",
          "Emergency Bed": "Bed",
          "MLC Number": "MLC",
        };
        const wanted = FIELD_LABEL_MAP[missing[0]];
        if (!wanted) return;
        const labels = Array.from(document.querySelectorAll("label, .his-label, .rc-label"));
        const match = labels.find((l) => l.textContent?.trim().toLowerCase().startsWith(wanted.toLowerCase()));
        if (match) match.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    setSaving(true);

    try {
      // ── Step 1: Create or update patient ──
      let patientId = patient._id;
      let patientUHID = patient.UHID;

      // Resolve the visit's primary dept/doctor so the Patient record
      // links to one even before the OPD/IPD/ER visit is created.
      const primaryDept   = opd.department || ipd.department || dayCare.department || null;
      const primaryDoctor = opd.doctor || ipd.admittingDoctor || dayCare.doctor || er.attendingDoctor || null;

      const patientPayload = {
        title:           patient.title,
        fullName:        patient.fullName,
        gender:          patient.gender,
        dateOfBirth:     patient.dateOfBirth || (patient.age ? dobFromAge(patient.age) : undefined),
        age:             patient.age,
        maritalStatus:   patient.maritalStatus || "",
        contactNumber:   patient.contactNumber,
        email:           patient.email,
        address:         patient.address,
        bloodGroup:      patient.bloodGroup || "Unknown",
        // Allergies: model stores a string; receptionist enters comma-separated.
        knownAllergies:  patient.knownAllergies || "",
        paymentType:     patient.paymentType,
        tpa:             patient.tpa || null,
        policyNumber:    patient.policyNumber || undefined,
        // Patient model has NO `emergencyContact` field — it uses
        // `companionName / companionRelationship / companionContact`. The
        // old code silently dropped the receptionist's input on every save
        // because of Mongoose strict mode. Map onto the real fields.
        companionName:        patient.emergencyContact?.name     || "",
        companionRelationship:patient.emergencyContact?.relation || "",
        companionContact:     patient.emergencyContact?.phone    || "",
        // Optional but useful when present
        department:      primaryDept || undefined,
        doctor:          primaryDoctor || undefined,
        registrationType: visitType === "Daycare" ? "Daycare" : visitType,
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
      // Resolve human-readable labels for denormalised storage and receipts
      const deptLabelFor = (id) => departments.find(d => d.value === id)?.label || "";
      const docLabelFor  = (id) => doctors.find(d => d.value === id)?.label || "";

      let tokenNumber = null; // captured for receipt print
      if (visitType === "OPD") {
        const opdResp = await opdService.createOPDVisit({
          patientId,
          UHID: patientUHID,
          patientName: patient.fullName,
          // ObjectId refs + denormalised display strings — match OPDModels schema
          departmentId:   opd.department,
          department:     deptLabelFor(opd.department),
          doctorId:       opd.doctor,
          consultantName: docLabelFor(opd.doctor),
          visitDate: opd.appointmentDate,
          visitTime: opd.appointmentTime,
          chiefComplaint: opd.chiefComplaint || "—",  // required server-side
          consultationFee: Number(opd.consultationFee) || 0,
          hasAppointment: opd.hasAppointment,
          createdBy: user?._id,
        });
        const createdVisit = opdResp?.data?.data || opdResp?.data || opdResp;
        tokenNumber = createdVisit?.tokenNumber || null;
        toast.success("OPD visit registered successfully");

      } else if (visitType === "IPD" || visitType === "Daycare" || visitType === "Emergency") {
        const isER = visitType === "Emergency";
        const isDC = visitType === "Daycare";
        const docIdFor = isER ? er.attendingDoctor : (isDC ? dayCare.doctor : ipd.admittingDoctor);
        const admissionPayload = {
          patientId,
          UHID: patientUHID,
          patientName: patient.fullName,
          admissionType: REG_TO_ADM_TYPE[visitType],
          admissionDate: new Date().toISOString(),
          // Admission model has `department` as a String (display label) plus
          // a separate departmentId ObjectId. We pass labels for both code-paths
          // so grouping by department works for ER too.
          department:   deptLabelFor(isER ? "" : (isDC ? dayCare.department : ipd.department)) || "Emergency",
          departmentId: isER ? undefined : (isDC ? dayCare.department : ipd.department),
          // Send BOTH the doctor's name (string field) and the doctor's ObjectId
          // so doctor-side endpoints (my-patients, team access) actually work.
          attendingDoctor:   docLabelFor(docIdFor),
          attendingDoctorId: docIdFor || undefined,
          reasonForAdmission: isER ? er.presentingComplaint :
                              isDC ? dayCare.procedureName :
                              ipd.reasonForAdmission,
          provisionalDiagnosis: isER ? "" : (isDC ? dayCare.procedureName : ipd.provisionalDiagnosis),
          expectedStayDays: isDC ? 0 : (Number(ipd.expectedStayDays) || 0),
          expectedDischargeDate: isDC ? todayDate() : ipd.expectedDischargeDate,
          specialInstructions: isER ? "" : (isDC ? dayCare.specialInstructions : ipd.specialInstructions),
          // Admission model field is `advancePaid` — sending under the old
          // name silently dropped every IPD advance the receptionist took.
          advancePaid:    isDC || isER ? 0 : (Number(ipd.advancePayment) || 0),
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

        const admResp = await admissionService.createAdmission(admissionPayload);
        // Service wraps axios — response is the raw body (no extra .data wrap).
        const createdAdm = admResp?.data || admResp || null;

        // ── IPD initial advance → PatientAdvance row + receipt ─────
        // Receptionist enters the advance amount on the IPD form. Previously
        // that number went onto `admissionPayload.advancePaid` (used purely
        // for the visit-receipt summary) but no PatientAdvance ledger row
        // was ever written — so the money sat in nobody's books, never
        // applied to the bill at discharge. This block fixes that:
        // create the advance, print the dedicated AdvanceReceipt. Default
        // mode = CASH (no payment-mode field on the admission form yet —
        // receptionist can edit via Billing Counter if needed).
        const advAmt = Number(ipd.advancePayment) || 0;
        if (visitType === "IPD" && advAmt > 0 && createdAdm?._id) {
          try {
            const advResp = await axios.post(`${API_ENDPOINTS.BILLING}/advance`, {
              UHID:        patientUHID,
              amount:      advAmt,
              paymentMode: "CASH",
              admission:   createdAdm._id,
              remarks:     "Admission advance deposit",
              receivedBy:  user?.fullName || user?.employeeId || "Reception",
              receivedById:   user?._id,
              receivedByRole: user?.role,
            });
            const adv = advResp?.data?.data || advResp?.data || {};

            // Fire the AdvanceReceipt print via sessionStorage handoff
            // (matches ReceptionBilling printAdvanceReceipt helper).
            const advPayload = {
              receiptNo:     adv.receiptNumber || null,
              patientName:   [patient.title, patient.fullName].filter(Boolean).join(" "),
              uhid:          patientUHID,
              ipdNo:         createdAdm.admissionNumber || null,
              admissionDate: createdAdm.admissionDate || new Date().toISOString(),
              bedNumber:     bedData.bedNumber || null,
              wardName:      null, // bedData only carries IDs — name shown on visit receipt
              date:          adv.paidAt || adv.createdAt || new Date().toISOString(),
              amount:        toMoney(adv.amount) || advAmt,
              method:        adv.paymentMode || "CASH",
              refNo:         adv.transactionId || null,
              depositPurpose: "hospitalization advance",
            };
            try {
              sessionStorage.setItem("printPayload-advance-receipt", JSON.stringify(advPayload));
            } catch (e) { /* sessionStorage full / unavailable */ }
            window.open("/print/advance-receipt", "_blank", "noopener,noreferrer,width=900,height=1100");
          } catch (e) {
            console.error("Advance creation failed:", e);
            toast.warning("Admission saved, but advance deposit could not be recorded — please add via Billing Counter. " + (e?.response?.data?.message || e?.message || ""));
          }
        }

        // If Emergency, also create the emergency-visit record (parallel)
        // The Emergency model uses specific enum values + field names; map
        // our UI fields onto them before posting (without this, the entire
        // POST 422s with a mongoose ValidationError).
        if (isER) {
          // Triage UI "Red (P1)" → schema "Critical" etc.
          const TRIAGE_MAP = {
            "Red (P1)":    "Critical",
            "Yellow (P2)": "Emergency",
            "Green (P3)":  "Urgent",
            "Blue (P4)":   "Non-urgent",
          };
          // Arrival-mode UI label → schema enum (Emergency model only allows
          // Ambulance/Walk-in/Police/Referred/Other).
          const ARRIVAL_MAP = {
            "Ambulance":    "Ambulance",
            "Walk-in":      "Walk-in",
            "Walk In":      "Walk-in",
            "Police":       "Police",
            "Referred":     "Referred",
            "Brought Dead": "Other",   // closest enum value; flagged in remarks
            "Other":        "Other",
          };
          try {
            await emergencyService.createEmergencyVisit({
              patientId,
              UHID: patientUHID,
              // Denormalised on the Emergency model so list views work without populate
              patientName:   patient.fullName,
              age:           Number(patient.age) || undefined,
              gender:        patient.gender,
              contactNumber: patient.contactNumber,
              presentingComplaints: er.presentingComplaint || "—",
              triageCategory: TRIAGE_MAP[er.triageLevel] || "Urgent",
              arrivalMode:    ARRIVAL_MAP[er.modeOfArrival] || "Walk-in",
              consultantIncharge: docLabelFor(er.attendingDoctor) || "On-call",
              isMLC:          er.isMLC,
              mlcNumber:      er.mlcNumber,
              policeStation:  er.policeStation || "",
              informedPolice: er.isMLC ? !!er.informedPolice : undefined,
              attendingDoctorId: er.attendingDoctor,
              emergencyType:  er.erType,
              broughtBy:      er.broughtBy,
            });
          } catch (e) {
            // Don't block the admission, but surface a warning so the
            // receptionist knows the ER triage record didn't save.
            console.error("Emergency-visit creation failed:", e);
            toast.warning("ER record not created — admission saved but ER queue won't show this patient. " + (e?.response?.data?.message || e?.message || ""));
          }
        }
        toast.success(`${visitType} registration complete`);

      } else if (visitType === "Services") {
        // Create the bill server-side and add cart items so the cart isn't lost
        // when we hand off to the bill page. We hit the existing billing
        // endpoints (`/billing/create` + `/billing/:id/add-service`) so the
        // bill draft is fully persisted before navigation.
        try {
          // visitType = "SERVICE" for walk-in service-only bills (lab tests /
           // imaging / vaccination). Was previously hard-coded to "OPD" which
           // inflated OPD revenue reports — audit caught it. Backend enum
           // was extended in the same patch.
          const draftRes = await axios.post(`${API_ENDPOINTS.BILLING}/create`, {
            UHID: patientUHID,
            visitType: "SERVICE",
          });
          const draft = draftRes.data?.data || draftRes.data;
          if (draft?._id) {
            for (const c of services.cart) {
              await axios.post(`${API_ENDPOINTS.BILLING}/${draft._id}/add-service`, {
                serviceId: c.service._id,
                quantity:  c.qty || 1,
                remarks:   services.notes || undefined,
              });
            }
            toast.success("Services bill created — opening payments…");
            // Clear the auto-save snapshot so the next mount doesn't restore
            // an already-billed cart.
            clearAutosave();
            navigate(`/reception-billing/${patientUHID}`);
          } else {
            toast.error("Could not create services bill");
          }
        } catch (e) {
          toast.error(e?.response?.data?.message || "Services bill failed");
        }
        setSaving(false);
        return;
      }

      // ── Step 3: Print receipt ──
      // Build a stable snapshot first so we can both fire the print AND
      // hand the receptionist a manual "Print Slip" reprint button on the
      // Live Receipt Preview card after the form is wiped.
      const savedSnapshot = {
        patient: { ...patient, UHID: patientUHID },
        visitType,
        opd, ipd, dayCare, er, services, bedData,
        deptLabel: departments.find(d => d.value === (opd.department || ipd.department || dayCare.department))?.label,
        docLabel: doctors.find(d => d.value === (opd.doctor || ipd.admittingDoctor || dayCare.doctor || er.attendingDoctor))?.label,
        receiptTotal,
        tokenNumber,  // OPD token (null for non-OPD)
        savedAt: new Date().toISOString(),
      };
      setLastSaved(savedSnapshot);
      printReceipt(savedSnapshot);

      // Reset for next patient + clear the auto-saved snapshot.
      // Note: newPatient() does NOT clear lastSaved — that's intentional
      // so the success card with the Print Slip button survives the form
      // wipe. lastSaved is cleared when the receptionist either presses
      // "New Patient" on the success card or starts typing in the form.
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
        // Strip PHI/payment fields before persisting (audit E-03). Reception
        // restart needs to recover non-PII typing (name spelling, address)
        // but UHID, Aadhaar, advancePayment, payment-mode details should
        // never sit in browser storage where a shared-terminal next user
        // can read them. The fields stripped here are the ones the reception
        // form actually collects; new sensitive fields must be added below.
        const STRIP_PHI = new Set([
          "uhid", "UHID", "aadhaar", "aadhaarNumber", "panNumber",
          "advancePayment", "paymentMode", "cardNumber", "cardLast4",
          "upiId", "transactionId", "chequeNumber", "bankAccount",
        ]);
        const sanitize = (obj) => {
          if (!obj || typeof obj !== "object") return obj;
          if (Array.isArray(obj)) return obj.map(sanitize);
          const out = {};
          for (const [k, v] of Object.entries(obj)) {
            if (STRIP_PHI.has(k)) continue;
            out[k] = (v && typeof v === "object") ? sanitize(v) : v;
          }
          return out;
        };
        sessionStorage.setItem("rc_autosave", JSON.stringify(sanitize({
          visitType, patient, opd, ipd, dayCare, er, services, bedData, isExisting,
          ts: Date.now(),
        })));
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

  /* ─── Load patient & visit type from query params ───────────
     Supports:
       ?patientId=<mongo _id>      → load existing patient by id
       ?uhid=UH0001                → load existing patient by UHID
       ?visit=OPD|IPD|Emergency    → preset the visit type (legacy)
       ?type=OPD|IPD|Emergency     → preset the visit type (new)
       ?prefill=<search term>      → put the term into the search box
                                     so the receptionist can find / create
  */
  useEffect(() => {
    const pid     = searchParams.get("patientId");
    const uhid    = searchParams.get("uhid");
    const visit   = searchParams.get("visit") || searchParams.get("type");
    const prefill = searchParams.get("prefill");
    if (visit && VISIT_TYPES.find(v => v.id === visit)) setVisitType(visit);
    if (prefill) setSearchTerm(prefill);
    if (pid) {
      patientService.getPatientById(pid).then(res => {
        const p = res?.data || res;
        if (p?._id) selectExistingPatient(p);
      }).catch(() => { /* ignore */ });
    } else if (uhid) {
      patientService.getPatientByUHID(uhid).then(res => {
        const p = res?.data || res;
        if (p?._id) selectExistingPatient(p);
      }).catch(() => { /* ignore */ });
    }
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
              <div className="rc-empty rc-empty--compact">
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

        <button className="rc-new-btn rc-new-btn--slate" onClick={() => navigate("/reception")}
                title="Back to Reception Dashboard">
          <i className="pi pi-arrow-left" /> Dashboard
        </button>
        {patient.contactNumber && patient.fullName && (
          <WhatsAppButton
            phone={patient.contactNumber}
            patientName={patient.fullName}
            context={{
              doctorName: doctors.find(d => d.value === (opd.doctor || ipd.admittingDoctor || dayCare.doctor || er.attendingDoctor))?.label || "",
              date: opd.appointmentDate || todayDate(),
              time: opd.appointmentTime || nowTime(),
              tokenNumber: null,
              bedNumber: bedData.bedNumber,
              wardName: bedData.wardName || "",
              admittingDoctor: doctors.find(d => d.value === ipd.admittingDoctor)?.label || "",
            }}
            defaultTemplate={
              visitType === "OPD"     ? "appointment_confirmation" :
              visitType === "IPD"     ? "ipd_admission_intimation" :
              visitType === "Services"? "lab_report_ready" :
              "appointment_confirmation"
            }
          />
        )}
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
              {/*
                A11y: every label is paired with htmlFor + matching id on
                the input so screen readers (NVDA / JAWS) and voice-input
                tools announce the field name. Pattern: id="rc-<field>".
                Migration kicked off here for the patient identity block
                (Title, Full Name, Gender, DOB, Age, Phone) per audit
                E-07 round-13 close-out. The remaining sections still
                rely on label-proximity association — backlog item for
                the a11y-sweep pass.
              */}
              <div className="rc-grid-4">
                <div className="his-field-group">
                  <label className="his-label" htmlFor="rc-title">Title</label>
                  <select id="rc-title" className="his-select" value={patient.title} onChange={e => setP("title", e.target.value)}>
                    {TITLES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="his-field-group rc-span-2">
                  <label className="his-label" htmlFor="rc-fullName">Full Name<span className="rc-req">*</span></label>
                  <input id="rc-fullName" className={`his-field ${errors.fullName ? "his-field--err" : ""}`} value={patient.fullName}
                    onChange={e => setP("fullName", e.target.value)} placeholder="Patient full name" />
                  {errors.fullName && <span className="rc-err"><i className="pi pi-exclamation-circle" /> {errors.fullName}</span>}
                </div>
                <div className="his-field-group">
                  <label className="his-label" htmlFor="rc-gender">Gender<span className="rc-req">*</span></label>
                  <select id="rc-gender" className={`his-select ${errors.gender ? "his-field--err" : ""}`} value={patient.gender}
                    onChange={e => setP("gender", e.target.value)}>
                    {GENDERS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div className="rc-grid-4">
                <div className="his-field-group">
                  <label className="his-label" htmlFor="rc-dob">Date of Birth</label>
                  <input id="rc-dob" className="his-field" type="date" value={patient.dateOfBirth}
                    onChange={e => setP("dateOfBirth", e.target.value) || setP("age", calcAge(e.target.value))} />
                </div>
                <div className="his-field-group">
                  <label className="his-label" htmlFor="rc-age">Age (yrs)</label>
                  <input id="rc-age" className={`his-field ${errors.age ? "his-field--err" : ""}`} type="number"
                    value={patient.age || (patient.dateOfBirth ? calcAge(patient.dateOfBirth) : "")}
                    onChange={e => setP("age", e.target.value)} placeholder="35" />
                </div>
                <div className="his-field-group">
                  <label className="his-label" htmlFor="rc-phone">Phone<span className="rc-req">*</span></label>
                  <input id="rc-phone" className={`his-field ${errors.contactNumber ? "his-field--err" : ""}`} type="tel" maxLength={10}
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
                    {pincodeLookup.loading && <span className="rc-pin-status rc-pin-status--loading">⏳ looking up…</span>}
                    {pincodeLookup.ok      && <span className="rc-pin-status rc-pin-status--ok">✓ found</span>}
                    {pincodeLookup.error   && (
                      <>
                        <span className="rc-pin-status rc-pin-status--err">⚠ {pincodeLookup.error}</span>
                        <button
                          type="button"
                          onClick={retryPincodeLookup}
                          style={{
                            marginLeft: 8, padding: "2px 8px", fontSize: 10, fontWeight: 700,
                            background: "#fff", color: "#1e40af",
                            border: "1.5px solid #c7d2fe", borderRadius: 6, cursor: "pointer",
                            textTransform: "uppercase", letterSpacing: ".4px",
                          }}
                        >
                          ↻ Retry
                        </button>
                      </>
                    )}
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
                  <span className="rc-section-sublabel">
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
                    <>
                      <div className="his-field-group">
                        <label className="his-label">TPA / Insurance Provider{TPA_MANDATORY(visitType) && <span className="rc-req">*</span>}</label>
                        <select className={`his-select ${errors.tpa ? "his-field--err" : ""}`} value={patient.tpa || ""}
                          onChange={e => setP("tpa", e.target.value)}>
                          <option value="">— Select TPA —</option>
                          {tpaList.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        {errors.tpa && <span className="rc-err">{errors.tpa}</span>}
                      </div>
                      <div className="his-field-group">
                        <label className="his-label">Policy Number{patient.paymentType === "TPA" && <span className="rc-req">*</span>}</label>
                        <input className={`his-field ${errors.policyNumber ? "his-field--err" : ""}`}
                          value={patient.policyNumber || ""}
                          onChange={e => setP("policyNumber", e.target.value)}
                          placeholder="e.g. POL-2026-001234" />
                        {errors.policyNumber && <span className="rc-err">{errors.policyNumber}</span>}
                      </div>
                    </>
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
                    <input className="his-field" type="number" min="0" value={ipd.expectedStayDays}
                      onChange={e => {
                        const days = e.target.value;
                        // Auto-compute Expected Discharge = today + days
                        const n = parseInt(days);
                        let nextDischarge = ipd.expectedDischargeDate;
                        if (!isNaN(n) && n >= 0) {
                          const d = new Date();
                          d.setHours(0, 0, 0, 0);
                          d.setDate(d.getDate() + n);
                          nextDischarge = d.toISOString().slice(0, 10);
                        }
                        setIpd(p => ({ ...p, expectedStayDays: days, expectedDischargeDate: nextDischarge }));
                      }} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">
                      Expected Discharge
                      <span className="rc-section-sublabel">
                        (auto from stay days — editable)
                      </span>
                    </label>
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
                  {/* Procedure Type dropdown removed 2026-05-17 — the
                      field was never sent to the admissions API so
                      capturing it just added a useless click. The
                      procedure category lives on the doctor's order
                      sheet instead, where it actually drives billing. */}
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
                  <>
                    <div className="his-field-group">
                      <label className="his-label">MLC Number<span className="rc-req">*</span></label>
                      <input className={`his-field ${errors.mlc ? "his-field--err" : ""}`} value={er.mlcNumber}
                        onChange={e => setEr(p => ({ ...p, mlcNumber: e.target.value }))} placeholder="MLC-YYYY-NNNN" />
                      {errors.mlc && <span className="rc-err">{errors.mlc}</span>}
                    </div>
                    <div className="his-field-group">
                      <label className="his-label">Police Station</label>
                      <input className="his-field" value={er.policeStation}
                        onChange={e => setEr(p => ({ ...p, policeStation: e.target.value }))}
                        placeholder="e.g. Sector 5 PS, Faridabad" />
                    </div>
                    <label className={`rc-check ${er.informedPolice ? "rc-check--active" : ""}`}>
                      <input type="checkbox" checked={er.informedPolice}
                        onChange={e => setEr(p => ({ ...p, informedPolice: e.target.checked }))} />
                      Police informed
                    </label>
                  </>
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
                          <span>{s.serviceName} <span className="rc-service-code">· {s.serviceCode}</span></span>
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
                          <span className="rc-service-code--inline">{c.service.serviceCode}</span>
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
        {/* Flips between two modes:
            (a) Live form preview — while the receptionist is filling
                the form, render the form-state-driven receipt summary.
            (b) Post-save success card — after a successful registration,
                show a "Registered ✓" confirmation card with the assigned
                UHID + token (OPD), the total payable, a primary "Print
                Slip" button to re-fire the cash/payment slip (handles
                blocked popups + duplicate-copy requests), and a "New
                Patient" dismiss button. Auto-clears the moment the
                receptionist starts typing the next patient (see the
                useEffect on patient.fullName above). */}
        <div className="rc-receipt">
          <div className="rc-receipt-head">
            <i className={`pi ${lastSaved ? "pi-check-circle" : "pi-receipt"}`} />
            <span className="rc-receipt-head-title">
              {lastSaved ? `${lastSaved.visitType} Registered` : "Live Receipt Preview"}
            </span>
            <span className="rc-receipt-head-badge">
              {lastSaved ? lastSaved.visitType : visitType}
            </span>
          </div>
          {lastSaved ? (
            /* ── Post-save success card ── */
            <div className="rc-receipt-body rc-receipt-saved">
              <div className="rc-receipt-saved-banner">
                <i className="pi pi-check" />
                <div>
                  <div className="rc-receipt-saved-banner-title">Registration complete</div>
                  <div className="rc-receipt-saved-banner-sub">
                    {lastSaved.visitType === "OPD"
                      ? "Cash slip auto-printed. Collect the consultation fee below."
                      : "Cash slip auto-printed. Collect the admission advance below if applicable."}
                  </div>
                </div>
              </div>

              <div>
                <div className="rc-receipt-section-label">Patient</div>
                <div className="rc-receipt-line">
                  <span className="rc-receipt-line-key">Name</span>
                  <span className="rc-receipt-line-value">
                    {[lastSaved.patient.title, lastSaved.patient.fullName].filter(Boolean).join(" ") || "—"}
                  </span>
                </div>
                <div className="rc-receipt-line">
                  <span className="rc-receipt-line-key">UHID</span>
                  <span className="rc-receipt-line-value">{lastSaved.patient.UHID || "—"}</span>
                </div>
                {lastSaved.tokenNumber != null && (
                  <div className="rc-receipt-line">
                    <span className="rc-receipt-line-key">Token #</span>
                    <span className="rc-receipt-line-value">{lastSaved.tokenNumber}</span>
                  </div>
                )}
                <div className="rc-receipt-line">
                  <span className="rc-receipt-line-key">Phone</span>
                  <span className="rc-receipt-line-value">{lastSaved.patient.contactNumber || "—"}</span>
                </div>
              </div>

              <div>
                <div className="rc-receipt-section-label">{lastSaved.visitType} Details</div>
                {lastSaved.visitType === "OPD" && <>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Dept</span><span className="rc-receipt-line-value">{lastSaved.deptLabel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{lastSaved.docLabel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Consult Fee</span><span className="rc-receipt-line-value">{fmtCur(lastSaved.opd?.consultationFee)}</span></div>
                </>}
                {lastSaved.visitType === "IPD" && <>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Dept</span><span className="rc-receipt-line-value">{lastSaved.deptLabel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{lastSaved.docLabel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{lastSaved.bedData?.bedNumber || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Adv Payment</span><span className="rc-receipt-line-value">{fmtCur(lastSaved.ipd?.advancePayment)}</span></div>
                </>}
                {lastSaved.visitType === "Daycare" && <>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Procedure</span><span className="rc-receipt-line-value">{lastSaved.dayCare?.procedureName || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Doctor</span><span className="rc-receipt-line-value">{lastSaved.docLabel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{lastSaved.bedData?.bedNumber || "—"}</span></div>
                </>}
                {lastSaved.visitType === "Emergency" && <>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Triage</span><span className="rc-receipt-line-value">{lastSaved.er?.triageLevel || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Type</span><span className="rc-receipt-line-value">{lastSaved.er?.erType || "—"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">MLC</span><span className="rc-receipt-line-value">{lastSaved.er?.isMLC ? (lastSaved.er.mlcNumber || "Yes") : "No"}</span></div>
                  <div className="rc-receipt-line"><span className="rc-receipt-line-key">Bed</span><span className="rc-receipt-line-value">{lastSaved.bedData?.bedNumber || "—"}</span></div>
                </>}
              </div>

              <div className="rc-receipt-total">
                <span className="rc-receipt-total-label">Total Payable</span>
                <span className="rc-receipt-total-value">{fmtCur(lastSaved.receiptTotal)}</span>
              </div>

              {/* Primary action — context-aware money-collection.
                  Replaces the previous "Print Slip" primary (slip
                  auto-prints inside submit() already; the receptionist's
                  next real task is to take the money). Routes to the
                  Billing Counter with an ?action= hint so the right
                  modal pops open the moment the page loads:
                    OPD       → PaymentModal on the just-created OPD
                                bill (consultation fee). DRAFT bills
                                auto-generate inside PaymentModal per
                                Fix B, so this works for the brand-new
                                DRAFT case too.
                    IPD / DC  → TakeAdvanceModal so the receptionist can
                    / ER        record the admission deposit (cash / UPI
                                / card / cheque) and print the
                                AdvanceReceipt. If `ipd.advancePayment`
                                was already filled on the form, Fix C
                                created the advance + receipt during
                                submit(); this lets the receptionist
                                top up or take a SECOND advance without
                                hunting for the button. */}
              {(() => {
                const isOPD = lastSaved.visitType === "OPD";
                const isAdmissionType = ["IPD", "Daycare", "Emergency"].includes(lastSaved.visitType);
                const action = isOPD ? "opd-payment" : (isAdmissionType ? "advance" : null);
                const label = isOPD
                  ? `Collect Payment · ${fmtCur(lastSaved.receiptTotal)}`
                  : (isAdmissionType
                      ? (Number(lastSaved.ipd?.advancePayment) > 0
                          ? `Collect Additional Advance`
                          : `Collect Advance`)
                      : `Open Billing Counter`);
                const icon = isOPD ? "pi-indian-rupee" : "pi-wallet";
                return (
                  <button
                    type="button"
                    className="rc-btn-print-slip"
                    onClick={() => {
                      const uhid = lastSaved.patient?.UHID;
                      if (!uhid) {
                        toast.error("UHID missing — cannot open billing counter");
                        return;
                      }
                      // Dismiss the success card BEFORE navigating so when
                      // the receptionist comes back the live preview is
                      // clean and ready for the next patient.
                      setLastSaved(null);
                      const qs = action ? `?action=${action}` : "";
                      navigate(`/reception-billing/${encodeURIComponent(uhid)}${qs}`);
                    }}
                  >
                    <i className={`pi ${icon}`} />
                    {label}
                  </button>
                );
              })()}

              {/* Secondary action — dismiss the success card and return
                  to the live form preview. Form is already wiped by the
                  newPatient() call inside submit(), so this is a pure
                  visual reset. Print slip auto-fires during submit(); if
                  the popup got blocked, this button is the escape
                  hatch — keeps reprint available without making it the
                  primary CTA (collecting money is the primary CTA). */}
              <button
                type="button"
                className="rc-btn-new-patient"
                onClick={() => {
                  printReceipt(lastSaved);
                }}
                title="Reprint the cash slip (in case the auto-print was blocked or the patient needs a duplicate)"
              >
                <i className="pi pi-print" />
                Reprint Slip
              </button>
              <button
                type="button"
                className="rc-btn-new-patient"
                onClick={() => setLastSaved(null)}
              >
                <i className="pi pi-plus" />
                Register Another Patient
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>

    </div>
  );
}


/* ═══════════════════════ PRINT RECEIPT ═══════════════════════ */
async function printReceipt({ patient, visitType, opd, ipd, dayCare, er, services, bedData, deptLabel, docLabel, receiptTotal, tokenNumber }) {
  // R7cb-B: live hospital identity from Settings — admin's edits to name /
  // address / GSTIN flow into every slip without a page reload.
  const hs = await fetchHospitalSettings();
  const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const _hospName    = hs.hospitalName || "Hospital";
  const _hospTagline = hs.tagline || "";
  const _addrLine    = [hs.addressLine1, hs.addressLine2, [hs.city, hs.state, hs.pincode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const _phoneLine   = [hs.phone1, hs.phone2, hs.emergencyPhone].filter(Boolean).join(" · ");
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
        <div style="display:flex;align-items:center;gap:12px">
          ${hs.logo ? `<img src="${hs.logo}" alt="" style="max-height:46px;background:#fff;border-radius:6px;padding:4px"/>` : ""}
          <div>
            <div class="hd-title">${esc(_hospName)}</div>
            <div class="hd-sub">${_hospTagline ? esc(_hospTagline) + " · " : ""}Registration Receipt · ${fmt(now)}</div>
            ${_addrLine ? `<div class="hd-sub">${esc(_addrLine)}</div>` : ""}
            ${_phoneLine ? `<div class="hd-sub">${esc(_phoneLine)}</div>` : ""}
            ${hs.gstin ? `<div class="hd-sub">GSTIN: ${esc(hs.gstin)}</div>` : ""}
          </div>
        </div>
        <div class="badge">${visitType.toUpperCase()}</div>
      </div>
      <div class="body">
        ${visitType === "OPD" && tokenNumber ? `
        <div style="margin: 0 0 20px; padding: 18px 14px; border: 3px dashed ${color}; border-radius: 12px; text-align: center; background: ${color}08;">
          <div style="font-size: 10px; font-weight: 800; color: #64748b; letter-spacing: 2px; text-transform: uppercase;">YOUR TOKEN NUMBER</div>
          <div style="font-size: 48px; font-weight: 900; color: ${color}; font-family: 'DM Mono', monospace; line-height: 1.1; margin: 4px 0;">${tokenNumber}</div>
          <div style="font-size: 12px; font-weight: 700; color: #0f172a;">${docLabel || "Doctor"}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Date: ${opd.appointmentDate || ""} &nbsp; Time: ${opd.appointmentTime || ""}</div>
          <div style="margin-top: 8px; padding: 6px 10px; background: white; border-radius: 6px; display: inline-block; font-size: 10px; color: #64748b;">
            Please arrive 15 min before your appointment.<br>
            Show this token at the reception when your number is called.
          </div>
        </div>` : ""}
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
        ${/* R7cf: empty signature lines replaced with the digital
            signature stamp of the issuing user (name + emp ID + role
            + time). */ ""}
        <div class="footer" style="display:flex;justify-content:flex-end;margin:12px 0 4px">
          ${buildPrintIssuerHtml({ escapeHtml: esc })}
        </div>
        <div class="note">Computer-generated receipt — ${esc(_hospName)}${hs.billFooterNote ? " · " + esc(hs.billFooterNote) : ""}</div>
      </div>
    </div></body></html>`;

  const w = window.open("", "_blank", "width=900,height=720");
  if (!w) { alert("Please allow popups to print the receipt"); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 200);
}
