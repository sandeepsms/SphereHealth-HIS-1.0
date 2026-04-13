import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useReactToPrint } from "react-to-print";
import API_BASE_URL from "../../config/api";

const API = `${API_BASE_URL}/discharge-summary`;

const emptyForm = {
  UHID: "",
  patientName: "",
  age: "",
  gender: "",
  contactNumber: "",
  ipdNo: "",
  admissionDate: "",
  dischargeDate: "",
  doctorName: "",
  doctorRegNo: "",
  department: "",
  consultants: "",
  admittingDiagnosis: "",
  finalDiagnosis: "",
  icdCode: "",
  comorbidities: "",
  historyOfPresentIllness: "",
  courseInHospital: "",
  significantFindings: "",
  conditionOnDischarge: "Stable",
  dietAdvice: "",
  activityAdvice: "",
  woundCareInstructions: "",
  specialInstructions: "",
  restrictionsAndPrecautions: "",
  followUpRequired: true,
  followUpDate: "",
  followUpDoctor: "",
  followUpDepartment: "",
  followUpInstructions: "",
  emergencyWarnings: "",
};

export default function DischargeSummaryPage() {
  const [searchUHID, setSearchUHID] = useState("");
  const [summaries, setSummaries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [medications, setMedications] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [mode, setMode] = useState("list"); // list | new | edit | view
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const printRef = useRef();

  const handlePrint = useReactToPrint({ content: () => printRef.current });

  const search = async () => {
    if (!searchUHID.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/uhid/${searchUHID.trim()}`);
      setSummaries(res.data.data || []);
    } catch {
      setSummaries([]);
    }
    setLoading(false);
  };

  const openNew = () => {
    setForm({ ...emptyForm, UHID: searchUHID });
    setMedications([{ medicineName: "", dose: "", route: "", frequency: "", duration: "" }]);
    setInvestigations([{ testName: "", result: "", date: "", remarks: "" }]);
    setProcedures([]);
    setSelected(null);
    setMode("new");
  };

  const openEdit = (s) => {
    setSelected(s);
    setForm({
      ...s,
      admissionDate: s.admissionDate ? s.admissionDate.slice(0, 10) : "",
      dischargeDate: s.dischargeDate ? s.dischargeDate.slice(0, 10) : "",
      followUpDate: s.followUpDate ? s.followUpDate.slice(0, 10) : "",
      consultants: (s.consultants || []).join(", "),
      comorbidities: (s.comorbidities || []).join(", "),
    });
    setMedications(s.medicationsOnDischarge?.length ? s.medicationsOnDischarge : [{ medicineName: "", dose: "", route: "", frequency: "", duration: "" }]);
    setInvestigations(s.investigationsSummary?.length ? s.investigationsSummary : []);
    setProcedures(s.proceduresDone?.length ? s.proceduresDone : []);
    setMode("edit");
  };

  const openView = (s) => { setSelected(s); setMode("view"); };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => ({ ...p, [name]: type === "checkbox" ? checked : value }));
  };

  const addMed = () => setMedications((p) => [...p, { medicineName: "", dose: "", route: "", frequency: "", duration: "" }]);
  const changeMed = (i, field, val) => setMedications((p) => p.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const removeMed = (i) => setMedications((p) => p.filter((_, idx) => idx !== i));

  const addInv = () => setInvestigations((p) => [...p, { testName: "", result: "", date: "", remarks: "" }]);
  const changeInv = (i, field, val) => setInvestigations((p) => p.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const removeInv = (i) => setInvestigations((p) => p.filter((_, idx) => idx !== i));

  const addProc = () => setProcedures((p) => [...p, { procedureName: "", date: "", performedBy: "", notes: "" }]);
  const changeProc = (i, field, val) => setProcedures((p) => p.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const removeProc = (i) => setProcedures((p) => p.filter((_, idx) => idx !== i));

  const save = async (finalize = false) => {
    setLoading(true);
    const payload = {
      ...form,
      consultants: form.consultants ? form.consultants.split(",").map(s => s.trim()).filter(Boolean) : [],
      comorbidities: form.comorbidities ? form.comorbidities.split(",").map(s => s.trim()).filter(Boolean) : [],
      medicationsOnDischarge: medications.filter(m => m.medicineName),
      investigationsSummary: investigations.filter(i => i.testName),
      proceduresDone: procedures.filter(p => p.procedureName),
    };
    try {
      let res;
      if (mode === "new") {
        res = await axios.post(API, payload);
        const id = res.data.data._id;
        if (finalize) await axios.patch(`${API}/${id}/finalize`, { finalizedByName: form.doctorName });
      } else {
        res = await axios.put(`${API}/${selected._id}`, payload);
        if (finalize) await axios.patch(`${API}/${selected._id}/finalize`, { finalizedByName: form.doctorName });
      }
      setMsg(finalize ? "Discharge summary finalized!" : "Saved as draft.");
      await search();
      setMode("list");
    } catch (e) {
      setMsg(e.response?.data?.message || "Error saving");
    }
    setLoading(false);
  };

  const finalizeSummary = async (s) => {
    if (!window.confirm("Finalize this discharge summary? This cannot be undone.")) return;
    try {
      await axios.patch(`${API}/${s._id}/finalize`, { finalizedByName: s.doctorName });
      setMsg("Finalized!");
      search();
    } catch (e) {
      setMsg(e.response?.data?.message || "Error");
    }
  };

  const inputCls = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const sectionCls = "bg-white rounded-lg shadow p-4 mb-4";

  return (
    <div style={{ marginLeft: 260, padding: 24, minHeight: "100vh", background: "#f4f6fb" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Discharge Summary</h2>
          <p className="text-sm text-gray-500">NABH AAC.5 · COP.2 — Structured discharge documentation</p>
        </div>
        {mode !== "list" && (
          <button onClick={() => setMode("list")} className="px-4 py-2 bg-gray-200 rounded text-sm">Back to List</button>
        )}
      </div>

      {msg && <div className="mb-3 p-3 bg-green-50 border border-green-300 text-green-700 rounded text-sm">{msg}</div>}

      {/* Search bar */}
      {mode === "list" && (
        <div className={sectionCls}>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className={labelCls}>Search by UHID</label>
              <input className={inputCls} value={searchUHID} onChange={e => setSearchUHID(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()} placeholder="Enter UHID..." />
            </div>
            <button onClick={search} className="px-5 py-2 bg-blue-600 text-white rounded text-sm font-medium">Search</button>
            <button onClick={openNew} className="px-5 py-2 bg-green-600 text-white rounded text-sm font-medium">+ New Summary</button>
          </div>

          {loading && <p className="text-sm text-gray-500 mt-3">Loading...</p>}

          {summaries.length > 0 && (
            <table className="w-full mt-4 text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left">UHID</th>
                  <th className="px-3 py-2 text-left">Patient</th>
                  <th className="px-3 py-2 text-left">Diagnosis</th>
                  <th className="px-3 py-2 text-left">Discharge Date</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(s => (
                  <tr key={s._id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{s.UHID}</td>
                    <td className="px-3 py-2">{s.patientName}</td>
                    <td className="px-3 py-2">{s.finalDiagnosis || s.admittingDiagnosis || "-"}</td>
                    <td className="px-3 py-2">{s.dischargeDate ? new Date(s.dischargeDate).toLocaleDateString() : "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${s.status === "finalized" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 flex gap-2">
                      <button onClick={() => openView(s)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">View</button>
                      {s.status !== "finalized" && <button onClick={() => openEdit(s)} className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">Edit</button>}
                      {s.status !== "finalized" && <button onClick={() => finalizeSummary(s)} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Finalize</button>}
                      <button onClick={() => { openView(s); setTimeout(handlePrint, 200); }} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">Print</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Form: new or edit */}
      {(mode === "new" || mode === "edit") && (
        <div>
          {/* Patient Info */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Patient Information</h3>
            <div className="grid grid-cols-4 gap-3">
              {[["UHID","UHID"],["patientName","Patient Name"],["age","Age"],["gender","Gender"],["contactNumber","Contact"],["ipdNo","IPD No"],["admissionDate","Admission Date","date"],["dischargeDate","Discharge Date","date"]].map(([name,label,type="text"]) => (
                <div key={name}>
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} type={type} name={name} value={form[name]} onChange={handleChange} />
                </div>
              ))}
            </div>
          </div>

          {/* Treating Team */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Treating Team</h3>
            <div className="grid grid-cols-3 gap-3">
              {[["doctorName","Attending Doctor"],["doctorRegNo","Reg. No."],["department","Department"],["consultants","Consultants (comma separated)"]].map(([name,label]) => (
                <div key={name} className={name === "consultants" ? "col-span-3" : ""}>
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} name={name} value={form[name]} onChange={handleChange} />
                </div>
              ))}
            </div>
          </div>

          {/* Diagnosis */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Diagnosis</h3>
            <div className="grid grid-cols-2 gap-3">
              {[["admittingDiagnosis","Admitting Diagnosis"],["finalDiagnosis","Final Diagnosis"],["icdCode","ICD-10 Code"],["comorbidities","Comorbidities (comma separated)"]].map(([name,label]) => (
                <div key={name}>
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} name={name} value={form[name]} onChange={handleChange} />
                </div>
              ))}
            </div>
          </div>

          {/* Clinical Narrative */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Clinical Narrative</h3>
            {[["historyOfPresentIllness","History of Present Illness"],["courseInHospital","Course in Hospital (Treatment Given)"],["significantFindings","Significant Findings / Examination"]].map(([name,label]) => (
              <div key={name} className="mb-3">
                <label className={labelCls}>{label}</label>
                <textarea className={inputCls} rows={3} name={name} value={form[name]} onChange={handleChange} />
              </div>
            ))}
          </div>

          {/* Investigations */}
          <div className={sectionCls}>
            <div className="flex justify-between items-center mb-3 border-b pb-2">
              <h3 className="font-bold text-gray-700">Key Investigations</h3>
              <button onClick={addInv} className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs">+ Add</button>
            </div>
            {investigations.map((inv, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                <input className={inputCls} placeholder="Test Name" value={inv.testName} onChange={e => changeInv(i, "testName", e.target.value)} />
                <input className={inputCls} placeholder="Result" value={inv.result} onChange={e => changeInv(i, "result", e.target.value)} />
                <input className={inputCls} type="date" value={inv.date ? inv.date.slice(0,10) : ""} onChange={e => changeInv(i, "date", e.target.value)} />
                <div className="flex gap-1">
                  <input className={inputCls} placeholder="Remarks" value={inv.remarks} onChange={e => changeInv(i, "remarks", e.target.value)} />
                  <button onClick={() => removeInv(i)} className="px-2 bg-red-100 text-red-600 rounded text-xs">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Procedures */}
          <div className={sectionCls}>
            <div className="flex justify-between items-center mb-3 border-b pb-2">
              <h3 className="font-bold text-gray-700">Procedures / Surgeries</h3>
              <button onClick={addProc} className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs">+ Add</button>
            </div>
            {procedures.map((p, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                <input className={inputCls} placeholder="Procedure Name" value={p.procedureName} onChange={e => changeProc(i, "procedureName", e.target.value)} />
                <input className={inputCls} type="date" value={p.date ? p.date.slice(0,10) : ""} onChange={e => changeProc(i, "date", e.target.value)} />
                <input className={inputCls} placeholder="Performed By" value={p.performedBy} onChange={e => changeProc(i, "performedBy", e.target.value)} />
                <div className="flex gap-1">
                  <input className={inputCls} placeholder="Notes" value={p.notes} onChange={e => changeProc(i, "notes", e.target.value)} />
                  <button onClick={() => removeProc(i)} className="px-2 bg-red-100 text-red-600 rounded text-xs">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Discharge Instructions */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Discharge Instructions</h3>
            <div className="mb-3">
              <label className={labelCls}>Condition on Discharge</label>
              <select className={inputCls} name="conditionOnDischarge" value={form.conditionOnDischarge} onChange={handleChange}>
                {["Stable","Improved","Unchanged","Deteriorated","Critical","LAMA","Expired"].map(v => <option key={v}>{v}</option>)}
              </select>
            </div>

            {/* Discharge Medications */}
            <div className="mb-3">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold text-gray-700">Discharge Medications</label>
                <button onClick={addMed} className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs">+ Add</button>
              </div>
              <div className="grid grid-cols-5 gap-1 mb-1 text-xs font-semibold text-gray-500 px-1">
                <span>Medicine</span><span>Dose</span><span>Route</span><span>Frequency</span><span>Duration</span>
              </div>
              {medications.map((m, i) => (
                <div key={i} className="grid grid-cols-5 gap-1 mb-1">
                  {["medicineName","dose","route","frequency","duration"].map(f => (
                    <div key={f} className="flex gap-1">
                      <input className={inputCls} placeholder={f} value={m[f]} onChange={e => changeMed(i, f, e.target.value)} />
                      {f === "duration" && <button onClick={() => removeMed(i)} className="px-1 bg-red-100 text-red-600 rounded text-xs">✕</button>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[["dietAdvice","Diet Advice"],["activityAdvice","Activity Advice"],["woundCareInstructions","Wound Care"],["restrictionsAndPrecautions","Restrictions & Precautions"],["specialInstructions","Special Instructions"],["emergencyWarnings","Emergency Warning Signs"]].map(([name,label]) => (
                <div key={name}>
                  <label className={labelCls}>{label}</label>
                  <textarea className={inputCls} rows={2} name={name} value={form[name]} onChange={handleChange} />
                </div>
              ))}
            </div>
          </div>

          {/* Follow Up */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Follow Up</h3>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Follow Up Required</label>
                <input type="checkbox" name="followUpRequired" checked={form.followUpRequired} onChange={handleChange} className="mt-2" />
              </div>
              <div>
                <label className={labelCls}>Follow Up Date</label>
                <input className={inputCls} type="date" name="followUpDate" value={form.followUpDate} onChange={handleChange} />
              </div>
              <div>
                <label className={labelCls}>Follow Up Doctor</label>
                <input className={inputCls} name="followUpDoctor" value={form.followUpDoctor} onChange={handleChange} />
              </div>
              <div>
                <label className={labelCls}>Follow Up Department</label>
                <input className={inputCls} name="followUpDepartment" value={form.followUpDepartment} onChange={handleChange} />
              </div>
              <div className="col-span-4">
                <label className={labelCls}>Follow Up Instructions</label>
                <textarea className={inputCls} rows={2} name="followUpInstructions" value={form.followUpInstructions} onChange={handleChange} />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end mb-6">
            <button onClick={() => setMode("list")} className="px-5 py-2 bg-gray-200 rounded text-sm">Cancel</button>
            <button onClick={() => save(false)} disabled={loading} className="px-5 py-2 bg-blue-600 text-white rounded text-sm font-medium">
              {loading ? "Saving..." : "Save Draft"}
            </button>
            <button onClick={() => save(true)} disabled={loading} className="px-5 py-2 bg-green-600 text-white rounded text-sm font-medium">
              {loading ? "Saving..." : "Save & Finalize"}
            </button>
          </div>
        </div>
      )}

      {/* View / Print */}
      {mode === "view" && selected && (
        <div>
          <div className="flex gap-3 mb-4">
            <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Print PDF</button>
            {selected.status !== "finalized" && (
              <button onClick={() => openEdit(selected)} className="px-4 py-2 bg-yellow-500 text-white rounded text-sm">Edit</button>
            )}
          </div>
          <div ref={printRef} className="bg-white p-8 rounded shadow max-w-3xl mx-auto text-sm">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold">DISCHARGE SUMMARY</h2>
              <p className="text-gray-500 text-xs">NABH Compliant · {selected.status === "finalized" ? "FINALIZED" : "DRAFT"}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 border-b pb-4">
              <div><span className="font-semibold">UHID:</span> {selected.UHID}</div>
              <div><span className="font-semibold">Patient:</span> {selected.patientName}</div>
              <div><span className="font-semibold">Age/Gender:</span> {selected.age} / {selected.gender}</div>
              <div><span className="font-semibold">IPD No:</span> {selected.ipdNo}</div>
              <div><span className="font-semibold">Admission:</span> {selected.admissionDate ? new Date(selected.admissionDate).toLocaleDateString() : "-"}</div>
              <div><span className="font-semibold">Discharge:</span> {selected.dischargeDate ? new Date(selected.dischargeDate).toLocaleDateString() : "-"}</div>
              <div><span className="font-semibold">Doctor:</span> {selected.doctorName}</div>
              <div><span className="font-semibold">Department:</span> {selected.department}</div>
              <div><span className="font-semibold">Days Admitted:</span> {selected.totalDaysAdmitted}</div>
              <div><span className="font-semibold">Condition:</span> {selected.conditionOnDischarge}</div>
            </div>
            {[
              ["Admitting Diagnosis", selected.admittingDiagnosis],
              ["Final Diagnosis", selected.finalDiagnosis],
              ["ICD Code", selected.icdCode],
              ["Comorbidities", (selected.comorbidities || []).join(", ")],
              ["History of Present Illness", selected.historyOfPresentIllness],
              ["Course in Hospital", selected.courseInHospital],
              ["Significant Findings", selected.significantFindings],
              ["Diet Advice", selected.dietAdvice],
              ["Activity Advice", selected.activityAdvice],
              ["Special Instructions", selected.specialInstructions],
              ["Emergency Warnings", selected.emergencyWarnings],
            ].filter(([, v]) => v).map(([label, val]) => (
              <div key={label} className="mb-3">
                <p className="font-semibold text-gray-700">{label}:</p>
                <p className="ml-2 whitespace-pre-wrap">{val}</p>
              </div>
            ))}
            {selected.medicationsOnDischarge?.length > 0 && (
              <div className="mb-3">
                <p className="font-semibold text-gray-700">Discharge Medications:</p>
                <table className="w-full border-collapse mt-1 text-xs">
                  <thead><tr className="bg-gray-100">{["Medicine","Dose","Route","Frequency","Duration"].map(h => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr></thead>
                  <tbody>{selected.medicationsOnDischarge.map((m, i) => (
                    <tr key={i} className="border-t"><td className="border px-2 py-1">{m.medicineName}</td><td className="border px-2 py-1">{m.dose}</td><td className="border px-2 py-1">{m.route}</td><td className="border px-2 py-1">{m.frequency}</td><td className="border px-2 py-1">{m.duration}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {selected.followUpRequired && (
              <div className="mb-3">
                <p className="font-semibold text-gray-700">Follow Up:</p>
                <p className="ml-2">Date: {selected.followUpDate ? new Date(selected.followUpDate).toLocaleDateString() : "-"} | Doctor: {selected.followUpDoctor} | Dept: {selected.followUpDepartment}</p>
                {selected.followUpInstructions && <p className="ml-2">{selected.followUpInstructions}</p>}
              </div>
            )}
            <div className="mt-8 pt-4 border-t flex justify-between text-xs text-gray-500">
              <span>Doctor: {selected.doctorName} ({selected.doctorRegNo})</span>
              <span>{selected.finalizedAt ? `Finalized: ${new Date(selected.finalizedAt).toLocaleString()}` : "Draft"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
