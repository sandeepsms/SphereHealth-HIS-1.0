/**
 * R7hr-83 Phase C verifier — exercises the full ServiceMaster pick →
 * completion → auto-bill loop. Run with:
 *   HIS_TOKEN=<token> node Backend/scripts/verifyDoctorOrderAutoBill.js
 *
 * Steps:
 *   1. Resolve an active IPD admission.
 *   2. Pick the first active Procedure ServiceMaster row.
 *   3. POST a Procedure DoctorOrder carrying the ServiceMaster pick
 *      (serviceMasterId/serviceCode/serviceName/unitPrice on orderDetails).
 *   4. Transition the order to status="Completed" so Phase C's
 *      fireAutoBillOnCompletion → autoBillingService.onDoctorOrderCompleted
 *      fires.
 *   5. Read the IPD ledger and find the BillingTrigger that points back
 *      at the order via sourceType="DoctorOrder" + sourceRef=order._id.
 *   6. Print a PASS/FAIL report and exit with the matching code.
 *
 * No dependencies — uses node 18+ global fetch.
 */

const BASE_URL = process.env.HIS_BASE_URL || "http://localhost:5050";
const TOKEN    = process.env.HIS_TOKEN;
const COMPLETED_BY = "admin-r7hr83-c5";

// Phase C category map (mirrors DOCTOR_ORDER_CATEGORY_MAP in
// Backend/services/Billing/autoBillingService.js). The auto-biller stamps
// this on the trigger's `department` field as a ledger-bucket hint.
const PHASE_C_CATEGORY_MAP = {
  Lab:              "LAB",
  Radiology:        "RADIOLOGY",
  Investigation:    "LAB",
  Procedure:        "PROCEDURE",
  BloodTransfusion: "BLOOD",
  IV_Fluid:         "PHARMACY",
  Diet:             "DIET",
  Oxygen:           "OXYGEN",
  Physiotherapy:    "PHYSIO",
  Activity:         "NURSING",
  Nursing:          "NURSING",
  Consultation:     "CONSULTATION",
  Medication:       "PHARMACY",
};

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function header(s) {
  const bar = "─".repeat(Math.max(8, s.length + 4));
  console.log("\n" + bar + "\n  " + s + "\n" + bar);
}

async function api(method, path, { body, query } = {}) {
  const url = new URL(path.startsWith("http") ? path : BASE_URL + path);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res, text;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`Network error on ${method} ${url}: ${e.message}`);
  }
  try {
    text = await res.text();
  } catch (e) {
    throw new Error(`Failed to read body of ${method} ${url}: ${e.message}`);
  }
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { /* not json — keep raw */ }
  }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    throw new Error(`${method} ${url} → HTTP ${res.status}: ${detail.slice(0, 600)}`);
  }
  return json != null ? json : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickFromList(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload.data)) return payload.data[0] || null;
  if (Array.isArray(payload.admissions)) return payload.admissions[0] || null;
  if (Array.isArray(payload.rows)) return payload.rows[0] || null;
  return null;
}

function asArray(payload, key = "triggers") {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload[key])) return payload[key];
  if (payload.data && Array.isArray(payload.data[key])) return payload.data[key];
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  return [];
}

// ──────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────

