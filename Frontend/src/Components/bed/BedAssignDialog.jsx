import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { admissionService } from "../../services/admissionService";
import { formatCurrency } from "../../utils/helpers";
import { ADMISSION_TYPES } from "../../utils/constants";

const BedAssignDialog = ({ visible, onHide, bed, patients, onSuccess }) => {
  const [formData, setFormData] = useState({
    patient: null,
    admissionDate: new Date(),
    expectedDischargeDate: null,
    admittingDoctorId: "",
    department: "",
    admissionType: "Emergency",
    chiefComplaint: "",
    provisionalDiagnosis: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      resetForm();
    }
  }, [visible]);

  const resetForm = () => {
    setFormData({
      patient: null,
      admissionDate: new Date(),
      expectedDischargeDate: null,
      admittingDoctorId: "",
      department: "",
      admissionType: "Emergency",
      chiefComplaint: "",
      provisionalDiagnosis: "",
      notes: "",
    });
  };

  const calculateEstimatedCharges = () => {
    if (!bed || !formData.expectedDischargeDate) return 0;

    const days = Math.ceil(
      (new Date(formData.expectedDischargeDate) -
        new Date(formData.admissionDate)) /
        (1000 * 60 * 60 * 24)
    );

    const dailyRate =
      (bed.pricing?.perBedDailyRate || 0) +
      (bed.pricing?.nursingCharges || 0) +
      (bed.pricing?.equipmentCharges || 0);

    return dailyRate * (days > 0 ? days : 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const admissionData = {
        patient: formData.patient,
        bed: bed._id,
        room: bed.room,
        ward: bed.ward,
        floor: bed.floor,
        building: bed.building,
        admissionDate: formData.admissionDate,
        expectedDischargeDate: formData.expectedDischargeDate,
        admittingDoctorId: formData.admittingDoctorId,
        department: formData.department,
        admissionType: formData.admissionType,
        chiefComplaint: formData.chiefComplaint,
        provisionalDiagnosis: formData.provisionalDiagnosis,
        notes: formData.notes,
        status: "Active",
      };

      await admissionService.createAdmission(admissionData);
      onSuccess?.();
      onHide();
      resetForm();
    } catch (error) {
      console.error("Error creating admission:", error);
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <div>
      <Button
        label="Cancel"
        icon="pi pi-times"
        onClick={() => {
          onHide();
          resetForm();
        }}
        className="p-button-text"
      />
      <Button
        label="Assign Bed"
        icon="pi pi-check"
        onClick={handleSubmit}
        loading={loading}
        disabled={
          !formData.patient ||
          !formData.admittingDoctorId ||
          !formData.department
        }
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      style={{ width: "700px" }}
      header={`Assign Bed: ${bed?.bedNumber}`}
      modal
      footer={footer}
      onHide={onHide}
    >
      <div className="p-fluid">
        {/* Bed Info Card */}
        <div
          style={{
            backgroundColor: "#f0f9ff",
            padding: "15px",
            borderRadius: "8px",
            marginBottom: "20px",
            border: "2px solid #3b82f6",
          }}
        >
          <h4 style={{ margin: "0 0 10px 0", color: "#1e40af" }}>
            <i className="pi pi-info-circle mr-2"></i>Bed Information
          </h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <div>
              <strong>Bed Number:</strong> {bed?.bedNumber}
            </div>
            <div>
              <strong>Room:</strong> {bed?.roomNumber}
            </div>
            <div>
              <strong>Building:</strong> {bed?.buildingName}
            </div>
            <div>
              <strong>Floor:</strong> {bed?.floorNumber}
            </div>
          </div>
        </div>

        {/* Patient Selection */}
        <div className="p-field mb-3">
          <label htmlFor="patient">
            <i className="pi pi-user mr-2"></i>Patient *
          </label>
          <Dropdown
            id="patient"
            value={formData.patient}
            options={
              patients?.map((p) => ({
                label: `${p.firstName} ${p.lastName} (${p.UHID})`,
                value: p._id,
              })) || []
            }
            onChange={(e) => setFormData({ ...formData, patient: e.value })}
            placeholder="Select Patient"
            filter
            filterPlaceholder="Search patient..."
          />
        </div>

        {/* Admission Details */}
        <div className="grid">
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="admissionDate">Admission Date *</label>
              <Calendar
                id="admissionDate"
                value={formData.admissionDate}
                onChange={(e) =>
                  setFormData({ ...formData, admissionDate: e.value })
                }
                showTime
                showIcon
              />
            </div>
          </div>
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="expectedDischargeDate">
                Expected Discharge Date
              </label>
              <Calendar
                id="expectedDischargeDate"
                value={formData.expectedDischargeDate}
                onChange={(e) =>
                  setFormData({ ...formData, expectedDischargeDate: e.value })
                }
                showTime
                showIcon
                minDate={formData.admissionDate}
              />
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="department">Department *</label>
              <InputText
                id="department"
                value={formData.department}
                onChange={(e) =>
                  setFormData({ ...formData, department: e.target.value })
                }
                placeholder="Enter department"
              />
            </div>
          </div>
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="admittingDoctorId">Admitting Doctor ID *</label>
              <InputText
                id="admittingDoctorId"
                value={formData.admittingDoctorId}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    admittingDoctorId: e.target.value,
                  })
                }
                placeholder="Enter doctor ID"
              />
            </div>
          </div>
        </div>

        <div className="p-field mb-3">
          <label htmlFor="admissionType">Admission Type *</label>
          <Dropdown
            id="admissionType"
            value={formData.admissionType}
            options={ADMISSION_TYPES}
            onChange={(e) =>
              setFormData({ ...formData, admissionType: e.value })
            }
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="chiefComplaint">Chief Complaint</label>
          <InputTextarea
            id="chiefComplaint"
            value={formData.chiefComplaint}
            onChange={(e) =>
              setFormData({ ...formData, chiefComplaint: e.target.value })
            }
            rows={2}
            placeholder="Enter chief complaint"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="provisionalDiagnosis">Provisional Diagnosis</label>
          <InputTextarea
            id="provisionalDiagnosis"
            value={formData.provisionalDiagnosis}
            onChange={(e) =>
              setFormData({ ...formData, provisionalDiagnosis: e.target.value })
            }
            rows={2}
            placeholder="Enter provisional diagnosis"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="notes">Notes</label>
          <InputTextarea
            id="notes"
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            rows={2}
            placeholder="Enter notes"
          />
        </div>

        {/* Pricing Summary */}
        <div
          style={{
            backgroundColor: "#ecfdf5",
            padding: "15px",
            borderRadius: "8px",
            border: "2px solid #10b981",
          }}
        >
          <h4 style={{ margin: "0 0 10px 0", color: "#047857" }}>
            <i className="pi pi-calculator mr-2"></i>Pricing Summary
          </h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            <div>
              <strong>Bed Rate:</strong>{" "}
              {formatCurrency(bed?.pricing?.perBedDailyRate || 0)}/day
            </div>
            <div>
              <strong>Nursing:</strong>{" "}
              {formatCurrency(bed?.pricing?.nursingCharges || 0)}/day
            </div>
            <div>
              <strong>Equipment:</strong>{" "}
              {formatCurrency(bed?.pricing?.equipmentCharges || 0)}/day
            </div>
            <div>
              <strong>Security Deposit:</strong>{" "}
              {formatCurrency(bed?.pricing?.securityDeposit || 0)}
            </div>
          </div>
          <hr style={{ margin: "10px 0", border: "1px solid #10b981" }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong style={{ fontSize: "16px" }}>
              Estimated Total Charges:
            </strong>
            <strong style={{ fontSize: "20px", color: "#047857" }}>
              {formatCurrency(calculateEstimatedCharges())}
            </strong>
          </div>
          {formData.expectedDischargeDate && (
            <small
              style={{ color: "#047857", marginTop: "5px", display: "block" }}
            >
              Based on{" "}
              {Math.ceil(
                (new Date(formData.expectedDischargeDate) -
                  new Date(formData.admissionDate)) /
                  (1000 * 60 * 60 * 24)
              )}{" "}
              days
            </small>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default BedAssignDialog;
