/**
 * mlcService — MLR number generation + MLC report CRUD
 *
 * The first 2 letters of every MLR number identify the doctor:
 *   • Default: first letter of firstName + first letter of lastName
 *   • Single-name doctor: first + last letter of that single name
 *   • Prefix is GLOBALLY unique — if the natural prefix is already used by
 *     another doctor, walk through a deterministic fallback list and pick
 *     the first available one.
 *
 * Once assigned, prefix is persisted to `Doctor.mlcPrefix` and re-used for
 * every subsequent MLC by the same doctor. `Doctor.mlcSeq` is the running
 * counter for that doctor's MLR series (RK0001, RK0002, …).
 */
const mongoose = require("mongoose");
const Doctor   = require("../../models/Doctor/doctorModel");
const Patient  = require("../../models/Patient/patientModel");
const MLC      = require("../../models/MLC/MLCReportModel");

/* ── Pure helpers ──────────────────────────────────────────────── */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Build an ordered list of 2-letter candidates from a doctor's name. */
function prefixCandidates({ firstName = "", lastName = "" }) {
  const a = (firstName || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const b = (lastName  || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const out = [];
  const push = (s) => { if (s && s.length === 2 && !out.includes(s)) out.push(s); };

  if (a && b) {
    // Natural choice: first of first name + first of last name
    push(a[0] + b[0]);
    // Fallbacks — combine subsequent letters of each name
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        push(a[i] + b[j]);
      }
    }
    // As a last resort, intra-name letters
    for (let i = 0; i < a.length - 1; i++) push(a[i] + a[i + 1]);
    for (let i = 0; i < b.length - 1; i++) push(b[i] + b[i + 1]);
  } else {
    const n = a || b;
    if (n.length >= 2) {
      // Single name: first + last letter
      push(n[0] + n[n.length - 1]);
      // Then first + each interior letter
      for (let i = 1; i < n.length - 1; i++) push(n[0] + n[i]);
      // Then all consecutive pairs
      for (let i = 0; i < n.length - 1; i++) push(n[i] + n[i + 1]);
    } else if (n.length === 1) {
      // 1-letter name — pair with each alphabet letter as fallback
      for (const c of LETTERS) push(n + c);
    }
  }

  // Final fallback: every pair AA..ZZ — guarantees we always find something.
  for (const c1 of LETTERS) for (const c2 of LETTERS) push(c1 + c2);
  return out;
}

/* ── Service class ─────────────────────────────────────────────── */

class MLCService {
  /** Read-only helper — returns the candidate list for a doctor, useful for UI previews. */
  previewPrefixCandidates(doctor) {
    const pi = doctor?.personalInfo || {};
    return prefixCandidates({ firstName: pi.firstName, lastName: pi.lastName }).slice(0, 8);
  }

  /**
   * Atomically assign the next MLR number to a doctor.
   * Returns `{ mlrNumber, mlrPrefix, mlrSeq }`. Uses `findOneAndUpdate`
   * with `$inc` so concurrent MLC creates from the same doctor don't
   * collide on the sequence.
   *
   * If the doctor doesn't have a prefix yet, walks the candidate list and
   * claims the first free one (also via findOneAndUpdate so two doctors
   * simultaneously claiming the same letters can't both succeed).
   */
  async assignMlrNumber(doctorDoc) {
    let prefix = doctorDoc.mlcPrefix;

    if (!prefix) {
      const candidates = prefixCandidates({
        firstName: doctorDoc.personalInfo?.firstName,
        lastName:  doctorDoc.personalInfo?.lastName,
      });
      for (const cand of candidates) {
        // Two failure modes possible:
        //   (a) duplicate-key (11000) — `cand` is owned by ANOTHER doctor
        //   (b) `claimed === null` — the filter didn't match because a
        //       concurrent same-doctor create has already set this doctor's
        //       prefix to something else (then our filter `mlcPrefix ∈
        //       [null, ""]` no longer hits). We must NOT keep looping — that
        //       would let us overwrite the just-assigned prefix with a
        //       different candidate. Instead, re-read and reuse the winner's
        //       prefix.
        let duplicateKey = false;
        const claimed = await Doctor.findOneAndUpdate(
          { _id: doctorDoc._id, $or: [{ mlcPrefix: null }, { mlcPrefix: "" }, { mlcPrefix: { $exists: false } }] },
          { $set: { mlcPrefix: cand } },
          { new: true },
        ).catch((err) => {
          if (err?.code === 11000) { duplicateKey = true; return null; }
          throw err;
        });

        if (claimed?.mlcPrefix === cand) { prefix = cand; break; }

        if (!duplicateKey) {
          // Filter-miss (NOT a duplicate-key) → another concurrent
          // create for the SAME doctor has already pinned a prefix. Re-read
          // and reuse it — never try another candidate.
          const fresh = await Doctor.findById(doctorDoc._id).select("mlcPrefix").lean();
          if (fresh?.mlcPrefix) { prefix = fresh.mlcPrefix; break; }
          // Otherwise the doc disappeared — fail loudly.
          throw new Error("Doctor record vanished while assigning MLR prefix");
        }
        // duplicateKey === true → this candidate is owned by a different
        // doctor. Loop and try the next.
      }
      if (!prefix) throw new Error("Could not assign an MLR prefix for this doctor");
    }

    // Atomically bump the per-doctor counter
    const updated = await Doctor.findByIdAndUpdate(
      doctorDoc._id,
      { $inc: { mlcSeq: 1 } },
      { new: true },
    );
    const seq = updated?.mlcSeq || 1;
    const mlrNumber = `${prefix}${String(seq).padStart(4, "0")}`;
    return { mlrNumber, mlrPrefix: prefix, mlrSeq: seq };
  }

