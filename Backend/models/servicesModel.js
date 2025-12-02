const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    tpa_name: String,
      service: [
        {
          Name: String,
          Amount: Number,
          Discount: Number,
          Totalamount: Number,
        },
      ],
  },
  { timestamps: true }  
);

module.exports = mongoose.model("Services", ServiceSchema); //mongoose ek function hai jo ek Model banata hai.
// aur Model ek JavaScript class jiske through tum MongoDB collection ke saath kaam karte ho. aur is model ka naam Patient hai jo mongodb mai bana milega
// patientSchema ye design hai mongodb mai jo tumne yaha uper banaya hai
//Node.js me module.exports ka use kisi file ka code dusri file me use karne ke liye hota hai.
