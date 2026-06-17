const opdService = require("../../services/Patient/OPDService");

// R7hr-216 (RBAC audit) — mirror the read-side doctor-ownership guard
// (getOPDVisitById → NOT_YOUR_VISIT) on OPD *writes*. Pre-fix, any Doctor could
// author/sign an assessment, prescription, addendum or completion onto ANOTHER
// doctor's OPD visit (clinical-record falsification) even though the read side
// already 403'd cross-doctor. A Doctor may now only write to a visit assigned
// to them; Admin (and any non-Doctor role the route's action gate permits)
// bypass. Returns a 403 body to send, or null to allow.
async function denyIfNotOwnOPDVisit(req) {
  if (req.user?.role !== "Doctor" || !req.doctorProfile?._id) return null;
  let visit;
  try { visit = await opdService.getOPDVisitById(req.params.visitNumber); } catch { return null; }
  if (!visit) return null; // missing visit → let the handler issue its own 404
  const callerDoctorId = String(req.doctorProfile._id);
  const visitDoctorId  = String(visit.doctorId?._id || visit.doctorId || "");
  if (!visitDoctorId || visitDoctorId !== callerDoctorId) {
    return { success: false, code: "NOT_YOUR_VISIT", message: "Not your OPD visit — you can only write to visits assigned to you." };
  }
  return null;
}

class OPDController {
  async createOPDVisit(req, res) {
    try {
      // OPDService.createOPDVisit already fires onOPDRegistered (creates the
      // bridging admission AND the consultation charge). The controller-level
      // auto-billing block here used to fire the SAME event a second time,
      // double-charging every visit. Removed.
      const visit = await opdService.createOPDVisit(req.body);
      res.status(201).json({ success: true, message: "OPD visit created successfully", data: visit });
    } catch (error) {
      // R7hr-47 / R7hr-51: surface structured rule errors so the reception
      // UI can render a rich banner. PATIENT_ALREADY_IPD carries the admission
      // number + ward; DOCTOR_NOT_AVAILABLE carries the doctor name +
      // availability status so the receptionist sees exactly which doctor +
      // why before re-picking.
      const status = error.status || 400;
      res.status(status).json({
        success: false,
        message: error.message,
        code: error.code || null,
        // R7hr-47 fields
        admissionNumber: error.admissionNumber || null,
        wardName: error.wardName || null,
        // R7hr-51 fields
        doctorName:           error.doctorName           || null,
        availabilityStatus:   error.availabilityStatus   || null,
        availabilityNote:     error.availabilityNote     || null,
      });
    }
  }

