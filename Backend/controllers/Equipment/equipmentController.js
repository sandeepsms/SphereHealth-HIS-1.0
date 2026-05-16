/**
 * equipmentController.js
 *
 * CRUD + lifecycle endpoints for the Equipment collection.
 *
 *   GET    /api/equipment                      list (filterable)
 *   GET    /api/equipment/stats                KPI summary for the dashboard
 *   GET    /api/equipment/service-due          units overdue / due-this-week
 *   GET    /api/equipment/:id                  one unit (with full history)
 *   POST   /api/equipment                      create new unit
 *   PUT    /api/equipment/:id                  update meta fields
 *   POST   /api/equipment/:id/assign           assign to BED / HOMECARE / SERVICE / WAREHOUSE
 *   POST   /api/equipment/:id/return           return to warehouse (closes open assignment)
 *   POST   /api/equipment/:id/service          log a service event
 *   DELETE /api/equipment/:id                  soft-delete (status=Retired, isActive=false)
 */
const Equipment = require("../../models/Equipment/EquipmentModel");

/* ── List with filters ─────────────────────────────────────────── */
exports.list = async (req, res) => {
  try {
    const { status, category, location, q, includeInactive } = req.query;
    const where = {};
    if (!includeInactive) where.isActive = true;
    if (status)   where.status = status;
    if (category) where.category = category;
    if (location) where["currentLocation.type"] = location;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      where.$or = [{ name: rx }, { assetTag: rx }, { serialNo: rx }, { model: rx }];
    }
    const items = await Equipment.find(where).sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── KPI stats ─────────────────────────────────────────────────── */
exports.stats = async (req, res) => {
  try {
    const all = await Equipment.find({ isActive: true }).lean();
    const now = Date.now();
    const inDays = (d) => Math.floor((new Date(d).getTime() - now) / 86400000);

    const stats = {
      total:        all.length,
      byStatus: {
        Available:     all.filter(e => e.status === "Available").length,
        InUse:         all.filter(e => e.status === "In-use").length,
        OnLoan:        all.filter(e => e.status === "On-loan").length,
        UnderService:  all.filter(e => e.status === "Under-service").length,
        OutOfService:  all.filter(e => e.status === "Out-of-service").length,
      },
      byLocation: {
        WAREHOUSE: all.filter(e => e.currentLocation?.type === "WAREHOUSE").length,
        BED:       all.filter(e => e.currentLocation?.type === "BED").length,
        HOMECARE:  all.filter(e => e.currentLocation?.type === "HOMECARE").length,
        SERVICE:   all.filter(e => e.currentLocation?.type === "SERVICE").length,
      },
      serviceDue: {
        overdue:    all.filter(e => e.nextServiceDue && new Date(e.nextServiceDue) < new Date()).length,
        dueSoon:    all.filter(e => e.nextServiceDue && inDays(e.nextServiceDue) >= 0 && inDays(e.nextServiceDue) <= 14).length,
        neverServiced: all.filter(e => !e.lastService).length,
      },
      // Total daily rental income from current homecare loans
      homecareDailyRevenue: all
        .filter(e => e.currentLocation?.type === "HOMECARE")
        .reduce((s, e) => s + (e.dailyRentalCharge || 0), 0),
    };
    res.json({ success: true, data: stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Service-due list ─────────────────────────────────────────── */
exports.serviceDue = async (req, res) => {
  try {
    const horizonDays = Number(req.query.days || 14);
    const cutoff = new Date(Date.now() + horizonDays * 86400000);
    const items = await Equipment.find({
      isActive: true,
      $or: [
        { nextServiceDue: { $lte: cutoff } },
        { lastService: null },
      ],
    }).sort({ nextServiceDue: 1 }).lean();
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Get one ──────────────────────────────────────────────────── */
exports.getOne = async (req, res) => {
  try {
    const e = await Equipment.findById(req.params.id).lean();
    if (!e) return res.status(404).json({ success: false, message: "Equipment not found" });
    res.json({ success: true, data: e });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Create ────────────────────────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const body = { ...req.body };
    body.createdBy = req.user?.fullName || req.user?.name || "System";
    // Seed the initial assignment as WAREHOUSE so the audit trail is complete.
    body.assignments = [{
      locationType: body.currentLocation?.type || "WAREHOUSE",
      refLabel:     body.currentLocation?.refLabel || "Main store",
      assignedBy:   body.createdBy,
      notes:        "Initial inventory entry",
    }];
    if (!body.currentLocation) {
      body.currentLocation = { type: "WAREHOUSE", refLabel: "Main store", since: new Date() };
    }
    const created = await Equipment.create(body);
    res.json({ success: true, data: created });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Update meta ───────────────────────────────────────────────── */
exports.update = async (req, res) => {
  try {
    const body = { ...req.body, updatedBy: req.user?.fullName || req.user?.name || "System" };
    // Do not allow mutating currentLocation or status directly here; use /assign or /service.
    delete body.currentLocation;
    delete body.status;
    delete body.assignments;
    delete body.serviceHistory;
    const updated = await Equipment.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Equipment not found" });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Assign — move to BED / HOMECARE / SERVICE / WAREHOUSE ─────── */
exports.assign = async (req, res) => {
  try {
    const {
      locationType, refId, refModel, refLabel,
      patientId, patientUHID, patientName, contactNumber, homeAddress,
      expectedReturn, dailyRentalCharge, notes,
    } = req.body;

    if (!locationType) {
      return res.status(400).json({ success: false, message: "locationType is required" });
    }
    const eq = await Equipment.findById(req.params.id);
    if (!eq) return res.status(404).json({ success: false, message: "Equipment not found" });

    // Close any open assignment (returnedAt null) — auto-return as side-effect.
    const open = eq.assignments.find(a => !a.returnedAt);
    if (open) {
      open.returnedAt = new Date();
      open.returnedBy = req.user?.fullName || "System";
      open.returnedCondition = "Auto-closed by reassignment";
    }

    // Append new assignment row.
    eq.assignments.push({
      locationType,
      refId: refId || null,
      refModel: refModel || "",
      refLabel: refLabel || "",
      patientId: patientId || null,
      patientUHID: patientUHID || "",
      patientName: patientName || "",
      contactNumber: contactNumber || "",
      homeAddress: homeAddress || "",
      expectedReturn: expectedReturn ? new Date(expectedReturn) : null,
      dailyRentalCharge: Number(dailyRentalCharge || 0),
      assignedAt: new Date(),
      assignedBy: req.user?.fullName || req.user?.name || "System",
      notes: notes || "",
    });

    // Update current location + derived status.
    eq.currentLocation = { type: locationType, refId, refModel, refLabel, since: new Date() };
    eq.status = locationType === "WAREHOUSE" ? "Available"
              : locationType === "BED"       ? "In-use"
              : locationType === "HOMECARE"  ? "On-loan"
              : locationType === "SERVICE"   ? "Under-service"
              :                                "Retired";
    if (dailyRentalCharge) eq.dailyRentalCharge = Number(dailyRentalCharge);
    eq.updatedBy = req.user?.fullName || "System";

    await eq.save();
    res.json({ success: true, data: eq });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Return to warehouse ──────────────────────────────────────── */
exports.return = async (req, res) => {
  try {
    const { condition = "Good", notes = "" } = req.body;
    const eq = await Equipment.findById(req.params.id);
    if (!eq) return res.status(404).json({ success: false, message: "Equipment not found" });

    const open = eq.assignments.find(a => !a.returnedAt);
    if (open) {
      open.returnedAt = new Date();
      open.returnedBy = req.user?.fullName || "System";
      open.returnedCondition = condition;
      if (notes) open.notes = (open.notes ? open.notes + " · " : "") + `Return: ${notes}`;
    }
    eq.assignments.push({
      locationType: "WAREHOUSE",
      refLabel: "Main store",
      assignedAt: new Date(),
      assignedBy: req.user?.fullName || "System",
      notes: `Returned (${condition})${notes ? ` · ${notes}` : ""}`,
    });
    eq.currentLocation = { type: "WAREHOUSE", refLabel: "Main store", since: new Date() };
    eq.status = condition === "Damaged" ? "Under-service"
              : condition === "Lost"    ? "Out-of-service"
              :                            "Available";
    eq.updatedBy = req.user?.fullName || "System";
    await eq.save();
    res.json({ success: true, data: eq });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Service log ──────────────────────────────────────────────── */
exports.logService = async (req, res) => {
  try {
    const eq = await Equipment.findById(req.params.id);
    if (!eq) return res.status(404).json({ success: false, message: "Equipment not found" });

    const entry = {
      serviceType: req.body.serviceType || "Routine",
      performedBy: req.body.performedBy || "",
      vendor:      req.body.vendor || "",
      cost:        Number(req.body.cost || 0),
      serviceDate: req.body.serviceDate ? new Date(req.body.serviceDate) : new Date(),
      notes:       req.body.notes || "",
    };
    eq.serviceHistory.push(entry);
    eq.lastService = entry.serviceDate;
    // nextServiceDue is recomputed by pre-save hook based on servicePolicyDays.
    // If the request supplies an explicit nextDueDate, honour it.
    if (req.body.nextDueDate) {
      eq.nextServiceDue = new Date(req.body.nextDueDate);
      eq.serviceHistory[eq.serviceHistory.length - 1].nextDueDate = eq.nextServiceDue;
    }
    // Coming back from service → flip status if it was Under-service
    if (eq.status === "Under-service") {
      eq.status = "Available";
      eq.currentLocation = { type: "WAREHOUSE", refLabel: "Main store", since: new Date() };
    }
    eq.updatedBy = req.user?.fullName || "System";
    await eq.save();
    res.json({ success: true, data: eq });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Soft delete (retire) ─────────────────────────────────────── */
exports.retire = async (req, res) => {
  try {
    const eq = await Equipment.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "Retired", isActive: false, "currentLocation.type": "RETIRED" } },
      { new: true }
    );
    if (!eq) return res.status(404).json({ success: false, message: "Equipment not found" });
    res.json({ success: true, data: eq });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
