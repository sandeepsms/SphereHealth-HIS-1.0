import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { Toolbar } from "primereact/toolbar";
import { Checkbox } from "primereact/checkbox";
import { Tag } from "primereact/tag";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { departmentService } from "../../services/departmentService";
import "../../styles/Department.css";

const DepartmentManagement = () => {
  const [departments, setDepartments] = useState([]);
  const [departmentDialog, setDepartmentDialog] = useState(false);
  const [department, setDepartment] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  const categoryOptions = [
    { label: "Clinical", value: "Clinical" },
    { label: "Surgical", value: "Surgical" },
    { label: "Diagnostic", value: "Diagnostic" },
    { label: "Support Services", value: "Support Services" },
    { label: "Emergency", value: "Emergency" },
    { label: "Critical Care", value: "Critical Care" },
  ];

  const emptyDepartment = {
    departmentName: "",
    departmentCode: "",
    description: "",
    category: "Clinical",
    opdAvailable: true,
    ipdAvailable: true,
    emergencyAvailable: false,
    isActive: true,
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  const loadDepartments = async () => {
    try {
      setLoading(true);
      const response = await departmentService.getAllDepartments();
      setDepartments(response.data);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load departments",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    setDepartment({ ...emptyDepartment });
    setSubmitted(false);
    setDepartmentDialog(true);
  };

  const hideDialog = () => {
    setSubmitted(false);
    setDepartmentDialog(false);
  };

  const saveDepartment = async () => {
    setSubmitted(true);

    if (department.departmentName.trim() && department.departmentCode.trim()) {
      try {
        if (department._id) {
          await departmentService.updateDepartment(department._id, department);
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Department updated successfully",
            life: 3000,
          });
        } else {
          await departmentService.createDepartment(department);
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Department created successfully",
            life: 3000,
          });
        }
        setDepartmentDialog(false);
        setDepartment({ ...emptyDepartment });
        loadDepartments();
      } catch (error) {
        toast.current.show({
          severity: "error",
          summary: "Error",
          detail: error.response?.data?.message || "Operation failed",
          life: 3000,
        });
      }
    }
  };

  const editDepartment = (dept) => {
    setDepartment({ ...dept });
    setDepartmentDialog(true);
  };

  const confirmDeleteDepartment = (dept) => {
    confirmDialog({
      message: `Are you sure you want to deactivate ${dept.departmentName}?`,
      header: "Confirm",
      icon: "pi pi-exclamation-triangle",
      accept: () => deleteDepartment(dept._id),
    });
  };

  const deleteDepartment = async (id) => {
    try {
      await departmentService.deleteDepartment(id);
      toast.current.show({
        severity: "success",
        summary: "Success",
        detail: "Department deactivated",
        life: 3000,
      });
      loadDepartments();
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to deactivate department",
        life: 3000,
      });
    }
  };

  const onInputChange = (e, name) => {
    const val = (e.target && e.target.value) || "";
    let _department = { ...department };
    _department[name] = val;
    setDepartment(_department);
  };

  const onDropdownChange = (e, name) => {
    let _department = { ...department };
    _department[name] = e.value;
    setDepartment(_department);
  };

  const onCheckboxChange = (e, name) => {
    let _department = { ...department };
    _department[name] = e.checked;
    setDepartment(_department);
  };

  const leftToolbarTemplate = () => {
    return (
      <Button
        label="Add Department"
        icon="pi pi-plus"
        className="cyan-button"
        onClick={openNew}
      />
    );
  };

  const rightToolbarTemplate = () => {
    return (
      <span className="p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          type="search"
          placeholder="Search..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          style={{ width: "250px" }}
        />
      </span>
    );
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-text"
          style={{ color: "#00bcd4" }}
          onClick={() => editDepartment(rowData)}
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-text p-button-danger"
          onClick={() => confirmDeleteDepartment(rowData)}
        />
      </div>
    );
  };

  const statusBodyTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
      />
    );
  };

  const availabilityBodyTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {rowData.opdAvailable && <Tag value="OPD" severity="info" />}
        {rowData.ipdAvailable && <Tag value="IPD" severity="warning" />}
        {rowData.emergencyAvailable && (
          <Tag value="Emergency" severity="danger" />
        )}
      </div>
    );
  };

  const departmentDialogFooter = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
      <Button
        label="Cancel"
        icon="pi pi-times"
        className="p-button-text"
        onClick={hideDialog}
      />
      <Button
        label="Save"
        icon="pi pi-check"
        className="cyan-button"
        onClick={saveDepartment}
      />
    </div>
  );

  return (
    <div className="department-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      <div className="page-header">
        <h1>Department Management</h1>
        <p>Manage hospital departments and their configurations</p>
      </div>

      <div className="page-content">
        <div className="content-card">
          <Toolbar
            className="custom-toolbar"
            left={leftToolbarTemplate}
            right={rightToolbarTemplate}
          />

          <div className="table-container">
            <DataTable
              value={departments}
              paginator
              rows={10}
              rowsPerPageOptions={[10, 20, 50]}
              dataKey="_id"
              loading={loading}
              globalFilter={globalFilter}
              emptyMessage="No departments found"
              scrollable
              scrollHeight="calc(100vh - 340px)"
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
            >
              <Column
                field="departmentCode"
                header="Code"
                sortable
                style={{ minWidth: "100px", fontWeight: "600" }}
              />
              <Column
                field="departmentName"
                header="Department Name"
                sortable
                style={{ minWidth: "220px" }}
              />
              <Column
                field="category"
                header="Category"
                sortable
                style={{ minWidth: "150px" }}
              />
              <Column
                header="Availability"
                body={availabilityBodyTemplate}
                style={{ minWidth: "180px" }}
              />
              <Column
                header="Status"
                body={statusBodyTemplate}
                style={{ minWidth: "100px" }}
              />
              <Column
                body={actionBodyTemplate}
                header="Actions"
                style={{ width: "120px", textAlign: "center" }}
              />
            </DataTable>
          </div>
        </div>
      </div>

      <Dialog
        visible={departmentDialog}
        style={{ width: "600px" }}
        header={department?._id ? "Edit Department" : "Add New Department"}
        modal
        className="department-dialog"
        footer={departmentDialogFooter}
        onHide={hideDialog}
      >
        <div className="dialog-content">
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="departmentName">
                Department Name <span className="required">*</span>
              </label>
              <InputText
                id="departmentName"
                value={department?.departmentName || ""}
                onChange={(e) => onInputChange(e, "departmentName")}
                className={
                  submitted && !department?.departmentName ? "p-invalid" : ""
                }
                placeholder="Enter department name"
              />
              {submitted && !department?.departmentName && (
                <small className="p-error">Department name is required</small>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="departmentCode">
                Department Code <span className="required">*</span>
              </label>
              <InputText
                id="departmentCode"
                value={department?.departmentCode || ""}
                onChange={(e) => onInputChange(e, "departmentCode")}
                className={
                  submitted && !department?.departmentCode ? "p-invalid" : ""
                }
                placeholder="e.g. CARD"
                style={{ textTransform: "uppercase" }}
              />
              {submitted && !department?.departmentCode && (
                <small className="p-error">Department code is required</small>
              )}
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="category">Category</label>
            <Dropdown
              id="category"
              value={department?.category}
              options={categoryOptions}
              onChange={(e) => onDropdownChange(e, "category")}
              placeholder="Select Category"
            />
          </div>

          <div className="form-field">
            <label htmlFor="description">Description</label>
            <InputTextarea
              id="description"
              value={department?.description || ""}
              onChange={(e) => onInputChange(e, "description")}
              rows={3}
              placeholder="Enter department description"
            />
          </div>

          <div className="checkbox-section">
            <h4>Department Services</h4>
            <div className="checkbox-grid">
              <div className="checkbox-item">
                <Checkbox
                  inputId="opdAvailable"
                  checked={department?.opdAvailable || false}
                  onChange={(e) => onCheckboxChange(e, "opdAvailable")}
                />
                <label htmlFor="opdAvailable">OPD Available</label>
              </div>

              <div className="checkbox-item">
                <Checkbox
                  inputId="ipdAvailable"
                  checked={department?.ipdAvailable || false}
                  onChange={(e) => onCheckboxChange(e, "ipdAvailable")}
                />
                <label htmlFor="ipdAvailable">IPD Available</label>
              </div>

              <div className="checkbox-item">
                <Checkbox
                  inputId="emergencyAvailable"
                  checked={department?.emergencyAvailable || false}
                  onChange={(e) => onCheckboxChange(e, "emergencyAvailable")}
                />
                <label htmlFor="emergencyAvailable">Emergency Available</label>
              </div>

              <div className="checkbox-item">
                <Checkbox
                  inputId="isActive"
                  checked={department?.isActive || false}
                  onChange={(e) => onCheckboxChange(e, "isActive")}
                />
                <label htmlFor="isActive">Active Status</label>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default DepartmentManagement;
