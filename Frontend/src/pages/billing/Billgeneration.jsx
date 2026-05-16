import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Tag } from "primereact/tag";
import { Divider } from "primereact/divider";
import { billingService } from "../../Services/billing/billingService";
import BillPrint from "./BillPrint";
import { openPrint } from "../../Components/print/openPrint";

const BillGeneration = () => {
  const { prescriptionId, billId } = useParams();
  const navigate = useNavigate();
  const toast = useRef(null);
  const printRef = useRef();

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [outsideDialog, setOutsideDialog] = useState(false);
  const [selectedInvestigation, setSelectedInvestigation] = useState(null);
  const [outsideDetails, setOutsideDetails] = useState({
    reason: "",
    suggestedLab: "",
    estimatedCost: 0,
  });

  // 🔥 FIX: Simplified Payment (No method selection)
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);

  useEffect(() => {
    if (prescriptionId) {
      createBillFromPrescription();
    } else if (billId) {
      loadExistingBill();
    }
  }, [prescriptionId, billId]);

  const createBillFromPrescription = async () => {
    try {
      setLoading(true);
      const response =
        await billingService.createBillFromPrescription(prescriptionId);
      setBill(response?.data || response || null);

      if (response?.data || response) {
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Bill created successfully",
        });
      }
    } catch (error) {
      console.error("Create bill error:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to create bill",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadExistingBill = async () => {
    try {
      setLoading(true);
      const data = await billingService.getBillById(billId);
      setBill(data);
    } catch (error) {
      console.error("Load bill error:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load bill",
      });
      navigate("/billing");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkOutside = (investigation) => {
    setSelectedInvestigation(investigation);
    setOutsideDetails({
      reason: "",
      suggestedLab: "",
      estimatedCost: investigation.finalAmount || 0,
    });
    setOutsideDialog(true);
  };

  const handleMarkInHouse = async (investigation) => {
    confirmDialog({
      message: "Are you sure you want to mark this investigation as in-house?",
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          const response = await billingService.toggleInvestigation(
            bill._id,
            investigation._id,
            true,
            {},
          );
          setBill(response?.data || response);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Investigation marked as in-house",
          });
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to update investigation",
          });
        }
      },
    });
  };

  const submitOutsideInvestigation = async () => {
    try {
      const response = await billingService.toggleInvestigation(
        bill._id,
        selectedInvestigation._id,
        false,
        outsideDetails,
      );
      setBill(response?.data || response);
      setOutsideDialog(false);
      toast.current?.show({
        severity: "success",
        summary: "Success",
        detail: "Investigation marked as outside",
      });
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to update investigation",
      });
    }
  };

  const handleGenerateBill = async () => {
    confirmDialog({
      message: "Generate final bill? You won't be able to edit it after this.",
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          const response = await billingService.generateBill(bill._id);
          setBill(response?.data || response);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: `Bill generated: ${response?.data?.billNumber || response?.billNumber}`,
          });
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to generate bill",
          });
        }
      },
    });
  };

  // 🔥 FIX: Simplified payment - Just mark as "Paid"
  const handleAddPayment = async () => {
    // 🔥 FIX: Validate amount - must be exactly equal to balance
    const balance = bill.financials?.balance || 0;

    if (paymentAmount <= 0) {
      toast.current?.show({
        severity: "warn",
        summary: "Warning",
        detail: "Enter valid payment amount",
      });
      return;
    }

    // 🔥 FIX: Cannot exceed balance
    if (paymentAmount > balance) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: `Payment cannot exceed balance amount ₹${balance.toFixed(2)}`,
      });
      return;
    }

    try {
      const response = await billingService.addPayment(bill._id, {
        amount: paymentAmount,
        method: "Cash", // Default method
        status: "success",
      });

      setBill(response?.data || response);
      setPaymentDialog(false);
      setPaymentAmount(0);

      toast.current?.show({
        severity: "success",
        summary: "Success",
        detail: "Payment added successfully",
      });
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to add payment",
      });
    }
  };

  // 🔥 FIX: Print functionality
  const handlePrint = () => {
    // ── Unified print system: send bill data through openPrint() so it
    // picks up the hospital header/footer + paper-size selector and
    // renders via the FinalBill (IPD) or OPDReceipt template depending
    // on bill type. Falls back to the legacy popup HTML below if for
    // any reason openPrint can't be loaded (kept for safety).
    try {
      const slug = (String(bill.billType || "").toLowerCase().includes("opd"))
        ? "opd-receipt" : "final-bill";
      openPrint(slug, {
        billNo:       bill.billNumber,
        receiptNo:    bill.billNumber,
        invoiceNo:    bill.billNumber,
        patientName:  bill.patientName,
        uhid:         bill.UHID,
        ipdNo:        bill.ipdNo,
        age:          bill.age,
        gender:       bill.gender,
        doctorName:   bill.doctorName || bill.consultantName,
        consultantName: bill.consultantName,
        department:   bill.department,
        visitDate:    bill.visitDate || bill.createdAt,
        admissionDate: bill.admissionDate,
        dischargeDate: bill.dischargeDate,
        totalDays:    bill.totalDays,
        bedNumber:    bill.bedNumber,
        wardName:     bill.wardName,
        finalDiagnosis: bill.finalDiagnosis || bill.diagnosis,
        tpaName:      bill.tpaName,
        items: (bill.billItems || []).map(it => ({
          category: it.category,
          name:     it.serviceName || it.name,
          description: it.description,
          qty:      it.quantity || 1,
          rate:     it.unitPrice,
          amount:   it.netAmount,
        })),
        discount: bill.discountAmount,
        tax:      bill.taxAmount,
        advanceReceived: bill.advanceReceived,
        tpaPaid: bill.tpaApprovedAmount,
        payments: Array.isArray(bill.payments) ? bill.payments.map(p => ({
          date:   p.paidAt || p.date,
          method: p.paymentMode || p.method,
          refNo:  p.transactionId,
          amount: p.amount,
        })) : [],
        paymentMethod: (bill.payments || []).slice(-1)[0]?.paymentMode,
        paymentRef:    (bill.payments || []).slice(-1)[0]?.transactionId,
      });
      return;
    } catch (_) { /* fall back to legacy print path */ }

    // Create a new window for printing
    const printWindow = window.open("", "_blank");

    if (printWindow) {
      // Get the print content
      const printContent = printRef.current;

      if (printContent) {
        // Write the content to new window
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Bill - ${bill.billNumber || "DRAFT"}</title>
              <style>
                ${getPrintStyles()}
              </style>
            </head>
            <body>
              ${printContent.innerHTML}
            </body>
          </html>
        `);

        printWindow.document.close();

        // Wait for content to load then print
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 250);
      }
    }
  };

  const investigationActionTemplate = (rowData) => {
    if (rowData.performedInHouse) {
      return (
        <Button
          icon="pi pi-external-link"
          label="Mark Outside"
          className="p-button-sm p-button-warning"
          onClick={() => handleMarkOutside(rowData)}
          disabled={bill.status !== "draft"}
        />
      );
    } else {
      return (
        <Button
          icon="pi pi-home"
          label="Mark In-House"
          className="p-button-sm p-button-success"
          onClick={() => handleMarkInHouse(rowData)}
          disabled={bill.status !== "draft"}
        />
      );
    }
  };

  const investigationStatusTemplate = (rowData) => {
    return rowData.performedInHouse ? (
      <Tag severity="success" value="In-House" />
    ) : (
      <Tag severity="warning" value="Outside" />
    );
  };

  const amountTemplate = (rowData, field) => {
    return `₹${rowData[field]?.toFixed(2) || 0}`;
  };

  if (loading) {
    return (
      <div
        className="flex justify-content-center align-items-center p-5"
        style={{ height: "400px" }}
      >
        <i className="pi pi-spin pi-spinner" style={{ fontSize: "3rem" }}></i>
      </div>
    );
  }

  if (!bill) {
    return (
      <div
        className="flex justify-content-center align-items-center p-5"
        style={{ height: "400px" }}
      >
        <div className="text-center">
          <i
            className="pi pi-inbox"
            style={{ fontSize: "3rem", color: "#ccc" }}
          ></i>
          <p className="text-500 mt-3">No bill data available</p>
          <Button
            label="Go Back"
            icon="pi pi-arrow-left"
            onClick={() => navigate("/billing")}
          />
        </div>
      </div>
    );
  }

  const selectedCharges = Array.isArray(bill.selectedCharges)
    ? bill.selectedCharges
    : [];
  const investigations = Array.isArray(bill.investigations)
    ? bill.investigations
    : [];
  const additionalItems = Array.isArray(bill.additionalItems)
    ? bill.additionalItems
    : [];
  const payments = Array.isArray(bill.payments) ? bill.payments : [];

  return (
    <div className="p-4">
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* Header */}
      <div className="flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="m-0">
            {bill.billNumber ? `Bill #${bill.billNumber}` : "Draft Bill"}
          </h2>
          <p className="text-500 m-0">
            Patient: {bill.patientName} | UHID: {bill.UHID}
          </p>
        </div>
        <div className="flex gap-2">
          <Tag
            value={bill.status?.toUpperCase() || "DRAFT"}
            severity={
              bill.status === "paid"
                ? "success"
                : bill.status === "partial"
                  ? "warning"
                  : "info"
            }
          />
        </div>
      </div>

      <div className="grid">
        {/* Left Side - Bill Details */}
        <div className="col-12 lg:col-8">
          {/* Patient & TPA Info */}
          <Card title="Patient & TPA Information" className="mb-3">
            <div className="grid">
              <div className="col-6">
                <p>
                  <strong>Patient Name:</strong> {bill.patientName}
                </p>
                <p>
                  <strong>UHID:</strong> {bill.UHID}
                </p>
                <p>
                  <strong>Billing Type:</strong> {bill.billingType}
                </p>
              </div>
              <div className="col-6">
                <p>
                  <strong>TPA:</strong> {bill.tpaName}
                </p>
                <p>
                  <strong>TPA Code:</strong> {bill.tpaCode}
                </p>
                <p>
                  <strong>Date:</strong>{" "}
                  {new Date(bill.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </Card>

          {/* Hospital Charges */}
          {selectedCharges.length > 0 && (
            <Card title="Hospital Charges" className="mb-3">
              <DataTable value={selectedCharges} size="small">
                <Column field="chargeName" header="Charge Name" />
                <Column field="chargeType" header="Type" />
                <Column field="quantity" header="Qty" />
                <Column field="perUnit" header="Per Unit" />
                <Column
                  field="baseAmount"
                  header="Base Amount"
                  body={(row) => amountTemplate(row, "baseAmount")}
                />
                <Column field="discount" header="Discount %" />
                <Column
                  field="finalAmount"
                  header="Final Amount"
                  body={(row) => amountTemplate(row, "finalAmount")}
                />
              </DataTable>
            </Card>
          )}

          {/* Investigations */}
          {investigations.length > 0 && (
            <Card title="Laboratory Investigations" className="mb-3">
              <DataTable value={investigations} size="small">
                <Column field="serviceName" header="Test Name" />
                <Column
                  field="baseAmount"
                  header="Base Amount"
                  body={(row) => amountTemplate(row, "baseAmount")}
                />
                <Column field="discount" header="Discount %" />
                <Column
                  field="finalAmount"
                  header="Final Amount"
                  body={(row) => amountTemplate(row, "finalAmount")}
                />
                <Column header="Status" body={investigationStatusTemplate} />
                <Column header="Action" body={investigationActionTemplate} />
              </DataTable>
            </Card>
          )}

          {/* Additional Items */}
          {additionalItems.length > 0 && (
            <Card title="Additional Items" className="mb-3">
              <DataTable value={additionalItems} size="small">
                <Column field="description" header="Description" />
                <Column
                  field="baseAmount"
                  header="Amount"
                  body={(row) => amountTemplate(row, "baseAmount")}
                />
                <Column field="discount" header="Discount %" />
                <Column
                  field="finalAmount"
                  header="Final Amount"
                  body={(row) => amountTemplate(row, "finalAmount")}
                />
              </DataTable>
            </Card>
          )}
        </div>

        {/* Right Side - Summary & Actions */}
        <div className="col-12 lg:col-4">
          {/* Financial Summary */}
          <Card title="Bill Summary" className="mb-3">
            <div className="flex justify-content-between mb-2">
              <span>Hospital Charges:</span>
              <span>₹{bill.financials?.chargesSubtotal?.toFixed(2) || 0}</span>
            </div>
            <div className="flex justify-content-between mb-2">
              <span>Investigations:</span>
              <span>
                ₹{bill.financials?.investigationsSubtotal?.toFixed(2) || 0}
              </span>
            </div>
            {bill.financials?.additionalSubtotal > 0 && (
              <div className="flex justify-content-between mb-2">
                <span>Additional Items:</span>
                <span>₹{bill.financials.additionalSubtotal.toFixed(2)}</span>
              </div>
            )}
            <Divider />
            <div className="flex justify-content-between mb-2">
              <span>Subtotal:</span>
              <span className="font-bold">
                ₹{bill.financials?.subtotal?.toFixed(2) || 0}
              </span>
            </div>
            {bill.financials?.discountAmount > 0 && (
              <div className="flex justify-content-between mb-2 text-green-600">
                <span>Discount ({bill.financials.discountPercent}%):</span>
                <span>- ₹{bill.financials.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {bill.financials?.taxAmount > 0 && (
              <div className="flex justify-content-between mb-2">
                <span>Tax ({bill.financials.taxPercent}%):</span>
                <span>₹{bill.financials.taxAmount.toFixed(2)}</span>
              </div>
            )}
            <Divider />
            <div className="flex justify-content-between mb-3">
              <span className="font-bold text-xl">Total:</span>
              <span className="font-bold text-xl text-primary">
                ₹{bill.financials?.total?.toFixed(2) || 0}
              </span>
            </div>
            <div className="flex justify-content-between mb-2 text-green-600">
              <span>Paid:</span>
              <span>₹{bill.financials?.paid?.toFixed(2) || 0}</span>
            </div>
            <div className="flex justify-content-between">
              <span className="font-bold text-red-600">Balance:</span>
              <span className="font-bold text-red-600">
                ₹{bill.financials?.balance?.toFixed(2) || 0}
              </span>
            </div>
          </Card>

          {/* Payments */}
          {payments.length > 0 && (
            <Card title="Payment History" className="mb-3">
              {payments.map((p, idx) => (
                <div key={idx} className="flex justify-content-between mb-2">
                  <div>
                    <p className="m-0">
                      <strong>Paid</strong>
                    </p>
                    <p className="text-sm text-500 m-0">
                      {new Date(p.paidAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="font-bold text-green-600">
                    ₹{p.amount?.toFixed(2) || 0}
                  </span>
                </div>
              ))}
            </Card>
          )}

          {/* Actions */}
          <Card title="Actions">
            <div className="flex flex-column gap-2">
              {bill.status === "draft" && (
                <Button
                  label="Generate Bill"
                  icon="pi pi-check"
                  className="p-button-success"
                  onClick={handleGenerateBill}
                />
              )}

              {bill.status !== "draft" && bill.financials?.balance > 0 && (
                <Button
                  label="Add Payment"
                  icon="pi pi-money-bill"
                  className="p-button-primary"
                  onClick={() => {
                    setPaymentAmount(bill.financials.balance);
                    setPaymentDialog(true);
                  }}
                />
              )}

              {bill.billNumber && (
                <Button
                  label="Print Bill"
                  icon="pi pi-print"
                  className="p-button-secondary"
                  onClick={handlePrint}
                />
              )}

              <Button
                label="Back to List"
                icon="pi pi-arrow-left"
                className="p-button-outlined"
                onClick={() => navigate("/billing")}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Outside Investigation Dialog */}
      <Dialog
        header="Mark Investigation as Outside"
        visible={outsideDialog}
        style={{ width: "500px" }}
        onHide={() => setOutsideDialog(false)}
      >
        <div className="field">
          <label htmlFor="reason">Reason</label>
          <InputText
            id="reason"
            value={outsideDetails.reason}
            onChange={(e) =>
              setOutsideDetails({ ...outsideDetails, reason: e.target.value })
            }
            className="w-full"
            placeholder="Why outside?"
          />
        </div>
        <div className="field">
          <label htmlFor="lab">Suggested Lab</label>
          <InputText
            id="lab"
            value={outsideDetails.suggestedLab}
            onChange={(e) =>
              setOutsideDetails({
                ...outsideDetails,
                suggestedLab: e.target.value,
              })
            }
            className="w-full"
            placeholder="Lab name"
          />
        </div>
        <div className="field">
          <label htmlFor="cost">Estimated Cost</label>
          <InputNumber
            id="cost"
            value={outsideDetails.estimatedCost}
            onValueChange={(e) =>
              setOutsideDetails({ ...outsideDetails, estimatedCost: e.value })
            }
            mode="currency"
            currency="INR"
            className="w-full"
          />
        </div>
        <div className="flex justify-content-end gap-2">
          <Button
            label="Cancel"
            icon="pi pi-times"
            className="p-button-outlined"
            onClick={() => setOutsideDialog(false)}
          />
          <Button
            label="Confirm"
            icon="pi pi-check"
            onClick={submitOutsideInvestigation}
          />
        </div>
      </Dialog>

      {/* 🔥 FIX: Simplified Payment Dialog - No method selection */}
      <Dialog
        header="Add Payment"
        visible={paymentDialog}
        style={{ width: "400px" }}
        onHide={() => setPaymentDialog(false)}
      >
        <div className="field">
          <label htmlFor="amount">Payment Amount</label>
          <InputNumber
            id="amount"
            value={paymentAmount}
            onValueChange={(e) => setPaymentAmount(e.value)}
            mode="currency"
            currency="INR"
            className="w-full"
            max={bill.financials?.balance || 0}
            min={0}
          />
          <small className="text-500">
            Maximum: ₹{bill.financials?.balance?.toFixed(2) || 0}
          </small>
        </div>

        <div className="flex justify-content-end gap-2 mt-4">
          <Button
            label="Cancel"
            icon="pi pi-times"
            className="p-button-outlined"
            onClick={() => setPaymentDialog(false)}
          />
          <Button
            label="Mark as Paid"
            icon="pi pi-check"
            onClick={handleAddPayment}
          />
        </div>
      </Dialog>

      {/* 🔥 FIX: Hidden Print Component - Must be rendered */}
      <div style={{ display: "none" }}>
        <BillPrint ref={printRef} bill={bill} />
      </div>
    </div>
  );
};

// 🔥 FIX: Print styles function
const getPrintStyles = () => {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    
    .bill-print {
      max-width: 800px;
      margin: 0 auto;
    }
    
    .bill-header {
      text-align: center;
      margin-bottom: 20px;
    }
    
    .hospital-info h1 {
      font-size: 28px;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    
    .bill-section {
      margin-bottom: 20px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    
    th {
      background-color: #2c3e50;
      color: white;
      padding: 10px;
      text-align: left;
    }
    
    td {
      padding: 8px;
      border-bottom: 1px solid #ddd;
    }
    
    .amount {
      text-align: right;
      font-weight: bold;
    }
    
    .total-row {
      background-color: #f8f9fa;
      font-weight: bold;
      font-size: 16px;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .bill-section {
        page-break-inside: avoid;
      }
    }
  `;
};

export default BillGeneration;
