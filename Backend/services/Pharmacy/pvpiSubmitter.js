// Backend/services/Pharmacy/pvpiSubmitter.js
// R7bh-F5: PvPI (Pharmacovigilance Programme of India) ADR submission stub.
// Real Vigiflow API integration requires CDSCO/IPC authority registration.
// Until then we log + persist the submission attempt so audit chain is intact.

exports.send = async function send(payload) {
  // Future: HTTPS POST to IPC Vigiflow REST endpoint with auth token.
  // For now: shape the log so ops can replay manually if needed.
  console.log("[PvPI] queued ADR submission:", JSON.stringify({
    severity: payload?.reaction?.severity,
    drug: payload?.drug?.name,
    patientUHID: payload?.patient?.UHID,
    reportedAt: payload?.reportedAt,
  }));
  return {
    success: true,
    queuedAt: new Date(),
    pvpiReference: null, // populated by real backend once integrated
    transport: "stub",
  };
};
