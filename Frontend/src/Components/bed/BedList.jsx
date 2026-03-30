import React, { useState, useEffect, useRef } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { bedService } from "../../Services/bedService";
import { formatDateTime } from "../../utils/helpers";
import { bedService } from "../../Services/bedService";
import { admissionService } from "../../Services/admissionService";
import { wardService } from "../../Services/wardService";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import patientService from "../../Services/patient/patientService";
import { doctorService } from "../../Services/doctors/doctorService";

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

/* ─── Bed Icon ─── */
const BedIcon = ({ status }) => {
  const col = STATUS_COLOR[status] || "#9ca3af";
  return (
    <svg
      width="40"
      height="32"
      viewBox="0 0 64 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="10" width="8" height="32" rx="3" fill={col} />
      <rect x="52" y="18" width="8" height="24" rx="3" fill={col} />
      <rect x="4" y="26" width="56" height="14" rx="3" fill={col} />
      <rect
        x="12"
        y="20"
        width="40"
        height="10"
        rx="3"
        fill={col}
        opacity="0.6"
      />
      <rect
        x="14"
        y="21"
        width="16"
        height="8"
        rx="3"
        fill="white"
        opacity="0.9"
      />
      <rect x="6" y="38" width="6" height="8" rx="2" fill={col} opacity="0.8" />
      <rect
        x="52"
        y="38"
        width="6"
        height="8"
        rx="2"
        fill={col}
        opacity="0.8"
      />
      <circle cx="58" cy="8" r="7" fill={col} />
      <circle cx="58" cy="8" r="4" fill="white" opacity="0.45" />
    </svg>
  );
};