  /* ── CRUD ──────────────────────────────────────────────────── */

  async createMLC(payload, actor = {}) {
    if (!payload.doctorId) throw new Error("doctorId is required");
    if (!payload.patientId && !payload.UHID) {
      throw new Error("patientId or UHID is required");
    }

    // Resolve doctor + patient (so we can denormalise display fields)
    const doctor = await Doctor.findById(payload.doctorId);
    if (!doctor) throw new Error("Doctor not found");

    let patient = null;
    if (payload.patientId && mongoose.isValidObjectId(payload.patientId)) {
      patient = await Patient.findById(payload.patientId);
    } else if (payload.UHID) {
      patient = await Patient.findOne({ UHID: payload.UHID });
    }
    if (!patient) throw new Error("Patient not found");

    // Assign the next MLR number
    const { mlrNumber, mlrPrefix, mlrSeq } = await this.assignMlrNumber(doctor);

    // Court-grade integrity: if MLC.create fails, roll back the per-doctor
    // sequence atomically so the next MLR doesn't leave a gap.
    //
    // We prefer a Mongo transaction when the connection is a replica set /
    // mongos. On a single-node standalone server (typical dev box) Mongo
    // refuses transactions — so we fall back to the explicit rollback path
    // (still safe because the prefix is doctor-scoped and the increment
    // happened milliseconds ago).
    let doc;
    const session = await mongoose.startSession().catch(() => null);
    const useTx = !!session && (session.client?.s?.options?.replicaSet ||
                                session.client?.options?.replicaSet);
    try {
      if (useTx) {
        await session.withTransaction(async () => {
          [doc] = await MLC.create([{
            ...payload,
            patientId:   patient._id,
            UHID:        patient.UHID,
            patientName: patient.fullName,
            age:         patient.age,
            gender:      patient.gender,
            contactNumber: patient.contactNumber,
            doctorId:    doctor._id,
            doctorName:  doctor.personalInfo?.fullName ||
                         `${doctor.personalInfo?.firstName || ""} ${doctor.personalInfo?.lastName || ""}`.trim(),
            mlrNumber, mlrPrefix, mlrSeq,
            createdBy:     actor.fullName || actor.name || "",
            createdByRole: actor.role     || "",
          }], { session });
        });
      } else {
        doc = await MLC.create({
          ...payload,
          patientId:   patient._id,
          UHID:        patient.UHID,
          patientName: patient.fullName,
          age:         patient.age,
          gender:      patient.gender,
          contactNumber: patient.contactNumber,
          doctorId:    doctor._id,
          doctorName:  doctor.personalInfo?.fullName ||
                       `${doctor.personalInfo?.firstName || ""} ${doctor.personalInfo?.lastName || ""}`.trim(),
          mlrNumber, mlrPrefix, mlrSeq,
          createdBy:     actor.fullName || actor.name || "",
          createdByRole: actor.role     || "",
        });
      }
    } catch (createErr) {
      // Manual rollback for the non-transaction path.
      await Doctor.findByIdAndUpdate(doctor._id, { $inc: { mlcSeq: -1 } }).catch(() => {});
      throw createErr;
    } finally {
      session?.endSession();
    }

    // Best-effort: flag the patient + linked emergency / admission as MLC
    // so downstream printouts can decide to render the stamp. We don't fail
    // the create if these side-effects error out.
    try {
      await Patient.findByIdAndUpdate(patient._id, {
        $set: { isMLC: true, mlcNumber: mlrNumber },
      });
    } catch { /* non-fatal */ }
    if (doc.emergencyId) {
      try {
        const Emergency = require("../../models/Patient/emergencyModel");
        await Emergency.findByIdAndUpdate(doc.emergencyId, {
          $set: { isMLC: true, mlcNumber: mlrNumber },
        });
      } catch { /* non-fatal */ }
    }
    if (doc.admissionId) {
      try {
        const Admission = require("../../models/Patient/admissionModel");
        await Admission.findByIdAndUpdate(doc.admissionId, {
          $set: { isMLC: true, mlcNumber: mlrNumber },
        });
      } catch { /* non-fatal */ }
    }

    return doc;
  }

