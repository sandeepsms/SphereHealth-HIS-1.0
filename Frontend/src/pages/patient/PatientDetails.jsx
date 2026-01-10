import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { TabView, TabPanel } from "primereact/tabview";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import patientService from "../../Services/patient/patientService";
import opdService from "../../Services/patient/opdService";
import emergencyService from "../../Services/patient/emergencyService";
import { admissionService } from "../../Services/admissionService";

const PatientDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [opdHistory, setOpdHistory] = useState([]);
  const [emergencyHistory, setEmergencyHistory] = useState([]);
  const [admissionHistory, setAdmissionHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPatientData();
  }, [id]);

  const loadPatientData = async () => {
    try {
      const [patientRes, opdRes, emergencyRes, admissionRes] =
        await Promise.all([
          patientService.getPatientById(id),
          opdService.getPatientOPDHistory(id),
          emergencyService.getPatientEmergencyHistory(id),
          admissionService.getPatientAdmissionHistory(id),
        ]);

      setPatient(patientRes.data.data || patientRes.data);
      setOpdHistory(opdRes.data.data || []);
      setEmergencyHistory(emergencyRes.data.data || []);
      setAdmissionHistory(admissionRes.data.data || []);
    } catch (error) {
      console.error("Error loading patient data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !patient) {
    return <div className="text-center p-5">Loading...</div>;
  }

  return (
    <div style={{ marginTop: "60px" }}>
      <div className="flex justify-content-between align-items-center mb-3">
        <h2>Patient Details</h2>
        <div className="flex gap-2">
          <Button
            label="Edit"
            icon="pi pi-pencil"
            onClick={() => navigate(`/patients/edit/${id}`)}
          />
          <Button
            label="New OPD"
            icon="pi pi-plus"
            severity="success"
            onClick={() => navigate(`/opd/new?patientId=${id}`)}
          />
          <Button
            label="Back"
            icon="pi pi-arrow-left"
            severity="secondary"
            onClick={() => navigate("/patients")}
          />
        </div>
      </div>

      <div className="grid">
        <div className="col-12 md:col-4">
          <Card title="Basic Information">
            <div className="flex flex-column gap-3">
              <div>
                <strong>UHID:</strong> {patient.UHID}
              </div>
              <div>
                <strong>Patient ID:</strong> {patient.patientId}
              </div>
              <div>
                <strong>Name:</strong> {patient.fullName}
              </div>
              <div>
                <strong>Father's Name:</strong> {patient.fatherName || "-"}
              </div>
              <div>
                <strong>Age:</strong> {patient.age} years
              </div>
              <div>
                <strong>Gender:</strong> <Tag value={patient.gender} />
              </div>
              <div>
                <strong>Blood Group:</strong>{" "}
                {patient.bloodGroup ? (
                  <Tag value={patient.bloodGroup} severity="danger" />
                ) : (
                  "-"
                )}
              </div>
              <div>
                <strong>Marital Status:</strong> {patient.maritalStatus || "-"}
              </div>
            </div>
          </Card>
        </div>

        <div className="col-12 md:col-4">
          <Card title="Contact Information">
            <div className="flex flex-column gap-3">
              <div>
                <strong>Contact:</strong> {patient.contactNumber}
              </div>
              <div>
                <strong>Alternate:</strong> {patient.alternateContact || "-"}
              </div>
              <div>
                <strong>Email:</strong> {patient.email || "-"}
              </div>
              <div>
                <strong>Address:</strong>
                <div className="mt-2">
                  {patient.address?.completeAddress || "-"}
                </div>
              </div>
              <div>
                <strong>Emergency Contact:</strong>
                <div className="mt-2">
                  {patient.emergencyContact?.name || "-"}
                  {patient.emergencyContact?.phone &&
                    ` (${patient.emergencyContact.phone})`}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="col-12 md:col-4">
          <Card title="Medical Information">
            <div className="flex flex-column gap-3">
              <div>
                <strong>Allergies:</strong>
                <div className="mt-2">
                  {patient.knownAllergies?.length > 0
                    ? patient.knownAllergies.join(", ")
                    : "None"}
                </div>
              </div>
              <div>
                <strong>Chronic Conditions:</strong>
                <div className="mt-2">
                  {patient.chronicConditions?.length > 0
                    ? patient.chronicConditions.join(", ")
                    : "None"}
                </div>
              </div>
              <div>
                <strong>Current Medications:</strong>
                <div className="mt-2">
                  {patient.currentMedications?.length > 0
                    ? patient.currentMedications.join(", ")
                    : "None"}
                </div>
              </div>
              <div>
                <strong>Total OPD Visits:</strong> {patient.totalOPDVisits || 0}
              </div>
              <div>
                <strong>Total Emergency Visits:</strong>{" "}
                {patient.totalEmergencyVisits || 0}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-3">
        <TabView>
          <TabPanel header={`OPD History (${opdHistory.length})`}>
            <DataTable
              value={opdHistory}
              paginator
              rows={5}
              emptyMessage="No OPD visits recorded"
            >
              <Column field="visitNumber" header="Visit #" />
              <Column
                field="visitDate"
                header="Date"
                body={(row) => new Date(row.visitDate).toLocaleDateString()}
              />
              <Column field="consultantName" header="Doctor" />
              <Column field="department" header="Department" />
              <Column field="chiefComplaint" header="Complaint" />
              <Column
                field="status"
                header="Status"
                body={(row) => <Tag value={row.status} />}
              />
            </DataTable>
          </TabPanel>

          <TabPanel header={`Emergency History (${emergencyHistory.length})`}>
            <DataTable
              value={emergencyHistory}
              paginator
              rows={5}
              emptyMessage="No emergency visits recorded"
            >
              <Column field="emergencyNumber" header="ER #" />
              <Column
                field="arrivalDate"
                header="Arrival"
                body={(row) => new Date(row.arrivalDate).toLocaleString()}
              />
              <Column
                field="triageCategory"
                header="Triage"
                body={(row) => (
                  <Tag value={row.triageCategory} severity="danger" />
                )}
              />
              <Column field="presentingComplaints" header="Complaint" />
              <Column
                field="status"
                header="Status"
                body={(row) => <Tag value={row.status} />}
              />
            </DataTable>
          </TabPanel>

          <TabPanel header={`Admission History (${admissionHistory.length})`}>
            <DataTable
              value={admissionHistory}
              paginator
              rows={5}
              emptyMessage="No admissions recorded"
            >
              <Column field="UHID" header="UHID" />
              <Column field="bedNumber" header="Bed" />
              <Column
                field="admissionDate"
                header="Admitted"
                body={(row) => new Date(row.admissionDate).toLocaleDateString()}
              />
              <Column
                field="actualDischargeDate"
                header="Discharged"
                body={(row) =>
                  row.actualDischargeDate
                    ? new Date(row.actualDischargeDate).toLocaleDateString()
                    : "-"
                }
              />
              <Column field="reasonForAdmission" header="Reason" />
              <Column
                field="status"
                header="Status"
                body={(row) => (
                  <Tag
                    value={row.status}
                    severity={row.status === "Active" ? "success" : "info"}
                  />
                )}
              />
            </DataTable>
          </TabPanel>
        </TabView>
      </Card>
    </div>
  );
};

export default PatientDetails;
