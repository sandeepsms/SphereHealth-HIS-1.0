/**
 * PatientHistoryPage.jsx
 * Full patient visit timeline — search patient → see all OPD/IPD/Emergency visits
 * Roles: Admin, Doctor, Nurse
 */

import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import patientService from "../../Services/patient/patientService";
import opdService from "../../Services/patient/opdService";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const calcAge = (dob) => {
  if (!dob) return "—";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "—" : `${a} yrs`;
};

const VISIT_COLORS = {
  OPD:       { bg: "#e0f2fe", color: "#0369a1", border: "#bae6fd", icon: "pi-calendar" },
  IPD:       { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd", icon: "pi-bed" },
  Emergency: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", icon: "pi-bolt" },
};

export default function PatientHistoryPage() {
  const navigate = useNavigate();
  const toast = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState(null);
  const [opdHistory, setOpdHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const doSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchDone(false);
    setSelectedPatient(null);
    try {
      const res = await patientService.searchPatients(searchQuery.trim(), 15);
      setSearchResults(res.data || []);
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: e.message, life: 3000 });
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  };

  const selectPatient = async (patient) => {
    setSelectedPatient(patient);
    setOpdHistory([]);
    setLoadingHistory(true);
    try {
      const res = await opdService.getPatientOPDHistory(patient._id);
      const list = res.data?.data || res.data || [];
      setOpdHistory(Array.isArray(list) ? list : []);
    } catch (e) { /* silent */ } finally {
      setLoadingHistory(false);
    }
  };

  const totalVisits = selectedPatient
    ? (selectedPatient.totalOPDVisits || 0) + (selectedPatient.totalIPDVisits || 0) + (selectedPatient.totalEmergencyVisits || 0)
    : 0;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <Toast ref={toast} />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)", borderRadius: 14, padding: "20px 24px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <i className="pi pi-clock" style={{ fontSize: 26 }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Patient Visit History</div>
            <div style={{ opacity: .8, fontSize: 13 }}>Search any patient to view their complete visit timeline</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", marginBottom: 20, boxShadow: "0 1px 6px rgba(0,0,0,.07)" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <InputText value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="Search by Name, UHID, or Phone…" style={{ flex: 1, fontSize: 15, padding: "10px 14px" }} autoFocus />
          <Button label={searching ? "Searching…" : "Search"} icon={searching ? "pi pi-spin pi-spinner" : "pi pi-search"}
            onClick={doSearch} disabled={searching || searchQuery.trim().length < 2}
            style={{ background: "#7c3aed", border: "none", padding: "10px 20px" }} />
        </div>
      </div>

      {/* Search Results */}
      {searching && <div style={{ textAlign: "center", padding: 32 }}><ProgressSpinner style={{ width: 36, height: 36 }} /></div>}

      {searchDone && !searching && !selectedPatient && (
        <div style={{ marginBottom: 16 }}>
          {searchResults.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 10, padding: 32, textAlign: "center", color: "#94a3b8", boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}>
              No patient found for "{searchQuery}"
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>{searchResults.length} patient(s) found — click to view history</div>
              {searchResults.map(p => (
                <div key={p._id} onClick={() => selectPatient(p)}
                  style={{ background: "#fff", borderRadius: 10, padding: "14px 18px", marginBottom: 8, cursor: "pointer", boxShadow: "0 1px 6px rgba(0,0,0,.06)", border: "2px solid transparent", display: "flex", alignItems: "center", gap: 14, transition: "border-color .15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#7c3aed"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}
                >
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className="pi pi-user" style={{ color: "#7c3aed", fontSize: 20 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, color: "#1e293b" }}>{p.title} {p.fullName}</span>
                      <Tag value={p.UHID} severity="info" style={{ fontSize: 11, fontWeight: 700 }} />
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      {p.gender} · {calcAge(p.dateOfBirth)} · {p.contactNumber}
                      {p.lastVisitDate && <span> · Last visit: {fmtDate(p.lastVisitDate)}</span>}
                    </div>
                  </div>
                  <i className="pi pi-chevron-right" style={{ color: "#94a3b8" }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Patient Profile + History */}
      {selectedPatient && (
        <div>
          {/* Patient Card */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className="pi pi-user" style={{ color: "#7c3aed", fontSize: 26 }} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>{selectedPatient.title} {selectedPatient.fullName}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ background: "#7c3aed", color: "#fff", padding: "2px 10px", borderRadius: 20, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>{selectedPatient.UHID}</span>
                    <span style={{ fontSize: 13, color: "#64748b" }}>{selectedPatient.gender} · {calcAge(selectedPatient.dateOfBirth)}</span>
                    {selectedPatient.bloodGroup && <Tag value={selectedPatient.bloodGroup} severity="danger" style={{ fontSize: 11 }} />}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                    <i className="pi pi-phone" style={{ fontSize: 11, marginRight: 4 }} />{selectedPatient.contactNumber}
                    {selectedPatient.email && <span> · {selectedPatient.email}</span>}
                  </div>
                </div>
              </div>
              <Button label="Back to Search" icon="pi pi-arrow-left" className="p-button-outlined"
                style={{ color: "#7c3aed", border: "1px solid #c4b5fd" }}
                onClick={() => { setSelectedPatient(null); setOpdHistory([]); setSearchDone(false); }} />
            </div>

            {/* Visit counters */}
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              {[
                ["OPD Visits", selectedPatient.totalOPDVisits || 0, "#0369a1", "#e0f2fe"],
                ["IPD Admissions", selectedPatient.totalIPDVisits || 0, "#5b21b6", "#ede9fe"],
                ["Emergency", selectedPatient.totalEmergencyVisits || 0, "#991b1b", "#fee2e2"],
                ["Total Visits", totalVisits, "#166534", "#dcfce7"],
              ].map(([k, v, color, bg]) => (
                <div key={k} style={{ background: bg, borderRadius: 8, padding: "10px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{v}</div>
                  <div style={{ fontSize: 11, color, opacity: .8 }}>{k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* OPD History */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 6px rgba(0,0,0,.07)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-calendar" style={{ color: "#0891b2" }} />
              OPD Visit History
              {!loadingHistory && <Tag value={`${opdHistory.length} visits`} severity="info" style={{ fontSize: 11 }} />}
            </div>

            {loadingHistory ? (
              <div style={{ textAlign: "center", padding: 32 }}>
                <ProgressSpinner style={{ width: 36, height: 36 }} />
              </div>
            ) : opdHistory.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                <i className="pi pi-inbox" style={{ fontSize: 32 }} />
                <div style={{ marginTop: 8 }}>No OPD visits on record</div>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                {/* Timeline line */}
                <div style={{ position: "absolute", left: 23, top: 0, bottom: 0, width: 2, background: "#e2e8f0", zIndex: 0 }} />

                {opdHistory.map((visit, i) => {
                  const docName = visit.doctorId?.personalInfo
                    ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
                    : visit.consultantName || "—";
                  const deptName = visit.departmentId?.departmentName || visit.department || "—";
                  const isLatest = i === 0;

                  return (
                    <div key={visit._id} style={{ position: "relative", paddingLeft: 52, marginBottom: 16 }}>
                      {/* Timeline dot */}
                      <div style={{
                        position: "absolute", left: 12, top: 14, width: 22, height: 22, borderRadius: "50%",
                        background: isLatest ? "#0891b2" : "#e2e8f0",
                        border: `3px solid ${isLatest ? "#0891b2" : "#cbd5e1"}`,
                        zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {isLatest && <i className="pi pi-circle-fill" style={{ color: "#fff", fontSize: 6 }} />}
                      </div>

                      <div style={{ background: isLatest ? "#f0f9ff" : "#f8fafc", border: `1px solid ${isLatest ? "#bae6fd" : "#e2e8f0"}`, borderRadius: 10, padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, color: "#0891b2", fontSize: 13 }}>{visit.visitNumber}</span>
                              {isLatest && <Tag value="Latest" severity="success" style={{ fontSize: 10 }} />}
                              <Tag value={`OPD #${visit.patientVisitSeq || i + 1}`} severity="info" style={{ fontSize: 10 }} />
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{deptName} · {docName}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{fmtDate(visit.visitDate)}</div>
                            <Tag value={visit.status} severity={visit.status === "Completed" ? "success" : visit.status === "Waiting" ? "warning" : "info"} style={{ fontSize: 10 }} />
                          </div>
                        </div>

                        <div style={{ marginTop: 10, fontSize: 13 }}>
                          <div style={{ marginBottom: 4 }}>
                            <strong style={{ color: "#475569" }}>Chief Complaint:</strong>{" "}
                            <span style={{ color: "#1e293b" }}>{visit.chiefComplaint}</span>
                          </div>
                          {visit.provisionalDiagnosis && (
                            <div style={{ marginBottom: 4 }}>
                              <strong style={{ color: "#475569" }}>Diagnosis:</strong>{" "}
                              <span style={{ color: "#0891b2" }}>{visit.provisionalDiagnosis}</span>
                            </div>
                          )}
                          {visit.prescribedMedications?.length > 0 && (
                            <div style={{ marginBottom: 4 }}>
                              <strong style={{ color: "#475569" }}>Medications:</strong>{" "}
                              <span style={{ color: "#1e293b" }}>{visit.prescribedMedications.map(m => `${m.medicineName} ${m.dosage || ""}`.trim()).join(" · ")}</span>
                            </div>
                          )}
                          {visit.vitals && (visit.vitals.bloodPressure || visit.vitals.pulse) && (
                            <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                              {visit.vitals.bloodPressure && <VitalChip label="BP" value={visit.vitals.bloodPressure} />}
                              {visit.vitals.pulse && <VitalChip label="HR" value={`${visit.vitals.pulse} bpm`} />}
                              {visit.vitals.temperature && <VitalChip label="Temp" value={`${visit.vitals.temperature}°F`} />}
                              {visit.vitals.oxygenSaturation && <VitalChip label="SpO2" value={`${visit.vitals.oxygenSaturation}%`} />}
                              {visit.vitals.weight && <VitalChip label="Wt" value={`${visit.vitals.weight} kg`} />}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                          <Tag value={visit.visitType} severity="secondary" style={{ fontSize: 10 }} />
                          {visit.followUpRequired && visit.followUpDate && (
                            <Tag value={`Follow-up: ${fmtDate(visit.followUpDate)}`} severity="warning" style={{ fontSize: 10 }} />
                          )}
                          {visit.vitalsStatus === "Done" && <Tag value="Vitals Done" severity="success" style={{ fontSize: 10 }} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VitalChip({ label, value }) {
  return (
    <span style={{ background: "#f1f5f9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#475569" }}>
      <strong>{label}:</strong> {value}
    </span>
  );
}
