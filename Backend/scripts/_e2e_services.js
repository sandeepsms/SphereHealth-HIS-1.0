// E2E driver — Flow 3: SERVICES walk-in end-to-end. Writes a markdown section to stdout.
// A walk-in who only buys services (injection + dressing), no OPD consult, no admission.
// Demonstrates a CLEAN FULL cash-bill refund (PAID→REFUNDED) and a full advance refund.
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");

const num = (x) => Number(x?.$numberDecimal ?? x);

(async () => {
  const R = makeReport("3. SERVICES walk-in — register → bill → +injection +dressing → generate → advance → pay(partial+final→PAID) → FULL bill refund(→REFUNDED) → advance refund(→REFUNDED) → print audit → readback");
  const ctx = {};
  try {
    // ── master lookups: find injection + dressing services ──
    const injSearch = await call("reception", "GET", "/services?search=injection&limit=5");
    const injList = injSearch.data?.services || D(injSearch) || [];
    const inj = injList.find((s) => s.serviceCode === "NRS-INJ") || injList[0];
    ctx.injId = inj?._id; ctx.injName = inj?.serviceName; ctx.injPrice = num(inj?.defaultPrice);

    const dreSearch = await call("reception", "GET", "/services?search=dressing&limit=5");
    const dreList = dreSearch.data?.services || D(dreSearch) || [];
    const dre = dreList.find((s) => s.serviceCode === "NRS-004") || dreList[0];
    ctx.dreId = dre?._id; ctx.dreName = dre?.serviceName; ctx.drePrice = num(dre?.defaultPrice);

    R.t("Master lookups (injection + dressing services)", !!(ctx.injId && ctx.dreId),
      `inj=${ctx.injName}(₹${ctx.injPrice}), dressing=${ctx.dreName}(₹${ctx.drePrice})`);

    // 1. register SERVICES walk-in patient (plural "Services")
    const reg = await call("reception", "POST", "/patients", { registrationType: "Services", title: "Mr.", fullName: "Walkin Service Patient", gender: "Male", contactNumber: "9800000001", paymentType: "GENERAL" });
    const p = D(reg); ctx.uhid = p?.UHID; ctx.patientId = p?._id;
    R.t("Register SERVICES walk-in patient (short UHID)", reg.status === 201 && /^UH\d+/.test(ctx.uhid || ""), `UHID=${ctx.uhid}`);

    // 2. create SERVICE bill (visitType SERVICE)
    const bc = await call("reception", "POST", "/billing/create", { UHID: ctx.uhid, visitType: "SERVICE" });
    const bill0 = D(bc); ctx.billId = bill0?._id;
    R.t("Create SERVICE bill (DRAFT, visitType SERVICE, no bill number yet)", bc.status === 200 && !!ctx.billId && bill0?.billStatus === "DRAFT" && bill0?.visitType === "SERVICE" && bill0?.billNumber == null, `billId=${ctx.billId ? "ok" : "MISSING"}, status=${bill0?.billStatus}, visitType=${bill0?.visitType}`);

    // 3. add injection service
    const add1 = await call("reception", "POST", `/billing/${ctx.billId}/add-service`, { serviceId: ctx.injId, quantity: 1, addedBySource: "Reception", remarks: "Injection" });
    const a1 = D(add1);
    R.t("Add service #1 (injection) to DRAFT bill", add1.status === 200 && (a1?.billItems || []).length === 1, `items=${(a1?.billItems || []).length}, net=₹${num(a1?.billItems?.[0]?.netAmount)}, orderStatus=${a1?.billItems?.[0]?.orderStatus}`);

    // 4. add dressing service
    const add2 = await call("reception", "POST", `/billing/${ctx.billId}/add-service`, { serviceId: ctx.dreId, quantity: 1, addedBySource: "Reception", remarks: "Dressing" });
    const a2 = D(add2);
    R.t("Add service #2 (dressing) to DRAFT bill", add2.status === 200 && (a2?.billItems || []).length === 2, `items=${(a2?.billItems || []).length} (running payable ₹300)`);

    // 5. advance deposit ₹500 (general UHID pool — NOT applied to this bill)
    const adv = await call("reception", "POST", "/billing/advance", { UHID: ctx.uhid, amount: 500, paymentMode: "CASH", remarks: "Walk-in service advance" });
    const ad = D(adv); ctx.advanceId = ad?._id; ctx.advReceipt = ad?.receiptNumber;
    R.t("Advance deposit recorded (₹500 pool, ACTIVE)", adv.status === 201 && !!ctx.advanceId && ad?.status === "ACTIVE" && num(ad?.amount) === 500, `advanceId=${ctx.advanceId ? "ok" : "MISSING"}, receipt=${ctx.advReceipt}, amount=₹${num(ad?.amount)}`);

    // 6. generate (finalize) bill → mints bill number, DRAFT→GENERATED, payable 300
    const gen = await call("reception", "POST", `/billing/${ctx.billId}/generate`, {});
    const gb = D(gen); ctx.billNumber = gb?.billNumber;
    const payable = num(gb?.patientPayableAmount);
    R.t("Generate invoice (mint BILL number, DRAFT→GENERATED, payable ₹300)", gen.status === 200 && /^BILL-\d{2}-/.test(ctx.billNumber || "") && gb?.billStatus === "GENERATED" && payable === 300, `billNo=${ctx.billNumber}, status=${gb?.billStatus}, payable=₹${payable}, balance=₹${num(gb?.balanceAmount)}`);

    // 7. PURE CASH — partial payment ₹100 (advance deliberately NOT applied)
    const pay1 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: 100, paymentMode: "CASH", remarks: "Partial cash" });
    const b1 = D(pay1);
    const rec1 = (b1?.payments || []).slice(-1)[0]?.receiptNumber;
    R.t("Partial cash payment ₹100 → PARTIAL (receipt minted)", pay1.status === 200 && num(b1?.balanceAmount) === 200 && b1?.billStatus === "PARTIAL" && /^REC-/.test(rec1 || ""), `balance=₹${num(b1?.balanceAmount)}, status=${b1?.billStatus}, receipt=${rec1}`);

    // 8. final cash payment ₹200 → PAID, balance 0
    const pay2 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: 200, paymentMode: "CASH", remarks: "Final settlement" });
    const b2 = D(pay2);
    R.t("Final cash payment ₹200 → bill PAID, balance 0", pay2.status === 200 && num(b2?.balanceAmount) === 0 && b2?.billStatus === "PAID", `balance=₹${num(b2?.balanceAmount)}, status=${b2?.billStatus}, paidAt=${b2?.paidAt ? "set" : "unset"}`);

    // 9. print audit (client-side invoice → audit register)
    const pa = await call("reception", "POST", "/print-audit", { entityType: "Bill", entityId: ctx.billId, entityNumber: ctx.billNumber, UHID: ctx.uhid, patientName: "Walkin Service Patient", printSource: "client" });
    R.t("Print audit recorded (bill invoice printed)", (pa.status === 200 || pa.status === 201) && (pa.data?.success !== false), `status=${pa.status}`);

    // 10. FULL bill refund of the entire ₹300 cash collected, as Accountant (SoD: differs from cashier)
    //     Net collected → 0 ⇒ bill fully reversed ⇒ billStatus REFUNDED, balance 0.
    const billRef = await call("accountant", "POST", `/billing/${ctx.billId}/refund`, { amount: 300, reason: "Services not rendered — full reversal", mode: "CASH", reasonCode: "REFUND" });
    const br = D(billRef);
    R.t("FULL bill refund ₹300 (PAID→REFUNDED, cross-actor SoD)", billRef.status === 200 && br?.billStatus === "REFUNDED" && num(br?.balanceAmount) === 0, billRef.status === 200 ? `status=${br?.billStatus}, balance=₹${num(br?.balanceAmount)}` : `HTTP ${billRef.status}: ${JSON.stringify(billRef.data).slice(0, 140)}`);

    // 11. advance refund — full ₹500 unspent (none applied), as Accountant (SoD: differs from collector)
    const advRef = await call("accountant", "POST", `/billing/advance/${ctx.advanceId}/refund`, { refundReason: "Unused advance returned to patient", mode: "CASH" });
    const arf = D(advRef);
    R.t("Advance refund ₹500 (fully unspent → REFUNDED, cross-actor SoD)", advRef.status === 200 && arf?.status === "REFUNDED" && num(arf?.refundedAmount) === 500, advRef.status === 200 ? `status=${arf?.status}, refunded=₹${num(arf?.refundedAmount)}` : `HTTP ${advRef.status}: ${JSON.stringify(advRef.data).slice(0, 140)}`);

    // 12. final read-back: bill fully refunded (balance 0), advance summary fully unspent/refunded
    const fin = D(await call("reception", "GET", `/billing/${ctx.billId}`));
    const advSum = await call("reception", "GET", `/billing/advance/uhid/${ctx.uhid}`);
    const advSumD = D(advSum);
    const unspent = num(advSumD?.totalUnspent ?? advSumD?.data?.totalUnspent);
    R.t("Read-back: bill REFUNDED (balance 0) + advance summary (totalUnspent 0)", fin?.billStatus === "REFUNDED" && num(fin?.balanceAmount) === 0 && unspent === 0, `bill=${fin?.billStatus}, balance=₹${num(fin?.balanceAmount)}, payable=₹${num(fin?.patientPayableAmount)}, advUnspent=₹${unspent}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
