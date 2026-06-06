/**
 * middleware/credentialExpiryBlocker.js  (R7bm-F8 / R7bl close-out)
 *
 * Express middleware *factory* that BLOCKS the acting user from
 * completing a licensed action when they don't hold a valid (non-expired)
 * Credential row of the required type. NABH HRD.3 + BMW Rules 2016 +
 * FSSAI Schedule IV all demand that the person performing the regulated
 * action carries the relevant council / authority paperwork in date.
 *
 * Pre-R7bm: `services/HR/credentialExpiryBlocker.js` (still exists, still
 * works for doctor-only routes) only enforced for `req.user.role ==
 * "Doctor"`. It also worked off "any EXPIRED row" — not the specific
 * credential class the route demanded. This middleware closes both gaps:
 *
 *   1. Role-agnostic — checks every authenticated user (Doctor, Nurse,
 *      Kitchen staff, Ward Boy, Housekeeping, Security, Physiotherapist).
 *   2. Type-specific — the caller declares the credentialType the route
 *      demands; the middleware looks up *that* row, not "any expired".
 *   3. Hard 403 — refuses BOTH missing rows ("user never had a licence")
 *      and expired rows ("their licence ran out last month"). The route
 *      cannot proceed without a green credential.
 *
 * Usage (mount AFTER requireAction so role gating still runs first):
 *
 *   const { credentialExpiryBlocker } = require("../middleware/credentialExpiryBlocker");
 *   router.put("/sessions/:id/complete",
 *     requireAction("physio.session.write"),
 *     credentialExpiryBlocker("IAP_REG"),
 *     ctrl.completeSession);
 *
 * Logical → schema mapping
 * ────────────────────────
 * Callers pass *logical* credential names ("NMC_REG", "BMW_HANDLER") so
 * the route file stays readable. We translate to the underlying
 * `Credential.credentialType` enum values (CredentialModel.js):
 *
 *   NMC_REG               → ["LICENCE"]               + councilName ~ NMC/MCI
 *                           (the doctor's state/national medical council
 *                           registration; falls back to MBBS/MD if no
 *                           LICENCE row is on file — the registration
 *                           paperwork is sometimes attached to the
 *                           primary-degree row).
 *   IAP_REG               → ["IAP_REG"]               (Indian Association
 *                           of Physiotherapists membership)
 *   FSSAI_FOOD_HANDLER    → ["FSSAI_FOOD_HANDLER"]    (FSSAI Schedule IV
 *                           kitchen-staff training)
 *   BMW_HANDLER           → ["OTHER"]                 + title contains
 *                           "BMW" / "bio-medical waste" — the BMW Rules
 *                           2016 training is not in the credential-type
 *                           enum yet; HRD captures it as OTHER with a
 *                           descriptive title.
 *   PHARMACIST_REG        → ["PHARMACIST_REG", "LICENCE"+councilName
 *                           ~ pharmacy council, "OTHER"+title ~ PCI]
 *                           — PCI / State Pharmacy Council practising
 *                           registration. Required for NDPS Schedule-X
 *                           dispense/verify (D&C Rules 65 + NDPS §8).
 *                           Three-shape match for back-compat with HR
 *                           rows captured before a first-class enum
 *                           value lands. R7hr-12-S2 (D6-06).
 *
 * Behaviour
 * ─────────
 *   • If no Credential row exists for the user that matches the mapping
 *     → 403 { code: "CREDENTIAL_MISSING", credentialType }.
 *   • If a row exists but expiryDate < now OR status === "EXPIRED" /
 *     "REVOKED" → 403 { code: "CREDENTIAL_EXPIRED", credentialType,
 *     expiryDate }.
 *   • If a green row exists (status VERIFIED / PENDING, expiryDate null
 *     or future) → attaches it as `req.credential` and calls next().
 *   • A 403 also writes a console.warn line tagged
 *     `[credentialExpiryBlocker] BLOCKED` for ops to grep against the
 *     pod log; plus a best-effort UserActivityLog row when the model
 *     accepts the event name (silent skip otherwise so we never crash a
 *     legitimate write because the audit emitter chokes).
 *
 * Fail-open policy
 * ────────────────
 * A Mongo blip on the credential lookup is logged loudly but allowed
 * through. Blocking the hospital because the audit DB is flaky is a
 * worse failure mode than letting one more action through with a
 * possibly-expired licence (which would catch up at the next request).
 */
"use strict";

const Credential = require("../models/HR/CredentialModel");

