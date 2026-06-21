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
// Pushed the counting into MongoDB so we don't pull every equipment row
// into JS memory just to filter it 10 times (audit C-05 — unbounded
// `.find({isActive:true}).lean()` ballooned with each new asset). The
// aggregation runs in a single round-trip and the result payload is
// O(constant) instead of O(equipment count).
exports.stats = async (req, res) => {
  try {
    const now = new Date();
    const dueSoonCutoff = new Date(now.getTime() + 14 * 86400000);

    const [agg] = await Equipment.aggregate([
      { $match: { isActive: true } },
      {
        $facet: {
          total:    [{ $count: "n" }],
          byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
          byLocation: [
            { $group: { _id: "$currentLocation.type", n: { $sum: 1 } } },
          ],
          overdueSvc: [
            { $match: { nextServiceDue: { $lt: now } } },
            { $count: "n" },
          ],
          dueSoonSvc: [
            { $match: { nextServiceDue: { $gte: now, $lte: dueSoonCutoff } } },
            { $count: "n" },
          ],
          neverServiced: [
            { $match: { lastService: null } },
            { $count: "n" },
          ],
          homecareRevenue: [
            { $match: { "currentLocation.type": "HOMECARE" } },
            { $group: { _id: null, sum: { $sum: "$dailyRentalCharge" } } },
          ],
        },
      },
    ]);

    const byStatusMap = Object.fromEntries(
      (agg.byStatus || []).map((r) => [r._id, r.n]),
    );
    const byLocationMap = Object.fromEntries(
      (agg.byLocation || []).map((r) => [r._id, r.n]),
    );

    res.json({
      success: true,
      data: {
        total: agg.total[0]?.n || 0,
        byStatus: {
          Available:    byStatusMap.Available    || 0,
          InUse:        byStatusMap["In-use"]    || 0,
          OnLoan:       byStatusMap["On-loan"]   || 0,
          UnderService: byStatusMap["Under-service"] || 0,
          OutOfService: byStatusMap["Out-of-service"] || 0,
        },
        byLocation: {
          WAREHOUSE: byLocationMap.WAREHOUSE || 0,
          BED:       byLocationMap.BED       || 0,
          HOMECARE:  byLocationMap.HOMECARE  || 0,
          SERVICE:   byLocationMap.SERVICE   || 0,
        },
        serviceDue: {
          overdue:       agg.overdueSvc[0]?.n   || 0,
          dueSoon:       agg.dueSoonSvc[0]?.n   || 0,
          neverServiced: agg.neverServiced[0]?.n || 0,
        },
        // R7hr-227 (security audit) — homecare rental revenue is commercial
        // data: dailyRentalCharge was made Admin-only on writes + stripped from
        // the SSE feed in R7hr-219, but this read aggregate leaked it to the
        // ward/floor roles on equipment.read (Doctor/Nurse/Receptionist/Ward
        // Boy/Housekeeping). Expose the revenue sum to Admin only; everyone
        // else still gets the operational counts.
        ...(req.user?.role === "Admin"
          ? { homecareDailyRevenue: agg.homecareRevenue[0]?.sum || 0 }
          : {}),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── Service-due list ─────────────────────────────────────────── */
exports.serviceDue = async (req, res) => {
  try {
    const horizonDays = Number(req.query.days || 14);
    const cutoff = new Date(Date.now() + horizonDays * 86400000);
    // Defensive cap (audit C-05). Real hospital fleets are well below 1000
    // equipment items; the limit just stops a runaway scan from melting
    // the API if the equipment master is ever bulk-imported wrong.
    const items = await Equipment.find({
      isActive: true,
      $or: [
        { nextServiceDue: { $lte: cutoff } },
        { lastService: null },
      ],
    }).sort({ nextServiceDue: 1 }).limit(1000).lean();
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

// R7hr-217 (RBAC audit) — asset-master COMMERCIAL fields are Admin-only.
// equipment.write is granted to Nurse + Ward Boy so they can assign / return /
// log-service equipment, but they must NOT set or rewrite the procurement cost
// / vendor / serial / rental tariff on the master record. Strip those from the
// payload for any non-Admin caller (both create and update).
// Real EquipmentModel master fields (verified against the schema): costPrice
// is the procurement cost, serialNo the asset serial, purchaseDate / warrantyEnd
// the procurement dates. (vendor/cost live in the serviceHistory sub-doc set
// via /service, not this master write.)
// R7hr-219 (RBAC review #8): dailyRentalCharge — the master rental tariff that
// feeds the homecareDailyRevenue KPI — was named as protected in this comment
// but omitted from the list, so a Nurse/Ward Boy could PUT it on the master via
// update(). Add it. NOTE the assign() handler sets eq.dailyRentalCharge from its
// OWN destructured body (the homecare-loan path), NOT via this strip, so loaning
// equipment out is unaffected; only the standalone master-record rewrite closes.
const COMMERCIAL_FIELDS = ["costPrice", "serialNo", "purchaseDate", "warrantyEnd", "dailyRentalCharge"];
function stripCommercialForNonAdmin(body, req) {
  if (req.user?.role !== "Admin") {
    COMMERCIAL_FIELDS.forEach((k) => delete body[k]);
  }
  return body;
}

/* ── Create ────────────────────────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const body = stripCommercialForNonAdmin({ ...req.body }, req);
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
    const body = stripCommercialForNonAdmin({ ...req.body, updatedBy: req.user?.fullName || req.user?.name || "System" }, req);
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
