// E2E driver — Cross-cutting: Accounts / Cashier. Writes a markdown section to stdout.
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");
const crypto = require("crypto");

const num = (x) => Number(x?.$numberDecimal ?? x);
const uuid = () => crypto.randomUUID();

// call with an extra header (for Idempotency-Key on payments)
async function callH(role, method, path, body, extraHeaders) {
  const { login, BASE } = require("./_e2e_lib");
  const token = await login(role);
  const opts = { method, headers: { Authorization: `Bearer ${token}`, ...(extraHeaders || {}) } };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, opts);
  let data; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

(async () => {
  const R = makeReport("Cross-cutting: Accounts / Cashier");
  const ctx = {};
  try {
    const today = new Date().toISOString().slice(0, 10);           // YYYY-MM-DD
    const period = today.slice(0, 7);                              // YYYY-MM

    // ── master lookups: a chargeable service ──
    const svcRes = await call("accountant", "GET", "/billing/nurse-services");
    const svcList = D(svcRes) || [];
    ctx.serviceId = (svcList[0] || {})._id;
    ctx.serviceName = (svcList[0] || {}).serviceName || (svcList[0] || {}).name;
    R.t("Master lookup: chargeable nurse-service", !!ctx.serviceId, `svc=${ctx.serviceName} (${ctx.serviceId ? "ok" : "MISSING"})`);

    // 1. register a Services patient (reception)
    const reg = await call("reception", "POST", "/patients", { registrationType: "Services", fullName: "Cash Test Patient", gender: "Male", age: 40, contactNumber: "9990001111", paymentType: "GENERAL" });
    const p = D(reg); ctx.uhid = p?.UHID; ctx.patientId = p?._id;
    R.t("Register Services patient", reg.status === 201 && /^UH/.test(ctx.uhid || ""), `UHID=${ctx.uhid}`);

    // 2. create SERVICE bill
    const create = await call("accountant", "POST", "/billing/create", { UHID: ctx.uhid, visitType: "SERVICE" });
    ctx.billId = D(create)?._id;
    R.t("Create SERVICE bill", create.status === 200 && !!ctx.billId, `billId=${ctx.billId ? "ok" : "MISSING"}`);

    // 3. add-service
    const addSvc = await call("accountant", "POST", `/billing/${ctx.billId}/add-service`, { serviceId: ctx.serviceId, quantity: 1, addedBySource: "Reception" });
    const items = D(addSvc)?.billItems || [];
    R.t("Add chargeable service line", addSvc.status === 200 && items.length >= 1, `${items.length} line(s), ${ctx.serviceName}`);

    // 4. generate → read payable
    const gen = await call("accountant", "POST", `/billing/${ctx.billId}/generate`, {});
    const genBill = D(gen);
    ctx.payable = num(genBill?.balanceAmount ?? genBill?.netAmount);
    R.t("Generate invoice (mint bill number, read payable)", gen.status === 200 && /^BILL-\d{2}-/.test(genBill?.billNumber || "") && ctx.payable > 0, `billNo=${genBill?.billNumber}, payable=₹${ctx.payable}`);

    // 5. cashier current — close any pre-existing open shift for a clean start
    const cur = await call("accountant", "GET", "/cashier-sessions/current");
    const openSession = D(cur);
    if (openSession && openSession._id) {
      // a prior open shift exists — read its expected + close it out so we can open fresh
      const badClose = await call("accountant", "POST", `/cashier-sessions/${openSession._id}/close`, { closingCash: -1 });
      const exp = num(badClose.data?.meta?.expectedClosing ?? 0);
      await call("accountant", "POST", `/cashier-sessions/${openSession._id}/close`, { closingCash: exp, varianceNote: "auto-clear prior shift", closeNotes: "e2e cleanup" });
    }
    R.t("Cashier current session probe", cur.status === 200, openSession?._id ? "prior shift closed for clean start" : "no open shift (null)");

    // 6. open shift
    const open = await call("accountant", "POST", "/cashier-sessions/open", { openingCash: 1000, openNotes: "Morning drawer" });
    ctx.sessionId = D(open)?._id;
    R.t("Open cashier session (openingCash 1000)", open.status === 201 && D(open)?.status === "OPEN" && !!ctx.sessionId, `status=${D(open)?.status}, sessionId=${ctx.sessionId ? "ok" : "MISSING"}`);

    // 7. full payment → PAID, capture REC- receipt (Idempotency-Key header)
    const pay = await callH("accountant", "POST", `/billing/${ctx.billId}/payment`, { amount: ctx.payable, paymentMode: "CASH", remarks: "Full settlement" }, { "Idempotency-Key": uuid() });
    const pb = D(pay);
    ctx.receiptNumber = (pb?.payments || []).slice(-1)[0]?.receiptNumber;
    R.t("Collect full CASH payment → PAID (REC- receipt)", pay.status === 200 && pb?.billStatus === "PAID" && /^REC-\d{2}-/.test(ctx.receiptNumber || ""), `status=${pb?.billStatus}, receipt=${ctx.receiptNumber}`);

    // 8. advance deposit (CASH, lands in this shift)
    const adv = await call("accountant", "POST", "/billing/advance", { UHID: ctx.uhid, amount: 1000, paymentMode: "CASH", remarks: "IPD advance" });
    const av = D(adv);
    ctx.advanceId = av?._id;
    R.t("Advance CASH deposit (₹1000, ADV- receipt)", adv.status === 201 && /^ADV-2026-/.test(av?.receiptNumber || ""), `receipt=${av?.receiptNumber}, amount=₹${num(av?.amount)}`);

    // 9. close #1 with a deliberately-wrong closingCash → 400 variance-note gate; READ expectedClosing
    const close1 = await call("accountant", "POST", `/cashier-sessions/${ctx.sessionId}/close`, { closingCash: 0 });
    const expected = num(close1.data?.meta?.expectedClosing);
    const gate = close1.status === 400 && /varianceNote/i.test(JSON.stringify(close1.data || ""));
    R.t("Close blocked without varianceNote (variance-note gate)", gate && Number.isFinite(expected), `status=${close1.status}, expectedClosing=₹${expected}`);

    // 10. close #2 with closingCash = expected + 100 + varianceNote → CLOSED, variance≈100
    const closingCash = expected + 100;
    const close2 = await call("accountant", "POST", `/cashier-sessions/${ctx.sessionId}/close`, { closingCash, varianceNote: "Rs100 tip left in drawer", closeNotes: "EOD reconcile" });
    const c2 = D(close2);
    const variance = num(c2?.variance);
    R.t("Close with varianceNote → CLOSED (variance≈100, auto-approved)", close2.status === 200 && c2?.status === "CLOSED" && Math.abs(variance - 100) < 1 && c2?.closeApprovalPending === false, `status=${c2?.status}, variance=₹${variance}, pending=${c2?.closeApprovalPending}`);

    // 11. today-revenue
    const rev = await call("accountant", "GET", "/reports/today-revenue");
    R.t("Report: today-revenue", rev.status === 200 && D(rev) != null, `status=${rev.status}`);

    // 12. day-book
    const db = await call("accountant", "GET", `/reports/day-book?date=${today}`);
    R.t("Report: day-book", db.status === 200 && D(db) != null, `status=${db.status}`);

    // 13. daily-collection
    const dc = await call("accountant", "GET", `/reports/daily-collection?date=${today}`);
    R.t("Report: daily-collection", dc.status === 200 && D(dc) != null, `status=${dc.status}`);

    // 14. hospital-register
    const hr = await call("accountant", "GET", `/reports/hospital-register?from=${today}&to=${today}`);
    const hrData = D(hr);
    R.t("Report: hospital-register (summary)", hr.status === 200 && !!hrData?.summary, `billsGenerated=${hrData?.summary?.billsGenerated}, paid=${num(hrData?.summary?.paid)}`);

    // 15. gst-monthly
    const gm = await call("accountant", "GET", `/reports/gst-monthly?period=${period}`);
    R.t("Report: gst-monthly", gm.status === 200 && D(gm)?.period === period, `period=${D(gm)?.period}`);

    // 16. GSTR-1 preview
    const g1prev = await call("accountant", "POST", `/tax-returns/gstr1/preview`, { period });
    R.t("GSTR-1 preview", g1prev.status === 200 && !!D(g1prev)?.summary, `status=${g1prev.status}`);

    // 17. GSTR-1 generate → capture id
    const g1gen = await call("accountant", "POST", `/tax-returns/gstr1/generate`, { period });
    ctx.gstr1Id = D(g1gen)?._id;
    R.t("GSTR-1 generate (DRAFT)", g1gen.status === 201 && D(g1gen)?.filingStatus === "DRAFT" && !!ctx.gstr1Id, `filingStatus=${D(g1gen)?.filingStatus}, id=${ctx.gstr1Id ? "ok" : "MISSING"}`);

    // 18. GSTR-1 finalize
    const g1fin = await call("accountant", "PUT", `/tax-returns/${ctx.gstr1Id}/finalize`, {});
    R.t("GSTR-1 finalize (FINALIZED)", g1fin.status === 200 && D(g1fin)?.filingStatus === "FINALIZED", `filingStatus=${D(g1fin)?.filingStatus}`);

    // 19. GSTR-1 mark-filed with ARN
    const arn = "AA0107260000123";
    const g1file = await call("accountant", "PUT", `/tax-returns/${ctx.gstr1Id}/mark-filed`, { arn });
    R.t("GSTR-1 mark-filed (FILED, ARN)", g1file.status === 200 && D(g1file)?.filingStatus === "FILED" && D(g1file)?.arn === arn, `filingStatus=${D(g1file)?.filingStatus}, arn=${D(g1file)?.arn}`);

    // 20. GSTR-3B preview → generate → finalize
    const g3prev = await call("accountant", "POST", `/tax-returns/gstr3b/preview`, { period });
    const g3gen = await call("accountant", "POST", `/tax-returns/gstr3b/generate`, { period });
    ctx.gstr3bId = D(g3gen)?._id;
    const g3fin = ctx.gstr3bId ? await call("accountant", "PUT", `/tax-returns/${ctx.gstr3bId}/finalize`, {}) : { status: 0, data: null };
    R.t("GSTR-3B lifecycle (preview→generate→finalize)", g3prev.status === 200 && g3gen.status === 201 && D(g3gen)?.filingStatus === "DRAFT" && g3fin.status === 200 && D(g3fin)?.filingStatus === "FINALIZED", `gen=${g3gen.status}/${D(g3gen)?.filingStatus}, fin=${g3fin.status}/${D(g3fin)?.filingStatus}`);

    // 21. list tax returns filtered
    const list = await call("accountant", "GET", `/tax-returns?returnKind=GSTR-1`);
    const listArr = D(list) || [];
    const hasFiled = Array.isArray(listArr) && listArr.some((x) => String(x._id) === String(ctx.gstr1Id) || x.filingStatus === "FILED");
    R.t("List tax-returns (GSTR-1 filed present)", list.status === 200 && Array.isArray(listArr) && hasFiled, `count=${Array.isArray(listArr) ? listArr.length : "?"}`);

    // 22. bill refund as ADMIN (approverOverride, reasonCode REFUND) — cross-actor SoD.
    // A PARTIAL refund of a fully-PAID bill is deliberately blocked (would re-open a
    // phantom receivable) → 400. A FULL refund (net collected → ~0) => REFUNDED works
    // and books the negative CASH row. Refund the full collected amount (${payable}).
    const ref = await call("admin", "POST", `/billing/${ctx.billId}/refund`, { amount: ctx.payable, reason: "overcharge correction", mode: "CASH", reasonCode: "REFUND", approverOverride: true });
    const refBill = D(ref);
    const hasNeg = (refBill?.payments || []).some((pm) => num(pm.amount) < 0);
    R.t("Bill full refund as Admin (negative CASH row, REFUNDED)", ref.status === 200 && hasNeg, ref.status === 200 ? `status=${refBill?.billStatus}, negRow=${hasNeg}` : `status=${ref.status}: ${JSON.stringify(ref.data).slice(0, 120)}`);

    // 23. refunds report
    const refRep = await call("accountant", "GET", `/reports/refunds?from=${today}&to=${today}`);
    const totalRefunded = num(refRep.data?.meta?.totalRefunded);
    R.t("Report: refunds (totalRefunded ≥ 100)", refRep.status === 200 && totalRefunded >= 100, `totalRefunded=₹${totalRefunded}`);

    // 24. credit-notes
    const cn = await call("accountant", "GET", `/billing/credit-notes?from=${today}&to=${today}`);
    const cnArr = D(cn) || [];
    const cnMatch = Array.isArray(cnArr) && cnArr.find((x) => /^CN-2026-/.test(x.creditNoteNumber || ""));
    R.t("List credit-notes (CN-2026- present)", cn.status === 200 && Array.isArray(cnArr) && !!cnMatch, `count=${Array.isArray(cnArr) ? cnArr.length : "?"}, cn=${cnMatch?.creditNoteNumber || "none"}`);

    // 25. verify positive receipt row still present on bill
    const billFinal = await call("accountant", "GET", `/billing/${ctx.billId}`);
    const posRow = (D(billFinal)?.payments || []).find((pm) => pm.receiptNumber === ctx.receiptNumber);
    R.t("Bill retains positive REC- receipt row", billFinal.status === 200 && !!posRow && /^REC-\d{2}-/.test(posRow?.receiptNumber || ""), `receipt=${posRow?.receiptNumber || "MISSING"}`);

    // 26. sequence-audit
    const audit = await call("accountant", "GET", `/billing/sequence-audit?year=2026`);
    const ad = D(audit);
    R.t("Sequence-audit (REC-26- prefix, series present)", audit.status === 200 && ad?.receipts?.prefix === "REC-26-" && !!ad?.bills && !!ad?.advances && !!ad?.creditNotes, `recPrefix=${ad?.receipts?.prefix}, anyGaps=${ad?.anyGaps}`);

    // 27. cashier-sessions list — the closed shift
    const sessions = await call("accountant", "GET", `/cashier-sessions?from=${today}&to=${today}`);
    const sArr = D(sessions) || [];
    const mine = Array.isArray(sArr) && sArr.find((s) => String(s._id) === String(ctx.sessionId));
    R.t("List cashier-sessions (closed shift, variance≈100)", sessions.status === 200 && !!mine && mine.status === "CLOSED" && Math.abs(num(mine.variance) - 100) < 1, `status=${mine?.status}, variance=₹${num(mine?.variance)}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
