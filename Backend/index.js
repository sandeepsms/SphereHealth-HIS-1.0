const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
require("dotenv").config();

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

const patientRoutes = require("./routes/Patient/patientRoutes");
// const doctorRoutes = require("./routes/doctorsRoutes");
// const ServicebillRoutes = require("./routes/ServicebillRoutes");
// const BedRoutes = require("./routes/Bedroutes");
// const WardchargesRoutes = require("./routes/WardchargesRoutes");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
