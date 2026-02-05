import React from "react";
import "../../styles/BillsPrint.css";

const BillPrint = React.forwardRef((props, ref) => {
  const { bill } = props;

  if (!bill) return null;

  return (
    <div ref={ref} className="bill-print">
      {/* Hospital Header */}
      <div className="bill-header">
        <div className="hospital-info">
          <h1>CITY HOSPITAL</h1>
          <p>123, Medical Road, City - 123456</p>
          <p>Phone: +91 1234567890 | Email: info@cityhospital.com</p>
          <p>GSTIN: 12ABCDE3456F7Z8</p>
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
          <li>
            This is a computer-generated bill and does not require signature.
          </li>
          <li>All payments are non-refundable.</li>
          <li>Please verify all details before making payment.</li>
          <li>For any queries, contact the billing department.</li>
        </ul>
      </div>

      {/* Footer */}
      <div className="bill-footer">
        <div className="signatures">
          <div>
            <p>_______________________</p>
            <p>Patient / Attendant Signature</p>
          </div>
          <div>
            <p>_______________________</p>
            <p>Authorized Signatory</p>
          </div>
        </div>
        <p className="thank-you">Thank you for choosing City Hospital!</p>
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
