/**
 * presenceController — heartbeat + active-list endpoints
 *   POST /api/presence/heartbeat   { currentResource?, action? }
 *   GET  /api/presence/active
 */
const Presence = require("../../models/Presence/presenceModel");

const STALE_MS = 5 * 60 * 1000; // anything older than 5 min is "stale"

// User id comes from JWT middleware (req.user) OR fallback to body/header
function resolveUser(req) {
  return {
    userId:   req.user?._id || req.user?.id || req.body.userId || req.headers["x-user-id"],
    userName: req.user?.fullName || req.user?.name || req.body.userName || "User",
    userRole: req.user?.role     || req.body.userRole || "Receptionist",
  };
}

// POST /api/presence/heartbeat
exports.heartbeat = async (req, res) => {
  try {
    const { userId, userName, userRole } = resolveUser(req);
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const { currentResource, action } = req.body || {};

    const update = {
      userName,
      userRole,
      lastHeartbeatAt: new Date(),
    };
    if (currentResource) update.currentResource = currentResource;
    if (action !== undefined) update.action = action;

    const doc = await Presence.findOneAndUpdate(
      { userId },
      { $set: update, $setOnInsert: { userId } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/presence/active
exports.getActive = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const list = await Presence.find({ lastHeartbeatAt: { $gte: cutoff } })
      .sort({ lastHeartbeatAt: -1 })
      .lean();
    res.json({ success: true, count: list.length, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/presence/clear — explicit logout/leave
exports.clear = async (req, res) => {
  try {
    const { userId } = resolveUser(req);
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });
    await Presence.deleteOne({ userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
