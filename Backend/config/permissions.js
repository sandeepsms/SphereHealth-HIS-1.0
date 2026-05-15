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

  // Clinical
  "rx.write":              ["Admin", "Doctor"],
  // Accountant added so /pharmacy/stats and /pharmacy/registers/* (the GST
  // register, sales register, expiry register etc.) are reachable for the
  // accounts console. They are read-only for Accountant — no write is
  // exposed via this action.
  "rx.read":               ["Admin", "Doctor", "Nurse", "Pharmacist", "Accountant"],
  "ipd.assign-bed":        ["Admin", "Receptionist", "Doctor"],
  "ipd.discharge":         ["Admin", "Doctor", "Receptionist"],
  "ipd.discharge-summary": ["Admin", "Doctor"],
  "vitals.write":          ["Admin", "Nurse", "Doctor"],
  "mar.write":             ["Admin", "Nurse"],
  "doctor-orders.write":   ["Admin", "Doctor"],

  // Pharmacy
  "pharmacy.dispense":     ["Admin", "Pharmacist"],
  "pharmacy.grn":          ["Admin", "Pharmacist"],
  "pharmacy.return":       ["Admin", "Pharmacist"],
  "pharmacy.add-items":    ["Admin", "Pharmacist"],
  "pharmacy.cancel":       ["Admin", "Pharmacist"],
  "pharmacy.settings":     ["Admin", "Pharmacist"],

  // Lab
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  "lab.result-entry":      ["Admin", "Lab Technician"],
  "lab.verify":            ["Admin", "Radiologist", "Doctor"],
  "lab.dispatch":          ["Admin", "Lab Technician"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  "billing.write":         ["Admin", "Accountant", "Receptionist"],
  "billing.refund":        ["Admin", "Accountant"],
  "billing.discount":      ["Admin", "Accountant"],

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

  // Reports
  "reports.financial":     ["Admin", "Accountant"],
  "reports.clinical":      ["Admin", "Doctor"],
  // Accountant added so /billing-audit-trail is reachable — audit-trail review
  // is a core accountant function (catch unauthorized refunds / cancellations).
  "reports.audit":         ["Admin", "Accountant"],
};

function roleCan(role, action) {
  if (!role) return false;
  const allowed = ACTIONS[action];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

module.exports = { ACTIONS, roleCan };
