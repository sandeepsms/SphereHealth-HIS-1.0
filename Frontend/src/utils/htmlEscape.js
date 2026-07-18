// Shared 5-char HTML escaper for the print / note-card builders.
// Policy (& < > " ') matches the R7hr-251 audit hardening for single-quoted
// attribute contexts. Byte-identical to the four inline copies it replaces
// (buildDoctorNoteCardHtml, printNurseNote, buildInitialAssessmentHtml,
// signatureImg) — pure fn, no imports, node-safe (bundled into the standalone
// print builders). NOTE: iaNabhRenderers keeps its own 4-char esc on purpose
// (text-content only, no single-quoted attrs) — do NOT fold it in here.
export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
