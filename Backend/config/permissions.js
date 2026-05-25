/**
 * permissions.js — backend mirror of Frontend/src/config/permissions.js
 *
 * Kept deliberately small and dependency-free so it can be required
 * from any controller / middleware. Action tokens MUST match the
 * frontend's ACTIONS map character-for-character so the UI hides
 * what the API rejects and vice-versa.
 *
 * If you change anything here, mirror the same change in
 * Frontend/src/config/permissions.js.
 *
 * ────────────────────────────────────────────────────────────────────
 * R7bb-FIX-C-2 — PHANTOM / DEPRECATED ROLE DECISIONS
 * ────────────────────────────────────────────────────────────────────
 * Radiologist and Physiotherapist exist in the User.role enum (and the
 * Frontend ROLES catalogue) but they have ALMOST ZERO permissions
 * assigned. This means a freshly-created user with role=Radiologist or
 * role=Physiotherapist cannot do meaningful work in the system today.
 *
 *   • Radiologist — granted `lab.read`, `lab.records.read`,
 *     `lab.result-entry`, `lab.verify`, `lab.dispatch` so they can
 *     perform imaging report write-ups + verification. Beyond that
 *     surface there is no Radiologist module / page (see R7ba D6-CRIT-2).
 *     Either build the surface (next cycle) or remove the enum value.
 *
 *   • Physiotherapist — granted the new `physio.note.write` action only.
 *     Wiring of an actual physio-note write route is owned by Agent E
 *     (see R7ba D6-CRIT-1). No frontend page exists today; they cannot
 *     log in to a meaningful console without the role-dashboard wiring.
 *
 *   • Maintenance — there is NO "Maintenance" role. The frontend has a
 *     `maintenance` MODULE (housekeeping + ward boy task surface), and
 *     Bed / Room status enums include "Maintenance" / "Under
 *     Maintenance", but neither is a role. Any pre-R7bb permissions
 *     entry referencing role="Maintenance" was a phantom — confirmed
 *     ZERO matches in the matrix as of R7bb-FIX-C-2.
 *
 * The roleCan() helper emits a console.warn the first time it is
 * invoked with role=Radiologist or role=Physiotherapist so support
 * notices ghost-accounts and either upgrades their setup or deletes
 * the row before they file a "broken login" ticket.
 *
 * R7bb-FIX-C-3: Pharmacist intentionally EXCLUDED from `mar.read`.
 * NABH MOM (Medication Order Management) reads are a Nurse-team
 * responsibility — Pharmacist only sees their own indent queue (raised
 * by Nurse / Doctor) plus the pharmacy stock + sales register. They
 * do NOT need to read the per-patient MAR (medication administration
 * record). Confirmed against R7ba D1-CRIT-5.
 * ────────────────────────────────────────────────────────────────────
 */

