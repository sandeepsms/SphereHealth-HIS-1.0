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
  "patient.read":               ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
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

  // Lab — outsourced workflow (no in-house Pathologist / Radiologist
  // for now). Lab Technician transcribes external reports for every
  // investigation type — labs, imaging, micro, histopath. Treating
  // doctor verifies. Radiologist removed from the lab.* surface on
  // 14 May 2026 per user direction; role still defined in userModel
  // so it can be re-enabled when in-house imaging comes online.
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  "lab.result-entry":      ["Admin", "Lab Technician"],
  "lab.verify":            ["Admin", "Doctor"],
  "lab.dispatch":          ["Admin", "Lab Technician"],
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
  "lab.records.write":     ["Admin", "Lab Technician"],
  "lab.records.verify":    ["Admin", "Doctor"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  "billing.write":         ["Admin", "Accountant", "Receptionist"],
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
  "tpa.pre-auth":          ["Admin", "TPA Coordinator", "Receptionist"],
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
  "house.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping", "Ward Boy"],
  "house.create":          ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping"],
  "house.fulfill":         ["Admin", "Housekeeping"],
  "house.spillage":        ["Admin", "Doctor", "Nurse", "Housekeeping"],
  "house.inventory":       ["Admin", "Housekeeping"],
  "house.checklist":       ["Admin", "Housekeeping"],
  "house.pest":            ["Admin", "Housekeeping"],
  "house.manage":          ["Admin", "Nurse"],

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
  // ServiceMaster reads (catalogue lookup for ServiceAutocomplete).
  // Doctor/Nurse/Pharmacist/Lab Tech all legitimately need the
  // catalogue to attach an order — pre-R7az the gate was billing.read
  // which excluded clinicians.
  "services.read":             ["Admin", "Doctor", "Nurse", "Receptionist", "Pharmacist", "Lab Technician"],
  // Appointment confirm flow — explicitly desk-staff-only, audit point.
  "appointment.confirm":       ["Admin", "Receptionist"],

  // ── R7bb-B/D4 (S1: 38 ungated routes) — new tokens ───────────
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
};

function roleCan(role, action) {
  if (!role) return false;
  const allowed = ACTIONS[action];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

module.exports = { ACTIONS, roleCan };
