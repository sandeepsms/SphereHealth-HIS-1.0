const Servicebilldata = require("../../models/tpa/TPAServicesModel");
const TPAModel = require("../../models/tpa/tpaModel");
const patientmodel = require("../../models/Patient/patientModel");

exports.Servicebillfun = async (req, res) => {
  try {
    let { tpaName, service } = req.body;

    // 🟢 Default Normal
    if (!tpaName || tpaName.trim() === "") {
      tpaName = "Normal";
    }

    // 🟢 Validate service
    if (!Array.isArray(service) || service.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Service array required",
      });
    }

    let tpaCode = "NORMAL";

    // 🟢 If TPA selected
    if (tpaName !== "Normal") {
      const tpaData = await TPAModel.findOne({ tpaName });

      if (!tpaData) {
        return res.status(404).json({
          success: false,
          message: "TPA not found",
        });
      }

      tpaCode = tpaData.tpaCode;
    }

    const formattedServices = service.map((s) => ({
      Name: s.Name,
      Amount: Number(s.Amount) || 0,
      Discount: Number(s.Discount) || 0,
      Totalamount:
        Number(s.Amount || 0) -
        (Number(s.Amount || 0) * Number(s.Discount || 0)) / 100,
    }));

    // 🟢 Find existing TPA document
    let existingDoc = await Servicebilldata.findOne({ tpaName });

    // 🟢 If exists → PUSH new services
    if (existingDoc) {
      // 🔴 Duplicate service check
      const duplicateServices = formattedServices.filter((newService) =>
        existingDoc.service.some(
          (oldService) => oldService.Name === newService.Name,
        ),
      );

      if (duplicateServices.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Duplicate service(s): ${duplicateServices
            .map((d) => d.Name)
            .join(", ")}`,
        });
      }

      existingDoc.service.push(...formattedServices);
      await existingDoc.save();

      return res.status(200).json({
        success: true,
        message: `Services added under '${tpaName}'`,
        data: existingDoc,
      });
    }

    // 🆕 If not exists → create new
    const saved = await Servicebilldata.create({
      tpaName,
      tpaCode,
      service: formattedServices,
    });

    res.status(201).json({
      success: true,
      message: "Service saved successfully",
      data: saved,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

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
    const TpaId = await TPAModel.findOne({
      _id: req.params.TpaId,
    });
    if (!TpaId) return res.status(404).json({ msg: "TpaID is not Found" });
    res.json(TpaId);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// exports.getTpaId = async (req, res) => {
//   console.log("PARAMS 👉", req.params);

//   try {
//     const { TpaId } = req.params;

//     if (!TpaId) {
//       return res.status(400).json({ msg: "TpaID is missing in params" });
//     }

//     // ✅ TPA model use karo (NOT Servicebilldata)
//     const tpaData = await TPAModel.findById(TpaId);

//     if (!tpaData) {
//       return res.status(404).json({ msg: "TpaID is not Found in DB" });
//     }

//     // ✅ Sirf services bhejna ho to
//     res.status(200).json({
//       success: true,
//       service: tpaData.service,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

//http://localhost:5000/api/Servicebilldata/getTpaId/68c5b52b6d3289d2ef2f0c73
