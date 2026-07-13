# ABDM Integration Framework — SphereHealth / BIMS HIS

> Ayushman Bharat Digital Mission (ABDM) HIP integration scaffolding. Ships
> **disabled by default** — a stock HIS deployment is completely unaffected
> until a hospital finishes ABDM onboarding and sets `ABDM_ENABLED=1`.

## What this is

A working **framework** for the hospital to act as an ABDM **HIP** (Health
Information Provider) — link patients' ABHA, expose discoverable care contexts,
receive consent artefacts, and serve encrypted FHIR R4 bundles on request. It
is **sandbox-ready** but not yet milestone-certified: real go-live needs ABDM
Sandbox/Prod credentials, a registered HFR facility, HPR-linked doctors, and
the M1–M3 milestone tests.

## Architecture (all under `Backend/`)

| Layer | File | Role |
|---|---|---|
| Config | `config/abdm.js` | env flags (`ABDM_ENABLED`, creds, HIP id, gateway URLs), `isReady()`, `requireAbdmEnabled` guard, `publicConfig()` |
| Patient | `models/Patient/patientModel.js` | `abhaNumber / abhaAddress / abhaId / abhaLinked / abhaKycVerified` |
| Models | `models/Abdm/AbdmCareContext…` · `AbdmConsentArtefact…` · `AbdmTransaction…` | linkage, consent, gateway journal |
| Crypto | `services/Abdm/abdmCrypto.js` | X25519 ECDH → HKDF-SHA256 → AES-256-GCM (HIE end-to-end encryption) + checksum |
| FHIR | `services/Abdm/abdmFhirR4.js` | wraps the FHIR exporter's collection bundle into an ABDM **document** Bundle + `Composition` (per HI Type) |
| Gateway | `services/Abdm/abdmGateway.js` | cached session token, signed request, typed `on-*` responders, `hiDataPush` |
| Link | `services/Abdm/abdmLinkService.js` | care-context discovery + ABHA linking |
| Data flow | `services/Abdm/abdmDataFlowService.js` | assemble → build FHIR → encrypt → push to HIU + notify |
| Callback auth | `middleware/abdmSignature.js` | HMAC verification of inbound gateway callbacks (raw body captured in `index.js`) |
| Controller | `controllers/Abdm/abdmController.js` | callback handlers (M1–M4) + admin/ops |
| Routes | `routes/ABDM/abdmCallbackRoutes.js` (pre-JWT, `/api/abdm/v0.5/*`) · `abdmAdminRoutes.js` (JWT, `/api/abdm/*`) | |
| Perms | `config/permissions.js` (+ FE mirror) | `abdm.read` / `abdm.write` = Admin |

## Endpoints

**Gateway callbacks** (ABDM calls these; HMAC-authed, 503 when disabled):
`POST /api/abdm/v0.5/care-contexts/discover` · `/links/link/init` ·
`/links/link/confirm` · `/consents/hip/notify` · `/health-information/hip/request`

**Admin / ops** (JWT + `abdm.*`):
`GET /api/abdm/status` · `POST /api/abdm/link-abha` ·
`GET /api/abdm/care-contexts/:uhid` · `GET /api/abdm/fhir-preview/:uhid?hiType=` ·
`GET /api/abdm/transactions`

## Enable (deploy-time)

```bash
ABDM_ENABLED=1 ABDM_ENV=sandbox \
ABDM_CLIENT_ID=… ABDM_CLIENT_SECRET=… \
ABDM_HIP_ID=<HFR-facility-id> ABDM_HIP_NAME="BIMS Hospital" \
ABDM_CM_ID=sbx ABDM_CALLBACK_HMAC_SECRET=<shared-secret> \
ABDM_CALLBACK_BASE_URL=https://<public-host> \
node index.js
```
`GET /api/abdm/status` reports `enabled` + `ready` + config.

## Verified (2026-07-13)

- Crypto X25519+AES-GCM **round-trips** + GCM tamper detection.
- **Full HIE data flow** round-trip: HIP assembles UH01's care context → FHIR R4
  document Bundle → encrypts → HIU decrypts to the exact bundle, checksum verified.
- `/status` reports disabled; `link-abha` sets ABHA + materialises care contexts;
  `fhir-preview` returns a document Bundle with `Composition` first + the
  `https://abdm.gov.in/abha` identifier; callbacks 503 while disabled.
- **E2E 136/136** with the framework flagged off — zero impact on the HIS.

## Before production milestone testing (TODO)

1. **Align the crypto to the certified ABDM library version** — the HKDF
   salt/info + IV derivation in `abdmCrypto.js` is self-consistent but must match
   the ABDM `Encryption/Decryption` reference for the target milestone.
2. **Swap the callback signature scheme** if the milestone uses detached JWS
   (JWKS) instead of a body HMAC (`middleware/abdmSignature.js`).
3. ~~**Enrich the FHIR bundle**~~ — ✅ **DONE 2026-07-13.** The exporter now
   emits per-parameter lab `Observation`s (LOINC + value + reference range +
   H/L/critical interpretation, referenced by the `DiagnosticReport`) and the
   `DischargeSummary` (ICD-10 diagnoses, discharge `MedicationRequest`s,
   ICD-10-PCS `Procedure`s, and a follow-up `CarePlan`). Still open: emit SNOMED
   on doctor-note Conditions (stored in `DoctorNotes.snomedCode`).
4. **HFR/HPR onboarding** — register the facility (HFR id → `HospitalSettings.hfrId`)
   and link doctors' HPR ids (`User.doctorDetails.hprId`).
5. Run the ABDM Sandbox M1 (discovery) → M2 (link) → M3 (consent) → M4 (data)
   milestone suite and obtain certification.
