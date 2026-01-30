import React, { useState, useEffect } from "react";
import { Formik, Form, FieldArray } from "formik";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Toast } from "primereact/toast";
import * as yup from "yup";
import { tpaServiceService } from "../../Services/tpa/tpaServiceService";
import { tpaService } from "../../Services/tpa/tpaService";
import "../../styles/TPAServiceManagement.css";

function TPAServiceManagement() {
  const [tpaServiceList, setTPAServiceList] = useState([]);
  const [tpaList, setTPAList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingService, setEditingService] = useState(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [viewingService, setViewingService] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = React.useRef(null);

  // Validation Schema
  const validationSchema = yup.object({
    tpaName: yup.string().required("TPA is required"),
    service: yup
      .array()
      .of(
        yup.object({
          Name: yup.string().required("Test name is required"),
          Amount: yup
            .number()
            .min(0, "Amount must be positive")
            .required("Amount is required"),
          Discount: yup
            .number()
            .min(0)
            .max(100, "Discount must be between 0-100"),
        }),
      )
      .min(1, "At least one test is required"),
  });

  // Fetch TPAs and Services
  const fetchData = async () => {
    setLoading(true);
    try {
      const [tpaRes, serviceRes] = await Promise.all([  
        tpaService.getAllTPAs(),
        tpaServiceService.getAllTPAServices(),
      ]);

      // Filter only active TPAs
      const activeTpas = (tpaRes.data || []).filter(
        (tpa) => tpa.isActive !== false,
      );
      setTPAList(activeTpas);

      setTPAServiceList(serviceRes.data || []);
      setFilteredList(serviceRes.data || []);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: error.message,
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Search Filter
  useEffect(() => {
    const filtered = tpaServiceList.filter(
      (service) =>
        service.tpaName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        service.tpaCode?.toLowerCase().includes(searchTerm.toLowerCase()),
    );
    setFilteredList(filtered);
  }, [searchTerm, tpaServiceList]);

  // Submit Handler
  const handleSubmit = async (values, { resetForm }) => {
    try {
      const payload = {
        tpaName: values.tpaName,
        service: values.service,
      };

      if (editingService) {
        await tpaServiceService.updateTPAService(editingService._id, payload);
        toast.current.show({
          severity: "success",
          summary: "Success",
          detail: "TPA Service updated successfully",
          life: 3000,
        });
        setEditingService(null);
      } else {
        await tpaServiceService.createTPAService(payload);
        toast.current.show({
          severity: "success",
          summary: "Success",
          detail: "TPA Service created successfully",
          life: 3000,
        });
      }
      resetForm();
      fetchData();
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: error?.response?.data?.message || error.message,
        life: 3000,
      });
    }
  };

  // Edit Handler
  const handleEdit = (service) => {
    setEditingService(service);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Delete Handler
  const handleDelete = (service) => {
    confirmDialog({
      message: `Are you sure you want to delete ${service.tpaName}?`,
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await tpaServiceService.deleteTPAService(service._id);
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "TPA Service deleted successfully",
            life: 3000,
          });
          fetchData();
        } catch (error) {
          toast.current.show({
            severity: "error",
            summary: "Error",
            detail: error.message,
            life: 3000,
          });
        }
      },
    });
  };

  // View Handler
  const handleView = (service) => {
    setViewingService(service);
    setViewDialog(true);
  };

  // Calculate Total
  const calculateTotal = (amount, discount) => {
    const discountAmount = (amount * (discount || 0)) / 100;
    return amount - discountAmount;
  };

  // DataTable Templates
  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          severity="info"
          onClick={() => handleView(rowData)}
          tooltip="View"
        />
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="success"
          onClick={() => handleEdit(rowData)}
          tooltip="Edit"
        />
        <Button
          icon="pi pi-trash"
          rounded
          outlined
          severity="danger"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
        />
      </div>
    );
  };

  const servicesBodyTemplate = (rowData) => {
    return (
      <span className="service-count-badge">
        {rowData.service?.length || 0} Tests
      </span>
    );
  };

  const codeBodyTemplate = (rowData) => {
    return <span className="tpa-code-badge">{rowData.tpaCode}</span>;
  };

  return (
    <div className="tpa-service-container">
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* Header */}
      <div className="page-header" style={{ marginTop: "10px" }}>
        <h1 className="page-title">TPA Service Management</h1>
      </div>

      {/* Add/Edit Form */}
      <div className="form-card" style={{ marginTop: "15px" }}>
        <h2 className="form-title">
          {editingService ? "Edit TPA Service" : "Add New TPA Service"}
        </h2>

        <Formik
          initialValues={{
            tpaName: editingService?.tpaName || "",
            service: editingService?.service || [
              { Name: "", Amount: "", Discount: 0, Totalamount: 0 },
            ],
          }}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
          enableReinitialize
        >
          {({ values, errors, touched, setFieldValue, resetForm }) => (
            <Form>
              {/* TPA Selection */}
              <div className="p-fluid">
                <div className="field">
                  <label htmlFor="tpaName">Select TPA *</label>
                  <Dropdown
                    id="tpaName"
                    value={values.tpaName}
                    options={tpaList.map((tpa) => ({
                      label: `${tpa.tpaName} (${tpa.tpaCode})`,
                      value: tpa.tpaName,
                    }))}
                    onChange={(e) => setFieldValue("tpaName", e.value)}
                    placeholder="Select TPA"
                    filter
                    className={
                      errors.tpaName && touched.tpaName ? "p-invalid" : ""
                    }
                    disabled={editingService !== null}
                  />
                  {errors.tpaName && touched.tpaName && (
                    <small className="p-error">{errors.tpaName}</small>
                  )}
                </div>
              </div>

              {/* Services Array */}
              <FieldArray name="service">
                {({ push, remove }) => (
                  <div
                    className="services-section"
                    style={{ marginTop: "20px" }}
                  >
                    <div className="services-header">
                      <h3>Tests</h3>
                      <Button
                        type="button"
                        icon="pi pi-plus"
                        label="Add Test"
                        severity="success"
                        onClick={() =>
                          push({
                            Name: "",
                            Amount: 0,
                            Discount: 0,
                            Totalamount: 0,
                          })
                        }
                      />
                    </div>

                    <div className="services-table">
                      <DataTable
                        value={values.service}
                        responsiveLayout="scroll"
                      >
                        <Column
                          header="Test Name"
                          body={(rowData, options) => (
                            <InputText
                              value={values.service[options.rowIndex].Name}
                              onChange={(e) =>
                                setFieldValue(
                                  `service[${options.rowIndex}].Name`,
                                  e.target.value,
                                )
                              }
                              placeholder="Enter test name"
                              className={
                                errors.service?.[options.rowIndex]?.Name &&
                                touched.service?.[options.rowIndex]?.Name
                                  ? "p-invalid w-full"
                                  : "w-full"
                              }
                            />
                          )}
                        />
                        <Column
                          header="Amount"
                          body={(rowData, options) => (
                            <InputNumber
                              value={values.service[options.rowIndex].Amount}
                              onValueChange={(e) => {
                                setFieldValue(
                                  `service[${options.rowIndex}].Amount`,
                                  e.value,
                                );
                                const total = calculateTotal(
                                  e.value,
                                  values.service[options.rowIndex].Discount,
                                );
                                setFieldValue(
                                  `service[${options.rowIndex}].Totalamount`,
                                  total,
                                );
                              }}
                              mode="currency"
                              currency="INR"
                              locale="en-IN"
                              className={
                                errors.service?.[options.rowIndex]?.Amount &&
                                touched.service?.[options.rowIndex]?.Amount
                                  ? "p-invalid w-full"
                                  : "w-full"
                              }
                            />
                          )}
                        />
                        <Column
                          header="Discount (%)"
                          body={(rowData, options) => (
                            <InputNumber
                              value={values.service[options.rowIndex].Discount}
                              onValueChange={(e) => {
                                setFieldValue(
                                  `service[${options.rowIndex}].Discount`,
                                  e.value,
                                );
                                const total = calculateTotal(
                                  values.service[options.rowIndex].Amount,
                                  e.value,
                                );
                                setFieldValue(
                                  `service[${options.rowIndex}].Totalamount`,
                                  total,
                                );
                              }}
                              suffix="%"
                              min={0}
                              max={100}
                              className="w-full"
                            />
                          )}
                        />
                        <Column
                          header="Total Amount"
                          body={(rowData, options) => (
                            <InputNumber
                              value={
                                values.service[options.rowIndex].Totalamount
                              }
                              mode="currency"
                              currency="INR"
                              locale="en-IN"
                              readOnly
                              className="w-full bg-gray-100"
                            />
                          )}
                        />
                        <Column
                          header="Actions"
                          body={(rowData, options) => (
                            <Button
                              icon="pi pi-trash"
                              severity="danger"
                              rounded
                              outlined
                              onClick={() => remove(options.rowIndex)}
                              disabled={values.service.length === 1}
                            />
                          )}
                        />
                      </DataTable>
                    </div>
                  </div>
                )}
              </FieldArray>

              {/* Form Actions */}
              <div className="form-actions" style={{ marginTop: "20px" }}>
                <Button
                  type="submit"
                  label={editingService ? "Update" : "Create"}
                  icon="pi pi-check"
                  severity="info"
                  loading={loading}
                />
                {editingService && (
                  <Button
                    type="button"
                    label="Cancel"
                    icon="pi pi-times"
                    severity="secondary"
                    onClick={() => {
                      setEditingService(null);
                      resetForm();
                    }}
                  />
                )}
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {/* Search Bar */}
      <div className="search-section" style={{ marginTop: "20px" }}>
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            placeholder="Search by TPA Name or Code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </span>
        <span className="result-count">
          Showing {filteredList.length} of {tpaServiceList.length} TPA Services
        </span>
      </div>

      {/* Data Table */}
      <div className="table-card" style={{ marginTop: "20px" }}>
        <DataTable
          value={filteredList}
          paginator
          rows={10}
          loading={loading}
          emptyMessage="No TPA Services found"
          responsiveLayout="scroll"
        >
          <Column field="tpaName" header="TPA Name" sortable />
          <Column header="TPA Code" body={codeBodyTemplate} sortable />
          <Column header="Tests" body={servicesBodyTemplate} />
          <Column header="Actions" body={actionBodyTemplate} />
        </DataTable>
      </div>

      {/* View Dialog */}
      <Dialog
        header="TPA Service Details"
        visible={viewDialog}
        style={{ width: "50vw" }}
        onHide={() => setViewDialog(false)}
        breakpoints={{ "960px": "75vw", "641px": "90vw" }}
      >
        {viewingService && (
          <div className="view-dialog-content">
            <div className="detail-row">
              <strong>TPA Name:</strong>
              <span>{viewingService.tpaName}</span>
            </div>
            <div className="detail-row">
              <strong>TPA Code:</strong>
              <span className="tpa-code-badge">{viewingService.tpaCode}</span>
            </div>
            <div className="detail-row">
              <strong>Total Tests:</strong>
              <span>{viewingService.service?.length || 0}</span>
            </div>
            <div className="services-list">
              <h4>Tests:</h4>
              <DataTable value={viewingService.service}>
                <Column field="Name" header="Test Name" />
                <Column
                  field="Amount"
                  header="Amount"
                  body={(rowData) => `₹${rowData.Amount}`}
                />
                <Column
                  field="Discount"
                  header="Discount"
                  body={(rowData) => `${rowData.Discount}%`}
                />
                <Column
                  field="Totalamount"
                  header="Total"
                  body={(rowData) => `₹${rowData.Totalamount}`}
                />
              </DataTable>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default TPAServiceManagement;
