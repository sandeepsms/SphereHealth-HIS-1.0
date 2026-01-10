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
//tpa and cash
module.exports = mongoose.model("Services", ServiceSchema);
