// utils/investigationPrint.js
// Handles both Order Slip (before results) and Report Print (after results)

export const printOrderSlip = (order) => {
  const patient = order.patientId || {};
  const doctor = order.doctorId || {};
  const doctorName = doctor.personalInfo
    ? `Dr. ${doctor.personalInfo.firstName || ""} ${doctor.personalInfo.lastName || ""}`.trim()
    : order.doctorName || "—";

  const rows = (order.items || [])
    .map(
      (item) => `
    <tr>
      <td>${item.investigationCode || "—"}</td>
      <td>${item.investigationName}</td>
      <td><span class="badge ${item.performedAt === "EXTERNAL" ? "badge-ext" : "badge-int"}">${item.performedAt}</span></td>
      <td>${item.sampleType || "—"}</td>
      <td>₹${(item.chargedPrice || 0).toLocaleString("en-IN")}</td>
    </tr>
  `,
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Investigation Order — ${order.orderNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #0891b2; padding-bottom: 10px; margin-bottom: 14px; }
        .header h1 { font-size: 18px; color: #0891b2; }
        .header p  { font-size: 11px; color: #555; margin-top: 2px; }
        .order-no  { font-size: 14px; font-weight: bold; color: #0891b2; margin-bottom: 10px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 14px; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
        .info-grid .label { font-size: 10px; color: #666; }
        .info-grid .value { font-weight: bold; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        th { background: #0891b2; color: white; padding: 7px 10px; text-align: left; font-size: 11px; }
        td { padding: 6px 10px; border-bottom: 1px solid #eee; font-size: 11px; }
        tr:nth-child(even) td { background: #f9f9f9; }
        .total-row td { font-weight: bold; background: #e0f7fa !important; }
        .badge { padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: bold; }
        .badge-int { background: #d1fae5; color: #065f46; }
        .badge-ext { background: #fef3c7; color: #92400e; }
        .priority { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; }
        .ROUTINE  { background: #f1f5f9; color: #475569; }
        .URGENT   { background: #fef3c7; color: #92400e; }
        .STAT     { background: #fee2e2; color: #7f1d1d; }
        .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; display: flex; justify-content: space-between; font-size: 10px; color: #666; }
        .sign-box { text-align: center; margin-top: 30px; }
        .sign-line { border-top: 1px solid #333; width: 160px; margin: 0 auto 4px; }
        @media print {
          body { padding: 10px; }
          @page { margin: 10mm; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Spherehealth Medical Solutions</h1>
        <p>Investigation Order Slip</p>
      </div>

      <div class="order-no">
        Order #: ${order.orderNumber || "—"}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        Date: ${new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        Priority: <span class="priority ${order.priority}">${order.priority}</span>
      </div>

      <div class="info-grid">
        <div>
          <div class="label">Patient Name</div>
          <div class="value">${patient.fullName || order.patientName || "—"}</div>
        </div>
        <div>
          <div class="label">UHID</div>
          <div class="value">${order.UHID || "—"}</div>
        </div>
        <div>
          <div class="label">Age / Gender</div>
          <div class="value">${patient.age ? patient.age + " yrs" : "—"} / ${patient.gender || "—"}</div>
        </div>
        <div>
          <div class="label">Contact</div>
          <div class="value">${patient.contactNumber || order.contactNumber || "—"}</div>
        </div>
        <div>
          <div class="label">Referring Doctor</div>
          <div class="value">${doctorName}</div>
        </div>
        <div>
          <div class="label">Visit Type</div>
          <div class="value">${order.visitType || "—"}</div>
        </div>
        <div>
          <div class="label">Payment</div>
          <div class="value">${order.paymentType}${order.tpaName ? ` — ${order.tpaName}` : ""}</div>
        </div>
        <div>
          <div class="label">Clinical Note</div>
          <div class="value">${order.doctorNote || "—"}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Test Name</th>
            <th>Where</th>
            <th>Sample</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="4">Total</td>
            <td>₹${(order.totalAmount || 0).toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        <span>Printed: ${new Date().toLocaleString("en-IN")}</span>
        <span>Internal: ${order.internalTestsCount || 0} | External: ${order.externalTestsCount || 0}</span>
      </div>

      <script>window.onload = () => { window.print(); }</script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=800,height=600");
  win.document.write(html);
  win.document.close();
};

export const printReport = (order) => {
  const patient = order.patientId || {};
  const doctor = order.doctorId || {};
  const doctorName = doctor.personalInfo
    ? `Dr. ${doctor.personalInfo.firstName || ""} ${doctor.personalInfo.lastName || ""}`.trim()
    : order.doctorName || "—";

  const testSections = (order.items || [])
    .map((item) => {
      const resultRows = (item.results || [])
        .map(
          (r) => `
      <tr>
        <td>${r.parameterName}</td>
        <td style="font-weight:bold; color:${r.isAbnormal ? "#dc2626" : "#222"}">${r.value}${r.isAbnormal ? " ⚠" : ""}</td>
        <td>${r.unit || "—"}</td>
        <td>${r.normalRange || "—"}</td>
        <td>${r.isAbnormal ? '<span style="color:#dc2626;font-weight:bold">Abnormal</span>' : '<span style="color:#16a34a">Normal</span>'}</td>
      </tr>
    `,
        )
        .join("");

      const hasResults = item.results && item.results.length > 0;

      return `
      <div class="test-section">
        <div class="test-header">
          <span>${item.investigationName}</span>
          <span class="test-code">${item.investigationCode || ""}</span>
          ${
            item.performedAt === "EXTERNAL"
              ? `<span class="ext-badge">External — ${item.externalLabName || "Outside Lab"}</span>`
              : ""
          }
        </div>
        ${
          hasResults
            ? `
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Result</th>
                <th>Unit</th>
                <th>Normal Range</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>${resultRows}</tbody>
          </table>
        `
            : `<p class="no-result">Results not entered yet</p>`
        }
        ${item.interpretation ? `<div class="interpretation"><b>Interpretation:</b> ${item.interpretation}</div>` : ""}
        ${item.verifiedBy ? `<div class="verified-by">Verified by: <b>${item.verifiedBy}</b> on ${new Date(item.verifiedAt).toLocaleDateString("en-IN")}</div>` : ""}
        ${item.resultEnteredBy ? `<div class="entered-by">Results entered by: ${item.resultEnteredBy}</div>` : ""}
      </div>
    `;
    })
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Investigation Report — ${order.orderNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #0891b2; padding-bottom: 10px; margin-bottom: 14px; }
        .header h1 { font-size: 18px; color: #0891b2; }
        .header p  { font-size: 11px; color: #555; margin-top: 2px; }
        .report-title { font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 14px; color: #333; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 24px; margin-bottom: 14px; border: 1px solid #ddd; padding: 10px; border-radius: 6px; background: #f8fafc; }
        .info-grid .label { font-size: 10px; color: #666; }
        .info-grid .value { font-weight: bold; font-size: 12px; }
        .test-section { margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
        .test-header { background: #0891b2; color: white; padding: 7px 12px; display: flex; gap: 12px; align-items: center; font-weight: bold; font-size: 13px; }
        .test-code { font-size: 10px; opacity: 0.8; font-weight: normal; font-family: monospace; }
        .ext-badge { font-size: 10px; background: #fef3c7; color: #92400e; padding: 1px 8px; border-radius: 10px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #e0f7fa; color: #0e7490; padding: 6px 10px; text-align: left; font-size: 11px; }
        td { padding: 6px 10px; border-bottom: 1px solid #eee; font-size: 11px; }
        tr:nth-child(even) td { background: #f9f9f9; }
        .no-result { padding: 10px 12px; color: #888; font-style: italic; }
        .interpretation { padding: 6px 12px; background: #fffbeb; border-top: 1px solid #fde68a; font-size: 11px; }
        .verified-by { padding: 4px 12px; font-size: 10px; color: #16a34a; background: #f0fdf4; }
        .entered-by  { padding: 4px 12px; font-size: 10px; color: #666; }
        .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; display: flex; justify-content: space-between; font-size: 10px; color: #666; }
        .sign-area { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
        .sign-line { border-top: 1px solid #333; margin-bottom: 4px; }
        @media print {
          body { padding: 10px; }
          @page { margin: 10mm; }
          .test-section { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Spherehealth Medical Solutions</h1>
        <p>Laboratory Investigation Report</p>
      </div>

      <div class="report-title">INVESTIGATION REPORT</div>

      <div class="info-grid">
        <div>
          <div class="label">Patient Name</div>
          <div class="value">${patient.fullName || order.patientName || "—"}</div>
        </div>
        <div>
          <div class="label">UHID</div>
          <div class="value">${order.UHID || "—"}</div>
        </div>
        <div>
          <div class="label">Order No.</div>
          <div class="value">${order.orderNumber || "—"}</div>
        </div>
        <div>
          <div class="label">Age / Gender</div>
          <div class="value">${patient.age ? patient.age + " yrs" : "—"} / ${patient.gender || "—"}</div>
        </div>
        <div>
          <div class="label">Referring Doctor</div>
          <div class="value">${doctorName}</div>
        </div>
        <div>
          <div class="label">Order Date</div>
          <div class="value">${new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
        </div>
        <div>
          <div class="label">Clinical Note</div>
          <div class="value" style="grid-column:span 3">${order.doctorNote || "—"}</div>
        </div>
      </div>

      ${testSections}

      <div class="sign-area">
        <div>
          <div class="sign-line"></div>
          <div style="font-size:11px">Lab Technician</div>
        </div>
        <div>
          <div class="sign-line"></div>
          <div style="font-size:11px">Pathologist / Radiologist</div>
        </div>
      </div>

      <div class="footer">
        <span>Printed: ${new Date().toLocaleString("en-IN")}</span>
        <span>Order: ${order.orderNumber} | Patient: ${order.UHID}</span>
      </div>

      <script>window.onload = () => { window.print(); }</script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(html);
  win.document.close();
};
