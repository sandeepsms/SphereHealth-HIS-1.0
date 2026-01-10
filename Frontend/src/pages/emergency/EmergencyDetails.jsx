import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Badge } from "primereact/badge";
import emergencyService from "../../services/patient/emergencyService";

const EmergencyDetails = () => {
  const { emergencyNumber } = useParams();
  const navigate = useNavigate();
  const [emergency, setEmergency] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEmergency();
  }, [emergencyNumber]);

  const loadEmergency = async () => {
    try {
      const response = await emergencyService.getEmergencyVisitById(
        emergencyNumber
      );
      setEmergency(response.data.data || response.data);
    } catch (error) {
      console.error("Error loading emergency:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !emergency) {
    return <div className="text-center p-5">Loading...</div>;
  }

  const triageSeverity = {
    Critical: "danger",
    Emergency: "danger",
    Urgent: "warning",
    "Semi-urgent": "info",
    "Non-urgent": "success",
  };

  return (
    <div>
      <div className="flex justify-content-between align-items-center mb-3">
        <h2>Emergency Case Details</h2>
        <div className="flex gap-2">
          <Button
            label="Edit"
            icon="pi pi-pencil"
            onClick={() => navigate(`/emergency/edit/${emergencyNumber}`)}
          />
          <Button
            label="Back"
            icon="pi pi-arrow-left"
            severity="secondary"
            onClick={() => navigate("/emergency")}
          />
        </div>
      </div>

      {emergency.isMLC && (
        <Card className="mb-3 bg-red-50">
          <div className="flex align-items-center gap-2 text-red-700">
            <i className="pi pi-exclamation-circle text-2xl"></i>
            <div>
              <div className="font-bold text-lg">Medico-Legal Case (MLC)</div>
              {emergency.mlcNumber && (
                <div>MLC Number: {emergency.mlcNumber}</div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid">
        <div className="col-12 md:col-6">
          <Card title="Case Information">
            <div className="flex flex-column gap-3">
              <div>
                <strong>Emergency Number:</strong> {emergency.emergencyNumber}
              </div>
              <div>
                <strong>UHID:</strong> {emergency.UHID}
              </div>
              <div>
                <strong>Arrival Date:</strong>{" "}
                {new Date(emergency.arrivalDate).toLocaleString()}
              </div>
              <div>
                <strong>Arrival Mode:</strong>{" "}
                <Tag value={emergency.arrivalMode} />
              </div>
              <div>
                <strong>Triage Category:</strong>{" "}
                <Tag
                  value={emergency.triageCategory}
                  severity={triageSeverity[emergency.triageCategory]}
                />
              </div>
              <div>
                <strong>Consultant Incharge:</strong>{" "}
                {emergency.consultantIncharge}
              </div>
              <div>
                <strong>Status:</strong>{" "}
                <Tag
                  value={emergency.status}
                  severity={
                    emergency.status === "Active" ? "danger" : "success"
                  }
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="col-12 md:col-6">
          <Card title="Vitals">
            <div className="grid">
              <div className="col-6">
                <strong>Temperature:</strong>{" "}
                {emergency.vitals?.temperature || "-"} °F
              </div>
              <div className="col-6">
                <strong>BP:</strong> {emergency.vitals?.bloodPressure || "-"}
              </div>
              <div className="col-6">
                <strong>Pulse:</strong> {emergency.vitals?.pulse || "-"} bpm
              </div>
              <div className="col-6">
                <strong>Resp Rate:</strong>{" "}
                {emergency.vitals?.respiratoryRate || "-"}
              </div>
              <div className="col-6">
                <strong>SpO2:</strong>{" "}
                {emergency.vitals?.oxygenSaturation || "-"} %
              </div>
              <div className="col-6">
                <strong>Pain Score:</strong>{" "}
                {emergency.vitals?.painScore || "-"} / 10
              </div>
              <div className="col-6">
                <strong>GCS:</strong>{" "}
                {emergency.vitals?.glasgowComaScale || "-"} / 15
              </div>
              <div className="col-6">
                <strong>Weight:</strong> {emergency.vitals?.weight || "-"} kg
              </div>
            </div>
          </Card>
        </div>

        <div className="col-12">
          <Card title="Clinical Details">
            <div className="flex flex-column gap-4">
              <div>
                <strong className="block mb-2">Presenting Complaints:</strong>
                <p className="m-0 text-red-600 font-semibold">
                  {emergency.presentingComplaints}
                </p>
              </div>

              {emergency.complaintDuration && (
                <div>
                  <strong className="block mb-2">Duration:</strong>
                  <p className="m-0">{emergency.complaintDuration}</p>
                </div>
              )}

              {emergency.historyOfPresentIllness && (
                <div>
                  <strong className="block mb-2">
                    History of Present Illness:
                  </strong>
                  <p className="m-0">{emergency.historyOfPresentIllness}</p>
                </div>
              )}

              {emergency.pastMedicalHistory && (
                <div>
                  <strong className="block mb-2">Past Medical History:</strong>
                  <p className="m-0">{emergency.pastMedicalHistory}</p>
                </div>
              )}

              {emergency.provisionalDiagnosis && (
                <div>
                  <strong className="block mb-2">Provisional Diagnosis:</strong>
                  <p className="m-0 text-primary font-semibold">
                    {emergency.provisionalDiagnosis}
                  </p>
                </div>
              )}

              {emergency.finalDiagnosis && (
                <div>
                  <strong className="block mb-2">Final Diagnosis:</strong>
                  <p className="m-0 text-green-600 font-semibold">
                    {emergency.finalDiagnosis}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {emergency.treatmentGiven?.medications?.length > 0 && (
          <div className="col-12">
            <Card title="Medications Given">
              <div className="flex flex-column gap-2">
                {emergency.treatmentGiven.medications.map((med, index) => (
                  <div key={index} className="p-3 surface-100 border-round">
                    <div className="font-semibold">{med.medicineName}</div>
                    <div className="text-sm text-color-secondary mt-1">
                      {med.dosage} | {med.route} | {med.frequency}
                    </div>
                    {med.givenAt && (
                      <div className="text-sm mt-1">
                        Given at: {new Date(med.givenAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {emergency.treatmentGiven?.procedures?.length > 0 && (
          <div className="col-12">
            <Card title="Procedures Performed">
              <div className="flex flex-column gap-2">
                {emergency.treatmentGiven.procedures.map((proc, index) => (
                  <div key={index} className="p-3 surface-100 border-round">
                    <div className="font-semibold">{proc.procedureName}</div>
                    <div className="text-sm mt-1">
                      Performed by: {proc.performedBy}
                    </div>
                    {proc.performedAt && (
                      <div className="text-sm">
                        At: {new Date(proc.performedAt).toLocaleString()}
                      </div>
                    )}
                    {proc.notes && (
                      <div className="text-sm mt-1">{proc.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {emergency.investigationsOrdered?.length > 0 && (
          <div className="col-12">
            <Card title="Investigations">
              <div className="flex flex-column gap-2">
                {emergency.investigationsOrdered.map((inv, index) => (
                  <div
                    key={index}
                    className="flex justify-content-between align-items-center p-3 surface-100 border-round"
                  >
                    <div>
                      <div className="font-semibold">{inv.testName}</div>
                      <div className="text-sm text-color-secondary">
                        Urgency: <Tag value={inv.urgency} />
                      </div>
                    </div>
                    <Tag
                      value={inv.status}
                      severity={
                        inv.status === "Completed" ? "success" : "warning"
                      }
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {emergency.nursingNotes?.length > 0 && (
          <div className="col-12">
            <Card title={`Nursing Notes (${emergency.nursingNotes.length})`}>
              <div className="flex flex-column gap-2">
                {emergency.nursingNotes.map((note, index) => (
                  <div key={index} className="p-3 surface-100 border-round">
                    <div className="flex justify-content-between align-items-start">
                      <div className="flex-1">
                        <p className="m-0">{note.note}</p>
                      </div>
                      <div className="text-sm text-color-secondary ml-3">
                        {new Date(note.time).toLocaleString()}
                      </div>
                    </div>
                    {note.recordedBy && (
                      <div className="text-sm text-color-secondary mt-1">
                        - {note.recordedBy}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {emergency.disposition && (
          <div className="col-12">
            <Card title="Disposition">
              <div className="flex align-items-center gap-3">
                <i className="pi pi-flag-fill text-2xl text-primary"></i>
                <div>
                  <div className="font-semibold text-lg">
                    {emergency.disposition}
                  </div>
                  {emergency.dischargeDate && (
                    <div className="text-sm text-color-secondary">
                      Date:{" "}
                      {new Date(emergency.dischargeDate).toLocaleDateString()}
                    </div>
                  )}
                  {emergency.dischargeInstructions && (
                    <div className="mt-2">
                      {emergency.dischargeInstructions}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmergencyDetails;
