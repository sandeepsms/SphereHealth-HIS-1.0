import React, { useState, useEffect, useMemo } from "react";
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

const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#1d4ed8", blueL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  teal: "#0d9488", tealL: "#f0fdfa",
  slate: "#475569",
};

const SERVICE_TYPES = [
  { label: "Fixed", value: "fixed" },
  { label: "Quantity", value: "quantity" },
  { label: "Hourly", value: "hourly" },
];

/* Small KPI tile used in the strip above the form. */
const Kpi = ({ icon, label, value, tone = "blue" }) => {
  const colors = {
    blue:  { bg: C.blueL,  fg: C.blue },
    green: { bg: C.greenL, fg: C.green },
    amber: { bg: C.amberL, fg: C.amber },
    teal:  { bg: C.tealL,  fg: C.teal  },
  }[tone] || { bg: C.blueL, fg: C.blue };
  return (
    <div style={{
      flex: "1 1 200px",
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: colors.bg, color: colors.fg,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <i className={`pi ${icon}`} style={{ fontSize: 18 }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2, textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 600 }}>{label}</div>
      </div>
    </div>
  );
};

/* Section pill used above the form ("Add New TPA Service" / "Edit TPA Service"). */
const SectionTag = ({ children, tone = "blue" }) => {
  const tones = {
    blue:  { bg: C.blueL,  fg: C.blue  },
    amber: { bg: C.amberL, fg: C.amber },
  }[tone] || { bg: C.blueL, fg: C.blue };
  return (
    <span style={{
      background: tones.bg,
      color: tones.fg,
      padding: "6px 12px",
      borderRadius: 8,
      fontSize: 11,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: ".5px",
      marginBottom: 12,
      display: "inline-block",
    }}>{children}</span>
  );
};

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
      fixed:    { background: C.blueL,  color: C.blue  },
      quantity: { background: C.greenL, color: C.green },
      hourly:   { background: C.amberL, color: C.amber },
    };
    const labels = { fixed: "Fixed", quantity: "Quantity", hourly: "Hourly" };
    return (
      <span
        style={{
          padding: "3px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 600,
          ...(styles[type] || { background: C.subtle, color: C.muted }),
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
      <span style={{
        background: C.blueL, color: C.blue,
        padding: "3px 10px", borderRadius: 12,
        fontSize: 12, fontWeight: 600,
      }}>
        {rowData.services?.length || 0} Tests
      </span>
    );
  };

  const codeBodyTemplate = (rowData) => {
    return (
      <span style={{
        background: C.subtle, color: C.slate,
        padding: "3px 10px", borderRadius: 8,
        fontSize: 12, fontWeight: 700,
        border: `1px solid ${C.border}`,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        {rowData.tpaId?.tpaCode}
      </span>
    );
  };

  /* KPI numbers — derived from existing state. */
  const kpis = useMemo(() => {
    const totalTpas = tpaList.length;
    const totalServiceConfigs = tpaServiceList.length;
    const totalTests = tpaServiceList.reduce(
      (acc, s) => acc + (s.services?.length || 0), 0,
    );
    return { totalTpas, totalServiceConfigs, totalTests };
  }, [tpaList, tpaServiceList]);

  /* DataTable styling overrides via pt-prop equivalents. */
  const dtPt = {
    table: { style: { fontSize: 13 } },
    thead: { style: {
      background: C.subtle,
    }},
    headerRow: { style: {
      background: C.subtle,
    }},
  };
  const headerCellStyle = {
    background: C.subtle,
    color: C.muted,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".4px",
    borderBottom: `1px solid ${C.border}`,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      padding: 20,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Toast ref={toast} />
        <ConfirmDialog />

        {/* Hero band — blue gradient, briefcase glyph. */}
        <div style={{
          background: "linear-gradient(135deg,#1d4ed8,#1e40af)",
          borderRadius: 14,
          padding: "16px 22px",
          marginBottom: 16,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(29,78,216,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)",
            border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-briefcase" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>TPA Services</div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              TPA-scoped service rates · per-test pricing · discount + total amount tracking
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}>
          <Kpi
            icon="pi-building"
            label="TPAs Configured"
            value={kpis.totalTpas}
            tone="blue"
          />
          <Kpi
            icon="pi-list"
            label="Service Records"
            value={kpis.totalServiceConfigs}
            tone="teal"
          />
          <Kpi
            icon="pi-check-circle"
            label="Total Tests"
            value={kpis.totalTests}
            tone="green"
          />
          <Kpi
            icon="pi-search"
            label="Search Results"
            value={`${filteredList.length} / ${tpaServiceList.length}`}
            tone="amber"
          />
        </div>

        {/* Form card */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}>
          <SectionTag tone={editingService ? "amber" : "blue"}>
            {editingService ? "Edit TPA Service" : "Add New TPA Service"}
          </SectionTag>

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
                    <label
                      htmlFor="tpaId"
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: C.slate,
                        marginBottom: 6,
                        display: "block",
                      }}
                    >
                      Select TPA *
                    </label>
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
                    <div style={{ marginTop: 20 }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}>
                        <h3 style={{
                          margin: 0,
                          fontSize: 14,
                          fontWeight: 800,
                          color: C.text,
                          letterSpacing: "-.1px",
                        }}>
                          Tests
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            push({
                              Name: "",
                              serviceType: "fixed",
                              Amount: 0,
                              Discount: 0,
                              Totalamount: 0,
                            })
                          }
                          style={{
                            background: C.green,
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            padding: "8px 14px",
                            fontWeight: 700,
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                            boxShadow: "0 1px 3px rgba(22,163,74,.25)",
                          }}
                        >
                          <i className="pi pi-plus" style={{ fontSize: 12 }} />
                          Add Test
                        </button>
                      </div>

                      <div style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        overflow: "hidden",
                      }}>
                        <DataTable
                          value={values.services}
                          responsiveLayout="scroll"
                          pt={dtPt}
                        >
                          {/* Test Name */}
                          <Column
                            header="Test Name"
                            headerStyle={headerCellStyle}
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
                            headerStyle={headerCellStyle}
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
                            headerStyle={headerCellStyle}
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
                            headerStyle={headerCellStyle}
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
                            headerStyle={headerCellStyle}
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
                            headerStyle={headerCellStyle}
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
                <div style={{
                  marginTop: 20,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}>
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

        {/* Search bar */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 12,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <span className="p-input-icon-left" style={{ flex: "1 1 280px", minWidth: 0 }}>
            <i className="pi pi-search" />
            <InputText
              placeholder="Search by TPA Name or Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full"
              style={{ width: "100%" }}
            />
          </span>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: C.muted,
            background: C.subtle,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "6px 12px",
            whiteSpace: "nowrap",
          }}>
            Showing {filteredList.length} of {tpaServiceList.length}
          </span>
        </div>

        {/* Main table card */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}>
          <SectionTag>Configured TPA Services</SectionTag>
          <div style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            overflow: "hidden",
          }}>
            <DataTable
              value={filteredList}
              paginator
              rows={10}
              loading={loading}
              emptyMessage="No TPA Services found"
              responsiveLayout="scroll"
              pt={dtPt}
            >
              <Column
                header="TPA Name"
                headerStyle={headerCellStyle}
                body={(rowData) => rowData.tpaId?.tpaName || "N/A"}
                sortable
              />
              <Column
                header="TPA Code"
                headerStyle={headerCellStyle}
                body={codeBodyTemplate}
                sortable
              />
              <Column
                header="Tests"
                headerStyle={headerCellStyle}
                body={servicesBodyTemplate}
              />
              <Column
                header="Actions"
                headerStyle={headerCellStyle}
                body={actionBodyTemplate}
              />
            </DataTable>
          </div>
        </div>

        {/* View Dialog */}
        <Dialog
          header={
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 4, height: 22, borderRadius: 2,
                background: C.blue,
              }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                TPA Service Details
              </span>
            </div>
          }
          visible={viewDialog}
          style={{ width: "60vw" }}
          contentStyle={{ background: C.card }}
          onHide={() => setViewDialog(false)}
          breakpoints={{ "960px": "75vw", "641px": "90vw" }}
        >
          {viewingService && (
            <div style={{ padding: "4px 0" }}>
              <div style={{
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 14,
                marginBottom: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>TPA Name</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 4 }}>
                    {viewingService.tpaId?.tpaName}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>TPA Code</div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{
                      background: C.card, color: C.slate,
                      padding: "3px 10px", borderRadius: 8,
                      fontSize: 12, fontWeight: 700,
                      border: `1px solid ${C.border}`,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}>
                      {viewingService.tpaId?.tpaCode}
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Total Tests</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 4 }}>
                    {viewingService.services?.length || 0}
                  </div>
                </div>
              </div>

              <SectionTag>Tests</SectionTag>
              <div style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}>
                <DataTable value={viewingService.services} pt={dtPt}>
                  <Column field="Name" header="Test Name" headerStyle={headerCellStyle} />
                  <Column
                    header="Type"
                    headerStyle={headerCellStyle}
                    body={(rowData) => getServiceTypeBadge(rowData.serviceType)}
                  />
                  <Column
                    field="Amount"
                    header="Amount"
                    headerStyle={headerCellStyle}
                    body={(rowData) =>
                      `₹${rowData.Amount?.toLocaleString("en-IN")}`
                    }
                  />
                  <Column
                    field="Discount"
                    header="Discount"
                    headerStyle={headerCellStyle}
                    body={(rowData) => `${rowData.Discount}%`}
                  />
                  <Column
                    field="Totalamount"
                    header="Total"
                    headerStyle={headerCellStyle}
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
    </div>
  );
}

export default TPAServiceManagement;
