# R7ba — 10-dim user roles + permissions audit (~224 findings)

**Cycle**: R7ba (after R7az shipped 200 fixes from R7ay's Doctor + Nurse role audit)
**Scope**: All ~15 user roles + permissions + workflows audited against NABH HRD/HIC, ISO 27001 A.5/A.7/A.9, DPDP, GST Act §34. Ten orthogonal dimensions, ten parallel agents.
**Output**: this consolidated map. No fixes applied yet.

---

## Severity tally

| Dim | CRIT | HIGH | MED | Notes |
|---|---|---|---|---|
| D1 Role catalog + hierarchy | 5 | 6 | 7 | Phantom roles, no resident/specialty gate |
| D2 Principle of Least Privilege | 3 | 5 | 7 | Receptionist with TPA master, Pharmacist+Nurse with sales register |
| D3 Segregation of Duties | 5 | 7 | 10 | Same cashier collects+refunds; doctor self-finalizes summary |
| D4 Authorization matrix coverage | 14 | 14 | 10 | **Massive** ungated PHI reads |
| D5 Frontend permission parity | 5 | 8 | 13 | Buttons that 403; pages with no RoleGuard |
| D6 Role workflow completeness | 7 | 7 | 10 | Radiologist/Physio dead; Receptionist can't close shift |
| D7 Audit + accountability | 6 | 8 | 6 | **PaymentSchema missing receivedById → all cashier reports broken** |
| D8 Multi-role / locum / role-switch | 4 | 5 | 5 | JWT lacks ward → R7az nurse-scope shipped inert |
| D9 Lockout / MFA / session mgmt | 4 | 9 | 12 | No lockout, no MFA on login, default pw not forced |
| D10 Onboarding/Offboarding/Role-change | 7 | 7 | 8 | Termination doesn't revoke JWT; no UserActivityLog |
| **TOTAL** | **60** | **76** | **88** | **~224 findings** |

---

## Systemic patterns (fix once, ~40 findings collapse)

### S1 — Routes mounted without `requireAction` (matrix invisibility)
D4 found 14 CRIT routes with `authenticate`-only and no action gate: `/api/patients` GET-all, `/api/admissions/*` (15 reads), `/api/opd/*` (8 reads), `/api/emergency/*` (6 reads), `/api/prescriptions/*` (7 reads), `/api/doctor-orders/` + `/:id`, `/api/investigation-orders/*`, `/api/consent-forms/*` reads, `/api/nursing-care-plans/*` reads, `/api/med-reconciliation/admission/:admissionId`, `POST /api/billing/packages/preview`, `POST /api/2fa/*`. Plus 14 HIGH (nursing-charges, visitor-passes, appointments, equipment, bedss, presence) and 10 MED (buildings/floors/wards/rooms/room-categories reads, diabetic-chart reads).

### S2 — JWT missing fields needed by middleware that ships
D8-CRIT-1: JWT carries `{id, role, employeeId, jti}`. R7az's `restrictToOwnNurseWard` reads `req.user.ward` — **always undefined** → middleware no-ops for every Nurse. Same will affect any future scope based on `designation`, `specialization`, `wards[]`, `roles[]`.

### S3 — Token revocation gap on role change / termination / password reset
D9-HIGH-5/6/7, D10-CRIT-1, D10-HIGH-5: `authenticate` validates JWT signature + checks `TokenRevocation` by `jti` only. Never re-checks `User.isActive`/`status`/`role`. So:
- Terminated user keeps ≤8h access window after deactivation.
- Password change does NOT revoke prior tokens.
- Role demotion takes effect at next login only.
- No `/api/auth/logout-all-devices` endpoint.

### S4 — User schema missing core fields
D9-CRIT-1, D10-HIGH-2: `failedLoginAttempts`, `lockUntil`, `passwordChangedAt`, `mustChangePassword`, `passwordHistory[]`, `tokenVersion`, `departureDate`, `terminationReason`, `lastPrivilegeReview`, `privileges[]`, `wards[]` (plural), `roles[]` (plural), `specializations[]` (plural). `resetDoctorPw.js` references `failedLoginAttempts`/`lockUntil` that don't exist.

### S5 — Body-controlled actor strings (audit forgery)
D7-CRIT-3/4, D7-HIGH-1/2: `recordPayment`, `recordRefund`, `tpaApprove`, `cancelBill`, `tpaSettle`, `refundAdvance`, `settlementAdjust`, `generateBill` all accept `req.body.X-by` (e.g. `approvedBy`, `cancelledBy`) and only fall back to `req.user.fullName`. Body wins → actor is forgeable. A Receptionist can record a payment under any other cashier's name.

### S6 — Master-data + HR changes have ZERO audit
D7-CRIT-6, D10-CRIT-3: ServiceMaster (price changes), DrugMaster (price changes), Department CRUD, User CRUD (create/update/deactivate/role-change/password-reset) — none write to BillingAudit or PatientActivityLog or any UserActivityLog (which doesn't exist). NABH HRD.1.h + ISO 27001 A.5.18 + GST §34 maker-checker fail.

### S7 — `PaymentSchema` missing `receivedById` → all cashier reports broken
D7-CRIT-1/2 (showstopper): `PaymentSchema` has `receivedBy` (string name) but NO `receivedById: ObjectId(ref:"User")`. Cashier shift query (`cashierSessionController.js:107` + `index.js:478`) filters by `"payments.receivedById": session.cashierId` — **always returns ZERO**. `expectedClosing = openingCash`, variance = `-closingCash`. Every cashier shift reconciliation is broken hospital-wide.

### S8 — Doctor profile sync gap on new user
D10-CRIT-4: `userService.createUser` writes only `User`. Separate `Doctor` collection (with `loginUserId`) is NOT created. Result: a freshly admin-created Doctor logs in but `Doctor.findOne({loginUserId})` → null → `req.doctorProfile` undefined → `restrictToOwnDoctorPatients` no-ops → cannot be set as `attendingDoctorId`. Only the seed script wires it. Any post-seed Doctor created via the admin UI is **broken at the data layer**.

### S9 — Default password + no forced first-login change
D9-CRIT-2, D10-CRIT-5: `seedRoleUsers.js` ships `Welcome@123`. No `mustChangePassword`/`passwordChangedAt`. `adminResetPassword` produces the same unprotected state.

### S10 — Frontend buttons not `can()`-gated → ugly 403 UX
D5-CRIT-1..5, D5-HIGH-1..8: 13+ surfaces where a button visibly invites a user to do something the backend will reject. MAR shown to Pharmacist (sidebar but `mar.read` excludes); MAR "Add Medication" shown to Doctor (read but not write); MRD lands on blank dashboard; Receptionist sees "Next →" on doctor card (`doctor.self.write` 403); TPA "Approve/Deny" buttons unconditional but `tpa.claim` excludes; bed action menu, nursing routes, charges admin all unguarded.

### S11 — Phantom roles in enum but ZERO permissions
D1-CRIT-2, D6-CRIT-1/2: `Radiologist` and `Physiotherapist` are in `User.role` enum + `seedRoleUsers.js` seeds `radio@spherehealth.com`. ZERO action keys reference either role. Logging in is a dead-end — every `requireAction` 403s. Sidebar surfaces lab links → 403 chain.

### S12 — `Junior Resident` = `Consultant` = `HOD` privileges
D1-CRIT-3, D8-HIGH-9: `userModel.doctorDetails.designation` captured but **no gate consults it**. A Junior Resident can sign discharge summaries, MLR, consents, death certificates identically to a Consultant. NABH HRD.2 violation.

### S13 — Termination workflow incomplete
D10-CRIT-1/2/6, D10-HIGH-1/4: No `Terminated` status path (only `Inactive`), no `departureDate`, no `terminationReason`, no PII purge, no auto-reassign of doctor's open admissions/discharge summaries/treatment-team membership, no notification.

### S14 — Token in URL query (`?token=`) accepted on EVERY endpoint
D9-MED-22: `middleware/auth.js:19` accepts `req.query.token` globally — only SSE actually needs it. Token leaks via referer/access-log/browser-history on ANY URL with `?token=` can be replayed against any endpoint.

### S15 — 2FA OTP target supplied by body
D9-HIGH-8: `/api/2fa/request` accepts `phoneToUse = req.body.phone || u.phone`. Attacker can redirect the OTP to their own phone.

---

## CRIT findings (must fix — 60 total)

### Auth / RBAC (D1, D2, D4)
1. **D1-CRIT-1** Phantom role `"Maintenance"` in Sidebar (alias `MT`) — no user can ever have this role.
2. **D1-CRIT-2** Radiologist + Physiotherapist phantom roles (zero actions).
3. **D1-CRIT-3** Junior Resident = Consultant privileges (NABH HRD.2 violation).
4. **D1-CRIT-4** MRD missing from MODULE_ROLES → blank dashboard.
5. **D1-CRIT-5** Sidebar MAR shown to Pharmacist but `mar.read` excludes them.
6. **D2-CRIT-1** `patient.read` token grants 9 roles full PHI access via `/patient-file/:uhid/complete`. Split into `patient.read-demographics` vs `patient-file.read`.
7. **D2-CRIT-2** Receptionist can CRUD TPA insurance company master via `tpa.pre-auth`.
8. **D2-CRIT-3** `/api/doctor-orders` GET-all and `/:id` UNGATED — any role reads any med order.
9. **D4-CRIT-1** thru **D4-CRIT-14** — 14 routes with `authenticate`-only (full PHI leak set; see S1).

### Clinical data integrity / SoD (D3)
10. **D3-CRIT-1** Bill refund: original cashier can refund their own collected payment (no maker-checker).
11. **D3-CRIT-2** Credit Note auto-created inside refund — no second approver per GST §34.
12. **D3-CRIT-3** Advance refund: same actor can collect + refund.
13. **D3-CRIT-4** Doctor self-finalizes their own discharge summary (no co-signer / RMO).
14. **D3-CRIT-5** MLC create + finalize + close = single Doctor role (IPC §201 chain-of-custody fail).

### Frontend UX (D5)
15. **D5-CRIT-1** MAR sidebar shown to Pharmacist — 403 on click.
16. **D5-CRIT-2** MARPage write buttons not gated — Doctor 403 on click.
17. **D5-CRIT-3** MRD lands on blank `/dashboard` body.
18. **D5-CRIT-4** Receptionist's "Next →" button on doctor strip 403s.
19. **D5-CRIT-5** TPACases Approve/Deny buttons unconditional but `tpa.claim` excludes Receptionist + Accountant.

### Role workflow completeness (D6)
20. **D6-CRIT-1** Physiotherapist: zero PT-specific perms/pages/endpoints.
21. **D6-CRIT-2** Radiologist: same dead-end.
22. **D6-CRIT-3** Receptionist: cannot open/close cashier session (no end-of-day report).
23. **D6-CRIT-4** TPA Coordinator: no settlement-entry UI (endpoint exists, no caller).
24. **D6-CRIT-5** Lab Technician: no equipment QC / control samples / reagent register (NABH AAC.6).
25. **D6-CRIT-6** Dietician: cannot push approved plan to kitchen.
26. **D6-CRIT-7** Accountant: cannot lock monthly GST snapshot from UI.

### Audit + accountability (D7)
27. **D7-CRIT-1** `PaymentSchema` missing `receivedById` → cashier shift reports show zero payments hospital-wide.
28. **D7-CRIT-2** Cross-cashier attribution wrong on legacy `receivedById` rows.
29. **D7-CRIT-3** `recordPayment` accepts `receivedBy` from body — forgeable.
30. **D7-CRIT-4** 6 endpoints accept actor from body (`approvedBy`, `cancelledBy`, `settledBy`, `refundedBy`, etc.).
31. **D7-CRIT-5** `tpaPreAuthSubmit` + `tpaDeny` emit NO BillingAudit row.
32. **D7-CRIT-6** Master-data writes (ServiceMaster, DepartmentMaster, DrugMaster) have ZERO audit.

### Multi-role (D8)
33. **D8-CRIT-1** JWT lacks `ward` → R7az nurse-ward scope shipped inert.
34. **D8-CRIT-2** No token revocation on role change / deactivate / ward change.
35. **D8-CRIT-3** No locum / cross-cover schema; treatmentTeam is permanent.
36. **D8-CRIT-4** Single-role User.role blocks owner-doctor + multi-hat staff.

### Lockout / MFA / session (D9)
37. **D9-CRIT-1** No account lockout exists (`failedLoginAttempts` field doesn't exist).
38. **D9-CRIT-2** Default password `Welcome@123` not force-rotated on first login.
39. **D9-CRIT-3** MFA not enforced for any login (only per-action OTPs).
40. **D9-CRIT-4** Password complexity = minlength 6, no rules.

### Onboarding/Offboarding (D10)
41. **D10-CRIT-1** Termination does NOT invalidate active JWTs (≤8h post-termination access).
42. **D10-CRIT-2** No "Terminated" path — only `Inactive`. Schema enum has Terminated/Suspended but no code path writes them.
43. **D10-CRIT-3** Zero audit trail for user-management actions.
44. **D10-CRIT-4** Doctor profile NOT auto-created when User created with role="Doctor".
45. **D10-CRIT-5** Default password `Welcome@123` with no forced first-login change.
46. **D10-CRIT-6** `updateUser` permits silent termination bypass via arbitrary status write.
47. **D10-CRIT-7** Seed scripts have NO production-env gate.

---

## HIGH findings (76 total — selected; full per-dim sections in agent reports)

- **D1-HIGH-1..6**: Lab section shown to Radiologist (empty section), missing roles per NABH HRD (Anesthesiologist, Blood Bank, Infection Control, Quality Manager, etc.), `nurseDetails.nursingType` never consulted, 6 roles never seeded, dead PT alias in Sidebar, Ward Boy/Housekeeping lack `patient.read`.
- **D2-HIGH-1..5**: bedss/housekeeping queue gated wrong, OPD/ER DELETE allowed to Receptionist, `rx.read` allows Doctor/Nurse access to GST register, `house.manage` excludes Housekeeping role itself, nurse-notes/doctor-notes delete allows any peer.
- **D3-HIGH-1..7**: User-create+role-assign collapsed, TPA Coordinator submits+approves, ServiceMaster create+update no maker-checker, HAM 2-nurse verification is free-text string (not separate-user gate), consent author = signatory, cashier shift self-close, manual-charge+pay+void chain by same Receptionist.
- **D4-HIGH-1..14**: nursing-charges + visitor-passes + appointments + equipment + bedss + presence routes ungated, `/api/tpa/test` shipped to prod, `/api/doctors/me` matrix-invisible, raw `authenticate` on `/auth/me`+signature, ShiftHandoverRoutes never mounted (dead code), 10 dead permission keys, hospital-settings ungated.
- **D5-HIGH-1..8**: bed-visual action menu ungated, all 10 nursing-write routes lack RoleGuard, HospitalChargesList/DepartmentManagement Add+Edit+Delete unconditional, InvestigationOrders Cancel button shown to all viewers, WardBoyConsole claim/start/complete shown to non-Ward Boy, /mlc unguarded, /emergency-assessment unguarded.
- **D6-HIGH-1..7**: Pharmacist no return-to-vendor, MRD no retention review, Lab no retest, Security no shift attendance, TPA no dedicated workspace, Admin no backup/restore UI, no pharmacy end-of-day cash close.
- **D7-HIGH-1..8**: `settlementAdjust` body actor, `generateBill` "Staff" literal fallback, bulk actions emit no per-leg audit, `voidPayment` lacks actorId/actorRole, `listBillingAudit` filter has no actor params, no cross-patient activity feed, `retainUntil` TTL index never synced, dischargeAdmission uses "System (discharge cascade)" hardcoded.
- **D8-HIGH-5..9**: No idle-timeout/auto-logout, no quick role-switch/impersonation, cross-tab logout not signalled, Doctor.specialization scalar, designation not consulted by any gate.
- **D9-HIGH-5..13**: Password change doesn't revoke tokens, no admin unlock/force-logout endpoint, OTP target from body, devOtp in JSON without SMS_PROVIDER, no per-account login-attempt limit, token in URL query (SSE leak), no password rotation/reuse-prevention policy.
- **D10-HIGH-1..7**: No open-clinical-work reassignment on Doctor offboarding, missing password fields, signature self-write has no audit, `assignHOD` mass-update silent, role-change has no dedicated workflow, no PII purge on termination (DPDP §8), `loginUserId` link rotted by re-onboarding.

---

## MED findings (88 total — selected highlights)

- **D1-MED-1..7**: Dead DT alias, Doctor.specialization free-text vs Doctor.professional enum, Accountant no spending cap, RoleSeesModule vs sidebar drift, Receptionist auto-bed-assign without doctor sign-off, homePathForRole missing branches.
- **D2-MED-1..7**: 4 inline `role === "Admin"` checks invisible to matrix, 7 dead permission keys, lab.order allows Receptionist to fabricate orders, bedss reads ungated, house.spillage/code-blue clinical splits needed, MRD excluded from patient.read, ward.equipment lets Nurse CRUD asset master.
- **D3-MED-1..10**: GRN+dispense by same Pharmacist (D&C separation), bill-cancel+refund same gate, lab cancel reverses billing without Accountant, bulk-settle no threshold-approver, bed-transfer Nurse unilateral, nursing self-mark of initial-assessment, indent raise+cancel same Nurse, doctor manual-charge bypasses Accountant, BillingAudit silent catches, order.stop same-doctor.
- **D7-MED-1..6**: PatientActivityLog missing role index, dead `userRole` fallback, prevHash refetched per write (cache opportunity), voided-leg lacks attribution, cancelBill body fallback, no DPDP forget path.
- **D8-MED-10..14**: Concurrent sessions unlimited, attemptAuth silently drops on revoke, User.ward scalar (no multi-ward shift cover), past attribution string-frozen (correct), no terminal_id / kiosk concept.
- **D9-MED-14..25**: bcrypt 10 (12 better), no auth audit log, no forgot-password flow, JWT secret no rotation, idle-timeout only on PatientPanelShell, no concurrent-session limit, JWT expiry not per-role, timing-dummy hash hardcoded, query token accepted everywhere not SSE-only, no CAPTCHA on login, logout revokes single jti only, admin-reset-pw minlength check inconsistent.
- **D10-MED-1..8**: No credentialing/privilege fields, no MCI/NMC validation, no email infra, no bulk import/export, no transfer history, employeeId regen race after restore, no Suspension distinct from Inactive, no self-service phone/photo edit.

---

## Recommended attack order (R7bb cycle)

Given the systemic nature, fixing the patterns S1-S15 closes ~60+ findings:

1. **First**: Fix S7 (PaymentSchema missing receivedById) — hospital-wide breakage. Foundational.
2. **Then S3 + S4**: Add `passwordChangedAt`, `tokenVersion`, `failedLoginAttempts`, `lockUntil`, `wards[]`, `roles[]`, `passwordHistory[]` to User model. Make `authenticate` re-check `User.isActive` + `tokenVersion`.
3. **Then S5**: Drop body actor strings everywhere; server uses `req.user.fullName` only.
4. **Then S1**: Sweep ungated routes — add `requireAction()` to the 38 routes flagged.
5. **Then S6 + S13**: Add `UserActivityLog` model + service. Wire HR events. Add `Terminated`/`Suspended` workflow with proper status + reason + revocation.
6. **Then S8 + S10**: Auto-create Doctor profile on User create; sweep frontend `can()` gates on buttons.
7. **Then S2 + S11 + S12**: Add `ward`/`designation`/`specializations` to JWT. Either kill phantom roles or build their pages. Add `designation` gates on signature-bearing actions.
8. **Then S9**: Add `mustChangePassword` + force on first login + after `adminResetPassword`.
9. **Then S14**: Restrict `?token=` query param to a whitelist of SSE paths.
10. **Then S15**: 2FA OTP target must be `req.user.phone`, never body.

After S1-S15, run delta audit to find what's left in the long tail (~80 MED items).

---

## What this audit reveals about the platform

The system is built around the SINGLE-USER, SINGLE-ROLE assumption. Every concession to real hospital staffing (multi-hat staff, locum coverage, multi-ward shifts, sub-specialty privileges, designation tiers) is missing or hacked-in. The auth layer is bcrypt + JWT — solid for one-shot login but lacks every operational hardening NABH HIC.5 + ISO 27001 A.9 expect. The HR workflow is essentially "Admin clicks Create User → Admin clicks Toggle Active" with no audit, no notification, no reassignment, no PII lifecycle.

The biggest single-day fix is **D7-CRIT-1** (PaymentSchema → receivedById) — that's why every cashier dashboard "looks empty" today. The biggest architectural debt is **S2 + S4** (User model needs ~10 new fields to support real auth + role hardening + lockout + multi-role). The biggest compliance debt is **S3 + S13** (termination doesn't revoke; no HR audit trail; no DPDP PII purge).

---

*Authored R7ba by Dr Sandeep + Claude. Audit only — no fixes. 224 findings across 10 dimensions and ~15 user roles. Full per-dimension findings preserved in agent transcripts.*
