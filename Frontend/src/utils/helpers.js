export const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const formatDateTime = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return "₹0";
  return `₹${Number(amount).toLocaleString("en-IN")}`;
};

export const calculateDays = (startDate, endDate) => {
  if (!startDate) return 0;
  const end = endDate ? new Date(endDate) : new Date();
  const start = new Date(startDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : 1;
};

export const getBedStatusSeverity = (status) => {
  const severityMap = {
    Available: "success",
    Occupied: "danger",
    Maintenance: "warning",
    Blocked: "secondary",
    Reserved: "info",
  };
  return severityMap[status] || "secondary";
};

export const getAdmissionStatusSeverity = (status) => {
  const severityMap = {
    Active: "success",
    Discharged: "info",
    Cancelled: "danger",
    Transferred: "warning",
  };
  return severityMap[status] || "secondary";
};

export const validateRequired = (value) => {
  return value !== null && value !== undefined && value !== "";
};

export const validateNumber = (value) => {
  return !isNaN(value) && value >= 0;
};

export const generateUniqueCode = (prefix = "") => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `${prefix}${timestamp}${random}`.toUpperCase();
};

export const filterBySearch = (items, searchTerm, fields) => {
  if (!searchTerm) return items;
  const term = searchTerm.toLowerCase();
  return items.filter((item) =>
    fields.some((field) => {
      const value = field.split(".").reduce((obj, key) => obj?.[key], item);
      return value?.toString().toLowerCase().includes(term);
    })
  );
};

export const sortByField = (items, field, order = "asc") => {
  return [...items].sort((a, b) => {
    const aVal = field.split(".").reduce((obj, key) => obj?.[key], a);
    const bVal = field.split(".").reduce((obj, key) => obj?.[key], b);

    if (aVal < bVal) return order === "asc" ? -1 : 1;
    if (aVal > bVal) return order === "asc" ? 1 : -1;
    return 0;
  });
};

export const groupBy = (items, key) => {
  return items.reduce((result, item) => {
    const groupKey = key.split(".").reduce((obj, k) => obj?.[k], item);
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
};

export const calculateOccupancyRate = (occupied, total) => {
  if (!total || total === 0) return 0;
  return ((occupied / total) * 100).toFixed(2);
};

export const showToast = (toast, severity, summary, detail) => {
  toast?.current?.show({
    severity,
    summary,
    detail,
    life: 3000,
  });
};
