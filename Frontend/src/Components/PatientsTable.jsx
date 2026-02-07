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
import { ProgressSpinner } from "primereact/progressspinner";
import { API_ENDPOINTS } from "../config/api";
import patientService from "../Services/patient/patientService";
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
  console.log("mmmmmmmmmmmmmmmmmmccccccccccccccccc",selectedPatient);
  

  const toast = useRef(null);
  const menuRefs = useRef({});
  const navigate = useNavigate();

  // Data fetching
  const getAllPatients = useCallback(async () => {
    try {
      setLoading(true);
      let patientsData = [];

      try {
        const response = await patientService.getAllPatients();
        patientsData = response.data || response;
      } catch (error) {
        const response = await fetch(
          `${API_ENDPOINTS.PATIENTS}/getAllPatients`,
        );
        patientsData = await response.json();
      }

      const formattedPatients = (
        Array.isArray(patientsData) ? patientsData : []
      )
        .map((patient, index) => ({
          id: patient._id || patient.UHID || `p-${index}`,
          UHID:
            patient.UHID || patient.patientId || patient._id || `UHID-${index}`,
          name: patient.fullName || patient.name || "N/A",
          phone: patient.contactNumber || patient.phone || "N/A",
          email: patient.email || "",
          gender: patient.gender || "N/A",
          birth: patient.dateOfBirth || patient.birth || null,
          department:
            patient.department?.departmentName || patient.department || "N/A",
          registrationType: patient.registrationType || "OPD",
          ...patient,
        }))
        .filter((patient) => patient.name !== "N/A");

      setPatients(formattedPatients);
      if (formattedPatients.length > 0) {
        toast.current?.show({
          severity: "success",
          summary: "Loaded",
          detail: `${formattedPatients.length} patients`,
          life: 2000,
        });
      }
    } catch (error) {
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

  const formatDate = (date) => {
    if (!date) return <span className="text-400">—</span>;
    try {
      const d = new Date(date);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return <span className="text-400">—</span>;
    }
  };

  useEffect(() => {
    getAllPatients();
    const interval = setInterval(getAllPatients, 60000);
    return () => clearInterval(interval);
  }, [getAllPatients]);

  const onGlobalFilterChange = (e) => {
    const value = e.target.value;
    const _filters = { ...filters };
    _filters.global.value = value;
    setFilters(_filters);
    setGlobalFilterValue(value);
  };

// Edit handler - Navigate with patient ID in URL
const handleEdit = (rowData) => {
  console.log("Editing patient with ID:", rowData.id);
  // Navigate to /registration/:id route
  navigate(`/registration/${rowData.id}`);
};

const handleView = async (rowData) => {
  try {
    console.log("Fetching complete patient data for:", rowData.id);
    // Fetch complete patient data from API
    const response = await fetch(`${API_ENDPOINTS.PATIENTS}/${rowData.id}`);
    const data = await response.json();

    if (data.success && data.data) {
      console.log("Complete patient data:", data.data);
      setSelectedPatient(data.data);
      setViewDialogVisible(true);
    } else {
      // Fallback to table data if API fails
      setSelectedPatient(rowData);
      setViewDialogVisible(true);
    }
  } catch (error) {
    console.error("Error fetching patient details:", error);
    toast.current?.show({
      severity: "error",
      summary: "Error",
      detail: "Failed to fetch patient details",
      life: 3000,
    });
    // Fallback to table data
    setSelectedPatient(rowData);
    setViewDialogVisible(true);
  }
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
    } catch (error) {
      toast.current?.show({ severity: "error", detail: "Delete failed" });
    } finally {
      setDeleteDialogVisible(false);
      setSelectedPatient(null);
    }
  };

  const genderBody = (row) => {
    const getGenderColor = (gender) => {
      return (
        {
          Male: "info",
          Female: "info",
          Other: "warning",
        }[gender] || "secondary"
      );
    };

    return (
      <Tag value={row.gender} rounded severity={getGenderColor(row.gender)} />
    );
  };

  // ✅ Action body with three dot menu
  const actionBody = (rowData) => {

    console.log("row data---------",rowData);
    
    const items = [
      {
        label: "Delete Patient",
        icon: "pi pi-trash",
        command: () => handleDeleteConfirm(rowData),
      },
      { separator: true },
      {
        label: "Doctor Details",
        icon: "pi pi-user-md",
        command: () => navigate(`/doctor/${rowData.UHID}`),
      },
      {
        label: "OPD Bill Print",
        icon: "pi pi-print text-primary",
        command: () => navigate(`/opd/${rowData.UHID}`),
      },
      {
        label: "Doctor Prescription",
        icon: "pi pi-file-edit",
        command: () => navigate(`/doctorpre/${rowData.UHID}`),
      },
      {
        label: "Doctor Prescription Print",
        icon: "pi pi-print text-primary",
        command: () => navigate(`/Preceptionbill/${rowData.UHID}`),
      },
      {
        label: "Bed Management",
        icon: "pi pi-bed",
        command: () => navigate(`/BedManagementSingleFile/${rowData.UHID}`),
      },
    ];

    return (
      <div className="flex justify-content-center align-items-center gap-2">
        {/* View Icon */}
        <Button
          icon="pi pi-eye"
          severity="info"
          text
          rounded
          size="small"
          tooltip="View Patient"
          tooltipOptions={{ position: "top" }}
          onClick={() => handleView(rowData)}
        />

        {/* Edit Icon */}
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

        {/* Three Dot Menu with Hover */}
        <div
          onMouseEnter={(e) => {
            if (!menuRefs.current[rowData.id]) {
              menuRefs.current[rowData.id] = React.createRef();
            }
            menuRefs.current[rowData.id]?.current?.toggle(e);
          }}
        >
          <Button
            icon="pi pi-ellipsis-v"
            severity="secondary"
            text
            rounded
            size="small"
            tooltip="More Actions"
            tooltipOptions={{ position: "top" }}
            aria-haspopup="true"
            aria-controls={`patient-menu-${rowData.id}`}
          />
          <Menu
            ref={(el) => {
              if (!menuRefs.current[rowData.id]) {
                menuRefs.current[rowData.id] = { current: null };
              }
              menuRefs.current[rowData.id].current = el;
            }}
            id={`patient-menu-${rowData.id}`}
            model={items}
            popup
          />
        </div>
      </div>
    );
  };

  const emailBody = (rowData) => {
    return rowData.email || <span className="text-400">—</span>;
  };

  const header = (
    <div
      className="flex flex-wrap lg:flex-row align-items-center justify-content-between gap-3 p-4  btn-custom mb-2"
      style={{
        color: "white",
        borderRadius: "12px 12px 0 0",
      }}
    >
      <div className="flex align-items-center gap-3  ">
        <i className="pi pi-users text-3xl"></i>
        <div>
          <h1 className="m-0 text-2xl font-bold mb-1">Patients Dashboard</h1>
          <div className="text-sm opacity-90">
            Total:{" "}
            <Badge value={patients.length} severity="info" className="ml-2" />
          </div>
        </div>
      </div>
      <div className="flex align-items-center gap-2 flex-wrap ">
        <span
          className="p-input-icon-left surface-0"
          style={{ width: "clamp(250px, 30vw, 400px)" }}
        >
          <i className="pi pi-search text-500"></i>
          <InputText
            value={globalFilterValue}
            onChange={onGlobalFilterChange}
            placeholder="Search patients..."
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
          className="border "
        />
      </div>
    </div>
  );

  if (loading && patients.length === 0) {
    return (
      <div className="min-h-screen flex justify-content-center align-items-center p-6 bg-gray-50">
        <div className="surface-card p-6 text-center shadow-2 border-round">
          <span
            className="loaders"
            style={{ width: "50px", height: "50px" }}
          ></span>
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
            style={{ minWidth: "220px" }}
          />
          <Column
            field="UHID"
            header="UHID"
            sortable
            filter
            style={{ minWidth: "150px" }}
          />
          <Column
            field="phone"
            header="Phone"
            sortable
            filter
            style={{ minWidth: "150px" }}
          />
          <Column
            field="birth"
            header="DOB"
            body={(row) => formatDate(row.birth)}
            sortable
            style={{ minWidth: "140px" }}
          />
          <Column
            field="gender"
            header="Gender"
            sortable
            filter
            body={genderBody}
            style={{ minWidth: "120px" }}
          />
          <Column
            field="email"
            header="Email"
            body={emailBody}
            sortable
            filter
            style={{ minWidth: "240px" }}
          />
          <Column
            header="Actions"
            body={actionBody}
            style={{ minWidth: "150px", maxWidth: "150px" }}
            headerStyle={{ textAlign: "center" }}
            bodyStyle={{ textAlign: "center" }}
          />
        </DataTable>
      </Card>

      {/* View Patient Dialog */}
      <Dialog
        visible={viewDialogVisible}
        style={{ width: "clamp(500px, 60vw, 800px)" }}
        header={
          <div className="flex align-items-center gap-3">
            <i className="pi pi-user text-2xl text-primary"></i>
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
              {/* Personal Information */}
              <div className="col-12">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-user mr-2"></i>Personal Information
                </h3>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Full Name
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-user mr-2 text-500"></i>
                  {selectedPatient.fullName || selectedPatient.name || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  UHID
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-id-card mr-2 text-500"></i>
                  {selectedPatient.UHID || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Phone Number
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-phone mr-2 text-500"></i>
                  {selectedPatient.contactNumber ||
                    selectedPatient.phone ||
                    "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Email
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-envelope mr-2 text-500"></i>
                  {selectedPatient.email || "Not provided"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Date of Birth
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-calendar mr-2 text-500"></i>
                  {formatDate(
                    selectedPatient.dateOfBirth || selectedPatient.birth,
                  )}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Gender
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-venus-mars mr-2 text-500"></i>
                  {selectedPatient.gender || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Blood Group
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-tint mr-2 text-500"></i>
                  {selectedPatient.bloodGroup || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Marital Status
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-users mr-2 text-500"></i>
                  {selectedPatient.maritalStatus || "N/A"}
                </div>
              </div>

              {/* Address Information */}
              <div className="col-12 mt-3">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-map-marker mr-2"></i>Address Information
                </h3>
              </div>

              <div className="col-12 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Complete Address
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-home mr-2 text-500"></i>
                  {selectedPatient.address?.completeAddress || "Not provided"}
                </div>
              </div>

              <div className="col-12 md:col-4 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  City
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.address?.city || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-4 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  State
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.address?.state || "N/A"}
                </div>
              </div>

              <div className="col-12 md:col-4 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Pincode
                </label>
                <div className="p-3 surface-100 border-round">
                  {selectedPatient.address?.pincode || "N/A"}
                </div>
              </div>

              {/* Medical Information */}
              <div className="col-12 mt-3">
                <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                  <i className="pi pi-heart mr-2"></i>Medical Information
                </h3>
              </div>

              <div className="col-12 md:col-6 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Department
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-building mr-2 text-500"></i>
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
                  <i className="pi pi-user-md mr-2 text-500"></i>
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
                  <i className="pi pi-bookmark mr-2 text-500"></i>
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
                  <i className="pi pi-shield mr-2 text-500"></i>
                  {selectedPatient.tpa?.tpaName || "Cash Patient"}
                </div>
              </div>

              <div className="col-12 mb-3">
                <label className="font-semibold text-700 block mb-2">
                  Known Allergies
                </label>
                <div className="p-3 surface-100 border-round">
                  <i className="pi pi-exclamation-circle mr-2 text-500"></i>
                  {selectedPatient.knownAllergies || "None"}
                </div>
              </div>

              {/* MLC Information */}
              {selectedPatient.isMLC && (
                <>
                  <div className="col-12 mt-3">
                    <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                      <i className="pi pi-exclamation-triangle mr-2"></i>MLC
                      Information
                    </h3>
                  </div>

                  <div className="col-12 md:col-6 mb-3">
                    <label className="font-semibold text-700 block mb-2">
                      MLC Case
                    </label>
                    <div className="p-3 surface-100 border-round">
                      <Tag value="YES" severity="danger" />
                    </div>
                  </div>

                  <div className="col-12 md:col-6 mb-3">
                    <label className="font-semibold text-700 block mb-2">
                      MLC Number
                    </label>
                    <div className="p-3 surface-100 border-round">
                      {selectedPatient.mlcNumber || "N/A"}
                    </div>
                  </div>
                </>
              )}

              {/* Companion Information */}
              {selectedPatient.companionName && (
                <>
                  <div className="col-12 mt-3">
                    <h3 className="text-primary mb-3 border-bottom-1 border-300 pb-2">
                      <i className="pi pi-users mr-2"></i>Companion Information
                    </h3>
                  </div>

                  <div className="col-12 md:col-4 mb-3">
                    <label className="font-semibold text-700 block mb-2">
                      Name
                    </label>
                    <div className="p-3 surface-100 border-round">
                      {selectedPatient.companionName}
                    </div>
                  </div>

                  <div className="col-12 md:col-4 mb-3">
                    <label className="font-semibold text-700 block mb-2">
                      Relationship
                    </label>
                    <div className="p-3 surface-100 border-round">
                      {selectedPatient.companionRelationship}
                    </div>
                  </div>

                  <div className="col-12 md:col-4 mb-3">
                    <label className="font-semibold text-700 block mb-2">
                      Contact
                    </label>
                    <div className="p-3 surface-100 border-round">
                      {selectedPatient.companionContact}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        visible={deleteDialogVisible}
        style={{ width: "clamp(400px, 40vw, 500px)" }}
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
          <i className="pi pi-exclamation-triangle text-5xl text-orange-500 mb-4 block"></i>
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
    </div>
  );
}

export default PatientsTable;
