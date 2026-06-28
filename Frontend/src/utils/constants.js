export const BED_STATUS = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  MAINTENANCE: "Maintenance",
  BLOCKED: "Blocked",
  RESERVED: "Reserved",
};

export const BED_STATUS_COLORS = {
  Available: "#10b981",
  Occupied: "#ef4444",
  Maintenance: "#f59e0b",
  Blocked: "#6b7280",
  Reserved: "#6366f1",
};

export const BED_STATUS_ICONS = {
  Available: "pi-check-circle",
  Occupied: "pi-times-circle",
  Maintenance: "pi-wrench",
  Blocked: "pi-ban",
  Reserved: "pi-clock",
};

export const ADMISSION_STATUS = {
  ACTIVE: "Active",
  DISCHARGED: "Discharged",
  CANCELLED: "Cancelled",
  TRANSFERRED: "Transferred",
};

export const ADMISSION_TYPES = [
  { label: "Emergency", value: "Emergency" },
  { label: "Planned", value: "Planned" },
  { label: "Transfer", value: "Transfer" },
  { label: "Day Care", value: "Day Care" },
];

export const ROOM_TYPES = [
  { label: "General Ward", value: "General Ward" },
  { label: "ICU", value: "ICU" },
  { label: "NICU", value: "NICU" },
  { label: "CCU", value: "CCU" },
  { label: "HDU", value: "HDU" },
  { label: "Private Room", value: "Private Room" },
  { label: "Semi-Private", value: "Semi-Private" },
  { label: "Deluxe", value: "Deluxe" },
  { label: "Suite", value: "Suite" },
  { label: "Emergency", value: "Emergency" },
  { label: "Daycare", value: "Daycare" },
  { label: "Isolation", value: "Isolation" },
  { label: "Maternity", value: "Maternity" },
  { label: "Pediatric", value: "Pediatric" },
  { label: "Operation Theatre", value: "Operation Theatre" },
  { label: "Recovery Room", value: "Recovery Room" },
  { label: "Other", value: "Other" },
];

export const WARD_TYPES = [
  { label: "ICU", value: "ICU" },
  { label: "Private", value: "Private" },
  { label: "Semi-Private", value: "Semi-Private" },
  { label: "General", value: "General" },
   { label: "Emergency", value: "Emergency" },
  { label: "Male Ward", value: "Male Ward" },
  { label: "Female Ward", value: "Female Ward" },
  { label: "Pediatric", value: "Pediatric" },
];

export const CLASSIFICATION_TYPES = [
  { label: "Economy", value: "Economy" },
  { label: "Standard", value: "Standard" },
  { label: "Premium", value: "Premium" },
  { label: "Deluxe", value: "Deluxe" },
  { label: "VIP", value: "VIP" },
];

export const SERVICE_CATEGORIES = [
  { label: "Room Facilities", value: "Room Facilities" },
  { label: "Medical Equipment", value: "Medical Equipment" },
  { label: "Nursing Services", value: "Nursing Services" },
  { label: "Consultation", value: "Consultation" },
  { label: "Laboratory", value: "Laboratory" },
  { label: "Radiology", value: "Radiology" },
  { label: "Procedures", value: "Procedures" },
  { label: "Surgery", value: "Surgery" },
  { label: "Pharmacy", value: "Pharmacy" },
  { label: "Dietary", value: "Dietary" },
  { label: "Other Services", value: "Other Services" },
];

export const SERVICE_UNITS = [
  { label: "Per Day", value: "Per Day" },
  { label: "Per Hour", value: "Per Hour" },
  { label: "Per Session", value: "Per Session" },
  { label: "Per Unit", value: "Per Unit" },
  { label: "One-time", value: "One-time" },
];

// Re-export from the single source of truth so legacy imports keep working.
export { API_BASE_URL } from "../config/api";