  async getAllOPDVisits(req, res) {
    try {
      const { page = 1, limit = 50, ...filters } = req.query;
      // Doctor users see only their own OPD patients (set by attachDoctorProfile
      // middleware). For nurses, reception, admin — no extra filter is applied.
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        filters.doctorId = req.doctorProfile._id;
      }
      const result = await opdService.getAllOPDVisits(parseInt(page), parseInt(limit), filters);
      res.status(200).json({ success: true, data: result.visits, pagination: result.pagination });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // R7az-D9-HIGH-1: Doctor-scope ownership check on single-visit reads.
  // Pre-R7az any Doctor could fetch /opd/:visitNumber for any visit,
  // including patients of other doctors — full PHI exposure across
  // departments. Fetch then 403 on mismatch.
  async getOPDVisitById(req, res) {
    try {
      const visit = await opdService.getOPDVisitById(req.params.visitNumber);
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        const callerDoctorId = String(req.doctorProfile._id);
        const visitDoctorId  = String(visit.doctorId?._id || visit.doctorId || "");
        if (!visitDoctorId || visitDoctorId !== callerDoctorId) {
          return res.status(403).json({
            success: false,
            message: "Not your OPD visit — you can only view visits assigned to you.",
            code: "NOT_YOUR_VISIT",
          });
        }
      }
      res.status(200).json({ success: true, data: visit });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // R7az-D9-HIGH-1: Doctor-scope filter on patient history. A logged-in
  // Doctor only sees the visits THEY conducted for this patient, not
  // every OPD encounter across departments. Other roles see the full
  // history. Done in-memory because getPatientOPDHistory doesn't yet
  // accept filters.
  async getPatientOPDHistory(req, res) {
    try {
      let history = await opdService.getPatientOPDHistory(req.params.patientId);
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        const callerDoctorId = String(req.doctorProfile._id);
        history = (history || []).filter(v =>
          String(v.doctorId?._id || v.doctorId || "") === callerDoctorId,
        );
      }
      res.status(200).json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // R7cr / R7cx — GET /opd/uhid/:UHID/today-rx?days=N
  // Pharmacy-side fast lookup: pharmacist types a UHID, gets the
  // recent OPD visit(s) for that patient with diagnosis + prescribed
  // medicines so they can dispense without hunting through the
  // doctor's full assessment screen. Default window: last 7 days
  // (was "today only" pre-R7cx; that was too narrow — patients often
  // walk in 1-2 days after the visit). Caller can override via
  // ?days=N (1..30). Empty array means no qualifying visits in the
  // window — handled as a friendly empty state by the UI.
  async getTodayPrescriptionsByUHID(req, res) {
    try {
      const UHID = String(req.params.UHID || "").trim().toUpperCase();
      if (!UHID) {
        return res.status(400).json({ success: false, message: "UHID is required" });
      }
      const days = req.query?.days ? Number(req.query.days) : 7;
      const visits = await opdService.getTodayPrescriptionsByUHID(UHID, days);
      res.status(200).json({
        success: true,
        data: visits,
        meta: { windowDays: Math.max(1, Math.min(30, Number(days) || 7)) },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateOPDVisit(req, res) {
    try {
      const visit = await opdService.updateOPDVisit(req.params.visitNumber, req.body);
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      res.status(200).json({ success: true, message: "Visit updated successfully", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // PATCH /opd/:visitNumber/vitals  — Nurse enters vitals
  async updateVitals(req, res) {
    try {
      // PD-03 — Peel off the nurse audit trio (empId + signature image)
      // from the top-level payload before spreading the rest into the
      // vitals sub-doc. The print template reads `vitalsEnteredByEmployeeId`
      // + `vitalsEnteredBySignature` on the OPD Rx Nurse Pre-Assessment
      // footer; pre-fix these were silently dropped by Mongoose strict
      // mode when nested under vitals.
      const {
        nurseName,
        vitalsEnteredByEmployeeId,
        vitalsEnteredBySignature,
        ...vitalsData
      } = req.body;
      // R7hf — pass JWT-verified actor so the auto-emitted NABH RBS
      // register row is attributed to the verified nurse identity, not
      // a client-supplied display name.
      const actor = req.user ? {
        _id: req.user._id || req.user.id,
        name: req.user.fullName || req.user.username || nurseName || "Nurse",
        role: req.user.role || "Nurse",
      } : null;
      // PD-03 — Fall back to JWT actor for empId/signature when the
      // client omitted them (defence in depth). req.user.signature is
      // set by AuthContext from the persisted User.signature field.
      const meta = {
        vitalsEnteredByEmployeeId: vitalsEnteredByEmployeeId || req.user?.employeeId || "",
        vitalsEnteredBySignature:  vitalsEnteredBySignature  || req.user?.signature  || "",
      };
      const visit = await opdService.updateVitals(req.params.visitNumber, vitalsData, nurseName, actor, meta);
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      res.status(200).json({ success: true, message: "Vitals updated", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // PATCH /opd/:visitNumber/status
  async updateStatus(req, res) {
    try {
      const { status } = req.body;
      const visit = await opdService.updateStatus(req.params.visitNumber, status);
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      res.status(200).json({ success: true, data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteOPDVisit(req, res) {
    try {
      const visit = await opdService.deleteOPDVisit(req.params.visitNumber);
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      res.status(200).json({ success: true, message: "Visit deleted successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async addInvestigation(req, res) {
    try {
      const visit = await opdService.addInvestigation(req.params.visitNumber, req.body);
      res.status(200).json({ success: true, message: "Investigation added", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async updateInvestigationStatus(req, res) {
    try {
      const { investigationId, status } = req.body;
      const visit = await opdService.updateInvestigationStatus(req.params.visitNumber, investigationId, status);
      res.status(200).json({ success: true, message: "Investigation status updated", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async addPrescription(req, res) {
    try {
      const _deny = await denyIfNotOwnOPDVisit(req);   // R7hr-216
      if (_deny) return res.status(403).json(_deny);
      const visit = await opdService.addPrescription(req.params.visitNumber, req.body);
      res.status(200).json({ success: true, message: "Prescription added", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async completeVisit(req, res) {
    try {
      const _deny = await denyIfNotOwnOPDVisit(req);   // R7hr-216
      if (_deny) return res.status(403).json(_deny);
      const visit = await opdService.completeVisit(req.params.visitNumber, req.body);
      res.status(200).json({ success: true, message: "Visit completed", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // GET /opd/today  — optionally ?departmentId=&doctorId=&vitalsStatus=
  async getTodayVisits(req, res) {
    try {
      const q = { ...req.query };
      // Doctor scope: only this doctor's visits today.
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        q.doctorId = req.doctorProfile._id;
      }
      const visits = await opdService.getTodayVisits(q);
      res.status(200).json({ success: true, data: visits });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /opd/followup-due?date=YYYY-MM-DD
  async getFollowUpDue(req, res) {
    try {
      const { date = new Date() } = req.query;
      // Doctor scope: only their own follow-ups.
      const opts = {};
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        opts.doctorId = req.doctorProfile._id;
      }
      const visits = await opdService.getFollowUpDue(date, opts);
      res.status(200).json({ success: true, data: visits });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /opd/department/:departmentId?date=YYYY-MM-DD
  // R7az-D3-HIGH-7: Doctor-scope post-filter. A Doctor calling
  // /opd/department/:id sees only their own visits within the
  // department (not the whole department's roster).
  async getVisitsByDepartment(req, res) {
    try {
      let visits = await opdService.getVisitsByDepartment(req.params.departmentId, req.query.date);
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        const callerDoctorId = String(req.doctorProfile._id);
        visits = (visits || []).filter(v =>
          String(v.doctorId?._id || v.doctorId || "") === callerDoctorId,
        );
      }
      res.status(200).json({ success: true, data: visits });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /opd/doctor/:doctorId?date=YYYY-MM-DD
  // R7az-D9-HIGH-1: Doctor users may only read THEIR OWN OPD roster
  // via this endpoint. Pre-R7az a Doctor could pass any other
  // doctor's _id in the URL and read their entire patient list.
  async getVisitsByDoctor(req, res) {
    try {
      if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
        const callerDoctorId = String(req.doctorProfile._id);
        const requestedId    = String(req.params.doctorId || "");
        if (requestedId !== callerDoctorId) {
          return res.status(403).json({
            success: false,
            message: "Doctors can only view their own OPD roster via this endpoint.",
            code: "NOT_YOUR_ROSTER",
          });
        }
      }
      const visits = await opdService.getVisitsByDoctor(req.params.doctorId, req.query.date);
      res.status(200).json({ success: true, data: visits });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // POST /opd/:visitNumber/assessment  — Doctor saves SOAP note + diagnosis + plan
  async saveAssessment(req, res) {
    try {
      const _deny = await denyIfNotOwnOPDVisit(req);   // R7hr-216
      if (_deny) return res.status(403).json(_deny);
      const { doctorName, ...assessmentData } = req.body;
      // R7bx item 8 — pass req.user.id so the service can run the MCI
      // registration-number guard when the doctor is signing (sending a
      // doctorSignatureImage payload).
      const visit = await opdService.saveOPDAssessment(
        req.params.visitNumber,
        assessmentData,
        doctorName || req.user?.fullName || "Doctor",
        req.user?.id || req.user?._id || null,
      );
      if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
      res.status(200).json({ success: true, message: "Assessment saved", data: visit });
    } catch (error) {
      // R7bx item 8 — forward typed error code (e.g. MCI_REG_NO_MISSING)
      // and explicit statusCode so the frontend can branch on stable identifiers.
      const status = error.statusCode || 400;
      res.status(status).json({
        success: false,
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
  }

  // POST /opd/:visitNumber/additional-note  — R7cj: append an addendum
  // note to a signed assessment. Append-only — never modifies the
  // original structured fields. Captures who + when for audit. Returns
  // the updated visit so the frontend can re-render the timeline.
  async addAdditionalNote(req, res) {
    try {
      const _deny = await denyIfNotOwnOPDVisit(req);   // R7hr-216
      if (_deny) return res.status(403).json(_deny);
      const text = String(req.body?.note || "").trim();
      if (!text) {
        return res.status(400).json({ success: false, code: "EMPTY_NOTE", message: "Note text is required." });
      }
      if (text.length > 4000) {
        return res.status(400).json({ success: false, code: "NOTE_TOO_LONG", message: "Note exceeds 4000 characters." });
      }
      const OPD = require("../../models/Patient/OPDModels");
      const entry = {
        note:        text,
        addedAt:     new Date(),
        addedBy:     req.user?.fullName || req.user?.name || "Doctor",
        addedById:   req.user?.id || req.user?._id || null,
        addedByRole: req.user?.role || "",
      };
      const visit = await OPD.findOneAndUpdate(
        { visitNumber: req.params.visitNumber },
        { $push: { additionalNotes: entry } },
        { new: true, runValidators: true },
      ).lean();
      if (!visit) {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "OPD visit not found" });
      }
      return res.status(200).json({ success: true, message: "Note added", data: visit });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }

  // GET /opd/:visitNumber/audit-trail  — All audit triggers for an OPD visit
  async getOPDauditTrail(req, res) {
    try {
      const Admission     = require("../../models/Patient/admissionModel");
      const autoBilling   = require("../../services/Billing/autoBillingService");
      const admission     = await Admission.findOne({
        visitNumber:   req.params.visitNumber,
        admissionType: "OPD",
      }).lean();
      if (!admission) return res.status(404).json({ success: false, message: "No audit record found for this visit" });
      const trail = await autoBilling.getAuditTrail(admission._id, { limit: 200 });
      res.json({ success: true, admissionId: admission._id, data: trail });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new OPDController();
