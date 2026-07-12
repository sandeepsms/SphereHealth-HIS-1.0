// E2E driver — Flow 1: OPD end-to-end. Writes a markdown section to stdout.
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");

(async () => {
  const R = makeReport("1. OPD Flow — register → consult → bill → services → advance → collect → refund → lab → Rx → pharmacy → medical record");
  const ctx = {};
  try {
    // ── master lookups ──
    const docs = D(await call("admin", "GET", "/doctors"));
    ctx.doctorId = docs[0]._id;
    ctx.doctorName = docs[0].personalInfo?.fullName || docs[0].fullName || docs[0].name;
    const svcProc = await call("admin", "GET", "/services?category=PROCEDURE&limit=30");
    const procList = svcProc.data?.services || D(svcProc) || [];
    ctx.procServiceId = procList[0]._id; ctx.procName = procList[0].serviceName;
    const invs = D(await call("admin", "GET", "/investigations"));
    ctx.investigationId = invs[0]._id; ctx.testName = invs[0].investigationName;
    const stock = D(await call("pharmacy", "GET", "/pharmacy/stock"));
    const stk = (Array.isArray(stock) ? stock : []).find((x) => (x.totalRemaining || x.remaining || 0) > 5) || stock[0];
    ctx.drugId = stk.drugId || stk._id; ctx.drugName = stk.drugName || stk.name;
    R.t("Master lookups (doctor, procedure svc, investigation, stocked drug)", !!(ctx.doctorId && ctx.procServiceId && ctx.investigationId && ctx.drugId),
      `doctor=${ctx.doctorName}, svc=${ctx.procName}, test=${ctx.testName}, drug=${ctx.drugName}`);

    // 1. register OPD patient (auto OPD visit + draft consult bill)
    const reg = await call("reception", "POST", "/patients", { registrationType: "OPD", fullName: "Ramesh Kumar", title: "Mr.", gender: "Male", age: 42, contactNumber: "9812300011", doctor: ctx.doctorId, paymentType: "Cash", chiefComplaint: "Fever and cough x3 days" });
    const p = D(reg); ctx.uhid = p?.UHID; ctx.patientId = p?._id;
    R.t("Register OPD patient (short UHID + auto OPD visit + draft consult bill)", reg.status === 201 && /^UH\d+/.test(ctx.uhid || ""), `UHID=${ctx.uhid}`);

    // 2. fetch OPD visit
    const opd = D(await call("reception", "GET", `/opd/patient/${ctx.patientId}`));
    ctx.visitNumber = (Array.isArray(opd) ? opd[0] : opd)?.visitNumber;
    R.t("Auto-created OPD visit (short OPD-YY-NN)", /^OPD-\d{2}-\d+/.test(ctx.visitNumber || ""), `visit=${ctx.visitNumber}`);

    // 3. fetch auto draft bill
    const bw = D(await call("reception", "GET", `/billing/uhid/${ctx.uhid}`));
    const bill0 = (bw?.bills || [])[0];
    ctx.billId = bill0?._id; ctx.admissionId = bill0?.admission;
    R.t("Auto OPD consultation bill (DRAFT, OPD-CON line)", !!ctx.billId && bill0?.billStatus === "DRAFT", `bill status=${bill0?.billStatus}, gross=${bill0?.grossAmount ?? bill0?.totalAmount}`);

    // 4. doctor consult note (as Admin to bypass own-visit guard)
    const asmt = await call("admin", "POST", `/opd/${ctx.visitNumber}/assessment`, { doctorName: ctx.doctorName, chiefComplaint: "Fever x3 days, dry cough", provisionalDiagnosis: "Acute viral upper respiratory infection", advice: "Rest, oral fluids, review in 5 days" });
    R.t("Doctor consultation note saved", asmt.status === 200 && (asmt.data?.success !== false), `status=${asmt.status}`);

    // 5. add extra service line
    const addSvc = await call("reception", "POST", `/billing/${ctx.billId}/add-service`, { serviceId: ctx.procServiceId, quantity: 1, remarks: "Wound dressing", addedBySource: "Reception" });
    const billAfterSvc = D(addSvc);
    const hasSvc = (billAfterSvc?.billItems || []).some((it) => String(it.serviceId?._id || it.serviceId) === String(ctx.procServiceId) || it.serviceName === ctx.procName);
    R.t("Add extra chargeable service to OPD bill", addSvc.status === 200 && hasSvc, `${ctx.procName} added`);

    // 6. generate (finalize) bill → mints bill number
    const gen = await call("reception", "POST", `/billing/${ctx.billId}/generate`, {});
    const genBill = D(gen);
    R.t("Generate invoice (mint bill number, DRAFT→GENERATED)", gen.status === 200 && /^BILL-\d{2}-/.test(genBill?.billNumber || "") && genBill?.billStatus === "GENERATED", `billNo=${genBill?.billNumber}, balance=${genBill?.balanceAmount}`);

    // 7. advance deposit
    const adv = await call("reception", "POST", "/billing/advance", { UHID: ctx.uhid, amount: 500, paymentMode: "CASH", remarks: "OPD advance deposit" });
    ctx.advanceId = D(adv)?._id;
    const advAmt = Number(D(adv)?.amount?.$numberDecimal ?? D(adv)?.amount);
    R.t("Advance deposit recorded (₹500)", adv.status === 201 && advAmt === 500, `advanceId=${ctx.advanceId ? "ok" : "MISSING"}, amount=₹${advAmt}`);

    // read live balance
    let balance = D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount ?? genBill?.balanceAmount ?? 0;

    // 8. apply advance to bill
    const applyAmt = Math.min(200, balance);
    const apply = await call("reception", "POST", `/billing/advance/${ctx.advanceId}/apply`, { billId: ctx.billId, amount: applyAmt });
    R.t("Apply advance to bill", apply.status === 200 && (apply.data?.success !== false), `applied ₹${applyAmt}`);
    balance = D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount ?? balance;

    // 9. partial payment
    const partAmt = Math.max(1, Math.min(100, balance - 1));
    const pay1 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: partAmt, paymentMode: "CASH", remarks: "Partial collection" });
    const b1 = D(pay1);
    const rec1 = (b1?.payments || []).slice(-1)[0]?.receiptNumber;
    R.t("Partial payment collection (receipt REC-series)", pay1.status === 200 && b1?.billStatus === "PARTIAL" && /^REC-/.test(rec1 || ""), `paid ₹${partAmt}, status=${b1?.billStatus}, receipt=${rec1}`);
    balance = D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount ?? 0;

    // 10. final payment
    const pay2 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: balance, paymentMode: "UPI", transactionId: `UPI-OPD-${Date.now()}`, remarks: "Final settlement" });
    const b2 = D(pay2);
    R.t("Full payment → bill PAID, balance 0", pay2.status === 200 && b2?.billStatus === "PAID" && (b2?.balanceAmount ?? 1) === 0, `final ₹${balance}, status=${b2?.billStatus}`);

    // 11. advance refund (different actor — Accountant, avoids SAME_ACTOR)
    const advRef = await call("accountant", "POST", `/billing/advance/${ctx.advanceId}/refund`, { refundReason: "Unused OPD advance returned to patient", mode: "CASH" });
    const ar = D(advRef);
    const arAmt = Number(ar?.refundedAmount?.$numberDecimal ?? ar?.refundedAmount);
    R.t("Advance refund (unspent balance, cross-actor SoD)", advRef.status === 200 && ["REFUNDED", "PARTIALLY_REFUNDED"].includes(ar?.status), `status=${ar?.status}, refunded=₹${arAmt}`);

    // 12. bill-level partial refund of a fully-PAID bill → must be GUARDED
    // (would resurrect a phantom receivable). Correct behaviour = clear 400
    // pointing to Credit Note / full refund. A working money-back refund is
    // already proven by the advance refund above (step 11) and the full bill
    // refund in the SERVICES flow.
    const billRef = await call("accountant", "POST", `/billing/${ctx.billId}/refund`, { amount: 50, reason: "Service not rendered", mode: "CASH", reasonCode: "REFUND" });
    const guarded = billRef.status === 400 && billRef.data?.code === "PARTIAL_REFUND_OF_PAID_BLOCKED";
    R.t("Bill partial-refund of PAID correctly guarded (→ Credit Note)", guarded, guarded ? "clear 400 PARTIAL_REFUND_OF_PAID_BLOCKED (no phantom due)" : `status=${billRef.status}: ${JSON.stringify(billRef.data).slice(0,140)}`);

    // 14/16. lab order (use direct /investigation-orders for deterministic ids)
    const ord = await call("doctor", "POST", "/investigation-orders", { patientId: ctx.patientId, UHID: ctx.uhid, patientName: "Ramesh Kumar", contactNumber: "9812300011", visitType: "OPD", doctorId: ctx.doctorId, doctorName: ctx.doctorName, paymentType: "CASH", items: [{ investigationId: ctx.investigationId }] });
    const o = D(ord); ctx.orderId = o?._id; ctx.orderItemId = o?.items?.[0]?._id;
    R.t("Lab investigation ordered", ord.status === 201 && ctx.orderId && o?.orderStatus === "PENDING", `order=${ctx.orderId ? "ok" : "MISSING"}, test=${ctx.testName}`);

    // 17. collect sample
    const coll = await call("lab", "POST", `/investigation-orders/${ctx.orderId}/collect-sample`, { collectedBy: "Lab Tech" });
    R.t("Sample collected", coll.status === 200 && D(coll)?.orderStatus === "SAMPLE_COLLECTED", `status=${D(coll)?.orderStatus}`);

    // 18. enter results
    const res = await call("lab", "POST", `/investigation-orders/${ctx.orderId}/enter-results`, { enteredBy: "Lab Tech", itemResults: [{ itemId: ctx.orderItemId, results: [{ parameterName: "Hemoglobin", value: "13.5", unit: "g/dL", normalRange: "13-17", isAbnormal: false }], interpretation: "Within normal limits" }] });
    R.t("Lab results entered → order COMPLETED", res.status === 200 && D(res)?.orderStatus === "COMPLETED", `status=${D(res)?.orderStatus}`);

    // 19. verify
    const ver = await call("doctor", "POST", `/investigation-orders/${ctx.orderId}/verify`, { verifiedBy: ctx.doctorName });
    R.t("Report verified (doctor sign-off, FINAL)", ver.status === 200 && (D(ver)?.items?.[0]?.resultStatus === "VERIFIED"), `status=${ver.status}`);

    // 20. print
    const prn = await call("lab", "POST", `/investigation-orders/${ctx.orderId}/print`, {});
    R.t("Lab report generated / printable", prn.status === 200 && (prn.data?.success !== false), `status=${prn.status}`);

    // 21. OPD prescription
    const rx = await call("admin", "POST", `/opd/${ctx.visitNumber}/prescription`, { medicineName: ctx.drugName, dosage: "1 tab", frequency: "OD", duration: "5 days", instructions: "After food", mealStatus: "After food" });
    R.t("OPD prescription written (→ pharmacy handoff)", rx.status === 200 && (rx.data?.success !== false), `Rx ${ctx.drugName}`);

    // 22. pharmacy OPD sale/dispense
    const sale = await call("pharmacy", "POST", "/pharmacy/sales", { saleType: "OPD", patientUHID: ctx.uhid, patientName: "Ramesh Kumar", contactNumber: "9812300011", doctorName: ctx.doctorName, prescriberName: ctx.doctorName, prescriberRegistrationNo: "MCI-DEMO-001", prescriptionRef: ctx.visitNumber, paymentMode: "Cash", amountPaid: 0, items: [{ drugId: ctx.drugId, quantity: 5, drugName: ctx.drugName }] });
    const sd = D(sale);
    R.t("Pharmacy OPD dispense (FEFO batch, GST invoice)", sale.status === 201 && sd?.billNumber, sale.status === 201 ? `pharmacyBill=${sd?.billNumber}, total=${sd?.grandTotal}` : `status=${sale.status}: ${JSON.stringify(sale.data).slice(0, 120)}`);

    // 23. complete OPD visit
    const done = await call("admin", "PUT", `/opd/${ctx.visitNumber}/complete`, {});
    R.t("OPD visit completed", done.status === 200 && D(done)?.status === "Completed", `status=${D(done)?.status}`);

    // 24. medical record (complete file)
    const file = await call("doctor", "GET", `/patient-file/${ctx.uhid}/complete`);
    R.t("OPD medical record / complete file readable", file.status === 200 && (file.data?.success !== false), `status=${file.status}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
