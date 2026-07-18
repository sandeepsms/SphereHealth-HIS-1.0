// E2E driver — Flow 2: ER / Emergency end-to-end. Writes a markdown section to stdout.
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");
const num = (x) => Number(x?.$numberDecimal ?? x);

(async () => {
  const R = makeReport("2. ER / Emergency — register → ER visit(triage+MLC) → note → orders → vitals → triage → bill → discount → disposition → money paths → MLC → register → medical record");
  const ctx = {};
  try {
    // ── master lookups ──
    const docs = D(await call("admin", "GET", "/doctors?limit=5"));
    ctx.doctorId = docs[0]._id;
    ctx.doctorName = docs[0].personalInfo?.fullName || docs[0].fullName || docs[0].name || "Arjun Iyer";
    const consultant = /^dr\.?/i.test(ctx.doctorName) ? ctx.doctorName : `Dr. ${ctx.doctorName}`;
    const svc = await call("reception", "GET", "/services?search=consult&limit=10");
    const svcList = svc.data?.services || D(svc) || [];
    const erConsult = svcList.find((s) => /emergency|ER/i.test(s.serviceName || "")) || svcList[0];
    ctx.erConsultId = erConsult?._id; ctx.erConsultName = erConsult?.serviceName;
    R.t("Master lookups (doctor + ER consult service)", !!(ctx.doctorId && ctx.erConsultId),
      `doctor=${consultant}, consultSvc=${ctx.erConsultName}`);

    // 1. register Emergency patient (registrationType Emergency only bumps counter, no visit yet)
    const reg = await call("reception", "POST", "/patients", { registrationType: "Emergency", fullName: "ER Test Rao", title: "Mr.", gender: "Male", dateOfBirth: "1985-04-10", age: 40, contactNumber: "9876500011", paymentType: "Cash" });
    const p = D(reg); ctx.uhid = p?.UHID; ctx.patientId = p?._id;
    R.t("Register Emergency patient (short UHID)", reg.status === 201 && /^UH\d+/.test(ctx.uhid || ""), `UHID=${ctx.uhid}`);

    // 2. create ER visit with triage + MLC fields
    const er = await call("reception", "POST", "/emergency", {
      patientId: ctx.patientId, UHID: ctx.uhid, patientName: "ER Test Rao", age: 40, gender: "Male",
      contactNumber: "9876500011", arrivalMode: "Ambulance", triageCategory: "Emergency",
      consultantIncharge: consultant, presentingComplaints: "Chest pain and breathlessness x1 hour",
      isMLC: true,
    });
    const erv = D(er); ctx.emergencyNumber = erv?.emergencyNumber; ctx.visitId = erv?._id;
    R.t("Create ER visit (triage category + MLC flag, ER-YYYY-NNNNNN)", er.status === 201 && /^ER-\d{4}-\d+/.test(ctx.emergencyNumber || ""),
      `emergencyNumber=${ctx.emergencyNumber}, isMLC=${erv?.isMLC}`);

    // 3. ER doctor assessment note (noteType emergency) — MUST be Admin (NMC_REG credential gate)
    const note = await call("admin", "POST", "/doctor-notes", {
      patient: ctx.patientId, patientUHID: ctx.uhid, patientName: "ER Test Rao", noteType: "emergency", status: "draft",
      noteDetails: { emergency: { triageLevel: "Emergency", abcde: { airway: "Patent", breathing: "RR22 bilateral AE", circulation: "BP100/70 CRT<2s", disability: "GCS15", exposure: "No external injury" }, provisionalDiagnosis: "Acute coronary syndrome - rule out" } },
    });
    const nt = D(note); ctx.noteId = nt?._id;
    R.t("ER doctor assessment note saved (noteType emergency, as Admin)", note.status === 201 && nt?.noteType === "emergency", `noteId=${ctx.noteId ? "ok" : "MISSING"}, type=${nt?.noteType}`);

    // 4. STAT investigation order (as Admin)
    const ordInv = await call("admin", "POST", "/doctor-orders", { UHID: ctx.uhid, visitType: "Emergency", orderType: "Investigation", orderDetails: { testName: "Troponin-I, ECG, CBC" }, priority: "STAT" });
    const oi = D(ordInv);
    R.t("STAT investigation order placed (as Admin)", ordInv.status === 201 && oi?.orderType === "Investigation", `order=${oi?._id ? "ok" : "MISSING"}, priority=${oi?.priority}`);

    // 5. STAT medication order (as Admin)
    const ordMed = await call("admin", "POST", "/doctor-orders", { UHID: ctx.uhid, visitType: "Emergency", orderType: "Medication", orderDetails: { medicineName: "Aspirin 300mg", dose: "300mg", route: "PO", frequency: "STAT" }, priority: "STAT" });
    const om = D(ordMed);
    R.t("STAT medication order placed (as Admin)", ordMed.status === 201 && om?.orderType === "Medication", `order=${om?._id ? "ok" : "MISSING"}`);

    // 6. nurse records vitals
    const vit = await call("nurse", "POST", `/emergency/${ctx.emergencyNumber}/vitals`, { pulse: 104, bloodPressure: "110/72", oxygenSaturation: 96, respiratoryRate: 20, temperature: 98.4, painScore: 3 });
    const vd = D(vit);
    R.t("ER vitals recorded (Nurse)", vit.status === 200 && (vit.data?.success !== false) && (vd?.vitalsLog?.length > 0 || vd?.vitals), `status=${vit.status}, vitalsLog=${vd?.vitalsLog?.length ?? "n/a"}`);

    // 7. nurse re-triages to Critical
    const tri = await call("nurse", "PUT", `/emergency/${ctx.emergencyNumber}/triage`, { triageCategory: "Critical" });
    const td = D(tri);
    R.t("ER re-triage to Critical (Nurse, NABH triage register)", tri.status === 200 && td?.triageCategory === "Critical", `triage=${td?.triageCategory}`);

    // 8. billing create (EMERGENCY → auto ER-TRIAGE ₹500 line)
    const bc = await call("reception", "POST", "/billing/create", { UHID: ctx.uhid, visitType: "EMERGENCY", admissionId: ctx.visitId });
    const bill0 = D(bc); ctx.billId = bill0?._id;
    const hasTriage = (bill0?.billItems || []).some((it) => /TRIAGE|triage/i.test(it.serviceCode || it.serviceName || ""));
    R.t("Create EMERGENCY bill (auto ER-TRIAGE ₹500 line)", (bc.status === 200 || bc.status === 201) && !!ctx.billId && hasTriage,
      `bill=${ctx.billId ? "ok" : "MISSING"}, triageLine=${hasTriage}, gross=${num(bill0?.grossAmount ?? bill0?.totalAmount)}`);

    // 9. add ER consult service line
    const addSvc = await call("reception", "POST", `/billing/${ctx.billId}/add-service`, { serviceId: ctx.erConsultId, quantity: 1, addedBySource: "Reception", remarks: "ER physician consult" });
    const billAfter = D(addSvc);
    const hasConsult = (billAfter?.billItems || []).some((it) => String(it.serviceId?._id || it.serviceId) === String(ctx.erConsultId) || it.serviceName === ctx.erConsultName);
    R.t("Add ER consult service line to bill", addSvc.status === 200 && hasConsult, `${ctx.erConsultName} added`);

    // 10. generate → DRAFT→GENERATED (mint bill number)
    const gen = await call("reception", "POST", `/billing/${ctx.billId}/generate`, {});
    const genBill = D(gen);
    R.t("Generate invoice (mint bill number, →GENERATED)", gen.status === 200 && /^BILL-\d{2}-/.test(genBill?.billNumber || "") && genBill?.billStatus === "GENERATED", `billNo=${genBill?.billNumber}, balance=${num(genBill?.balanceAmount)}`);

    // 11. settlement-adjust discount as Accountant (while GENERATED)
    const netBefore = num(genBill?.netAmount ?? genBill?.balanceAmount);
    const disc = await call("accountant", "POST", `/billing/${ctx.billId}/settlement-adjust`, { extraDiscount: 50, extraDiscountReason: "ER goodwill concession", reason: "Settlement discount" });
    const discBill = D(disc);
    const netAfter = num(discBill?.netAmount ?? discBill?.balanceAmount);
    R.t("Settlement discount ₹50 (Accountant, while GENERATED)", disc.status === 200 && (disc.data?.success !== false) && netAfter <= netBefore, `net ${netBefore}→${netAfter}`);

    // 12. disposition Discharged as Admin
    const disp = await call("admin", "PUT", `/emergency/${ctx.emergencyNumber}/disposition`, { disposition: "Discharged", dischargeInstructions: "Rest, cardiology OPD review in 3 days, return if pain recurs", actor: consultant });
    const dd = D(disp);
    R.t("ER disposition Discharged → visit Completed (Admin)", disp.status === 200 && dd?.disposition === "Discharged" && ["Completed", "Discharged"].includes(dd?.status), `disposition=${dd?.disposition}, status=${dd?.status}`);

    // 13. advance deposit
    const adv = await call("reception", "POST", "/billing/advance", { UHID: ctx.uhid, amount: 200, paymentMode: "CASH", remarks: "ER advance deposit" });
    ctx.advanceId = D(adv)?._id;
    const advAmt = num(D(adv)?.amount);
    R.t("Advance deposit recorded (₹200)", adv.status === 201 && advAmt === 200, `advanceId=${ctx.advanceId ? "ok" : "MISSING"}, amount=₹${advAmt}`);

    // 14. apply PART of advance to bill (leave an unspent remainder to refund later)
    let balance = num(D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount ?? genBill?.balanceAmount ?? 0);
    const applyAmt = Math.min(100, balance);
    const apply = await call("reception", "POST", `/billing/advance/${ctx.advanceId}/apply`, { billId: ctx.billId, amount: applyAmt });
    R.t("Apply advance to ER bill", apply.status === 200 && (apply.data?.success !== false), `applied ₹${applyAmt}`);
    balance = num(D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount ?? balance);

    // 15. full payment → PAID
    const pay = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: balance, paymentMode: "CASH", remarks: "ER final settlement" });
    const pb = D(pay);
    R.t("Full payment → bill PAID, balance 0", pay.status === 200 && pb?.billStatus === "PAID" && num(pb?.balanceAmount) === 0, `paid ₹${balance}, status=${pb?.billStatus}`);

    // 16. advance refund (cross-actor: Accountant, avoids SoD SAME_ACTOR)
    const advRef = await call("accountant", "POST", `/billing/advance/${ctx.advanceId}/refund`, { refundReason: "Patient discharged, deposit unused", mode: "CASH" });
    const ar = D(advRef);
    R.t("Advance refund (cross-actor SoD)", advRef.status === 200 && ["REFUNDED", "PARTIALLY_REFUNDED", "APPLIED"].includes(ar?.status), `status=${ar?.status}, refunded=${num(ar?.refundedAmount)}`);

    // 17. bill-level PARTIAL refund of a PAID bill → deliberately guarded
    const billRef = await call("accountant", "POST", `/billing/${ctx.billId}/refund`, { amount: 50, reason: "Service not rendered", mode: "CASH", reasonCode: "REFUND" });
    const guarded = billRef.status === 400 && billRef.data?.code === "PARTIAL_REFUND_OF_PAID_BLOCKED";
    R.t("Bill partial-refund of PAID correctly guarded (→ Credit Note)", guarded, guarded ? "clear 400 PARTIAL_REFUND_OF_PAID_BLOCKED (no phantom due)" : `status=${billRef.status}: ${JSON.stringify(billRef.data).slice(0, 140)}`);

    // 18. NABH emergency register
    const regsRes = await call("admin", "GET", `/registers/nabh/emergency?UHID=${ctx.uhid}`);
    const regRows = D(regsRes) || [];
    const rowsArr = Array.isArray(regRows) ? regRows : (regRows.rows || regRows.data || []);
    const hasRow = rowsArr.some((r) => r.emergencyNumber === ctx.emergencyNumber);
    R.t("NABH emergency register shows this ER visit", regsRes.status === 200 && hasRow, `rows=${rowsArr.length}, match=${hasRow}`);

    // 19. MLC report (as Admin, doctorId required)
    const mlc = await call("admin", "POST", "/mlc", { doctorId: ctx.doctorId, UHID: ctx.uhid, patientId: ctx.patientId, patientName: "ER Test Rao", incidentType: "RTA", allegedHistory: "Road traffic accident, brought by ambulance", broughtBy: "Ambulance" });
    const md = D(mlc);
    R.t("MLC report created (Admin, doctor-prefixed MLR number)", mlc.status === 201 && !!md?.mlrNumber, `mlrNumber=${md?.mlrNumber}`);

    // 20. ER medical record readable (frontend discharge print source)
    const rec = await call("admin", "GET", `/emergency/${ctx.emergencyNumber}`);
    const rd = D(rec);
    R.t("ER medical record readable (disposition + instructions populated)", rec.status === 200 && rd?.disposition === "Discharged" && !!rd?.dischargeInstructions, `disposition=${rd?.disposition}, instr=${rd?.dischargeInstructions ? "ok" : "MISSING"}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
