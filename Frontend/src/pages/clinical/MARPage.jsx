import React, { useState } from "react";
import axios from "axios";
import API_BASE_URL from "../../config/api";

const API = `${API_BASE_URL}/mar`;

const STATUS_COLORS = {
  GIVEN: "bg-green-100 text-green-700",
  HELD: "bg-yellow-100 text-yellow-700",
  REFUSED: "bg-red-100 text-red-700",
  NOT_AVAILABLE: "bg-gray-100 text-gray-600",
  MISSED: "bg-orange-100 text-orange-700",
};

const ROUTES = ["Oral","IV","IM","SC","SL","Topical","Inhalation","Rectal","Other"];

export default function MARPage() {
  const [searchIPD, setSearchIPD] = useState("");
  const [searchDate, setSearchDate] = useState(new Date().toISOString().slice(0, 10));
  const [mar, setMAR] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAddMed, setShowAddMed] = useState(false);
  const [newMed, setNewMed] = useState({ medicineName: "", genericName: "", dose: "", unit: "", route: "Oral", frequency: "", scheduledTimes: "", startDate: searchDate, isHighAlert: false, isLASA: false, specialInstructions: "", prescribedByName: "" });
  const [adminDialog, setAdminDialog] = useState(null);
  const [adminEntry, setAdminEntry] = useState({ scheduledTime: "", status: "GIVEN", nurseName: "", batchNumber: "", reason: "", remarks: "" });
  const [createForm, setCreateForm] = useState({ UHID: "", patientName: "", ipdNo: "", allergies: "" });
  const [showCreate, setShowCreate] = useState(false);

  const search = async () => {
    if (!searchIPD.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ipd/${searchIPD.trim()}/date/${searchDate}`);
      setMAR(res.data.data);
      setMsg("");
    } catch {
      setMAR(null);
      setMsg("No MAR found for this date. You can create one below.");
      setShowCreate(true);
    }
    setLoading(false);
  };

  const createMAR = async () => {
    setLoading(true);
    try {
      const res = await axios.post(API, {
        ...createForm,
        ipdNo: searchIPD,
        date: searchDate,
        allergies: createForm.allergies ? createForm.allergies.split(",").map(s => s.trim()).filter(Boolean) : [],
      });
      setMAR(res.data.data);
      setShowCreate(false);
      setMsg("MAR created.");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const addMedication = async () => {
    if (!mar?._id) return;
    setLoading(true);
    try {
      const med = {
        ...newMed,
        scheduledTimes: newMed.scheduledTimes ? newMed.scheduledTimes.split(",").map(s => s.trim()).filter(Boolean) : [],
        startDate: newMed.startDate || searchDate,
      };
      const res = await axios.post(`${API}/${mar._id}/medication`, med);
      setMAR(res.data.data);
      setShowAddMed(false);
      setNewMed({ medicineName: "", genericName: "", dose: "", unit: "", route: "Oral", frequency: "", scheduledTimes: "", startDate: searchDate, isHighAlert: false, isLASA: false, specialInstructions: "", prescribedByName: "" });
      setMsg("Medication added.");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const recordAdmin = async () => {
    if (!adminDialog) return;
    setLoading(true);
    try {
      const res = await axios.patch(`${API}/${mar._id}/medication/${adminDialog}/administer`, adminEntry);
      setMAR(res.data.data);
      setAdminDialog(null);
      setAdminEntry({ scheduledTime: "", status: "GIVEN", nurseName: "", batchNumber: "", reason: "", remarks: "" });
      setMsg("Administration recorded.");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const discontinue = async (medId) => {
    const reason = window.prompt("Reason for discontinuation:");
    if (reason === null) return;
    setLoading(true);
    try {
      const res = await axios.patch(`${API}/${mar._id}/medication/${medId}/discontinue`, { discontinuedBy: "Nurse", discontinueReason: reason });
      setMAR(res.data.data);
      setMsg("Medication discontinued.");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const inputCls = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const sectionCls = "bg-white rounded-lg shadow p-4 mb-4";

  return (
    <div style={{ marginLeft: 260, padding: 24, minHeight: "100vh", background: "#f4f6fb" }}>
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Medication Administration Record (MAR)</h2>
        <p className="text-sm text-gray-500">NABH MOM.4 — Daily medication administration tracking</p>
      </div>

      {msg && <div className="mb-3 p-3 bg-blue-50 border border-blue-300 text-blue-700 rounded text-sm">{msg}</div>}

      {/* Search */}
      <div className={sectionCls}>
        <div className="flex gap-3 items-end">
          <div>
            <label className={labelCls}>IPD No.</label>
            <input className={inputCls} style={{ width: 180 }} value={searchIPD} onChange={e => setSearchIPD(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="IPD No..." />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input className={inputCls} type="date" style={{ width: 160 }} value={searchDate} onChange={e => setSearchDate(e.target.value)} />
          </div>
          <button onClick={search} className="px-5 py-2 bg-blue-600 text-white rounded text-sm">Load MAR</button>
        </div>
      </div>

      {/* Create MAR */}
      {showCreate && !mar && (
        <div className={sectionCls}>
          <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Create New MAR for {searchDate}</h3>
          <div className="grid grid-cols-4 gap-3">
            {[["UHID","UHID"],["patientName","Patient Name"],["ipdNo","IPD No"]].map(([name,label]) => (
              <div key={name}>
                <label className={labelCls}>{label}</label>
                <input className={inputCls} value={createForm[name]} onChange={e => setCreateForm(p => ({ ...p, [e.target.name]: e.target.value }))} name={name} />
              </div>
            ))}
            <div>
              <label className={labelCls}>Known Allergies (comma separated)</label>
              <input className={inputCls} value={createForm.allergies} onChange={e => setCreateForm(p => ({ ...p, allergies: e.target.value }))} placeholder="Penicillin, Sulfa..." />
            </div>
          </div>
          <div className="mt-3 flex gap-3">
            <button onClick={createMAR} disabled={loading} className="px-5 py-2 bg-green-600 text-white rounded text-sm">Create MAR</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* MAR Display */}
      {mar && (
        <div>
          {/* Header */}
          <div className={sectionCls}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg">MAR — {new Date(mar.date).toLocaleDateString()}</h3>
                <p className="text-sm text-gray-500">Patient: {mar.patientName} | UHID: {mar.UHID} | IPD: {mar.ipdNo}</p>
                {mar.allergies?.length > 0 && (
                  <div className="mt-1 flex gap-1 items-center">
                    <span className="text-xs font-semibold text-red-600">ALLERGIES:</span>
                    {mar.allergies.map((a, i) => (
                      <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setShowAddMed(true)} className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium">+ Add Medication</button>
            </div>
          </div>

          {/* Add Medication Form */}
          {showAddMed && (
            <div className={sectionCls + " border-2 border-green-200"}>
              <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Add Medication to MAR</h3>
              <div className="grid grid-cols-4 gap-3 mb-3">
                {[["medicineName","Medicine Name *"],["genericName","Generic Name"],["dose","Dose"],["unit","Unit (mg/ml)"],["frequency","Frequency"],["scheduledTimes","Scheduled Times (comma sep.)"],["prescribedByName","Prescribed By"]].map(([name,label]) => (
                  <div key={name}>
                    <label className={labelCls}>{label}</label>
                    <input className={inputCls} name={name} value={newMed[name]} onChange={e => setNewMed(p => ({ ...p, [e.target.name]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <label className={labelCls}>Route</label>
                  <select className={inputCls} value={newMed.route} onChange={e => setNewMed(p => ({ ...p, route: e.target.value }))}>
                    {ROUTES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Start Date</label>
                  <input type="date" className={inputCls} value={newMed.startDate} onChange={e => setNewMed(p => ({ ...p, startDate: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newMed.isHighAlert} onChange={e => setNewMed(p => ({ ...p, isHighAlert: e.target.checked }))} />
                  <span className="text-red-600 font-semibold">High Alert Medication</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newMed.isLASA} onChange={e => setNewMed(p => ({ ...p, isLASA: e.target.checked }))} />
                  <span className="text-orange-600 font-semibold">LASA Drug</span>
                </label>
              </div>
              {(newMed.isHighAlert || newMed.isLASA) && (
                <div className="mb-3">
                  <label className={labelCls}>Special Instructions</label>
                  <textarea className={inputCls} rows={2} value={newMed.specialInstructions} onChange={e => setNewMed(p => ({ ...p, specialInstructions: e.target.value }))} />
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={addMedication} disabled={loading} className="px-5 py-2 bg-green-600 text-white rounded text-sm">Add to MAR</button>
                <button onClick={() => setShowAddMed(false)} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Medications Table */}
          {(mar.medications || []).length === 0 ? (
            <div className={sectionCls + " text-center text-gray-500"}>No medications added yet.</div>
          ) : (
            (mar.medications || []).map((med, mi) => (
              <div key={med._id || mi} className={`${sectionCls} ${!med.isActive ? "opacity-60" : ""}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-800">{med.medicineName}</span>
                      {med.genericName && <span className="text-xs text-gray-500">({med.genericName})</span>}
                      {med.isHighAlert && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold">HIGH ALERT</span>}
                      {med.isLASA && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-bold">LASA</span>}
                      {!med.isActive && <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">DISCONTINUED</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {med.dose}{med.unit && `${med.unit}`} • {med.route} • {med.frequency}
                      {med.scheduledTimes?.length > 0 && ` • Times: ${med.scheduledTimes.join(", ")}`}
                    </p>
                    {med.prescribedByName && <p className="text-xs text-gray-500">Prescribed by: {med.prescribedByName}</p>}
                    {med.specialInstructions && <p className="text-xs text-amber-600 mt-1">⚠ {med.specialInstructions}</p>}
                    {!med.isActive && med.discontinueReason && <p className="text-xs text-red-500 mt-1">Discontinued: {med.discontinueReason}</p>}
                  </div>
                  {med.isActive && (
                    <div className="flex gap-2">
                      <button onClick={() => setAdminDialog(med._id)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium">Record Admin</button>
                      <button onClick={() => discontinue(med._id)} className="px-3 py-1 bg-red-100 text-red-600 rounded text-xs">Discontinue</button>
                    </div>
                  )}
                </div>

                {/* Administration Log */}
                {med.administrations?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1">Administration Log:</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead><tr className="bg-gray-100">{["Scheduled","Actual Time","Status","Nurse","Batch No.","Remarks"].map(h => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody>
                          {med.administrations.map((a, ai) => (
                            <tr key={ai} className="border-t">
                              <td className="border px-2 py-1">{a.scheduledTime || "-"}</td>
                              <td className="border px-2 py-1">{a.actualTime ? new Date(a.actualTime).toLocaleTimeString() : "-"}</td>
                              <td className="border px-2 py-1"><span className={`px-1.5 py-0.5 rounded-full ${STATUS_COLORS[a.status]}`}>{a.status}</span></td>
                              <td className="border px-2 py-1">{a.nurseName || "-"}</td>
                              <td className="border px-2 py-1">{a.batchNumber || "-"}</td>
                              <td className="border px-2 py-1">{a.remarks || a.reason || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Administration Dialog */}
          {adminDialog && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
                <h3 className="font-bold text-gray-800 mb-4">Record Medication Administration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Scheduled Time</label>
                    <input className={inputCls} value={adminEntry.scheduledTime} onChange={e => setAdminEntry(p => ({ ...p, scheduledTime: e.target.value }))} placeholder="e.g. 08:00" />
                  </div>
                  <div>
                    <label className={labelCls}>Status *</label>
                    <select className={inputCls} value={adminEntry.status} onChange={e => setAdminEntry(p => ({ ...p, status: e.target.value }))}>
                      {["GIVEN","HELD","REFUSED","NOT_AVAILABLE","MISSED"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Nurse Name</label>
                    <input className={inputCls} value={adminEntry.nurseName} onChange={e => setAdminEntry(p => ({ ...p, nurseName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Batch / Lot No.</label>
                    <input className={inputCls} value={adminEntry.batchNumber} onChange={e => setAdminEntry(p => ({ ...p, batchNumber: e.target.value }))} />
                  </div>
                  {adminEntry.status !== "GIVEN" && (
                    <div className="col-span-2">
                      <label className={labelCls}>Reason (for Hold/Refuse/Miss)</label>
                      <input className={inputCls} value={adminEntry.reason} onChange={e => setAdminEntry(p => ({ ...p, reason: e.target.value }))} />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className={labelCls}>Remarks</label>
                    <textarea className={inputCls} rows={2} value={adminEntry.remarks} onChange={e => setAdminEntry(p => ({ ...p, remarks: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-3 mt-4 justify-end">
                  <button onClick={() => setAdminDialog(null)} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
                  <button onClick={recordAdmin} disabled={loading} className="px-5 py-2 bg-blue-600 text-white rounded text-sm">Record</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
