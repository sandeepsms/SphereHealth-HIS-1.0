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
    table: { style: { fontSize: 13, tableLayout: "fixed", width: "100%" } },
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

  // Per-column widths so header labels line up with body inputs in the
  // inner Tests table (PrimeReact's default auto-layout was making TYPE
  // too wide and shifting AMOUNT/DISCOUNT off their headers).
  const colNameStyle    = { ...headerCellStyle, width: "auto",  minWidth: 200, padding: "10px 12px" };
  const colTypeStyle    = { ...headerCellStyle, width: 140,     padding: "10px 12px" };
  const colAmountStyle  = { ...headerCellStyle, width: 160,     padding: "10px 12px" };
  const colDiscStyle    = { ...headerCellStyle, width: 130,     padding: "10px 12px" };
  const colTotalStyle   = { ...headerCellStyle, width: 170,     padding: "10px 12px" };
  const cellBodyStyle   = { padding: "8px 12px", verticalAlign: "middle" };

  /* Dropdown pt for the inner table */
  const hisDropdownPt = {
    root: { style: {
      width: "100%",
      border: `1.5px solid ${C.border}`,
      borderRadius: 9,
      padding: "2px 4px",
      background: "#fff",
    }},
    input: { style: { fontSize: 13.5, color: C.text }},
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
          padding: 18,
          marginBottom: 16,
        }}>
          {/* Card header — icon + title + accent stripe + edit pill */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            paddingBottom: 14,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 4, height: 22, borderRadius: 2,
                background: editingService ? C.amber : C.blue,
              }} />
              <i
                className={editingService ? "pi pi-pencil" : "pi pi-id-card"}
                style={{ color: editingService ? C.amber : C.blue, fontSize: 16 }}
              />
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: "-.1px" }}>
                {editingService ? "Edit TPA Service" : "Add New TPA Service"}
              </span>
              {editingService && (
                <span style={{
                  background: C.amberL,
                  color: C.amber,
                  padding: "3px 9px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".4px",
                }}>Editing</span>
              )}
            </div>
          </div>

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
                <div style={{ maxWidth: 520 }}>
                  <label
                    htmlFor="tpaId"
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: C.muted,
                      textTransform: "uppercase",
                      letterSpacing: ".4px",
                      marginBottom: 6,
                    }}
                  >
                    Select TPA *
                  </label>
                  {/* R7dj — Native <select> instead of PrimeReact Dropdown.
                     PrimeReact's Dropdown was rendering the placeholder
                     in `.p-dropdown-label` SPAN with its own padding that
                     no amount of pt overrides could centre vertically.
                     Native <select> centres the text by default and
                     respects our padding cleanly. We lose the filter/search
                     feature but TPA lists are short — not needed. */}
                  <select
                    id="tpaId"
                    value={values.tpaId || ""}
                    onChange={(e) => setFieldValue("tpaId", e.target.value)}
                    disabled={editingService !== null}
                    style={{
                      width: "100%",
                      height: 44,
                      padding: "0 14px",
                      border: `1.5px solid ${errors.tpaId && touched.tpaId ? C.red : C.border}`,
                      borderRadius: 9,
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13.5,
                      color: values.tpaId ? C.text : "#94a3b8",
                      background: editingService ? "#f1f5f9" : "#fff",
                      cursor: editingService ? "not-allowed" : "pointer",
                      outline: "none",
                      appearance: "auto",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="" disabled>Select TPA</option>
                    {tpaList.map((tpa) => (
                      <option key={tpa._id} value={tpa._id}>
                        {tpa.tpaName} ({tpa.tpaCode})
                      </option>
                    ))}
                  </select>
                  {errors.tpaId && touched.tpaId && (
                    <small style={{ color: C.red, fontSize: 11, marginTop: 4, display: "block" }}>
                      {errors.tpaId}
                    </small>
                  )}
                </div>

                {/* Services Array */}
                <FieldArray name="services">
                  {({ push, remove }) => (
                    <div style={{ marginTop: 22 }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}>
                          <i className="pi pi-list-check" style={{ color: C.green, fontSize: 15 }} />
                          <span style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: C.text,
                            letterSpacing: "-.1px",
                          }}>Tests</span>
                          <span style={{
                            background: C.greenL,
                            color: C.green,
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 700,
                          }}>{values.services.length}</span>
                        </div>
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
                            padding: "8px 16px",
                            background: `linear-gradient(135deg,${C.green},#15803d)`,
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            boxShadow: "0 4px 12px rgba(22,163,74,.25)",
                          }}
                        >
                          <i className="pi pi-plus" style={{ fontSize: 11 }} />
                          Add Test
                        </button>
                      </div>

                      {/* R7dg — CSS-grid replacement for PrimeReact DataTable.
                         The DataTable + InputText/InputNumber wrapping was
                         causing header/body column misalignment because each
                         input had its own padding + container wrapper that
                         didn't fill the table cell. A native grid with the
                         same template-columns for header + every row makes
                         the alignment exact regardless of input chrome. */}
                      {(() => {
                        const GRID_COLS = "minmax(200px, 1fr) 140px 160px 130px 170px 50px";
                        const hdrCell   = {
                          padding: "10px 12px", fontSize: 11, fontWeight: 700,
                          color: C.muted, textTransform: "uppercase",
                          letterSpacing: ".4px",
                        };
                        const inputBase = {
                          width: "100%", padding: "9px 12px",
                          border: `1.5px solid ${C.border}`, borderRadius: 9,
                          fontFamily: "'DM Sans', sans-serif", fontSize: 13.5,
                          color: C.text, background: "#fff", outline: "none",
                          boxSizing: "border-box",
                        };
                        return (
                          <div style={{
                            border: `1px dashed ${C.border}`,
                            borderRadius: 10,
                            overflow: "hidden",
                            background: C.subtle,
                          }}>
                            {/* Header row */}
                            <div style={{
                              display: "grid",
                              gridTemplateColumns: GRID_COLS,
                              gap: 12,
                              background: C.subtle,
                              borderBottom: `1px solid ${C.border}`,
                              padding: "0 12px",
                            }}>
                              <div style={hdrCell}>Test Name</div>
                              <div style={hdrCell}>Type</div>
                              <div style={hdrCell}>Amount</div>
                              <div style={hdrCell}>Discount</div>
                              <div style={hdrCell}>Total Amount</div>
                              <div style={hdrCell}></div>
                            </div>
                            {/* Body rows */}
                            {values.services.map((svc, idx) => {
                              const errName  = errors.services?.[idx]?.Name && touched.services?.[idx]?.Name;
                              const errType  = errors.services?.[idx]?.serviceType && touched.services?.[idx]?.serviceType;
                              const errAmt   = errors.services?.[idx]?.Amount && touched.services?.[idx]?.Amount;
                              const disabled = values.services.length === 1;
                              return (
                                <div key={idx} style={{
                                  display: "grid",
                                  gridTemplateColumns: GRID_COLS,
                                  gap: 12,
                                  alignItems: "start",
                                  padding: "10px 12px",
                                  background: "#fff",
                                  borderBottom: idx === values.services.length - 1 ? "none" : `1px solid ${C.border}`,
                                }}>
                                  {/* Test Name */}
                                  <div>
                                    <input
                                      type="text"
                                      value={svc.Name}
                                      onChange={(e) => setFieldValue(`services[${idx}].Name`, e.target.value)}
                                      placeholder="Enter test name"
                                      style={{
                                        ...inputBase,
                                        borderColor: errName ? C.red : C.border,
                                      }}
                                    />
                                    {errName && (
                                      <small style={{ color: C.red, fontSize: 11, marginTop: 4, display: "block" }}>
                                        {errors.services[idx].Name}
                                      </small>
                                    )}
                                  </div>

                                  {/* Type — native select */}
                                  <div>
                                    <select
                                      value={svc.serviceType}
                                      onChange={(e) => setFieldValue(`services[${idx}].serviceType`, e.target.value)}
                                      style={{
                                        ...inputBase,
                                        borderColor: errType ? C.red : C.border,
                                        cursor: "pointer",
                                        appearance: "auto",
                                      }}
                                    >
                                      {SERVICE_TYPES.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                    {errType && (
                                      <small style={{ color: C.red, fontSize: 11, marginTop: 4, display: "block" }}>
                                        {errors.services[idx].serviceType}
                                      </small>
                                    )}
                                  </div>

                                  {/* Amount — native number with ₹ prefix */}
                                  <div style={{ position: "relative" }}>
                                    <span style={{
                                      position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                                      color: C.muted, fontSize: 13, pointerEvents: "none",
                                    }}>₹</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={svc.Amount ?? 0}
                                      onChange={(e) => {
                                        const v = e.target.value === "" ? 0 : Number(e.target.value);
                                        setFieldValue(`services[${idx}].Amount`, v);
                                        setFieldValue(`services[${idx}].Totalamount`, calculateTotal(v, svc.Discount));
                                      }}
                                      style={{
                                        ...inputBase,
                                        paddingLeft: 24,
                                        borderColor: errAmt ? C.red : C.border,
                                      }}
                                    />
                                    {errAmt && (
                                      <small style={{ color: C.red, fontSize: 11, marginTop: 4, display: "block" }}>
                                        {errors.services[idx].Amount}
                                      </small>
                                    )}
                                  </div>

                                  {/* Discount — native number with % suffix */}
                                  <div style={{ position: "relative" }}>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={svc.Discount ?? 0}
                                      onChange={(e) => {
                                        const v = e.target.value === "" ? 0 : Number(e.target.value);
                                        setFieldValue(`services[${idx}].Discount`, v);
                                        setFieldValue(`services[${idx}].Totalamount`, calculateTotal(svc.Amount, v));
                                      }}
                                      style={{ ...inputBase, paddingRight: 26 }}
                                    />
                                    <span style={{
                                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                                      color: C.muted, fontSize: 13, pointerEvents: "none",
                                    }}>%</span>
                                  </div>

                                  {/* Total — read-only display */}
                                  <div style={{ position: "relative" }}>
                                    <span style={{
                                      position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                                      color: C.muted, fontSize: 13, pointerEvents: "none",
                                    }}>₹</span>
                                    <input
                                      type="text"
                                      readOnly
                                      value={Number(svc.Totalamount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      style={{
                                        ...inputBase,
                                        paddingLeft: 24,
                                        background: C.subtle,
                                        fontWeight: 700,
                                        color: C.green,
                                      }}
                                    />
                                  </div>

                                  {/* Remove */}
                                  <button
                                    type="button"
                                    onClick={() => remove(idx)}
                                    disabled={disabled}
                                    title={disabled ? "At least one test required" : "Remove test"}
                                    style={{
                                      width: 38, height: 38, padding: 0,
                                      background: "#fff",
                                      color: disabled ? "#cbd5e1" : C.red,
                                      border: `1.5px solid ${disabled ? C.border : C.redL}`,
                                      borderRadius: 8,
                                      fontSize: 12,
                                      cursor: disabled ? "not-allowed" : "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      alignSelf: "start",
                                    }}
                                  >
                                    <i className="pi pi-trash" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </FieldArray>

                {/* Form Actions — footer band */}
                <div style={{
                  marginTop: 22,
                  paddingTop: 16,
                  borderTop: `1px solid ${C.border}`,
                  background: C.subtle,
                  margin: "22px -18px -18px",
                  padding: "16px 18px",
                  borderBottomLeftRadius: 12,
                  borderBottomRightRadius: 12,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}>
                  {editingService && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingService(null);
                        resetForm();
                      }}
                      style={{
                        padding: "10px 18px",
                        background: "#fff",
                        color: C.slate,
                        border: `1.5px solid ${C.border}`,
                        borderRadius: 9,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <i className="pi pi-times" /> Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      padding: "10px 22px",
                      background: editingService
                        ? `linear-gradient(135deg,${C.amber},#b45309)`
                        : `linear-gradient(135deg,${C.blue},#1e40af)`,
                      color: "#fff",
                      border: "none",
                      borderRadius: 9,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: loading ? "wait" : "pointer",
                      opacity: loading ? 0.7 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: editingService
                        ? "0 4px 12px rgba(217,119,6,.25)"
                        : "0 4px 12px rgba(29,78,216,.25)",
                    }}
                  >
                    <i className={loading ? "pi pi-spin pi-spinner" : "pi pi-check"} />
                    {editingService ? "Update" : "Create"}
                  </button>
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
          padding: 14,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <div style={{
            flex: "1 1 320px",
            minWidth: 0,
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}>
            <i className="pi pi-search" style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.muted,
              fontSize: 14,
              pointerEvents: "none",
            }} />
            <InputText
              placeholder="Search by TPA Name or Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px 10px 38px",
                border: `1.5px solid ${C.border}`,
                borderRadius: 9,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13.5,
                color: C.text,
                outline: "none",
                background: "#fff",
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                title="Clear"
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: 6,
                  color: C.muted,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <i className="pi pi-times" style={{ fontSize: 12 }} />
              </button>
            )}
          </div>
          <span style={{
            fontSize: 12,
            fontWeight: 700,
            color: C.muted,
            background: C.subtle,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "8px 14px",
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            letterSpacing: ".4px",
          }}>
            Showing {filteredList.length} of {tpaServiceList.length}
          </span>
        </div>

        {/* Main table card */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}>
          {/* Card header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            paddingBottom: 14,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 4, height: 22, borderRadius: 2,
                background: C.blue,
              }} />
              <i className="pi pi-database" style={{ color: C.blue, fontSize: 16 }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: "-.1px" }}>
                Configured TPA Services
              </span>
            </div>
            <span style={{
              background: C.blueL,
              color: C.blue,
              padding: "5px 12px",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".4px",
            }}>{filteredList.length} record{filteredList.length === 1 ? "" : "s"}</span>
          </div>
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
              stripedRows
              emptyMessage={
                <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                  <i className="pi pi-inbox" style={{ fontSize: 32, color: "#cbd5e1" }} />
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    {searchTerm ? "No matches for your search." : "No TPA Services configured yet."}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    {searchTerm ? "Try a different TPA name or code." : "Use the form above to add the first one."}
                  </div>
                </div>
              }
              responsiveLayout="scroll"
              pt={dtPt}
            >
              <Column
                header="TPA Name"
                headerStyle={headerCellStyle}
                body={(rowData) => (
                  <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>
                    {rowData.tpaId?.tpaName || "N/A"}
                  </span>
                )}
                sortable
                sortField="tpaId.tpaName"
              />
              <Column
                header="TPA Code"
                headerStyle={headerCellStyle}
                body={codeBodyTemplate}
                sortable
                sortField="tpaId.tpaCode"
              />
              <Column
                header="Tests"
                headerStyle={headerCellStyle}
                body={servicesBodyTemplate}
              />
              <Column
                header="Actions"
                headerStyle={{ ...headerCellStyle, width: 180 }}
                bodyStyle={{ width: 180 }}
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
                width: 36, height: 36, borderRadius: 10,
                background: C.blueL, color: C.blue,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className="pi pi-eye" style={{ fontSize: 16 }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: "-.1px" }}>
                  TPA Service Details
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  Read-only view of configured tests
                </div>
              </div>
            </div>
          }
          visible={viewDialog}
          style={{ width: "70vw" }}
          contentStyle={{ background: C.card, padding: "0 20px 20px" }}
          onHide={() => setViewDialog(false)}
          breakpoints={{ "960px": "85vw", "641px": "95vw" }}
        >
          {viewingService && (
            <div style={{ padding: "8px 0" }}>
              {/* Summary tiles — 4 col grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 10,
                marginBottom: 16,
              }}>
                <div style={{
                  background: C.blueL,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.blue}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>TPA Name</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginTop: 4, wordBreak: "break-word" }}>
                    {viewingService.tpaId?.tpaName || "—"}
                  </div>
                </div>
                <div style={{
                  background: C.subtle,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.slate}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>TPA Code</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{
                      background: C.card, color: C.slate,
                      padding: "3px 10px", borderRadius: 8,
                      fontSize: 12, fontWeight: 700,
                      border: `1px solid ${C.border}`,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}>
                      {viewingService.tpaId?.tpaCode || "—"}
                    </span>
                  </div>
                </div>
                <div style={{
                  background: C.greenL,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.green}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Total Tests</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.green, marginTop: 4 }}>
                    {viewingService.services?.length || 0}
                  </div>
                </div>
                <div style={{
                  background: C.amberL,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.amber}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Created</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 4 }}>
                    {viewingService.createdAt
                      ? new Date(viewingService.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </div>
                </div>
              </div>

              {/* Tests section header */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}>
                <i className="pi pi-list-check" style={{ color: C.green, fontSize: 14 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Tests</span>
                <span style={{
                  background: C.greenL,
                  color: C.green,
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700,
                }}>{viewingService.services?.length || 0}</span>
              </div>
              <div style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}>
                <DataTable value={viewingService.services} stripedRows pt={dtPt}>
                  <Column
                    field="Name"
                    header="Test Name"
                    headerStyle={headerCellStyle}
                    body={(rowData) => (
                      <span style={{ fontWeight: 700, color: C.text }}>{rowData.Name}</span>
                    )}
                  />
                  <Column
                    header="Type"
                    headerStyle={headerCellStyle}
                    body={(rowData) => getServiceTypeBadge(rowData.serviceType)}
                  />
                  <Column
                    field="Amount"
                    header="Amount"
                    headerStyle={headerCellStyle}
                    body={(rowData) => (
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: C.text, fontWeight: 600 }}>
                        ₹{rowData.Amount?.toLocaleString("en-IN")}
                      </span>
                    )}
                  />
                  <Column
                    field="Discount"
                    header="Discount"
                    headerStyle={headerCellStyle}
                    body={(rowData) => (
                      <span style={{
                        background: rowData.Discount > 0 ? C.amberL : C.subtle,
                        color: rowData.Discount > 0 ? C.amber : C.muted,
                        padding: "2px 8px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                      }}>{rowData.Discount || 0}%</span>
                    )}
                  />
                  <Column
                    field="Totalamount"
                    header="Total"
                    headerStyle={headerCellStyle}
                    body={(rowData) => (
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: C.green, fontWeight: 800 }}>
                        ₹{rowData.Totalamount?.toLocaleString("en-IN")}
                      </span>
                    )}
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
