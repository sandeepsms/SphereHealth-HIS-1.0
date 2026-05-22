# R7ax — kill the OOM, sweep perf pattern, ship ConfirmDialog

**Cycle**: R7ax (after R7aw shipped 12 fixes + the revenue-breakdown PERF rewrite)
**Scope**: Root-cause the residual audit-endpoint OOM, sweep the proven `$facet` pattern across 4 more endpoints, replace 27 `window.confirm()` sites with a reusable modal.

**The headline**: R7aw thought it had fixed *the* OOM, but a second OOM appeared on `/api/billing/audit` even with an empty collection. R7ax found the actual root cause — it's been lurking since R7ap and explains a string of weird symptoms across the last 6 cycles.

---

## Punch list

| # | Tag | File | One-line |
|---|---|---|---|
| 1 | **R7ax-FIX-OOM** | Backend/models/Billing/BillingAudit.js | **CRITICAL**: `module.exports.emit = …` was clobbering `EventEmitter.prototype.emit` on the Mongoose model → infinite recursion on first index sync → 500 MB OOM in 10 s |
| 2 | R7ax-FIX-1 | Backend/controllers/Billing/billingController.js | `getAging` → single `$facet` pipeline (42 ms, was bounded by `.limit(2000)`) |
| 3 | R7ax-FIX-2 | Backend/controllers/Billing/billingController.js | `getHospitalGstRegister` → folded post-aggregation rollup into the pipeline + parallel CN reversal aggregate |
| 4 | R7ax-FIX-3 | Backend/controllers/Billing/billingController.js | `computeCollectionSummary` → `$facet` with 5 sibling branches; byte-parity verified |
| 5 | R7ax-FIX-4 | Backend/controllers/Billing/billingController.js | `listBillingAudit` — added `.maxTimeMS(10_000)` defensive cap |
| 6 | R7ax-FIX-CONFIRM | Frontend/src/Components/common/ConfirmDialog.jsx (new) + 17 callers | New `ConfirmDialog` component + replaced 27 `window.confirm()` sites |

---

## Verification (smoke 10/10 passed, backend RSS 80 MB)

```
▶ R7ax-FIX-OOM: /api/billing/audit no longer kills the backend
  ✓ audit GET #1 in 32ms
  ✓ audit GET #2 in 16ms   ←  sub-20ms steady-state
  ✓ audit GET #3 in 13ms
  ✓ audit GET #4 in 9ms
  ✓ audit GET #5 in 8ms
▶ R7aw-FIX-PERF: revenue-breakdown via $facet
  ✓ revenue-breakdown 200 in 12ms  (was 8 GB OOM before R7aw)
▶ R7ax-FIX-1: getAging via $facet
  ✓ aging 200 in 9ms
▶ R7ax-FIX-2: getHospitalGstRegister via $facet
  ✓ gst-register 200 in 18ms
▶ R7av previously verified — re-confirm
  ✓ audit 400s on bad billId
  ✓ Cache-Control on /api/patients

Backend RSS: 80 MB    (was 8 GB OOM before R7aw + R7ax)
```

---

## The OOM root cause (lesson)

**Symptom (cross-cycle)**: Random OOMs over the last 6 cycles. R7aw thought it had fixed it via `$facet` aggregation. But the same OOM came back on the audit endpoint, even with 0 docs in the collection. It happened around 2-3 minutes after boot — not on a specific request.

**Root cause**: `Backend/models/Billing/BillingAudit.js` ended with:
```js
module.exports = BillingAudit;
module.exports.emit = emitBillingAudit;  // ← this line is the bug
```

Since `module.exports` IS the Mongoose Model object (which extends `EventEmitter`), the second line **clobbered `EventEmitter.prototype.emit`** on the model. Then the first time anything touched the BillingAudit model (any `.find`, `.create`, `.countDocuments`, or `Model.init()`):
1. Mongoose's internal index sync called `this.emit("index", err)` (EventEmitter API)
2. Landed in our `emitBillingAudit("index", err)` instead
3. Our helper tried to spread the string `"index"` into a payload object → called `mongoose.model("BillingAudit").create(...)`
4. Triggered pre-save → triggered another index sync emit
5. Infinite recursion → 500 MB alloc → OOM in 10-15 s

**Why it slipped through 6 cycles**: every emit since R7ap silently OOMed on first call. The collection had **0 docs** because the OOM-and-restart loop kept the writes from ever landing. The cycles that "added BillingAudit events" all wrote NOTHING. The lurking infinite-recursion never died from a *known* request — only from boot-time Mongoose `Model.init()` happening sometime in the first few minutes.

