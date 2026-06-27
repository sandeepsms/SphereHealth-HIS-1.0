import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getPatients } from "../../Services/userService";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { OrderList } from "primereact/orderlist";
import { InputSwitch } from "primereact/inputswitch";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { saveVitalSheet } from "../../Services/vital/vitalService";
import { useLocation } from "react-router-dom";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import ClinicalLayout from "../clinical/ClinicalLayout";
import PickPatientPrompt from "../clinical/PickPatientPrompt";

export default function VitalSheet() {
  const { uhid } = useParams();
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




  const vitalTemplate = (item) => (
    <div className="d-flex justify-content-between align-items-center w-100 py-2">
      <strong>{item.name}</strong>
      <div className="d-flex gap-3">
        <Button
          label="Edit"
          size="small"
          onClick={() => {
            setEditVital(item);
            setEditName(item.name);
          }}
        />
        <InputSwitch
          checked={item.active}
          onChange={(e) => {
            setVitals((prev) =>
              prev.map((v) => {

                if (
                  (item.name === "BP Systolic" && v.name === "BP Diastolic") ||
                  (item.name === "BP Diastolic" && v.name === "BP Systolic")
                ) {
                  return { ...v, active: e.value };
                }


                if (v.name === item.name) {
                  return { ...v, active: e.value };
                }

                return v;
              })
            );
          }}
        />

      </div>
    </div>
  );

  // const VitalSheetSchema = Yup.object().shape({
  //   tableData: Yup.array().of(
  //     Yup.object().shape({
  //       notes: Yup.string().required("Required"),
  //       nurse: Yup.string().required("Required"),
  //     })
  //   ),
  // });

  return (
    <div className="mw-100 h-100 p-3 mt-6 bg-light px-5">
      <Toast ref={toast} />

      <div className="d-flex justify-content-center ">
        <h2>Vital Sheet</h2>
      </div>
      <div className="d-flex justify-content-between">
        {patient && (
          <div className="row g-1">
            <div className="col-6"><p><strong>Patient Name :</strong> {patient.name}</p></div>
            <div className="col-6"><p><strong>Age :</strong> {patient.age}</p></div>
            <div className="col-6"><p><strong>Gender :</strong> {patient.gender}</p></div>
            <div className="col-6"><p><strong>UHID :</strong> {patient.UHID}</p></div>
          </div>
        )}


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

      {/* SETTINGS */}
      <Dialog
        header="Vital Data Sheet Setting"
        visible={showDialog}
        style={{ width: "60vw" }}
        onHide={() => setShowDialog(false)}
      >
        <div className="d-flex gap-3 mb-3">
          <Dropdown
            value={slot}
            options={slotOptions}
            onChange={(e) => handleSlotChange(e.value)}
            className="w-25"
          />
          <Button
            label="Add Vital"
            icon="pi pi-plus"
            onClick={() => setShowAddVital(true)}
          />
        </div>

        <OrderList
          value={vitals}
          onChange={(e) => setVitals(e.value)}
          itemTemplate={vitalTemplate}
          listStyle={{ height: "400px" }}
        />
      </Dialog>

      {/* ADD VITAL */}
      <Dialog
        header="Add New Vital"
        visible={showAddVital}
        onHide={() => setShowAddVital(false)}
      >
        <input
          type="text"
          className="form-control mb-2"
          placeholder="Enter new vital name"
          value={newVitalName}
          onChange={(e) => setNewVitalName(e.target.value)}
        />

        <input
          type="text"
          className="form-control"
          placeholder="Enter unit (e.g. bpm, °C, mmHg)"
          value={newVitalUnit}
          onChange={(e) => setNewVitalUnit(e.target.value)}
        />

        <Button
          label="Add"
          className="mt-3"
          onClick={() => {
            if (!newVitalName.trim()) return;

            setVitals([
              ...vitals,
              {
                name: newVitalName.trim(),
                unit: newVitalUnit.trim(),
                active: true,
              },
            ]);

            setNewVitalName("");
            setNewVitalUnit("");
            setShowAddVital(false);
          }}
        />
      </Dialog>


      {/* EDIT VITAL */}
      <Dialog header="Edit Vital Name" visible={!!editVital} onHide={() => setEditVital(null)}>
        <input
          type="text"
          className="form-control"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
        />
        <Button
          label="Save"
          className="mt-3"
          onClick={() => {
            setVitals((prev) =>
              prev.map((v) =>
                v.name === editVital.name ? { ...v, name: editName } : v
              )
            );
            setEditVital(null);
          }}
        />
      </Dialog>

      {/* FORM SECTION */}
      <div className="w-100 mt-4">
        <Formik
          enableReinitialize
          initialValues={{
            tableData: generateTimeSlots(slot).map((time) => {
              const oldRow = existingRecord?.tableData?.find(r => r.time === time);

              return {
                notes: oldRow?.notes || "",
                nurse: oldRow?.nurse || "",
                values: Object.keys(oldRow?.values || {}).reduce((acc, key) => {
                  acc[makeSafeId(key)] = oldRow.values[key]?.value ?? "";
                  return acc;
                }, {}),
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
                        const oldVal = existingRecord?.tableData
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
              <table className="table table-bordered table-striped text-center align-middle">
                <thead className="table-primary">
                  <tr>
                    <th>Time</th>
                    {vitals.filter(v => v.active).map((v, idx) => (
                      <th key={idx}>
                        {v.name} {v.unit ? `(${v.unit})` : ""}
                      </th>
                    ))}

                    <th>Remarks </th>
                    <th>Nursing Officer</th>
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
                              className="form-control text-center"
                              value={field.value ?? ""}
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

              <div className="w-100 d-flex justify-content-center">
                <Button label={isSubmitting ? "Saving..." : "Save"} type="submit" disabled={isSubmitting} />
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
