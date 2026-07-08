const emergencyService = require("../../services/Patient/emergencyService");

// R7hr-226 (security audit) — clinical fields that the GENERIC update route
// (PUT /:emergencyNumber, gated reception.register = Admin + Receptionist) must
// NOT let a non-Admin caller set by spreading req.body. Each of these has its
// own dedicated gated endpoint (triage/disposition/MLC = Admin/Doctor;
// vitals.write; rx.write meds/procedures; ipd.discharge disposition;
// lab.order). Stripped for non-Admin so Reception edits only registration /
// demographic / arrival fields.
const ER_CLINICAL_FIELDS = [
  "triageCategory", "triageTime", "isMLC", "mlcDetails", "consultantIncharge",
  "vitals", "generalExamination", "respiratorySystem", "cardiovascularSystem",
  "abdomen", "centralNervousSystem", "neurologicalDeficits", "provisionalDiagnosis",
  "treatmentGiven", "restraintsUsed", "fallRisk", "disposition", "admission",
  "admittedAt", "admittedBy", "admittedToBed", "admittedToWard", "admittedDepartment",
  "attendingDoctorId", "referredTo", "damaDetails", "deathDetails",
  "investigationsOrdered", "medications", "procedures",
];

/* ── Role-scope helpers ──────────────────────────────────────────────────
   ER records carry `attendingDoctorId` (ObjectId, populated on disposition
   → admission) and `consultantIncharge` (String, set on triage). A Doctor
   matches either signal — ObjectId for the canonical link, name for legacy
   rows that pre-date attendingDoctorId. */

// R7az-D3-HIGH-3: build a DB-side $or filter so MongoDB can narrow the
// result set BEFORE pagination is applied. Pre-R7az we post-filtered
// in-memory after paginating — so pagination totals reflected the
// global pool, not the doctor's slice, and clicking page-2 sometimes
// showed an empty page even though there were more matching records.
function scopeFilterForDoctor(req) {
  if (!(req.user?.role === "Doctor" && req.doctorProfile?._id)) return null;
  const docId   = req.doctorProfile._id;
  const docName = req.doctorProfile.personalInfo?.fullName || "";
  const clauses = [{ attendingDoctorId: docId }];
  if (docName) {
    // Escape regex specials in the name so a doctor named "Dr. R.K." doesn't
    // turn into a broken regex pattern.
    const safe = docName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clauses.push({ consultantIncharge: { $regex: safe, $options: "i" } });
  }
  return { $or: clauses };
}

// Legacy post-filter retained for endpoints that don't yet pass filters
// through to the service layer (active/today/triage/MLC lists). Same
// matching rules as scopeFilterForDoctor.
function scopeERByDoctor(req, list) {
  if (!(req.user?.role === "Doctor" && req.doctorProfile?._id)) return list;
  const docId   = String(req.doctorProfile._id);
  const docName = req.doctorProfile.personalInfo?.fullName || "";
  return list.filter(e =>
    String(e.attendingDoctorId || "") === docId ||
    (docName && e.consultantIncharge && e.consultantIncharge.includes(docName))
  );
}

// R7az-D9-HIGH-7: ownership check on single-visit reads. Doctor must own
// the visit (either as attendingDoctorId or named consultantIncharge).
function doctorOwnsVisit(req, visit) {
  if (req.user?.role !== "Doctor") return true;
  if (!req.doctorProfile?._id) return false;
  const docId   = String(req.doctorProfile._id);
  const docName = req.doctorProfile.personalInfo?.fullName || "";
  if (String(visit.attendingDoctorId || "") === docId) return true;
  if (docName && visit.consultantIncharge && visit.consultantIncharge.includes(docName)) return true;
  return false;
}

