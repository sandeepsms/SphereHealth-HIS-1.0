const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    tpaName: {
      type: String,
      required: true,
    },

    tpaCode: {
      type: String,
      unique: true,
    },

    service: [
      {
        Name: String,
        Amount: Number,
        Discount: Number,
        Totalamount: Number,
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("TPAServices", ServiceSchema);
