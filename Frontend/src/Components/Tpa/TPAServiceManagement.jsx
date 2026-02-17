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

const SERVICE_TYPES = [
  { label: "Fixed", value: "fixed" },
  { label: "Quantity", value: "quantity" },
  { label: "Hourly", value: "hourly" },
];

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

  const validationSchema = yup.object({
    tpaId: yup.string().required("TPA is required"),
    services: yup
      .array()
      .of(
        yup.object({
          Name: yup.string().required("Test name is required"),
          serviceType: yup.string().required("Service type is required"),
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tpaRes, serviceRes] = await Promise.all([
        tpaService.getAllTPAs(),
        tpaServiceService.getAllTPAServices(),
      ]);

      const activeTpas = (tpaRes.data || []).filter(
        (tpa) => tpa.isActive !== false,
      );
      setTPAList(activeTpas);

      const serviceData = serviceRes.data || [];
      setTPAServiceList(serviceData);
      setFilteredList(serviceData);
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

  useEffect(() => {
    const filtered = tpaServiceList.filter(
      (service) =>
        service.tpaId?.tpaName
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        service.tpaId?.tpaCode
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase()),
    );
    setFilteredList(filtered);
  }, [searchTerm, tpaServiceList]);

  const handleSubmit = async (values, { resetForm }) => {
    try {
      const payload = {
        tpaId: values.tpaId,
        services: values.services,
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
        const res = await tpaServiceService.createTPAService(payload);
        toast.current.show({
          severity: "success",
          summary: "Success",
          detail: res.message || "TPA Service created successfully",
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

  const handleEdit = (service) => {
    setEditingService(service);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (service) => {
    confirmDialog({
      message: `Are you sure you want to delete ${service.tpaId?.tpaName}?`,
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

  const handleView = (service) => {
    setViewingService(service);
    setViewDialog(true);
  };

  const calculateTotal = (amount, discount) => {
    const discountAmount = (amount * (discount || 0)) / 100;
    return amount - discountAmount;
  };

  const getServiceTypeBadge = (type) => {
    const styles = {
      fixed: { background: "#e8eaff", color: "#4f46e5" },
      quantity: { background: "#e6f7f2", color: "#10b981" },
      hourly: { background: "#fff8e6", color: "#f59e0b" },
    };
    const labels = { fixed: "Fixed", quantity: "Quantity", hourly: "Hourly" };
    return (
      <span
        style={{
          padding: "3px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 600,
          ...(styles[type] || { background: "#f0f0f0", color: "#666" }),
        }}
      >
        {labels[type] || type}
      </span>
    );
  };

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
        {rowData.services?.length || 0} Tests
      </span>
    );
  };

  const codeBodyTemplate = (rowData) => {
    return <span className="tpa-code-badge">{rowData.tpaId?.tpaCode}</span>;
  };

  return (
    <div className="tpa-service-container">
      <Toast ref={toast} />
      <ConfirmDialog />

      <div className="page-header" style={{ marginTop: "10px" }}>
        <h1 className="page-title">TPA Service Management</h1>
      </div>

      <div className="form-card" style={{ marginTop: "15px" }}>
        <h2 className="form-title">
          {editingService ? "Edit TPA Service" : "Add New TPA Service"}
        </h2>

        <Formik
          initialValues={{
            tpaId: editingService?.tpaId?._id || editingService?.tpaId || "",
            services: editingService?.services?.map((s) => ({
              Name: s.Name,
              serviceType: s.serviceType || "fixed",
              Amount: s.Amount,
              Discount: s.Discount,
              Totalamount: s.Totalamount,
            })) || [
              {
                Name: "",
                serviceType: "fixed",
                Amount: 0,
                Discount: 0,
                Totalamount: 0,
              },
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
                  <label htmlFor="tpaId">Select TPA *</label>
                  <Dropdown
                    id="tpaId"
                    value={values.tpaId}
                    options={tpaList.map((tpa) => ({
                      label: `${tpa.tpaName} (${tpa.tpaCode})`,
                      value: tpa._id,
                    }))}
                    onChange={(e) => setFieldValue("tpaId", e.value)}
                    placeholder="Select TPA"
                    filter
                    className={errors.tpaId && touched.tpaId ? "p-invalid" : ""}
                    disabled={editingService !== null}
                  />
                  {errors.tpaId && touched.tpaId && (
                    <small className="p-error">{errors.tpaId}</small>
                  )}
                </div>
              </div>

              {/* Services Array */}
              <FieldArray name="services">
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
                            serviceType: "fixed",
                            Amount: 0,
                            Discount: 0,
                            Totalamount: 0,
                          })
                        }
                      />
                    </div>

                    <div className="services-table">
                      <DataTable
                        value={values.services}
                        responsiveLayout="scroll"
                      >
                        {/* Test Name */}
                        <Column
                          header="Test Name"
                          body={(rowData, options) => (
                            <div>
                              <InputText
                                value={values.services[options.rowIndex].Name}
                                onChange={(e) =>
                                  setFieldValue(
                                    `services[${options.rowIndex}].Name`,
                                    e.target.value,
                                  )
                                }
                                placeholder="Enter test name"
                                className={
                                  errors.services?.[options.rowIndex]?.Name &&
                                  touched.services?.[options.rowIndex]?.Name
                                    ? "p-invalid w-full"
                                    : "w-full"
                                }
                              />
                              {errors.services?.[options.rowIndex]?.Name &&
                                touched.services?.[options.rowIndex]?.Name && (
                                  <small className="p-error">
                                    {errors.services[options.rowIndex].Name}
                                  </small>
                                )}
                            </div>
                          )}
                        />

                        {/* Service Type */}
                        <Column
                          header="Type"
                          body={(rowData, options) => (
                            <div>
                              <Dropdown
                                value={
                                  values.services[options.rowIndex].serviceType
                                }
                                options={SERVICE_TYPES}
                                onChange={(e) =>
                                  setFieldValue(
                                    `services[${options.rowIndex}].serviceType`,
                                    e.value,
                                  )
                                }
                                placeholder="Select type"
                                className={
                                  errors.services?.[options.rowIndex]
                                    ?.serviceType &&
                                  touched.services?.[options.rowIndex]
                                    ?.serviceType
                                    ? "p-invalid w-full"
                                    : "w-full"
                                }
                              />
                              {errors.services?.[options.rowIndex]
                                ?.serviceType &&
                                touched.services?.[options.rowIndex]
                                  ?.serviceType && (
                                  <small className="p-error">
                                    {
                                      errors.services[options.rowIndex]
                                        .serviceType
                                    }
                                  </small>
                                )}
                            </div>
                          )}
                        />

                        {/* Amount */}
                        <Column
                          header="Amount (₹)"
                          body={(rowData, options) => (
                            <InputNumber
                              value={values.services[options.rowIndex].Amount}
                              onValueChange={(e) => {
                                setFieldValue(
                                  `services[${options.rowIndex}].Amount`,
                                  e.value,
                                );
                                const total = calculateTotal(
                                  e.value,
                                  values.services[options.rowIndex].Discount,
                                );
                                setFieldValue(
                                  `services[${options.rowIndex}].Totalamount`,
                                  total,
                                );
                              }}
                              mode="currency"
                              currency="INR"
                              locale="en-IN"
                              className={
                                errors.services?.[options.rowIndex]?.Amount &&
                                touched.services?.[options.rowIndex]?.Amount
                                  ? "p-invalid w-full"
                                  : "w-full"
                              }
                            />
                          )}
                        />

                        {/* Discount */}
                        <Column
                          header="Discount (%)"
                          body={(rowData, options) => (
                            <InputNumber
                              value={values.services[options.rowIndex].Discount}
                              onValueChange={(e) => {
                                setFieldValue(
                                  `services[${options.rowIndex}].Discount`,
                                  e.value,
                                );
                                const total = calculateTotal(
                                  values.services[options.rowIndex].Amount,
                                  e.value,
                                );
                                setFieldValue(
                                  `services[${options.rowIndex}].Totalamount`,
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

                        {/* Total */}
                        <Column
                          header="Total Amount"
                          body={(rowData, options) => (
                            <InputNumber
                              value={
                                values.services[options.rowIndex].Totalamount
                              }
                              mode="currency"
                              currency="INR"
                              locale="en-IN"
                              readOnly
                              className="w-full bg-gray-100"
                            />
                          )}
                        />

                        {/* Remove */}
                        <Column
                          header="Actions"
                          body={(rowData, options) => (
                            <Button
                              icon="pi pi-trash"
                              severity="danger"
                              rounded
                              outlined
                              type="button"
                              onClick={() => remove(options.rowIndex)}
                              disabled={values.services.length === 1}
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

      {/* Search */}
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

      {/* Main Table */}
      <div className="table-card" style={{ marginTop: "20px" }}>
        <DataTable
          value={filteredList}
          paginator
          rows={10}
          loading={loading}
          emptyMessage="No TPA Services found"
          responsiveLayout="scroll"
        >
          <Column
            header="TPA Name"
            body={(rowData) => rowData.tpaId?.tpaName || "N/A"}
            sortable
          />
          <Column header="TPA Code" body={codeBodyTemplate} sortable />
          <Column header="Tests" body={servicesBodyTemplate} />
          <Column header="Actions" body={actionBodyTemplate} />
        </DataTable>
      </div>

      {/* View Dialog */}
      <Dialog
        header="TPA Service Details"
        visible={viewDialog}
        style={{ width: "60vw" }}
        onHide={() => setViewDialog(false)}
        breakpoints={{ "960px": "75vw", "641px": "90vw" }}
      >
        {viewingService && (
          <div className="view-dialog-content">
            <div className="detail-row">
              <strong>TPA Name:</strong>
              <span>{viewingService.tpaId?.tpaName}</span>
            </div>
            <div className="detail-row">
              <strong>TPA Code:</strong>
              <span className="tpa-code-badge">
                {viewingService.tpaId?.tpaCode}
              </span>
            </div>
            <div className="detail-row">
              <strong>Total Tests:</strong>
              <span>{viewingService.services?.length || 0}</span>
            </div>
            <div className="services-list">
              <h4>Tests:</h4>
              <DataTable value={viewingService.services}>
                <Column field="Name" header="Test Name" />
                <Column
                  header="Type"
                  body={(rowData) => getServiceTypeBadge(rowData.serviceType)}
                />
                <Column
                  field="Amount"
                  header="Amount"
                  body={(rowData) =>
                    `₹${rowData.Amount?.toLocaleString("en-IN")}`
                  }
                />
                <Column
                  field="Discount"
                  header="Discount"
                  body={(rowData) => `${rowData.Discount}%`}
                />
                <Column
                  field="Totalamount"
                  header="Total"
                  body={(rowData) =>
                    `₹${rowData.Totalamount?.toLocaleString("en-IN")}`
                  }
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
