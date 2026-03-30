import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { getPatients } from "../../Services/userService";
import { getVitalSheet, updateVitalSheet } from "../../Services/vital/vitalService";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";

export default function UpdateVitalSheet() {
  const { uhid, date } = useParams();
  const [patient, setPatient] = useState(null);
  const [formData, setFormData] = useState(null);
  const toast = useRef(null);

  // Fetch patient details
  useEffect(() => {
    async function fetchPatient() {
      const all = await getPatients();
      const selected = all.find((p) => p.UHID === uhid);
      setPatient(selected);
    }
    fetchPatient();
  }, [uhid]);

  // Fetch specific vital sheet by UHID and date
  useEffect(() => {
    async function fetchVital() {
      const res = await getVitalSheet(uhid, date);
      if (res?.success && res.data) {
        const sheet = Array.isArray(res.data) ? res.data[0] : res.data;
        setFormData(sheet);
      }
    }
    fetchVital();
  }, [uhid, date]);

  if (!patient || !formData) return <h3>Loading...</h3>;

  return (
    <div className="p-4 bg-white h-100 py-5 mt-6">
      <Toast ref={toast} />
      <h2 className="text-center">Update Vital Sheet</h2>

      <div className="mb-3">
        <p><strong>Name:</strong> {patient.name}</p>
        <p><strong>UHID:</strong> {patient.UHID}</p>
        <p><strong>Date:</strong> {formData.date} (readonly)</p>
      </div>

      <Formik
        enableReinitialize
        initialValues={{ tableData: formData.tableData }}
        onSubmit={async (values, { setSubmitting }) => {
          setSubmitting(true);

          const payload = {
            uhid,
            date: formData.date,
            patientInfo: {
              name: patient.name,
              age: patient.age,
              gender: patient.gender,
            },
            activeVitals: formData.activeVitals,
            slot: formData.slot,
            tableData: values.tableData,
          };

          try {
            await updateVitalSheet(payload);
            toast.current.show({
              severity: "success",
              summary: "Updated",
              detail: "Vitals updated successfully",
            });
          } catch (err) {
            toast.current.show({
              severity: "error",
              summary: "Error",
              detail: "Update failed",
            });
          }

          setSubmitting(false);
        }}
      >
        {({ values, isSubmitting }) => (
          <Form>
            <table className="table table-bordered table-striped text-center align-middle">
              <thead className="table-primary">
                <tr>
                  <th>Time</th>
                  {formData.activeVitals.map((v, i) => <th key={i}>{v.name}</th>)}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {values.tableData.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td>
                      <input type="time" readOnly value={row.time} className="form-control bg-light" />
                    </td>
                    {formData.activeVitals.map((v, cIdx) => (
                      <td key={cIdx}>
                        <Field
                          name={`tableData[${rIdx}].values.${v.name}`}
                          type="number"
                          className="form-control"
                          inputMode="numeric"
                        />
                      </td>
                    ))}
                    <td>
                      <Field
                        name={`tableData[${rIdx}].notes`}
                        className="form-control"
                        placeholder="Notes..."
                      />
                      <ErrorMessage
                        name={`tableData[${rIdx}].notes`}
                        component="small"
                        className="text-danger"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 d-flex justify-content-center">
              <Button
                label={isSubmitting ? "Updating..." : "Update"}
                type="submit"
                disabled={isSubmitting}
              />
            </div>
          </Form>
        )}
      </Formik>
    </div>
  );
}
