import React, { useState, useEffect, useRef } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";

import { bedService } from "../../Services/bedService";
import { admissionService } from "../../Services/admissionService";
import { wardService } from "../../Services/wardService";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import patientService from "../../Services/patient/patientService";
import { doctorService } from "../../Services/doctors/doctorService";
import useBedEvents from "../../hooks/useBedEvents";
import authFetch    from "../../utils/authFetch";
import { API_ENDPOINTS } from "../../config/api";
import BedSectionHeader from "./BedSectionHeader";
import RequestWardBoyButton from "../ward/RequestWardBoyButton";
import RequestHousekeepingButton from "../ward/RequestHousekeepingButton";
import BedActionMenu from "./BedActionMenu";
import "./bed-mgmt.css";

/* ─── Colors ─────────────────────────────────────────────── */
const TEAL = "#0891b2";
const TEAL_GRAD = "linear-gradient(135deg,#0f766e,#0891b2)";

const STATUS_COLOR = {
  Available: "#22c55e",
  Occupied: "#ef4444",
  Maintenance: "#f59e0b",
  Reserved: "#3b82f6",
  Blocked: "#9ca3af",
};
const STATUS_BG = {
  Available: { bg: "#d1fae5", color: "#065f46" },
  Occupied: { bg: "#fee2e2", color: "#991b1b" },
  Maintenance: { bg: "#fef3c7", color: "#92400e" },
  Reserved: { bg: "#dbeafe", color: "#1e40af" },
  Blocked: { bg: "#f3f4f6", color: "#374151" },
};

