import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import opdService from "../../Services/patient/opdService";
import { unwrapResponse } from "../../utils/apiResponse";

const OPDDetails = () => {
  const { visitNumber } = useParams();
  const navigate = useNavigate();
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVisit();
  }, [visitNumber]);

  const loadVisit = async () => {
    try {
      // R7bj-F8: use envelope adapter — drops the `data.data || data`
      // fallback hack now that the controller honours apiEnvelope.
      const response = await opdService.getOPDVisitById(visitNumber);
      const { ok, data, error } = unwrapResponse(response);
      if (!ok) {
        console.error("Error loading visit:", error?.message);
        return;
      }
      setVisit(data);
    } catch (error) {
      console.error("Error loading visit:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !visit) {
    return <div className="text-center p-5">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-content-between align-items-center mb-3">
        <h2>OPD Visit Details</h2>
        <div className="flex gap-2">
          {/* Visit editing isn't supported in this UI (clinical records are
              edited via doctor notes). Removed the dangling Edit button. */}
          <Button
            label="Back"
            icon="pi pi-arrow-left"
            severity="secondary"
            onClick={() => navigate(-1)}
          />
        </div>
      </div>

      <div className="grid">
        <div className="col-12 md:col-6">
          <Card title="Visit Information">
            <div className="flex flex-column gap-3">
              <div>
                <strong>Visit Number:</strong> {visit.visitNumber}
              </div>
              <div>
                <strong>UHID:</strong> {visit.UHID}
              </div>
              <div>
                <strong>Visit Date:</strong>{" "}
                {new Date(visit.visitDate).toLocaleString()}
              </div>
              <div>
                <strong>Visit Type:</strong>{" "}
                <Tag value={visit.visitType} severity="info" />
              </div>
              <div>
                <strong>Consultant:</strong> {visit.consultantName}
              </div>
              <div>
                <strong>Department:</strong> {visit.department}
              </div>
              <div>
                <strong>Status:</strong>{" "}
                <Tag
                  value={visit.status}
                  severity={
                    visit.status === "Completed" ? "success" : "warning"
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
                <strong>Weight:</strong> {visit.vitals?.weight || "-"} kg
              </div>
              <div className="col-6">
                <strong>Height:</strong> {visit.vitals?.height || "-"} cm
              </div>
              <div className="col-6">
                <strong>BMI:</strong> {visit.vitals?.bmi || "-"}
              </div>
              <div className="col-6">
                <strong>Temperature:</strong> {visit.vitals?.temperature || "-"}{" "}
                °F
              </div>
              <div className="col-6">
                <strong>BP:</strong> {visit.vitals?.bloodPressure || "-"}
              </div>
              <div className="col-6">
                <strong>Pulse:</strong> {visit.vitals?.pulse || "-"} bpm
              </div>
              <div className="col-6">
                <strong>Resp Rate:</strong>{" "}
                {visit.vitals?.respiratoryRate || "-"}
              </div>
              <div className="col-6">
                <strong>SpO2:</strong> {visit.vitals?.oxygenSaturation || "-"} %
              </div>
            </div>
          </Card>
        </div>

        <div className="col-12">
          <Card title="Clinical Details">
            <div className="flex flex-column gap-4">
              <div>
                <strong className="block mb-2">Chief Complaint:</strong>
                <p className="m-0">{visit.chiefComplaint}</p>
              </div>

              {visit.complaintDuration && (
                <div>
                  <strong className="block mb-2">Duration:</strong>
                  <p className="m-0">{visit.complaintDuration}</p>
                </div>
              )}

              {visit.historyOfPresentIllness && (
                <div>
                  <strong className="block mb-2">
                    History of Present Illness:
                  </strong>
                  <p className="m-0">{visit.historyOfPresentIllness}</p>
                </div>
              )}

              {visit.pastMedicalHistory && (
                <div>
                  <strong className="block mb-2">Past Medical History:</strong>
                  <p className="m-0">{visit.pastMedicalHistory}</p>
                </div>
              )}

              {visit.provisionalDiagnosis && (
                <div>
                  <strong className="block mb-2">Provisional Diagnosis:</strong>
                  <p className="m-0 text-primary font-semibold">
                    {visit.provisionalDiagnosis}
                  </p>
                </div>
              )}

              {visit.finalDiagnosis && (
                <div>
                  <strong className="block mb-2">Final Diagnosis:</strong>
                  <p className="m-0 text-green-600 font-semibold">
                    {visit.finalDiagnosis}
                  </p>
                </div>
              )}

              {visit.advice && (
                <div>
                  <strong className="block mb-2">Advice:</strong>
                  <p className="m-0">{visit.advice}</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {visit.prescribedMedications?.length > 0 && (
          <div className="col-12">
            <Card title="Prescribed Medications">
              <div className="flex flex-column gap-2">
                {visit.prescribedMedications.map((med, index) => (
                  <div key={index} className="p-3 surface-100 border-round">
                    <div className="font-semibold">{med.medicineName}</div>
                    <div className="text-sm text-color-secondary mt-1">
                      {med.dosage} | {med.frequency} | {med.duration}
                    </div>
                    {med.instructions && (
                      <div className="text-sm mt-1">{med.instructions}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {visit.investigationsOrdered?.length > 0 && (
          <div className="col-12">
            <Card title="Investigations">
              <div className="flex flex-column gap-2">
                {visit.investigationsOrdered.map((inv, index) => (
                  <div
                    key={index}
                    className="flex justify-content-between align-items-center p-3 surface-100 border-round"
                  >
                    <span>{inv.testName}</span>
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

        {visit.followUpRequired && (
          <div className="col-12">
            <Card>
              <div className="flex align-items-center gap-3 text-orange-600">
                <i className="pi pi-calendar text-2xl"></i>
                <div>
                  <div className="font-semibold">Follow-up Required</div>
                  {visit.followUpDate && (
                    <div className="text-sm">
                      Date: {new Date(visit.followUpDate).toLocaleDateString()}
                    </div>
                  )}
                  {visit.followUpInstructions && (
                    <div className="text-sm mt-1">
                      {visit.followUpInstructions}
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

export default OPDDetails;
