const mongoose = require("mongoose");
require("dotenv").config();

const fixIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const db = mongoose.connection.db;
    const collection = db.collection("beds");
 
    const indexes = await collection.indexes();
    console.log("Current indexes:", indexes);

    
    try {
      await collection.dropIndex("id_1");
      console.log("✅ Dropped id_1 index");
    } catch (error) {
      console.log("Index id_1 does not exist or already dropped");
    }
 
    const newIndexes = await collection.indexes();
    console.log("Indexes after cleanup:", newIndexes);

    console.log("✅ Index fix complete");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

fixIndexes();