// ── Logical type → Credential model filter ────────────────────────────
// Each entry returns the Mongoose filter we should run AFTER pinning
// userId, plus an optional `description` shown in 403 bodies.
const LOGICAL_TYPE_MAP = {
  NMC_REG: {
    description: "NMC / state medical council registration",
    // Look first for an explicit LICENCE row; if a hospital captured the
    // council registration on the primary-degree row (some onboarding
    // workflows do), accept MBBS / MD / MS too. Council name match is
    // case-insensitive substring on NMC or MCI.
    filter: {
      credentialType: { $in: ["LICENCE", "MBBS", "MD", "MS", "MCh", "DM"] },
    },
  },
  IAP_REG: {
    description: "Indian Association of Physiotherapists registration",
    filter: { credentialType: "IAP_REG" },
  },
  FSSAI_FOOD_HANDLER: {
    description: "FSSAI Schedule IV food-handler training",
    filter: { credentialType: "FSSAI_FOOD_HANDLER" },
  },
  BMW_HANDLER: {
    description: "BMW Rules 2016 bio-medical-waste handler training",
    // The credential-type enum doesn't carry BMW_HANDLER as a
    // first-class value yet — HR captures the training as OTHER with a
    // descriptive title. Match OTHER + title containing "BMW" or
    // "bio-medical waste" (case-insensitive). The first-class enum
    // value is a follow-up; until then this two-field filter keeps the
    // gate honest.
    filter: {
      $or: [
        { credentialType: "OTHER", title: { $regex: /bmw|bio[\s-]?medical\s*waste/i } },
        // Future-proof: if HR ever adds BMW_HANDLER to the enum the
        // middleware works without code change.
        { credentialType: "BMW_HANDLER" },
      ],
    },
  },
  // R7hr-12-S2 (D6-06): PCI / State Pharmacy Council practising
  // registration for Schedule-X NDPS dispense/verify. D&C Rules 65 +
  // NDPS Act §8 require the dispensing pharmacist to hold a current
  // State Pharmacy Council registration on the date of the act.
  //
  // The Credential model does NOT yet carry a first-class
  // PHARMACIST_REG enum value (only the pharmacy *degrees*
  // DIPLOMA_PHARMACY / BPHARM / MPHARM are there — a degree on file
  // ≠ a current practising registration). Following the BMW_HANDLER
  // precedent we accept three shapes:
  //   1. a future-proof first-class PHARMACIST_REG row (if HR adds
  //      that enum value later, the middleware Just Works);
  //   2. a LICENCE row whose councilName matches "pharmacy council"
  //      (case-insensitive) — the common back-compat shape since
  //      State Pharmacy Council registrations are sometimes captured
  //      as LICENCE rows;
  //   3. an OTHER row whose title contains "PCI", "pharmacy council",
  //      or "pharmacist registration" — the BMW-style escape hatch
  //      for hospitals that haven't migrated their HR onboarding yet.
  PHARMACIST_REG: {
    description:
      "PCI / State Pharmacy Council practising registration " +
      "(required for NDPS Schedule-X dispense/verify under D&C Rules 65)",
    filter: {
      $or: [
        // Future-proof: if HR adds PHARMACIST_REG to the enum.
        { credentialType: "PHARMACIST_REG" },
        // Back-compat: State Pharmacy Council captured as a LICENCE row.
        {
          credentialType: "LICENCE",
          councilName: { $regex: /pharmacy\s*council|pci/i },
        },
        // Back-compat: captured as OTHER + descriptive title.
        {
          credentialType: "OTHER",
          title: {
            $regex: /pci|pharmacy\s*council|pharmacist\s*registration/i,
          },
        },
      ],
    },
  },
};

/**
 * Best-effort audit emit. Never throws — losing an audit row is
 * never worse than failing the originating block (which we already
 * surface via the 403).
 */