class EmergencyController {
  async createEmergencyVisit(req, res) {
    try {
      const visit = await emergencyService.createEmergencyVisit(req.body);

      // ── Auto-billing: fire ER triage charge ──
      try {
        const autoBilling = require("../../services/Billing/autoBillingService");
        const Admission   = require("../../models/Patient/admissionModel");
        const admission =
          (visit.UHID && (await Admission.findOne({ UHID: visit.UHID, admissionType: "Emergency" }).sort({ createdAt: -1 })))
          || { _id: visit._id, UHID: visit.UHID, patientId: visit.patientId, department: null };
        autoBilling.onEmergencyVisitCreated(visit, admission).catch((e) =>
          console.error("ER auto-billing error:", e.message)
        );
      } catch (e) { /* don't block visit creation */ }

      // ── NABH Emergency Register auto-populate (R7bo / AAC.1) ──
      try {
        const emitter = require("../../services/Compliance/nabhRegisterEmitter");
        emitter.emitEmergency({ visit, actor: req.user }).catch((e) =>
          console.error("ER NABH register error:", e.message),
        );
      } catch (e) { /* don't block visit creation */ }

      res.status(201).json({
        success: true,
        message: "Emergency visit created successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllEmergencyVisits(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      // R7az-D3-HIGH-3: push Doctor-scope into the DB query so the
      // count + pagination reflect ONLY the doctor's slice. Pre-R7az we
      // post-filtered the page in memory — pagination totals were the
      // whole-hospital count, so page-2 could come back empty.
      const scope = scopeFilterForDoctor(req);
      if (scope) Object.assign(filters, scope);
      const result = await emergencyService.getAllEmergencyVisits(
        parseInt(page),
        parseInt(limit),
        filters
      );
      res.status(200).json({
        success: true,
        data: result.visits || [],
        pagination: result.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // R7az-D9-HIGH-7: Doctor-scope ownership check on single-visit reads.
  async getEmergencyVisitById(req, res) {
    try {
      const visit = await emergencyService.getEmergencyVisitById(
        req.params.emergencyNumber
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
        });
      }
      if (!doctorOwnsVisit(req, visit)) {
        return res.status(403).json({
          success: false,
          message: "Not your ER visit — you can only view cases you attended.",
          code: "NOT_YOUR_VISIT",
        });
      }
      res.status(200).json({
        success: true,
        data: visit,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // R7az-D9-HIGH-7: Doctor-scope filter on patient ER history.
  async getPatientEmergencyHistory(req, res) {
    try {
      let history = await emergencyService.getPatientEmergencyHistory(
        req.params.patientId
      );
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        history = (history || []).filter(v => doctorOwnsVisit(req, v));
      }
      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateEmergencyVisit(req, res) {
    try {
      // R7hr-226 — strip clinical fields for non-Admin callers (Receptionist),
      // so the generic reception update cannot set triage/disposition/MLC/
      // diagnosis/vitals/treatment/death which belong to the dedicated gated
      // clinical endpoints.
      let payload = req.body;
      if (req.user?.role !== "Admin") {
        payload = { ...req.body };
        for (const k of ER_CLINICAL_FIELDS) delete payload[k];
      }
      const visit = await emergencyService.updateEmergencyVisit(
        req.params.emergencyNumber,
        payload
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Emergency visit updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteEmergencyVisit(req, res) {
    try {
      // R7hr-227 (security audit) — ER record deletion is destructive and
      // er.delete admits any Doctor. Scope it like OPD deleteOPDVisit
      // (R7hr-221): a Doctor may only delete a visit they attend
      // (attendingDoctorId or consultantIncharge); Admin bypasses; an un-owned
      // ER visit is Admin-only to delete. (Shared ER clinical WRITES — meds /
      // procedures / vitals — are intentionally NOT owner-locked, since any
      // on-shift clinician legitimately performs them.)
      if (req.user?.role === "Doctor") {
        const existing = await emergencyService.getEmergencyVisitById(req.params.emergencyNumber);
        if (existing) {
          const docId = String(req.doctorProfile?._id || "");
          const docName = req.doctorProfile?.personalInfo?.fullName || "";
          const owns = (docId && String(existing.attendingDoctorId || "") === docId)
                    || (docName && existing.consultantIncharge === docName);
          if (!owns) {
            return res.status(403).json({ success: false, code: "NOT_YOUR_ER_VISIT", message: "You can only delete an emergency visit you attended." });
          }
        }
      }
      const visit = await emergencyService.deleteEmergencyVisit(
        req.params.emergencyNumber
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Emergency visit deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addInvestigation(req, res) {
    try {
      const visit = await emergencyService.addInvestigation(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Investigation added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateInvestigationStatus(req, res) {
    try {
      const { investigationId, status, result } = req.body;
      const visit = await emergencyService.updateInvestigationStatus(
        req.params.emergencyNumber,
        investigationId,
        status,
        result
      );
      res.status(200).json({
        success: true,
        message: "Investigation status updated",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addMedication(req, res) {
    try {
      const visit = await emergencyService.addMedication(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Medication added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addProcedure(req, res) {
    try {
      const visit = await emergencyService.addProcedure(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Procedure added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addNursingNote(req, res) {
    try {
      const { note, recordedBy } = req.body;
      const visit = await emergencyService.addNursingNote(
        req.params.emergencyNumber,
        note,
        recordedBy
      );
      res.status(200).json({
        success: true,
        message: "Nursing note added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // R7hr(ER-P1.1) — serial vitals. Actor from req.user (forge-proof);
  // body carries only the readings. Service validates + refreshes the
  // arrival snapshot to the latest values.
  async addVitals(req, res) {
    try {
      const visit = await emergencyService.addVitalsEntry(
        req.params.emergencyNumber,
        req.body || {},
        {
          recordedBy:     req.user?.fullName || req.user?.employeeId || "Staff",
          recordedByRole: req.user?.role || "",
        },
      );
      res.status(200).json({ success: true, message: "Vitals recorded", data: visit });
    } catch (error) {
      res.status(error.status || 400).json({ success: false, message: error.message });
    }
  }

  async updateDisposition(req, res) {
    try {
      // Pass through req.user as the implicit actor for nursing-note
      // attribution when the body doesn't carry an explicit one.
      const body = req.body || {};
      if (!body.actor && req.user) {
        body.actor = req.user.fullName || req.user.email || req.user.role;
      }
      const visit = await emergencyService.updateDisposition(
        req.params.emergencyNumber,
        body,
      );

      // ── NABH Emergency Register update (R7bo / AAC.1) ──
      try {
        const emitter = require("../../services/Compliance/nabhRegisterEmitter");
        emitter.emitEmergencyDisposition({
          visit,
          actor: req.user,
          disposition: body.disposition || visit.disposition,
          admissionLinkId: visit.admissionId,
          referredTo: body.referredTo,
          notes: body.dispositionNotes,
        }).catch((e) => console.error("ER NABH disposition error:", e.message));
      } catch (e) { /* never block */ }

      res.status(200).json({
        success: true,
        message: "Disposition updated successfully",
        data: visit,
      });
    } catch (error) {
      // R7z: service throws with `error.status` for typed errors
      // (400 missing attestation, 404 not found, 409 sticky terminal).
      // Fall back to 400 for unannotated errors so legacy callers
      // still get a body shape they can render.
      res.status(error?.status || 400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getActiveEmergencies(req, res) {
    try {
      const all = await emergencyService.getActiveEmergencies();
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getEmergenciesByTriage(req, res) {
    try {
      const all = await emergencyService.getEmergenciesByTriage(req.params.triageCategory);
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getTodayEmergencies(req, res) {
    try {
      const all = await emergencyService.getTodayEmergencies();
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getMLCCases(req, res) {
    try {
      const cases = await emergencyService.getMLCCases();
      res.status(200).json({
        success: true,
        data: scopeERByDoctor(req, cases),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateTriageCategory(req, res) {
    try {
      const { triageCategory } = req.body;
      const visit = await emergencyService.updateTriageCategory(
        req.params.emergencyNumber,
        triageCategory
      );

      // ── NABH Emergency Register update (R7bo / AAC.1) ──
      try {
        const emitter = require("../../services/Compliance/nabhRegisterEmitter");
        emitter.emitEmergencyTriage({ visit, actor: req.user }).catch((e) =>
          console.error("ER NABH triage error:", e.message),
        );
      } catch (e) { /* never block */ }

      res.status(200).json({
        success: true,
        message: "Triage category updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new EmergencyController();