(async function main() {
  if (!TOKEN) {
    die(
      'HIS_TOKEN not set. Howto: HIS_TOKEN="<your-jwt>" node Backend/scripts/verifyDoctorOrderAutoBill.js',
      1,
    );
  }

  let admission, service, order, ledgerRes, trigger;

  // 1) ── Active admission ─────────────────────────────────────────────
  header("Step 1 — Pick active admission");
  let admissionsRes;
  try {
    admissionsRes = await api("GET", "/api/admissions/active");
  } catch (e) {
    die(`FAIL: could not list active admissions — ${e.message}`);
  }
  admission = pickFromList(admissionsRes);
  if (!admission || !admission._id) {
    console.error("Response payload:", JSON.stringify(admissionsRes).slice(0, 600));
    die("FAIL: no active admissions returned by GET /api/admissions/active");
  }
  console.log(
    `  admission._id   = ${admission._id}`,
    `\n  admissionNumber = ${admission.admissionNumber || "(none)"}`,
    `\n  UHID            = ${admission.UHID || "(none)"}`,
    `\n  patientName     = ${admission.patientName || admission.fullName || "(none)"}`,
  );

  // 2) ── Pick the first Procedure ServiceMaster row ──────────────────
  header("Step 2 — Pick Procedure ServiceMaster row");
  let serviceRes;
  try {
    serviceRes = await api("GET", "/api/services/lookup", {
      query: { doctorOrderCategory: "Procedure", limit: 1 },
    });
  } catch (e) {
    die(`FAIL: services/lookup error — ${e.message}`);
  }
  service = pickFromList(serviceRes);
  if (!service || !service._id) {
    console.error("Response payload:", JSON.stringify(serviceRes).slice(0, 600));
    die(
      "FAIL: services/lookup?doctorOrderCategory=Procedure returned no rows. " +
      "Seed the ServiceMaster catalogue with at least one Procedure row first.",
    );
  }
  const unitPrice = Number(service.defaultPrice ?? 0);
  console.log(
    `  serviceMasterId = ${service._id}`,
    `\n  serviceCode     = ${service.serviceCode}`,
    `\n  serviceName     = ${service.serviceName}`,
    `\n  defaultPrice    = ${unitPrice}`,
  );

  // 3) ── POST DoctorOrder ────────────────────────────────────────────
  header("Step 3 — POST DoctorOrder (Procedure)");
  const orderPayload = {
    UHID:        admission.UHID,
    patientId:   admission.patientId,
    patientName: admission.patientName || admission.fullName || "",
    visitType:   "IPD",
    admissionId: admission._id,
    admissionNumber: admission.admissionNumber,
    ipdNo:       admission.admissionNumber,
    visitId:     admission.admissionNumber,
    orderType:   "Procedure",
    priority:    "Routine",
    orderedBy:   COMPLETED_BY,
    orderedByRole: "Doctor",
    orderDetails: {
      procedureName:   service.serviceName,
      indication:      "R7hr-83 Phase C verifier",
      serviceMasterId: service._id,
      serviceCode:     service.serviceCode,
      serviceName:     service.serviceName,
      unitPrice,
    },
  };

  let createRes;
  try {
    createRes = await api("POST", "/api/doctor-orders", { body: orderPayload });
  } catch (e) {
    console.error("Order payload:", JSON.stringify(orderPayload, null, 2));
    die(`FAIL: could not create DoctorOrder — ${e.message}`);
  }
  order = createRes.data || createRes.order || createRes;
  if (!order || !order._id) {
    console.error("Response payload:", JSON.stringify(createRes).slice(0, 600));
    die("FAIL: doctor-order create returned no _id");
  }
  console.log(`  order._id   = ${order._id}`);
  console.log(`  order.serviceCode (on details) = ${order.orderDetails?.serviceCode}`);
  console.log(`  order.unitPrice  (on details)  = ${order.orderDetails?.unitPrice}`);

  // 4) ── Move order to Completed ─────────────────────────────────────
  // The PATCH /:id whitelist (Backend/routes/Doctor/doctorOrderRoutes.js)
  // intentionally strips `status` — every status mutation MUST flow
  // through moveStatus() via /step, /administer, /doctor-action, or
  // DELETE so the ALLOWED_TRANSITIONS matrix + ClinicalAudit emit fire.
  // We first issue the PATCH the user spec describes (which silently
  // drops `status` per the whitelist), then drive the completion via
  // POST /:id/step with totalSteps=1 — that's the documented Phase C
  // entry point that calls fireAutoBillOnCompletion(). Both calls are
  // executed so the report surfaces if the route ever loosens its
  // whitelist in the future.
  header("Step 4 — Transition order to Completed");
  try {
    await api("PATCH", `/api/doctor-orders/${order._id}`, {
      body: { status: "Completed", completedBy: COMPLETED_BY },
    });
    console.log("  PATCH /:id accepted (status field is stripped by whitelist — expected).");
  } catch (e) {
    // PATCH currently 400s if the whitelist filters every field — that's
    // fine, the /step call below is the canonical Completed transition.
    console.log(`  PATCH /:id rejected (expected — status not in whitelist): ${e.message.slice(0, 160)}`);
  }
  try {
    await api("POST", `/api/doctor-orders/${order._id}/step`, {
      body: {
        step: "Procedure completed (Phase C verifier)",
        doneBy: COMPLETED_BY,
        notes: "Marked complete by verifyDoctorOrderAutoBill.js",
        totalSteps: 1,
      },
    });
    console.log("  POST /:id/step → Completed (fires fireAutoBillOnCompletion)");
  } catch (e) {
    die(`FAIL: could not complete DoctorOrder via /step — ${e.message}`);
  }

  // 5) ── Give the emit a moment to settle ───────────────────────────
  await sleep(500);

  // 6) ── Read the IPD ledger and find the matching trigger ──────────
  // The billing route exposes GET /api/billing/ipd/:admissionId/ledger
  // (Backend/routes/Billing/billingRoutes.js + autoBillingService.getIPDLedger).
  // No `?detail=triggers` query param exists — the ledger always returns
  // `triggers: [...]` at the top level (decorated with permission flags).
  // The task spec mentions `?detail=triggers` "or whichever ledger
  // endpoint returns triggers" — this is that endpoint, called without
  // the optional query param.
  header("Step 6 — Read IPD ledger and locate the trigger");
  try {
    ledgerRes = await api("GET", `/api/billing/ipd/${admission._id}/ledger`);
  } catch (e) {
    die(`FAIL: could not read IPD ledger — ${e.message}`);
  }
  const triggers = asArray(ledgerRes, "triggers");
  console.log(`  ledger returned ${triggers.length} trigger(s)`);
  const orderIdStr = String(order._id);
  trigger = triggers.find(
    (t) => t.sourceType === "DoctorOrder" && String(t.sourceRef) === orderIdStr,
  );
  // Defensive fallback — historical/legacy triggers used sourceDocumentId
  // (mirrored on the Phase C emit; see autoBillingService line ~1701).
  if (!trigger) {
    trigger = triggers.find(
      (t) => t.sourceDocumentModel === "DoctorOrder" &&
             String(t.sourceDocumentId) === orderIdStr,
    );
  }

  // 7) ── PASS / FAIL report ────────────────────────────────────────
  header("Step 7 — PASS / FAIL report");
  const failures = [];

  if (!trigger) {
    failures.push("No BillingTrigger found with sourceType='DoctorOrder' and sourceRef===order._id");
  } else {
    // The BillingTrigger schema stores money/code/name at the top level
    // (no `lineItems[]` array). The spec's lineItems[0].* checks are
    // mapped onto these top-level fields here for compatibility with the
    // real schema. We also fall back to lineItems[0] if a future schema
    // change introduces them.
    const checkCode = trigger.lineItems?.[0]?.serviceCode ?? trigger.serviceCode;
    const checkTot  = trigger.lineItems?.[0]?.totalPrice  ?? trigger.lineItems?.[0]?.totalAmount
                       ?? trigger.totalAmount ?? trigger.totalPrice;
    const expectedCategory = PHASE_C_CATEGORY_MAP.Procedure;
    const actualCategory   = trigger.department || trigger.category;

    if (checkCode !== service.serviceCode) {
      failures.push(`serviceCode mismatch — expected '${service.serviceCode}', got '${checkCode}'`);
    }
    if (Number(checkTot) !== Number(unitPrice)) {
      failures.push(
        `total amount mismatch — expected ${unitPrice}, got ${checkTot}`,
      );
    }
    if (actualCategory !== expectedCategory) {
      failures.push(
        `category mismatch — expected '${expectedCategory}' (Phase C map for Procedure), ` +
        `got '${actualCategory}' (trigger.department)`,
      );
    }
  }

  if (failures.length === 0) {
    console.log("  PASS");
    console.log("    trigger._id      =", trigger._id);
    console.log("    sourceType       =", trigger.sourceType);
    console.log("    sourceRef        =", trigger.sourceRef);
    console.log("    serviceCode      =", trigger.serviceCode);
    console.log("    serviceName      =", trigger.serviceName);
    console.log("    unitPrice        =", trigger.unitPrice);
    console.log("    totalAmount      =", trigger.totalAmount);
    console.log("    department       =", trigger.department, "(Phase C category hint)");
    console.log("    status           =", trigger.status);
    process.exit(0);
  } else {
    console.log("  FAIL — the following checks did not pass:");
    for (const f of failures) console.log("    -", f);

    console.log("\n  Order doc (relevant fields):");
    console.log(JSON.stringify(
      {
        _id:            order._id,
        orderType:      order.orderType,
        status:         order.status,
        completedBy:    order.completedBy,
        completedAt:    order.completedAt,
        admissionId:    order.admissionId,
        orderDetails: {
          procedureName:   order.orderDetails?.procedureName,
          serviceMasterId: order.orderDetails?.serviceMasterId,
          serviceCode:     order.orderDetails?.serviceCode,
          serviceName:     order.orderDetails?.serviceName,
          unitPrice:       order.orderDetails?.unitPrice,
        },
      },
      null,
      2,
    ));

    console.log("\n  Trigger query attempted: { sourceType: 'DoctorOrder', sourceRef: '" + orderIdStr + "' }");
    console.log("  Ledger trigger snapshot (first 5):");
    console.log(JSON.stringify(
      triggers.slice(0, 5).map((t) => ({
        _id:         t._id,
        sourceType:  t.sourceType,
        sourceRef:   t.sourceRef,
        sourceDocumentId: t.sourceDocumentId,
        sourceDocumentModel: t.sourceDocumentModel,
        serviceCode: t.serviceCode,
        totalAmount: t.totalAmount,
        department:  t.department,
        status:      t.status,
      })),
      null,
      2,
    ));

    if (trigger) {
      console.log("\n  Matching trigger (full):");
      console.log(JSON.stringify(trigger, null, 2));
    }

    process.exit(1);
  }
})().catch((err) => {
  console.error("\nUNEXPECTED ERROR:", err && err.stack || err);
  process.exit(1);
});
