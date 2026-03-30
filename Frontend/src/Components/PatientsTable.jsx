// PatientsTable.jsx - With PatientSearchBar + PatientHistoryModal integrated
import React, { useEffect, useState, useRef, useCallback } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { FilterMatchMode } from "primereact/api";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { useNavigate } from "react-router-dom";
import { Menu } from "primereact/menu";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";
import { Badge } from "primereact/badge";
import { Tag } from "primereact/tag";
import { API_ENDPOINTS } from "../config/api";
import patientService from "../Services/patient/patientService";
import PatientSearchBar from "./Search/PatientSearchBar";
import PatientHistoryModal from "../Components/PatientHistoryModal"; // ✅ NEW

import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../css/Radiobutton.css";

function PatientsTable() {
  const [patients, setPatients] = useState([]);
  const [filters, setFilters] = useState({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  });
  const [loading, setLoading] = useState(true);
  const [globalFilterValue, setGlobalFilterValue] = useState("");
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [viewDialogVisible, setViewDialogVisible] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [historyPatientId, setHistoryPatientId] = useState(null); // ✅ NEW
  const [historyVisible, setHistoryVisible] = useState(false); // ✅ NEW

  const toast = useRef(null);
  const menuRefs = useRef({});
  const navigate = useNavigate();

  /* ── Fetch all patients ── */
  const getAllPatients = useCallback(async () => {
    try {
      setLoading(true);
      let patientsData = [];
      try {
        const response = await patientService.getAllPatients();
        patientsData = response.data || response.patients || response;
      } catch {
        const response = await fetch(
          `${API_ENDPOINTS.PATIENTS}/getAllPatients`,
        );
        patientsData = await response.json();
      }
      const formatted = (Array.isArray(patientsData) ? patientsData : [])
        .map((p, i) => ({
          id: p._id || p.UHID || `p-${i}`,
          UHID: p.UHID || p.patientId || p._id || `UHID-${i}`,
          name: p.fullName || p.name || "N/A",
          phone: p.contactNumber || p.phone || "N/A",
          email: p.email || "",
          gender: p.gender || "N/A",
          birth: p.dateOfBirth || p.birth || null,
          department: p.department?.departmentName || p.department || "N/A",
          registrationType: p.registrationType || "OPD",
          ...p,
        }))
        .filter((p) => p.name !== "N/A");
      setPatients(formatted);
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Failed",
        detail: "No patients found",
        life: 3000,
      });
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getAllPatients();
    const interval = setInterval(getAllPatients, 60000);
    return () => clearInterval(interval);
  }, [getAllPatients]);

  const formatDate = (date) => {
    if (!date) return <span className="text-400">—</span>;
    try {
      const d = new Date(date);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    } catch {
      return <span className="text-400">—</span>;
    }
  };

  const onGlobalFilterChange = (e) => {
    const value = e.target.value;
    const _f = { ...filters };
    _f.global.value = value;
    setFilters(_f);
    setGlobalFilterValue(value);
  };

  const handleEdit = (rowData) => navigate(`/registration/${rowData._id}`);

  const handleView = async (rowData) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.PATIENTS}/${rowData.id}`);
      const data = await response.json();
      setSelectedPatient(data.success && data.data ? data.data : rowData);
    } catch {
      setSelectedPatient(rowData);
    }
    setViewDialogVisible(true);
  };

  /* ✅ Open history modal */
  const handleViewHistory = (rowData) => {
    setHistoryPatientId(rowData._id || rowData.id);
    setHistoryVisible(true);
  };

  const handleSearchSelect = (patient) => {
    setSelectedPatient(patient);
    setViewDialogVisible(true);
  };

  const handleDeleteConfirm = (rowData) => {
    setSelectedPatient(rowData);
    setDeleteDialogVisible(true);
  };

  const handleDelete = async () => {
    try {
      await patientService.deletePatient(selectedPatient.id);
      toast.current?.show({
        severity: "success",
        detail: "Deleted successfully",
      });
      getAllPatients();
    } catch {
      toast.current?.show({ severity: "error", detail: "Delete failed" });
    } finally {
      setDeleteDialogVisible(false);
      setSelectedPatient(null);
    }
  };

  const genderBody = (row) => (
    <Tag
      value={row.gender}
      rounded
      severity={
        { Male: "info", Female: "info", Other: "warning" }[row.gender] ||
        "secondary"
      }
    />
  );

  const regTypeBody = (row) => {
    const colors = {
      OPD: "#0891b2",
      Emergency: "#dc2626",
      IPD: "#7c3aed",
      Daycare: "#d97706",
      Services: "#059669",
    };
    const bgs = {
      OPD: "#e0f2fe",
      Emergency: "#fee2e2",
      IPD: "#ede9fe",
      Daycare: "#fef3c7",
      Services: "#d1fae5",
    };
    const rt = row.registrationType || "OPD";
    return (
      <span
        style={{
          background: bgs[rt] || "#e0f2fe",
          color: colors[rt] || "#0891b2",
          borderRadius: 20,
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {rt}
      </span>
    );
  };

  const actionBody = (rowData) => {
    if (!menuRefs.current[rowData.id])
      menuRefs.current[rowData.id] = React.createRef();

    const items = [
      {
        label: "Delete Patient",
        icon: "pi pi-trash",
        command: () => handleDeleteConfirm(rowData),
      },
      { separator: true },
      {
        label: "View History",
        icon: "pi pi-history",
        command: () => handleViewHistory(rowData),
      }, // ✅ NEW
      { separator: true },
      {
        label: "Doctor Details",
        icon: "pi pi-user",
        command: () => navigate(`/doctor/${rowData.UHID}`),
      },
      {
        label: "OPD Bill Print",
        icon: "pi pi-print",
        command: () => navigate(`/opd/${rowData.UHID}`),
      },
      {
        label: "Doctor Prescription",
        icon: "pi pi-file-edit",
        command: () => navigate(`/doctorpre/${rowData.UHID}`),
      },
      {
        label: "Doctor Prescription Print",
        icon: "pi pi-print",
        command: () => navigate(`/Preceptionbill/${rowData.UHID}`),
      },
      {
        label: "Bed Management",
        icon: "pi pi-th-large",
        command: () => navigate(`/BedManagementSingleFile/${rowData.UHID}`),
      },
    ];

    return (
      <div className="flex justify-content-center align-items-center gap-1">
        <Button
          icon="pi pi-eye"
          severity="info"
          text
          rounded
          size="small"
          tooltip="View Details"
          tooltipOptions={{ position: "top" }}
          onClick={() => handleView(rowData)}
        />
        <Button
          icon="pi pi-pencil"
          severity="success"
          text
          rounded
          size="small"
          tooltip="Edit Patient"
          tooltipOptions={{ position: "top" }}
          onClick={() => handleEdit(rowData)}
        />
        {/* ✅ History button directly in row */}
        <Button
          icon="pi pi-history"
          severity="secondary"
          text
          rounded
          size="small"
          tooltip="View History"
          tooltipOptions={{ position: "top" }}
          onClick={() => handleViewHistory(rowData)}
        />
        <div>
          <Button
            icon="pi pi-ellipsis-v"
            severity="secondary"
            text
            rounded
            size="small"
            tooltip="More"
            tooltipOptions={{ position: "top" }}
            onClick={(e) => menuRefs.current[rowData.id].current.toggle(e)}
          />
          <Menu
            ref={menuRefs.current[rowData.id]}
            model={items}
            popup
            appendTo={document.body}
          />
        </div>
      </div>
    );
  };

  const emailBody = (r) => r.email || <span className="text-400">—</span>;

  const header = (
    <div
      className="flex flex-wrap lg:flex-row align-items-center justify-content-between gap-3 p-4 btn-custom mb-2"
      style={{ color: "white", borderRadius: "12px 12px 0 0" }}
    >
      <div className="flex align-items-center gap-3">
        <i className="pi pi-users text-3xl" />
        <div>
          <h1 className="m-0 text-2xl font-bold mb-1">Patients Dashboard</h1>
          <div className="text-sm opacity-90">
            Total:{" "}
            <Badge value={patients.length} severity="info" className="ml-2" />
          </div>
        </div>
      </div>
      <div className="flex align-items-center gap-2 flex-wrap">
        <PatientSearchBar
          onPatientSelect={handleSearchSelect}
          placeholder="Quick search patient..."
        />
        <span
          className="p-input-icon-left surface-0"
          style={{ width: "clamp(200px,20vw,280px)" }}
        >
          <i className="pi pi-filter text-500" />
          <InputText
            value={globalFilterValue}
            onChange={onGlobalFilterChange}
            placeholder=" Global Filter table..."
            className="w-full border-none"
          />
        </span>
        <Button
          icon="pi pi-refresh"
          severity="secondary"
          text
          rounded
          tooltip="Refresh"
          onClick={getAllPatients}
          loading={loading}
          size="small"
          className="text-white"
        />
        <Button
          icon="pi pi-plus"
          label="Add Patient"
          severity="success"
          size="small"
          onClick={() => navigate("/registration")}
          className="border"
        />
      </div>
    </div>
  );

  if (loading && patients.length === 0) {
    return (
      <div className="min-h-screen flex justify-content-center align-items-center p-6 bg-gray-50">
        <div className="surface-card p-6 text-center shadow-2 border-round">
          <span className="loaders" style={{ width: "50px", height: "50px" }} />
          <h3 className="mt-3 font-bold text-xl">Loading Patients...</h3>
          <p className="text-500 mt-1">Fetching data from server</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-50 px-4 sm:px-6 lg:px-8"
      style={{ paddingTop: "1rem", paddingBottom: "2rem" }}
    >
      <Toast ref={toast} position="top-right" />

      <Card className="shadow-2 border-round-lg p-2 bg-white">
        {header}
        <DataTable
          value={patients}
          paginator
          rows={10}
          rowsPerPageOptions={[10, 25, 50]}
          paginatorTemplate="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink RowsPerPageDropdown"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} patients"
          filters={filters}
          globalFilterFields={["name", "UHID", "phone", "email", "gender"]}
          filterDisplay="menu"
          stripedRows
          removableSort
          sortMode="single"
          loading={loading}
          dataKey="id"
          emptyMessage={
            <div className="py-8 text-center">
              <i className="pi pi-users text-6xl text-300 mb-4 block" />
              <h3 className="text-3xl font-bold text-900 mb-3">
                No Patients Found
              </h3>
              <p className="text-xl text-600 mb-6">
                Start by registering your first patient
              </p>
              <Button
                label="Add First Patient"
                icon="pi pi-plus"
                severity="success"
                size="large"
                onClick={() => navigate("/registration")}
              />
            </div>
          }
          tableStyle={{ minWidth: "100%" }}
          className="p-datatable-sm"
        >
          <Column
            field="name"
            header="Patient Name"
            sortable
            filter
            style={{ minWidth: "200px" }}
          />
          <Column
            field="UHID"
            header="UHID"
            sortable
            filter
            style={{ minWidth: "130px" }}
          />
          <Column
            field="phone"
            header="Phone"
            sortable
            filter
            style={{ minWidth: "130px" }}
          />
          <Column
            field="birth"
            header="DOB"
            body={(r) => formatDate(r.birth)}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="gender"
            header="Gender"
            sortable
            filter
            body={genderBody}
            style={{ minWidth: "110px" }}
          />
          <Column
            field="registrationType"
            header="Type"
            body={regTypeBody}
            sortable
            filter
            style={{ minWidth: "100px" }}
          />
          <Column
            field="email"
            header="Email"
            body={emailBody}
            sortable
            filter
            style={{ minWidth: "200px" }}
          />
          <Column
            header="Actions"
            body={actionBody}
            style={{ minWidth: "160px", maxWidth: "160px" }}
            headerStyle={{ textAlign: "center" }}
            bodyStyle={{ textAlign: "center" }}
          />
        </DataTable>
      </Card>

      {/* ── View Patient Dialog ── */}
      <Dialog
        visible={viewDialogVisible}
        style={{ width: "clamp(500px,60vw,800px)" }}
        header={
          <div className="flex align-items-center gap-3">
            <i className="pi pi-user text-2xl text-primary" />
            <span className="text-xl font-bold">Patient Details</span>
          </div>
        }
        modal
        onHide={() => {
          setViewDialogVisible(false);
          setSelectedPatient(null);
        }}
        footer={
          <div className="flex gap-3 justify-content-end">
            <Button
              label="View History"
              icon="pi pi-history"
              severity="info"
              outlined
              onClick={() => {
                setViewDialogVisible(false);
                setHistoryPatientId(
                  selectedPatient?._id || selectedPatient?.id,
                );
                setHistoryVisible(true);
              }}
            />
            <Button
              label="Close"
              icon="pi pi-times"
              severity="secondary"
              outlined
              onClick={() => setViewDialogVisible(false)}
            />
            <Button
              label="Edit Patient"
              icon="pi pi-pencil"
              severity="success"
              onClick={() => {
                setViewDialogVisible(false);
                handleEdit(selectedPatient);
              }}
            />
          </div>
        }
      >
        {selectedPatient && (
          <div className="p-4">
            <div className="grid">
              <div className="col-12">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-user mr-2" />
                  Personal Information
                </h3>
              </div>
              {[
                {
                  label: "Full Name",
                  icon: "pi-user",
                  value:
                    selectedPatient.fullName || selectedPatient.name || "N/A",
                },
                {
                  label: "UHID",
                  icon: "pi-id-card",
                  value: selectedPatient.UHID || "N/A",
                },
                {
                  label: "Phone",
                  icon: "pi-phone",
                  value:
                    selectedPatient.contactNumber ||
                    selectedPatient.phone ||
                    "N/A",
                },
                {
                  label: "Email",
                  icon: "pi-envelope",
                  value: selectedPatient.email || "Not provided",
                },
                {
                  label: "Date of Birth",
                  icon: "pi-calendar",
                  value: formatDate(
                    selectedPatient.dateOfBirth || selectedPatient.birth,
                  ),
                },
                {
                  label: "Gender",
                  icon: "pi-venus-mars",
                  value: selectedPatient.gender || "N/A",
                },
                {
                  label: "Blood Group",
                  icon: "pi-tint",
                  value: selectedPatient.bloodGroup || "N/A",
                },
                {
                  label: "Marital Status",
                  icon: "pi-users",
                  value: selectedPatient.maritalStatus || "N/A",
                },
              ].map((f) => (
                <div key={f.label} className="col-12 md:col-6 mb-3">
                  <label className="font-semibold text-700 block mb-2">
                    {f.label}
                  </label>
                  <div className="p-3 surface-100 border-round">
                    <i className={`pi ${f.icon} mr-2 text-500`} />
                    {f.value}
                  </div>
                </div>
              ))}

              <div className="col-12 mt-3">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-heart mr-2" />
                  Medical Information
                </h3>
              </div>
              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Department
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.department?.departmentName ||
                    selectedPatient.department ||
                    "N/A"}
                </div>
              </div>
              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Doctor
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.doctor?.personalInfo
                    ? `Dr. ${selectedPatient.doctor.personalInfo.firstName} ${selectedPatient.doctor.personalInfo.lastName}`
                    : "N/A"}
                </div>
              </div>
              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Registration Type
                </label>
                <div className="p-3 surface-100 border-round">
                  <Tag
                    value={selectedPatient.registrationType || "OPD"}
                    severity={
                      selectedPatient.registrationType === "OPD"
                        ? "info"
                        : selectedPatient.registrationType === "Emergency"
                          ? "danger"
                          : "warning"
                    }
                  />
                </div>
              </div>
              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">TPA</label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.tpa?.tpaName || "Cash Patient"}
                </div>
              </div>

              {/* ✅ Visit counts in view dialog */}
              <div className="col-12 mt-3">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-chart-bar mr-2" />
                  Visit Summary
                </h3>
              </div>
              <div className="col-12">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  {[
                    [
                      "OPD",
                      selectedPatient.totalOPDVisits || 0,
                      "#0891b2",
                      "#e0f2fe",
                    ],
                    [
                      "Emergency",
                      selectedPatient.totalEmergencyVisits || 0,
                      "#dc2626",
                      "#fee2e2",
                    ],
                    [
                      "IPD",
                      selectedPatient.totalIPDVisits || 0,
                      "#7c3aed",
                      "#ede9fe",
                    ],
                  ].map(([l, v, c, bg]) => (
                    <div
                      key={l}
                      style={{
                        background: bg,
                        border: `1px solid ${c}30`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 900, color: c }}>
                        {v}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: c,
                          fontWeight: 700,
                          marginTop: 2,
                        }}
                      >
                        {l} Visits
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,1fr)",
                    gap: 10,
                  }}
                >
                  {[
                    [
                      "Daycare",
                      selectedPatient.totalDaycareVisits || 0,
                      "#d97706",
                      "#fef3c7",
                    ],
                    [
                      "Services",
                      selectedPatient.totalServicesVisits || 0,
                      "#059669",
                      "#d1fae5",
                    ],
                  ].map(([l, v, c, bg]) => (
                    <div
                      key={l}
                      style={{
                        background: bg,
                        border: `1px solid ${c}30`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 900, color: c }}>
                        {v}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: c,
                          fontWeight: 700,
                          marginTop: 2,
                        }}
                      >
                        {l} Visits
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-12 mb-3 mt-3">
                <label className="font-semibold text-700 block mb-2">
                  Known Allergies
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.knownAllergies || "None"}
                </div>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Delete Dialog ── */}
      <Dialog
        visible={deleteDialogVisible}
        style={{ width: "clamp(400px,40vw,500px)" }}
        header="Confirm Delete"
        modal
        onHide={() => {
          setDeleteDialogVisible(false);
          setSelectedPatient(null);
        }}
        footer={
          <div className="flex gap-3 justify-content-end">
            <Button
              label="Cancel"
              icon="pi pi-times"
              severity="secondary"
              outlined
              onClick={() => setDeleteDialogVisible(false)}
            />
            <Button
              label="Delete Patient"
              icon="pi pi-trash"
              severity="danger"
              onClick={handleDelete}
            />
          </div>
        }
      >
        <div className="p-4 text-center">
          <i className="pi pi-exclamation-triangle text-5xl text-orange-500 mb-4 block" />
          <h3 className="font-bold text-xl mb-3">
            Delete <span className="text-red-500">{selectedPatient?.name}</span>
            ?
          </h3>
          <p className="text-600 mb-4">
            UHID: <code>{selectedPatient?.UHID}</code>
          </p>
          <p className="text-500">This action cannot be undone.</p>
        </div>
      </Dialog>

      {/* ✅ Patient History Modal */}
      <PatientHistoryModal
        patientId={historyPatientId}
        visible={historyVisible}
        onHide={() => {
          setHistoryVisible(false);
          setHistoryPatientId(null);
        }}
      />
    </div>
  );
}

export default PatientsTable;
