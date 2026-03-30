module.exports = function validate(requiredFields = []) {
  return (req, res, next) => {
    const requestData = req.method === "GET" ? req.query : req.body;

    const missing = requiredFields.filter(field => {
      const value = requestData[field];
      return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`
      });
    }

    next();
  };
};