const ACTIONS = {
  // User & access management
  "users.read":            ["Admin"],
  "users.write":           ["Admin"],
  "users.reset-password":  ["Admin"],
  "users.signature":       ["Admin"],
  "users.deactivate":      ["Admin"],

  // Hospital identity / settings
  "settings.read":         ["Admin"],
  "settings.write":        ["Admin"],

  // Departments + doctor master
  "departments.read":      ["Admin", "Doctor", "Nurse", "Receptionist"],
  "departments.write":     ["Admin"],
  "doctors.read":          ["Admin", "Receptionist", "Doctor", "Nurse"],
  "doctors.write":         ["Admin"],

  // Reception flows
  "reception.register":    ["Admin", "Receptionist"],
  "reception.discharge":   ["Admin", "Receptionist"],
  "reception.visitor-pass":["Admin", "Receptionist", "Security"],

  // Security — gate log + incident reports. Receptionist gets read access
  // through the dashboard widgets they share with Security; Admin gets
  // everything by default elsewhere but the explicit list keeps it grep-able.
  "security.gate-log":        ["Admin", "Security", "Receptionist"],
  "security.incident-report": ["Admin", "Security"],

  // Patient demographics vs clinical edits — split so receptionist can fix a
  // misspelled name / contact but can't rewrite blood group, DOB, allergies,
  // gender (any of which would silently corrupt cross-checks like transfusion
  // compatibility, paediatric dosing, drug-allergy alerts).
  //
  // R7bb-FIX-C-6/D2-CRIT-1: `patient.read` historically granted 9 roles
  // broad read access — too much for full clinical-file dumps. The
  // canonical demographic token is now `patient.read-demographics`
  // (identical role set, kept under the old name for backwards-compat
  // with the ~40 routes already gated). Anything that exposes the full
  // clinical file (notes / MAR / labs aggregated) should require the
  // narrower `patient-file.read` (Admin/Doctor/Nurse/MRD) declared
  // further down. Pharmacy / Lab / Dietician / TPA / Accountant get
  // demographics so they can attach a charge or sample to the right
  // UHID, NOT the full clinical narrative.
  "patient.read":               ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
  "patient.read-demographics":  ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
  "patient.write-demographics": ["Admin", "Receptionist"],
  "patient.write-clinical":     ["Admin", "Doctor", "Nurse"],
  "patient.delete":             ["Admin"],
  // Full data export (FHIR bundle, complete file dump) — clinical role only,
  // gated on top of a DPDP consent check at the controller level.
  "patient.export":             ["Admin", "Doctor"],

  // Clinical
  "rx.write":              ["Admin", "Doctor"],
  // Accountant added so /pharmacy/stats and /pharmacy/registers/* (the GST
  // register, sales register, expiry register etc.) are reachable for the
  // accounts console. They are read-only for Accountant — no write is
  // exposed via this action.
  "rx.read":               ["Admin", "Doctor", "Nurse", "Pharmacist", "Accountant"],
  "ipd.assign-bed":        ["Admin", "Receptionist", "Doctor"],
  // Clinical discharge — the medical decision that the patient is safe to
  // leave. Receptionist is intentionally NOT here (security audit 2026-05-17,
  // finding B-05/A-13). The "reception.discharge" action below covers the
  // bill-counter discharge step a receptionist legitimately performs.
  "ipd.discharge":         ["Admin", "Doctor"],
  "ipd.cancel":            ["Admin", "Doctor"],
  "ipd.transfer":          ["Admin", "Doctor", "Nurse"],
  "ipd.delete":            ["Admin"],
  "ipd.discharge-summary": ["Admin", "Doctor"],
  "vitals.write":          ["Admin", "Nurse", "Doctor"],
  "mar.write":             ["Admin", "Nurse"],
  "doctor-orders.write":   ["Admin", "Doctor"],
  // R7m: Nurse-side actions on doctor orders. Acknowledge is the
  // first formal touch before any dose administration (NABH MOM.3).
  // Stop/cancel orders are a doctor-only action — nurses can only
  // hold the next dose, not discontinue the whole prescription.
  "order.acknowledge":     ["Admin", "Nurse", "Doctor"],
  "order.stop":            ["Admin", "Doctor"],
  // R7n: Consent forms (NABH PRE.3 / PRE.4). Doctor / Nurse capture +
  // sign / refuse / revoke; Admin can also edit. DELETE is Admin-only
  // because a signed/refused consent is a legal record.
  "consent.write":         ["Admin", "Doctor", "Nurse"],
  "consent.delete":        ["Admin"],

  // Pharmacy
  "pharmacy.dispense":     ["Admin", "Pharmacist"],
  // ── Pharmacy indent workflow ──────────────────────────────────
  //   raise   = nurse/doctor creates an indent for an admitted patient
  //   read    = anyone in the loop (nurse sees own, pharmacist sees queue)
  //   fulfill = pharmacist acknowledges + releases (full pharmacy tier)
  //   cancel  = either side can cancel (nurse-raised-in-error / pharm reject)
  "indent.raise":          ["Admin", "Nurse", "Doctor"],
  "indent.read":           ["Admin", "Nurse", "Doctor", "Pharmacist", "Receptionist"],
  "indent.fulfill":        ["Admin", "Pharmacist"],
  "indent.cancel":         ["Admin", "Nurse", "Pharmacist"],
  "pharmacy.grn":          ["Admin", "Pharmacist"],
  "pharmacy.return":       ["Admin", "Pharmacist"],
  "pharmacy.add-items":    ["Admin", "Pharmacist"],
  "pharmacy.cancel":       ["Admin", "Pharmacist"],
  "pharmacy.settings":     ["Admin", "Pharmacist"],
  // R7bd-E-1 / A2-MED-16 — NDPS Schedule-X register. Separate from the
  // existing pharmacy.* tokens because narcotic dispense + daily
  // verification are higher-stakes than routine Schedule-H dispense:
  // the witness rule + append-only ledger are statutory under NDPS Rule
  // 65. Read shares the same tier so the register isn't leaked outside
  // the pharmacy team.
  "pharmacy.schedule-x.write": ["Admin", "Pharmacist"],
  "pharmacy.schedule-x.read":  ["Admin", "Pharmacist"],
  // R7bd-E-2 / A2-MED-18 — pharmacy cycle-count / stock-take. Same tier
  // as the rest of pharmacy; verification requires a SECOND pharmacist
  // (separation-of-duties enforced in the service, not via permission).
  "pharmacy.stock-take":       ["Admin", "Pharmacist"],

  // Lab — outsourced workflow. Lab Technician transcribes external reports
  // for every investigation type — labs, imaging, micro, histopath. Treating
  // doctor verifies.
  //
  // R7bb-FIX-C-2: Radiologist re-enabled on the imaging / report write-up
  // surface (lab.read, lab.records.read, lab.result-entry, lab.verify,
  // lab.dispatch). They were stripped on 14 May 2026 ahead of an "in-house
  // imaging coming later" plan, but the role still exists in the User
  // enum — leaving it permission-less means a freshly created Radiologist
  // can log in and immediately hit 403 on every endpoint. Restore the
  // imaging-workflow surface so existing accounts stay functional. If the
  // out-sourced-only model changes, drop them back to lab.records.read.
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  // R7bb-FIX-C-1/S1: `lab.read` is the canonical investigation-order
  // read token referenced in the audit map. Shares the role set with
  // `lab.records.read` (one for the order-queue surface, one for the
  // manual data-entry register). Routes pick whichever name matches
  // their URL (investigation-orders → lab.read; lab-records → lab.records.read).
  "lab.read":              ["Admin", "Doctor", "Nurse", "Lab Technician", "Radiologist", "MRD"],
  "lab.result-entry":      ["Admin", "Lab Technician", "Radiologist"],
  "lab.verify":            ["Admin", "Doctor", "Radiologist"],
  "lab.dispatch":          ["Admin", "Lab Technician", "Radiologist"],
  // R7z: split cancellation from dispatch. Lab Tech can print/dispatch
  // reports but should NOT be able to cancel a doctor's order — that's a
  // clinical decision (was the test no longer indicated?). The cancel
  // flow also reverses billing line items, so it doubles as a financial
  // override — definitely not Lab Tech's call. Sample rejection (bad
  // collection, hemolysis) stays a Lab Tech action via lab.result-entry.
  "lab.cancel":            ["Admin", "Doctor"],
  // Manual lab data entry — trend sheets + imaging / micro / histopath
  // reports (everything outsourced labs send back as paper/PDF).
  // R7bb-B/D4-CRIT-investigation-orders: Radiologist + MRD added so they
  // can read lab + imaging records on the investigation-orders surface.
  "lab.records.read":      ["Admin", "Doctor", "Nurse", "Lab Technician", "Radiologist", "MRD"],
  "lab.records.write":     ["Admin", "Lab Technician", "Radiologist"],
  "lab.records.verify":    ["Admin", "Doctor", "Radiologist"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  // R7bp-FIX-PERMS / D8-CRIT — Doctor + Nurse added so the OPD / Emergency
  // "Services & Orders" panel (ServicesOrdersPanel.jsx) can POST /billing/create
  // + /billing/:billId/add-service. Pre-R7bp these were gated to
  // Admin/Accountant/Receptionist only, so every Doctor click → silent 403.
  // The 403 then masqueraded as the underlying billNumber-dup-key bug
  // (toast read "Could not add to bill" / "duplicate key") because the
  // user-facing UI couldn't distinguish 403 from 500-E11000.
  //
  // SAFE: this only grants the create-draft + add-service paths. The
  // defense-in-depth `blockNonClinicalForDoctorNurse` middleware in
  // middleware/auth.js (mounted in routes/index.js) still blocks every
  // money-touching POST (/payment, /refund, /cancel, /settlement-adjust,
  // /credit-notes, /advance/*, /cashier-sessions/*, /uhid/*/collect-all,
  // /uhid/*/bulk-settle) for Doctor/Nurse — so the financial controls
  // stay intact. Doctor/Nurse can attach a clinical order to a bill
  // (orderStatus="Ordered", not billable until lab/radiology completes
  // it), they CANNOT take payments or move money.
  "billing.write":         ["Admin", "Accountant", "Receptionist", "Doctor", "Nurse"],
  "billing.refund":        ["Admin", "Accountant"],
  "billing.discount":      ["Admin", "Accountant"],
  // IPD Live Ledger — strict tiered actions per design memo
  //   undo     = receptionist's 15-min "oh no I shouldn't have triggered that"
  //              window. Auto-charges only. Controller enforces the time gate
  //              + auto-charge gate; the action just opens the door.
  //   override = edit qty / unit price after the fact, mandatory reason.
  //              Accountant-grade — affects revenue, needs audit.
  //   cancel-charge = irreversibly mark a trigger as cancelled (won't bill
  //              even if it was still pending). Same tier as override.
  "billing.undo":          ["Admin", "Accountant", "Receptionist"],
  "billing.override":      ["Admin", "Accountant"],
  "billing.cancel-charge": ["Admin", "Accountant"],
  // Manual charge add — any clinician/desk staff who's expected to bill
  // ad-hoc items (consultant fee, procedure, nursing consumable). Doctors
  // and nurses can ADD a charge (they know what they delivered) but
  // CANNOT set the price — controller drops req.body.unitPrice for them
  // so they bill at ServiceMaster tariff. Accountant/Admin can override.
  "billing.manual-charge": ["Admin", "Accountant", "Receptionist", "Doctor", "Nurse"],

  // TPA / cashless
  //
  // R7bb-FIX-C-7/D2-CRIT-2: split the legacy `tpa.pre-auth` into two tokens.
  //   tpa.case-file   = attaching pre-auth / submitting a request on a
  //                     specific admission's bill. Reception desk + TPA
  //                     coordinator (front-counter clerk + insurance team).
  //   tpa.master-edit = CRUD on the TPA insurance-company master record.
  //                     Receptionist must NOT be able to rewrite the
  //                     payor master (tariff sheets, allowed services,
  //                     contact details) — that's contractual data.
  //                     Restricted to TPA Coordinator + Admin only.
  // `tpa.pre-auth` retained as an alias for the case-file action so any
  // in-flight callers / dashboards keep working; mark as deprecated.
  "tpa.pre-auth":          ["Admin", "TPA Coordinator", "Receptionist"], // deprecated alias for tpa.case-file
  "tpa.case-file":         ["Admin", "TPA Coordinator", "Receptionist"],
  "tpa.master-edit":       ["Admin", "TPA Coordinator"],
  "tpa.claim":             ["Admin", "TPA Coordinator"],

  // Dietician — patient nutritional assessment + diet plan assignment
  "diet.read":             ["Admin", "Dietician", "Doctor", "Nurse"],
  "diet.write":            ["Admin", "Dietician"],

  // Ward Boy — task board (patient transport, equipment fetch, errands).
  //   read    = anyone in the IPD circle (so a nurse can see her request
  //             was claimed and which ward boy is on it)
  //   create  = clinical staff who raise the request (Nurse / Doctor /
  //             Receptionist) and Ward Boy themselves (ad-hoc log)
  //   fulfill = Ward Boy only (accept/start/complete)
  //   admin   = Admin-only free-form edit (priority bump, etc.)
  "ward.read":             ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping"],
  "ward.create":           ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy"],
  "ward.fulfill":          ["Admin", "Ward Boy"],
  "ward.admin":            ["Admin"],
  // Phase B / C — operations beyond the basic task board
  "ward.shift":            ["Admin", "Ward Boy", "Housekeeping"],   // clock in/out for support staff
  "ward.equipment":        ["Admin", "Ward Boy", "Nurse"],          // issue / return register
  "ward.supplies":         ["Admin", "Ward Boy", "Housekeeping", "Nurse"],
  "ward.code-blue":        ["Admin", "Doctor", "Nurse", "Ward Boy"],
  "ward.mortuary":         ["Admin", "Doctor", "Nurse", "Ward Boy"],
  "ward.manage":           ["Admin", "Nurse"],                       // KPI dashboard

  // Housekeeping — cleaning task board + spillage + inventory +
  // NABH cleaning checklist + pest control + manager KPIs
  //
  // R7bb-FIX-C-12/D2-HIGH-4: Housekeeping role added to `house.manage`
  // (manager-stats endpoint). Pre-R7bb the role couldn't see its own KPI
  // dashboard — Admin and Nurse-in-charge could, but a housekeeping
  // supervisor logging in to monitor their own team's metrics 403'd.
  // Same pattern as ward.manage (Admin + Nurse-in-charge); housekeeping
  // adds itself because there is no separate "Housekeeping Supervisor"
  // role and a senior housekeeper is the closest in-org equivalent.
  "house.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping", "Ward Boy"],
  "house.create":          ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping"],
  "house.fulfill":         ["Admin", "Housekeeping"],
  "house.spillage":        ["Admin", "Doctor", "Nurse", "Housekeeping"],
  "house.inventory":       ["Admin", "Housekeeping"],
  "house.checklist":       ["Admin", "Housekeeping"],
  "house.pest":            ["Admin", "Housekeeping"],
  "house.manage":          ["Admin", "Nurse", "Housekeeping"],

  // Reports
  "reports.financial":     ["Admin", "Accountant"],
  "reports.clinical":      ["Admin", "Doctor"],
  // Accountant added so /billing-audit-trail is reachable — audit-trail review
  // is a core accountant function (catch unauthorized refunds / cancellations).
  "reports.audit":         ["Admin", "Accountant"],

  // ── Medical Records Department (R7i) ────────────────────────
  // Replaces the paper MRD function. Read-only access to every
  // discharged patient's complete file: notes, MAR, vitals,
  // labs, consents, bills, payments. MRD users cannot WRITE
  // anywhere — the only "write" is admin-only same-day
  // re-activation when a discharged patient's condition
  // deteriorates before they leave the premises.
  "mrd.read":              ["Admin", "Doctor", "MRD"],
  "mrd.list":              ["Admin", "Doctor", "MRD"],
  "mrd.write":             ["Admin"],
  // Same-day discharge undo — Admin ONLY, time-gated by
  // controller (≤ 24h since actualDischargeDate) and bed
  // must still be free.
  "admission.reactivate":  ["Admin"],

  // ── R7az-A/D1+D9 — new PHI/clinical read tokens + write splits ──
  // Read tokens for clinical surfaces that were ungated pre-R7az.
  // MRD is included on every read action that maps to a discharged-
  // patient file element so the MRD console remains functional.
  "patient-file.read":         ["Admin", "Doctor", "Nurse", "MRD"],
  "doctor-notes.read":         ["Admin", "Doctor", "Nurse", "MRD"],
  "nurse-notes.read":          ["Admin", "Doctor", "Nurse", "MRD"],
  "mar.read":                  ["Admin", "Doctor", "Nurse", "MRD"],
  "discharge-summary.read":    ["Admin", "Doctor", "Nurse", "MRD"],
  "discharge-summary.write":   ["Admin", "Doctor"],
  // MLC reads include Nurse (treatment-team awareness) but writes
  // are clinician-only — police-relevant document, the nurse cannot
  // author or amend an MLR.
  "mlc.write":                 ["Admin", "Doctor"],
  "mlc.read":                  ["Admin", "Doctor", "Nurse"],
  // IPD list reads — mirror of ipd.write but allows Receptionist
  // (transfer-board read) on top of clinicians.
  "ipd.read":                  ["Admin", "Doctor", "Nurse", "Receptionist"],
  // OPD / ER reads — same audience as IPD reads (front desk + clinicians).
  // R7bb-FIX-C-1/S1 (D4-CRIT): adds explicit tokens for /api/opd/* and
  // /api/emergency/* reads. Previously gated on `patient.read` which is
  // wider (Pharmacist / Lab Tech / Dietician / TPA / Accountant). They do
  // NOT need to enumerate the OPD / ER queue (diagnosis + triage = PHI).
  "opd.read":                  ["Admin", "Doctor", "Nurse", "Receptionist"],
  "er.read":                   ["Admin", "Doctor", "Nurse", "Receptionist"],
  // R7cr — narrower scope than `opd.read`: lets Pharmacist hit ONE
  // endpoint (GET /opd/uhid/:UHID/today-rx) to pull today's prescribed
  // medicines + diagnosis context for a specific UHID, so they can
  // dispense from the same screen. Does NOT grant the full OPD queue
  // (which leaks every patient's diagnosis / token / chief complaint).
  "pharmacy.rx-lookup":        ["Admin", "Doctor", "Nurse", "Receptionist", "Pharmacist"],
  // R7bb-FIX-C-11/D2-HIGH-2: OPD / ER DELETE is a clinical record
  // deletion — only Admin and the assigned Doctor should perform it.
  // Receptionist explicitly removed (pre-R7bb the route accepted
  // reception.register which let any front-desk staffer wipe a visit
  // record without the clinician's sign-off).
  "opd.delete":                ["Admin", "Doctor"],
  "er.delete":                 ["Admin", "Doctor"],
  // Consultation add/update on an admission's treatment team —
  // separated from ipd.transfer because Nurse should NOT add a
  // consultant (clinical decision).
  "consultation.write":        ["Admin", "Doctor"],
  // Safety surface (break-glass, two-ID confirm, surgical checklist,
  // pain reassessment). Previously routed through mar.write which
  // excluded Doctor — now its own permission so Doctor can confirm.
  "safety.write":              ["Admin", "Doctor", "Nurse"],
  // Sliding-scale insulin scale edits — a prescribing decision (mar
  // entries against the scale are still mar.write for Nurse).
  "diabetic.scale.write":      ["Admin", "Doctor"],
  // Doctor-self mutations on the doctor master row (availability,
  // serve-next, etc.). Controller-level "you're editing your own row"
  // check remains; this action gate keeps non-doctors out entirely.
  "doctor.self.write":         ["Admin", "Doctor"],
  // R7bb-FIX-C-15/D4-MED-3: `/api/doctors/me` is matrix-invisible — wrap
  // it in its own read token so the audit can grep the surface. The
  // controller already scopes to req.user.id; this gate just keeps a
  // logged-in Pharmacist / Ward Boy / Security from probing the
  // endpoint to find out whether a Doctor profile is linked to their
  // user id (information disclosure even though the response would be
  // null for non-Doctor roles).
  "doctor.self.read":          ["Admin", "Doctor"],
  // ServiceMaster reads (catalogue lookup for ServiceAutocomplete).
  // Doctor/Nurse/Pharmacist/Lab Tech all legitimately need the
  // catalogue to attach an order — pre-R7az the gate was billing.read
  // which excluded clinicians.
  "services.read":             ["Admin", "Doctor", "Nurse", "Receptionist", "Pharmacist", "Lab Technician"],
  // Appointment confirm flow — explicitly desk-staff-only, audit point.
  "appointment.confirm":       ["Admin", "Receptionist"],

  // ── R7bb-FIX-C-1 (S1: 38 ungated routes) — new explicit tokens ────
  // Med-reconciliation read — NABH MOM.4d home-meds vs admission-orders.
  // Pharmacist included so the pharmacy team can sanity-check active
  // orders against the home-med list when filling an indent; MRD
  // included so the discharged-file aggregator can render it.
  "med-recon.read":            ["Admin", "Doctor", "Nurse", "Pharmacist", "MRD"],
  // Nursing care plan — NABH IPSG nursing-team record. Same audience
  // as the parent nurse-notes.read but separated so audit-grep finds
  // every care-plan touch independently.
  "nursing.care-plan.read":    ["Admin", "Doctor", "Nurse", "MRD"],
  // Equipment master — asset register (vendor / cost / serial / current
  // assignment). Reads broad (any ward staff member needs to find a
  // ventilator); writes restricted to Admin + Ward Boy + Nurse +
  // Housekeeping. Mirrors ward.read / ward.equipment one-to-one;
  // separate names so the audit can grep /api/equipment independently.
  "equipment.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping"],
  "equipment.write":           ["Admin", "Ward Boy", "Nurse"],
  // 2FA gate — explicit auth surface for the OTP request + verify endpoints
  // (/api/2fa/request, /api/2fa/verify). Pre-R7bb these sat on safety.write
  // which conflated two-ID confirm + surgical-checklist + 2FA OTP into one
  // gate. Now they have their own token for grep-ability and because OTP
  // request is a Clinical / Admin operation, not strictly a safety
  // attestation. Role set mirrors safety.write (Admin / Doctor / Nurse).
  "auth.2fa":                  ["Admin", "Doctor", "Nurse"],
  // Presence heartbeat list (who's online). Admin-only since the
  // active-user roster is operational telemetry, not clinical.
  "presence.read":             ["Admin"],
  // Self-service password change — every authenticated user can
  // rotate their own password. The controller scopes to req.user.id
  // so this action gate exists for symmetry with the frontend
  // sidebar entry and so the route-middleware sweep audit can flag
  // any handler accidentally exposing it without authentication.
  "users.change-password-self": [
    "Admin", "Receptionist", "Doctor", "Nurse", "Dietician",
    "TPA Coordinator", "Pharmacist", "Lab Technician", "Radiologist",
    "Physiotherapist", "Accountant", "Ward Boy", "Housekeeping",
    "Security", "MRD",
  ],

  // ── R7bb-FIX-C-5/S12 — senior-doctor attestation ─────────────────
  // Required for signing: discharge-summary finalize, MLR finalize,
  // death certificate, MAR co-sign as physician witness. Today this
  // is identical to "Admin + Doctor" — the User.doctorDetails.designation
  // value is NOT yet enforced (Senior Resident vs Junior Resident vs
  // Consultant). Filed forward for next-cycle middleware to extend the
  // gate with `req.user.designation in ["Consultant", "HOD",
  // "Senior Resident", "Associate Professor", "Professor"]`. Until then
  // any Doctor (incl. PG residents) can sign.
  "signature.consultant-grade": ["Admin", "Doctor"],

  // ── R7bb-FIX-C-2 — Physiotherapist write surface ─────────────────
  // `physio.note.write` is the action a Physiotherapist + Admin can
  // call to log a physiotherapy session note. Route wiring is owned
  // by Agent E (no physio-note route exists yet as of R7bb-FIX-C).
  // Action key registered so a future write endpoint has somewhere
  // to attach a `requireAction(...)`.
  "physio.note.write":         ["Admin", "Physiotherapist"],

  // ── R7bf-G — NABH compliance scaffolds (A5 CRIT subset) ─────────
  // Five new register surfaces. Role sets chosen against the user
  // enum (no dedicated "HR" / "Charge Nurse" / "Safety Officer" roles
  // exist today, so Admin + nearest functional cohort handles each):
  //
  //   clinical.acknowledge-critical / clinical.emit-critical —
  //       AAC.6 critical-value alert. Acknowledge restricted to
  //       bedside clinicians; emit broader so Lab Tech can fire
  //       an alert when a flagged result lands.
  //   pharmacy.adr.write / pharmacy.adr.read — MOM.7 adverse-drug
  //       reaction register. Pharmacist + Doctor + Nurse + Admin
  //       file reports; the same cohort reads (plus Pharmacist for
  //       cross-checking against drug master).
  //   quality.grievance.write / quality.grievance.read — PRE.6
  //       grievance redressal. Reception + MRD raise + drive;
  //       Doctor reads (clinical complaints are treatment-relevant).
  //   hr.credential.write / hr.credential.read — HRD.3 staff
  //       credentialing. Admin owns the register today (no formal
  //       HR role); Doctor reads so they can audit their own row.
  //   compliance.firedrill.write / compliance.firedrill.read —
  //       FMS.4 fire-drill register. Admin + Security cohort owns
  //       the drill log (no formal Safety Officer role).
  //
  // print.audit.write — Agent F's PrintAudit token, filed here so
  // every reprint endpoint can `requireAction("print.audit.write")`.
  // Mirrored to Frontend/src/config/permissions.js.
  "clinical.acknowledge-critical": ["Admin", "Doctor", "Nurse"],
  "clinical.emit-critical":        ["Admin", "Doctor", "Nurse", "Lab Technician"],
  "pharmacy.adr.write":            ["Admin", "Doctor", "Pharmacist", "Nurse"],
  "pharmacy.adr.read":             ["Admin", "Doctor", "Pharmacist", "Nurse"],
  "quality.grievance.write":       ["Admin", "MRD", "Receptionist"],
  "quality.grievance.read":        ["Admin", "MRD", "Receptionist", "Doctor"],
  "hr.credential.write":           ["Admin"],
  "hr.credential.read":            ["Admin", "Doctor"],
  "compliance.firedrill.write":    ["Admin", "Security"],
  "compliance.firedrill.read":     ["Admin", "Security"],
  // R7bo — NABH Inspection Dashboard + auto-populated registers
  // (RBS / Emergency / Blood Transfusion). Read access for the NABH
  // surveyor-facing roles (Admin, Doctor, Nurse, MRD); writes split
  // by domain: RBS via vitals.write, transfusion via doctor-orders.write,
  // emergency is auto-populated and not user-written.
  "compliance.read":               ["Admin", "Doctor", "Nurse", "MRD"],
  "print.audit.write":             ["Admin", "Doctor", "Nurse", "Pharmacist", "Lab Technician", "Receptionist", "MRD"],

  // ── R7bh-F6 — Accountant regulatory + cold-chain (NABH + GST + IT Act) ─
  // Tax returns (GSTR-1, GSTR-3B export workflow) and TDS Form 16A.
  // Both restricted to Admin + Accountant — they're financial records
  // with portal-side ARNs and audit immutability. NABH AAC.7 expects
  // a single auditable owner for outward filings; only the Accountant
  // role consumes these endpoints today.
  "tax.returns.write":             ["Admin", "Accountant"],
  "tax.returns.read":              ["Admin", "Accountant"],
  "tax.tds.write":                 ["Admin", "Accountant"],
  "tax.tds.read":                  ["Admin", "Accountant"],
  // Retention review register surface (compliance.retention.read). MRD
  // owns the retention queue today; Admin gets read access for HIM
  // oversight. Writes (mark-archived, restore, soft-delete) are deferred
  // to a follow-up cycle pending DPDP / IT-44AA legal sign-off.
  "compliance.retention.read":     ["Admin", "MRD"],
  // Pharmacy cold-chain — F5's coordination contract. Write tier is
  // bedside (Pharmacist + Nurse for vaccine fridge logs, Admin for
  // master config); read also includes Doctor for clinical context
  // (vaccine viability when prescribing).
  "pharmacy.cold-chain.write":     ["Admin", "Pharmacist", "Nurse"],
  "pharmacy.cold-chain.read":      ["Admin", "Pharmacist", "Nurse", "Doctor"],

  // ── R7bj-F1 — Physiotherapy plan + session register ───────────
  // Plan is the multi-day rehab prescription (treating Doctor + PT
  // author it; Nurse reads to coordinate). Session is the per-visit
  // record (PT + Admin only — Nurse reads but does not write).
  // Replaces the legacy `physio.note.write` stub (left in place above
  // for backwards-compat) with a proper plan/session split.
  "physio.plan.read":              ["Admin", "Doctor", "Nurse", "Physiotherapist"],
  "physio.plan.write":             ["Admin", "Doctor", "Physiotherapist"],
  "physio.session.read":           ["Admin", "Doctor", "Nurse", "Physiotherapist"],
  "physio.session.write":          ["Admin", "Physiotherapist"],

  // ── R7bj-F2 — Kitchen indent (nurse → kitchen → ward boy → bed) ─
  //   indent.read       — anyone touching the meal-delivery loop
  //   indent.write      — Nurse raises / cancels; Pharmacist (kitchen
  //                       desk today, until a Kitchen role exists)
  //                       marks prepared/served
  //   delivery.write    — Ward Boy marks DELIVERED at the bed (separate
  //                       gate so a Ward Boy can hand-off without
  //                       holding the broader kitchen.indent.write)
  // Dietician on reads so they can audit calorie compliance.
  "kitchen.indent.read":           ["Admin", "Nurse", "Pharmacist", "Ward Boy", "Dietician"],
  "kitchen.indent.write":          ["Admin", "Nurse", "Pharmacist", "Dietician"],
  "kitchen.delivery.write":        ["Admin", "Ward Boy", "Pharmacist"],

  // R7bj-F2 — adverse food reaction register (sentinel-event for diet).
  // Authoring restricted to bedside clinicians (Nurse / Doctor) + the
  // Dietician who owns the diet plan; reads broaden to MRD + Pharmacist
  // (cross-check against drug interactions).
  "quality.food-reaction.read":    ["Admin", "Doctor", "Nurse", "Dietician", "Pharmacist", "MRD"],
  "quality.food-reaction.write":   ["Admin", "Doctor", "Nurse", "Dietician"],

  // ── R7bj-F6 — Compliance registers ────────────────────────────
  //   compliance.bmw.*           — biomedical-waste transport manifest
  //                                (BMWM 2016 + NABH FMS.5). Housekeeping
  //                                + Ward Boy + Admin handle the daily
  //                                cart-out; MRD reads for audit trail.
  //   compliance.code-response.* — rapid-response / code blue / pink /
  //                                purple event log. Doctor + Nurse +
  //                                Admin file events; broader read so
  //                                the Quality team can audit response
  //                                times.
  //   clinical.sharps-injury.*   — HCW needle-stick / sharps injury
  //                                register (NABH HRD.8). Author is the
  //                                injured staff member (any clinical
  //                                role); read scoped to Admin + Doctor
  //                                + the HR cohort (HR role isn't in
  //                                the user enum yet, so Admin proxies).
  "compliance.bmw.read":           ["Admin", "Housekeeping", "Ward Boy", "MRD"],
  "compliance.bmw.write":          ["Admin", "Housekeeping", "Ward Boy"],
  "compliance.code-response.read": ["Admin", "Doctor", "Nurse", "MRD"],
  "compliance.code-response.write":["Admin", "Doctor", "Nurse"],
  "clinical.sharps-injury.read":   ["Admin", "Doctor", "Nurse", "MRD"],
  "clinical.sharps-injury.write":  ["Admin", "Doctor", "Nurse", "Pharmacist", "Lab Technician", "Ward Boy", "Housekeeping"],

  // ── R7bb-FIX-C-13 — DEAD-ACTION CANDIDATES ────────────────────────
  // Sweep below catalogues tokens that no Backend/routes/**/*.js
  // currently consults via requireAction(...). The Frontend `can()`
  // helper may still consult them for UI hiding, so they stay for
  // now. Remove in a future cycle once frontend usage is also dropped.
  //
  //   "billing.discount"            — only referenced in this file;
  //                                   no route depends on it. UI hides
  //                                   the discount button via
  //                                   billing.refund which IS gated.
  //   "ward.read" alias surface     — equipment.read covers /api/equipment,
  //                                   ward.read covers /api/ward-tasks +
  //                                   wardOps; the new equipment.* tokens
  //                                   intentionally duplicate role-sets
  //                                   for grep-ability not deduplication.
  //   "patient.read-demographics"   — currently aliased to patient.read
  //                                   (same role set, separate key for
  //                                   future split). Route layer still
  //                                   uses patient.read everywhere.
  //   "tpa.pre-auth"                — superseded by tpa.case-file /
  //                                   tpa.master-edit (R7bb-FIX-C-7).
  //                                   Still consulted by /api/billing/
  //                                   :billId/tpa-preauth-submit until a
  //                                   follow-up cycle swaps the gate.
  //   "physio.note.write"           — no route uses this yet (Agent E
  //                                   owns wiring).
  //   "signature.consultant-grade"  — no route enforces yet (R7bb-FIX-C-5
  //                                   stub; middleware extension pending).
  //   "mrd.write"                   — no route uses (MRD is read-only).
};

// R7bb-FIX-C-2: phantom-role warning. Emitted once per process per role
// so we don't drown the log with one warning per request.
const _phantomWarned = new Set();
function _maybeWarn(role) {
  if (role === "Radiologist" || role === "Physiotherapist") {
    if (!_phantomWarned.has(role)) {
      _phantomWarned.add(role);
      // eslint-disable-next-line no-console
      console.warn(
        `[permissions] role="${role}" is a deprecated / partially-built role. ` +
        `Users with this role cannot access most of the system. ` +
        `See Backend/config/permissions.js header for the decision log. ` +
        `Build the role's pages (R7ba D6-CRIT-1/2) or remove the enum value.`
      );
    }
  }
}

function roleCan(role, action) {
  if (!role) return false;
  _maybeWarn(role);
  const allowed = ACTIONS[action];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

module.exports = { ACTIONS, roleCan };
