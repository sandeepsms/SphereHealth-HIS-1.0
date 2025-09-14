

const Form = require("../models/OpdrModel");

exports.OPDform = async (req, res) => {
  console.log(req);
  try {
    const Registrationform = new Form(req.body);
    console.log("backend data",Registrationform);
    

    await Registrationform.save();
    res.status(201).json({
      success: true,
      message: "Form Submitted",
      data: Registrationform,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};