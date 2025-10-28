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
      return res
        .status(400)
        .json({ success: false, message: "Service array is required" });
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
// exports.TestName = async (req, res) => {
//   try {

//     const tests = await Servicebilldata.find({ tpa_name: tpaName });
//     const tpaName = tests.service.filter((res)=>res.tpa_name == tpaName);
//      const opdData = {
//       tpa_name : tests.tpa_name,
//       opd_price : opd_price,
//       service:tests.service,
//     }
//     res.status(200).json({ success: true, data: tests });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// 📥 Fetch All Services

// exports.TestName = async (req, res) => {
//   try {
//     const tests = await Servicebilldata.find(); // Sare TPA + services fetch karega
//     res.status(200).json({ success: true, data: tests });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

exports.TestName = async (req, res) => {
  try {
    const tests = await Servicebilldata.find();
    res.status(200).json(tests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ GET API to fetch services by TPA name
exports.getOPDPrice = async (req, res) => {
  try {
    let { _id } = req.query; // Query param le rahe hain
    if (!_id) {
      return res
        .status(400)
        .json({ success: false, message: "_id is required" });
    }

    const tpaData = await Servicebilldata.findOne({ _id });
    if (!tpaData) {
      return res.status(404).json({ success: false, message: "No data found" });
    }
    const opd_price = tpaData.service.filter((res) => res.Name == "OPD");

    const opdData = {
      tpa_name: tpaData.tpa_name,
      opd_price: opd_price,
      id: tpaData._id,
    };
    res.status(200).json({ success: true, data: opdData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTpaId = async (req, res) => {
  console.log(req.params);

  try {
    const TpaId = await Servicebilldata.findOne({
      _id:req.params.TpaId,
    });
    if (!TpaId) return res.status(404).json({ msg: "TpaID is not Found" });
    res.json(TpaId);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



//http://localhost:5000/api/Servicebilldata/getTpaId/68c5b52b6d3289d2ef2f0c73