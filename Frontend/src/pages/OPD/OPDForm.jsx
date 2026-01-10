// src/Pages/OPD/OPDForm.jsx
import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { InputTextarea } from "primereact/inputtextarea";
import { AutoComplete } from "primereact/autocomplete";

import opdService from "../../Services/patient/opdService";
import patientService from "../../Services/patient/patientService";
import { departmentService } from "../../Services/departmentService";

const OPDForm = () => {
  const navigate = useNavigate();
  const { visitNumber } = useParams();
  const [searchParams] = useSearchParams();
  const toast = useRef(null);

  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const [filteredPatients, setFilteredPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [departments, setDepartments] = useState([]);

  const [formData, setFormData] = useState({
    patientId: "",
    UHID: "",
    visitType: "First Visit",
    consultantName: "",
    department: null, // ObjectId
    chiefComplaint: "",
    complaintDuration: "",
    historyOfPresentIllness: "",
    pastMedicalHistory: "",
    allergyHistory: "",
    currentMedications: "",
    vitals: {
      weight: "",
      height: "",
      temperature: "",
      bloodPressure: "",
      pulse: "",
      respiratoryRate: "",
      oxygenSaturation: "",
    },
    provisionalDiagnosis: "",
    advice: "",
  });

  const visitTypeOptions = [
    { label: "First Visit", value: "First Visit" },
    { label: "Follow-up", value: "Follow-up" },
    { label: "Routine Checkup", value: "Routine Checkup" },
  ];

  useEffect(() => {
    loadPatients();
    loadDepartments();

    const patientId = searchParams.get("patientId");
    if (patientId) {
      loadPatientForOPD(patientId);
    }

    if (visitNumber) {
      loadOPDVisit();
    }
  }, []);

  // LOAD DEPARTMENTS
  const loadDepartments = async () => {
    try {
      const response = await departmentService.getActiveDepartments();
      const depts = response.data || response || [];
      setDepartments(Array.isArray(depts) ? depts : []);
    } catch (error) {
      console.error("Error loading departments:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load departments",
        life: 3000,
      });
    }
  };

  const loadPatients = async () => {
    try {
      const response = await patientService.getAllPatients();
      const data = response.data?.data || response.data || response || [];
      setPatients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading patients:", error);
    }
  };

  const loadPatientForOPD = async (patientId) => {
    try {
      const response = await patientService.getPatientById(patientId);
      const patient = response.data?.data || response.data || response;
      if (!patient) return;

      setSelectedPatient(patient);
      setFormData((prev) => ({
        ...prev,
        patientId: patient._id,
        UHID: patient.UHID,
      }));
    } catch (error) {
      console.error("Error loading patient:", error);
    }
  };

  const loadOPDVisit = async () => {
    try {
      const response = await opdService.getOPDVisitById(visitNumber);
      const visit = response.data?.data || response.data || response;

      if (!visit) {
        throw new Error("Visit not found");
      }

      // Department id normalize
      const departmentId =
        typeof visit.department === "object"
          ? visit.department._id
          : visit.department;

      setFormData({
        patientId: visit.patientId || "",
        UHID: visit.UHID || "",
        visitType: visit.visitType || "First Visit",
        consultantName: visit.consultantName || "",
        department: departmentId || null,
        chiefComplaint: visit.chiefComplaint || "",
        complaintDuration: visit.complaintDuration || "",
        historyOfPresentIllness: visit.historyOfPresentIllness || "",
        pastMedicalHistory: visit.pastMedicalHistory || "",
        allergyHistory: visit.allergyHistory || "",
        currentMedications: visit.currentMedications || "",
        vitals: {
          weight: visit.vitals?.weight || "",
          height: visit.vitals?.height || "",
          temperature: visit.vitals?.temperature || "",
          bloodPressure: visit.vitals?.bloodPressure || "",
          pulse: visit.vitals?.pulse || "",
          respiratoryRate: visit.vitals?.respiratoryRate || "",
          oxygenSaturation: visit.vitals?.oxygenSaturation || "",
        },
        provisionalDiagnosis: visit.provisionalDiagnosis || "",
        advice: visit.advice || "",
      });

      if (visit.patientId) {
        loadPatientForOPD(visit.patientId);
      }
    } catch (error) {
      console.error("Error loading OPD visit:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load OPD visit",
      });
    }
  };

  const searchPatient = (event) => {
    const query = event.query.toLowerCase();
    const filtered = patients.filter(
      (p) =>
        p.fullName?.toLowerCase().includes(query) ||
        p.UHID?.toLowerCase().includes(query) ||
        p.contactNumber?.includes(query)
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

    if (!formData.patientId) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Please select a patient",
      });
      return;
    }

    if (!formData.department) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Please select a department",
      });
      return;
    }

    setLoading(true);

    try {
      if (visitNumber) {
        // UPDATE VISIT
        await opdService.updateOPDVisit(visitNumber, formData);

        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "OPD visit updated successfully",
        });
      } else {
        // CREATE VISIT
        await opdService.createOPDVisit(formData);

        // VISIT COUNT UPDATE (THIS WAS CAUSING ERROR EARLIER)
        if (formData.patientId && patientService.updateVisitCount) {
          await patientService.updateVisitCount(formData.patientId, "OPD");
        }

        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "OPD visit created successfully",
        });
      }

      setTimeout(() => navigate("/opd"), 1500);
    } catch (error) {
      console.error("Error saving OPD visit:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error?.response?.data?.message || "Operation failed",
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

  const departmentOptions = (departments || []).map((dept) => ({
    label: dept.departmentName,
    value: dept._id,
  }));

  return (
    <div className="p-4">
      <Toast ref={toast} />
      <Card title={visitNumber ? "Edit OPD Visit" : "New OPD Visit"}>
        <form onSubmit={handleSubmit}>
          <div className="grid">
            {/* Patient Information */}
            <div className="col-12">
              <h3 className="text-primary mb-3">Patient Information</h3>
            </div>

            {!visitNumber && (
              <div className="col-12 md:col-6">
                <label className="block mb-2 font-semibold">
                  Search Patient *
                </label>
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
                <Card className="bg-blue-50 shadow-none">
                  <div className="grid">
                    <div className="col-12 md:col-3">
                      <strong>UHID:</strong> {selectedPatient.UHID}
                    </div>
                    <div className="col-12 md:col-3">
                      <strong>Name:</strong> {selectedPatient.fullName}
                    </div>
                    <div className="col-12 md:col-3">
                      <strong>Age/Gender:</strong>{" "}
                      {selectedPatient.age || "N/A"} /{" "}
                      {selectedPatient.gender || "N/A"}
                    </div>
                    <div className="col-12 md:col-3">
                      <strong>Contact:</strong> {selectedPatient.contactNumber}
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Visit Details */}
            <div className="col-12 mt-4">
              <h3 className="text-primary mb-3">Visit Details</h3>
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">Visit Type *</label>
              <Dropdown
                value={formData.visitType}
                options={visitTypeOptions}
                onChange={(e) =>
                  setFormData({ ...formData, visitType: e.value })
                }
                className="w-full"
                placeholder="Select visit type"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">
                Consultant Name *
              </label>
              <InputText
                value={formData.consultantName}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    consultantName: e.target.value,
                  })
                }
                required
                className="w-full"
                placeholder="Enter consultant name"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">Department *</label>
              <Dropdown
                value={formData.department}
                options={departmentOptions}
                onChange={(e) =>
                  setFormData({ ...formData, department: e.value })
                }
                required
                className="w-full"
                placeholder="Select department"
                filter
                showClear
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                Chief Complaint *
              </label>
              <InputTextarea
                value={formData.chiefComplaint}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    chiefComplaint: e.target.value,
                  })
                }
                required
                rows={2}
                className="w-full"
                placeholder="Enter chief complaint"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2 font-semibold">
                Complaint Duration
              </label>
              <InputText
                value={formData.complaintDuration}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    complaintDuration: e.target.value,
                  })
                }
                placeholder="e.g. 3 days, 2 weeks"
                className="w-full"
              />
            </div>

            {/* Vitals */}
            <div className="col-12 mt-4">
              <h3 className="text-primary mb-3">Vitals</h3>
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2 font-semibold">Weight (kg)</label>
              <InputText
                type="number"
                step="0.1"
                value={formData.vitals.weight}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: { ...formData.vitals, weight: e.target.value },
                  })
                }
                className="w-full"
                placeholder="e.g. 70"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2 font-semibold">Height (cm)</label>
              <InputText
                type="number"
                step="0.1"
                value={formData.vitals.height}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: { ...formData.vitals, height: e.target.value },
                  })
                }
                className="w-full"
                placeholder="e.g. 170"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2 font-semibold">
                Temperature (°F)
              </label>
              <InputText
                type="number"
                step="0.1"
                value={formData.vitals.temperature}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: {
                      ...formData.vitals,
                      temperature: e.target.value,
                    },
                  })
                }
                className="w-full"
                placeholder="e.g. 98.6"
              />
            </div>

            <div className="col-12 md:col-3">
              <label className="block mb-2 font-semibold">Blood Pressure</label>
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

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">Pulse (bpm)</label>
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
                placeholder="e.g. 72"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">
                Respiratory Rate
              </label>
              <InputText
                type="number"
                value={formData.vitals.respiratoryRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    vitals: {
                      ...formData.vitals,
                      respiratoryRate: e.target.value,
                    },
                  })
                }
                className="w-full"
                placeholder="e.g. 16"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2 font-semibold">
                Oxygen Saturation (%)
              </label>
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
                placeholder="e.g. 98"
              />
            </div>

            {/* Clinical Notes */}
            <div className="col-12 mt-4">
              <h3 className="text-primary mb-3">Clinical Notes</h3>
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                History of Present Illness
              </label>
              <InputTextarea
                value={formData.historyOfPresentIllness}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    historyOfPresentIllness: e.target.value,
                  })
                }
                rows={3}
                className="w-full"
                placeholder="Enter history of present illness"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                Past Medical History
              </label>
              <InputTextarea
                value={formData.pastMedicalHistory}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pastMedicalHistory: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
                placeholder="Enter past medical history"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                Allergy History
              </label>
              <InputTextarea
                value={formData.allergyHistory}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    allergyHistory: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
                placeholder="Enter allergy history"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                Current Medications
              </label>
              <InputTextarea
                value={formData.currentMedications}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    currentMedications: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
                placeholder="Enter current medications"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">
                Provisional Diagnosis
              </label>
              <InputTextarea
                value={formData.provisionalDiagnosis}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    provisionalDiagnosis: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
                placeholder="Enter provisional diagnosis"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2 font-semibold">Advice</label>
              <InputTextarea
                value={formData.advice}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    advice: e.target.value,
                  })
                }
                rows={3}
                className="w-full"
                placeholder="Enter advice and treatment plan"
              />
            </div>

            {/* Buttons */}
            <div className="col-12 mt-4">
              <div className="flex gap-2">
                <Button
                  label="Cancel"
                  icon="pi pi-times"
                  severity="secondary"
                  onClick={() => navigate("/opd")}
                  type="button"
                />
                <Button
                  label={visitNumber ? "Update Visit" : "Create Visit"}
                  icon="pi pi-check"
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

export default OPDForm;
