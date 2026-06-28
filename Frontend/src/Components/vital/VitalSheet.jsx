import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getPatients } from "../../Services/userService";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { saveVitalSheet, getVitalSheet } from "../../Services/vital/vitalService";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useLocation } from "react-router-dom";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import ClinicalLayout from "../clinical/ClinicalLayout";
import PickPatientPrompt from "../clinical/PickPatientPrompt";

export default function VitalSheet({ uhid: uhidProp, embedded = false }) {
  const params = useParams();
  const uhid = uhidProp || params.uhid;
  const navigate = useNavigate();
  const toast = useRef(null);

  const [patient, setPatient] = useState(null);
  const [date, setDate] = useState(new Date());
  const [showDialog, setShowDialog] = useState(false);
  const [slot, setSlot] = useState("01 Hours");
  const [editVital, setEditVital] = useState(null);
  const [editName, setEditName] = useState("");
  const [showAddVital, setShowAddVital] = useState(false);
  const [newVitalName, setNewVitalName] = useState("");
  const [newVitalUnit, setNewVitalUnit] = useState("");
  const [timeRows, setTimeRows] = useState([]);
  // R7hr-320 — the sheet already saved for this UHID + date, fetched on open
  // so previously-charted rows are visible/pre-filled (nurse fills the next row).
  const [savedSheet, setSavedSheet] = useState(null);
  // R7hr-322 — IV-fluid volume per hour from the ongoing infusion (Intake/Output
  // ledger, INFUSION_CRON + MAR IN rows) → auto-fills the "IV Fluid" column.
  const [ivFluidByHour, setIvFluidByHour] = useState({});


  const location = useLocation();
  const editMode = location.state?.editMode || false;
  const existingRecord = location.state?.record || null;

  // const [doctorName, setDoctorName] = useState("");

  const [vitals, setVitals] = useState([
    { name: "Pulse", unit: "bpm", active: true },
    { name: "BP Systolic", unit: "mmHg", active: true },
    { name: "BP Diastolic", unit: "mmHg", active: true },
    { name: "GCS", unit: "score", active: true },
    { name: "IV Fluid", unit: "mL", active: false },
    { name: "Temperature", unit: "°F", active: true },
    { name: "Pain Score", unit: "score", active: false },
    { name: "SpO2", unit: "%", active: false },
  ]);


  const makeSafeId = (text) => text.replace(/[^a-zA-Z0-9]/g, "_");

  const getSlotMinutes = (slot) => {
    if (!slot || typeof slot !== "string") return 60;

    const [num, unit] = slot.split(" ");

    if (unit === "Minutes") return parseInt(num);
    if (unit === "Hours") return parseInt(num) * 60;

    return 60;
  };

  const generateTimeSlots = (slot) => {
    const interval = getSlotMinutes(slot);
    const times = [];
    let minutes = 0;
    while (minutes < 24 * 60) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      times.push(`${hh}:${mm}`);
      minutes += interval;
    }
    return times;
  };

  useEffect(() => {
    if (!editMode && slot) {
      setTimeRows(generateTimeSlots(slot));
    }
  }, [slot, editMode]);

  const handleSlotChange = (value) => {
    if (editMode) return;

    setSlot(value);
    setTimeRows(generateTimeSlots(value));
    setShowDialog(false);
  };


  const formatDate = (d) => {
    if (!d) return "";

    const dateObj = new Date(d);

    const dd = String(dateObj.getDate()).padStart(2, "0");
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const yyyy = dateObj.getFullYear();

    return `${yyyy}-${mm}-${dd}`;
  };


  useEffect(() => {
    if (!uhid) return;
    async function fetchPatient() {
      const all = await getPatients();
      const selected = all.find((p) => p.UHID === uhid);
      setPatient(selected);
    }
    fetchPatient();
  }, [uhid]);


  const slotOptions = [
    { label: "30 Minutes", value: "30 Minutes" },
    { label: "01 Hours", value: "01 Hours" },
    { label: "02 Hours", value: "02 Hours" },
    { label: "04 Hours", value: "04 Hours" },
    { label: "06 Hours", value: "06 Hours" },
    { label: "08 Hours", value: "08 Hours" },
    { label: "12 Hours", value: "12 Hours" },
  ];

  useEffect(() => {
    if (editMode && existingRecord) {
      setSlot(existingRecord.slot);

      setTimeRows(generateTimeSlots(existingRecord.slot));

      // Vitals
      setVitals(existingRecord.activeVitals.map(v => ({
        name: v.name,
        unit: v.unit || "",
        active: true
      })));

      // Set date
      if (existingRecord.date) {
        const [dd, mm, yyyy] = existingRecord.date.split("-");
        setDate(new Date(`${yyyy}-${mm}-${dd}`));
      }
    }
  }, [editMode, existingRecord]);

  // R7hr-320 — load the already-saved sheet for this UHID + selected date so
  // its rows pre-fill the grid (the nurse sees prior entries and fills the
  // next empty time-slot). editMode uses location.state instead, so skip it.
  useEffect(() => {
    if (!uhid || editMode) { setSavedSheet(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await getVitalSheet(uhid, formatDate(date));
        if (cancelled) return;
        const sheet = res?.success && res.data
          ? (Array.isArray(res.data) ? res.data[0] : res.data)
          : null;
        setSavedSheet(sheet || null);
        if (sheet) {
          if (sheet.slot) setSlot(sheet.slot);
          if (Array.isArray(sheet.activeVitals) && sheet.activeVitals.length) {
            const savedNames = new Set(sheet.activeVitals.map((v) => v.name));
            setVitals((prev) => {
              const base = prev.map((v) => ({ ...v, active: savedNames.has(v.name) }));
              sheet.activeVitals.forEach((sv) => {
                if (!base.some((v) => v.name === sv.name)) base.push({ name: sv.name, unit: sv.unit || "", active: true });
              });
              return base;
            });
          }
        }
      } catch { if (!cancelled) setSavedSheet(null); }

      // Ongoing-infusion IV fluid → per-hour buckets for the "IV Fluid" column.
      // Sums IN rows from the running-drip cron + MAR (IV dilutions) by hour.
      try {
        const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
        const d1 = new Date(date); d1.setHours(23, 59, 59, 999);
        const qs = new URLSearchParams({ UHID: uhid, from: d0.toISOString(), to: d1.toISOString() });
        const io = await axios.get(`${API_ENDPOINTS.INTAKE_OUTPUT}?${qs}`);
        if (!cancelled) {
          const rows = io?.data?.data?.rows || [];
          const byHour = {};
          rows.forEach((r) => {
            if (r.direction !== "IN" || r.voided) return;
            if (!["INFUSION_CRON", "MAR"].includes(r.source)) return;
            const hh = String(new Date(r.ts).getHours()).padStart(2, "0") + ":00";
            byHour[hh] = (byHour[hh] || 0) + (Number(r.volumeML) || 0);
          });
          setIvFluidByHour(byHour);
          // If the patient has ongoing infusion fluid, make sure the IV Fluid
          // column is visible so the auto value shows (it may be off in the
          // saved sheet's column set).
          if (Object.keys(byHour).length) {
            setVitals((prev) => prev.some((v) => v.name === "IV Fluid")
              ? prev.map((v) => v.name === "IV Fluid" ? { ...v, active: true } : v)
              : [...prev, { name: "IV Fluid", unit: "mL", active: true }]);
          }
        }
      } catch { if (!cancelled) setIvFluidByHour({}); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhid, date, editMode]);

  // Embedded (in the Nursing Notes Vital Signs modal) the patient is always
  // supplied via the `uhid` prop, so never show the full-page picker inside a
  // modal — just a tiny hint on the rare no-patient case.
  if (embedded && !uhid) {
    return <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>Load a patient to chart vitals.</div>;
  }

  // No :uhid in the route → land on the page with the admitted-patient picker
  // (same as every other clinical page) instead of dead-ending. Picking a
  // patient routes to /vitalSheet/:uhid, which remounts with the patient
  // loaded. Placed AFTER all hooks so the hook order stays constant across
  // the no-patient → patient-selected transition.
  if (!uhid && !editMode && !existingRecord) {
    return (
      <ClinicalLayout
        onPatientSelect={(adm) => {
          const u = adm?.UHID || adm?.uhid;
          if (u) navigate(`/vitalSheet/${u}`);
        }}
        pageType="vitals"
      >
        <PickPatientPrompt
          icon="pi-heart"
          title="Record Vitals"
          lines={[
            "Choose an admitted patient to start recording",
            "BP / pulse / temperature / SpO₂.",
          ]}
        />
      </ClinicalLayout>
    );
  }




  // R7hr-319 — settings dialog redesigned; the PrimeReact OrderList (detached
  // reorder arrows) is replaced by a custom premium list. These helpers drive
  // the active toggle (BP Systolic/Diastolic stay paired), per-row reorder, and
  // the small reorder-button style.
  const toggleVital = (item, value) => {
    setVitals((prev) => prev.map((v) => {
      if ((item.name === "BP Systolic" && v.name === "BP Diastolic") ||
          (item.name === "BP Diastolic" && v.name === "BP Systolic")) return { ...v, active: value };
      if (v.name === item.name) return { ...v, active: value };
      return v;
    }));
  };
  const moveVital = (idx, dir) => {
    setVitals((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const reorderBtnStyle = (disabled) => ({
    width: 26, height: 19, borderRadius: 6, border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#cbd5e1" : "#4338ca",
    cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  });
  const dlgLabelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 };
  const ghostBtnStyle = { padding: "8px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" };
  const primaryBtnStyle = (disabled) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, border: "none", background: disabled ? "#cbd5e1" : "linear-gradient(135deg,#4f46e5,#4338ca)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 4px 12px rgba(67,56,202,.3)", fontFamily: "'DM Sans',sans-serif" });

  // const VitalSheetSchema = Yup.object().shape({
  //   tableData: Yup.array().of(
  //     Yup.object().shape({
  //       notes: Yup.string().required("Required"),
  //       nurse: Yup.string().required("Required"),
  //     })
  //   ),
  // });

  return (
    <div className={embedded ? "" : "mw-100 h-100 p-3 mt-6 bg-light px-5"}>
      <Toast ref={toast} />

      {!embedded && (
        <div className="d-flex justify-content-center ">
          <h2>Vital Sheet</h2>
        </div>
      )}
      <div className="d-flex justify-content-between" style={embedded ? { alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 } : undefined}>
        {embedded ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="pi pi-heart-fill" style={{ color: "#4338ca", fontSize: 14 }} />
            </span>
            <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Hourly Vital Chart</span>
            {patient && <span style={{ fontSize: 12, color: "#64748b" }}>· {patient.name} · {patient.UHID}</span>}
          </div>
        ) : (patient && (
          <div className="row g-1">
            <div className="col-6"><p><strong>Patient Name :</strong> {patient.name}</p></div>
            <div className="col-6"><p><strong>Age :</strong> {patient.age}</p></div>
            <div className="col-6"><p><strong>Gender :</strong> {patient.gender}</p></div>
            <div className="col-6"><p><strong>UHID :</strong> {patient.UHID}</p></div>
          </div>
        ))}


        <div className="d-flex gap-3 align-content-center">
          {/* <input
            type="text"
            className="form-control"
            style={{ width: "200px", height: "45px", border: "1px solid gray" }}
            placeholder="doctor name"
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
          /> */}

          <Calendar
            value={date instanceof Date ? date : new Date(date)}
            onChange={(e) => setDate(e.value)}
            dateFormat="dd-mm-yy"
          />


          <Button
            icon="pi pi-cog"
            onClick={() => setShowDialog(true)}
            style={{ width: "35px", height: "35px", padding: "0" }}
          />
        </div>
      </div>

      {/* SETTINGS — R7hr-319 premium redesign */}
      <Dialog
        header="Vital Data Sheet Setting"
        visible={showDialog}
        style={{ width: 580, maxWidth: "96vw" }}
        onHide={() => setShowDialog(false)}
      >
        <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
          {/* Top bar: charting interval + add vital */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Charting interval</label>
              <Dropdown value={slot} options={slotOptions} onChange={(e) => handleSlotChange(e.value)} style={{ width: 210 }} />
            </div>
            <button onClick={() => setShowAddVital(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "none",
                background: "linear-gradient(135deg,#4f46e5,#4338ca)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                boxShadow: "0 4px 12px rgba(67,56,202,.3)", fontFamily: "'DM Sans',sans-serif" }}>
              <i className="pi pi-plus" style={{ fontSize: 12 }} /> Add Vital
            </button>
          </div>

          {/* Hint */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>
            <i className="pi pi-info-circle" style={{ fontSize: 11 }} />
            Toggle which vitals chart as columns · arrows reorder ·
            <b style={{ color: "#4338ca" }}>{vitals.filter(v => v.active).length} active</b>
          </div>

          {/* Vitals list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "46vh", overflowY: "auto", paddingRight: 4 }}>
            {vitals.map((item, idx) => (
              <div key={item.name + idx}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 12,
                  border: `1.5px solid ${item.active ? "#c7d2fe" : "#e2e8f0"}`,
                  background: item.active ? "#f5f7ff" : "#fff", transition: "border-color .15s, background .15s" }}>
                {/* reorder */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <button title="Move up" disabled={idx === 0} onClick={() => moveVital(idx, -1)} style={reorderBtnStyle(idx === 0)}>
                    <i className="pi pi-chevron-up" style={{ fontSize: 9 }} />
                  </button>
                  <button title="Move down" disabled={idx === vitals.length - 1} onClick={() => moveVital(idx, 1)} style={reorderBtnStyle(idx === vitals.length - 1)}>
                    <i className="pi pi-chevron-down" style={{ fontSize: 9 }} />
                  </button>
                </div>
                {/* name + unit */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{item.name}</div>
                  {item.unit && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{item.unit}</div>}
                </div>
                {/* edit */}
                <button onClick={() => { setEditVital(item); setEditName(item.name); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8,
                    border: "1.5px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Edit
                </button>
                {/* toggle */}
                <InputSwitch checked={item.active} onChange={(e) => toggleVital(item, e.value)} />
              </div>
            ))}
          </div>
        </div>
      </Dialog>

      {/* ADD VITAL — R7hr-319 */}
      <Dialog
        header="Add New Vital"
        visible={showAddVital}
        onHide={() => setShowAddVital(false)}
        style={{ width: 420, maxWidth: "94vw" }}
      >
        <div style={{ fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={dlgLabelStyle}>Vital name</label>
            <input type="text" className="form-control" placeholder="e.g. Respiratory Rate"
              value={newVitalName} onChange={(e) => setNewVitalName(e.target.value)} />
          </div>
          <div>
            <label style={dlgLabelStyle}>Unit <span style={{ fontWeight: 500, textTransform: "none", color: "#94a3b8" }}>(optional)</span></label>
            <input type="text" className="form-control" placeholder="e.g. bpm, °C, mmHg"
              value={newVitalUnit} onChange={(e) => setNewVitalUnit(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button onClick={() => setShowAddVital(false)} style={ghostBtnStyle}>Cancel</button>
            <button disabled={!newVitalName.trim()} style={primaryBtnStyle(!newVitalName.trim())}
              onClick={() => {
                if (!newVitalName.trim()) return;
                setVitals([...vitals, { name: newVitalName.trim(), unit: newVitalUnit.trim(), active: true }]);
                setNewVitalName(""); setNewVitalUnit(""); setShowAddVital(false);
              }}>
              <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add Vital
            </button>
          </div>
        </div>
      </Dialog>

      {/* EDIT VITAL — R7hr-319 */}
      <Dialog header="Edit Vital Name" visible={!!editVital} onHide={() => setEditVital(null)} style={{ width: 420, maxWidth: "94vw" }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={dlgLabelStyle}>Vital name</label>
            <input type="text" className="form-control" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button onClick={() => setEditVital(null)} style={ghostBtnStyle}>Cancel</button>
            <button disabled={!editName.trim()} style={primaryBtnStyle(!editName.trim())}
              onClick={() => {
                setVitals((prev) => prev.map((v) => v.name === editVital.name ? { ...v, name: editName } : v));
                setEditVital(null);
              }}>
              <i className="pi pi-check" style={{ fontSize: 11 }} /> Save
            </button>
          </div>
        </div>
      </Dialog>

      {/* FORM SECTION */}
      <div className="w-100 mt-4">
        <Formik
          enableReinitialize
          initialValues={{
            tableData: generateTimeSlots(slot).map((time) => {
              const oldRow = (existingRecord || savedSheet)?.tableData?.find(r => r.time === time);

              return {
                notes: oldRow?.notes || "",
                nurse: oldRow?.nurse || oldRow?.nurseName || oldRow?.recordedBy || "",
                values: (() => {
                  const acc = Object.keys(oldRow?.values || {}).reduce((a, key) => {
                    a[makeSafeId(key)] = oldRow.values[key]?.value ?? "";
                    return a;
                  }, {});
                  // R7hr-322 — auto-fill IV Fluid from the ongoing infusion when
                  // this slot hasn't already been charted (a saved value wins).
                  const ivKey = makeSafeId("IV Fluid");
                  if ((acc[ivKey] === undefined || acc[ivKey] === "") && ivFluidByHour[time] != null) {
                    acc[ivKey] = ivFluidByHour[time];
                  }
                  return acc;
                })(),
              };
            }),
          }}



          // validationSchema={VitalSheetSchema}

          onSubmit={async (values, { setSubmitting }) => {
            try {
              setSubmitting(true);

              const payload = {
                uhid: patient.UHID,
                date: editMode && existingRecord
                  ? existingRecord.date
                  : formatDate(date),

                patientInfo: {
                  name: patient.name,
                  age: patient.age,
                  gender: patient.gender,
                },

                activeVitals: vitals
                  .filter(v => v.active)
                  .map(v => ({
                    name: v.name,
                    unit: v.unit
                  })),

                slot,

                tableData: timeRows
                  .map((time, idx) => {
                    const row = values.tableData[idx];

                    const rowValues = vitals
                      .filter(v => v.active)
                      .reduce((acc, v) => {
                        const safe = makeSafeId(v.name);
                        const val = row?.values?.[safe];

                        // FIX (audit P20): the old logic preferred `oldVal`
                        // unconditionally when a previous value existed,
                        // making corrections impossible — typos became
                        // permanent. New behavior: the FRESH input from
                        // the form wins. Only fall back to oldVal when the
                        // user has explicitly cleared the field (empty
                        // string + undefined).
                        const oldVal = (existingRecord || savedSheet)?.tableData
                          ?.find(r => r.time === time)
                          ?.values?.[v.name];

                        const hasFreshInput = val !== "" && val !== undefined && val !== null;
                        if (hasFreshInput) {
                          acc[v.name] = {
                            value: Number(val),
                            unit:  v.unit,
                          };
                        } else if (oldVal != null) {
                          acc[v.name] = oldVal;
                        }

                        return acc;
                      }, {});

                    if (
                      Object.keys(rowValues).length > 0 ||
                      row?.notes ||
                      row?.nurse
                    ) {
                      return {
                        time,
                        notes: row.notes || "",
                        // Backend's resolveNurse now accepts staffId/name
                        // strings (audit P20 fix) — populate BOTH the legacy
                        // `nurse` field and the canonical `recordedBy` so
                        // either is found by the service.
                        nurse:      row.nurse || "",
                        recordedBy: row.nurse || "",
                        nurseName:  row.nurse || "",
                        values: rowValues,
                      };
                    }

                    return null;
                  })
                  .filter(Boolean),
              };

              await saveVitalSheet(payload);

              toast.current.show({
                severity: "success",
                summary: "Saved",
                detail: "Vital sheet saved successfully",
              });
            } catch (err) {
              toast.current.show({
                severity: "error",
                summary: "Error",
                detail: "Failed to save data",
              });
            } finally {
              setSubmitting(false);
            }
          }}
        >

          {({ values, isSubmitting }) => (
            <Form>
              <div className="vsheet-grid" style={{ maxHeight: embedded ? "56vh" : "none" }}>
              <table className="table table-bordered table-striped text-center align-middle">
                <thead className="table-primary">
                  <tr>
                    <th>Time</th>
                    {vitals.filter(v => v.active).map((v, idx) => (
                      <th key={idx}>
                        {/* R7hr-323 — name on top, unit stacked below (keeps its
                            exact case). Narrows each vital column so the Remarks
                            column has more room for long text. */}
                        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, alignItems: "center" }}>
                          <span>{v.name}</span>
                          {v.unit ? <span style={{ textTransform: "none", fontSize: 9, fontWeight: 600, color: "#64748b", marginTop: 1 }}>({v.unit})</span> : null}
                        </div>
                      </th>
                    ))}

                    <th style={{ minWidth: 240 }}>Remarks</th>
                    <th style={{ minWidth: 130 }}>Nursing Officer</th>
                  </tr>
                </thead>
                <tbody>
                  {timeRows.map((time, rowIndex) => (
                    <tr key={rowIndex}>
                      <td>
                        <input type="time" readOnly value={time} className="form-control bg-light text-center" />
                      </td>
                      {vitals.filter(v => v.active).map((v, colIndex) => {
                        const safe = makeSafeId(v.name);
                        return (
                          <td key={colIndex}>
                            <Field
                              name={`tableData[${rowIndex}].values.${safe}`}
                              type="number"
                            >
                              {({ field }) => (
                                <input
                                  {...field}
                                  type="number"
                                  className="form-control text-center"
                                  value={field.value ?? ""}
                                  min={v.name === "GCS" ? 3 : undefined}
                                  max={v.name === "GCS" ? 15 : undefined}
                                  onKeyDown={(e) =>
                                    ["e", "E", "+", "-"].includes(e.key) && e.preventDefault()
                                  }
                                  onChange={(e) => {
                                    let value = e.target.value;

                                    if (value === "") {
                                      field.onChange(e);
                                      return;
                                    }

                                    let num = Number(value);

                                    // prevent negative
                                    if (num < 0) num = 0;

                                    if (v.name === "GCS") {
                                      if (num < 3) num = 3;
                                      if (num > 15) num = 15;
                                    }

                                    field.onChange({
                                      target: {
                                        name: field.name,
                                        value: num,
                                      },
                                    });
                                  }}
                                  /* FIX (audit P20): removed the edit-lock —
                                     it made every previously-recorded vital
                                     permanently uneditable, so typos were
                                     locked in forever. Vitals must be
                                     correctable per NABH amendment policy
                                     (an audit trail is the right answer, not
                                     a hard lock at the UI layer). */
                                />

                              )}
                            </Field>


                          </td>
                        );
                      })}

                      <td>
                        <Field name={`tableData[${rowIndex}].notes`}>
                          {({ field }) => (
                            <input
                              {...field}
                              type="text"
                              className="form-control"
                              value={field.value ?? ""}
                              style={{ textAlign: "left", minWidth: 220 }}
                            />
                          )}
                        </Field>
                      </td>

                      <td>
                        <Field name={`tableData[${rowIndex}].nurse`}>
                          {({ field }) => (
                            <input
                              {...field}
                              type="text"
                              className="form-control text-center"
                              value={field.value ?? ""}
                            />
                          )}
                        </Field>
                      </td>


                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              <div className="w-100 d-flex justify-content-center" style={{ marginTop: 14 }}>
                <Button label={isSubmitting ? "Saving..." : "Save"} type="submit" disabled={isSubmitting} />
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
