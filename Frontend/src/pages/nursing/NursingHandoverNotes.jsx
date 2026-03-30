// import React from 'react'

// export default function NursingHandoverNotes() {
//   return (
//     <div>NursingHandoverNotes</div>
//   )
// }

import React from "react";
import { useFormik } from "formik";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import "../../../css/nursinghandover.css";

const NursingHandoverNotes = () => {
  const formik = useFormik({
    initialValues: {
      uhid: "",
      admissionNo: "",
      name: "",
      ageSex: "",
      wardBed: "",
      diagnosis: "",
      fromShift: "",
      toShift: "",
      date: "",
      time: "",
      outgoing: "",
      incoming: "",
      condition: "",
      consciousness: "",
      intakeIV: "",
      oral: "",
      urine: "",
      drain: "",
      stool: "",
      pending: "",
      notes: "",
      doctorInformed: "",
      medications: [{ item: "IV Antibiotics", status: "", remark: "" }],
      pulse: "",
      bp: "",
      rr: "",
      temp: "",
      spo2: "",
      vitalTime: "",
    },
    onSubmit: (values) => {
      console.log(values);
    },
  });

  const shiftOptions = ["Morning", "Evening", "Night"];
  const intakeOptions = ["Nil", "<500 ml", "500–1000 ml", ">1000 ml"];
  const simpleOptions = ["Nil", "Poor", "Adequate"];
  const urineOptions = ["Adequate", "Low", "Nil"];

  // Dynamic Medications
  const addRow = () => {
    formik.setFieldValue("medications", [
      ...formik.values.medications,
      { item: "", status: "", remark: "" },
    ]);
  };

  const removeRow = (index) => {
    const updated = formik.values.medications.filter((_, i) => i !== index);
    formik.setFieldValue("medications", updated);
  };

  return (
    <form onSubmit={formik.handleSubmit} className="container">
      {/* Patient Identification */}
      <div className="panel">
        <h3>Patient Identification</h3>
        <div className="grid">
          <InputText
            name="uhid"
            value={formik.values.uhid}
            onChange={formik.handleChange}
            placeholder="UHID"
            className="thick-input"
          />

          <InputText
            name="admissionNo"
            value={formik.values.admissionNo}
            onChange={formik.handleChange}
            placeholder="Admission No"
            className="thick-input"
          />

          <InputText
            name="name"
            value={formik.values.name}
            onChange={formik.handleChange}
            placeholder="Name"
            className="thick-input"
          />

          <InputText
            name="ageSex"
            value={formik.values.ageSex}
            onChange={formik.handleChange}
            placeholder="Age/Sex"
            className="thick-input"
          />

          <InputText
            name="wardBed"
            value={formik.values.wardBed}
            onChange={formik.handleChange}
            placeholder="Ward/Bed"
            className="thick-input"
          />

          <InputText
            name="diagnosis"
            value={formik.values.diagnosis}
            onChange={formik.handleChange}
            placeholder="Diagnosis"
            className="thick-input"
          />
        </div>
      </div>

      {/* Shift */}
      <div className="panel">
        <h3>Shift Transition</h3>
        <div className="grid">
          <Dropdown
            value={formik.values.fromShift}
            options={shiftOptions}
            onChange={(e) => formik.setFieldValue("fromShift", e.value)}
            placeholder="From Shift"
          />

          <Dropdown
            value={formik.values.toShift}
            options={shiftOptions}
            onChange={(e) => formik.setFieldValue("toShift", e.value)}
            placeholder="To Shift"
          />

          <InputText
            type="date"
            onChange={(e) => formik.setFieldValue("date", e.target.value)}
          />
          <InputText
            type="time"
            onChange={(e) => formik.setFieldValue("time", e.target.value)}
          />

          <InputText
            placeholder="Outgoing Nurse"
            onChange={(e) => formik.setFieldValue("outgoing", e.target.value)}
          />

          <InputText
            placeholder="Incoming Nurse"
            onChange={(e) => formik.setFieldValue("incoming", e.target.value)}
          />
        </div>
      </div>

      {/* Status */}
      <div className="panel">
        <h3>Patient Status</h3>

        <div className="radio-group">
          {["Stable", "Observation", "Critical"].map((item) => (
            <div key={item}>
              <RadioButton
                value={item}
                onChange={(e) => formik.setFieldValue("condition", e.value)}
                checked={formik.values.condition === item}
              />
              <label>{item}</label>
            </div>
          ))}
        </div>

        <div className="radio-group">
          {["Conscious", "Drowsy", "Unconscious"].map((item) => (
            <div key={item}>
              <RadioButton
                value={item}
                onChange={(e) => formik.setFieldValue("consciousness", e.value)}
                checked={formik.values.consciousness === item}
              />
              <label>{item}</label>
            </div>
          ))}
        </div>
      </div>

      {/* Vitals */}
      <div className="panel">
        <h3>Vitals</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Pulse</th>
              <th>BP</th>
              <th>RR</th>
              <th>Temp</th>
              <th>SpO2</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <InputText
                  name="pulse"
                  value={formik.values.pulse}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="Pulse"
                />
              </td>

              <td>
                <InputText
                  name="bp"
                  value={formik.values.bp}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="BP"
                />
              </td>

              <td>
                <InputText
                  name="rr"
                  value={formik.values.rr}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="RR"
                />
              </td>

              <td>
                <InputText
                  name="temp"
                  value={formik.values.temp}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="Temp"
                />
              </td>

              <td>
                <InputText
                  name="spo2"
                  value={formik.values.spo2}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="SpO₂"
                />
              </td>

              <td>
                <InputText
                  name="vitalTime"
                  value={formik.values.vitalTime}
                  onChange={formik.handleChange}
                  className="vital-input"
                  placeholder="Time"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Intake Output */}
      <div className="panel">
        <h3>Intake Output</h3>
        <div className="grid">
          <Dropdown
            options={intakeOptions}
            placeholder="IV Intake"
            onChange={(e) => formik.setFieldValue("intakeIV", e.value)}
          />

          <Dropdown
            options={simpleOptions}
            placeholder="Oral Intake"
            onChange={(e) => formik.setFieldValue("oral", e.value)}
          />

          <Dropdown
            options={urineOptions}
            placeholder="Urine"
            onChange={(e) => formik.setFieldValue("urine", e.value)}
          />

          <Dropdown
            options={simpleOptions}
            placeholder="Drain"
            onChange={(e) => formik.setFieldValue("drain", e.value)}
          />

          <Dropdown
            options={simpleOptions}
            placeholder="Stool"
            onChange={(e) => formik.setFieldValue("stool", e.value)}
          />
        </div>
      </div>

      {/* Medications Dynamic */}
      <div className="panel">
        <h3>Medications & Devices</h3>

        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th>Explanation</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {formik.values.medications.map((row, i) => (
              <tr key={i}>
                <td>
                  <InputText
                    value={row.item}
                    onChange={(e) => {
                      const data = [...formik.values.medications];
                      data[i].item = e.target.value;
                      formik.setFieldValue("medications", data);
                    }}
                  />
                </td>

                <td>
                  <Dropdown
                    options={["Ongoing", "Completed"]}
                    value={row.status}
                    onChange={(e) => {
                      const data = [...formik.values.medications];
                      data[i].status = e.value;
                      formik.setFieldValue("medications", data);
                    }}
                  />
                </td>

                <td>
                  <InputText
                    value={row.remark}
                    onChange={(e) => {
                      const data = [...formik.values.medications];
                      data[i].remark = e.target.value;
                      formik.setFieldValue("medications", data);
                    }}
                  />
                </td>

                <td>
                  <Button icon="pi pi-trash" onClick={() => removeRow(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Button label="Add Item" icon="pi pi-plus" onClick={addRow} />
      </div>

      {/* Pending */}
      <div className="panel">
        <h3>Pending Tasks</h3>

        <div className="radio-group">
          {["No Task", "Dressing", "Medication", "Doctor Review"].map(
            (item) => (
              <div key={item}>
                <RadioButton
                  value={item}
                  onChange={(e) => formik.setFieldValue("pending", e.value)}
                  checked={formik.values.pending === item}
                />
                <label>{item}</label>
              </div>
            ),
          )}
        </div>

        <textarea
          placeholder="Instructions"
          onChange={(e) => formik.setFieldValue("notes", e.target.value)}
        />
      </div>

      {/* Verification */}
      <div className="panel">
        <h3>Verification</h3>
        <div className="grid">
          <InputText placeholder="Outgoing Signature" />
          <InputText placeholder="Incoming Signature" />
          <Dropdown
            options={["Not Required", "Yes"]}
            onChange={(e) => formik.setFieldValue("doctorInformed", e.value)}
            placeholder="Select"
          />
          <InputText type="datetime-local" />
        </div>
      </div>

      <Button type="submit" label="Save" />
    </form>
  );
};

export default NursingHandoverNotes;
