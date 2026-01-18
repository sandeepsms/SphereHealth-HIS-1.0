import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { AutoComplete } from "primereact/autocomplete";
import emergencyService from "../../Services/patient/emergencyService";
import patientService from "../../Services/patient/patientService";

const EmergencyForm = () => {
  const navigate = useNavigate();
  const { emergencyNumber } = useParams();
  const toast = useRef(null);
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const [filteredPatients, setFilteredPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);

  const [formData, setFormData] = useState({
    patientId: "",
    UHID: "",
    arrivalMode: "",
    triageCategory: "",
    isMLC: false,
    mlcNumber: "",
    consultantIncharge: "",
    presentingComplaints: "",
    complaintDuration: "",
    vitals: {
      weight: "",
      temperature: "",
      bloodPressure: "",
      pulse: "",
      respiratoryRate: "",
      oxygenSaturation: "",
      painScore: "",
      glasgowComaScale: "",
    },
    provisionalDiagnosis: "",
    disposition: "Active",
  });

  const arrivalModeOptions = [
    "Ambulance",
    "Walk-in",
    "Police",
    "Referred",
    "Other",
  ].map((m) => ({ label: m, value: m }));

  const triageOptions = [
    { label: "Critical", value: "Critical", color: "danger" },
    { label: "Emergency", value: "Emergency", color: "danger" },
    { label: "Urgent", value: "Urgent", color: "warning" },
    { label: "Semi-urgent", value: "Semi-urgent", color: "info" },
    { label: "Non-urgent", value: "Non-urgent", color: "success" },
  ];

  const dispositionOptions = [
    "Active",
    "Admitted",
    "Discharged",
    "Referred",
    "Left Against Medical Advice",
    "Absconded",
    "Expired",
    "Observation",
  ].map((d) => ({ label: d, value: d }));

  useEffect(() => {
    loadPatients();
    if (emergencyNumber) {
      loadEmergency();
    }
  }, []);

  const loadPatients = async () => {
    try {
      const response = await patientService.getAllPatients();
      setPatients(response.data.data || response.data || []);
    } catch (error) {
      console.error("Error loading patients:", error);
    }
  };

  const loadEmergency = async () => {
    try {
      const response = await emergencyService.getEmergencyVisitById(
        emergencyNumber
      );
      const emergency = response.data.data || response.data;
      setFormData(emergency);
      if (emergency.patientId) {
        const patientRes = await patientService.getPatientById(
          emergency.patientId
        );
        setSelectedPatient(patientRes.data.data || patientRes.data);
      }
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load emergency case",
      });
    }
  };

  const searchPatient = (event) => {
    const query = event.query.toLowerCase();
    const filtered = patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(query) ||
        p.UHID.toLowerCase().includes(query) ||
        p.contactNumber.includes(query)
    );
    setFilteredPatients(filtered);
  };

  const onPatientSelect = (e) => {
    const patient = e.value;
    setSelectedPatient(patient);
    setFormData((prev) => ({
      ...prev,
      patientId: patient._id,
      UHID: patient.UHID,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (emergencyNumber) {
        await emergencyService.updateEmergencyVisit(emergencyNumber, formData);
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Emergency case updated successfully",
        });
      } else {
        await emergencyService.createEmergencyVisit(formData);
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Emergency case created successfully",
        });
      }
      setTimeout(() => navigate("/emergency"), 1500);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Operation failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const patientItemTemplate = (patient) => {
    return (
      <div>
        <div>
          <strong>{patient.fullName}</strong>
        </div>
        <div className="text-sm text-color-secondary">
          {patient.UHID} | {patient.contactNumber}
        </div>
      </div>
    );
  };

  return (
    <div>
      <Toast ref={toast} />
      <Card
        title={emergencyNumber ? "Edit Emergency Case" : "New Emergency Case"}
      >
        <form onSubmit={handleSubmit}>
          <div className="grid">
            {/* Patient Selection */}
            <div className="col-12">
              <h3 className="text-primary">Patient Information</h3>
            </div>

            {!emergencyNumber && (
              <div className="col-12 md:col-8">
                <label className="block mb-2">Search Patient *</label>
                <AutoComplete
                  value={selectedPatient}
                  suggestions={filteredPatients}
                  completeMethod={searchPatient}
                  field="fullName"
                  onChange={(e) => setSelectedPatient(e.value)}
                  onSelect={onPatientSelect}
                  itemTemplate={patientItemTemplate}
                  placeholder="Search by name, UHID or contact"
                  className="w-full"
                  dropdown
                />
              </div>
            )}

            {selectedPatient && (
              <div className="col-12">
                <Card className="bg-blue-50">
                  <div className="grid">
                    <div className="col-3">
                      <strong>UHID:</strong> {selectedPatient.UHID}
                    </div>
                    <div className="col-3">
                      <strong>Name:</strong> {selectedPatient.fullName}
                    </div>
                    <div className="col-3">
                      <strong>Age/Gender:</strong> {selectedPatient.age} /{" "}
                      {selectedPatient.gender}
                    </div>
                    <div className="col-3">
                      <strong>Blood Group:</strong>{" "}
                      {selectedPatient.bloodGroup || "Unknown"}
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Emergency Details */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Emergency Details</h3>
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Arrival Mode *</label>
              <Dropdown
                value={formData.arrivalMode}
                options={arrivalModeOptions}
                onChange={(e) =>
                  setFormData({ ...formData, arrivalMode: e.value })
                }
                required
                placeholder="Select"
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Triage Category *</label>
              <Dropdown
                value={formData.triageCategory}
                options={triageOptions}
                onChange={(e) =>
                  setFormData({ ...formData, triageCategory: e.value })
                }
                required
                placeholder="Select"
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Consultant Incharge *</label>
              <InputText
                value={formData.consultantIncharge}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    consultantIncharge: e.target.value,
                  })
                }
                required
                className="w-full"
              />
            </div>

            <div className="col-12">
              <div className="flex align-items-center gap-2">
                <Checkbox
                  inputId="mlc"
                  checked={formData.isMLC}
                  onChange={(e) =>
                    setFormData({ ...formData, isMLC: e.checked })
                  }
                />
                <label htmlFor="mlc" className="cursor-pointer">
                  This is a Medico-Legal Case (MLC)
                </label>
              </div>
            </div>

            {formData.isMLC && (
              <div className="col-12 md:col-6">
                <label className="block mb-2">MLC Number</label>
                <InputText
                  value={formData.mlcNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, mlcNumber: e.target.value })
                  }
                  className="w-full"
                />
              </div>
            )}

            <div className="col-12">
              <label className="block mb-2">Presenting Complaints *</label>
              <InputTextarea
                value={formData.presentingComplaints}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    presentingComplaints: e.target.value,
                  })
                }
                required
                rows={3}
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Complaint Duration</label>
              <InputText
                value={formData.complaintDuration}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    complaintDuration: e.target.value,
                  })
                }
                placeholder="e.g. 2 hours, 3 days"
                className="w-full"
              />
            </div>

            {/* Vitals */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Vitals</h3>
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2">Temperature (°F)</label>
              <InputText
                type="number"
                step="0.1"
                value={formData.vitals.temperature}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: { ...formData.vitals, temperature: e.target.value },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2">Blood Pressure</label>
              <InputText
                value={formData.vitals.bloodPressure}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: {
                      ...formData.vitals,
                      bloodPressure: e.target.value,
                    },
                  })
                }
                placeholder="120/80"
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2">Pulse (bpm)</label>
              <InputText
                type="number"
                value={formData.vitals.pulse}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: { ...formData.vitals, pulse: e.target.value },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2">SpO2 (%)</label>
              <InputText
                type="number"
                value={formData.vitals.oxygenSaturation}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: {
                      ...formData.vitals,
                      oxygenSaturation: e.target.value,
                    },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Pain Score (0-10)</label>
              <InputText
                type="number"
                min="0"
                max="10"
                value={formData.vitals.painScore}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: { ...formData.vitals, painScore: e.target.value },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Glasgow Coma Scale</label>
              <InputText
                type="number"
                min="3"
                max="15"
                value={formData.vitals.glasgowComaScale}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: {
                      ...formData.vitals,
                      glasgowComaScale: e.target.value,
                    },
                  })
                }
                className="w-full"
              />
            </div>

            {/* Diagnosis */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Diagnosis & Disposition</h3>
            </div>

            <div className="col-12">
              <label className="block mb-2">Provisional Diagnosis *</label>
              <InputTextarea
                value={formData.provisionalDiagnosis}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    provisionalDiagnosis: e.target.value,
                  })
                }
                required
                rows={2}
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Disposition *</label>
              <Dropdown
                value={formData.disposition}
                options={dispositionOptions}
                onChange={(e) =>
                  setFormData({ ...formData, disposition: e.value })
                }
                required
                className="w-full"
              />
            </div>

            {/* Buttons */}
            <div className="col-12 mt-4">
              <div className="flex gap-2">
                <Button
                  label="Cancel"
                  icon="pi pi-times"
                  severity="secondary"
                  onClick={() => navigate("/emergency")}
                  type="button"
                />
                <Button
                  label={emergencyNumber ? "Update" : "Create"}
                  icon="pi pi-check"
                  severity="danger"
                  loading={loading}
                  type="submit"
                  disabled={!selectedPatient}
                />
              </div>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default EmergencyForm;