  async listMLC(filters = {}) {
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.doctorId && mongoose.isValidObjectId(filters.doctorId)) {
      query.doctorId = filters.doctorId;
    }
    if (filters.UHID)   query.UHID   = filters.UHID;
    if (filters.search) {
      // Escape regex metacharacters — raw user input would throw on
      // malformed patterns ("[", "?") and is vulnerable to catastrophic
      // backtracking (ReDoS) on inputs like "(a+)+$".
      const esc = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const r = new RegExp(esc, "i");
      query.$or = [
        { mlrNumber: r },
        { patientName: r },
        { UHID: r },
        { doctorName: r },
        { firNumber: r },
      ];
    }
    const limit = Math.min(500, parseInt(filters.limit) || 100);
    return MLC.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("doctorId", "personalInfo doctorId")
      .populate("patientId", "fullName UHID age gender contactNumber bloodGroup");
  }

  async getMLC(idOrMlr) {
    const isOid = mongoose.isValidObjectId(idOrMlr);
    const filter = isOid ? { _id: idOrMlr } : { mlrNumber: String(idOrMlr).toUpperCase() };
    return MLC.findOne(filter)
      .populate("doctorId", "personalInfo doctorId professional")
      .populate("patientId", "fullName UHID age gender contactNumber bloodGroup address")
      .populate("emergencyId", "emergencyNumber arrivalDate triageCategory")
      .populate("admissionId", "admissionNumber admissionDate admissionType bedNumber");
  }

  async updateMLC(idOrMlr, patch, actor = {}) {
    const isOid = mongoose.isValidObjectId(idOrMlr);
    const filter = isOid ? { _id: idOrMlr } : { mlrNumber: String(idOrMlr).toUpperCase() };
    // Identifier fields are immutable once issued
    delete patch.mlrNumber;
    delete patch.mlrPrefix;
    delete patch.mlrSeq;
    delete patch.doctorId;
    delete patch.patientId;
    delete patch.UHID;
    if (patch.status === "Finalized" && !patch.finalizedAt) patch.finalizedAt = new Date();
    if (patch.status === "Closed"    && !patch.closedAt)    patch.closedAt    = new Date();
    return MLC.findOneAndUpdate(filter, { $set: patch }, { new: true, runValidators: true });
  }

  async deleteMLC(idOrMlr) {
    const isOid = mongoose.isValidObjectId(idOrMlr);
    const filter = isOid ? { _id: idOrMlr } : { mlrNumber: String(idOrMlr).toUpperCase() };
    // Medico-legal records must preserve chain of custody. Only Draft MLCs
    // (typo / wrong-patient / abandoned forms) may be hard-deleted. A
    // Finalized or Closed MLC must NEVER vanish from the audit trail —
    // statutory requirement under IPC §201/§204. Use the Close workflow
    // (status="Closed" + closedReason) to retire a real case instead.
    const existing = await MLC.findOne(filter).select("_id status mlrNumber").lean();
    if (!existing) return null;
    if (existing.status !== "Draft") {
      const err = new Error(
        `MLC ${existing.mlrNumber} is ${existing.status} and cannot be deleted — close it instead`,
      );
      err.statusCode = 409;
      throw err;
    }
    return MLC.findOneAndDelete(filter);
  }
}

module.exports = new MLCService();
module.exports.__test = { prefixCandidates };
