require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error(
    "FATAL: JWT_SECRET is missing or too short (<32 chars). " +
      "Set a strong random value in Backend/.env before starting the server."
  );
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
};

const app = express();

// Register all Mongoose models upfront to avoid "Schema hasn't been registered" errors on populate
require("./models/bedMgmt/bedsModel");
require("./models/bedMgmt/wardModel");
require("./models/bedMgmt/roomModel");
require("./models/bedMgmt/floorModel");
require("./models/bedMgmt/buildingModel");
require("./models/Patient/patientModel");
require("./models/Patient/admissionModel");
require("./models/Patient/OPDModels");
require("./models/nursing/NursingConsumableItem");
require("./models/nursing/NursingChargeEntry");
require("./models/Billing/BillingTrigger");

// Seed nursing consumable master list if empty
require("./services/nursing/nursingChargesService").seedDefaultItems().catch(() => {});

// ── Daily bed-charge accrual job ────────────────────────────────────────────
// Auto-bill IPD/Day-Care bed charges once per calendar day. The accrual
// function uses dailyDedup so it is safe to fire multiple times per day —
// the second + third invocations are no-ops if today's charge already exists.
// First run is delayed 60s after boot so the DB connection is up; subsequent
// runs every 6 hours so a missed midnight tick still catches up the same day.
const _autoBilling = require("./services/Billing/autoBillingService");
setTimeout(() => {
  _autoBilling.runDailyBedChargeAccrual()
    .then(r => console.log("[daily-accrual] boot:", r))
    .catch(e => console.error("[daily-accrual] boot error:", e.message));
}, 60_000);
setInterval(() => {
  _autoBilling.runDailyBedChargeAccrual()
    .then(r => console.log("[daily-accrual]:", r))
    .catch(e => console.error("[daily-accrual] error:", e.message));
}, 6 * 60 * 60 * 1000);

const patientRoutes = require("./routes/Patient/patientRoutes");
// const doctorRoutes = require("./routes/doctorsRoutes");
// const ServicebillRoutes = require("./routes/ServicebillRoutes");
// const BedRoutes = require("./routes/Bedroutes");
// const WardchargesRoutes = require("./routes/WardchargesRoutes");

app.use(cors(corsOptions));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

connectDB();

app.get("/", (req, res) => {
  res.send("Server is running with MongoDB");
});

// app.use("/api/patients", patientRoutes);
// app.use("/api/doctordetail", doctorRoutes);
// app.use("/api/Servicebilldata", ServicebillRoutes);
// app.use("/api/beds", BedRoutes);
// app.use("/api/ward-charges", WardchargesRoutes);

//my work
app.use("/api", require("./routes/index"));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
