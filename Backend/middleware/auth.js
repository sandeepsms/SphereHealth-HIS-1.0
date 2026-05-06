const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "spherehealth_his_secret_2025";

/* ── Verify JWT token ── */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ message: "Authentication required. Please login." });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role, employeeId }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Session expired. Please login again." });
    return res.status(401).json({ message: "Invalid token. Please login." });
  }
};

/* ── Role-based access: authorize(...roles) ── */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user)
    return res.status(401).json({ message: "Not authenticated" });
  if (!roles.includes(req.user.role))
    return res.status(403).json({
      message: `Access denied. Required role: ${roles.join(" or ")}. Your role: ${req.user.role}`,
    });
  next();
};

/* ── Admin only shorthand ── */
const adminOnly = authorize("Admin");

module.exports = { authenticate, authorize, adminOnly };
