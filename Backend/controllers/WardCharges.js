
const WardCharges = require("../models/WardChargeSchema");

exports.setWardCharges = async (req, res) => {
  try {
    let data = req.body;

    // If single object → convert to array
    if (!Array.isArray(data)) {
      data = [data];
    }

    const savedData = [];
    const skipped = [];

    for (let item of data) {
      let { category, price, createdAt } = item;

      if (!category || !price) {
        skipped.push({ item, reason: "Category and price required" });
        continue;
      }

      // Convert category to array
      if (!Array.isArray(category)) {
        category = [category];
      }

      // Check duplicate
      const exist = await WardCharges.findOne({ category: category[0] });
      if (exist) {
        skipped.push({ category: category[0], reason: "Already exists" });
        continue;
      }

      // Save
      const saved = await WardCharges.create({
        category,
        price,
        createdAt: createdAt ? new Date(createdAt) : new Date()
      });

      savedData.push(saved);
    }

    return res.status(201).json({
      message: "Processed",
      saved: savedData,
      skipped
    });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};




// controller


exports.getWardCharges = async (req, res) => {
  try {
    const data = await WardCharges.find().select('category price -_id');
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
