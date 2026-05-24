const opdService = require("../../services/Patient/OPDService");

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
      res.status(400).json({ success: false, message: error.message });
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
      const { nurseName, ...vitalsData } = req.body;
      const visit = await opdService.updateVitals(req.params.visitNumber, vitalsData, nurseName);
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
      const visit = await opdService.addPrescription(req.params.visitNumber, req.body);
      res.status(200).json({ success: true, message: "Prescription added", data: visit });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async completeVisit(req, res) {
    try {
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
