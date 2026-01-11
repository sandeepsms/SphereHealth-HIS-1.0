const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
require("dotenv").config();

const app = express();

// const patientRoutes = require("./routes/patientRoutes");
// const doctorRoutes = require("./routes/doctorsRoutes");
// const ServicebillRoutes = require("./routes/ServicebillRoutes");
// const RegistrationOPDRoutes = require("./routes/Opd");
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
// app.use("/api/RegistrationOPD", RegistrationOPDRoutes);
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

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
