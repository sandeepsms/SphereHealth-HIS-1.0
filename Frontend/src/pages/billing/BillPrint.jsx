import React, { useMemo } from "react";
import "../../styles/BillsPrint.css";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import { buildPrintIssuer } from "../../Components/print/printIssuer";

const BillPrint = React.forwardRef((props, ref) => {
  const { bill } = props;
  const { settings: hs } = useHospitalSettings();
  const issuer = useMemo(() => buildPrintIssuer(), []);

  if (!bill) return null;

  const hospitalName = hs?.hospitalName || "Hospital";
  const addressLine = [hs?.addressLine1, hs?.addressLine2, hs?.city, hs?.state, hs?.pincode].filter(Boolean).join(", ");
  const contactLine = [hs?.phone1 && `Phone: ${hs.phone1}`, hs?.email && `Email: ${hs.email}`].filter(Boolean).join(" | ");

  return (
    <div ref={ref} className="bill-print">
      {/* Hospital Header */}
      <div className="bill-header">
        <div className="hospital-info">
          <h1>{hospitalName.toUpperCase()}</h1>
          {addressLine && <p>{addressLine}</p>}
          {contactLine && <p>{contactLine}</p>}
          {hs?.gstin && <p>GSTIN: {hs.gstin}</p>}
        </div>
        <div className="bill-title">
          <h2>MEDICAL BILL</h2>
          {bill.billNumber && <h3>Bill No: {bill.billNumber}</h3>}
        </div>
      </div>

      <hr className="divider" />

      {/* Patient & TPA Details */}
      <div className="bill-section">
        <div className="patient-details">
          <h3>Patient Details</h3>
          <table>
            <tbody>
              <tr>
                <td>
                  <strong>Name:</strong>
                </td>
                <td>{bill.patientName}</td>
              </tr>
              <tr>
                <td>
                  <strong>UHID:</strong>
                </td>
                <td>{bill.UHID}</td>
              </tr>
              <tr>
                <td>
                  <strong>Bill Type:</strong>
                </td>
                <td>{bill.billingType}</td>
              </tr>
              <tr>
                <td>
                  <strong>Date:</strong>
                </td>
                <td>{new Date(bill.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="tpa-details">
          <h3>TPA / Insurance Details</h3>
          <table>
            <tbody>
              <tr>
                <td>
                  <strong>TPA Name:</strong>
                </td>
                <td>{bill.tpaName}</td>
              </tr>
              <tr>
                <td>
                  <strong>TPA Code:</strong>
                </td>
                <td>{bill.tpaCode}</td>
              </tr>
              {bill.patient?.policyNumber && (
                <tr>
                  <td>
                    <strong>Policy No:</strong>
                  </td>
                  <td>{bill.patient.policyNumber}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hospital Charges */}
      {bill.selectedCharges?.length > 0 && (
        <div className="bill-section">
          <h3>Hospital Charges</h3>
          <table className="charges-table">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Description</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Discount %</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.selectedCharges.map((charge, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>{charge.chargeName}</td>
                  <td>{charge.chargeType}</td>
                  <td>{charge.quantity}</td>
                  <td>₹{charge.baseAmount.toFixed(2)}</td>
                  <td>{charge.discount}%</td>
                  <td className="amount">₹{charge.finalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="subtotal-row">
            <strong>Hospital Charges Subtotal:</strong>
            <span>₹{bill.financials.chargesSubtotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Laboratory Investigations */}
      {bill.investigations?.filter((i) => i.performedInHouse && i.isActive)
        .length > 0 && (
        <div className="bill-section">
          <h3>Laboratory Investigations (In-House)</h3>
          <table className="charges-table">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Test Name</th>
                <th>Rate</th>
                <th>Discount %</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.investigations
                .filter((i) => i.performedInHouse && i.isActive)
                .map((inv, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{inv.serviceName}</td>
                    <td>₹{inv.baseAmount.toFixed(2)}</td>
                    <td>{inv.discount}%</td>
                    <td className="amount">₹{inv.finalAmount.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="subtotal-row">
            <strong>Investigation Subtotal:</strong>
            <span>₹{bill.financials.investigationsSubtotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Outside Investigations */}
      {bill.investigations?.filter((i) => !i.performedInHouse).length > 0 && (
        <div className="bill-section outside-section">
          <h3>Laboratory Investigations (Outside)</h3>
          <p className="note">
            <i>Following tests were performed outside the hospital:</i>
          </p>
          <table className="charges-table">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Test Name</th>
                <th>Suggested Lab</th>
                <th>Estimated Cost</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {bill.investigations
                .filter((i) => !i.performedInHouse)
                .map((inv, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{inv.serviceName}</td>
                    <td>{inv.outsideDetails?.suggestedLab || "-"}</td>
                    <td>
                      ₹{inv.outsideDetails?.estimatedCost?.toFixed(2) || "-"}
                    </td>
                    <td>{inv.outsideDetails?.reason || "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Additional Items */}
      {bill.additionalItems?.length > 0 && (
        <div className="bill-section">
          <h3>Additional Items</h3>
          <table className="charges-table">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Description</th>
                <th>Rate</th>
                <th>Discount %</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.additionalItems.map((item, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>{item.description}</td>
                  <td>₹{item.baseAmount.toFixed(2)}</td>
                  <td>{item.discount}%</td>
                  <td className="amount">₹{item.finalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Financial Summary */}
      <div className="bill-section">
        <div className="summary-table">
          <table>
            <tbody>
              <tr>
                <td className="summary-label">Subtotal:</td>
                <td className="summary-value">
                  ₹{bill.financials.subtotal.toFixed(2)}
                </td>
              </tr>
              {bill.financials.discountAmount > 0 && (
                <tr className="discount-row">
                  <td className="summary-label">
                    Discount ({bill.financials.discountPercent}%):
                  </td>
                  <td className="summary-value">
                    - ₹{bill.financials.discountAmount.toFixed(2)}
                  </td>
                </tr>
              )}
              {bill.financials.taxAmount > 0 && (
                <tr>
                  <td className="summary-label">
                    Tax ({bill.financials.taxPercent}%):
                  </td>
                  <td className="summary-value">
                    ₹{bill.financials.taxAmount.toFixed(2)}
                  </td>
                </tr>
              )}
              <tr className="total-row">
                <td className="summary-label">
                  <strong>TOTAL AMOUNT:</strong>
                </td>
                <td className="summary-value">
                  <strong>₹{bill.financials.total.toFixed(2)}</strong>
                </td>
              </tr>
              {bill.financials.paid > 0 && (
                <>
                  <tr className="paid-row">
                    <td className="summary-label">Paid:</td>
                    <td className="summary-value">
                      ₹{bill.financials.paid.toFixed(2)}
                    </td>
                  </tr>
                  <tr className="balance-row">
                    <td className="summary-label">
                      <strong>Balance Due:</strong>
                    </td>
                    <td className="summary-value">
                      <strong>₹{bill.financials.balance.toFixed(2)}</strong>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Details */}
      {bill.payments?.length > 0 && (
        <div className="bill-section">
          <h3>Payment Details</h3>
          <table className="charges-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Method</th>
                <th>Transaction ID</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.payments
                .filter((p) => p.status === "success")
                .map((payment, idx) => (
                  <tr key={idx}>
                    <td>{new Date(payment.paidAt).toLocaleString("en-IN")}</td>
                    <td>{payment.method}</td>
                    <td>{payment.transactionId || "-"}</td>
                    <td className="amount">₹{payment.amount.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Amount in Words */}
      <div className="bill-section">
        <p>
          <strong>Amount in Words: </strong>
          {numberToWords(bill.financials.total)} Rupees Only
        </p>
      </div>

      {/* Terms & Conditions */}
      <div className="bill-section terms">
        <h4>Terms & Conditions:</h4>
        <ul>
          {hs?.termsLine1 ? <li>{hs.termsLine1}</li> : (
            <li>This is a computer-generated bill and does not require signature.</li>
          )}
          {hs?.termsLine2 ? <li>{hs.termsLine2}</li> : (
            <li>All payments are non-refundable.</li>
          )}
          {hs?.termsLine3 ? <li>{hs.termsLine3}</li> : (
            <li>For any queries, contact the billing department.</li>
          )}
        </ul>
      </div>

      {/* Footer — digital signature stamp */}
      <div className="bill-footer">
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <div style={{
            display: "inline-flex", flexDirection: "column", gap: 3,
            padding: "10px 16px", border: "1px dashed #94a3b8", borderRadius: 8,
            background: "#f8fafc", minWidth: 260, maxWidth: 360, lineHeight: 1.4,
          }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#16a34a", fontWeight: 700, fontSize: 9.5, letterSpacing: ".6px", textTransform: "uppercase" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 14, height: 14, borderRadius: 999, background: "#16a34a", color: "#fff", fontSize: 10,
              }}>✓</span>
              <span>DIGITALLY ISSUED</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#0f172a" }}>{issuer.name}</div>
            {[issuer.designation || issuer.role, issuer.department, issuer.employeeId && `ID: ${issuer.employeeId}`].filter(Boolean).length > 0 && (
              <div style={{ fontSize: 9.5, color: "#475569" }}>
                {[issuer.designation || issuer.role, issuer.department, issuer.employeeId && `ID: ${issuer.employeeId}`].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontSize: 9.5, color: "#64748b" }}>Signed {issuer.when}</div>
          </div>
        </div>
        <p className="thank-you">{hs?.billFooterNote || `Thank you for choosing ${hospitalName}!`}</p>
      </div>
    </div>
  );
});

// Helper function to convert number to words
function numberToWords(num) {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const teens = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];

  if (num === 0) return "Zero";

  const convert = (n) => {
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + " " + ones[n % 10];
    if (n < 1000)
      return ones[Math.floor(n / 100)] + " Hundred " + convert(n % 100);
    if (n < 100000)
      return convert(Math.floor(n / 1000)) + " Thousand " + convert(n % 1000);
    if (n < 10000000)
      return convert(Math.floor(n / 100000)) + " Lakh " + convert(n % 100000);
    return (
      convert(Math.floor(n / 10000000)) + " Crore " + convert(n % 10000000)
    );
  };

  return convert(Math.floor(num)).trim();
}

export default BillPrint;
