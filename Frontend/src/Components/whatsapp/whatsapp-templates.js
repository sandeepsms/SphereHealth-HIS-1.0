/**
 * WhatsApp message templates
 *
 * Each template is a pure function: (context) → message string.
 * Context fields are optional — templates handle undefined gracefully.
 *
 * Output is plain text with line breaks. The wa.me URL handler
 * encodes whitespace + emojis automatically.
 */

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

export const TEMPLATES = [
  {
    id: "appointment_confirmation",
    name: "Appointment Confirmation",
    icon: "pi-calendar-plus",
    description: "Confirm OPD slot with token + doctor + time",
    contextHint: "patientName · doctorName · date · time · tokenNumber",
    build: ({ patientName = "Sir/Madam", doctorName = "your doctor", date, time, tokenNumber, hospitalName = "SphereHealth Hospital" }) =>
      `Namaste ${patientName} 🙏\n\n` +
      `Aapka appointment confirm hai:\n` +
      `👨‍⚕️ Dr. ${doctorName}\n` +
      (date ? `📅 ${fmtDate(date)}\n` : "") +
      (time ? `🕐 ${time}\n` : "") +
      (tokenNumber ? `🎫 Token #${tokenNumber}\n` : "") +
      `\nKindly reach 15 minutes before your slot.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "doctor_late",
    name: "Doctor Running Late",
    icon: "pi-clock",
    description: "Inform patient about delay; suggest new time",
    contextHint: "patientName · doctorName · originalTime · newTime",
    build: ({ patientName = "Sir/Madam", doctorName = "Doctor", originalTime, newTime, hospitalName = "SphereHealth Hospital" }) =>
      `Dear ${patientName},\n\n` +
      `Dr. ${doctorName} is running late today. 🙏\n` +
      (originalTime ? `Your appointment was at ${originalTime}.\n` : "") +
      (newTime ? `Please come at ${newTime} instead.\n\n` : "Please come 30 min later than the original slot.\n\n") +
      `We are sorry for the inconvenience.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "bill_paid",
    name: "Bill Payment Receipt",
    icon: "pi-receipt",
    description: "Acknowledge payment with amount + mode",
    contextHint: "patientName · amount · mode · billNumber",
    build: ({ patientName = "Sir/Madam", amount = 0, mode = "Cash", billNumber, hospitalName = "SphereHealth Hospital" }) =>
      `Dear ${patientName},\n\n` +
      `We have received your payment ✅\n` +
      `💰 Amount: ₹${Number(amount).toLocaleString("en-IN")}\n` +
      `💳 Mode: ${mode}\n` +
      (billNumber ? `🧾 Bill #: ${billNumber}\n` : "") +
      `\nThank you for choosing us.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "lab_report_ready",
    name: "Lab Report Ready",
    icon: "pi-file",
    description: "Notify patient their reports are ready to collect",
    contextHint: "patientName · testName?",
    build: ({ patientName = "Sir/Madam", testName, hospitalName = "SphereHealth Hospital" }) =>
      `Dear ${patientName},\n\n` +
      `Your ${testName ? `${testName} ` : ""}lab report is ready 📋\n\n` +
      `Please collect from the reception, or share this number for digital copy on WhatsApp.\n` +
      `\nReception hours: 8 AM – 8 PM\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "discharge_intimation",
    name: "Discharge Intimation",
    icon: "pi-sign-out",
    description: "Inform attendant about discharge readiness",
    contextHint: "patientName · attendantRelation · expectedTime",
    build: ({ patientName = "patient", attendantRelation = "family", expectedTime, hospitalName = "SphereHealth Hospital" }) =>
      `Dear ${attendantRelation} of ${patientName},\n\n` +
      `${patientName} is being prepared for discharge.\n` +
      (expectedTime ? `Expected time: ${expectedTime}\n\n` : "\n") +
      `Please complete the final billing at reception before discharge.\n` +
      `Bring: ID proof + payment.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "followup_reminder",
    name: "Follow-up Reminder",
    icon: "pi-bell",
    description: "Remind patient about scheduled follow-up",
    contextHint: "patientName · doctorName · followupDate · time?",
    build: ({ patientName = "Sir/Madam", doctorName = "your doctor", followupDate, time, hospitalName = "SphereHealth Hospital" }) =>
      `Dear ${patientName},\n\n` +
      `Reminder for your follow-up visit:\n` +
      `👨‍⚕️ Dr. ${doctorName}\n` +
      (followupDate ? `📅 ${fmtDate(followupDate)}\n` : "") +
      (time ? `🕐 ${time}\n` : "") +
      `\nPlease carry your previous prescription / reports.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "ipd_admission_intimation",
    name: "IPD Admission Confirmed",
    icon: "pi-plus-circle",
    description: "Confirm bed assignment + visiting hours",
    contextHint: "patientName · bedNumber · wardName · admittingDoctor",
    build: ({ patientName = "patient", bedNumber, wardName, admittingDoctor, hospitalName = "SphereHealth Hospital" }) =>
      `Admission confirmed for ${patientName} ✅\n\n` +
      (bedNumber ? `🛏 Bed: ${bedNumber}\n` : "") +
      (wardName  ? `🏥 Ward: ${wardName}\n` : "") +
      (admittingDoctor ? `👨‍⚕️ Doctor: ${admittingDoctor}\n` : "") +
      `\nVisiting hours: 11 AM – 1 PM, 5 PM – 7 PM\n` +
      `Max 2 attendants per patient.\n` +
      `\n— ${hospitalName}`,
  },

  {
    id: "custom",
    name: "Custom Message",
    icon: "pi-pencil",
    description: "Write your own message",
    contextHint: "free-form",
    build: ({ patientName = "Sir/Madam", hospitalName = "SphereHealth Hospital", customText = "" }) =>
      customText || `Dear ${patientName},\n\n\n\n— ${hospitalName}`,
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

/**
 * Build a wa.me click-to-chat URL.
 * @param {string} phone — 10-digit Indian mobile (or with +91 prefix)
 * @param {string} text  — pre-filled message body
 */
export function buildWhatsAppURL(phone, text) {
  if (!phone) return null;
  // Strip non-digits, ensure leading 91 country code for India
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits;
  if (digits.length < 10)   return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