// ── Isolation / Precaution colors (NABH IPC.6) ──
// Surfaced as small badges + a left-edge stripe on the bed card.
// Keys match Bed.isolationFlags enum on the backend.
const ISOLATION_STYLE = {
  Contact:     { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", icon: "pi-hand-paper" },
  Droplet:     { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd", icon: "pi-cloud" },
  Airborne:    { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", icon: "pi-wind" },
  Neutropenic: { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd", icon: "pi-shield" },
  MRSA:        { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", icon: "pi-exclamation-triangle" },
  COVID:       { bg: "#fee2e2", color: "#7f1d1d", border: "#f87171", icon: "pi-virus" },
  TB:          { bg: "#ffedd5", color: "#9a3412", border: "#fdba74", icon: "pi-exclamation-circle" },
  VRE:         { bg: "#fae8ff", color: "#86198f", border: "#f0abfc", icon: "pi-exclamation-triangle" },
  CRE:         { bg: "#fce7f3", color: "#9d174d", border: "#f9a8d4", icon: "pi-exclamation-triangle" },
  "C.diff":    { bg: "#fef9c3", color: "#854d0e", border: "#fde047", icon: "pi-exclamation-triangle" },
  Reverse:     { bg: "#ccfbf1", color: "#115e59", border: "#5eead4", icon: "pi-shield" },
};
const PRECAUTION_LEVEL_TINT = {
  Standard: null,            // no stripe
  Enhanced: "#f59e0b",       // amber stripe along the top of the card
  Strict:   "#dc2626",       // red stripe — strict isolation
};

// ── Housekeeping state styles (P1 #5) ──
const HK_STYLE = {
  CleaningPending:    { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", icon: "pi-clock",       label: "Cleaning Pending" },
  CleaningInProgress: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd", icon: "pi-spin pi-spinner", label: "Cleaning In Progress" },
  CleaningDone:       { bg: "#dcfce7", color: "#15803d", border: "#bbf7d0", icon: "pi-check",       label: "Cleaning Done" },
  Inspected:          { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd", icon: "pi-verified",    label: "Inspected" },
};

const DEPTS = [
  "Cardiology",
  "Neurology",
  "Orthopedics",
  "General Medicine",
  "General Surgery",
  "Pediatrics",
  "ICU",
  "Emergency Medicine",
  "Gynecology",
  "Urology",
  "Dermatology",
  "Psychiatry",
  "ENT",
  "Ophthalmology",
];

const ADMISSION_TYPES = [
  { label: "Emergency", value: "Emergency", icon: "pi-bolt", color: "#dc2626" },
  { label: "Planned", value: "Planned", icon: "pi-calendar", color: "#16a34a" },
  {
    label: "Transfer",
    value: "Transfer",
    icon: "pi-arrows-h",
    color: "#9333ea",
  },
  { label: "Day Care", value: "Day Care", icon: "pi-sun", color: "#d97706" },
];

const CONDITIONS = [
  { label: "Stable", color: "#16a34a", icon: "pi-check-circle" },
  { label: "Improved", color: "#0891b2", icon: "pi-thumbs-up" },
  { label: "Critical", color: "#dc2626", icon: "pi-exclamation-triangle" },
  { label: "LAMA", color: "#9333ea", icon: "pi-info-circle" },
];

/* ─── Helpers ────────────────────────────────────────────── */
const getId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.$oid) return v.$oid;
  if (v._id) return getId(v._id);
  return String(v);
};

const nowDTL = () => {
  const d = new Date(),
    p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const getPatientName = (p) => {
  if (!p) return null;
  if (typeof p === "string") return null;
  return (
    p.fullName?.trim() ||
    `${p.firstName || ""} ${p.lastName || ""}`.trim() ||
    p.name?.trim() ||
    null
  );
};

const getDoctorName = (doctorRef, doctorsMap = {}) => {
  if (!doctorRef) return null;
  if (typeof doctorRef === "string") {
    if (!/^[a-f0-9]{24}$/i.test(doctorRef.trim()))
      return doctorRef.trim() || null;
    return doctorsMap[doctorRef] || null;
  }
  return (
    doctorRef.personalInfo?.fullName?.trim() ||
    `${doctorRef.personalInfo?.firstName || ""} ${doctorRef.personalInfo?.lastName || ""}`.trim() ||
    doctorRef.fullName?.trim() ||
    doctorRef.name?.trim() ||
    doctorRef.doctorName?.trim() ||
    `${doctorRef.firstName || ""} ${doctorRef.lastName || ""}`.trim() ||
    null
  );
};

const fuzzyScore = (str = "", q = "") => {
  str = str.toLowerCase();
  q = q.toLowerCase();
  if (!q) return 1;
  if (str === q) return 100;
  if (str.startsWith(q)) return 90;
  if (str.includes(q)) return 70;
  let si = 0,
    qi = 0,
    sc = 0;
  while (si < str.length && qi < q.length) {
    if (str[si] === q[qi]) {
      sc++;
      qi++;
    }
    si++;
  }
  return qi === q.length ? Math.round((sc / q.length) * 50) : 0;
};

const scoreP = (p, q) =>
  Math.max(
    fuzzyScore(p?.UHID || "", q),
    fuzzyScore(getPatientName(p) || "", q),
    fuzzyScore(p?.contactNumber || p?.phone || "", q),
  );

const isMongoId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
const isUHIDVal = (v) =>
  typeof v === "string" && v.trim().length > 0 && !/^[a-f\d]{24}$/i.test(v);

const unwrapPatient = (res) => {
  if (!res || typeof res !== "object") return null;
  if (res.patient && typeof res.patient === "object" && res.patient._id)
    return res.patient;
  if (res.data && typeof res.data === "object") {
    if (res.data.patient && res.data.patient._id) return res.data.patient;
    if (res.data._id) return res.data;
  }
  if (res._id) return res;
  return null;
};

/* ─────────────────────────────────────────────────────────
   ✅ BED ICON — uses Font Awesome <i class="fas fa-bed">
   Add this to your index.html if not already present:
   <link rel="stylesheet"
     href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
───────────────────────────────────────────────────────── */
const BedIcon = ({ status }) => {
  const col = STATUS_COLOR[status] || "#9ca3af";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 10,
        background: `${col}18`,
        border: `1.5px solid ${col}40`,
        flexShrink: 0,
      }}
    >
      <i className="fas fa-bed" style={{ fontSize: 16, color: col }} />
    </span>
  );
};

/* ══════════════════════════════════════════════════════════ */
const BedVisualLayout = ({ onRefreshParent }) => {
  // When mounted inside BedManagement (which already supplies its own
  // header), the parent passes `onRefreshParent`. Used as the "embedded"
  // signal so we skip the standalone BedSectionHeader to avoid two
  // overlapping headers on the /beds page.
  const isEmbedded = typeof onRefreshParent === "function";
  const toast = useRef(null);

  const [beds, setBeds] = useState([]);
  const [shown, setShown] = useState([]);
  const [bldgs, setBldgs] = useState([]);
  const [floors, setFloors] = useState([]);
  const [wards, setWards] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [allFloorsList, setAllFloorsList] = useState([]);
  const [allRoomsList, setAllRoomsList] = useState([]);
  const [allPatients, setAllPats] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorsMap, setDoctorsMap] = useState({});
  const [busy, setBusy] = useState(false);

  const [fBldg, setFBldg] = useState(null);
  const [fFloor, setFFloor] = useState(null);
  const [fWard, setFWard] = useState(null);
  const [fRoom, setFRoom] = useState(null);
  const [fSearch, setFSearch] = useState("");

  const [searchModal, setSearchModal] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [selBed, setSelBed] = useState(null);

  const [admModal, setAdmModal] = useState(false);
  const [selPat, setSelPat] = useState(null);
  const [admForm, setAdmForm] = useState({
    admissionDateTime: "",
    expectedDischargeDate: "",
    department: "General Medicine",
    reasonForAdmission: "",
    admissionType: "Emergency",
    attendingDoctor: "",
    specialInstructions: "",
  });
  const [booking, setBooking] = useState(false);

  const [detailModal, setDetailModal] = useState(false);
  const [detailBed, setDetailBed] = useState(null);
  const [detailAdm, setDetailAdm] = useState(null);
  const [detailPatient, setDetailPatient] = useState(null);
  const [detailLoading, setDetailLoad] = useState(false);

  // ── Drag-drop transfer (P2 #8) ──
  // Drag an occupied bed onto any Available bed → opens a transfer
  // dialog pre-filled with from/to. POSTs /api/bed-transfers using
  // the same 2-stage workflow already exposed via BedTransfersListPage.
  const [dragSrcBed, setDragSrcBed]   = useState(null);   // {_id, ...}
  const [dragOverBedId, setDragOverBedId] = useState(null);
  const [xferDialog, setXferDialog]   = useState(null);   // { from, to } | null
  const [xferReason, setXferReason]   = useState("");
  const [xferNotes,  setXferNotes]    = useState("");
  const [xferDoctor, setXferDoctor]   = useState("");
  const [xferSaving, setXferSaving]   = useState(false);

  // Bed action menu — status-aware popup that opens on bed card click
  const [actionMenuBed, setActionMenuBed] = useState(null);

  const [editModal, setEditModal] = useState(false);
  const [editAdm, setEditAdm] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  const [dischargeModal, setDischargeModal] = useState(false);
  const [dischargeAdm, setDischargeAdm] = useState(null);
  const [dischargeBed, setDischargeBed] = useState(null);
  const [dischargePatient, setDischargePatient] = useState(null);
  const [dischargeForm, setDischargeForm] = useState({
    actualDischargeDate: "",
    dischargeNotes: "",
    dischargeSummary: "",
    totalCost: "",
    conditionOnDischarge: "Stable",
    followUpInstructions: "",
  });
  const [discharging, setDischarging] = useState(false);

  /* ── Modal 6: Discharge Invoice ── */
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);

  /* ── Modal 7: Bed Info / Quick-Edit (isolation flags + equipment) ── */
  const [bedInfoModal,    setBedInfoModal]    = useState(false);
  const [bedInfoBed,      setBedInfoBed]      = useState(null);
  const [bedInfoEditMode, setBedInfoEditMode] = useState(false);
  const [bedInfoForm,     setBedInfoForm]     = useState({});
  const [bedInfoSaving,   setBedInfoSaving]   = useState(false);

  const openBedInfo = (bed, editMode = false) => {
    setActionMenuBed(null);
    if (!bed) return;
    setBedInfoBed(bed);
    setBedInfoEditMode(editMode);
    setBedInfoForm({
      precautionLevel: bed.precautionLevel || "Standard",
      isolationFlags:  Array.isArray(bed.isolationFlags) ? [...bed.isolationFlags] : [],
      isolationNotes:  bed.isolationNotes || "",
      equipment:       Array.isArray(bed.equipment)
        ? bed.equipment.map(e => (typeof e === "string" ? e : (e?.label || e?.type || ""))).filter(Boolean).join(", ")
        : "",
    });
    setBedInfoModal(true);
  };

  const saveBedInfo = async () => {
    if (!bedInfoBed) return;
    setBedInfoSaving(true);
    try {
      const equipArr = (bedInfoForm.equipment || "")
        .split(",").map(s => s.trim()).filter(Boolean)
        .map(label => ({ label, type: label }));
      await bedService.updateBed(getId(bedInfoBed._id), {
        precautionLevel: bedInfoForm.precautionLevel,
        isolationFlags:  bedInfoForm.isolationFlags,
        isolationNotes:  bedInfoForm.isolationNotes,
        equipment:       equipArr,
      });
      toast.current?.show({
        severity: "success",
        summary:  "Saved",
        detail:   `Bed ${bedInfoBed.bedNumber} updated`,
        life:     2500,
      });
      setBedInfoModal(false);
      setBedInfoBed(null);
      await fetchBeds();
      onRefreshParent?.();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary:  "Save failed",
        detail:   e.message || "Could not update bed",
        life:     3500,
      });
    } finally {
      setBedInfoSaving(false);
    }
  };

  const searchResults = searchQ.trim()
    ? allPatients
        .map((p) => ({ p, score: scoreP(p, searchQ.trim()) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((x) => x.p)
    : [];

  useEffect(() => {
    fetchAll();
  }, []);
  useEffect(() => {
    fBldg ? fetchFloors() : (setFloors([]), setFFloor(null));
  }, [fBldg]);
  useEffect(() => {
    if (fFloor) {
      fetchWards();
      fetchRooms();
    } else {
      setWards([]);
      setRooms([]);
      setFWard(null);
      setFRoom(null);
    }
  }, [fFloor]);
  useEffect(() => {
    doFilter();
  }, [beds, fBldg, fFloor, fWard, fRoom, fSearch]);

  const fetchAll = async () => {
    setBusy(true);
    try {
      const [b, bl, pts, docs, allF, allR] = await Promise.all([
        bedService.getAllBeds(),
        buildingService.getAllBuildings(),
        patientService.getAllPatients({ limit: 1000 }),
        doctorService.getAllDoctors().catch(() => []),
        floorService.getAllFloors(),
        roomService.getAllRooms(),
      ]);
      setBeds(Array.isArray(b) ? b : b?.data || []);
      setBldgs(Array.isArray(bl) ? bl : bl?.data || []);
      setAllFloorsList(Array.isArray(allF) ? allF : allF?.data || []);
      setAllRoomsList(Array.isArray(allR) ? allR : allR?.data || []);
      setAllPats(Array.isArray(pts) ? pts : pts?.data || pts?.patients || []);

      let rawDocs = Array.isArray(docs)
        ? docs
        : docs?.data || docs?.doctors || docs?.result || [];
      const dMap = {};
      const dOpts = rawDocs
        .map((d) => {
          const name =
            d.personalInfo?.fullName?.trim() ||
            `${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim() ||
            d.fullName?.trim() ||
            d.name?.trim() ||
            d.doctorName?.trim() ||
            (d.firstName || d.lastName
              ? `${d.firstName || ""} ${d.lastName || ""}`.trim()
              : null) ||
            String(d._id || "Unknown");
          const dept =
            typeof d.department === "string"
              ? d.department
              : d.department?.departmentName ||
                d.department?.name ||
                d.professional?.specialization ||
                d.departmentName ||
                d.specialization ||
                d.specialty ||
                "";
          const id = getId(d._id);
          if (id && name) dMap[id] = name;
          if (d.doctorId) dMap[d.doctorId] = name;
          return {
            label: dept ? `${name} (${dept})` : name,
            value: name,
            _id: id,
          };
        })
        .filter((d) => d.label && d.label !== "Unknown" && d._id);
      setDoctors(dOpts);
      setDoctorsMap(dMap);
    } catch (e) {
      console.error("fetchAll error:", e);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load data",
      });
    } finally {
      setBusy(false);
    }
  };

  const fetchFloors = async () => {
    try {
      const r = await floorService.getAllFloors();
      const all = Array.isArray(r) ? r : r?.data || [];
      setFloors(all.filter((f) => getId(f.building) === fBldg));
    } catch {
      setFloors([]);
    }
  };
  const fetchWards = async () => {
    try {
      const r = await wardService.getAllWards();
      const all = Array.isArray(r) ? r : r?.data || [];
      setWards(all.filter((w) => getId(w.floor) === fFloor));
    } catch {
      setWards([]);
    }
  };
  const fetchRooms = async () => {
    try {
      const r = await roomService.getAllRooms();
      const all = Array.isArray(r) ? r : r?.data || [];
      setRooms(all.filter((rm) => getId(rm.floor) === fFloor));
    } catch {
      setRooms([]);
    }
  };
  const fetchBeds = async () => {
    setBusy(true);
    try {
      const r = await bedService.getAllBeds();
      setBeds(Array.isArray(r) ? r : r?.data || []);
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load beds",
      });
    } finally {
      setBusy(false);
    }
  };

  // ── Real-time refresh (P3 #15, SSE) ──
  // Debounce burst events (e.g. bulk-create fires N) into one refetch
  // ~400ms after the last update so we don't slam /bedss.
  const _refetchTimer = useRef(null);
  useBedEvents(() => {
    if (_refetchTimer.current) clearTimeout(_refetchTimer.current);
    _refetchTimer.current = setTimeout(() => { fetchBeds(); }, 400);
  });

  const doFilter = () => {
    let list = [...beds];
    if (fBldg) list = list.filter((b) => getId(b.building) === fBldg);
    if (fFloor) list = list.filter((b) => getId(b.floor) === fFloor);
    if (fWard) list = list.filter((b) => b.ward && getId(b.ward) === fWard);
    if (fRoom) list = list.filter((b) => getId(b.room) === fRoom);
    if (fSearch) {
      const q = fSearch.toLowerCase();
      list = list.filter(
        (b) =>
          b.bedNumber?.toLowerCase().includes(q) ||
          resolveRoomName(b)?.toLowerCase().includes(q) ||
          resolvePatientName(b.currentAdmission)?.toLowerCase().includes(q),
      );
    }
    setShown(list);
  };

  const resolveFloorName = (bed) => {
    if (!bed) return "?";
    const floorId = getId(bed.floor);
    if (!floorId) return bed.floorNumber ? `Floor ${bed.floorNumber}` : "?";
    const found = allFloorsList.find((f) => getId(f._id) === floorId);
    return (
      found?.floorName ||
      (found?.floorNumber ? `Floor ${found.floorNumber}` : "Floor ?")
    );
  };
  const resolveRoomName = (bed) => {
    if (!bed) return "?";
    const roomId = getId(bed.room);
    if (!roomId) return bed.roomNumber ? `Room ${bed.roomNumber}` : "?";
    const found = allRoomsList.find((r) => getId(r._id) === roomId);
    return (
      found?.roomName ||
      (found?.roomNumber ? `Room ${found.roomNumber}` : "Room ?")
    );
  };
  const resolvePatientName = (adm) => {
    if (!adm) return null;
    if (
      adm.patientName &&
      typeof adm.patientName === "string" &&
      adm.patientName.trim()
    )
      return adm.patientName.trim();
    const fromObj = getPatientName(adm.patientId);
    if (fromObj) return fromObj;
    const pid =
      typeof adm.patientId === "string" ? adm.patientId : getId(adm.patientId);
    if (pid) {
      const found = allPatients.find(
        (p) => getId(p._id) === pid || p.UHID === pid,
      );
      if (found) return getPatientName(found);
    }
    return null;
  };
  const resolveDoctorName = (adm) => {
    if (!adm) return null;
    return (
      getDoctorName(adm.attendingDoctor, doctorsMap) ||
      getDoctorName(adm.doctor, doctorsMap) ||
      null
    );
  };
  const resolvePatientInfo = (adm) => {
    if (!adm) return {};
    const pObj = typeof adm.patientId === "object" ? adm.patientId : null;
    if (pObj)
      return {
        age: pObj.age || (pObj.dateOfBirth ? calcAge(pObj.dateOfBirth) : ""),
        gender: pObj.gender || "",
        uhid: pObj.UHID || adm.UHID || "",
      };
    const pid =
      typeof adm.patientId === "string" ? adm.patientId : getId(adm.patientId);
    if (pid) {
      const found = allPatients.find(
        (p) => getId(p._id) === pid || p.UHID === pid,
      );
      if (found)
        return {
          age:
            found.age || (found.dateOfBirth ? calcAge(found.dateOfBirth) : ""),
          gender: found.gender || "",
          uhid: found.UHID || adm.UHID || "",
        };
    }
    return { uhid: adm.UHID || "", age: "", gender: "" };
  };
  const calcAge = (dob) => {
    if (!dob) return "";
    return Math.floor(
      (Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25),
    );
  };

  const handleAvailable = (bed) => {
    setSelBed(bed);
    setSearchQ("");
    setSearchModal(true);
  };
  // ── UHID resolver for action handlers ──────────────────────────────────
  // Earlier handlers only checked `bed.currentAdmission?.patientId?.UHID`,
  // which is only populated when the beds endpoint deep-populates patient.
  // When that fails the user was sent to a generic /doctor-notes page with
  // no patient context. This walks every reasonable shape:
  //   1. bed.currentAdmission.patientId.UHID         (deep-populated)
  //   2. bed.currentAdmission.UHID                   (admission-level UHID)
  //   3. bed.currentAdmission.patientUHID            (alias)
  //   4. bed.currentUHID                             (some bed snapshots)
  //   5. live admissionService lookup by bedId       (last-resort fetch)
  const resolveBedUHID = async (bed) => {
    if (!bed) return "";
    const ca = bed.currentAdmission;
    if (ca && typeof ca === "object") {
      if (ca.patientId && typeof ca.patientId === "object" && ca.patientId.UHID) return ca.patientId.UHID;
      if (ca.UHID)        return ca.UHID;
      if (ca.patientUHID) return ca.patientUHID;
    }
    if (bed.currentUHID) return bed.currentUHID;
    try {
      const list = await admissionService.getActiveAdmissions();
      const arr = Array.isArray(list) ? list : list?.admissions || list?.data || [];
      const bedId = getId(bed._id);
      const match = arr.find((a) => getId(a.bedId) === bedId || getId(a.bed) === bedId);
      return match?.UHID || match?.patientUHID || match?.patientId?.UHID || "";
    } catch { return ""; }
  };

  const handleOccupied = async (bed) => {
    setDetailBed(bed);
    setDetailPatient(null);
    setDetailAdm(null);
    setDetailLoad(true);
    setDetailModal(true);
    try {
      const bedId = getId(bed._id);
      const ca = bed.currentAdmission;
      if (ca && typeof ca === "object" && ca._id) {
        setDetailAdm(ca);
        const patObj =
          ca.patientId && typeof ca.patientId === "object" && ca.patientId._id
            ? ca.patientId
            : null;
        if (patObj && getPatientName(patObj)) {
          setDetailPatient(patObj);
          setDetailLoad(false);
          return;
        }
        const uhid =
          ca.UHID ||
          ca.patientUHID ||
          (typeof ca.patientId === "string" && isUHIDVal(ca.patientId)
            ? ca.patientId
            : null);
        const objId =
          typeof ca.patientId === "string" && isMongoId(ca.patientId)
            ? ca.patientId
            : getId(ca.patientId);
        if (uhid) {
          try {
            const res = await patientService.getPatientByUHID(uhid);
            const p = unwrapPatient(res);
            if (p && getPatientName(p)) {
              setDetailPatient(p);
              setDetailLoad(false);
              return;
            }
          } catch (_) {}
        }
        if (objId) {
          try {
            const res = await patientService.getPatientById(objId);
            const p = unwrapPatient(res);
            if (p && getPatientName(p)) {
              setDetailPatient(p);
              setDetailLoad(false);
              return;
            }
          } catch (_) {}
        }
        const cached = allPatients.find(
          (p) => (uhid && p.UHID === uhid) || (objId && getId(p._id) === objId),
        );
        if (cached) setDetailPatient(cached);
        setDetailLoad(false);
        return;
      }
      try {
        const activeList = await admissionService.getActiveAdmissions();
        const list = Array.isArray(activeList)
          ? activeList
          : activeList?.admissions || activeList?.data || [];
        const admRecord = list.find(
          (a) => getId(a.bedId) === bedId || getId(a.bed) === bedId,
        );
        if (!admRecord) {
          setDetailLoad(false);
          return;
        }
        setDetailAdm(admRecord);
        const uhid = admRecord.UHID || admRecord.patientUHID || null;
        const objId = isMongoId(getId(admRecord.patientId))
          ? getId(admRecord.patientId)
          : null;
        if (
          admRecord.patientId &&
          typeof admRecord.patientId === "object" &&
          admRecord.patientId._id
        ) {
          const p = admRecord.patientId;
          if (getPatientName(p)) {
            setDetailPatient(p);
            setDetailLoad(false);
            return;
          }
        }
        if (uhid) {
          try {
            const res = await patientService.getPatientByUHID(uhid);
            const p = unwrapPatient(res);
            if (p && getPatientName(p)) {
              setDetailPatient(p);
              setDetailLoad(false);
              return;
            }
          } catch (_) {}
        }
        if (objId) {
          try {
            const res = await patientService.getPatientById(objId);
            const p = unwrapPatient(res);
            if (p && getPatientName(p)) {
              setDetailPatient(p);
              setDetailLoad(false);
              return;
            }
          } catch (_) {}
        }
        const cached = allPatients.find(
          (p) => (uhid && p.UHID === uhid) || (objId && getId(p._id) === objId),
        );
        if (cached) setDetailPatient(cached);
      } catch (e) {
        console.error("[BedLayout] getActiveAdmissions failed:", e?.message);
      }
    } catch (e) {
      console.error("[BedLayout] handleOccupied error:", e);
    } finally {
      setDetailLoad(false);
    }
  };

  // Open the status-aware action menu — replaces the old "go straight
  // to admit / patient details" behavior. Power users can still
  // double-click to skip the menu (handled separately if needed).
  const handleBedClick = (bed) => {
    setActionMenuBed(bed);
  };

  const handlePatientPick = (p) => {
    setSelPat(p);
    setAdmForm({
      admissionDateTime: nowDTL(),
      expectedDischargeDate: "",
      department: "General Medicine",
      reasonForAdmission: "",
      admissionType: "Emergency",
      attendingDoctor: "",
      specialInstructions: "",
    });
    setSearchModal(false);
    setAdmModal(true);
  };

  const handleAdmit = async () => {
    if (!selPat || !selBed) return;
    if (!admForm.reasonForAdmission.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Required",
        detail: "Diagnosis/reason zaroori hai",
      });
      return;
    }
    const cur = beds.find((b) => getId(b._id) === getId(selBed._id));
    if (cur && cur.status !== "Available") {
      toast.current?.show({
        severity: "error",
        summary: "Bed Available Nahi",
        detail: `Bed ${selBed.bedNumber} already ${cur.status} hai`,
        life: 4000,
      });
      setAdmModal(false);
      return;
    }
    setBooking(true);
    const bedId = getId(selBed._id);
    setBeds((prev) =>
      prev.map((b) =>
        getId(b._id) === bedId ? { ...b, status: "Occupied" } : b,
      ),
    );
    try {
      await admissionService.createAdmission({
        patientId: getId(selPat._id),
        UHID: selPat.UHID,
        bedId,
        department: admForm.department,
        admissionDate: new Date(admForm.admissionDateTime).toISOString(),
        expectedDischargeDate: admForm.expectedDischargeDate
          ? new Date(admForm.expectedDischargeDate).toISOString()
          : undefined,
        reasonForAdmission: admForm.reasonForAdmission,
        admissionType: admForm.admissionType,
        attendingDoctor: admForm.attendingDoctor || undefined,
      });
      toast.current?.show({
        severity: "success",
        summary: "Admit Ho Gaya! 🎉",
        detail: `${getPatientName(selPat)} → Bed ${selBed.bedNumber}`,
        life: 5000,
      });
      setAdmModal(false);
      setSelBed(null);
      setSelPat(null);
      await fetchBeds();
      onRefreshParent?.();
    } catch (e) {
      setBeds((prev) =>
        prev.map((b) =>
          getId(b._id) === bedId ? { ...b, status: "Available" } : b,
        ),
      );
      toast.current?.show({
        severity: "error",
        summary: "Admission Failed",
        detail: e?.message || "Kuch gadbad ho gaya",
        life: 5000,
      });
    } finally {
      setBooking(false);
    }
  };

  const openEdit = (adm) => {
    setDetailModal(false);
    setEditAdm(adm);
    setEditForm({
      admissionDateTime: adm.admissionDate
        ? new Date(adm.admissionDate).toISOString().slice(0, 16)
        : nowDTL(),
      expectedDischargeDate: adm.expectedDischargeDate
        ? new Date(adm.expectedDischargeDate).toISOString().slice(0, 10)
        : "",
      department:
        typeof adm.department === "object"
          ? adm.department?.name || "General Medicine"
          : adm.department || "General Medicine",
      reasonForAdmission: adm.reasonForAdmission || "",
      admissionType: adm.admissionType || "Emergency",
      attendingDoctor: resolveDoctorName(adm) || "",
    });
    setEditModal(true);
  };

  const saveEdit = async () => {
    if (!editAdm) return;
    setEditSaving(true);
    try {
      await admissionService.updateAdmission(getId(editAdm._id), {
        admissionDate: editForm.admissionDateTime
          ? new Date(editForm.admissionDateTime).toISOString()
          : undefined,
        expectedDischargeDate: editForm.expectedDischargeDate
          ? new Date(editForm.expectedDischargeDate).toISOString()
          : undefined,
        department: editForm.department,
        reasonForAdmission: editForm.reasonForAdmission,
        admissionType: editForm.admissionType,
        attendingDoctor: editForm.attendingDoctor || undefined,
      });
      toast.current?.show({
        severity: "success",
        summary: "Updated",
        detail: "Admission update ho gaya",
      });
      setEditModal(false);
      await fetchBeds();
      onRefreshParent?.();
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Update fail ho gaya",
      });
    } finally {
      setEditSaving(false);
    }
  };

  const openDischarge = (adm, bed) => {
    // ── New workflow (May 2026) ──
    // The discharge process is now a 4-step pipeline:
    //   1. Doctor fills the proper NABH discharge-summary format
    //   2. Nurse adds the discharge nursing note
    //   3. Reception clears the final payment
    //   4. Finalize → admission becomes Discharged + bed released
    // The simple "condition + notes" modal below is kept only as a
    // fallback for the rare case where we can't resolve the UHID.
    setDetailModal(false);
    const uhid =
      adm?.UHID ||
      adm?.patientUHID ||
      adm?.patientId?.UHID ||
      bed?.currentUHID ||
      "";
    if (uhid) {
      try {
        sessionStorage.setItem(
          "discharge_context",
          JSON.stringify({
            uhid,
            bedId:        getId(bed?._id),
            bedNumber:    bed?.bedNumber,
            admissionId:  getId(adm?._id),
            startedAt:    new Date().toISOString(),
          }),
        );
      } catch (_) {}
      window.location.href = `/discharge-summary?uhid=${encodeURIComponent(uhid)}`;
      return;
    }
    // Fallback: open the legacy simple discharge modal.
    setDischargeAdm(adm);
    setDischargeBed(bed);
    setDischargePatient(detailPatient);
    const now = new Date(),
      p = (n) => String(n).padStart(2, "0");
    setDischargeForm({
      actualDischargeDate: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`,
      dischargeNotes: "",
      dischargeSummary: "",
      totalCost: "",
      conditionOnDischarge: "Stable",
      followUpInstructions: "",
    });
    setDischargeModal(true);
  };

  const doDischarge = async () => {
    if (!dischargeAdm) return;
    setDischarging(true);
    const bedId = getId(dischargeBed?._id || dischargeAdm.bedId);
    setBeds((prev) =>
      prev.map((b) =>
        getId(b._id) === bedId
          ? { ...b, status: "Available", currentAdmission: null }
          : b,
      ),
    );
    try {
      await admissionService.dischargePatient(getId(dischargeAdm._id), {
        actualDischargeDate: dischargeForm.actualDischargeDate
          ? new Date(dischargeForm.actualDischargeDate).toISOString()
          : new Date().toISOString(),
        dischargeNotes: dischargeForm.dischargeNotes,
        dischargeSummary: dischargeForm.dischargeSummary,
        conditionOnDischarge: dischargeForm.conditionOnDischarge,
        followUpInstructions: dischargeForm.followUpInstructions,
        totalCost: dischargeForm.totalCost
          ? Number(dischargeForm.totalCost)
          : undefined,
      });
      toast.current?.show({
        severity: "success",
        summary: "Discharge Ho Gaya! ✓",
        detail: `Bed ${dischargeBed?.bedNumber || ""} ab Available hai`,
        life: 5000,
      });
      // ✅ Save invoice data before clearing state
      setInvoiceData({
        patient: dischargePatient,
        admission: dischargeAdm,
        bed: dischargeBed,
        form: { ...dischargeForm },
        dischargedAt: new Date().toISOString(),
      });
      setDischargeModal(false);
      setDischargeAdm(null);
      setDischargeBed(null);
      setDischargePatient(null);
      await fetchBeds();
      onRefreshParent?.();
      setInvoiceModal(true);
    } catch (e) {
      setBeds((prev) =>
        prev.map((b) =>
          getId(b._id) === bedId ? { ...b, status: "Occupied" } : b,
        ),
      );
      toast.current?.show({
        severity: "error",
        summary: "Discharge Failed",
        detail: e?.message || "Ho nahi saka",
        life: 5000,
      });
    } finally {
      setDischarging(false);
    }
  };

  /* ══ PRINT INVOICE ══ */
  const printInvoice = () => {
    if (!invoiceData) return;
    const { patient, admission, bed, form, dischargedAt } = invoiceData;
    const pName = getPatientName(patient) || admission?.patientName || "—";
    const uhid = patient?.UHID || admission?.UHID || "—";
    const admDate = admission?.admissionDate
      ? new Date(admission.admissionDate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
    const disDate = form.actualDischargeDate
      ? new Date(form.actualDischargeDate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : new Date(dischargedAt).toLocaleDateString("en-IN");
    const days = admission?.admissionDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(form.actualDischargeDate || dischargedAt) -
              new Date(admission.admissionDate)) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : "—";
    const dept =
      typeof admission?.department === "object"
        ? admission?.department?.name
        : admission?.department || "—";
    const doctor = resolveDoctorName(admission) || "—";
    const cost = form.totalCost
      ? `₹ ${Number(form.totalCost).toLocaleString("en-IN")}`
      : "—";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Discharge Invoice</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #1e293b; background:#fff; }
    .page { width:210mm; min-height:297mm; margin:0 auto; padding:12mm 14mm; }
    /* Header */
    .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12px; border-bottom:3px solid #0891b2; margin-bottom:18px; }
    .hospital-name { font-size:22px; font-weight:800; color:#0891b2; letter-spacing:-0.5px; }
    .hospital-sub  { font-size:11px; color:#64748b; margin-top:3px; }
    .invoice-badge { text-align:right; }
    .invoice-badge .inv-title { font-size:18px; font-weight:700; color:#dc2626; }
    .invoice-badge .inv-no    { font-size:11px; color:#64748b; margin-top:2px; }
    /* Status strip */
    .status-strip { background:linear-gradient(135deg,#dc2626,#b91c1c); color:#fff; borderRadius:10px; padding:10px 18px; display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; border-radius:8px; }
    .status-strip .label { font-size:11px; opacity:.8; }
    .status-strip .value { font-size:14px; font-weight:700; margin-top:1px; }
    /* Grid sections */
    .section-title { font-size:12px; font-weight:700; color:#0891b2; text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; padding-bottom:4px; border-bottom:1px solid #e2e8f0; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; margin-bottom:18px; }
    .info-item .lbl { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; }
    .info-item .val { font-size:13px; font-weight:600; color:#0f172a; margin-top:2px; }
    /* Summary box */
    .summary-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px; margin-bottom:18px; font-size:13px; color:#374151; line-height:1.6; }
    .summary-box .no-content { color:#94a3b8; font-style:italic; }
    /* Cost table */
    .cost-table { width:100%; border-collapse:collapse; margin-bottom:18px; }
    .cost-table th { background:#0891b2; color:#fff; padding:9px 14px; font-size:12px; text-align:left; }
    .cost-table td { padding:9px 14px; font-size:13px; border-bottom:1px solid #f1f5f9; }
    .cost-table .total-row td { font-weight:700; font-size:14px; background:#f0f9ff; color:#0891b2; }
    /* Condition badge */
    .condition { display:inline-block; padding:4px 14px; border-radius:20px; font-size:12px; font-weight:700; }
    .Stable   { background:#d1fae5; color:#065f46; }
    .Improved { background:#dbeafe; color:#1e40af; }
    .Critical { background:#fee2e2; color:#991b1b; }
    .LAMA     { background:#ede9fe; color:#5b21b6; }
    /* Footer */
    .footer { margin-top:auto; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:flex-end; }
    .sign-box { text-align:center; }
    .sign-line { width:140px; border-bottom:1px solid #374151; margin-bottom:4px; height:36px; }
    .sign-label { font-size:10px; color:#64748b; }
    .footer-note { font-size:10px; color:#94a3b8; text-align:center; margin-top:8px; }
    @media print {
      body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page { padding:8mm 10mm; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="hospital-name">Spherehealth Medical Solutions</div>
      <div class="hospital-sub">Complete Healthcare Management System</div>
    </div>
    <div class="invoice-badge">
      <div class="inv-title">DISCHARGE INVOICE</div>
      <div class="inv-no">Date: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
    </div>
  </div>

  <!-- Status strip -->
  <div class="status-strip">
    <div><div class="label">Patient Name</div><div class="value">${pName}</div></div>
    <div><div class="label">UHID</div><div class="value">${uhid}</div></div>
    <div><div class="label">Bed</div><div class="value">${bed?.bedNumber || "—"}</div></div>
    <div><div class="label">Condition</div><div class="value">${form.conditionOnDischarge || "Stable"}</div></div>
  </div>

  <!-- Patient & Admission Info -->
  <div class="section-title">Patient & Admission Details</div>
  <div class="info-grid">
    <div class="info-item"><div class="lbl">Patient Name</div><div class="val">${pName}</div></div>
    <div class="info-item"><div class="lbl">UHID / Patient ID</div><div class="val">${uhid}</div></div>
    <div class="info-item"><div class="lbl">Admission Date</div><div class="val">${admDate}</div></div>
    <div class="info-item"><div class="lbl">Discharge Date</div><div class="val">${disDate}</div></div>
    <div class="info-item"><div class="lbl">Total Stay</div><div class="val">${days} Day${days !== 1 ? "s" : ""}</div></div>
    <div class="info-item"><div class="lbl">Bed Number</div><div class="val">${bed?.bedNumber || "—"}</div></div>
    <div class="info-item"><div class="lbl">Department</div><div class="val">${dept}</div></div>
    <div class="info-item"><div class="lbl">Admission Type</div><div class="val">${admission?.admissionType || "—"}</div></div>
    <div class="info-item"><div class="lbl">Attending Doctor</div><div class="val">${doctor}</div></div>
    <div class="info-item"><div class="lbl">Condition on Discharge</div><div class="val"><span class="condition ${form.conditionOnDischarge || "Stable"}">${form.conditionOnDischarge || "Stable"}</span></div></div>
  </div>

  <!-- Clinical Notes -->
  <div class="section-title">Clinical Summary</div>
  <div style="margin-bottom:10px">
    <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px">DIAGNOSIS / REASON FOR ADMISSION</div>
    <div class="summary-box">${admission?.reasonForAdmission || '<span class="no-content">Not specified</span>'}</div>
  </div>
  <div style="margin-bottom:10px">
    <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px">DISCHARGE SUMMARY</div>
    <div class="summary-box">${form.dischargeSummary || '<span class="no-content">Not provided</span>'}</div>
  </div>
  <div style="margin-bottom:10px">
    <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px">DISCHARGE NOTES</div>
    <div class="summary-box">${form.dischargeNotes || '<span class="no-content">Not provided</span>'}</div>
  </div>
  <div style="margin-bottom:18px">
    <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:4px">FOLLOW-UP INSTRUCTIONS</div>
    <div class="summary-box">${form.followUpInstructions || '<span class="no-content">Not provided</span>'}</div>
  </div>

  <!-- Cost -->
  <div class="section-title">Billing Summary</div>
  <table class="cost-table">
    <thead><tr><th>Description</th><th>Details</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      <tr><td>Bed Charges (${days} day${days !== 1 ? "s" : ""})</td><td>Bed ${bed?.bedNumber || "—"} · ${dept}</td><td style="text-align:right">${cost}</td></tr>
      <tr class="total-row"><td colspan="2"><strong>Total Amount</strong></td><td style="text-align:right"><strong>${cost}</strong></td></tr>
    </tbody>
  </table>

  <!-- Signatures -->
  <div class="footer">
    <div class="sign-box"><div class="sign-line"></div><div class="sign-label">Patient / Attendant Signature</div></div>
    <div class="sign-box"><div class="sign-line"></div><div class="sign-label">Attending Doctor</div></div>
    <div class="sign-box"><div class="sign-line"></div><div class="sign-label">Authorized Signatory</div></div>
  </div>
  <div class="footer-note">This is a computer-generated document. For queries contact the billing department.</div>

</div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  const byFloor = (() => {
    const map = {};
    shown.forEach((bed) => {
      const fk = resolveFloorName(bed);
      if (!map[fk]) map[fk] = { rooms: {} };
      const rk = String(getId(bed.room) || `nr_${getId(bed._id)}`);
      if (!map[fk].rooms[rk])
        map[fk].rooms[rk] = { roomName: resolveRoomName(bed), beds: [] };
      map[fk].rooms[rk].beds.push(bed);
    });
    return map;
  })();

  const canBook =
    !!selPat &&
    !!admForm.department &&
    !!admForm.admissionDateTime &&
    !!admForm.reasonForAdmission.trim();
  const lbl = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
  };

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", padding: isEmbedded ? 0 : "20px 28px", background: isEmbedded ? "transparent" : "#f1f5f9", minHeight: isEmbedded ? "auto" : "100vh" }}>
      <Toast ref={toast} />

      {/* ══ DISCHARGE DIALOG SCROLL FIX ══ */}
      <style>{`
        .discharge-dlg .p-dialog-content {
          padding: 0 !important;
          overflow: hidden !important;
        }
      `}</style>

      {/* Standalone-only Bed Management theme header */}
      {!isEmbedded && (
        <BedSectionHeader
          title="Live Bed Map"
          subtitle="Admit, transfer, discharge — by building / floor / ward / room"
          icon="pi-eye"
          actions={
            <Button
              icon="pi pi-refresh"
              label="Refresh"
              onClick={fetchBeds}
              loading={busy}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
              }}
            />
          }
        />
      )}

      {/* ── FILTER BAR (redesigned) ── */}
      {(() => {
        const FILTERS_CONF = [
          {
            key: "bldg", icon: "pi-building",
            val: fBldg, ph: "All Buildings",
            opts: bldgs.map((b) => ({ label: b.buildingName, value: b._id })),
            findLabel: (v) => bldgs.find((b) => b._id === v)?.buildingName,
            onChange: (v) => { setFBldg(v); setFFloor(null); setFWard(null); setFRoom(null); },
            disabled: false,
            color: "#0891b2",
          },
          {
            key: "floor", icon: "pi-arrows-v",
            val: fFloor, ph: "All Floors",
            opts: floors.map((f) => ({ label: f.floorName || `Floor ${f.floorNumber}`, value: f._id })),
            findLabel: (v) => {
              const f = floors.find((x) => x._id === v);
              return f ? (f.floorName || `Floor ${f.floorNumber}`) : null;
            },
            onChange: (v) => { setFFloor(v); setFWard(null); setFRoom(null); },
            disabled: !fBldg,
            color: "#ea580c",
          },
          {
            key: "ward", icon: "pi-home",
            val: fWard, ph: "All Wards",
            opts: wards.map((w) => ({ label: w.wardName, value: w._id })),
            findLabel: (v) => wards.find((w) => w._id === v)?.wardName,
            onChange: setFWard,
            disabled: !fFloor,
            color: "#2563eb",
          },
          {
            key: "room", icon: "pi-box",
            val: fRoom, ph: "All Rooms",
            opts: rooms.map((r) => ({ label: r.roomNumber, value: r._id })),
            findLabel: (v) => rooms.find((r) => r._id === v)?.roomNumber,
            onChange: setFRoom,
            disabled: !fFloor,
            color: "#7c3aed",
          },
        ];
        const activeChips = FILTERS_CONF
          .filter((f) => f.val)
          .map((f) => ({ ...f, label: f.findLabel(f.val) || "—" }));
        const hasSearch = (fSearch || "").trim().length > 0;
        const anyActive = activeChips.length > 0 || hasSearch;
        const clearAll = () => {
          setFBldg(null); setFFloor(null); setFWard(null); setFRoom(null); setFSearch("");
        };

        return (
          <div className="bm-bv-filterbar">
            <div className="bm-bv-filterbar__head">
              <div className="bm-bv-filterbar__title">
                <i className="pi pi-filter" style={{ color: TEAL, fontSize: 12 }} />
                Filters
                {anyActive && (
                  <span style={{
                    background: TEAL, color: "#fff",
                    fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px",
                    padding: "2px 7px", borderRadius: 999, marginLeft: 4,
                  }}>
                    {activeChips.length + (hasSearch ? 1 : 0)} active
                  </span>
                )}
              </div>

              {anyActive ? (
                <div className="bm-bv-filterbar__chips">
                  {hasSearch && (
                    <span className="bm-bv-filterbar__chip" style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }}>
                      <i className="pi pi-search" style={{ fontSize: 9 }} />
                      "{fSearch.length > 14 ? fSearch.slice(0, 14) + "…" : fSearch}"
                      <button onClick={() => setFSearch("")} title="Clear search">×</button>
                    </span>
                  )}
                  {activeChips.map((c) => (
                    <span key={c.key} className="bm-bv-filterbar__chip"
                      style={{ background: `${c.color}1a`, color: c.color, borderColor: `${c.color}55` }}>
                      <i className={`pi ${c.icon}`} style={{ fontSize: 9 }} />
                      {c.label}
                      <button onClick={() => c.onChange(null)} title={`Clear ${c.key}`}>×</button>
                    </span>
                  ))}
                  <button
                    onClick={clearAll}
                    style={{
                      background: "transparent", color: "#64748b",
                      border: "1.5px solid #e2e8f0", borderRadius: 999,
                      padding: "3px 11px", fontSize: 10.5, fontWeight: 800,
                      cursor: "pointer", fontFamily: "inherit",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <i className="pi pi-filter-slash" style={{ fontSize: 9 }} />
                    Clear all
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
                  <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
                  Showing every bed — narrow down using the controls below
                </span>
              )}
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
              gap: 10,
            }}>
              {/* Search input */}
              <div className={`bm-input`} style={{ height: 38 }}>
                <i className="pi pi-search bm-input__icon" />
                <input
                  value={fSearch}
                  onChange={(e) => setFSearch(e.target.value)}
                  placeholder="Search beds or patients…"
                  style={{ width: "100%", border: "none", outline: "none", padding: "9px 12px", fontSize: 13, background: "transparent", fontFamily: "inherit" }}
                />
                {fSearch && (
                  <button onClick={() => setFSearch("")}
                    style={{
                      background: "transparent", border: "none", color: "#94a3b8",
                      cursor: "pointer", padding: "0 10px", fontSize: 13,
                    }}
                    title="Clear search">
                    <i className="pi pi-times-circle" />
                  </button>
                )}
              </div>

              {/* Dropdowns with icon prefix */}
              {FILTERS_CONF.map((f) => (
                <div key={f.key}
                  className={`bm-input ${f.disabled ? "" : ""}`}
                  style={{
                    height: 38,
                    opacity: f.disabled ? 0.55 : 1,
                    background: f.val ? `${f.color}10` : "#fff",
                    borderColor: f.val ? `${f.color}55` : "#e2e8f0",
                  }}>
                  <i className={`pi ${f.icon} bm-input__icon`}
                    style={{ color: f.val ? f.color : "#94a3b8" }} />
                  <Dropdown
                    value={f.val}
                    showClear
                    disabled={f.disabled}
                    options={f.opts}
                    onChange={(e) => f.onChange(e.value)}
                    placeholder={f.ph}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── BED GRID ── */}
      {busy ? (
        <div
          style={{
            textAlign: "center",
            padding: 80,
            background: "#fff",
            borderRadius: 16,
          }}
        >
          <i
            className="pi pi-spin pi-spinner"
            style={{ fontSize: 40, color: TEAL }}
          />
          <p style={{ marginTop: 12, color: "#64748b" }}>
            Beds load ho rahe hain…
          </p>
        </div>
      ) : Object.keys(byFloor).length === 0 ? (
        (() => {
          const hasFilters = fBldg || fFloor || fWard || fRoom || (fSearch || "").trim();
          const noBedsAtAll = beds.length === 0;
          return (
            <div className="bm-bv-empty">
              <div className="bm-bv-empty__icon">
                <i className={`pi ${noBedsAtAll ? "pi-th-large" : "pi-search"}`} />
              </div>
              <div className="bm-bv-empty__title">
                {noBedsAtAll ? "No beds configured yet" : "No beds match your filters"}
              </div>
              <div className="bm-bv-empty__msg">
                {noBedsAtAll
                  ? "Set up your first bed to start admitting patients here. Bulk-create lets you add many at once."
                  : "Try widening the filters or clearing one of the chips above. The Live Bed Map shows every bed across every building and floor."}
              </div>
              <div className="bm-bv-empty__cta-row">
                {noBedsAtAll ? (
                  <>
                    <a href="/beds" className="bm-bv-empty__cta bm-bv-empty__cta--primary">
                      <i className="pi pi-plus" /> Add beds
                    </a>
                    <a href="/wards" className="bm-bv-empty__cta bm-bv-empty__cta--ghost">
                      <i className="pi pi-home" /> Configure wards first
                    </a>
                  </>
                ) : hasFilters && (
                  <button
                    onClick={() => {
                      setFBldg(null); setFFloor(null); setFWard(null); setFRoom(null); setFSearch("");
                    }}
                    className="bm-bv-empty__cta bm-bv-empty__cta--primary">
                    <i className="pi pi-filter-slash" /> Clear all filters
                  </button>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        Object.entries(byFloor)
          .sort()
          .map(([floorLabel, floorData]) => (
            <div
              key={floorLabel}
              style={{
                background: "#fff",
                borderRadius: 20,
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 20px rgba(0,0,0,.07)",
                overflow: "hidden",
                marginBottom: 20,
              }}
            >
              {(() => {
                // Per-floor full status breakdown for the banner
                const allBeds = Object.values(floorData.rooms).flatMap(r => r.beds);
                const by = (s) => allBeds.filter(b => b.status === s).length;
                const total      = allBeds.length;
                const occupied   = by("Occupied");
                const available  = by("Available");
                const maint      = by("Maintenance");
                const reserved   = by("Reserved");
                const blocked    = by("Blocked");
                const isolation  = allBeds.filter(b => Array.isArray(b.isolationFlags) && b.isolationFlags.length > 0).length;
                const pct        = total > 0 ? Math.round((occupied / total) * 100) : 0;
                const STAT_PILL = (label, value, bg, c, icon) => (
                  <span style={{
                    background: bg, color: c, borderRadius: 999,
                    padding: "3px 12px", fontSize: 11, fontWeight: 800,
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    <i className={`pi ${icon}`} style={{ fontSize: 10 }} />
                    {label}: {value}
                  </span>
                );
                return (
                  <div
                    style={{
                      background: TEAL_GRAD,
                      padding: "14px 22px",
                      color: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <i className="pi pi-building" style={{ color: "#fff", fontSize: 18 }} />
                      <span style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>
                        {floorLabel}
                      </span>
                      <span style={{
                        background: "rgba(255,255,255,.18)", color: "#fff",
                        borderRadius: 999, padding: "2px 11px", fontSize: 11, fontWeight: 700,
                      }}>
                        {total} bed{total === 1 ? "" : "s"}
                      </span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {STAT_PILL("Available", available, "#d1fae5", "#065f46", "pi-check-circle")}
                        {STAT_PILL("Occupied",  occupied,  "#fee2e2", "#991b1b", "pi-user")}
                        {reserved > 0 && STAT_PILL("Reserved", reserved, "#dbeafe", "#1e40af", "pi-bookmark")}
                        {maint    > 0 && STAT_PILL("Maintenance", maint, "#fef3c7", "#92400e", "pi-wrench")}
                        {blocked  > 0 && STAT_PILL("Blocked", blocked, "#f1f5f9", "#475569", "pi-ban")}
                        {isolation > 0 && STAT_PILL("Isolation", isolation, "#fee2e2", "#7f1d1d", "pi-shield")}
                      </div>
                    </div>

                    {/* Occupancy bar */}
                    {total > 0 && (
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          flex: 1, height: 6, background: "rgba(255,255,255,.2)",
                          borderRadius: 999, overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${pct}%`, height: "100%",
                            background: pct > 85 ? "#fca5a5" : pct > 65 ? "#fcd34d" : "#86efac",
                            transition: "width .4s",
                          }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                          {pct}% occupancy
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))",
                  gap: 16,
                  padding: 20,
                }}
              >
                {Object.values(floorData.rooms).map((grp, ri) => (
                  <div
                    key={ri}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: "#fafafa",
                    }}
                  >
                    {(() => {
                      // Per-room mini occupancy — used inside the ward header
                      const total = grp.beds.length;
                      const occ   = grp.beds.filter(b => b.status === "Occupied").length;
                      const avail = grp.beds.filter(b => b.status === "Available").length;
                      const pct   = total > 0 ? Math.round((occ / total) * 100) : 0;

                      // Pick a ward-type tint from one of the beds in the group.
                      // Falls back to teal for unknown types.
                      const wardType = grp.beds[0]?.ward?.wardType
                        || (grp.beds[0]?.wardName || "").match(/ICU|Emergency|Pedia|Female|Male|Private/i)?.[0]
                        || "";
                      const TINT = (() => {
                        const t = String(wardType).toLowerCase();
                        if (t.includes("icu") || t.includes("ccu") || t.includes("isolation"))
                          return { stripe: "#dc2626", soft: "#fee2e2", text: "#991b1b", icon: "pi-heart-fill" };
                        if (t.includes("emergency"))
                          return { stripe: "#d97706", soft: "#fef3c7", text: "#92400e", icon: "pi-bolt" };
                        if (t.includes("pedia"))
                          return { stripe: "#ea580c", soft: "#ffedd5", text: "#9a3412", icon: "pi-users" };
                        if (t.includes("female") || t.includes("maternity"))
                          return { stripe: "#db2777", soft: "#fce7f3", text: "#9d174d", icon: "pi-heart" };
                        if (t.includes("male"))
                          return { stripe: "#2563eb", soft: "#dbeafe", text: "#1e40af", icon: "pi-home" };
                        if (t.includes("private"))
                          return { stripe: "#d97706", soft: "#fef3c7", text: "#92400e", icon: "pi-star" };
                        return { stripe: TEAL, soft: "#ccfbf1", text: "#115e59", icon: "pi-home" };
                      })();

                      return (
                        <div
                          style={{
                            padding: "10px 14px",
                            background: `linear-gradient(to right, ${TINT.soft}, #fff 65%)`,
                            borderBottom: "1px solid #f1f5f9",
                            borderLeft: `4px solid ${TINT.stripe}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                            <span style={{
                              width: 30, height: 30, borderRadius: 8,
                              background: "#fff",
                              border: `1.5px solid ${TINT.stripe}33`,
                              color: TINT.stripe,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 13, flexShrink: 0,
                              boxShadow: `0 2px 6px ${TINT.stripe}22`,
                            }}>
                              <i className={`pi ${TINT.icon}`} />
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", lineHeight: 1.1 }}>
                                {grp.roomName}
                              </div>
                              <div style={{ fontSize: 10.5, color: TINT.text, fontWeight: 700, marginTop: 2, letterSpacing: ".3px" }}>
                                {total} bed{total !== 1 ? "s" : ""} · {avail} available · {occ} occupied
                              </div>
                            </div>
                          </div>

                          {/* mini occupancy bar + % */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
                            <div style={{
                              flex: 1, height: 5, background: "#f1f5f9",
                              borderRadius: 999, overflow: "hidden", minWidth: 60,
                            }}>
                              <div style={{
                                width: `${pct}%`, height: "100%",
                                background: pct > 85 ? "linear-gradient(90deg,#ef4444,#dc2626)"
                                          : pct > 65 ? "linear-gradient(90deg,#f59e0b,#d97706)"
                                                     : "linear-gradient(90deg,#22c55e,#16a34a)",
                                transition: "width .4s",
                              }} />
                            </div>
                            <span style={{
                              fontSize: 11, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap",
                              background: "#fff", border: "1px solid #e2e8f0",
                              borderRadius: 6, padding: "2px 7px",
                            }}>
                              {pct}%
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                    <div
                      style={{
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {grp.beds.map((bed) => {
                        const avail = bed.status === "Available";
                        const occ   = bed.status === "Occupied";
                        const res   = bed.status === "Reserved";
                        const mnt   = bed.status === "Maintenance";
                        const blk   = bed.status === "Blocked";
                        const adm   = bed.currentAdmission;
                        const pName = resolvePatientName(adm);
                        const pInfo = occ ? resolvePatientInfo(adm) : {};
                        const docName = occ ? resolveDoctorName(adm) : null;
                        const admDate = adm?.admissionDate ? new Date(adm.admissionDate) : null;
                        const admDays = admDate ? Math.max(1, Math.ceil((Date.now() - admDate.getTime()) / 86400000)) : null;
                        const flags = Array.isArray(bed.isolationFlags)
                          ? bed.isolationFlags.filter(f => ISOLATION_STYLE[f]) : [];
                        const hkState  = bed.housekeeping?.state;
                        const hk       = hkState && hkState !== "Idle" ? HK_STYLE[hkState] : null;
                        const equipment = Array.isArray(bed.equipment) ? bed.equipment : [];

                        // Drag-drop transfer hooks (P2 #8)
                        const isDragSource = dragSrcBed && getId(dragSrcBed._id) === getId(bed._id);
                        const isDropTarget = dragOverBedId === getId(bed._id) && avail && dragSrcBed && getId(dragSrcBed._id) !== getId(bed._id);
                        const canDrag = occ;
                        const canDrop = avail && dragSrcBed;

                        const variant = avail ? "avail" : occ ? "occ" : res ? "res" : mnt ? "maint" : blk ? "blocked" : "avail";
                        const classes = [
                          "bm-bed-card",
                          `bm-bed-card--${variant}`,
                          isDropTarget && "bm-bed-card--drop-target",
                          isDragSource && "bm-bed-card--drag-source",
                        ].filter(Boolean).join(" ");

                        return (
                          <div
                            key={bed._id}
                            className={classes}
                            draggable={canDrag}
                            onDragStart={(e) => {
                              if (!canDrag) return;
                              setDragSrcBed(bed);
                              e.dataTransfer.effectAllowed = "move";
                              try { e.dataTransfer.setData("text/plain", String(bed._id)); } catch (_) {}
                            }}
                            onDragEnd={() => { setDragSrcBed(null); setDragOverBedId(null); }}
                            onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                            onDragEnter={(e) => { if (canDrop) { e.preventDefault(); setDragOverBedId(getId(bed._id)); } }}
                            onDragLeave={() => { if (dragOverBedId === getId(bed._id)) setDragOverBedId(null); }}
                            onDrop={(e) => {
                              if (!canDrop) return;
                              e.preventDefault();
                              setDragOverBedId(null);
                              setXferDialog({ from: dragSrcBed, to: bed });
                              setXferReason(""); setXferNotes(""); setXferDoctor("");
                              setDragSrcBed(null);
                            }}
                            onClick={() => handleBedClick(bed)}
                            title={
                              isDropTarget ? "Drop to transfer patient here"
                                : flags.length ? `Isolation: ${flags.join(", ")}${bed.isolationNotes ? " — " + bed.isolationNotes : ""}`
                                : canDrag ? "Click for actions · drag to transfer"
                                : "Click for actions"
                            }
                          >
                            {/* Top row: bed number + status */}
                            <div className="bm-bed-card__top">
                              <span className="bm-bed-card__num">
                                <i className="pi pi-th-large" />
                                {bed.bedNumber}
                              </span>
                              <span className="bm-bed-card__pill">
                                <span className="bm-bed-card__pill-dot" />
                                {bed.status}
                              </span>
                            </div>

                            {/* Patient block (Occupied) */}
                            {occ && pName && (
                              <div className="bm-bed-card__patient">
                                <span className="bm-bed-card__avatar"
                                  style={{
                                    background: pInfo.gender === "Female"
                                      ? "linear-gradient(135deg,#fbcfe8,#f9a8d4)"
                                      : "linear-gradient(135deg,#bfdbfe,#93c5fd)",
                                    color: pInfo.gender === "Female" ? "#9d174d" : "#1e3a8a",
                                  }}>
                                  {pName.slice(0, 1).toUpperCase()}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="bm-bed-card__pname">{pName}</div>
                                  <div className="bm-bed-card__pmeta">
                                    {pInfo.uhid && (
                                      <span><i className="pi pi-id-card" /><strong>{pInfo.uhid}</strong></span>
                                    )}
                                    {pInfo.age != null && (
                                      <span><i className="pi pi-user" />{pInfo.age}Y {pInfo.gender || ""}</span>
                                    )}
                                    {docName && (
                                      <span><i className="pi pi-user-edit" style={{ color: "#7c3aed" }} />{docName}</span>
                                    )}
                                  </div>
                                </div>
                                {admDays != null && (
                                  <span className="bm-bed-card__days" title={`Admitted on ${admDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}>
                                    <i className="pi pi-calendar" />
                                    Day {admDays}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Patient block (Occupied but data still loading) */}
                            {occ && !pName && (
                              <div className="bm-bed-card__reason">
                                <i className="pi pi-spin pi-spinner" style={{ marginRight: 5 }} />
                                Patient data loading…
                              </div>
                            )}

                            {/* Request Ward Boy + Cleaning — only on
                                occupied beds with resolved patient data.
                                Each button is hidden for roles without
                                the appropriate create permission. */}
                            {occ && pName && (
                              <div
                                style={{ marginTop: 6, display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <RequestWardBoyButton
                                  compact
                                  patient={{
                                    UHID: pInfo.uhid,
                                    patientName: pName,
                                    admissionId: adm?._id,
                                    fromLocation: `Bed ${bed.bedNumber}`,
                                  }}
                                />
                                <RequestHousekeepingButton
                                  compact
                                  patient={{
                                    UHID: pInfo.uhid,
                                    patientName: pName,
                                    bedNumber: bed.bedNumber,
                                    roomNumber: bed.roomNumber,
                                    area: bed.wardName || "",
                                  }}
                                />
                              </div>
                            )}

                            {/* Available admit prompt */}
                            {avail && (
                              <div className="bm-bed-card__admit-prompt">
                                <i className="pi pi-user-plus" />
                                Tap for actions · Admit / Reserve
                              </div>
                            )}

                            {/* Reserved info */}
                            {res && (
                              <div className="bm-bed-card__reason">
                                <i className="pi pi-bookmark" style={{ marginRight: 5, color: "#2563eb" }} />
                                {bed.reservedBy ? `Held by ${bed.reservedBy}` : "Reserved"}
                                {bed.reservedUntil && (
                                  <> · until {new Date(bed.reservedUntil).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>
                                )}
                              </div>
                            )}

                            {/* Maintenance reason */}
                            {mnt && (
                              <div className="bm-bed-card__reason">
                                <i className="pi pi-wrench" style={{ marginRight: 5, color: "#d97706" }} />
                                {hk ? hk.label : "Awaiting maintenance"}
                              </div>
                            )}

                            {/* Blocked reason */}
                            {blk && (
                              <div className="bm-bed-card__reason">
                                <i className="pi pi-ban" style={{ marginRight: 5, color: "#475569" }} />
                                {bed.notes || "Bed blocked"}
                              </div>
                            )}

                            {/* Chip row — isolation + housekeeping + equipment */}
                            {(flags.length > 0 || hk || equipment.length > 0) && (
                              <div className="bm-bed-card__chips">
                                {flags.map(f => {
                                  const s = ISOLATION_STYLE[f];
                                  return (
                                    <span key={f} style={{
                                      display: "inline-flex", alignItems: "center", gap: 3,
                                      padding: "2px 7px", borderRadius: 999,
                                      fontSize: 9.5, fontWeight: 800,
                                      background: s.bg, color: s.color,
                                      border: `1px solid ${s.border}`,
                                      letterSpacing: ".3px",
                                    }}>
                                      <i className={`pi ${s.icon}`} style={{ fontSize: 9 }} />
                                      {f}
                                    </span>
                                  );
                                })}
                                {hk && !mnt && (
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    padding: "2px 7px", borderRadius: 999,
                                    fontSize: 9.5, fontWeight: 800,
                                    background: hk.bg, color: hk.color,
                                    border: `1px solid ${hk.border}`,
                                    letterSpacing: ".3px",
                                  }}>
                                    <i className={`pi ${hk.icon}`} style={{ fontSize: 9 }} />
                                    {hk.label}
                                  </span>
                                )}
                                {equipment.slice(0, 3).map((eq, i) => (
                                  <span key={eq._id || i} style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    padding: "2px 7px", borderRadius: 6,
                                    fontSize: 9.5, fontWeight: 700,
                                    background: "#f1f5f9", color: "#475569",
                                    border: "1px solid #cbd5e1",
                                  }}>
                                    <i className="pi pi-cog" style={{ fontSize: 9 }} />
                                    {eq.label || eq.type}
                                  </span>
                                ))}
                                {equipment.length > 3 && (
                                  <span style={{
                                    padding: "2px 7px", borderRadius: 6,
                                    fontSize: 9.5, fontWeight: 700, color: "#64748b",
                                    background: "#f8fafc", border: "1px dashed #cbd5e1",
                                  }}>+{equipment.length - 3}</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
      )}

      {/* Legend */}
      <div className="bm-bv-legend">
        <span className="bm-bv-legend__label">
          <i className="pi pi-tag" style={{ marginRight: 5, fontSize: 10 }} />
          Status Legend
        </span>
        {Object.entries(STATUS_COLOR).map(([label, col]) => (
          <span key={label} className="bm-bv-legend__item">
            <span className="bm-bv-legend__dot"
              style={{ background: STATUS_BG[label]?.bg || "#f3f4f6", borderColor: col }} />
            {label}
          </span>
        ))}
        <span className="bm-bv-legend__hint">
          <i className="pi pi-info-circle" />
          Click an Available bed to admit · Occupied bed to view patient details · Drag a patient onto an Available bed to transfer
        </span>
      </div>

      {/* ══ MODAL 1 — Search & Admit ══ */}
      <Dialog
        visible={searchModal}
        onHide={() => setSearchModal(false)}
        style={{ width: "500px" }}
        header={
          <span style={{ fontWeight: 700, fontSize: 18, color: "#111827" }}>
            Search &amp; Admit Patient
          </span>
        }
        modal
        draggable={false}
      >
        <div>
          <label style={lbl}>Search Patient by ID or Name</label>
          <div style={{ position: "relative", marginBottom: 16 }}>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Enter Patient ID or Name"
              autoFocus
              style={{
                width: "100%",
                padding: "11px 44px 11px 14px",
                boxSizing: "border-box",
                border: `1.5px solid ${searchQ ? TEAL : "#e2e8f0"}`,
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <i
              className="pi pi-search"
              style={{
                position: "absolute",
                right: 14,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#9ca3af",
                fontSize: 16,
              }}
            />
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {searchQ.trim() === "" ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#94a3b8",
                }}
              >
                <i
                  className="pi pi-search"
                  style={{
                    fontSize: 44,
                    display: "block",
                    marginBottom: 10,
                    opacity: 0.4,
                  }}
                />
                <p style={{ margin: 0, fontSize: 14 }}>
                  Search for a patient to admit
                </p>
              </div>
            ) : searchResults.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#94a3b8",
                }}
              >
                <i
                  className="pi pi-user-minus"
                  style={{
                    fontSize: 44,
                    display: "block",
                    marginBottom: 10,
                    opacity: 0.4,
                  }}
                />
                <p style={{ margin: 0, fontSize: 14 }}>No patients found</p>
              </div>
            ) : (
              searchResults.map((p) => (
                <div
                  key={p._id || p.id}
                  onClick={() => handlePatientPick(p)}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "14px 16px",
                    marginBottom: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all .15s",
                    background: "#fff",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#f0f9ff";
                    e.currentTarget.style.borderColor = TEAL;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.borderColor = "#e2e8f0";
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: "0 0 3px",
                        fontWeight: 700,
                        fontSize: 14,
                        color: "#111827",
                      }}
                    >
                      {getPatientName(p) || "Unknown"}
                    </p>
                    <p
                      style={{
                        margin: "0 0 2px",
                        fontSize: 12,
                        color: "#6b7280",
                      }}
                    >
                      ID: {p.UHID || p.id} | {p.age || ""}Y {p.gender || ""}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                      {p.bloodGroup && `Blood: ${p.bloodGroup}`}
                      {p.bloodGroup && (p.contactNumber || p.phone)
                        ? " | "
                        : ""}
                      {(p.contactNumber || p.phone) &&
                        `Phone: ${p.contactNumber || p.phone}`}
                    </p>
                  </div>
                  <i
                    className="pi pi-arrow-right"
                    style={{ color: TEAL, fontSize: 16, flexShrink: 0 }}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </Dialog>

      {/* ══ MODAL 2 — Admit Patient Form ══ */}
      <Dialog
        visible={admModal}
        onHide={() => {
          if (!booking) setAdmModal(false);
        }}
        style={{ width: "580px" }}
        header={
          <div
            style={{
              background: "linear-gradient(135deg,#7c3aed,#ec4899)",
              margin: "-1px -1px 0",
              padding: "18px 24px",
              borderRadius: "10px 10px 0 0",
            }}
          >
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
              Admit Patient
            </span>
          </div>
        }
        modal
        draggable={false}
        contentStyle={{ paddingTop: 0 }}
      >
        <div style={{ paddingTop: 16 }}>
          {selBed && (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 12,
                padding: "12px 16px",
                marginBottom: 14,
              }}
            >
              <p style={{ margin: "0 0 2px", fontSize: 12, color: "#64748b" }}>
                Admitting to:
              </p>
              <p
                style={{
                  margin: 0,
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#1e40af",
                }}
              >
                {selBed.bedNumber} — {resolveRoomName(selBed)},{" "}
                {resolveFloorName(selBed)}
              </p>
            </div>
          )}
          {selPat && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                padding: "16px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: "50%",
                  background: "#e0e7ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <i
                  className="pi pi-user"
                  style={{ color: "#6366f1", fontSize: 24 }}
                />
              </div>
              <div>
                <p
                  style={{
                    margin: "0 0 3px",
                    fontWeight: 800,
                    fontSize: 17,
                    color: "#0f172a",
                  }}
                >
                  {getPatientName(selPat) || "Unknown"}
                </p>
                <p
                  style={{ margin: "0 0 3px", fontSize: 13, color: "#64748b" }}
                >
                  ID: {selPat.UHID || selPat.id} | {selPat.age}Y {selPat.gender}
                </p>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                  Blood Group: {selPat.bloodGroup || "—"} | Phone:{" "}
                  {selPat.contactNumber || selPat.phone || "—"}
                </p>
              </div>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={lbl}>Admission Date</label>
              <InputText
                type="datetime-local"
                value={admForm.admissionDateTime}
                className="w-full"
                onChange={(e) =>
                  setAdmForm({ ...admForm, admissionDateTime: e.target.value })
                }
              />
            </div>
            <div>
              <label style={lbl}>Expected Discharge</label>
              <InputText
                type="date"
                value={admForm.expectedDischargeDate}
                className="w-full"
                min={admForm.admissionDateTime?.slice(0, 10)}
                onChange={(e) =>
                  setAdmForm({
                    ...admForm,
                    expectedDischargeDate: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Admission Type</label>
            <Dropdown
              value={admForm.admissionType}
              className="w-full"
              options={ADMISSION_TYPES.map((t) => ({
                label: t.label,
                value: t.value,
              }))}
              onChange={(e) =>
                setAdmForm({ ...admForm, admissionType: e.value })
              }
              placeholder="Select Type"
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Attending Doctor</label>
            <Dropdown
              value={admForm.attendingDoctor}
              className="w-full"
              options={doctors}
              onChange={(e) =>
                setAdmForm({ ...admForm, attendingDoctor: e.value })
              }
              placeholder="Select Doctor"
              filter
              showClear
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Diagnosis *</label>
            <InputTextarea
              value={admForm.reasonForAdmission}
              rows={3}
              className="w-full"
              placeholder="Enter preliminary diagnosis"
              onChange={(e) =>
                setAdmForm({ ...admForm, reasonForAdmission: e.target.value })
              }
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Special Instructions</label>
            <InputTextarea
              value={admForm.specialInstructions || ""}
              rows={2}
              className="w-full"
              placeholder="Any special care instructions..."
              onChange={(e) =>
                setAdmForm({ ...admForm, specialInstructions: e.target.value })
              }
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={handleAdmit}
              disabled={!canBook || booking}
              style={{
                flex: 1,
                background: canBook
                  ? "linear-gradient(135deg,#7c3aed,#ec4899)"
                  : "#94a3b8",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "13px",
                fontSize: 14,
                fontWeight: 700,
                cursor: canBook && !booking ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <i
                className={`pi ${booking ? "pi-spin pi-spinner" : "pi-check"}`}
              />
              {booking ? "Admit ho raha hai…" : "Confirm Admission"}
            </button>
            <button
              onClick={() => {
                if (!booking) setAdmModal(false);
              }}
              disabled={booking}
              style={{
                padding: "13px 20px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 12,
                background: "#fff",
                fontSize: 14,
                fontWeight: 600,
                color: "#374151",
                cursor: booking ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Dialog>

      {/* ══ MODAL 3 — Patient Details ══ */}
      <Dialog
        visible={detailModal}
        onHide={() => setDetailModal(false)}
        style={{ width: "500px" }}
        header={
          <div
            style={{
              background: "linear-gradient(135deg,#2563eb,#06b6d4)",
              margin: "-1px -1px 0",
              padding: "18px 24px",
              borderRadius: "10px 10px 0 0",
            }}
          >
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
              Patient Details
            </span>
          </div>
        }
        modal
        draggable={false}
        contentStyle={{ paddingTop: 0 }}
      >
        {detailBed && (
          <div style={{ paddingTop: 16 }}>
            {detailLoading ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
              >
                <i className="pi pi-spin pi-spinner" style={{ fontSize: 30 }} />
                <p style={{ marginTop: 10 }}>Loading patient info…</p>
              </div>
            ) : (
              (() => {
                const src =
                  detailAdm ||
                  detailBed.currentAdmission ||
                  detailBed.bookingInfo;
                const pn =
                  getPatientName(detailPatient) ||
                  resolvePatientName(src) ||
                  src?.patientName ||
                  null;
                const pInfo = detailPatient
                  ? {
                      age:
                        detailPatient.age ||
                        (detailPatient.dateOfBirth
                          ? calcAge(detailPatient.dateOfBirth)
                          : ""),
                      gender: detailPatient.gender || "",
                      uhid: detailPatient.UHID || src?.UHID || "",
                      blood: detailPatient.bloodGroup || "",
                      phone:
                        detailPatient.contactNumber ||
                        detailPatient.phone ||
                        "",
                    }
                  : { ...resolvePatientInfo(src), blood: "", phone: "" };
                const docN = resolveDoctorName(src);
                const adt = src?.admissionDate
                  ? new Date(src.admissionDate).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—";
                const dept =
                  typeof src?.department === "object"
                    ? src?.department?.name
                    : src?.department || "—";
                const admType = src?.admissionType || "—";
                const expDischarge = src?.expectedDischargeDate
                  ? new Date(src.expectedDischargeDate).toLocaleDateString(
                      "en-IN",
                      { day: "2-digit", month: "short", year: "numeric" },
                    )
                  : "—";
                return (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        paddingBottom: 20,
                        borderBottom: "1px solid #f1f5f9",
                        marginBottom: 20,
                      }}
                    >
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg,#e0e7ff,#dbeafe)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          boxShadow: "0 4px 12px rgba(99,102,241,0.15)",
                        }}
                      >
                        <i
                          className="pi pi-user"
                          style={{ color: "#6366f1", fontSize: 28 }}
                        />
                      </div>
                      <div>
                        <h3
                          style={{
                            margin: "0 0 4px",
                            fontSize: 20,
                            fontWeight: 800,
                            color: "#111827",
                          }}
                        >
                          {pn || "Unknown Patient"}
                        </h3>
                        <p
                          style={{
                            margin: "0 0 2px",
                            fontSize: 13,
                            color: "#6b7280",
                          }}
                        >
                          Patient ID:{" "}
                          <strong>{pInfo.uhid || src?.UHID || "—"}</strong>
                        </p>
                        {pInfo.blood && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              background: "#fee2e2",
                              color: "#dc2626",
                              borderRadius: 20,
                              padding: "2px 8px",
                            }}
                          >
                            🩸 {pInfo.blood}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "14px 24px",
                        marginBottom: 16,
                      }}
                    >
                      {[
                        ["Age", pInfo.age ? `${pInfo.age} Years` : "—"],
                        ["Gender", pInfo.gender || "—"],
                        ["Admission Date", adt],
                        ["Expected Discharge", expDischarge],
                        ["Bed", detailBed.bedNumber],
                        ["Department", dept],
                        ["Admission Type", admType],
                        ["Phone", pInfo.phone || "—"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p
                            style={{
                              margin: "0 0 2px",
                              fontSize: 11,
                              color: "#9ca3af",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {label}
                          </p>
                          <p
                            style={{
                              margin: 0,
                              fontWeight: 600,
                              fontSize: 13,
                              color: "#111827",
                            }}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        background: "linear-gradient(135deg,#f5f3ff,#ede9fe)",
                        border: "1px solid #ddd6fe",
                        borderRadius: 12,
                        padding: "14px 16px",
                        marginBottom: 20,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          background: "#7c3aed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <i
                          className="pi pi-user-edit"
                          style={{ color: "#fff", fontSize: 16 }}
                        />
                      </div>
                      <div>
                        <p
                          style={{
                            margin: "0 0 2px",
                            fontSize: 11,
                            color: "#8b5cf6",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Attending Doctor
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontWeight: 700,
                            fontSize: 16,
                            color: "#5b21b6",
                          }}
                        >
                          {docN || "—"}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={() => src && openDischarge(src, detailBed)}
                        disabled={!src}
                        style={{
                          flex: 1,
                          background: src
                            ? "linear-gradient(135deg,#dc2626,#b91c1c)"
                            : "#d1d5db",
                          color: "#fff",
                          border: "none",
                          borderRadius: 12,
                          padding: "13px 16px",
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: src ? "pointer" : "not-allowed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          boxShadow: src
                            ? "0 4px 14px rgba(220,38,38,0.35)"
                            : "none",
                          transition: "all .2s",
                        }}
                      >
                        <i
                          className="pi pi-sign-out"
                          style={{ fontSize: 15 }}
                        />
                        Discharge
                      </button>
                      {src && (
                        <button
                          onClick={() => openEdit(src)}
                          style={{
                            padding: "13px 16px",
                            borderRadius: 12,
                            background:
                              "linear-gradient(135deg,#0891b2,#0e7490)",
                            color: "#fff",
                            border: "none",
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            boxShadow: "0 4px 14px rgba(8,145,178,0.3)",
                            transition: "all .2s",
                          }}
                        >
                          <i className="pi pi-pencil" />
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => setDetailModal(false)}
                        style={{
                          padding: "13px 18px",
                          border: "1.5px solid #e2e8f0",
                          borderRadius: 12,
                          background: "#fff",
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#374151",
                          cursor: "pointer",
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </>
                );
              })()
            )}
          </div>
        )}
      </Dialog>

      {/* ══ MODAL 4 — Edit Admission ══ */}
      <Dialog
        visible={editModal}
        onHide={() => !editSaving && setEditModal(false)}
        style={{ width: "480px" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i className="pi pi-pencil" style={{ color: TEAL }} /> Edit
            Admission
          </div>
        }
        modal
        draggable={false}
      >
        <div className="p-fluid">
          {[
            ["Admission Date & Time", "datetime-local", "admissionDateTime"],
            ["Expected Discharge Date", "date", "expectedDischargeDate"],
          ].map(([l, t, k]) => (
            <div key={k} className="p-field mb-3">
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#475569",
                }}
              >
                {l}
              </label>
              <InputText
                type={t}
                value={editForm[k] || ""}
                className="w-full"
                onChange={(e) =>
                  setEditForm({ ...editForm, [k]: e.target.value })
                }
              />
            </div>
          ))}
          <div className="p-field mb-3">
            <label
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                fontWeight: 500,
                color: "#475569",
              }}
            >
              Department
            </label>
            <Dropdown
              value={editForm.department}
              className="w-full"
              options={DEPTS.map((d) => ({ label: d, value: d }))}
              onChange={(e) =>
                setEditForm({ ...editForm, department: e.value })
              }
              placeholder="Department"
            />
          </div>
          <div className="p-field mb-3">
            <label
              style={{
                display: "block",
                marginBottom: 8,
                fontSize: 12,
                fontWeight: 500,
                color: "#475569",
              }}
            >
              Admission Type
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ADMISSION_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setEditForm({ ...editForm, admissionType: type.value })
                  }
                  style={{
                    flex: 1,
                    minWidth: 80,
                    padding: "8px",
                    borderRadius: 10,
                    border:
                      editForm.admissionType === type.value
                        ? `2px solid ${type.color}`
                        : "2px solid #e2e8f0",
                    background:
                      editForm.admissionType === type.value
                        ? `${type.color}14`
                        : "#fff",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    outline: "none",
                  }}
                >
                  <i
                    className={`pi ${type.icon}`}
                    style={{
                      fontSize: 14,
                      color:
                        editForm.admissionType === type.value
                          ? type.color
                          : "#94a3b8",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight:
                        editForm.admissionType === type.value ? 700 : 500,
                      color:
                        editForm.admissionType === type.value
                          ? type.color
                          : "#64748b",
                    }}
                  >
                    {type.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="p-field mb-3">
            <label
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                fontWeight: 500,
                color: "#475569",
              }}
            >
              Attending Doctor
            </label>
            <Dropdown
              value={editForm.attendingDoctor}
              className="w-full"
              options={doctors}
              onChange={(e) =>
                setEditForm({ ...editForm, attendingDoctor: e.value })
              }
              placeholder="Doctor (optional)"
              filter
              showClear
            />
          </div>
          <div className="p-field mb-3">
            <label
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                fontWeight: 500,
                color: "#475569",
              }}
            >
              Reason
            </label>
            <InputTextarea
              value={editForm.reasonForAdmission || ""}
              rows={3}
              className="w-full"
              onChange={(e) =>
                setEditForm({ ...editForm, reasonForAdmission: e.target.value })
              }
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 8,
            }}
          >
            <Button
              label="Cancel"
              onClick={() => setEditModal(false)}
              className="p-button-outlined p-button-sm"
              disabled={editSaving}
            />
            <Button
              label="Save Changes"
              icon="pi pi-check"
              onClick={saveEdit}
              loading={editSaving}
              className="p-button-sm"
              style={{ background: TEAL, border: "none", borderRadius: 10 }}
            />
          </div>
        </div>
      </Dialog>

      {/* ══ MODAL 5 — Discharge Patient ✅ SCROLLABLE FIX ══ */}
      <Dialog
        visible={dischargeModal}
        onHide={() => !discharging && setDischargeModal(false)}
        style={{ width: "560px" }}
        className="discharge-dlg"
        header={null}
        modal
        draggable={false}
        closable={false}
        contentStyle={{ padding: 0 }}
      >
        {dischargeAdm && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "85vh",
              overflow: "hidden",
            }}
          >
            {/* Fixed header */}
            <div
              style={{
                background: "linear-gradient(135deg,#dc2626,#b91c1c)",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <i
                  className="pi pi-sign-out"
                  style={{ color: "#fff", fontSize: 22 }}
                />
                <span style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>
                  Discharge Patient
                </span>
              </div>
              <button
                onClick={() => !discharging && setDischargeModal(false)}
                style={{
                  background: "rgba(255,255,255,.2)",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                <i className="pi pi-times" style={{ color: "#fff" }} />
              </button>
            </div>

            {/* ✅ Scrollable content area */}
            <div
              style={{
                overflowY: "auto",
                maxHeight: "calc(85vh - 80px)",
                padding: "20px 24px 8px 24px",
                overscrollBehavior: "contain",
              }}
            >
              {/* Patient strip */}
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 14,
                  padding: "14px 16px",
                  marginBottom: 20,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "#fee2e2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <i
                      className="pi pi-user"
                      style={{ color: "#dc2626", fontSize: 20 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: "#1e293b",
                      }}
                    >
                      {getPatientName(dischargePatient) ||
                        dischargeAdm.patientName ||
                        resolvePatientName(dischargeAdm) ||
                        "—"}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
                    >
                      UHID: {dischargePatient?.UHID || dischargeAdm.UHID || "—"}{" "}
                      | Bed: {dischargeBed?.bedNumber || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      Admission Date
                    </div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#dc2626",
                      }}
                    >
                      {dischargeAdm.admissionDate
                        ? new Date(
                            dischargeAdm.admissionDate,
                          ).toLocaleDateString("en-IN")
                        : "—"}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}
                    >
                      Doctor
                    </div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#7c3aed",
                      }}
                    >
                      {resolveDoctorName(dischargeAdm) || "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Date + Cost */}
              {[
                {
                  label: "Discharge Date & Time *",
                  icon: "pi-calendar",
                  color: "#dc2626",
                  key: "actualDischargeDate",
                  type: "datetime-local",
                },
                {
                  label: "Total Cost (₹)",
                  icon: "pi-indian-rupee",
                  color: TEAL,
                  key: "totalCost",
                  type: "number",
                  placeholder: "0",
                },
              ].map(({ label, icon, color, key, type, placeholder }) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 6,
                    }}
                  >
                    <i
                      className={`pi ${icon}`}
                      style={{ marginRight: 6, color }}
                    />
                    {label}
                  </label>
                  <input
                    type={type}
                    value={dischargeForm[key]}
                    placeholder={placeholder}
                    onChange={(e) =>
                      setDischargeForm({
                        ...dischargeForm,
                        [key]: e.target.value,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 10,
                      fontSize: 14,
                      outline: "none",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}

              {/* Condition on Discharge */}
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 8,
                  }}
                >
                  <i
                    className="pi pi-heart"
                    style={{ marginRight: 6, color: "#dc2626" }}
                  />
                  Condition on Discharge *
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  {CONDITIONS.map((c) => {
                    const sel = dischargeForm.conditionOnDischarge === c.label;
                    return (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() =>
                          setDischargeForm({
                            ...dischargeForm,
                            conditionOnDischarge: c.label,
                          })
                        }
                        style={{
                          padding: "10px 6px",
                          borderRadius: 10,
                          border: sel
                            ? `2px solid ${c.color}`
                            : "2px solid #e2e8f0",
                          background: sel ? `${c.color}18` : "#f8fafc",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4,
                          outline: "none",
                        }}
                      >
                        <i
                          className={`pi ${c.icon}`}
                          style={{
                            fontSize: 16,
                            color: sel ? c.color : "#94a3b8",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: sel ? 700 : 500,
                            color: sel ? c.color : "#64748b",
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Textareas */}
              {[
                {
                  label: "Discharge Notes",
                  key: "dischargeNotes",
                  ph: "Short notes…",
                  rows: 2,
                },
                {
                  label: "Discharge Summary",
                  key: "dischargeSummary",
                  ph: "Treatment, diagnosis, medicines…",
                  rows: 3,
                },
                {
                  label: "Follow-up Instructions",
                  key: "followUpInstructions",
                  ph: "Follow-up date, diet, restrictions…",
                  rows: 2,
                },
              ].map(({ label, key, ph, rows }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </label>
                  <textarea
                    rows={rows}
                    value={dischargeForm[key]}
                    placeholder={ph}
                    onChange={(e) =>
                      setDischargeForm({
                        ...dischargeForm,
                        [key]: e.target.value,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 10,
                      fontSize: 14,
                      resize: "vertical",
                      outline: "none",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}
            </div>
            {/* end scrollable */}

            {/* Fixed footer — sticky bottom */}
            <div
              style={{
                position: "sticky",
                bottom: 0,
                padding: "16px 24px 24px 24px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                display: "flex",
                gap: 12,
                zIndex: 10,
              }}
            >
              <button
                onClick={doDischarge}
                disabled={discharging}
                style={{
                  flex: 1,
                  background: discharging
                    ? "#94a3b8"
                    : "linear-gradient(135deg,#dc2626,#b91c1c)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "13px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: discharging ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <i
                  className={`pi ${discharging ? "pi-spin pi-spinner" : "pi-sign-out"}`}
                />
                {discharging ? "Discharge ho raha hai…" : "Discharge Confirm"}
              </button>
              <button
                onClick={() => !discharging && setDischargeModal(false)}
                disabled={discharging}
                style={{
                  padding: "13px 20px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#64748b",
                  cursor: discharging ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Dialog>
      {/* ══ MODAL 6 — Discharge Invoice ══ */}
      {invoiceData && (
        <Dialog
          visible={invoiceModal}
          onHide={() => setInvoiceModal(false)}
          style={{ width: "520px" }}
          header={null}
          modal
          draggable={false}
          closable={false}
          contentStyle={{ padding: 0 }}
        >
          {(() => {
            const { patient, admission, bed, form, dischargedAt } = invoiceData;
            const pName =
              getPatientName(patient) || admission?.patientName || "—";
            const uhid = patient?.UHID || admission?.UHID || "—";
            const disDate = form.actualDischargeDate
              ? new Date(form.actualDischargeDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : new Date(dischargedAt).toLocaleDateString("en-IN");
            const days = admission?.admissionDate
              ? Math.max(
                  1,
                  Math.ceil(
                    (new Date(form.actualDischargeDate || dischargedAt) -
                      new Date(admission.admissionDate)) /
                      (1000 * 60 * 60 * 24),
                  ),
                )
              : "—";
            const dept =
              typeof admission?.department === "object"
                ? admission?.department?.name
                : admission?.department || "—";
            const doctor = resolveDoctorName(admission) || "—";
            const cost = form.totalCost
              ? `₹ ${Number(form.totalCost).toLocaleString("en-IN")}`
              : "Not Specified";
            const condColor = {
              Stable: "#16a34a",
              Improved: "#0891b2",
              Critical: "#dc2626",
              LAMA: "#9333ea",
            };
            const cond = form.conditionOnDischarge || "Stable";

            return (
              <div>
                {/* Green success header */}
                <div
                  style={{
                    background: "linear-gradient(135deg,#16a34a,#15803d)",
                    padding: "20px 24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <i
                        className="pi pi-check"
                        style={{ color: "#fff", fontSize: 20 }}
                      />
                    </div>
                    <div>
                      <div
                        style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}
                      >
                        Discharge Successful!
                      </div>
                      <div
                        style={{
                          color: "rgba(255,255,255,.8)",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        Invoice ready to print
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setInvoiceModal(false)}
                    style={{
                      background: "rgba(255,255,255,.2)",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    <i className="pi pi-times" style={{ color: "#fff" }} />
                  </button>
                </div>

                {/* Invoice preview card */}
                <div style={{ padding: "20px 24px" }}>
                  {/* Patient summary */}
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: "14px 16px",
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 16,
                            color: "#0f172a",
                          }}
                        >
                          {pName}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#64748b",
                            marginTop: 3,
                          }}
                        >
                          UHID: {uhid} | Bed: {bed?.bedNumber || "—"}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#64748b",
                            marginTop: 2,
                          }}
                        >
                          Dept: {dept} | Doctor: {doctor}
                        </div>
                      </div>
                      <span
                        style={{
                          background: `${condColor[cond]}18`,
                          color: condColor[cond],
                          border: `1px solid ${condColor[cond]}40`,
                          borderRadius: 20,
                          padding: "4px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {cond}
                      </span>
                    </div>
                  </div>

                  {/* Key stats row */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    {[
                      {
                        icon: "pi-calendar-minus",
                        color: "#0891b2",
                        label: "Discharge Date",
                        val: disDate,
                      },
                      {
                        icon: "pi-clock",
                        color: "#9333ea",
                        label: "Total Stay",
                        val: `${days} Day${days !== 1 ? "s" : ""}`,
                      },
                      {
                        icon: "pi-indian-rupee",
                        color: "#16a34a",
                        label: "Total Amount",
                        val: cost,
                      },
                    ].map(({ icon, color, label, val }) => (
                      <div
                        key={label}
                        style={{
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 10,
                          padding: "12px",
                          textAlign: "center",
                        }}
                      >
                        <i
                          className={`pi ${icon}`}
                          style={{
                            fontSize: 18,
                            color,
                            display: "block",
                            marginBottom: 6,
                          }}
                        />
                        <div
                          style={{
                            fontSize: 10,
                            color: "#94a3b8",
                            textTransform: "uppercase",
                            letterSpacing: ".05em",
                          }}
                        >
                          {label}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#0f172a",
                            marginTop: 2,
                          }}
                        >
                          {val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Notes preview */}
                  {(form.dischargeSummary ||
                    form.dischargeNotes ||
                    form.followUpInstructions) && (
                    <div
                      style={{
                        background: "#fffbeb",
                        border: "1px solid #fef3c7",
                        borderRadius: 10,
                        padding: "12px 14px",
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#92400e",
                          marginBottom: 6,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <i
                          className="pi pi-file-edit"
                          style={{ fontSize: 12 }}
                        />{" "}
                        CLINICAL NOTES PREVIEW
                      </div>
                      {form.dischargeSummary && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#374151",
                            marginBottom: 4,
                          }}
                        >
                          <strong>Summary:</strong>{" "}
                          {form.dischargeSummary.slice(0, 80)}
                          {form.dischargeSummary.length > 80 ? "…" : ""}
                        </div>
                      )}
                      {form.followUpInstructions && (
                        <div style={{ fontSize: 12, color: "#374151" }}>
                          <strong>Follow-up:</strong>{" "}
                          {form.followUpInstructions.slice(0, 80)}
                          {form.followUpInstructions.length > 80 ? "…" : ""}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={printInvoice}
                      style={{
                        flex: 1,
                        background: "linear-gradient(135deg,#0891b2,#0e7490)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 12,
                        padding: "13px",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        boxShadow: "0 4px 14px rgba(8,145,178,0.3)",
                      }}
                    >
                      <i className="pi pi-print" style={{ fontSize: 16 }} />
                      Print / Download Invoice
                    </button>
                    <button
                      onClick={() => setInvoiceModal(false)}
                      style={{
                        padding: "13px 20px",
                        border: "1.5px solid #e2e8f0",
                        borderRadius: 12,
                        background: "#fff",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#64748b",
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                  </div>

                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      color: "#94a3b8",
                      marginTop: 12,
                    }}
                  >
                    <i
                      className="pi pi-info-circle"
                      style={{ marginRight: 4 }}
                    />
                    Print dialog mein "Save as PDF" select karke download bhi
                    kar sakte hain
                  </div>
                </div>
              </div>
            );
          })()}
        </Dialog>
      )}

      {/* ── Drag-drop Transfer Dialog (P2 #8) ──
          Opens when an Occupied bed is dragged onto an Available bed.
          POSTs to /api/bed-transfers (status=PendingHandover) and
          refreshes the layout. Nurse completes the handover from
          BedTransfersListPage (or the patient file). */}
      {xferDialog && (
        <Dialog
          header={
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-arrows-h" />
              <span>Transfer Patient</span>
            </span>
          }
          visible={!!xferDialog}
          modal
          onHide={() => setXferDialog(null)}
          style={{ width: 520 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* From → To summary */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: ".5px" }}>From</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  Bed {xferDialog.from.bedNumber}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {xferDialog.from.wardName || "—"} · {xferDialog.from.roomNumber || "—"}
                </div>
                {(() => {
                  const pn = resolvePatientName(xferDialog.from.currentAdmission);
                  return pn ? (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginTop: 6 }}>
                      <i className="pi pi-user" style={{ fontSize: 10, marginRight: 4 }} />
                      {pn}
                    </div>
                  ) : null;
                })()}
              </div>
              <i className="pi pi-arrow-right" style={{ fontSize: 18, color: "#94a3b8" }} />
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: ".5px" }}>To</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  Bed {xferDialog.to.bedNumber}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {xferDialog.to.wardName || "—"} · {xferDialog.to.roomNumber || "—"}
                </div>
              </div>
            </div>

            {/* Reason */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
                Reason for transfer
              </div>
              <Dropdown
                value={xferReason}
                options={[
                  "Clinical upgrade (ICU)",
                  "Clinical downgrade (Ward)",
                  "Isolation precaution",
                  "Patient request",
                  "Bed unavailable in original ward",
                  "Equipment availability",
                  "Other",
                ].map(v => ({ label: v, value: v }))}
                onChange={(e) => setXferReason(e.value)}
                placeholder="Select a reason"
                style={{ width: "100%" }}
              />
            </div>

            {/* Doctor */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
                Requested by (doctor)
              </div>
              <InputText value={xferDoctor} onChange={(e) => setXferDoctor(e.target.value)}
                placeholder="Doctor name" style={{ width: "100%" }} />
            </div>

            {/* Shifting notes — required */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
                Shifting notes <span style={{ color: "#dc2626" }}>*</span>
              </div>
              <InputTextarea rows={3} value={xferNotes} onChange={(e) => setXferNotes(e.target.value)}
                placeholder="Why is this transfer needed? Any precautions / handover instructions for the nurse?"
                style={{ width: "100%" }} />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <Button label="Cancel" className="p-button-text" onClick={() => setXferDialog(null)} disabled={xferSaving} />
              <Button
                label={xferSaving ? "Initiating…" : "Initiate Transfer"}
                icon={xferSaving ? "pi pi-spin pi-spinner" : "pi pi-check"}
                disabled={xferSaving || !xferNotes.trim()}
                onClick={async () => {
                  if (!xferNotes.trim()) return;
                  setXferSaving(true);
                  try {
                    const fromBed = xferDialog.from;
                    const toBed   = xferDialog.to;
                    const admId   = getId(fromBed.currentAdmission);
                    const patient = fromBed.currentAdmission?.patientId || {};
                    const body = {
                      UHID:            patient.UHID || fromBed.currentAdmission?.UHID || "",
                      admissionId:    admId,
                      patientName:    patient.fullName || resolvePatientName(fromBed.currentAdmission) || "",
                      fromBedId:      getId(fromBed._id),
                      fromBedNumber:  fromBed.bedNumber,
                      fromWardName:   fromBed.wardName || "",
                      fromRoomNumber: fromBed.roomNumber || "",
                      toBedId:        getId(toBed._id),
                      toBedNumber:    toBed.bedNumber,
                      toWardName:     toBed.wardName || "",
                      toRoomNumber:   toBed.roomNumber || "",
                      reason:         xferReason,
                      shiftingNotes:  xferNotes.trim(),
                      requestedBy:    xferDoctor || "",
                    };
                    const r = await authFetch(`${import.meta.env.VITE_API_URL || ""}/api/bed-transfers`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    const data = await r.json();
                    if (!r.ok || data?.success === false) {
                      throw new Error(data?.message || "Transfer failed");
                    }
                    toast.current?.show({
                      severity: "success",
                      summary: "Transfer initiated",
                      detail: `Bed ${fromBed.bedNumber} → ${toBed.bedNumber}. Awaiting nurse handover.`,
                      life: 4000,
                    });
                    setXferDialog(null);
                    await fetchBeds();   // refresh layout
                  } catch (e) {
                    toast.current?.show({
                      severity: "error",
                      summary: "Transfer failed",
                      detail: e.message || "Could not initiate transfer",
                      life: 4500,
                    });
                  } finally {
                    setXferSaving(false);
                  }
                }}
                style={{ background: "#7c3aed", borderColor: "#7c3aed" }}
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ══ MODAL 7 — Bed Information / Quick-Edit ══════════════════════ */}
      <Dialog
        visible={bedInfoModal}
        onHide={() => !bedInfoSaving && setBedInfoModal(false)}
        style={{ width: "640px" }}
        modal
        draggable={false}
        closable={false}
        contentStyle={{ padding: 0 }}
        header={null}
      >
        {bedInfoBed && (() => {
          const b   = bedInfoBed;
          const ed  = bedInfoEditMode;
          const cat = typeof b.roomCategoryId === "object"
            ? (b.roomCategoryId?.name || b.roomCategoryId?.categoryName || "—")
            : (b.categoryName || b.category || "—");
          const adt = b.currentAdmission?.admissionDate
            ? new Date(b.currentAdmission.admissionDate).toLocaleDateString("en-IN",
                { day: "2-digit", month: "short", year: "numeric" })
            : null;
          // The 11 isolation flags shipped on the Bed.isolationFlags enum.
          const FLAGS = ["Contact","Droplet","Airborne","Neutropenic","MRSA","COVID","TB","VRE","CRE","C.diff","Reverse"];
          const toggleFlag = (f) => {
            const cur = new Set(bedInfoForm.isolationFlags || []);
            if (cur.has(f)) cur.delete(f); else cur.add(f);
            setBedInfoForm({ ...bedInfoForm, isolationFlags: [...cur] });
          };
          const row = (label, value) => (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dashed #e2e8f0", fontSize:13 }}>
              <span style={{ color:"#64748b", fontWeight:600 }}>{label}</span>
              <span style={{ color:"#0f172a", fontWeight:700, textAlign:"right", maxWidth:"60%" }}>{value || "—"}</span>
            </div>
          );
          return (
            <div style={{ display:"flex", flexDirection:"column", maxHeight:"85vh", overflow:"hidden" }}>
              {/* Header */}
              <div style={{
                background:"linear-gradient(135deg,#0891b2,#0e7490)",
                padding:"18px 22px",
                color:"#fff",
                display:"flex",
                alignItems:"center",
                justifyContent:"space-between",
              }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800 }}>
                    <i className="pi pi-th-large" style={{ marginRight:8 }} />
                    Bed {b.bedNumber || "—"}
                  </div>
                  <div style={{ fontSize:12, opacity:.85, marginTop:2 }}>
                    {ed ? "Quick-edit isolation flags · equipment · precaution" : "Bed metadata · admission summary"}
                  </div>
                </div>
                <button
                  onClick={() => !bedInfoSaving && setBedInfoModal(false)}
                  disabled={bedInfoSaving}
                  style={{ background:"rgba(255,255,255,.18)", border:"none", color:"#fff",
                    width:32, height:32, borderRadius:8, cursor: bedInfoSaving ? "not-allowed" : "pointer" }}
                >
                  <i className="pi pi-times" />
                </button>
              </div>

              {/* Scrollable body */}
              <div style={{ padding:"18px 22px", overflowY:"auto" }}>
                {/* ── Bed metadata (always visible) ── */}
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#0e7490", textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>
                    Location &amp; category
                  </div>
                  {row("Building",       b.buildingName)}
                  {row("Floor",          b.floorNumber)}
                  {row("Ward",           b.wardName)}
                  {row("Room",           b.roomNumber)}
                  {row("Category",       cat)}
                  {row("Status",         b.status)}
                  {row("Per-day charge", b.pricing?.perDayCharge != null ? `₹${Number(b.pricing.perDayCharge).toLocaleString("en-IN")}` : "—")}
                </div>

                {/* ── Current admission summary (only when occupied) ── */}
                {b.status === "Occupied" && b.currentAdmission && (
                  <div style={{ marginBottom:18 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#7c3aed", textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>
                      Current admission
                    </div>
                    {row("Patient",       b.currentAdmission?.patientId?.fullName || b.currentAdmission?.patientName)}
                    {row("UHID",          b.currentAdmission?.patientId?.UHID || b.currentAdmission?.UHID)}
                    {row("Admitted",      adt)}
                    {row("Type",          b.currentAdmission?.admissionType)}
                    {row("Attending",     resolveDoctorName(b.currentAdmission))}
                  </div>
                )}

                {/* ── Precaution level ── */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#dc2626", textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>
                    Precaution level
                  </div>
                  {ed ? (
                    <div style={{ display:"flex", gap:8 }}>
                      {["Standard","Enhanced","Strict"].map(lvl => (
                        <button
                          key={lvl}
                          onClick={() => setBedInfoForm({ ...bedInfoForm, precautionLevel: lvl })}
                          style={{
                            flex:1, padding:"9px 12px", borderRadius:8,
                            border: bedInfoForm.precautionLevel === lvl ? "2px solid #dc2626" : "1px solid #e2e8f0",
                            background: bedInfoForm.precautionLevel === lvl ? "#fef2f2" : "#fff",
                            color: bedInfoForm.precautionLevel === lvl ? "#b91c1c" : "#475569",
                            fontWeight:700, cursor:"pointer", fontSize:13,
                          }}
                        >{lvl}</button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize:14, fontWeight:700 }}>{bedInfoForm.precautionLevel || "Standard"}</div>
                  )}
                </div>

                {/* ── Isolation flags ── */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#dc2626", textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>
                    Isolation flags
                  </div>
                  {ed ? (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                      {FLAGS.map(f => {
                        const on = (bedInfoForm.isolationFlags || []).includes(f);
                        return (
                          <label key={f} style={{
                            display:"flex", alignItems:"center", gap:6, padding:"6px 8px",
                            borderRadius:6, border: on ? "1.5px solid #dc2626" : "1px solid #e2e8f0",
                            background: on ? "#fef2f2" : "#fff", cursor:"pointer",
                            fontSize:12, fontWeight:600,
                            color: on ? "#b91c1c" : "#475569",
                          }}>
                            <input type="checkbox" checked={on} onChange={() => toggleFlag(f)} />
                            {f}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize:13 }}>
                      {(bedInfoForm.isolationFlags && bedInfoForm.isolationFlags.length)
                        ? bedInfoForm.isolationFlags.join(", ") : "None"}
                    </div>
                  )}
                </div>

                {/* ── Isolation notes ── */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#64748b", textTransform:"uppercase", letterSpacing:".5px", marginBottom:6 }}>
                    Isolation notes
                  </div>
                  {ed ? (
                    <textarea
                      value={bedInfoForm.isolationNotes || ""}
                      onChange={e => setBedInfoForm({ ...bedInfoForm, isolationNotes: e.target.value })}
                      rows={2}
                      placeholder="Reverse isolation — neutropenic patient, etc."
                      style={{ width:"100%", padding:"8px 10px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:13, fontFamily:"inherit", resize:"vertical" }}
                    />
                  ) : (
                    <div style={{ fontSize:13, whiteSpace:"pre-wrap" }}>{bedInfoForm.isolationNotes || "—"}</div>
                  )}
                </div>

                {/* ── Equipment ── */}
                <div style={{ marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#0891b2", textTransform:"uppercase", letterSpacing:".5px", marginBottom:6 }}>
                    Equipment (comma-separated)
                  </div>
                  {ed ? (
                    <input
                      type="text"
                      value={bedInfoForm.equipment || ""}
                      onChange={e => setBedInfoForm({ ...bedInfoForm, equipment: e.target.value })}
                      placeholder="Ventilator, Cardiac monitor, Suction pump"
                      style={{ width:"100%", padding:"9px 10px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:13 }}
                    />
                  ) : (
                    <div style={{ fontSize:13 }}>{bedInfoForm.equipment || "None recorded"}</div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding:"14px 22px", borderTop:"1px solid #e2e8f0", display:"flex", gap:10, justifyContent:"flex-end" }}>
                {!ed && (
                  <button
                    onClick={() => setBedInfoEditMode(true)}
                    style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #0891b2", background:"#fff", color:"#0e7490", fontWeight:700, cursor:"pointer" }}
                  >
                    <i className="pi pi-pencil" style={{ marginRight:6 }} />
                    Edit
                  </button>
                )}
                <button
                  onClick={() => !bedInfoSaving && setBedInfoModal(false)}
                  disabled={bedInfoSaving}
                  style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", color:"#475569", fontWeight:700, cursor: bedInfoSaving ? "not-allowed" : "pointer" }}
                >Close</button>
                {ed && (
                  <button
                    onClick={saveBedInfo}
                    disabled={bedInfoSaving}
                    style={{
                      padding:"9px 22px", borderRadius:8, border:"none",
                      background:"linear-gradient(135deg,#0891b2,#0e7490)", color:"#fff",
                      fontWeight:700, cursor: bedInfoSaving ? "not-allowed" : "pointer",
                      boxShadow:"0 4px 14px rgba(8,145,178,.35)",
                    }}
                  >
                    {bedInfoSaving ? "Saving…" : "Save changes"}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Dialog>

      {/* ── Status-aware Bed Action Menu (opens on bed click) ── */}
      <BedActionMenu
        bed={actionMenuBed}
        onClose={() => setActionMenuBed(null)}
        actions={{
          // Available
          onAdmit: (bed) => { setActionMenuBed(null); handleAvailable(bed); },
          onReserve: (bed) => {
            setActionMenuBed(null);
            toast.current?.show({ severity: "info", summary: "Reserve bed", detail: "Reservation workflow opens here (use PATCH /:id/status with status=Reserved + reservedUntil)", life: 4000 });
          },
          onIsolation: (bed) => openBedInfo(bed, true),
          onEquipment: (bed) => openBedInfo(bed, true),
          onMaintenance: async (bed) => {
            setActionMenuBed(null);
            try {
              await bedService.updateBedStatus(getId(bed._id), "Maintenance");
              await fetchBeds();
              toast.current?.show({ severity: "success", summary: "Marked maintenance", detail: `Bed ${bed.bedNumber} sent to housekeeping`, life: 2500 });
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not update", life: 3000 });
            }
          },
          onBlock: async (bed) => {
            setActionMenuBed(null);
            try {
              await bedService.updateBedStatus(getId(bed._id), "Blocked");
              await fetchBeds();
              toast.current?.show({ severity: "success", summary: "Blocked", detail: `Bed ${bed.bedNumber} blocked`, life: 2500 });
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not update", life: 3000 });
            }
          },

          // Occupied
          onViewPatient: async (bed) => {
            setActionMenuBed(null);
            const uhid = await resolveBedUHID(bed);
            if (uhid) {
              // Full clinical timeline: diagnoses, notes, orders, bills
              window.location.href = `/patient-file/${encodeURIComponent(uhid)}`;
            } else {
              // No UHID resolvable — fall back to the in-place detail modal
              handleOccupied(bed);
            }
          },
          onDoctorNotes: async (bed) => {
            setActionMenuBed(null);
            const uhid = await resolveBedUHID(bed);
            window.location.href = uhid ? `/doctor-notes?uhid=${uhid}` : `/doctor-notes`;
          },
          onNursingNotes: async (bed) => {
            setActionMenuBed(null);
            const uhid = await resolveBedUHID(bed);
            window.location.href = uhid ? `/nursing-notes?uhid=${uhid}` : `/nursing-notes`;
          },
          onMAR: async (bed) => {
            setActionMenuBed(null);
            const uhid = await resolveBedUHID(bed);
            // /mar is the standalone MAR page; older code routed to
            // /doctor-notes#mar which had no anchor handler and just
            // dumped the user on a generic notes page.
            window.location.href = uhid ? `/mar?uhid=${uhid}` : `/mar`;
          },
          onTransfer: (bed) => {
            setActionMenuBed(null);
            // Initiate the same drag-drop dialog flow but without dragging
            setDragSrcBed(bed);
            toast.current?.show({ severity: "info", summary: "Pick destination",
              detail: `Click any Available bed to transfer from ${bed.bedNumber}. Press Esc or click 'Cancel transfer' in the toast to abort.`, life: 5500 });
          },
          onEstimate: async (bed) => {
            setActionMenuBed(null);
            try {
              const r = await authFetch(`${API_ENDPOINTS.BEDS}/${getId(bed._id)}/estimate`);
              const data = await r.json();
              if (data?.success && data?.data) {
                const est = data.data;
                // Backend (bedService.estimateCharges) returns:
                //   { bedId, bedNumber, daysOccupied, estimatedCharges }
                // The old toast read est.days / est.total — wrong keys,
                // so the user always saw "0 day(s) · approx ₹0".
                const days   = est.daysOccupied ?? est.days ?? 0;
                const charge = est.estimatedCharges ?? est.total ?? 0;
                toast.current?.show({
                  severity: "info",
                  summary: `Bed ${bed.bedNumber} estimate`,
                  detail:  `${days} day(s) · approx ₹${Number(charge).toLocaleString("en-IN")}`,
                  life:    6000,
                });
              } else {
                toast.current?.show({
                  severity: "warn",
                  summary:  "No estimate available",
                  detail:   data?.message || "Estimate could not be computed for this bed.",
                  life:     3500,
                });
              }
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not estimate", life: 3000 });
            }
          },
          onDischarge: async (bed) => {
            // Open the Discharge form DIRECTLY from the action menu.
            // Earlier this hop went through the detail modal, so a second
            // click was required and the form sometimes never surfaced when
            // detailModal+dischargeModal both fought to open.
            setActionMenuBed(null);

            // Resolve the admission for this bed: prefer populated
            // currentAdmission, otherwise look it up by bedId.
            let adm = null;
            const ca = bed.currentAdmission;
            if (ca && typeof ca === "object" && ca._id) {
              adm = ca;
            } else {
              try {
                const list = await admissionService.getActiveAdmissions();
                const arr = Array.isArray(list) ? list : list?.admissions || list?.data || [];
                const bedId = getId(bed._id);
                adm = arr.find((a) => getId(a.bedId) === bedId || getId(a.bed) === bedId) || null;
              } catch (e) {
                console.error("[BedLayout] onDischarge lookup failed:", e?.message);
              }
            }
            if (!adm) {
              toast.current?.show({
                severity: "warn",
                summary: "No active admission",
                detail: `Bed ${bed.bedNumber || ""} doesn't have an active admission record. Try refreshing the bed list.`,
                life: 4500,
              });
              return;
            }

            // Best-effort patient resolution so the discharge dialog shows
            // the right name. Fall back to whatever's already on the
            // admission record if the fetch fails.
            let pat = null;
            if (adm.patientId && typeof adm.patientId === "object" && getPatientName(adm.patientId)) {
              pat = adm.patientId;
            } else {
              const uhid = adm.UHID || adm.patientUHID;
              if (uhid) {
                try { pat = unwrapPatient(await patientService.getPatientByUHID(uhid)); } catch (_) {}
              }
              if (!pat) {
                const objId = isMongoId(getId(adm.patientId)) ? getId(adm.patientId) : null;
                if (objId) {
                  try { pat = unwrapPatient(await patientService.getPatientById(objId)); } catch (_) {}
                }
              }
              if (!pat) {
                pat = allPatients.find(p => (adm.UHID && p.UHID === adm.UHID)) || null;
              }
            }

            setDetailPatient(pat);
            openDischarge(adm, bed);
          },

          // Reserved
          onExtendReservation: (bed) => {
            setActionMenuBed(null);
            toast.current?.show({ severity: "info", summary: "Extend hold", detail: "Update reservedUntil from Manage Beds → Edit Bed.", life: 3500 });
          },
          onCancelReservation: async (bed) => {
            setActionMenuBed(null);
            try {
              await bedService.updateBedStatus(getId(bed._id), "Available");
              await fetchBeds();
              toast.current?.show({ severity: "success", summary: "Reservation cancelled", detail: `Bed ${bed.bedNumber} is now Available`, life: 2500 });
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not update", life: 3000 });
            }
          },

          // Maintenance
          onClearMaintenance: async (bed) => {
            setActionMenuBed(null);
            try {
              await bedService.updateBedStatus(getId(bed._id), "Available");
              await fetchBeds();
              toast.current?.show({ severity: "success", summary: "Cleared", detail: `Bed ${bed.bedNumber} is back in service`, life: 2500 });
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not update", life: 3000 });
            }
          },
          onHousekeeping: (bed) => {
            setActionMenuBed(null);
            toast.current?.show({ severity: "info", summary: "Housekeeping queue",
              detail: "Use the Bed Management Dashboard → Housekeeping Queue panel to advance state.", life: 4000 });
          },

          // Blocked
          onUnblock: async (bed) => {
            setActionMenuBed(null);
            try {
              await bedService.updateBedStatus(getId(bed._id), "Available");
              await fetchBeds();
              toast.current?.show({ severity: "success", summary: "Unblocked", detail: `Bed ${bed.bedNumber} is back in service`, life: 2500 });
            } catch (e) {
              toast.current?.show({ severity: "error", summary: "Failed", detail: e.message || "Could not update", life: 3000 });
            }
          },

          // Common
          // Bed Information shows the bed-level metadata dialog (room /
          // floor / category / equipment / isolation / history). For
          // occupied beds the View Patient File button handles the
          // clinical timeline — they're two different things now.
          onInfo: (bed) => openBedInfo(bed, false),
        }}
      />
    </div>
  );
};

export default BedVisualLayout;