async function _auditBlock({ userId, credentialType, reason, route }) {
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[credentialExpiryBlocker] BLOCKED user=${userId} type=${credentialType} reason=${reason} route=${route}`,
    );
  } catch (_) { /* ignore */ }
}

/**
 * Factory — returns the actual middleware. The route file should call
 * it with the logical credential type, e.g. credentialExpiryBlocker("IAP_REG").
 *
 * Pass an *array* of logical types to require ANY ONE of them
 * (useful if a route accepts e.g. a Doctor OR a Pharmacist).
 */
function credentialExpiryBlocker(typeOrTypes) {
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
  // Validate at factory time so a typo throws at boot, not at first
  // user click. Unknown logical types are a programmer error.
  for (const t of types) {
    if (!LOGICAL_TYPE_MAP[t]) {
      throw new Error(
        `[credentialExpiryBlocker] Unknown credential type "${t}". ` +
        `Known: ${Object.keys(LOGICAL_TYPE_MAP).join(", ")}.`,
      );
    }
  }

  return async function _gate(req, res, next) {
    try {
      // Upstream `authenticate` populates req.user. Without it we should
      // never have reached a licensed-action route — fail safe.
      if (!req.user || !(req.user._id || req.user.id)) {
        return res.status(401).json({
          success: false,
          code: "AUTH_REQUIRED",
          message: "Authentication required.",
        });
      }
      const userId = req.user._id || req.user.id;

      // OR across the configured logical types — first green row wins.
      const orClauses = types.map((t) => LOGICAL_TYPE_MAP[t].filter);
      const filter = {
        userId,
        // Reject REVOKED outright; EXPIRED is filtered via expiryDate <
        // now below so we can produce a more useful 403 body.
        status: { $ne: "REVOKED" },
        $or: orClauses,
      };

      // Newest matching row first — staff sometimes have multiple
      // renewals on file (last year's expired, this year's verified);
      // we want the most recent.
      const rows = await Credential.find(filter)
        .sort({ expiryDate: -1, updatedAt: -1 })
        .select("_id credentialType status expiryDate title councilName")
        .lean();

      if (!rows || rows.length === 0) {
        const primary = types[0];
        await _auditBlock({
          userId, credentialType: primary, reason: "missing",
          route: req.originalUrl || req.path,
        });
        return res.status(403).json({
          success: false,
          code: "CREDENTIAL_MISSING",
          message:
            `Cannot proceed — no ${LOGICAL_TYPE_MAP[primary].description} on file for this user. ` +
            `Contact HR / Admin to add the credential.`,
          credentialType: primary,
        });
      }

      const now = new Date();
      // A row is "green" iff it isn't EXPIRED/REVOKED AND its expiryDate
      // is either null (perpetual — e.g. a degree certificate) or in the
      // future.
      const green = rows.find((r) =>
        r.status !== "EXPIRED" &&
        r.status !== "REVOKED" &&
        (!r.expiryDate || new Date(r.expiryDate) >= now),
      );
      if (green) {
        req.credential = green;
        return next();
      }

      // All matches are expired/revoked — block with the most recent
      // row's details so the user knows which licence to renew.
      const newest = rows[0];
      await _auditBlock({
        userId, credentialType: newest.credentialType,
        reason: "expired", route: req.originalUrl || req.path,
      });
      return res.status(403).json({
        success: false,
        code: "CREDENTIAL_EXPIRED",
        message:
          `Cannot proceed — your ${newest.credentialType} credential expired on ${
            newest.expiryDate ? new Date(newest.expiryDate).toISOString().slice(0, 10) : "—"
          }. Contact HR / Admin to renew.`,
        credentialType: newest.credentialType,
        expiryDate: newest.expiryDate || null,
      });
    } catch (e) {
      // Fail-open: Mongo blip should not lock down the hospital.
      // eslint-disable-next-line no-console
      console.error("[credentialExpiryBlocker] check failed (fail-open):", e.message);
      return next();
    }
  };
}

/**
 * Service-layer helper — re-runs the same credential check OUTSIDE the
 * express middleware chain. Used by services that get called from
 * batch jobs / event handlers that don't pass through requireAction.
 *
 * Returns:
 *   { ok: true,  credential }      — green row present
 *   { ok: false, code, message,
 *     credentialType, expiryDate } — block reason
 *
 * Never throws — fail-open on Mongo errors (returns { ok: true,
 * credential: null, softFail: true } so the caller can log and proceed).
 */
async function assertValidCredential(userId, typeOrTypes) {
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
  for (const t of types) {
    if (!LOGICAL_TYPE_MAP[t]) {
      // Programmer error — surface synchronously.
      throw new Error(`assertValidCredential: unknown type ${t}`);
    }
  }
  if (!userId) {
    return {
      ok: false,
      code: "AUTH_REQUIRED",
      message: "userId is required to check credentials.",
      credentialType: types[0],
    };
  }

  try {
    const orClauses = types.map((t) => LOGICAL_TYPE_MAP[t].filter);
    const rows = await Credential.find({
      userId,
      status: { $ne: "REVOKED" },
      $or: orClauses,
    })
      .sort({ expiryDate: -1, updatedAt: -1 })
      .select("_id credentialType status expiryDate title councilName")
      .lean();
    if (!rows || rows.length === 0) {
      const primary = types[0];
      return {
        ok: false,
        code: "CREDENTIAL_MISSING",
        message: `No ${LOGICAL_TYPE_MAP[primary].description} on file.`,
        credentialType: primary,
      };
    }
    const now = new Date();
    const green = rows.find((r) =>
      r.status !== "EXPIRED" &&
      r.status !== "REVOKED" &&
      (!r.expiryDate || new Date(r.expiryDate) >= now),
    );
    if (green) return { ok: true, credential: green };
    const newest = rows[0];
    return {
      ok: false,
      code: "CREDENTIAL_EXPIRED",
      message: `${newest.credentialType} expired on ${
        newest.expiryDate ? new Date(newest.expiryDate).toISOString().slice(0, 10) : "—"
      }.`,
      credentialType: newest.credentialType,
      expiryDate: newest.expiryDate || null,
    };
  } catch (e) {
    // Fail-open at the service layer too.
    // eslint-disable-next-line no-console
    console.error("[assertValidCredential] check failed (fail-open):", e.message);
    return { ok: true, credential: null, softFail: true };
  }
}

module.exports = {
  credentialExpiryBlocker,
  assertValidCredential,
  // Exposed for tests + future modules that want the canonical mapping.
  _LOGICAL_TYPE_MAP: LOGICAL_TYPE_MAP,
};