/* ══════════════════════════════════════════════════════════ */
const BedVisualLayout = ({ onRefreshParent }) => {

  const toast = useRef(null);

  /* ── data ── */
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

  /* ── filters ── */
  const [fBldg, setFBldg] = useState(null);
  const [fFloor, setFFloor] = useState(null);
  const [fWard, setFWard] = useState(null);
  const [fRoom, setFRoom] = useState(null);
  const [fSearch, setFSearch] = useState("");

  /* ── Modal 1: Search & Admit ── */
  const [searchModal, setSearchModal] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [selBed, setSelBed] = useState(null);

  /* ── Modal 2: Admission Form ── */
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

  /* ── Modal 3: Patient Details ── */
  const [detailModal, setDetailModal] = useState(false);
  const [detailBed, setDetailBed] = useState(null);
  const [detailAdm, setDetailAdm] = useState(null);
  const [detailPatient, setDetailPatient] = useState(null);
  const [detailLoading, setDetailLoad] = useState(false);

  /* ── Modal 4: Edit ── */
  const [editModal, setEditModal] = useState(false);
  const [editAdm, setEditAdm] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  /* ── Modal 5: Discharge ── */
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

  /* ── Search results ── */
  const searchResults = searchQ.trim()
    ? allPatients
        .map((p) => ({ p, score: scoreP(p, searchQ.trim()) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((x) => x.p)
    : [];

  /* ══ LIFECYCLE ══ */
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

  /* ══ FETCH ══ */
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

      const allFloorsArr = Array.isArray(allF) ? allF : allF?.data || [];
      const allRoomsArr = Array.isArray(allR) ? allR : allR?.data || [];
      setAllFloorsList(allFloorsArr);
      setAllRoomsList(allRoomsArr);

      const pList = Array.isArray(pts) ? pts : pts?.data || pts?.patients || [];
      setAllPats(pList);

      let rawDocs = [];
      if (Array.isArray(docs)) rawDocs = docs;
      else if (Array.isArray(docs?.data)) rawDocs = docs.data;
      else if (Array.isArray(docs?.doctors)) rawDocs = docs.doctors;
      else if (Array.isArray(docs?.result)) rawDocs = docs.result;

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


  const handleDelete = (bed) => {
    confirmDialog({
      message: `Are you sure you want to delete Bed ${bed.bedNumber}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await bedService.deleteBed(bed._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Bed deleted successfully",
            life: 3000,
          });
          fetchBeds();
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete bed",
            life: 3000,
          });
        }
      },
    });
  };

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

  /* ══ NAME RESOLVERS ══ */
  const resolveFloorName = (bed) => {
    if (!bed) return "?";
    const floorId = getId(bed.floor);
    if (!floorId) return bed.floorNumber ? `Floor ${bed.floorNumber}` : "?";
    const found = allFloorsList.find((f) => getId(f._id) === floorId);
    return (
      found?.floorName ||
      (found?.floorNumber ? `Floor ${found.floorNumber}` : `Floor ?`)
    );
  };

  const resolveRoomName = (bed) => {
    if (!bed) return "?";
    const roomId = getId(bed.room);
    if (!roomId) return bed.roomNumber ? `Room ${bed.roomNumber}` : "?";
    const found = allRoomsList.find((r) => getId(r._id) === roomId);
    return (
      found?.roomName ||
      (found?.roomNumber ? `Room ${found.roomNumber}` : `Room ?`)
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

  /* ══ BED CLICK FLOW ══ */
  const handleAvailable = (bed) => {
    setSelBed(bed);
    setSearchQ("");
    setSearchModal(true);
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
      console.error("[BedLayout] handleOccupied failed:", e?.message);
    } finally {
      setDetailLoad(false);
    }
  };


  const handleBedClick = (bed) => {
    if (bed.status === "Available") handleAvailable(bed);
    else if (bed.status === "Occupied") handleOccupied(bed);
    else
      toast.current?.show({
        severity: "warn",
        summary: "Unavailable",
        detail: `Bed is currently ${bed.status}`,
        life: 2500,
      });
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

  /* ══ ADMIT ══ */
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

  /* ══ EDIT ══ */
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

  /* ══ DISCHARGE ══ */
  const openDischarge = (adm, bed) => {
    setDetailModal(false);
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
      setDischargeModal(false);
      setDischargeAdm(null);
      setDischargeBed(null);
      setDischargePatient(null);
      await fetchBeds();
      onRefreshParent?.();
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

  /* ── Group beds by Floor → Room ── */
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

  /* ════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════ */
  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* ── FILTER BAR ── */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          padding: "16px 20px",
          marginBottom: 20,
          boxShadow: "0 2px 12px rgba(0,0,0,.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: "#0f172a",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <i className="pi pi-filter" style={{ color: TEAL }} /> Filter Beds
          </h3>
          <div style={{ display: "flex", gap: 10 }}>
            <Button
              label="Refresh"
              icon="pi pi-refresh"
              onClick={fetchBeds}
              loading={busy}
              className="p-button-sm p-button-outlined"
              style={{
                borderColor: TEAL,
                color: TEAL,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Button
              label="Clear"
              icon="pi pi-filter-slash"
              onClick={() => {
                setFBldg(null);
                setFFloor(null);
                setFWard(null);
                setFRoom(null);
                setFSearch("");
              }}
              className="p-button-sm p-button-text"
              style={{ color: "#64748b" }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <div style={{ position: "relative" }}>
            <i
              className="pi pi-search"
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#9ca3af",
                fontSize: 14,
              }}
            />
            <input
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="Search beds or patients..."
              style={{
                width: "100%",
                padding: "10px 14px 10px 38px",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>
          {[
            {
              val: fBldg,
              opts: bldgs.map((b) => ({ label: b.buildingName, value: b._id })),
              onChange: (v) => {
                setFBldg(v);
                setFFloor(null);
                setFWard(null);
                setFRoom(null);
              },
              disabled: false,
              ph: "All Buildings",
            },
            {
              val: fFloor,
              opts: floors.map((f) => ({
                label: f.floorName || `Floor ${f.floorNumber}`,
                value: f._id,
              })),
              onChange: (v) => {
                setFFloor(v);
                setFWard(null);
                setFRoom(null);
              },
              disabled: !fBldg,
              ph: "All Floors",
            },
            {
              val: fWard,
              opts: wards.map((w) => ({ label: w.wardName, value: w._id })),
              onChange: setFWard,
              disabled: !fFloor,
              ph: "All Wards",
            },
            {
              val: fRoom,
              opts: rooms.map((r) => ({ label: r.roomNumber, value: r._id })),
              onChange: setFRoom,
              disabled: !fFloor,
              ph: "All Rooms",
            },
          ].map(({ val, opts, onChange, disabled, ph }, i) => (
            <Dropdown
              key={i}
              className="w-full"
              value={val}
              showClear
              disabled={disabled}
              options={opts}
              onChange={(e) => onChange(e.value)}
              placeholder={ph}
            />
          ))}
        </div>
      </div>
=======
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
        <div
          style={{
            textAlign: "center",
            padding: 80,
            background: "#fff",
            borderRadius: 16,
            border: "1px solid #e2e8f0",
          }}
        >
          <i
            className="pi pi-inbox"
            style={{
              fontSize: 52,
              color: "#cbd5e1",
              display: "block",
              marginBottom: 12,
            }}
          />
          <p style={{ color: "#94a3b8" }}>Koi bed nahi mila</p>
        </div>
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
              {/* Floor header */}
              <div
                style={{
                  background: TEAL_GRAD,
                  padding: "16px 24px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <i
                  className="pi pi-building"
                  style={{ color: "#fff", fontSize: 20 }}
                />
                <span style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>
                  {floorLabel}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
                  {[
                    ["Available", "#d1fae5", "#065f46"],
                    ["Occupied", "#fee2e2", "#991b1b"],
                  ].map(([k, bg, c]) => {
                    const cnt = Object.values(floorData.rooms)
                      .flatMap((r) => r.beds)
                      .filter((b) => b.status === k).length;
                    return (
                      <span
                        key={k}
                        style={{
                          background: bg,
                          color: c,
                          borderRadius: 20,
                          padding: "3px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {k}: {cnt}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Rooms grid */}
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
                    {/* Room header */}
                    <div
                      style={{
                        padding: "12px 18px",
                        background: "#fff",
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <i
                          className="pi pi-home"
                          style={{ color: TEAL, fontSize: 15 }}
                        />
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: "#0f172a",
                          }}
                        >
                          {grp.roomName}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#64748b",
                          background: "#f1f5f9",
                          borderRadius: 20,
                          padding: "2px 10px",
                        }}
                      >
                        {grp.beds.length} Bed{grp.beds.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Bed cards */}
                    <div
                      style={{
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {grp.beds.map((bed) => {
                        const col = STATUS_COLOR[bed.status] || "#d1d5db";
                        const sbg = STATUS_BG[bed.status] || {
                          bg: "#f3f4f6",
                          color: "#374151",
                        };
                        const avail = bed.status === "Available";
                        const occ = bed.status === "Occupied";
                        const adm = bed.currentAdmission;
                        const pName = resolvePatientName(adm);
                        const pInfo = occ ? resolvePatientInfo(adm) : {};
                        const docName = occ ? resolveDoctorName(adm) : null;
                        const admDate = adm?.admissionDate
                          ? new Date(adm.admissionDate).toLocaleDateString(
                              "en-IN",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )
                          : null;

                        return (
                          <div
                            key={bed._id}
                            onClick={() => handleBedClick(bed)}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderLeft: `4px solid ${col}`,
                              borderRadius: 12,
                              background: avail
                                ? "#f9fafb"
                                : occ
                                  ? "#fff"
                                  : "#fafafa",
                              cursor: avail || occ ? "pointer" : "default",
                              padding: "14px 16px",
                              transition: "all .2s",
                            }}
                            onMouseEnter={(e) => {
                              if (avail || occ) {
                                e.currentTarget.style.transform =
                                  "translateY(-3px)";
                                e.currentTarget.style.boxShadow =
                                  "0 8px 24px rgba(0,0,0,.1)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = "none";
                              e.currentTarget.style.boxShadow = "none";
                            }}
                          >
                            {/* Top row */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: occ && pName ? 12 : 0,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                }}
                              >
                                <BedIcon status={bed.status} />
                                <span
                                  style={{
                                    fontWeight: 800,
                                    fontSize: 15,
                                    color: "#0f172a",
                                  }}
                                >
                                  {bed.bedNumber}
                                </span>
                              </div>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  padding: "4px 12px",
                                  borderRadius: 20,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: sbg.bg,
                                  color: sbg.color,
                                }}
                              >
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: col,
                                    display: "inline-block",
                                  }}
                                />
                                {bed.status}
                              </span>
                            </div>

                            {occ && pName && (
                              <div
                                style={{
                                  borderTop: "1px solid #f1f5f9",
                                  paddingTop: 10,
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 14,
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
                                  {pInfo.uhid ? `ID: ${pInfo.uhid}` : ""}
                                  {pInfo.age ? ` | ${pInfo.age}Y` : ""}
                                  {pInfo.gender ? ` ${pInfo.gender}` : ""}
                                </div>
                                {docName && (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: "#6b7280",
                                      marginTop: 5,
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <i
                                      className="pi pi-user-edit"
                                      style={{ color: "#7c3aed", fontSize: 12 }}
                                    />
                                    {docName}
                                  </div>
                                )}
                                {admDate && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      marginTop: 4,
                                    }}
                                  >
                                    Admitted: {admDate}
                                  </div>
                                )}
                              </div>
                            )}

                            {occ && !pName && (
                              <div
                                style={{
                                  borderTop: "1px solid #f1f5f9",
                                  paddingTop: 8,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "#94a3b8",
                                    fontStyle: "italic",
                                  }}
                                >
                                  Patient data loading…
                                </div>
                              </div>
                            )}

                            {avail && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#94a3b8",
                                  marginTop: 6,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <i
                                  className="pi pi-plus-circle"
                                  style={{ color: "#22c55e", fontSize: 13 }}
                                />
                                Click To Admit Patient
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
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "10px 20px",
          border: "1px solid #e2e8f0",
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 4,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
          Legend:
        </span>
        {Object.entries(STATUS_COLOR).map(([label, col]) => (
          <span
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#475569",
            }}
          >
            <span
              style={{
                width: 20,
                height: 13,
                border: `3px solid ${col}`,
                borderRadius: 4,
                display: "inline-block",
              }}
            />
            {label}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
          <i className="pi pi-info-circle" style={{ marginRight: 4 }} />
          Green = admit · Red = patient details
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

      {/* ══ MODAL 5 — Discharge Patient ══ */}
      {/*
        KEY FIX: Removed fixed height:"88vh" and replaced with maxHeight:"90vh"
        The scrollable inner div uses flex:"1 1 0px" + minHeight:0 + overflowY:"auto"
        which is the correct flexbox pattern for scrollable children.
      */}
      <style>{`
        .discharge-scroll .p-dialog-content {
          overflow: hidden !important;
          padding: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          max-height: 90vh !important;
        }
      `}</style>

      <Dialog
        visible={dischargeModal}
        onHide={() => !discharging && setDischargeModal(false)}
        style={{ width: "560px" }}
        className="discharge-scroll"
        header={null}
        modal
        draggable={false}
        closable={false}
        contentStyle={{
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight:
            "90vh" /* ← FIXED: was height:"88vh" which caused issues */,
        }}
      >
        {dischargeAdm && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
            }}
          >
            {/* ── Fixed Header ── */}
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

            {/* ── Scrollable Content ── */}
            <div
              style={{
                overflowY: "auto",
                flex: "1 1 0px" /* ← KEY: flex-shrink must be allowed */,
                minHeight: 0 /* ← KEY: without this flexbox won't shrink */,
                padding: "20px 24px",
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

              {/* Discharge Date & Total Cost */}
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

              {/* Text areas */}
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

            {/* ── Fixed Footer Buttons ── */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #f1f5f9",
                background: "#fff",
                display: "flex",
                gap: 12,
                flexShrink: 0,
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
    </div>

  );
};

export default BedVisualLayout;