**Why R7aw/R7ax band-aids missed it**: We added `maxTimeMS(10_000)` on the `find` query. But the OOM happened **inside `Model.init()`** before any query was sent — so the timeout never fired and the controller's try/catch never saw an error. We were instrumenting downstream of where the bug actually lived.

**Fix** (file `Backend/models/Billing/BillingAudit.js`, lines 241-280):
- Keep the model export untouched
- Expose the helper as `module.exports.emitBillingAudit` (new explicit name)
- Add a back-compat `.emit` that dispatches by first-arg type — `string → EventEmitter.prototype.emit`, `object → emitBillingAudit`
- All 16 existing call sites `const { emit } = require(".../BillingAudit"); emit({event:"…"})` work unchanged

**Verification**:
- Before: `BA.init()` → OOM at 510 MB in 12 s
- After: init OK in 200 ms, heap stable at 17 MB
- 60-second load loop (447 audit hits): all 200, RSS held at 98 MB
- A real `emit({event:"CRON_RECONCILED", reason:"verify"})` round-trip created + retrieved a real audit row with the correct 3-year `retainUntil` (R7aw-FIX-5)

Also dropped 12 stale indexes left over from the OOM-loop era; Mongoose's autoIndex rebuilt them cleanly on next boot.

---

## $facet sweep results (R7ax-FIX-1 through -4)

R7aw-FIX-PERF proved the pattern. R7ax applied it to 3 more endpoints with the same bug class (`find().select().lean()` over PatientBill + JS reducer). Plus a defensive cap on the audit-list endpoint.

| Endpoint | Before | After | Notes |
|---|---|---|---|
| getRevenueBreakdown | 8 GB OOM | 12 ms | R7aw (already shipped) |
| getAging | 9 ms (silently truncated > 2000 open bills) | 9 ms (no truncation) | $facet { buckets, totals, patientCredit top-100, tpaCredit top-100 } |
| getHospitalGstRegister | partial aggregation + JS rollup | 18 ms (rollup folded in pipeline) | + parallel CN reversal via `Promise.all` |
| computeCollectionSummary | JS reducer over `find().lean()` | 18 ms (5-branch $facet + 2 parallel small aggregates on PatientAdvance) | byte-for-byte parity verified |
| listBillingAudit | `find().lean()` | `find().lean().maxTimeMS(10_000)` | left as find — small collection, just add defensive cap |

Caches preserved (LRU wraps the function, not the aggregate). `allowDiskUse:true` + `maxTimeMS:15_000` on every aggregate.

---

## ConfirmDialog (R7ax-FIX-CONFIRM)

Replaced 27 `window.confirm()` calls (R7aw's recon estimated 28; actual count 27).

**Component**: `Frontend/src/Components/common/ConfirmDialog.jsx` — module-level `createRoot` portal + Promise-based `confirm({title, body, danger?, confirmLabel?, cancelLabel?})`. Uses existing `.his-modal-overlay` / `.his-modal.narrow` / `.his-btn` classes from `his-design.css`. ESC cancels, Enter confirms, primary auto-focused, backdrop click cancels. NO inline styles.

**17 files modified, 27 sites total**:
- `HospitalChargesList` (1), `DoctorOrdersPanel` (1), `DepartmentManagement` (1), `DischargeSummaryPage` (1), `MARPage` (1), `FloorManagement` (1), `VitalsView` (1), `OPDAssessmentPage` (4), `TreatmentTeamPanel` (1), `DoctorPatientPanel` (1), `DoctorListPage` (1), `MedReconciliationTab` (1), `DischargeQueue` (1), `ReceptionBilling` (6), `VisitorPasses` (1), `Appointments` (1), `PharmacyHomePage` (3)
- Destructive actions use `danger:true`; benign (mark returned, check in, generate bill, apply advance) omit it
- All replacements tagged `R7ax-FIX-CONFIRM`
- `removeInfusion` (OPDAssessmentPage) + 1 inline arrow (DoctorOrdersPanel) promoted to `async`
- Build: `npm run build` clean in 10.89 s, zero new warnings

`grep window.confirm` in `Frontend/src/` now returns ZERO functional matches (only audit comments + 1 docstring inside `ConfirmDialog.jsx`).

---

## Deferred (next cycle)

- Inline-style sweeps in ReceptionBilling (105) + AccountsConsole (156) — still huge refactors
- printConsolidatedFinalBill + printGatePass openPrint refactor
- IPDBillingLedger AuditView mixed timeline (needs new backend feed)
- ReceptionConsole auto-route to billing after finalize

---

*Authored R7ax by Dr Sandeep + Claude. 6 fixes shipped, the lurking OOM eliminated at its source, dashboard endpoints all sub-50 ms, ConfirmDialog adopted across the whole frontend.*
