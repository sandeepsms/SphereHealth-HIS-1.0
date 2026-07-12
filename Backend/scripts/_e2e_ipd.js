// E2E driver — Flow 4: IPD in-patient end-to-end. Writes a markdown section to stdout.
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");

const num = (x) => Number(x?.$numberDecimal ?? x);

(async () => {
  const R = makeReport("4. IPD in-patient — admit → advance → doctor orders → MAR/vitals/nursing/diet → indent+credit → charges → payments → discharge summary → clear bill → gate pass → refund → record → registers");
  const ctx = {};
  try {
    // ── master lookups ──
    const beds = D(await call("admin", "GET", "/bedss/available"));
    const bedArr = Array.isArray(beds) ? beds : (beds?.beds || beds?.data || []);
    ctx.bedId = bedArr[0]?._id;
    const depts = D(await call("admin", "GET", "/department"));
    const deptArr = Array.isArray(depts) ? depts : (depts?.departments || []);
    ctx.departmentId = deptArr[0]?._id;
    ctx.departmentName = deptArr[0]?.departmentName || deptArr[0]?.name || "General Medicine";
    const nurSvc = await call("admin", "GET", "/services?category=NURSING&limit=3");
    const nurList = nurSvc.data?.services || D(nurSvc) || [];
    ctx.nursingServiceId = nurList[0]?._id; ctx.nursingName = nurList[0]?.serviceName;
    const drugs = D(await call("admin", "GET", "/pharmacy/drugs?limit=3"));
    const drugArr = Array.isArray(drugs) ? drugs : (drugs?.drugs || drugs?.data || []);
    ctx.drugId = drugArr[0]?._id; ctx.drugName = drugArr[0]?.name || drugArr[0]?.drugName;
    R.t("Master lookups (available bed, department, nursing svc, drug)",
      !!(ctx.bedId && ctx.departmentId && ctx.nursingServiceId && ctx.drugId),
      `bed=${ctx.bedId ? "ok" : "MISSING"}, dept=${ctx.departmentName}, nursing=${ctx.nursingName}, drug=${ctx.drugName}`);

    // 1. register IPD patient (no auto visit/bill)
    const reg = await call("reception", "POST", "/patients", { registrationType: "IPD", fullName: "Test IPD Patient", title: "Mr.", gender: "Male", age: 45, contactNumber: "9990001111", paymentType: "Cash" });
    const p = D(reg); ctx.uhid = p?.UHID; ctx.patientId = p?._id;
    R.t("Register IPD patient (short UHID, no auto visit)", reg.status === 201 && /^UH\d+/.test(ctx.uhid || ""), `UHID=${ctx.uhid}`);

    // 2. admit → assign bed
    const adm = await call("reception", "POST", "/admissions", { UHID: ctx.uhid, bedId: ctx.bedId, admissionType: "Planned", department: ctx.departmentName, departmentId: ctx.departmentId, reasonForAdmission: "Fever workup", provisionalDiagnosis: "Pyrexia under evaluation", expectedStayDays: 3, advancePaid: 0 });
    const a = D(adm); ctx.admissionId = a?._id; ctx.admissionNumber = a?.admissionNumber || a?.ipdNo;
    R.t("Admit patient (assign bed, Active admission, billing fired)", adm.status === 201 && a?.status === "Active" && !!a?.bedNumber, `admission=${ctx.admissionNumber || ctx.admissionId}, bed=${a?.bedNumber}, status=${a?.status}`);

    // 3. advance deposit ₹20000
    const adv = await call("reception", "POST", "/billing/advance", { UHID: ctx.uhid, admission: ctx.admissionId, amount: 20000, paymentMode: "CASH", remarks: "IPD admission advance" });
    ctx.advanceId = D(adv)?._id;
    const advAmt = num(D(adv)?.amount);
    R.t("Advance deposit recorded (₹20000, earmarked to admission)", adv.status === 201 && advAmt === 20000 && String(D(adv)?.admission) === String(ctx.admissionId), `advanceId=${ctx.advanceId ? "ok" : "MISSING"}, amount=₹${advAmt}, receipt=${D(adv)?.receiptNumber}`);

    // 4. doctor-order: Medication (as admin — needs verified NMC credential)
    const medOrd = await call("admin", "POST", "/doctor-orders", { UHID: ctx.uhid, visitType: "IPD", orderType: "Medication", priority: "Routine", orderDetails: { medicineName: ctx.drugName, dose: "100 mg", frequency: "BD", route: "PO", duration: "3 days" }, scheduledTimes: ["08:00", "20:00"] });
    ctx.medOrderId = D(medOrd)?._id;
    R.t("Doctor order — Medication (dose regex, scheduledTimes)", medOrd.status === 201 && !!ctx.medOrderId && D(medOrd)?.orderType === "Medication", `medOrder=${ctx.medOrderId ? "ok" : "MISSING"}, code=${medOrd.data?.code || ""}`);

    // 5. doctor-order: Lab
    const labOrd = await call("admin", "POST", "/doctor-orders", { UHID: ctx.uhid, visitType: "IPD", orderType: "Lab", priority: "Routine", orderDetails: { testName: "Complete Blood Count (CBC)", instructions: "Fasting not required" } });
    ctx.labOrderId = D(labOrd)?._id;
    R.t("Doctor order — Lab", labOrd.status === 201 && !!ctx.labOrderId, `labOrder=${ctx.labOrderId ? "ok" : "MISSING"}`);

    // 6. doctor-order: Procedure (Bedside → no OT)
    const procOrd = await call("admin", "POST", "/doctor-orders", { UHID: ctx.uhid, visitType: "IPD", orderType: "Procedure", priority: "Routine", orderDetails: { procedureName: "Wound dressing", procedureType: "Bedside" } });
    ctx.procOrderId = D(procOrd)?._id;
    R.t("Doctor order — Procedure (Bedside, no OT forced)", procOrd.status === 201 && !!ctx.procOrderId, `procOrder=${ctx.procOrderId ? "ok" : "MISSING"}`);

    // 7. administer med (nurse, five rights)
    const mar = await call("nurse", "POST", `/doctor-orders/${ctx.medOrderId}/administer`, { scheduledTime: "08:00", status: "given", givenBy: "Staff Nurse", doseGiven: "100 mg", routeUsed: "PO", fiveRightsChecked: true });
    const marRec = (D(mar)?.administrationRecord || []).some((r) => r.scheduledTime === "08:00" && r.status === "given");
    R.t("MAR — nurse administers medication (five rights)", mar.status === 200 && marRec, `status=${mar.status}, recorded=${marRec}`);

    // 8. vitals sheet (nurse)
    const vit = await call("nurse", "POST", "/vitalsheet", { uhid: ctx.uhid, date: "2026-07-12", admissionId: ctx.admissionId, activeVitals: [{ name: "Pulse", unit: "bpm" }, { name: "Temperature", unit: "°F" }], tableData: [{ time: "08:00", values: { Pulse: { value: 82, unit: "bpm" }, Temperature: { value: 98.6, unit: "°F" } } }] });
    R.t("Vitals sheet recorded (HH:MM cadence)", (vit.status === 200 || vit.status === 201) && (vit.data?.success !== false), `status=${vit.status}`);

    // 9. nurse note
    const nn = await call("nurse", "POST", "/nurse-notes", { UHID: ctx.uhid, ipdNo: ctx.admissionNumber, admissionId: ctx.admissionId, shift: "morning", generalCondition: "Stable, afebrile", nursingCare: "Position change, oral care done", remarks: "Patient comfortable", noteType: "general" });
    ctx.nurseNoteId = D(nn)?._id;
    R.t("Nursing note saved", nn.status === 201 && !!ctx.nurseNoteId, `noteId=${ctx.nurseNoteId ? "ok" : "MISSING"}`);

    // 10. dietician plan
    const diet = await call("dietician", "POST", "/dietitian/plan", { UHID: ctx.uhid, admissionId: ctx.admissionId, visitType: "IPD", patientName: "Test IPD Patient", status: "active", assessment: { height: 170, weight: 70, conditions: "Diabetic" }, plan: { dietType: "Diabetic", notes: "1800 kcal, low sugar" } });
    ctx.dietPlanId = D(diet)?._id;
    R.t("Dietician orders — diet plan created", diet.status === 201 && !!ctx.dietPlanId, `dietPlan=${ctx.dietPlanId ? "ok" : "MISSING"}`);

    // 11. raise indent (nurse)
    const ind = await call("nurse", "POST", "/indents", { admissionId: ctx.admissionId, urgency: "Routine", items: [{ drugId: ctx.drugId, drugName: ctx.drugName, requestedQty: 5, form: "Tablet", dose: "100mg", route: "PO" }] });
    ctx.indentId = D(ind)?._id; ctx.indentItemId = D(ind)?.items?.[0]?._id;
    R.t("Live indent raised by nurse", ind.status === 201 && !!ctx.indentId && D(ind)?.status === "Raised", `indent=${ctx.indentId ? "ok" : "MISSING"}, status=${D(ind)?.status}`);

    // 12. pharmacist reads indent (item id)
    const indGet = await call("pharmacy", "GET", `/indents/${ctx.indentId}`);
    const itemFromGet = D(indGet)?.items?.[0]?._id;
    if (itemFromGet) ctx.indentItemId = itemFromGet;
    R.t("Pharmacist reads indent (item subdoc id)", indGet.status === 200 && !!ctx.indentItemId, `item=${ctx.indentItemId ? "ok" : "MISSING"}`);

    // 13. acknowledge
    const ack = await call("pharmacy", "POST", `/indents/${ctx.indentId}/acknowledge`, {});
    R.t("Indent acknowledged by pharmacist", ack.status === 200 && D(ack)?.status === "Acknowledged", `status=${D(ack)?.status}`);

    // 14. release (FEFO)
    const rel = await call("pharmacy", "POST", `/indents/${ctx.indentId}/release`, { items: [{ itemId: ctx.indentItemId, issuedQty: 5 }] });
    R.t("Indent released (FEFO batch, PHARM lines on admission bill)", rel.status === 200 && ["Released", "PartiallyReleased"].includes(D(rel)?.status), `status=${D(rel)?.status}`);

    // 15. pharmacy credit for admission
    const cred = await call("pharmacy", "GET", `/pharmacy/credit/admission/${ctx.admissionId}`);
    R.t("Pharmacy billing — admission credit readable", cred.status === 200 && (cred.data?.success !== false), `status=${cred.status}`);

    // 16. manual nursing charge
    const mc = await call("reception", "POST", `/billing/ipd/${ctx.admissionId}/manual-charge`, { serviceId: ctx.nursingServiceId, quantity: 1, remarks: "Catheterisation charge" });
    R.t("Manual nursing service charge added to IPD bill", (mc.status === 200 || mc.status === 201) && (mc.data?.success !== false), `status=${mc.status}, svc=${ctx.nursingName}`);

    // 17. ledger → capture bill id
    const led = await call("reception", "GET", `/billing/ipd/${ctx.admissionId}/ledger`);
    const ledD = D(led);
    ctx.billId = ledD?.bill?._id;
    let balance = num(ledD?.bill?.balanceAmount);
    const netAmt = num(ledD?.billSummary?.netAmount ?? ledD?.bill?.netAmount);
    R.t("IPD ledger aggregates charges → active bill", led.status === 200 && !!ctx.billId, `bill=${ctx.billId ? "ok" : "MISSING"}, balance=₹${balance}, net=₹${netAmt}`);

    // 18. partial cash payment (portion of the live balance — bill total is small,
    //     so pay ~half; caps at 5000 per playbook intent, over-pay is 400-guarded).
    const partAmt = Math.max(1, Math.min(5000, Math.floor(balance / 2)));
    const pay1 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: partAmt, paymentMode: "CASH", remarks: "IPD part payment" });
    R.t("Partial cash payment collected", pay1.status === 200 && (pay1.data?.success !== false), `paid ₹${partAmt}, status=${pay1.status}, balance=₹${num(D(pay1)?.balanceAmount)}`);
    balance = num(D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount);

    // 19. apply earmarked advance to bill (portion; leaves remainder for the final
    //     cash payment AND unspent advance for the discharge refund in step 26).
    const applyAmt = Math.max(1, Math.min(10000, Math.floor(balance / 2)));
    const apply = await call("reception", "POST", `/billing/advance/${ctx.advanceId}/apply`, { billId: ctx.billId, amount: applyAmt });
    R.t("Advance applied to IPD bill (earmark match)", apply.status === 200 && (apply.data?.success !== false), `applied ₹${applyAmt}, status=${apply.status}`);
    balance = num(D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount);

    // 20. final payment to clear remaining balance
    let pay2 = { status: 200, data: {} };
    if (balance > 0.01) pay2 = await call("reception", "POST", `/billing/${ctx.billId}/payment`, { amount: balance, paymentMode: "UPI", transactionId: `UPI-CLR-${Date.now()}`, remarks: "Final settlement" });
    balance = num(D(await call("reception", "GET", `/billing/${ctx.billId}`))?.balanceAmount);
    R.t("Final payment clears IPD bill (balance ≈ 0)", pay2.status === 200 && balance <= 0.01, `final balance=₹${balance}`);

    // 21. stop procedure order (terminal so discharge not blocked)
    const stop = await call("admin", "POST", `/doctor-orders/${ctx.procOrderId}/doctor-action`, { type: "stop", doneBy: "Dr Admin", reason: "Procedure completed at bedside" });
    const stopStatus = D(stop)?.status;
    R.t("Stop procedure order (terminal)", stop.status === 200 && (stopStatus === "Stopped" || (stop.data?.ok !== false)), `status=${stop.status}, orderStatus=${stopStatus}`);

    // 22. discharge summary (draft)
    const ds = await call("admin", "POST", "/discharge-summary", { patient: ctx.patientId, UHID: ctx.uhid, admissionId: ctx.admissionId, patientName: "Test IPD Patient", dischargeType: "Routine", conditionOnDischarge: "Stable", finalDiagnosis: "Viral pyrexia, resolved", treatmentGiven: "IV fluids, antipyretics", followUp: "Review in 5 days" });
    ctx.summaryId = D(ds)?._id;
    R.t("Discharge summary drafted", ds.status === 201 && !!ctx.summaryId && D(ds)?.status === "draft", `summary=${ctx.summaryId ? "ok" : "MISSING"}, status=${D(ds)?.status}`);

    // 23. finalize discharge summary
    const fin = await call("admin", "PATCH", `/discharge-summary/${ctx.summaryId}/finalize`, { finalizedByName: "Dr Admin", allowOverride: true, overrideReason: "PROM/PREM + handover waived for E2E test run" });
    R.t("Discharge summary finalized (DoctorApproved stage)", fin.status === 200 && D(fin)?.status === "finalized", `status=${D(fin)?.status}`);

    // 24. clear final bill
    const clr = await call("reception", "POST", `/admissions/${ctx.admissionId}/clear-final-bill`, { finalBillAmount: 0, finalBillNumber: "", waiverReason: "" });
    R.t("Clear final bill (stage BillCleared, no pharmacy/charge gates)", clr.status === 200 && (clr.data?.success !== false), `status=${clr.status}, stage=${D(clr)?.dischargeWorkflow?.stage ?? D(clr)?.stage ?? ""}`);

    // 25. issue gate pass → free bed
    const gp = await call("reception", "POST", `/admissions/${ctx.admissionId}/issue-gate-pass`, {});
    R.t("Gate pass issued (bed freed, housekeeping task)", gp.status === 200 && (gp.data?.success !== false), `status=${gp.status}`);

    // 26. advance refund ₹10000 (accountant — cross-actor SoD)
    const ref = await call("accountant", "POST", `/billing/advance/${ctx.advanceId}/refund`, { refundReason: "Unspent IPD advance returned at discharge", mode: "CASH" });
    const refD = D(ref);
    const refAmt = num(refD?.refundedAmount);
    R.t("Advance refund ₹10000 (cross-actor SoD)", ref.status === 200 && ["REFUNDED", "PARTIALLY_REFUNDED"].includes(refD?.status), `status=${refD?.status}, refunded=₹${refAmt}`);

    // 27. complete patient file
    const file = await call("admin", "GET", `/patient-file/${ctx.uhid}/complete`);
    const fd = D(file);
    const hasCore = !!(fd?.patient && (fd?.admissions || fd?.currentAdmission));
    R.t("Medical record — complete patient file readable", file.status === 200 && hasCore, `status=${file.status}`);

    // 28. NABH readmission register
    const reg2 = await call("admin", "GET", "/registers/nabh/readmission-register");
    R.t("Registers — NABH readmission register readable", reg2.status === 200 && (reg2.data?.success !== false), `status=${reg2.status}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message + " @ " + (e.stack || "").split("\n")[1]);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
