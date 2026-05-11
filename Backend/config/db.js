const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // useNewUrlParser / useUnifiedTopology are no-ops since MongoDB
    // Node driver 4.0+; the deprecation warnings stop once they're omitted.
    await mongoose.connect(process.env.MONGO_URI);
    console.log(" MongoDB connected");

    const Beds = require("../models/bedMgmt/bedsModel");
    const Building = require("../models/bedMgmt/buildingModel");
    const Floor = require("../models/bedMgmt/floorModel");
    const Ward = require("../models/bedMgmt/wardModel");
    const Room = require("../models/bedMgmt/roomModel");

    try {
      await Beds.collection.dropIndex("id_1");
      console.log(" Dropped id_1 index from beds");
    } catch (error) {
      if (error.code === 27 || error.message.includes("index not found")) {
        console.log(" Index id_1 already dropped or does not exist");
      } else {
        console.log("⚠️  Error dropping index:", error.message);
      }
    }

    await Building.syncIndexes();
    await Floor.syncIndexes();
    await Ward.syncIndexes();
    await Room.syncIndexes();
    await Beds.syncIndexes();
    console.log("All bed management indexes synced");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
