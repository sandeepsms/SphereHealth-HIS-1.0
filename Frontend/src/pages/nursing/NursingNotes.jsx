import { useEffect } from "react";
import { Formik, FieldArray } from "formik";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import "../../../css/nursing.css";

import { InputTextarea } from "primereact/inputtextarea";

import {
  createNurseNote,
  getNurseNotes,
  updateNurseNote,
} from "../../Services/nurse/NursingNotes";
const NursingNotes = () => {
  const shiftOptions = [
    { label: "Morning", value: "morning" },
    { label: "Evening", value: "evening" },
    { label: "Night", value: "night" },
  ];

  const yesNo = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ];

  const mapToBackend = (values) => ({
    patientUHID: values.uhid,
    patientName: values.patientName,
    ipdNo: values.admissionNo,
    shift: values.shift,

    vitals: {
      pulse: Number(values.vitals[0]?.hr),
      temp: Number(values.vitals[0]?.temp),
      rr: Number(values.vitals[0]?.rr),
      spo2: Number(values.vitals[0]?.spo2),
      bp: {
        systolic: Number(values.vitals[0]?.bp?.split("/")[0] || 0),
        diastolic: Number(values.vitals[0]?.bp?.split("/")[1] || 0),
      },
    },

    intakeOutput: {
      oral: Number(values.oralIntake),
      ivFluids: Number(values.ivTotal),
      urineOutput: Number(values.urineOutput),
      otherOutput: Number(values.drainOutput),
    },

    nursingCare: {
      positionChanged: values.positionChange === "yes",
      catheterCare: values.catheterCare === "done",
      woundDressing: values.dressing === "changed",
    },

    remarks: values.remarks,
    status: "submitted",
  });

  // useEffect(() => {
  //   const fetchData = async () => {
  //     try {
  //       const res = await getNurseNotes("UH00000125");
  //       const data = res.data.data;

  //       formik.setValues({
  //         _id: data._id,
  //         uhid: data.patientUHID,
  //         patientName: data.patientName,
  //         admissionNo: data.ipdNo,
  //         shift: data.shift,

  //         vitals: [
  //           {
  //             hr: data.vitals?.pulse || "",
  //             temp: data.vitals?.temp || "",
  //             rr: data.vitals?.rr || "",
  //             spo2: data.vitals?.spo2 || "",
  //             bp: `${data.vitals?.bp?.systolic || ""}/${data.vitals?.bp?.diastolic || ""}`,
  //           },
  //         ],

  //         oralIntake: data.intakeOutput?.oral || "",
  //         ivTotal: data.intakeOutput?.ivFluids || "",
  //         urineOutput: data.intakeOutput?.urineOutput || "",
  //         drainOutput: data.intakeOutput?.otherOutput || "",

  //         remarks: data.remarks || "",
  //       });
  //     } catch (err) {
  //       console.log(err);
  //     }
  //   };

  //   fetchData();
  // }, []);

  return (
    <Formik
      initialValues={{
        uhid: "UH00000125",
        admissionNo: "",
        patientName: "",
        ageSex: "",
        diagnosis: "",
        consultant: "",
        bed: "",
        ventilation: "",
        mode: "",
        FiO2: "",
        peep: "",
        shift: "",
        vitals: [
          {
            time: "",
            hr: "",
            bp: "",
            spo2: "",
            rr: "",
            temp: "",
            urine: "",
          },
        ],

        ivHourly: "",
        ivTotal: "",
        oralIntake: "",
        urineOutput: "",
        totalOutput: "",
        netBalance: "",
        drainOutput: "",
        stool: "",

        position: "",
        pressureCare: "",
        mouthCare: "",
        etCare: "",

        ivSite: "",
        dressing: "",
        catheterCare: "",
        bowelCare: "",

        restraints: "",
        fallRisk: "",

        mouthSkinCare: "",
        positionChange: "",

        remarks: "",
      }}
      onSubmit={async (values) => {
        try {
          const payload = mapToBackend(values.uhid);

          if (values.uhid) {   
            await updateNurseNote(values.uhid, payload);
            alert("Updated ✅");
          } else {
            await createNurseNote(payload);
            alert("Saved ✅");
          }
        } catch (err) {
          console.error(err);
          alert("Error ❌");
        }
      }}
    >
      {(formik) => (
        <form
          onSubmit={formik.handleSubmit}
          className="p-4 space-y-4 bg-gray-100"
        >
          {/* Header */}
          <h1 className="text-xl font-bold text-black bg-red-800 p-3 rounded">
            ICU Hourly Nursing Chart
          </h1>

          {/* Patient Details */}
          <div className="patient-card">
            <div className="patient-grid">
              <div className="patient-field">
                <label className="patient-label">UHID</label>
                <InputText
                  name="uhid"
                  value={formik.values.uhid}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Admission No</label>
                <InputText
                  name="admissionNo"
                  value={formik.values.admissionNo}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Patient Name</label>
                <InputText
                  name="patientName"
                  value={formik.values.patientName}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Age / Sex</label>
                <InputText
                  name="ageSex"
                  value={formik.values.ageSex}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Diagnosis</label>
                <InputText
                  name="diagnosis"
                  value={formik.values.diagnosis}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Consultant</label>
                <InputText
                  name="consultant"
                  value={formik.values.consultant}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">ICU Bed</label>
                <InputText
                  name="bed"
                  value={formik.values.bed}
                  onChange={formik.handleChange}
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Ventilation</label>
                <Dropdown
                  value={formik.values.ventilation}
                  options={yesNo}
                  onChange={(e) => formik.setFieldValue("ventilation", e.value)}
                  placeholder="Select"
                  className="patient-input"
                />
              </div>

              <div className="patient-field">
                <label className="patient-label">Shift</label>
                <Dropdown
                  value={formik.values.shift}
                  options={shiftOptions}
                  onChange={(e) => formik.setFieldValue("shift", e.value)}
                  placeholder="Select"
                  className="patient-input"
                />
              </div>
            </div>

            {formik.values.ventilation === "yes" && (
              <div className="vent-row">
                <div className="patient-field">
                  <label className="patient-label">Mode</label>
                  <InputText
                    name="mode"
                    value={formik.values.mode}
                    onChange={formik.handleChange}
                    className="patient-input"
                    placeholder="VC / PC / SIMV"
                  />
                </div>

                <div className="patient-field">
                  <label className="patient-label">FiO2 (%)</label>
                  <InputText
                    name="fiO2"
                    value={formik.values.fiO2}
                    onChange={formik.handleChange}
                    className="patient-input"
                  />
                </div>

                <div className="patient-field">
                  <label className="patient-label">PEEP</label>
                  <InputText
                    name="peep"
                    value={formik.values.peep}
                    onChange={formik.handleChange}
                    className="patient-input"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Vitals */}
          <FieldArray name="vitals">
            {(arrayHelpers) => (
              <div className="bg-white p-4 rounded-xl shadow">
                <h2 className="text-red-700 font-bold mb-3">
                  Hourly ICU Charting
                </h2>

                <table className="w-full text-sm border">
                  <thead>
                    <tr className="bg-gray-200">
                      <th>Time</th>
                      <th>HR</th>
                      <th>BP</th>
                      <th>SpO2</th>
                      <th>RR</th>
                      <th>Temp</th>
                      <th>Urine</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {formik.values.vitals.map((v, index) => (
                      <tr key={index}>
                        <td>
                          <InputText
                            type="time"
                            value={v.time}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.time`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.hr}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.hr`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.bp}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.bp`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.spo2}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.spo2`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.rr}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.rr`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.temp}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.temp`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <InputText
                            value={v.urine}
                            onChange={(e) =>
                              formik.setFieldValue(
                                `vitals.${index}.urine`,
                                e.target.value,
                              )
                            }
                          />
                        </td>

                        <td>
                          <Button
                            type="button"
                            icon="pi pi-trash"
                            severity="danger"
                            onClick={() => arrayHelpers.remove(index)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Button
                  type="button"
                  label="Add Hour"
                  icon="pi pi-plus"
                  className="mt-3"
                  onClick={() =>
                    arrayHelpers.push({
                      time: "",
                      hr: "",
                      bp: "",
                      spo2: "",
                      rr: "",
                      temp: "",
                      urine: "",
                    })
                  }
                />
              </div>
            )}
          </FieldArray>

          {/* Intake Output */}
          <div className="intake-card">
            <h2 className="intake-title">Intake – Output Summary</h2>

            <div className="intake-grid">
              {/* IV Hourly */}
              <div className="intake-field">
                <label className="intake-label">ADD (Hourly)</label>
                <InputText
                  name="ivHourly"
                  value={formik.values.ivHourly}
                  onChange={formik.handleChange}
                  className="intake-input"
                />
              </div>

              {/* Total IV */}
              <div className="intake-field">
                <label className="intake-label">Total IV Intake (ml)</label>
                <InputText
                  name="ivTotal"
                  value={formik.values.ivTotal}
                  onChange={formik.handleChange}
                  className="intake-input"
                />
              </div>

              {/* Oral */}
              <div className="intake-field">
                <label className="intake-label">Oral / NG Intake (ml)</label>
                <InputText
                  name="oralIntake"
                  value={formik.values.oralIntake}
                  onChange={formik.handleChange}
                  className="intake-input"
                />
              </div>

              {/* Urine */}
              <div className="intake-field">
                <label className="intake-label">Urine Output (ml)</label>
                <InputText
                  name="urineOutput"
                  value={formik.values.urineOutput}
                  onChange={formik.handleChange}
                  className="intake-input"
                />
              </div>

              {/* Total Output */}
              <div className="intake-field">
                <label className="intake-label">Total Output (ml)</label>
                <InputText
                  name="totalOutput"
                  value={formik.values.totalOutput}
                  onChange={formik.handleChange}
                  className="intake-input readonly"
                />
              </div>

              {/* Net Balance */}
              <div className="intake-field">
                <label className="intake-label">Net Balance</label>
                <InputText
                  name="netBalance"
                  value={formik.values.netBalance}
                  onChange={formik.handleChange}
                  className="intake-input readonly"
                />
              </div>

              {/* Drain */}
              <div className="intake-field">
                <label className="intake-label">Drain Output</label>
                <InputText
                  name="drainOutput"
                  value={formik.values.drainOutput}
                  onChange={formik.handleChange}
                  className="intake-input"
                />
              </div>

              {/* Stool */}
              <div className="intake-field">
                <label className="intake-label">Stool</label>
                <Dropdown
                  value={formik.values.stool}
                  options={[
                    { label: "Normal", value: "normal" },
                    { label: "Loose", value: "loose" },
                    { label: "Absent", value: "absent" },
                  ]}
                  onChange={(e) => formik.setFieldValue("stool", e.value)}
                  placeholder="Select"
                  className="intake-input"
                />
              </div>
            </div>
          </div>

          {/* Nursing Care */}

          <div className="nursing-card">
            <h2 className="nursing-title">Nursing Care & Observations</h2>

            <div className="nursing-grid">
              {/* Position */}
              <div className="nursing-field">
                <label className="nursing-label">Position</label>
                <Dropdown
                  value={formik.values.position}
                  options={[
                    { label: "Supine", value: "supine" },
                    { label: "Prone", value: "prone" },
                    { label: "Lateral", value: "lateral" },
                    { label: "Propped", value: "propped" },
                  ]}
                  onChange={(e) => formik.setFieldValue("position", e.value)}
                  placeholder="Select"
                  className="nursing-input"
                />
              </div>

              {/* Pressure Area */}
              <div className="nursing-field">
                <label className="nursing-label">Pressure Area Care</label>
                <Dropdown
                  value={formik.values.pressureCare}
                  options={[
                    { label: "Done", value: "done" },
                    { label: "Due", value: "due" },
                  ]}
                  onChange={(e) =>
                    formik.setFieldValue("pressureCare", e.value)
                  }
                  placeholder="Select"
                  className="nursing-input"
                />
              </div>

              {/* Mouth Care */}
              <div className="nursing-field">
                <label className="nursing-label">Mouth / Eye Care</label>
                <Dropdown
                  value={formik.values.mouthCare}
                  options={[
                    { label: "Done", value: "done" },
                    { label: "Due", value: "due" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("mouthCare", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* ET Care */}
              <div className="nursing-field">
                <label className="nursing-label">ET / Tracheostomy Care</label>
                <Dropdown
                  value={formik.values.etCare}
                  options={[
                    { label: "NA", value: "na" },
                    { label: "Done", value: "done" },
                    { label: "Due", value: "due" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("etCare", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* IV Line Site */}
              <div className="nursing-field">
                <label className="nursing-label">IV Line Site</label>
                <Dropdown
                  value={formik.values.ivSite}
                  options={[
                    { label: "Healthy", value: "healthy" },
                    { label: "Redness", value: "redness" },
                    { label: "Swelling", value: "swelling" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("ivSite", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* Dressing */}
              <div className="nursing-field">
                <label className="nursing-label">Dressing</label>
                <Dropdown
                  value={formik.values.dressing}
                  options={[
                    { label: "Clean", value: "clean" },
                    { label: "Soiled", value: "soiled" },
                    { label: "Changed", value: "changed" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("dressing", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* Catheter Care */}
              <div className="nursing-field">
                <label className="nursing-label">Catheter Care</label>
                <Dropdown
                  value={formik.values.catheterCare}
                  options={[
                    { label: "NA", value: "na" },
                    { label: "Done", value: "done" },
                    { label: "Due", value: "due" },
                  ]}
                  onChange={(e) =>
                    formik.setFieldValue("catheterCare", e.value)
                  }
                  placeholder="Select"
                  className="nursing-input"
                />
              </div>

              {/* Bowel Care */}
              <div className="nursing-field">
                <label className="nursing-label">Bowel Care</label>
                <Dropdown
                  value={formik.values.bowelCare}
                  options={[
                    { label: "Done", value: "done" },
                    { label: "Not Required", value: "not_required" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("bowelCare", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* Restraints */}
              <div className="nursing-field">
                <label className="nursing-label">Restraints</label>
                <Dropdown
                  value={formik.values.restraints}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("restraints", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* Fall Risk */}
              <div className="nursing-field">
                <label className="nursing-label">Fall Risk</label>
                <Dropdown
                  value={formik.values.fallRisk}
                  options={[
                    { label: "Low", value: "low" },
                    { label: "High", value: "high" },
                  ]}
                  placeholder="Select"
                  onChange={(e) => formik.setFieldValue("fallRisk", e.value)}
                  className="nursing-input"
                />
              </div>

              {/* Mouth/Skin Care */}
              <div className="nursing-field">
                <label className="nursing-label">Mouth/Skin Care</label>
                <Dropdown
                  value={formik.values.mouthSkinCare}
                  options={[
                    { label: "Done", value: "done" },
                    { label: "Due", value: "due" },
                  ]}
                  onChange={(e) =>
                    formik.setFieldValue("mouthSkinCare", e.value)
                  }
                  placeholder="Select"
                  className="nursing-input"
                />
              </div>

              {/* Position Change */}
              <div className="nursing-field">
                <label className="nursing-label">Position Change</label>
                <Dropdown
                  value={formik.values.positionChange}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  onChange={(e) =>
                    formik.setFieldValue("positionChange", e.value)
                  }
                  placeholder="Select"
                  className="nursing-input"
                />
              </div>

              {/* Remarks */}
              <div className="nursing-field-textarea full-width">
                <label className="nursing-label">Remarks / Observations</label>
                <InputTextarea
                  name="remarks"
                  value={formik.values.remarks}
                  onChange={formik.handleChange}
                  rows={4}
                  placeholder="Enter the observations..."
                  className="nursing-input-textarea"
                />
              </div>
            </div>
          </div>

          <Button type="submit" label="Save Chart" className="w-full" />
        </form>
      )}
    </Formik>
  );
};

export default NursingNotes;

// import React, { useEffect, useRef } from "react";
// import { Formik, FieldArray } from "formik";
// import { InputText } from "primereact/inputtext";
// import { Dropdown } from "primereact/dropdown";
// import { Button } from "primereact/button";
// import { InputTextarea } from "primereact/inputtextarea";
// import "../../../css/nursing.css";

// // import {
// //   createNurseNote,
// //   getNurseNotes,
// //   updateNurseNote,
// // } from "../services/nurseService";

// const NursingNotes = () => {
//   const formikRef = useRef();

//   const shiftOptions = [
//     { label: "Morning", value: "morning" },
//     { label: "Evening", value: "evening" },
//     { label: "Night", value: "night" },
//   ];

//   const yesNo = [
//     { label: "Yes", value: "yes" },
//     { label: "No", value: "no" },
//   ];

//   // 🔥 SAFE MAPPING
//   const mapToBackend = (values) => {
//     const latest = values.vitals[values.vitals.length - 1] || {};

//     const bp = latest.bp || "";
//     const [sys, dia] = bp.includes("/") ? bp.split("/") : [0, 0];

//     return {
//       patientUHID: values.uhid,
//       patientName: values.patientName,
//       ipdNo: values.admissionNo,
//       shift: values.shift,

//       vitals: {
//         pulse: Number(latest.hr || 0),
//         temp: Number(latest.temp || 0),
//         rr: Number(latest.rr || 0),
//         spo2: Number(latest.spo2 || 0),
//         bp: {
//           systolic: Number(sys),
//           diastolic: Number(dia),
//         },
//       },

//       intakeOutput: {
//         oral: Number(values.oralIntake || 0),
//         ivFluids: Number(values.ivTotal || 0),
//         urineOutput: Number(values.urineOutput || 0),
//         otherOutput: Number(values.drainOutput || 0),
//       },

//       nursingCare: {
//         positionChanged: values.positionChange === "yes",
//         catheterCare: values.catheterCare === "done",
//         woundDressing: values.dressing === "changed",
//       },

//       remarks: values.remarks,
//       status: "submitted",
//     };
//   };

//   // 🔥 FETCH DATA
//   useEffect(() => {
//     const fetchData = async () => {
//       try {
//         const res = await getNurseNotes("UH00000001");
//         const data = res.data.data;

//         if (!formikRef.current) return;

//         formikRef.current.setValues({
//           _id: data._id || "",
//           uhid: data.patientUHID || "",
//           admissionNo: data.ipdNo || "",
//           patientName: data.patientName || "",
//           shift: data.shift || "",

//           vitals: [
//             {
//               time: "",
//               hr: data.vitals?.pulse || "",
//               bp: `${data.vitals?.bp?.systolic || ""}/${data.vitals?.bp?.diastolic || ""}`,
//               spo2: data.vitals?.spo2 || "",
//               rr: data.vitals?.rr || "",
//               temp: data.vitals?.temp || "",
//               urine: "",
//             },
//           ],

//           oralIntake: data.intakeOutput?.oral || "",
//           ivTotal: data.intakeOutput?.ivFluids || "",
//           urineOutput: data.intakeOutput?.urineOutput || "",
//           drainOutput: data.intakeOutput?.otherOutput || "",

//           positionChange: data.nursingCare?.positionChanged ? "yes" : "no",
//           catheterCare: data.nursingCare?.catheterCare ? "done" : "due",
//           dressing: data.nursingCare?.woundDressing ? "changed" : "clean",

//           remarks: data.remarks || "",
//         });
//       } catch (err) {
//         console.log(err);
//       }
//     };

//     fetchData();
//   }, []);

//   return (
//     <Formik
//       innerRef={formikRef}
//       initialValues={{
//         _id: "",
//         uhid: "",
//         admissionNo: "",
//         patientName: "",
//         ageSex: "",
//         diagnosis: "",
//         consultant: "",
//         bed: "",
//         ventilation: "",
//         mode: "",
//         fiO2: "",
//         peep: "",
//         shift: "",

//         vitals: [
//           {
//             time: "",
//             hr: "",
//             bp: "",
//             spo2: "",
//             rr: "",
//             temp: "",
//             urine: "",
//           },
//         ],

//         ivHourly: "",
//         ivTotal: "",
//         oralIntake: "",
//         urineOutput: "",
//         drainOutput: "",
//         stool: "",

//         position: "",
//         pressureCare: "",
//         mouthCare: "",
//         etCare: "",
//         ivSite: "",
//         dressing: "",
//         catheterCare: "",
//         bowelCare: "",
//         restraints: "",
//         fallRisk: "",
//         mouthSkinCare: "",
//         positionChange: "",
//         remarks: "",
//       }}
//       onSubmit={async (values) => {
//         try {
//           const payload = mapToBackend(values);

//           if (values._id) {
//             await updateNurseNote(values._id, payload);
//             alert("Updated ✅");
//           } else {
//             await createNurseNote(payload);
//             alert("Saved ✅");
//           }
//         } catch (err) {
//           console.error(err);
//           alert("Error ❌");
//         }
//       }}
//     >
//       {(formik) => (
//         <form onSubmit={formik.handleSubmit} className="p-4 bg-gray-100 space-y-4">

//           <h1 className="text-xl font-bold bg-red-800 text-white p-3">
//             ICU Hourly Nursing Chart
//           </h1>

//           {/* PATIENT INFO */}
//           <div className="grid grid-cols-3 gap-3 bg-white p-3 rounded">
//             <InputText name="uhid" value={formik.values.uhid} onChange={formik.handleChange} placeholder="UHID"/>
//             <InputText name="admissionNo" value={formik.values.admissionNo} onChange={formik.handleChange} placeholder="Admission No"/>
//             <InputText name="patientName" value={formik.values.patientName} onChange={formik.handleChange} placeholder="Patient Name"/>
//             <InputText name="ageSex" value={formik.values.ageSex} onChange={formik.handleChange} placeholder="Age/Sex"/>
//             <InputText name="diagnosis" value={formik.values.diagnosis} onChange={formik.handleChange} placeholder="Diagnosis"/>
//             <InputText name="consultant" value={formik.values.consultant} onChange={formik.handleChange} placeholder="Consultant"/>
//             <InputText name="bed" value={formik.values.bed} onChange={formik.handleChange} placeholder="Bed"/>

//             <Dropdown value={formik.values.ventilation} options={yesNo}
//               onChange={(e)=>formik.setFieldValue("ventilation",e.value)} placeholder="Ventilation"/>

//             <Dropdown value={formik.values.shift} options={shiftOptions}
//               onChange={(e)=>formik.setFieldValue("shift",e.value)} placeholder="Shift"/>
//           </div>

//           {/* VITALS TABLE */}
//           <FieldArray name="vitals">
//             {(arrayHelpers)=>(
//               <div className="bg-white p-3 rounded">
//                 <table className="w-full border">
//                   <thead>
//                     <tr>
//                       <th>Time</th><th>HR</th><th>BP</th><th>SpO2</th><th>RR</th><th>Temp</th><th>Urine</th><th></th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {formik.values.vitals.map((v,i)=>(
//                       <tr key={i}>
//                         <td><InputText type="time" value={v.time}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.time`,e.target.value)}/></td>

//                         <td><InputText value={v.hr}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.hr`,e.target.value)}/></td>

//                         <td><InputText value={v.bp}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.bp`,e.target.value)}/></td>

//                         <td><InputText value={v.spo2}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.spo2`,e.target.value)}/></td>

//                         <td><InputText value={v.rr}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.rr`,e.target.value)}/></td>

//                         <td><InputText value={v.temp}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.temp`,e.target.value)}/></td>

//                         <td><InputText value={v.urine}
//                           onChange={(e)=>formik.setFieldValue(`vitals.${i}.urine`,e.target.value)}/></td>

//                         <td>
//                           <Button type="button" icon="pi pi-trash"
//                             onClick={()=>arrayHelpers.remove(i)} />
//                         </td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>

//                 <Button type="button" label="Add Row"
//                   onClick={()=>arrayHelpers.push({
//                     time:"",hr:"",bp:"",spo2:"",rr:"",temp:"",urine:""
//                   })}/>
//               </div>
//             )}
//           </FieldArray>

//           {/* REMARKS */}
//           <InputTextarea name="remarks"
//             value={formik.values.remarks}
//             onChange={formik.handleChange}
//             placeholder="Remarks"/>

//           <Button type="submit" label="Save Chart" className="w-full"/>
//         </form>
//       )}
//     </Formik>
//   );
// };

// export default NursingNotes;
