// controllers/tpa/tpaServiceController.js
const TPAService = require("../../models/tpa/TPAServicesModel");
const TPA = require("../../models/tpa/tpaModel");

// Create TPA Service
exports.createTPAService = async (req, res) => {
  try {
    const { tpaName, service } = req.body;

    if (!Array.isArray(service) || service.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one service/test is required",
      });
    }

    if (!tpaName || tpaName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "TPA Name is required",
      });
    }

    // Find TPA by name to get ObjectId and tpaCode
    const tpaData = await TPA.findOne({
      tpaName: tpaName.trim(),
      isActive: { $ne: false },
    });

    if (!tpaData) {
      return res.status(404).json({
        success: false,
        message: `TPA '${tpaName}' not found or is inactive`,
      });
    }

    // Calculate total amounts for services
    const processedServices = service.map((item) => ({
      Name: item.Name,
      Amount: Number(item.Amount) || 0,
      Discount: Number(item.Discount) || 0,
      Totalamount:
        Number(item.Amount || 0) -
        (Number(item.Amount || 0) * Number(item.Discount || 0)) / 100,
    }));

    // Check if TPA Service already exists for this TPA
    let existingTPAService = await TPAService.findOne({ tpa: tpaData._id });

    if (existingTPAService) {
      // Check for duplicate test names
      const duplicateTests = [];
      for (let newTest of processedServices) {
        const isDuplicate = existingTPAService.service.some(
          (oldTest) =>
            oldTest.Name.toLowerCase().trim() ===
            newTest.Name.toLowerCase().trim(),
        );
        if (isDuplicate) {
          duplicateTests.push(newTest.Name);
        }
      }

      if (duplicateTests.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Duplicate test(s) found: ${duplicateTests.join(", ")}`,
        });
      }

      // Add new tests
      existingTPAService.service.push(...processedServices);
      await existingTPAService.save();

      return res.status(200).json({
        success: true,
        message: `${processedServices.length} test(s) added successfully`,
        data: existingTPAService,
      });
    }

    // Create new TPA Service
    const tpaService = new TPAService({
      tpa: tpaData._id,
      tpaName: tpaData.tpaName,
      tpaCode: tpaData.tpaCode,
      service: processedServices,
      isActive: true,
    });

    await tpaService.save();

    res.status(201).json({
      success: true,
      message: "TPA Service created successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error creating TPA Service:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "TPA Code already exists",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All TPA Services
exports.getAllTPAServices = async (req, res) => {
  try {
    const { search, isActive } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { tpaName: { $regex: search, $options: "i" } },
        { tpaCode: { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const tpaServices = await TPAService.find(query)
      .populate("tpa", "tpaName tpaCode phone email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tpaServices.length,
      data: tpaServices,
    });
  } catch (error) {
    console.error("Error fetching TPA Services:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

//Get TPA Service by ID
exports.getTPAServiceById = async (req, res) => {
  try {
     const { id } = req.params;
    const tpaService = await TPAService.findOne({ tpa: id }).populate(
      "tpa",
      "tpaName tpaCode phone email contactPerson",
    );

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not foundssssssssss",
      });
    }

    res.status(200).json({
      success: true,
      data: tpaService,
    });
  } catch (error) {
    console.error("Error fetching TPA Service by ID:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};





// const mongoose = require("mongoose");

// // Get TPA Service by TPA ID
// exports.getTPAServiceById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // ✅ ObjectId validation
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid TPA ID",
//       });
//     }

//     // 🔥 MAIN FIX: findOne instead of findById
//     const tpaService = await TPAService.findOne({ tpa: id }).populate(
//       "tpa",
//       "tpaName tpaCode phone email contactPerson"
//     );

//     if (!tpaService) {
//       return res.status(404).json({
//         success: false,
//         message: "TPA Service not found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       data: tpaService, // or tpaService.service if sirf services chahiye
//     });

//   } catch (error) {
//     console.error("Error fetching TPA Service by TPA ID:", error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };


// Get TPA Services by TPA ID
exports.getTPAServicesByTPAId = async (req, res) => {
  try {
    const tpaServices = await TPAService.find({ tpa: req.params.tpaId });

    if (!tpaServices || tpaServices.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No services found for this TPA",
      });
    }

    res.status(200).json({
      success: true,
      count: tpaServices.length,
      data: tpaServices,
    });
  } catch (error) {
    console.error("Error fetching TPA Services by TPA ID:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update TPA Service
exports.updateTPAService = async (req, res) => {
  try {
    const { tpaName, service } = req.body;
    const updateData = {};

    if (tpaName) {
      const tpaData = await TPA.findOne({
        tpaName: tpaName.trim(),
        isActive: { $ne: false },
      });

      if (!tpaData) {
        return res.status(404).json({
          success: false,
          message: `TPA '${tpaName}' not found`,
        });
      }

      updateData.tpa = tpaData._id;
      updateData.tpaName = tpaData.tpaName;
      updateData.tpaCode = tpaData.tpaCode;
    }

    if (service && service.length > 0) {
      updateData.service = service.map((item) => ({
        Name: item.Name,
        Amount: Number(item.Amount) || 0,
        Discount: Number(item.Discount) || 0,
        Totalamount:
          Number(item.Amount || 0) -
          (Number(item.Amount || 0) * Number(item.Discount || 0)) / 100,
      }));
    }

    const tpaService = await TPAService.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      },
    ).populate("tpa");

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "TPA Service updated successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error updating TPA Service:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "TPA Code already exists",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete TPA Service
exports.deleteTPAService = async (req, res) => {
  try {
    const tpaService = await TPAService.findByIdAndDelete(req.params.id);

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "TPA Service deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting TPA Service:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Add Service/Test to existing TPA Service
exports.addService = async (req, res) => {
  try {
    const { Name, Amount, Discount } = req.body;

    const Totalamount =
      Number(Amount) - (Number(Amount) * (Number(Discount) || 0)) / 100;

    const tpaService = await TPAService.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          service: { Name, Amount, Discount, Totalamount },
        },
      },
      { new: true },
    );

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Test added successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error adding service:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Remove Service/Test from TPA Service
exports.removeService = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const tpaService = await TPAService.findByIdAndUpdate(
      req.params.id,
      {
        $pull: { service: { _id: serviceId } },
      },
      { new: true },
    );

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Test removed successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error removing service:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Toggle Active Status
exports.toggleActiveStatus = async (req, res) => {
  try {
    const tpaService = await TPAService.findById(req.params.id);

    if (!tpaService) {
      return res.status(404).json({
        success: false,
        message: "TPA Service not found",
      });
    }

    tpaService.isActive = !tpaService.isActive;
    await tpaService.save();

    res.status(200).json({
      success: true,
      message: `TPA Service ${tpaService.isActive ? "activated" : "deactivated"} successfully`,
      data: tpaService,
    });
  } catch (error) {
    console.error("Error toggling active status:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
