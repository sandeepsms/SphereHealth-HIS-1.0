const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    name: String,
    age: Number,
    gender: String,
    birth: Date,
    contact: String,
    contactno: String,
    email: String,
    address: String,
    city: String,
    state: String,
    date: String,
    time: String,
    blood: String,
    allergies: String,
    companion: String,
    relationship: String,
    martial: String,
    ward: String,
    UHID: String,
    OPDpricedata: Number,
    TPAid: String,
    DoctorName: String,
    DoctorSpecilist: String,
    DoctorDegree: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema); //mongoose ek function hai jo ek Model banata hai.
// aur Model ek JavaScript class jiske through tum MongoDB collection ke saath kaam karte ho. aur is model ka naam Patient hai jo mongodb mai bana milega
// patientSchema ye design hai mongodb mai jo tumne yaha uper banaya hai
//Node.js me module.exports ka use kisi file ka code dusri file me use karne ke liye hota hai.
