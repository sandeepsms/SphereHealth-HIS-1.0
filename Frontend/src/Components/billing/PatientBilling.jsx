// frontend/components/Billing/PatientBilling.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { TabView, TabPanel } from "primereact/tabview";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { Badge } from "primereact/badge";
import { ProgressBar } from "primereact/progressbar";
import { useBilling } from "../../hooks/useBilling";

// ── Constants ─────────────────────────────────────────────────
const INR = (n) =>
  `₹${(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const BILL_STATUS_SEVERITY = {
  DRAFT: "warning",
  GENERATED: "info",
  PARTIAL: "warning",
  PAID: "success",
  CANCELLED: "danger",
  REFUNDED: "secondary",
};

const CATEGORY_SEVERITY = {
  REGISTRATION: "info",
  ROOM: "warning",
  DOCTOR: "success",
  NURSING: "info",
  PROCEDURE: "danger",
  OT: "danger",
  ICU: "danger",
  SUPPORT: "secondary",
  DISCHARGE: "warning",
  PACKAGE: "info",
  CONSULTATION: "success",
  DAYCARE: "warning",
  OTHER: "secondary",
};

const PAYMENT_MODE_OPTIONS = [
  { label: "💵  Cash", value: "CASH" },
  { label: "💳  Card", value: "CARD" },
  { label: "📱  UPI", value: "UPI" },
  { label: "🏦  Cheque", value: "CHEQUE" },
  { label: "🌐  Online Transfer", value: "ONLINE" },
  { label: "🛡️  TPA Claim", value: "TPA_CLAIM" },
];

const VISIT_TYPE_OPTIONS = [
  { label: "🏥 OPD", value: "OPD" },
  { label: "🛏️ IPD", value: "IPD" },
  { label: "⏰ Daycare", value: "DAYCARE" },
  { label: "🚨 Emergency", value: "EMERGENCY" },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function PatientBilling() {
  const { uhid: urlUHID } = useParams();
  const navigate = useNavigate();
  const toast = useRef(null);
  const billing = useBilling();

  // ── Core state ───────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState(urlUHID || "");
  const [patient, setPatient] = useState(null);
  const [bills, setBills] = useState([]);
  const [activeBill, setActiveBill] = useState(null);
  const [serviceGroups, setServiceGroups] = useState([]);

  // ── Dialog visibility ────────────────────────────────────────
  const [showAddSvc, setShowAddSvc] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showNewBill, setShowNewBill] = useState(false);

  // ── Add-service dialog state ─────────────────────────────────
  const [selDomain, setSelDomain] = useState(null);
  const [selCat, setSelCat] = useState(null);
  const [selService, setSelService] = useState(null);
  const [svcSearch, setSvcSearch] = useState("");
  const [qty, setQty] = useState(1);

  // ── Payment dialog state ─────────────────────────────────────
  const [payForm, setPayForm] = useState({
    amount: 0,
    paymentMode: "CASH",
    transactionId: "",
    remarks: "",
  });

  // ── New bill dialog state ────────────────────────────────────
  const [newBillType, setNewBillType] = useState("OPD");

  // ── Load services once ───────────────────────────────────────
  useEffect(() => {
    billing
      .getServicesGrouped()
      .then(setServiceGroups)
      .catch((e) => console.error("[PatientBilling] getServicesGrouped:", e?.message));
    if (urlUHID) loadPatient(urlUHID);
  }, []);

  // ── Load patient + bills ─────────────────────────────────────
  const loadPatient = useCallback(async (uid) => {
    if (!uid?.trim()) return;
    try {
      const data = await billing.getPatientBills(uid.trim().toUpperCase());
      setPatient(data.patient);
      setBills(data.bills || []);
      const draft = data.bills?.find((b) => b.billStatus === "DRAFT");
      setActiveBill(draft || data.bills?.[0] || null);
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Not Found",
        detail: "Patient nahi mila — UHID check karo",
        life: 3000,
      });
      setPatient(null);
      setBills([]);
      setActiveBill(null);
    }
  }, []);

  const refresh = useCallback(() => {
    if (patient) loadPatient(patient.UHID);
  }, [patient, loadPatient]);

  // ── Create new bill ──────────────────────────────────────────
  const handleCreateBill = async () => {
    try {
      await billing.createBill({ UHID: patient.UHID, visitType: newBillType });
      toast.current?.show({
        severity: "success",
        summary: "Bill Created",
        detail: `Naya ${newBillType} bill banaya gaya`,
        life: 2000,
      });
      setShowNewBill(false);
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Add service to active bill ───────────────────────────────
  const handleAddService = async () => {
    if (!activeBill || !selService) return;
    try {
      const updated = await billing.addService(activeBill._id, {
        serviceId: selService._id,
        quantity: qty,
      });
      setActiveBill(updated);
      toast.current?.show({
        severity: "success",
        summary: "Added",
        detail: selService.serviceName,
        life: 2000,
      });
      setShowAddSvc(false);
      setSelService(null);
      setQty(1);
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Remove item ──────────────────────────────────────────────
  const handleRemoveItem = async (itemId) => {
    try {
      const updated = await billing.removeItem(activeBill._id, itemId);
      setActiveBill(updated);
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Generate bill ────────────────────────────────────────────
  const handleGenerate = async () => {
    try {
      const updated = await billing.generateBill(activeBill._id, "Reception");
      setActiveBill(updated);
      toast.current?.show({
        severity: "success",
        summary: "Generated",
        detail: `Bill ${updated.billNumber} generate ho gaya`,
        life: 3000,
      });
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Record payment ───────────────────────────────────────────
  const handlePayment = async () => {
    try {
      const updated = await billing.recordPayment(activeBill._id, payForm);
      setActiveBill(updated);
      setShowPay(false);
      toast.current?.show({
        severity: "success",
        summary: "Payment Recorded",
        detail: `${INR(payForm.amount)} receive kiya gaya`,
        life: 3000,
      });
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Derived flags ────────────────────────────────────────────
  const isTPA = activeBill?.paymentType === "TPA";
  const isDraft = activeBill?.billStatus === "DRAFT";
  const canPay = ["GENERATED", "PARTIAL"].includes(activeBill?.billStatus);

  // ── Service dialog filtered data ─────────────────────────────
  const domains = [...new Set(serviceGroups.map((g) => g.domain))];
  const catsForDomain = serviceGroups.filter(
    (g) => !selDomain || g.domain === selDomain,
  );
  const svcsForCat = selCat
    ? (
        serviceGroups.find(
          (g) => g.domain === selDomain && g.category === selCat,
        )?.services || []
      ).filter(
        (s) =>
          !svcSearch ||
          s.serviceName.toLowerCase().includes(svcSearch.toLowerCase()) ||
          s.serviceCode.toLowerCase().includes(svcSearch.toLowerCase()),
      )
    : [];

  // ════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "6px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* ── TOP BAR ── */}
      <Card style={{ marginBottom: 8, padding: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Button
            icon="pi pi-arrow-left"
            severity="secondary"
            text
            onClick={() => navigate(-1)}
          />
          <span style={{ fontWeight: 700, fontSize: 15, color: "#0d6efd" }}>
            <i className="pi pi-file-edit" style={{ marginRight: 6 }} />
            Patient Billing
          </span>
          <div style={{ flex: 1, display: "flex", gap: 8, minWidth: 260 }}>
            <span className="p-input-icon-left" style={{ flex: 1 }}>
              <i className="pi pi-search" />
              <InputText
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                placeholder="UHID daalo — e.g. UH00000001"
                style={{
                  width: "100%",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
                onKeyDown={(e) => e.key === "Enter" && loadPatient(searchInput)}
              />
            </span>
            <Button
              label="Search"
              icon="pi pi-search"
              onClick={() => loadPatient(searchInput)}
              loading={billing.loading}
            />
          </div>
        </div>
      </Card>

      {/* ── PATIENT BANNER ── */}
      {patient && (
        <div
          style={{
            background: "linear-gradient(135deg, #0d6efd 0%, #0077b6 100%)",
            borderRadius: 10,
            padding: "10px 18px",
            color: "white",
            marginBottom: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              {patient.title} {patient.fullName}
            </div>
            <div
              style={{
                fontSize: 12,
                marginTop: 3,
                opacity: 0.9,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                📋 <b>{patient.UHID}</b>
              </span>
              <span>📞 {patient.contactNumber}</span>
              <span>⚥ {patient.gender}</span>
              {patient.tpa ? (
                <span
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    padding: "1px 8px",
                    borderRadius: 10,
                  }}
                >
                  🛡️ TPA: <b>{patient.tpa.tpaName}</b>
                </span>
              ) : (
                <span
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    padding: "1px 8px",
                    borderRadius: 10,
                  }}
                >
                  💵 Cash Patient
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              label="New Bill"
              icon="pi pi-plus"
              size="small"
              severity="success"
              onClick={() => setShowNewBill(true)}
            />
          </div>
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!patient && (
        <Card>
          <div style={{ textAlign: "center", padding: 60, color: "#adb5bd" }}>
            <i
              className="pi pi-search"
              style={{ fontSize: 48, display: "block", marginBottom: 12 }}
            />
            <h3 style={{ margin: 0 }}>Patient search karo</h3>
            <p>UHID daalo aur Enter dabao ya Search button dabao</p>
          </div>
        </Card>
      )}

      {/* ── MAIN TABS ── */}
      {patient && (
        <TabView>
          {/* ════ TAB 1: ACTIVE BILL ════ */}
          <TabPanel
            header={
              <span>
                Active Bill{" "}
                {activeBill && (
                  <Badge
                    value={activeBill.billItems?.length || 0}
                    severity="warning"
                    style={{ marginLeft: 5, fontSize: 10 }}
                  />
                )}
              </span>
            }
          >
            {!activeBill ? (
              <div
                style={{ textAlign: "center", padding: 50, color: "#adb5bd" }}
              >
                <i
                  className="pi pi-file"
                  style={{ fontSize: 44, display: "block", marginBottom: 10 }}
                />
                <h3>Koi active bill nahi</h3>
                <Button
                  label="Naya Bill Banao"
                  icon="pi pi-plus"
                  severity="success"
                  onClick={() => setShowNewBill(true)}
                />
              </div>
            ) : (
              <>
                {/* R7o: Bill header — wrapped in a subtle themed card so it
                    visually connects with the patient banner above + the KPI
                    strip below. Bill number gets a monospace + small chip
                    treatment to read like a document id, not a label. */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    flexWrap: "wrap",
                    gap: 10,
                    padding: "10px 14px",
                    background: "linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)",
                    border: "1px solid #dbeafe",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 0.5, textTransform: "uppercase" }}>
                      Bill No.
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 14, color: "#1e3a8a", fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>
                      {activeBill.billNumber || "DRAFT"}
                    </span>
                    <Tag
                      value={activeBill.billStatus}
                      severity={BILL_STATUS_SEVERITY[activeBill.billStatus]}
                    />
                    <Tag value={activeBill.visitType} severity="info" />
                    {isTPA && (
                      <Tag
                        value={`TPA: ${activeBill.tpaName}`}
                        severity="success"
                        icon="pi pi-shield"
                      />
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {isDraft && (
                      <Button
                        label="Service Add"
                        icon="pi pi-plus"
                        size="small"
                        onClick={() => setShowAddSvc(true)}
                      />
                    )}
                    {isDraft && activeBill.billItems?.length > 0 && (
                      <Button
                        label="Generate Bill"
                        icon="pi pi-check-circle"
                        size="small"
                        severity="warning"
                        onClick={handleGenerate}
                        loading={billing.loading}
                      />
                    )}
                    {canPay && (
                      <Button
                        label="Record Payment"
                        icon="pi pi-wallet"
                        size="small"
                        severity="success"
                        onClick={() => {
                          setPayForm({
                            ...payForm,
                            amount: activeBill.balanceAmount,
                          });
                          setShowPay(true);
                        }}
                      />
                    )}
                    <Button
                      icon="pi pi-print"
                      size="small"
                      severity="secondary"
                      outlined
                      tooltip="Print Bill"
                      onClick={() =>
                        window.open(`/bill-print/${activeBill._id}`, "_blank")
                      }
                    />
                  </div>
                </div>

                {/* Amount summary cards */}
                <AmountSummaryRow bill={activeBill} />

                {/* TPA split progress bar */}
                {isTPA && activeBill.netAmount > 0 && (
                  <div style={{ marginTop: 8, marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: 12,
                        marginBottom: 4,
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>
                        TPA Pays:{" "}
                        <b style={{ color: "#20c997" }}>
                          {INR(activeBill.tpaPayableAmount)}
                        </b>
                      </span>
                      <span>
                        Patient Pays:{" "}
                        <b style={{ color: "#dc3545" }}>
                          {INR(activeBill.patientPayableAmount)}
                        </b>
                      </span>
                    </div>
                    <ProgressBar
                      value={Math.round(
                        (activeBill.tpaPayableAmount / activeBill.netAmount) *
                          100,
                      )}
                      style={{ height: 8 }}
                    />
                  </div>
                )}

                {/* Bill items table */}
                <DataTable
                  value={activeBill.billItems || []}
                  size="small"
                  stripedRows
                  style={{ fontSize: 12 }}
                  emptyMessage={
                    <div
                      style={{
                        textAlign: "center",
                        padding: 30,
                        color: "#adb5bd",
                      }}
                    >
                      <i
                        className="pi pi-inbox"
                        style={{
                          fontSize: 32,
                          display: "block",
                          marginBottom: 8,
                        }}
                      />
                      Koi service nahi add ki — upar "Service Add" button dabao
                    </div>
                  }
                >
                  <Column
                    header="#"
                    body={(_, { rowIndex }) => rowIndex + 1}
                    style={{ width: 40 }}
                  />
                  <Column
                    field="serviceCode"
                    header="Code"
                    style={{
                      width: 120,
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  />
                  <Column
                    field="serviceName"
                    header="Service Name"
                    style={{ minWidth: 180 }}
                  />
                  <Column
                    header="Category"
                    body={(r) => (
                      <Tag
                        value={r.category}
                        severity={CATEGORY_SEVERITY[r.category] || "secondary"}
                        style={{ fontSize: 10 }}
                      />
                    )}
                    style={{ width: 120 }}
                  />
                  <Column
                    header="Qty"
                    body={(r) => (
                      <span style={{ fontWeight: 600 }}>
                        {r.quantity}
                        <span
                          style={{
                            fontSize: 10,
                            color: "#6c757d",
                            marginLeft: 2,
                          }}
                        >
                          {r.billingType === "PER_DAY"
                            ? "day"
                            : r.billingType === "PER_HOUR"
                              ? "hr"
                              : r.billingType === "PER_VISIT"
                                ? "visit"
                                : ""}
                        </span>
                      </span>
                    )}
                    style={{ width: 70 }}
                  />
                  <Column
                    header="Rate"
                    body={(r) => INR(r.unitPrice)}
                    style={{ width: 90 }}
                  />
                  <Column
                    header="Gross"
                    body={(r) => INR(r.grossAmount)}
                    style={{ width: 90 }}
                  />
                  <Column
                    header="Disc"
                    body={(r) =>
                      r.discountPercent > 0 ? (
                        <span style={{ color: "#dc3545" }}>
                          -{r.discountPercent}%
                        </span>
                      ) : (
                        "—"
                      )
                    }
                    style={{ width: 60 }}
                  />
                  <Column
                    header="Net"
                    body={(r) => (
                      <b style={{ color: "#0d6efd" }}>{INR(r.netAmount)}</b>
                    )}
                    style={{ width: 90 }}
                  />
                  {isTPA && (
                    <Column
                      header="TPA↑"
                      body={(r) => (
                        <span style={{ color: "#20c997", fontSize: 11 }}>
                          {INR(r.tpaPayableAmount)}
                        </span>
                      )}
                      style={{ width: 85 }}
                    />
                  )}
                  {isTPA && (
                    <Column
                      header="Pt.↓"
                      body={(r) => (
                        <b style={{ color: "#dc3545", fontSize: 11 }}>
                          {INR(r.patientPayableAmount)}
                        </b>
                      )}
                      style={{ width: 85 }}
                    />
                  )}
                  {isDraft && (
                    <Column
                      header=""
                      body={(r) => (
                        <Button
                          icon="pi pi-times"
                          text
                          severity="danger"
                          size="small"
                          rounded
                          onClick={() => handleRemoveItem(r._id)}
                        />
                      )}
                      style={{ width: 40 }}
                    />
                  )}
                </DataTable>

                {/* Payment history */}
                {activeBill.payments?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        marginBottom: 6,
                        color: "#198754",
                      }}
                    >
                      ✅ Payment History
                    </div>
                    <DataTable
                      value={activeBill.payments}
                      size="small"
                      style={{ fontSize: 12 }}
                    >
                      <Column field="paymentMode" header="Mode" />
                      <Column
                        header="Amount"
                        body={(r) => (
                          <b style={{ color: "#198754" }}>{INR(r.amount)}</b>
                        )}
                      />
                      <Column
                        header="Date & Time"
                        body={(r) => new Date(r.paidAt).toLocaleString("en-IN")}
                      />
                      <Column field="transactionId" header="Txn ID" />
                      <Column field="receivedBy" header="Received By" />
                      <Column field="remarks" header="Remarks" />
                    </DataTable>
                  </div>
                )}
              </>
            )}
          </TabPanel>

          {/* ════ TAB 2: BILL HISTORY ════ */}
          <TabPanel header="Bill History">
            <DataTable
              value={bills}
              size="small"
              stripedRows
              emptyMessage="Koi bill nahi mila"
              selectionMode="single"
              onRowClick={(e) => setActiveBill(e.data)}
            >
              <Column
                field="billNumber"
                header="Bill No."
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              <Column
                header="Type"
                body={(r) => (
                  <Tag
                    value={r.visitType}
                    severity="info"
                    style={{ fontSize: 10 }}
                  />
                )}
              />
              <Column
                header="Date"
                body={(r) => new Date(r.billDate).toLocaleDateString("en-IN")}
              />
              <Column
                header="Items"
                body={(r) => r.billItems?.length || 0}
                style={{ width: 60, textAlign: "center" }}
              />
              <Column header="Net" body={(r) => <b>{INR(r.netAmount)}</b>} />
              <Column
                header="Paid"
                body={(r) => (
                  <span style={{ color: "#198754" }}>{INR(r.advancePaid)}</span>
                )}
              />
              <Column
                header="Balance"
                body={(r) => (
                  <b
                    style={{
                      color: r.balanceAmount > 0 ? "#dc3545" : "#198754",
                    }}
                  >
                    {INR(r.balanceAmount)}
                  </b>
                )}
              />
              <Column
                header="Status"
                body={(r) => (
                  <Tag
                    value={r.billStatus}
                    severity={BILL_STATUS_SEVERITY[r.billStatus]}
                    style={{ fontSize: 10 }}
                  />
                )}
              />
              {isTPA && (
                <Column
                  header="TPA Claim"
                  body={(r) =>
                    r.tpaClaimStatus !== "NOT_APPLICABLE" ? (
                      <Tag
                        value={r.tpaClaimStatus}
                        severity="info"
                        style={{ fontSize: 9 }}
                      />
                    ) : (
                      "—"
                    )
                  }
                />
              )}
              <Column
                header=""
                body={(r) => (
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      icon="pi pi-eye"
                      text
                      size="small"
                      tooltip="View"
                      onClick={() => setActiveBill(r)}
                    />
                    <Button
                      icon="pi pi-print"
                      text
                      size="small"
                      tooltip="Print"
                      onClick={() =>
                        window.open(`/bill-print/${r._id}`, "_blank")
                      }
                    />
                  </div>
                )}
                style={{ width: 80 }}
              />
            </DataTable>
          </TabPanel>

          {/* ════ TAB 3: ADMISSIONS ════ */}
          <TabPanel header="Admissions">
            <AdmissionTab
              UHID={patient?.UHID}
              billing={billing}
              toast={toast}
              refresh={refresh}
            />
          </TabPanel>
        </TabView>
      )}

      {/* ════════════════════════════════════════
          DIALOG: Add Service
      ════════════════════════════════════════ */}
      <Dialog
        visible={showAddSvc}
        style={{ width: "min(920px, 92vw)" }}
        header="Service Add Karo"
        onHide={() => {
          setShowAddSvc(false);
          setSelService(null);
          setQty(1);
          setSvcSearch("");
          setSelCat(null);
          setSelDomain(null);
        }}
      >
        {/* 3-column picker */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "155px 200px 1fr",
            height: 460,
            border: "1px solid #dee2e6",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {/* Column 1: Domain */}
          <div
            style={{
              background: "#f8f9fa",
              borderRight: "1px solid #dee2e6",
              overflowY: "auto",
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#6c757d",
                padding: "4px 4px 8px",
                letterSpacing: 1,
              }}
            >
              DOMAIN
            </div>
            {domains.map((d) => (
              <div
                key={d}
                onClick={() => {
                  setSelDomain(d);
                  setSelCat(null);
                  setSelService(null);
                }}
                style={{
                  padding: "9px 10px",
                  marginBottom: 3,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  background: selDomain === d ? "#0d6efd" : "transparent",
                  color: selDomain === d ? "white" : "#212529",
                  transition: "all 0.15s",
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Column 2: Category */}
          <div
            style={{
              background: "white",
              borderRight: "1px solid #dee2e6",
              overflowY: "auto",
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#6c757d",
                padding: "4px 4px 8px",
                letterSpacing: 1,
              }}
            >
              CATEGORY
            </div>
            {selDomain ? (
              catsForDomain
                .filter((g) => g.domain === selDomain)
                .map((g) => (
                  <div
                    key={g.category}
                    onClick={() => {
                      setSelCat(g.category);
                      setSelService(null);
                      setSvcSearch("");
                    }}
                    style={{
                      padding: "8px 10px",
                      marginBottom: 3,
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      background:
                        selCat === g.category ? "#e7f3ff" : "transparent",
                      borderLeft:
                        selCat === g.category
                          ? "3px solid #0d6efd"
                          : "3px solid transparent",
                      fontWeight: selCat === g.category ? 700 : 400,
                      transition: "all 0.1s",
                    }}
                  >
                    <div>{g.category}</div>
                    <div style={{ fontSize: 10, color: "#6c757d" }}>
                      {g.services.length} services
                    </div>
                  </div>
                ))
            ) : (
              <div style={{ padding: 20, color: "#adb5bd", fontSize: 12 }}>
                ← Domain select karo
              </div>
            )}
          </div>

          {/* Column 3: Services */}
          <div style={{ overflowY: "auto", padding: 10 }}>
            {selCat ? (
              <>
                <InputText
                  value={svcSearch}
                  onChange={(e) => setSvcSearch(e.target.value)}
                  placeholder="Service search karo..."
                  style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
                />
                {svcsForCat.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 30,
                      color: "#adb5bd",
                    }}
                  >
                    No services found
                  </div>
                ) : (
                  svcsForCat.map((s) => (
                    <div
                      key={s._id}
                      onClick={() => setSelService(s)}
                      style={{
                        padding: "10px 12px",
                        marginBottom: 6,
                        borderRadius: 8,
                        cursor: "pointer",
                        border: `2px solid ${selService?._id === s._id ? "#0d6efd" : "#e9ecef"}`,
                        background:
                          selService?._id === s._id ? "#e7f3ff" : "white",
                        transition: "all 0.1s",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {s.serviceName}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#6c757d",
                              marginTop: 2,
                            }}
                          >
                            <span style={{ fontFamily: "monospace" }}>
                              {s.serviceCode}
                            </span>
                            &nbsp;•&nbsp;{s.billingType.replace(/_/g, " ")}
                            &nbsp;•&nbsp;{s.unitLabel || ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#0d6efd",
                              fontSize: 14,
                            }}
                          >
                            ₹{s.defaultPrice.toLocaleString("en-IN")}
                          </div>
                          {isTPA && (
                            <div style={{ fontSize: 9, color: "#20c997" }}>
                              TPA rate applies
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </>
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: 30,
                  color: "#adb5bd",
                  fontSize: 13,
                }}
              >
                ← Category select karo
              </div>
            )}
          </div>
        </div>

        {/* Selected service footer */}
        {selService && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 16px",
              background: "#e7f3ff",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {selService.serviceName}
              </div>
              <div style={{ fontSize: 12, color: "#0d6efd", marginTop: 2 }}>
                {selService.billingType.replace(/_/g, " ")} @ ₹
                {selService.defaultPrice.toLocaleString("en-IN")}{" "}
                {selService.unitLabel}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Qty:</label>
                <InputNumber
                  value={qty}
                  onValueChange={(e) => setQty(e.value || 1)}
                  min={1}
                  max={999}
                  showButtons
                  inputStyle={{ width: 60 }}
                />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#0d6efd" }}>
                = ₹{(selService.defaultPrice * qty).toLocaleString("en-IN")}
              </div>
              <Button
                label="Bill Mein Add Karo"
                icon="pi pi-plus"
                severity="success"
                onClick={handleAddService}
                loading={billing.loading}
              />
            </div>
          </div>
        )}
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Record Payment
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPay}
        style={{ width: 450 }}
        header="💳 Payment Record Karo"
        onHide={() => setShowPay(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowPay(false)}
            />
            <Button
              label="Record Payment"
              icon="pi pi-check"
              severity="success"
              onClick={handlePayment}
              loading={billing.loading}
              disabled={!payForm.amount}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Summary */}
          {activeBill && (
            <div
              style={{
                background: "#f8f9fa",
                borderRadius: 8,
                padding: "10px 14px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "6px 12px",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#6c757d" }}>Net Amount:</span>
              <b style={{ textAlign: "right" }}>{INR(activeBill.netAmount)}</b>
              <span style={{ color: "#6c757d" }}>Already Paid:</span>
              <b style={{ textAlign: "right", color: "#198754" }}>
                {INR(activeBill.advancePaid)}
              </b>
              <span style={{ color: "#6c757d", fontWeight: 700 }}>
                Balance Due:
              </span>
              <b style={{ textAlign: "right", color: "#dc3545", fontSize: 16 }}>
                {INR(activeBill.balanceAmount)}
              </b>
            </div>
          )}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Amount (₹) *
            </label>
            <InputNumber
              value={payForm.amount}
              onValueChange={(e) => setPayForm({ ...payForm, amount: e.value })}
              mode="currency"
              currency="INR"
              locale="en-IN"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Payment Mode *
            </label>
            <Dropdown
              value={payForm.paymentMode}
              options={PAYMENT_MODE_OPTIONS}
              onChange={(e) => setPayForm({ ...payForm, paymentMode: e.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Transaction ID
            </label>
            <InputText
              value={payForm.transactionId}
              onChange={(e) =>
                setPayForm({ ...payForm, transactionId: e.target.value })
              }
              placeholder="UPI / Card reference no."
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Remarks
            </label>
            <InputText
              value={payForm.remarks}
              onChange={(e) =>
                setPayForm({ ...payForm, remarks: e.target.value })
              }
              placeholder="Optional"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: New Bill Type
      ════════════════════════════════════════ */}
      <Dialog
        visible={showNewBill}
        style={{ width: 380 }}
        header="Naya Bill Banao"
        onHide={() => setShowNewBill(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowNewBill(false)}
            />
            <Button
              label="Create Bill"
              icon="pi pi-plus"
              severity="success"
              onClick={handleCreateBill}
              loading={billing.loading}
            />
          </div>
        }
      >
        <div>
          <label
            style={{
              fontWeight: 600,
              fontSize: 13,
              display: "block",
              marginBottom: 10,
            }}
          >
            Bill Type Select Karo
          </label>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            {VISIT_TYPE_OPTIONS.map((vt) => (
              <div
                key={vt.value}
                onClick={() => setNewBillType(vt.value)}
                style={{
                  padding: "14px 12px",
                  borderRadius: 8,
                  border: `2px solid ${newBillType === vt.value ? "#0d6efd" : "#dee2e6"}`,
                  background: newBillType === vt.value ? "#e7f3ff" : "white",
                  cursor: "pointer",
                  textAlign: "center",
                  fontWeight: 600,
                  fontSize: 14,
                  transition: "all 0.1s",
                }}
              >
                {vt.label}
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENT: Amount Summary Row
// R7o: Two fixes in this component:
// 1. WIRING BUG — bill.grossAmount/netAmount/etc. were sometimes missing
//    from the backend payload right after /add-service (which returns the
//    raw bill before totals are re-aggregated). The page rendered ₹0 even
//    when the line-item table clearly showed ₹300+. Now we fall back to
//    summing bill.billItems[] client-side when the aggregate is missing
//    or zero — defensive, never displays wrong data.
// 2. THEME — replaced pale flat tiles with gradient-tinted cards keyed to
//    each KPI's semantic colour (Net = blue · Paid = green · Balance = red).
//    Matches the patient banner's gradient theme above.
// ═══════════════════════════════════════════════════════════════
function AmountSummaryRow({ bill }) {
  const isTPA = bill.paymentType === "TPA";

  // R7o: defensive client-side aggregation. When the backend hasn't
  // recomputed totals yet (e.g. immediately after /add-service), sum
  // the line items here so the KPI strip stays in sync with the table.
  // `toNum()` unwraps Decimal128 → number, mirrors the autoBillingService
  // pattern used everywhere else in the codebase.
  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "object" && "$numberDecimal" in v) return parseFloat(v.$numberDecimal) || 0;
    return parseFloat(v) || 0;
  };
  const items = Array.isArray(bill.billItems) ? bill.billItems : [];
  const itemsTotal = items.reduce((s, it) => s + toNum(it.grossAmount ?? it.amount ?? 0), 0);
  const itemsDiscount = items.reduce((s, it) => s + toNum(it.discountAmount ?? 0), 0);
  const itemsTax = items.reduce((s, it) => s + toNum(it.taxAmount ?? 0), 0);
  const itemsNet = items.reduce((s, it) => s + toNum(it.netAmount ?? 0), 0);

  // Prefer backend-aggregated values when present + non-zero; otherwise
  // fall back to the client-side sum. Treat exact-zero on a non-empty
  // line-items list as "stale" — the backend hasn't recomputed yet.
  const pick = (server, client) =>
    (server != null && toNum(server) > 0) || items.length === 0
      ? toNum(server)
      : client;

  const gross    = pick(bill.grossAmount,   itemsTotal);
  const discount = pick(bill.totalDiscount, itemsDiscount);
  const tax      = pick(bill.taxAmount,     itemsTax);
  // Net falls back to gross - discount + tax when neither backend nor
  // item-net is populated.
  const net      = (bill.netAmount != null && toNum(bill.netAmount) > 0)
    ? toNum(bill.netAmount)
    : (itemsNet > 0 ? itemsNet : gross - discount + tax);
  const paid     = toNum(bill.advancePaid);
  const balance  = (bill.balanceAmount != null)
    ? toNum(bill.balanceAmount)
    : Math.max(0, net - paid);

  const tiles = [
    { label: "Gross",     value: gross,           tint: "blue"  },
    { label: "Discount",  value: -discount,       tint: "red"   },
    { label: "Tax",       value: tax,             tint: "amber" },
    { label: "Net Total", value: net,             tint: "blue",  bold: true },
    ...(isTPA
      ? [
          { label: "TPA Pays", value: toNum(bill.tpaPayableAmount),     tint: "teal" },
          { label: "Pt. Pays", value: toNum(bill.patientPayableAmount), tint: "red", bold: true },
        ]
      : []),
    { label: "Paid",      value: paid,             tint: "green" },
    { label: "Balance",   value: balance,          tint: balance > 0 ? "red" : "green", bold: true },
  ];

  // Pre-baked gradient palette tied to the system theme. Light tints so
  // values stay legible; thicker left border (4px) calls out the KPI
  // colour without overpowering the table below.
  const PALETTE = {
    blue:  { bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", border: "#bfdbfe", text: "#1e40af", accent: "#2563eb" },
    red:   { bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)", border: "#fecaca", text: "#b91c1c", accent: "#dc2626" },
    green: { bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "#a7f3d0", text: "#047857", accent: "#10b981" },
    amber: { bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", border: "#fde68a", text: "#b45309", accent: "#d97706" },
    teal:  { bg: "linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)", border: "#a5f3fc", text: "#0e7490", accent: "#0891b2" },
  };

  return (
    <div
      style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
    >
      {tiles.map((t, i) => {
        const p = PALETTE[t.tint] || PALETTE.blue;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 100,
              background: p.bg,
              borderRadius: 10,
              padding: "10px 12px",
              textAlign: "center",
              border: `1px solid ${p.border}`,
              borderLeft: `4px solid ${p.accent}`,
              boxShadow: "0 1px 2px rgba(15,23,42,.04)",
            }}
          >
            <div style={{ fontSize: 10, color: p.text, opacity: 0.85, marginBottom: 4, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
              {t.label}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: t.bold ? 800 : 700,
                color: p.text,
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {t.value < 0
                ? `-₹${Math.abs(t.value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                : `₹${(t.value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENT: Admission Tab
// ═══════════════════════════════════════════════════════════════
function AdmissionTab({ UHID, billing, toast, refresh }) {
  const [admissions, setAdmissions] = useState([]);
  const [showDlg, setShowDlg] = useState(false);
  const [form, setForm] = useState({
    admissionType: "IPD",
    roomCategory: "GENERAL_WARD",
    bedNumber: "",
    admissionDiagnosis: "",
  });

  const ROOM_CAT_OPTIONS = [
    "GENERAL_WARD",
    "SEMI_PRIVATE",
    "PRIVATE",
    "DELUXE",
    "SUITE",
    "ICU",
    "DAYCARE_BED",
    "EMERGENCY_BED",
  ].map((v) => ({ label: v.replace(/_/g, " "), value: v }));

  useEffect(() => {
    if (UHID) {
      billing
        .getAdmissions(UHID)
        .then(setAdmissions)
        .catch((e) => console.error("[PatientBilling] getAdmissions:", e?.message));
    }
  }, [UHID]);

  const handleAdmit = async () => {
    try {
      await billing.createAdmission({ UHID, ...form });
      toast.current?.show({
        severity: "success",
        summary: "Admitted",
        detail: `Patient admit kiya gaya (${form.admissionType})`,
        life: 3000,
      });
      setShowDlg(false);
      billing.getAdmissions(UHID).then(setAdmissions);
      refresh();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  const handleDischarge = async (id) => {
    try {
      await billing.dischargePatient(id, { dischargedBy: "Staff" });
      toast.current?.show({
        severity: "success",
        summary: "Discharged",
        detail: "Patient discharge ho gaya",
        life: 3000,
      });
      billing.getAdmissions(UHID).then(setAdmissions);
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10,
        }}
      >
        <Button
          label="New Admission"
          icon="pi pi-plus"
          severity="info"
          onClick={() => setShowDlg(true)}
        />
      </div>

      <DataTable
        value={admissions}
        size="small"
        stripedRows
        emptyMessage="No admissions found"
      >
        <Column
          field="admissionNumber"
          header="Admission No."
          style={{ fontFamily: "monospace" }}
        />
        <Column
          header="Type"
          body={(r) => <Tag value={r.admissionType} severity="info" />}
        />
        <Column
          header="Room"
          body={(r) => r.roomCategory?.replace(/_/g, " ")}
        />
        <Column field="bedNumber" header="Bed No." />
        <Column
          header="Admitted"
          body={(r) => new Date(r.admissionDateTime).toLocaleString("en-IN")}
        />
        <Column
          header="Days"
          body={(r) => r.totalDaysAdmitted || 1}
          style={{ width: 60, textAlign: "center" }}
        />
        <Column
          header="Status"
          body={(r) => (
            <Tag
              value={r.status}
              severity={
                r.status === "ADMITTED"
                  ? "success"
                  : r.status === "DISCHARGED"
                    ? "secondary"
                    : "warning"
              }
            />
          )}
        />
        <Column
          header="Action"
          body={(r) =>
            r.status === "ADMITTED" && (
              <Button
                label="Discharge"
                icon="pi pi-sign-out"
                size="small"
                severity="warning"
                onClick={() => handleDischarge(r._id)}
                loading={billing.loading}
              />
            )
          }
        />
      </DataTable>

      {/* New Admission Dialog */}
      <Dialog
        visible={showDlg}
        style={{ width: 420 }}
        header="New Admission"
        onHide={() => setShowDlg(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowDlg(false)}
            />
            <Button
              label="Admit Patient"
              icon="pi pi-check"
              severity="success"
              onClick={handleAdmit}
              loading={billing.loading}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 6,
              }}
            >
              Admission Type *
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {["IPD", "DAYCARE", "EMERGENCY"].map((t) => (
                <div
                  key={t}
                  onClick={() => setForm({ ...form, admissionType: t })}
                  style={{
                    flex: 1,
                    padding: "11px 0",
                    textAlign: "center",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                    border: `2px solid ${form.admissionType === t ? "#0d6efd" : "#dee2e6"}`,
                    background: form.admissionType === t ? "#e7f3ff" : "white",
                    transition: "all 0.1s",
                  }}
                >
                  {t === "IPD" ? "🛏️" : t === "DAYCARE" ? "⏰" : "🚨"} {t}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Room Category *
            </label>
            <Dropdown
              value={form.roomCategory}
              options={ROOM_CAT_OPTIONS}
              onChange={(e) => setForm({ ...form, roomCategory: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Bed Number
            </label>
            <InputText
              value={form.bedNumber}
              onChange={(e) => setForm({ ...form, bedNumber: e.target.value })}
              placeholder="e.g. G-12, ICU-3"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Admission Diagnosis
            </label>
            <InputText
              value={form.admissionDiagnosis}
              onChange={(e) =>
                setForm({ ...form, admissionDiagnosis: e.target.value })
              }
              placeholder="Primary diagnosis (optional)"
              style={{ width: "100%" }}
            />
          </div>

          {form.admissionType === "DAYCARE" && (
            <div
              style={{
                background: "#fff3cd",
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              ⏰ Daycare mein maximum <b>12 ghante</b> allowed hain. 12 ghante
              baad patient automatically <b>IPD</b> mein convert ho jayega.
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
