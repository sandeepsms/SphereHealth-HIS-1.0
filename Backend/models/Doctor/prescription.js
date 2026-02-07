// const mongoose = require("mongoose");

// const prescriptionSchema = new mongoose.Schema(
//   {
//     // Patient Info
//     patient: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Patient",
//       required: true,
//     },
//     UHID: {
//       type: String,
//       required: true,
//     },

//     // Doctor Info
//     doctor: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Doctor",
//       required: true,
//     },

//     // Registration Type
//     registrationType: {
//       type: String,
//       enum: ["OPD", "IPD", "Emergency"],
//       required: true,
//     },

//     // Clinical Details
//     clinicalDetails: {
//       historyOfAllergy: String,
//       historyOfPresentIllness: String,
//       physicalExamination: String,
//     },

//     // Vitals
//     vitals: {
//       weight: String,
//       temperature: String,
//       bloodPressure: String,
//       pulse: String,
//     },

//     // Diagnosis
//     provisionalDiagnosis: {
//       type: String,
//       required: true,
//     },

//     // Medicines
//     medicines: [
//       {
//         medicineName: String,
//         schedule: String,
//         instruction: String,
//         route: String,
//         days: Number,
//       },
//     ],

//     // Investigations (TPA Services)




//     investigations: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "TPAServices",
//       },
//     ],

//     // Advice
//     advice: String,

//     // Referred By
//     referredBy: String,

//     // Timestamps
//     prescriptionDate: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   {
//     timestamps: true,
//   },
// );

// module.exports = mongoose.model("Prescription", prescriptionSchema);












const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    // ================= PATIENT INFO =================
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    UHID: {
      type: String,
      required: true,
    },

    patientName: {
      type: String,
      // required: true,
    },

    age: {
      type: Number,
      default: 0,
    },

    gender: {
      type: String,
    },

    contactNumber: {
      type: String,
    },

    fatherName: {
      type: String,
    },

    department: {
      type: String,
    },

    date: {
      type: String, // frontend se string aa rahi hai
    },

    // ================= DOCTOR INFO =================
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    referredBy: {
      type: String,
    },

    // ================= REGISTRATION =================
    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency"],
      default: "OPD",
    },

    // ================= CLINICAL DETAILS =================
    clinicalDetails: {
      historyOfAllergy: String,
      historyOfPresentIllness: String,
      physicalExamination: String,
    },

    // ================= VITALS =================
    vitals: {
      weight: Number,
      temperature: Number,
      bloodPressure: String,
      pulse: Number,
    },

    // ================= DIAGNOSIS =================
    provisionalDiagnosis: {
      type: String,
      required: true,
    },

    // ================= MEDICINES =================
    medicines: [
      {
        medicineName: String,
        schedule: String,
        instruction: String,
        route: String,
        days: Number,
      },
    ],

    // ================= INVESTIGATIONS =================
    investigations: [
      {
        // type: mongoose.Schema.Types.ObjectId,
        type:String,
        ref: "TPAServices",
      
      },
    ],

    // ================= ADVICE =================
    advice: {
      type: String,
    },

    prescriptionDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prescription", prescriptionSchema);


    



// const mongoose = require("mongoose");

// const prescriptionSchema = new mongoose.Schema(
//   {
//     patient: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Patient",
//       required: true,
//     },

//     UHID: {
//       type: String,
//       required: true,
//     },

//     doctor: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Doctor",
//       required: true,
//     },

//     registrationType: {
//       type: String,
//       enum: ["OPD", "IPD", "Emergency"],
//     },

//     referredBy: String,

//     provisionalDiagnosis: {
//       type: String,
//       required: true,
//     },

//     clinicalDetails: {
//       historyOfAllergy: String,
//       historyOfPresentIllness: String,
//       physicalExamination: String,
//     },

//     vitals: {
//       weight: String,
//       temperature: String,
//       bloodPressure: String,
//       pulse: String,
//     },

//     medicines: [
//       {
//         medicineName: String,
//         schedule: String,
//         instruction: String,
//         route: String,
//         days: String,
//       },
//     ],

//     investigations: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "TPAServices",
//       },
//     ],

//     advice: String,
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Prescription", prescriptionSchema);
