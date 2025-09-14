



const Servicebilldata = require("../models/servicesbillModel");

// ➕ Add Services (Normal aur TPA alag-alag)
exports.Servicebillfun = async (req, res) => {
  console.log(req.body);
  
  try {
    let { tpa_name, service } = req.body;

    // 🟢 Default Normal if tpa_name empty
    if (!tpa_name || tpa_name.trim() === "") {
      tpa_name = "Normal";
    }

    // 🟢 Validate service array
    if (!Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ success: false, message: "Service array is required" });
    }

    // 🟢 Format service details
    const formattedServices = service.map((u) => ({
      Name: u.Name,
      Amount: Number(u.Amount) || 0,
      Discount: Number(u.Discount) || 0,
      Totalamount: Number(u.Totalamount) || 0,
    }));

    // 🟢 Duplicate Check within same category (Normal/TPA)
    const existingDoc = await Servicebilldata.findOne({ tpa_name });
    if (existingDoc) {
      const duplicates = formattedServices.filter((item) =>
        existingDoc.service.some((s) => s.Name === item.Name)
      );
      if (duplicates.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Duplicate service(s) found under '${tpa_name}': ${duplicates
            .map((d) => d.Name)
            .join(", ")}`,
        });
      }

      // ➕ Add services to the correct category document
      existingDoc.service.push(...formattedServices);
      await existingDoc.save();

      return res.status(200).json({
        success: true,
        message: `Services added under '${tpa_name}'`,
        data: existingDoc,
      });
    }

    // 🆕 Create new document for this category
    const newDoc = await Servicebilldata.create({
      tpa_name,
      service: formattedServices,
    });

    res.status(201).json({
      success: true,
      message: `Services saved separately under '${tpa_name}'`,
      data: newDoc,
    });
  } catch (error) {
    console.error("Error saving services:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📥 Fetch All Services
exports.TestName = async (req, res) => {
  try {
    const tests = await Servicebilldata.find();
    res.status(200).json(tests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
