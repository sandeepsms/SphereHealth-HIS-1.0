// E2E driver — Cross-cutting: Ward Boy / Housekeeping / Security tasks.
// ward-task board lifecycle (Ward Boy), cleaning-task board + area checklist +
// spillage log (Housekeeping), gate-log + incidents + visitor-pass (Security).
const { call, D, makeReport } = require("./_e2e_lib");
const fs = require("fs");

(async () => {
  const R = makeReport("Cross-cutting: Ward Boy / Housekeeping / Security tasks");
  const ctx = {};
  try {
    // ══════════════════════════ WARD BOY ══════════════════════════
    // 2. create ward task
    const wt = await call("wardboy", "POST", "/ward-tasks", {
      title: "Wheelchair to OT-3", type: "transport", priority: "urgent",
      fromLocation: "Ward-A", toLocation: "OT-3", description: "Pre-op transfer",
    });
    ctx.wardTaskId = D(wt)?._id;
    R.t("Ward Boy: create ward-task (status open)", wt.status === 201 && D(wt)?.status === "open" && !!ctx.wardTaskId, `status=${wt.status}, taskStatus=${D(wt)?.status}`);

    // 3. accept
    const wa = await call("wardboy", "PATCH", `/ward-tasks/${ctx.wardTaskId}/accept`);
    R.t("Ward Boy: accept ward-task (→ assigned)", wa.status === 200 && D(wa)?.status === "assigned", `status=${wa.status}, taskStatus=${D(wa)?.status}`);

    // 4. start
    const ws = await call("wardboy", "PATCH", `/ward-tasks/${ctx.wardTaskId}/start`);
    R.t("Ward Boy: start ward-task (→ in-progress, startedAt)", ws.status === 200 && D(ws)?.status === "in-progress" && !!D(ws)?.startedAt, `status=${ws.status}, taskStatus=${D(ws)?.status}`);

    // 5. complete
    const wc = await call("wardboy", "PATCH", `/ward-tasks/${ctx.wardTaskId}/complete`, { completionNotes: "Delivered wheelchair, patient handed to OT nurse" });
    R.t("Ward Boy: complete ward-task (→ done, completedAt, notes echoed)", wc.status === 200 && D(wc)?.status === "done" && !!D(wc)?.completedAt && D(wc)?.completionNotes === "Delivered wheelchair, patient handed to OT nurse", `status=${wc.status}, taskStatus=${D(wc)?.status}`);

    // 6. create 2nd task then cancel
    const wt2 = await call("wardboy", "POST", "/ward-tasks", { title: "Sample runner to lab", type: "transport", priority: "normal", fromLocation: "Ward-B", toLocation: "Lab", description: "Duplicate request" });
    ctx.wardTaskId2 = D(wt2)?._id;
    const wcan = await call("wardboy", "PATCH", `/ward-tasks/${ctx.wardTaskId2}/cancel`, { cancelReason: "Duplicate request" });
    R.t("Ward Boy: cancel 2nd ward-task (→ cancelled)", wt2.status === 201 && wcan.status === 200 && D(wcan)?.status === "cancelled", `create=${wt2.status}, cancel=${wcan.status}, taskStatus=${D(wcan)?.status}`);

    // 7. stats
    const wstats = await call("wardboy", "GET", "/ward-tasks/stats");
    const st = D(wstats) || {};
    const hasStatKeys = ["open", "assigned", "inProgress", "doneToday", "myActive"].every((k) => typeof st[k] === "number");
    R.t("Ward Boy: task stats (open/assigned/inProgress/doneToday/myActive)", wstats.status === 200 && hasStatKeys, `status=${wstats.status}, keys=${Object.keys(st).join(",")}`);

    // ══════════════════════════ HOUSEKEEPING ══════════════════════════
    // 9. create cleaning task
    const ht = await call("housekeeping", "POST", "/housekeeping/tasks", {
      title: "Terminal clean OT-3", type: "terminal", priority: "high",
      area: "OT-3", ward: "Surgical", description: "Post-op terminal disinfection",
    });
    ctx.cleanTaskId = D(ht)?._id;
    R.t("Housekeeping: create cleaning task (status open)", ht.status === 201 && D(ht)?.status === "open" && !!ctx.cleanTaskId, `status=${ht.status}, taskStatus=${D(ht)?.status}`);

    // 10-12. accept → start → complete
    const ha = await call("housekeeping", "PATCH", `/housekeeping/tasks/${ctx.cleanTaskId}/accept`);
    R.t("Housekeeping: accept cleaning task (→ assigned)", ha.status === 200 && D(ha)?.status === "assigned", `status=${ha.status}, taskStatus=${D(ha)?.status}`);
    const hs = await call("housekeeping", "PATCH", `/housekeeping/tasks/${ctx.cleanTaskId}/start`);
    R.t("Housekeeping: start cleaning task (→ in-progress)", hs.status === 200 && D(hs)?.status === "in-progress", `status=${hs.status}, taskStatus=${D(hs)?.status}`);
    const hc = await call("housekeeping", "PATCH", `/housekeeping/tasks/${ctx.cleanTaskId}/complete`, { completionNotes: "Fogged + surfaces wiped", protocolFollowed: "terminal-icu", productsUsed: ["Bleach 5%", "Bacillocid"] });
    R.t("Housekeeping: complete cleaning task (→ done, completedAt)", hc.status === 200 && D(hc)?.status === "done" && !!D(hc)?.completedAt, `status=${hc.status}, taskStatus=${D(hc)?.status}`);

    // 13. checklist
    const chk = await call("housekeeping", "POST", "/housekeeping/checklist", {
      area: "ICU", shift: "morning", cleaningType: "routine",
      checks: [{ item: "Floor mopped with disinfectant", done: true }, { item: "Dustbins emptied + relined", done: true }],
      productsUsed: ["Lizol"], remarks: "All clear",
    });
    const ck = D(chk);
    R.t("Housekeeping: area-cleaning checklist (all done → done, area=ICU)", chk.status === 200 && ck?.status === "done" && ck?.area === "ICU", `status=${chk.status}, checklistStatus=${ck?.status}, area=${ck?.area}`);

    // 14. spillage report
    const sp = await call("housekeeping", "POST", "/housekeeping/spillage", { area: "Ward-A", type: "blood", volumeEst: "medium", location: "Bed-4 bedside", roomNumber: "A-04" });
    ctx.spillId = D(sp)?._id;
    R.t("Housekeeping: report spillage (status reported)", sp.status === 201 && D(sp)?.status === "reported" && !!ctx.spillId, `status=${sp.status}, spillStatus=${D(sp)?.status}`);

    // 15. contain
    const spc = await call("housekeeping", "PATCH", `/housekeeping/spillage/${ctx.spillId}/contain`);
    R.t("Housekeeping: contain spillage (→ contained, containedAt)", spc.status === 200 && D(spc)?.status === "contained" && !!D(spc)?.containedAt, `status=${spc.status}, spillStatus=${D(spc)?.status}`);

    // 16. clean
    const spcl = await call("housekeeping", "PATCH", `/housekeeping/spillage/${ctx.spillId}/clean`, { productsUsed: ["Sodium hypochlorite 1%"], reportedToInfectionControl: true, notes: "Spill kit used, area cordoned" });
    R.t("Housekeeping: clean spillage (→ cleaned, reportedToInfectionControl)", spcl.status === 200 && D(spcl)?.status === "cleaned" && D(spcl)?.reportedToInfectionControl === true, `status=${spcl.status}, spillStatus=${D(spcl)?.status}`);

    // ══════════════════════════ SECURITY ══════════════════════════
    // 18. gate-log in
    const gin = await call("security", "POST", "/gate-log", {
      direction: "in", personType: "Visitor", personName: "Ramesh Kumar",
      idProofType: "Aadhaar", idProofNumber: "XXXX-1234", contactNumber: "9876543210",
      gate: "Main", purpose: "Visiting IPD patient", vehicleNumber: "KA01AB1234",
    });
    ctx.gateInId = D(gin)?._id;
    R.t("Security: gate-log IN (direction in, recordedByRole Security)", gin.status === 201 && D(gin)?.direction === "in" && D(gin)?.recordedByRole === "Security", `status=${gin.status}, dir=${D(gin)?.direction}, role=${D(gin)?.recordedByRole}`);

    // 19. gate-log out
    const gout = await call("security", "POST", "/gate-log", { direction: "out", personType: "Visitor", personName: "Ramesh Kumar", gate: "Main" });
    R.t("Security: gate-log OUT (direction out)", gout.status === 201 && D(gout)?.direction === "out", `status=${gout.status}, dir=${D(gout)?.direction}`);

    // 20. create incident
    const inc = await call("security", "POST", "/incidents", {
      type: "Theft", severity: "High", location: "Parking lot Gate-2",
      description: "Two-wheeler theft reported near visitor parking",
      personsInvolved: [{ name: "Unknown", role: "suspect", contact: "" }],
    });
    ctx.incidentId = D(inc)?._id;
    R.t("Security: create incident (IR-YYYYMMDD-NNNN, status Open)", inc.status === 201 && /^IR-\d{8}-\d{4}$/.test(D(inc)?.incidentNumber || "") && D(inc)?.status === "Open" && !!ctx.incidentId, `status=${inc.status}, incNo=${D(inc)?.incidentNumber}, incStatus=${D(inc)?.status}`);

    // 21. status → Investigating
    const inv = await call("security", "PATCH", `/incidents/${ctx.incidentId}/status`, { status: "Investigating", note: "CCTV footage pulled, complaint logged" });
    const invHasEntry = (D(inv)?.statusHistory || []).some((h) => h.to === "Investigating");
    R.t("Security: incident → Investigating (statusHistory appended)", inv.status === 200 && D(inv)?.status === "Investigating" && invHasEntry, `status=${inv.status}, incStatus=${D(inv)?.status}`);

    // 22. status → Resolved
    const rsv = await call("security", "PATCH", `/incidents/${ctx.incidentId}/status`, { status: "Resolved", note: "Recovered vehicle, matter closed" });
    R.t("Security: incident → Resolved (resolvedAt, resolvedBy set)", rsv.status === 200 && D(rsv)?.status === "Resolved" && !!D(rsv)?.resolvedAt && !!D(rsv)?.resolvedBy, `status=${rsv.status}, incStatus=${D(rsv)?.status}`);

    // ── visitor-pass prerequisites: register IPD patient + admit to a free bed ──
    const reg = await call("reception", "POST", "/patients", {
      title: "Mr.", fullName: "Attendant Test Patient", gender: "Male", age: 58,
      contactNumber: "9222" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
      registrationType: "IPD", paymentType: "GENERAL",
      address: { city: "Test", state: "Test", pincode: "110001" },
    });
    const pat = D(reg); ctx.uhid = pat?.UHID; ctx.patientId = pat?._id;

    // master lookups: doctor + a free bed
    const docs = D(await call("admin", "GET", "/doctors"));
    const doc = (Array.isArray(docs) ? docs : [])[0];
    ctx.doctorId = doc?._id;
    ctx.doctorName = doc?.personalInfo?.fullName || doc?.fullName || doc?.name || "Dr. E2E";
    const bedRes = D(await call("security", "GET", "/bedss/available"));
    const bed = (Array.isArray(bedRes) ? bedRes : []).find((b) => (b.status || "Available") === "Available") || (Array.isArray(bedRes) ? bedRes : [])[0];

    const adm = await call("reception", "POST", "/admissions", {
      UHID: ctx.uhid, patientId: ctx.patientId, patientName: pat?.fullName, contactNumber: pat?.contactNumber,
      admissionType: "Planned", attendingDoctor: ctx.doctorName, attendingDoctorId: ctx.doctorId,
      reasonForAdmission: "Attendant/visitor-pass E2E scenario",
      bedId: bed?._id, roomId: bed?.room, wardId: bed?.ward,
      bedNumber: bed?.bedNumber, roomNumber: bed?.roomNumber, wardName: bed?.wardName,
      hasBed: true, status: "Active", paymentType: "GENERAL", admissionDate: new Date().toISOString(),
    });
    ctx.admissionId = D(adm)?._id;
    R.t("Security: prerequisite IPD admission for visitor-pass (Active)", reg.status === 201 && adm.status === 201 && !!ctx.admissionId && D(adm)?.status === "Active", `reg=${reg.status}, adm=${adm.status}, bed=${bed?.bedNumber}`);

    // 23. issue visitor pass
    const vp = await call("security", "POST", "/visitor-passes", {
      admissionId: ctx.admissionId, attendantName: "Sita Devi", attendantRelation: "Wife",
      attendantPhone: "9812345678", idProofType: "Aadhaar", idProofNumber: "XXXX-9999",
      validHours: 24, notes: "Primary attendant",
    });
    ctx.passId = D(vp)?._id; ctx.passNumber = D(vp)?.passNumber;
    R.t("Security: issue visitor pass (VP-YYYYMMDD-NNNN, Active)", vp.status === 201 && /^VP-\d{8}-\d{4}$/.test(ctx.passNumber || "") && D(vp)?.status === "Active", `status=${vp.status}, passNo=${ctx.passNumber}, passStatus=${D(vp)?.status}`);

    // 24. attendant gate-entry linked to the issued pass. personType
    // "Attendant" is now a first-class enum value (fixed: it was missing from
    // GateLogModel and 500'd). The linked entry stamps linkedPassNumber +
    // visitorPassId from the scanned pass.
    const ginp = await call("security", "POST", "/gate-log", {
      direction: "in", personType: "Attendant", personName: "Sita Devi",
      gate: "Main", visitorPassId: ctx.passId, purpose: "Attendant entry",
    });
    R.t("Security: attendant gate-log IN linked to visitor pass (linkedPassNumber matches)", ginp.status === 201 && D(ginp)?.personType === "Attendant" && D(ginp)?.linkedPassNumber === ctx.passNumber && String(D(ginp)?.visitorPassId) === String(ctx.passId), `status=${ginp.status}, personType=${D(ginp)?.personType}, linkedPass=${D(ginp)?.linkedPassNumber}`);

    // 25. return pass
    const vpr = await call("security", "POST", `/visitor-passes/${ctx.passId}/return`, { notes: "Attendant left premises" });
    R.t("Security: return visitor pass (→ Returned, returnedAt)", vpr.status === 200 && D(vpr)?.status === "Returned" && !!D(vpr)?.returnedAt, `status=${vpr.status}, passStatus=${D(vpr)?.status}`);
  } catch (e) {
    R.t("DRIVER EXCEPTION", false, e.message);
  }
  const md = R.md();
  console.log("\n----MD----\n" + md);
  if (process.env.E2E_WRITE) fs.appendFileSync(require("path").join(__dirname, "..", "..", "E2E-TEST-REPORT.md"), md);
  const { fail } = R.summary();
  process.exit(fail ? 1 : 0);
})();
