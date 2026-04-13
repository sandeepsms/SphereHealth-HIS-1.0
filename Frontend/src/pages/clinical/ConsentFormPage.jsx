import React, { useState, useRef } from "react";
import axios from "axios";
import { useReactToPrint } from "react-to-print";
import API_BASE_URL from "../../config/api";

const API = `${API_BASE_URL}/consent-forms`;

const CONSENT_TYPES = [
  { value: "GENERAL_ADMISSION", label: "General Admission Consent" },
  { value: "SURGICAL", label: "Surgical / Operation Consent" },
  { value: "PROCEDURE", label: "Procedure Consent" },
  { value: "ANESTHESIA", label: "Anesthesia Consent" },
  { value: "BLOOD_TRANSFUSION", label: "Blood Transfusion Consent" },
  { value: "HIV_TESTING", label: "HIV Testing Consent" },
  { value: "LAMA", label: "LAMA (Leave Against Medical Advice)" },
  { value: "DNR", label: "DNR (Do Not Resuscitate)" },
  { value: "INFORMATION_RELEASE", label: "Information Release Consent" },
  { value: "PHOTOGRAPHY", label: "Photography / Teaching Consent" },
  { value: "RESEARCH", label: "Research Participation Consent" },
  { value: "OTHER", label: "Other" },
];

const CONSENT_TEMPLATES = {
  GENERAL_ADMISSION: {
    consentTitle: "General Consent for Medical Treatment",
    procedureDescription: "I consent to the performance of all diagnostic, therapeutic and surgical procedures deemed necessary or advisable by my attending physician(s).",
    risksDisclosed: ["Possible complications from treatment", "Reactions to medications", "Need for additional procedures"],
    benefitsExplained: ["Treatment of current medical condition", "Pain relief and improved quality of life"],
    alternativesDisclosed: ["Conservative management", "Transfer to another facility"],
  },
  SURGICAL: {
    consentTitle: "Surgical Consent Form",
    procedureDescription: "Consent for the surgical procedure as discussed with the operating surgeon including its nature, risks, benefits and alternatives.",
    risksDisclosed: ["Bleeding", "Infection", "Anesthetic complications", "Damage to adjacent structures", "Failure of procedure", "Death (rare)"],
    benefitsExplained: ["Correction of pathology", "Pain relief", "Improved function"],
    alternativesDisclosed: ["Conservative/medical management", "Different surgical approach", "No treatment"],
  },
  LAMA: {
    consentTitle: "Leave Against Medical Advice (LAMA)",
    procedureDescription: "I am leaving the hospital against the advice of my treating doctor. I understand the risks involved.",
    risksDisclosed: ["Worsening of medical condition", "Risk of death", "Need for emergency readmission", "No guarantee of care elsewhere"],
    benefitsExplained: [],
    alternativesDisclosed: ["Continuing hospital treatment as advised"],
  },
};

const emptyForm = {
  UHID: "", patientName: "", age: "", gender: "", ipdNo: "",
  consentType: "GENERAL_ADMISSION", consentTitle: "", procedureDescription: "",
  languageUsed: "Hindi", interpreterRequired: false, interpreterName: "",
  consentGivenBy: "SELF", guardianName: "", guardianRelation: "", guardianContact: "",
  witnessName: "", witnessRelation: "", explainedByDoctorName: "", doctorRegNo: "",
  additionalNotes: "",
};

export default function ConsentFormPage() {
  const [searchUHID, setSearchUHID] = useState("");
  const [forms, setForms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [risks, setRisks] = useState([""]);
  const [benefits, setBenefits] = useState([""]);
  const [alternatives, setAlternatives] = useState([""]);
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const printRef = useRef();
  const handlePrint = useReactToPrint({ content: () => printRef.current });

  const search = async () => {
    if (!searchUHID.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/uhid/${searchUHID.trim()}`);
      setForms(res.data.data || []);
    } catch { setForms([]); }
    setLoading(false);
  };

  const applyTemplate = (type) => {
    const tpl = CONSENT_TEMPLATES[type];
    if (tpl) {
      setForm(p => ({ ...p, consentType: type, consentTitle: tpl.consentTitle, procedureDescription: tpl.procedureDescription }));
      setRisks(tpl.risksDisclosed?.length ? tpl.risksDisclosed : [""]);
      setBenefits(tpl.benefitsExplained?.length ? tpl.benefitsExplained : [""]);
      setAlternatives(tpl.alternativesDisclosed?.length ? tpl.alternativesDisclosed : [""]);
    } else {
      setForm(p => ({ ...p, consentType: type }));
    }
  };

  const openNew = () => {
    setForm({ ...emptyForm, UHID: searchUHID });
    setRisks([""]);
    setBenefits([""]);
    setAlternatives([""]);
    setSelected(null);
    setMode("new");
  };

  const openView = (f) => { setSelected(f); setMode("view"); };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "consentType") { applyTemplate(value); return; }
    setForm(p => ({ ...p, [name]: type === "checkbox" ? checked : value }));
  };

  const listField = (arr, setArr) => ({
    add: () => setArr(p => [...p, ""]),
    change: (i, v) => setArr(p => p.map((x, idx) => idx === i ? v : x)),
    remove: (i) => setArr(p => p.filter((_, idx) => idx !== i)),
  });

  const riskOps = listField(risks, setRisks);
  const benefitOps = listField(benefits, setBenefits);
  const altOps = listField(alternatives, setAlternatives);

  const save = async () => {
    setLoading(true);
    const payload = {
      ...form,
      risksDisclosed: risks.filter(Boolean),
      benefitsExplained: benefits.filter(Boolean),
      alternativesDisclosed: alternatives.filter(Boolean),
    };
    try {
      await axios.post(API, payload);
      setMsg("Consent form created successfully.");
      await search();
      setMode("list");
    } catch (e) {
      setMsg(e.response?.data?.message || "Error");
    }
    setLoading(false);
  };

  const sign = async (f) => {
    const witnessName = window.prompt("Enter witness name:");
    if (witnessName === null) return;
    try {
      await axios.patch(`${API}/${f._id}/sign`, { witnessName });
      setMsg("Consent signed.");
      search();
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
  };

  const refuse = async (f) => {
    const reason = window.prompt("Reason for refusal:");
    if (reason === null) return;
    try {
      await axios.patch(`${API}/${f._id}/refuse`, { refusalReason: reason });
      setMsg("Refusal recorded.");
      search();
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
  };

  const statusBadge = (s) => {
    const cls = { PENDING: "bg-yellow-100 text-yellow-700", SIGNED: "bg-green-100 text-green-700", REFUSED: "bg-red-100 text-red-700", REVOKED: "bg-gray-100 text-gray-600" };
    return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cls[s] || ""}`}>{s}</span>;
  };

  const inputCls = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const sectionCls = "bg-white rounded-lg shadow p-4 mb-4";

  return (
    <div style={{ marginLeft: 260, padding: 24, minHeight: "100vh", background: "#f4f6fb" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Consent Forms</h2>
          <p className="text-sm text-gray-500">NABH PRE.3 · PRE.4 — Informed consent management</p>
        </div>
        {mode !== "list" && <button onClick={() => setMode("list")} className="px-4 py-2 bg-gray-200 rounded text-sm">Back</button>}
      </div>

      {msg && <div className="mb-3 p-3 bg-green-50 border border-green-300 text-green-700 rounded text-sm">{msg}</div>}

      {mode === "list" && (
        <div className={sectionCls}>
          <div className="flex gap-3 items-end mb-4">
            <div className="flex-1">
              <label className={labelCls}>Search by UHID</label>
              <input className={inputCls} value={searchUHID} onChange={e => setSearchUHID(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Enter UHID..." />
            </div>
            <button onClick={search} className="px-5 py-2 bg-blue-600 text-white rounded text-sm">Search</button>
            <button onClick={openNew} className="px-5 py-2 bg-green-600 text-white rounded text-sm">+ New Consent</button>
          </div>

          {forms.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead><tr className="bg-gray-100">
                {["UHID","Patient","Consent Type","Date","Status","Actions"].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {forms.map(f => (
                  <tr key={f._id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{f.UHID}</td>
                    <td className="px-3 py-2">{f.patientName}</td>
                    <td className="px-3 py-2">{CONSENT_TYPES.find(t => t.value === f.consentType)?.label || f.consentType}</td>
                    <td className="px-3 py-2">{new Date(f.createdAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{statusBadge(f.status)}</td>
                    <td className="px-3 py-2 flex gap-1">
                      <button onClick={() => openView(f)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">View</button>
                      {f.status === "PENDING" && <button onClick={() => sign(f)} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Sign</button>}
                      {f.status === "PENDING" && <button onClick={() => refuse(f)} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">Refuse</button>}
                      <button onClick={() => { openView(f); setTimeout(handlePrint, 200); }} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">Print</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {mode === "new" && (
        <div>
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Patient Details</h3>
            <div className="grid grid-cols-4 gap-3">
              {[["UHID","UHID"],["patientName","Patient Name"],["age","Age"],["gender","Gender"],["ipdNo","IPD No"]].map(([name,label]) => (
                <div key={name}>
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} name={name} value={form[name]} onChange={handleChange} />
                </div>
              ))}
            </div>
          </div>

          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Consent Type</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Consent Type *</label>
                <select className={inputCls} name="consentType" value={form.consentType} onChange={handleChange}>
                  {CONSENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Consent Title</label>
                <input className={inputCls} name="consentTitle" value={form.consentTitle} onChange={handleChange} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Procedure / Treatment Description</label>
                <textarea className={inputCls} rows={3} name="procedureDescription" value={form.procedureDescription} onChange={handleChange} />
              </div>
            </div>
          </div>

          {/* Risks, Benefits, Alternatives */}
          {[
            ["Risks Disclosed", risks, riskOps],
            ["Benefits Explained", benefits, benefitOps],
            ["Alternatives Discussed", alternatives, altOps],
          ].map(([title, arr, ops]) => (
            <div key={title} className={sectionCls}>
              <div className="flex justify-between items-center mb-3 border-b pb-2">
                <h3 className="font-bold text-gray-700">{title}</h3>
                <button onClick={ops.add} className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs">+ Add</button>
              </div>
              {arr.map((item, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input className={inputCls} value={item} onChange={e => ops.change(i, e.target.value)} placeholder="Enter item..." />
                  <button onClick={() => ops.remove(i)} className="px-2 bg-red-100 text-red-600 rounded text-xs">✕</button>
                </div>
              ))}
            </div>
          ))}

          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Communication & Language</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Language Used</label>
                <input className={inputCls} name="languageUsed" value={form.languageUsed} onChange={handleChange} />
              </div>
              <div className="flex items-end gap-2">
                <input type="checkbox" name="interpreterRequired" checked={form.interpreterRequired} onChange={handleChange} className="mt-2" id="interp" />
                <label htmlFor="interp" className="text-sm">Interpreter Required</label>
              </div>
              {form.interpreterRequired && (
                <div>
                  <label className={labelCls}>Interpreter Name</label>
                  <input className={inputCls} name="interpreterName" value={form.interpreterName} onChange={handleChange} />
                </div>
              )}
            </div>
          </div>

          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Consent Given By</h3>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Consent Given By</label>
                <select className={inputCls} name="consentGivenBy" value={form.consentGivenBy} onChange={handleChange}>
                  {["SELF","GUARDIAN","SPOUSE","PARENT","SIBLING","OTHER"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              {form.consentGivenBy !== "SELF" && (
                <>
                  <div><label className={labelCls}>Guardian/Relative Name</label><input className={inputCls} name="guardianName" value={form.guardianName} onChange={handleChange} /></div>
                  <div><label className={labelCls}>Relation</label><input className={inputCls} name="guardianRelation" value={form.guardianRelation} onChange={handleChange} /></div>
                  <div><label className={labelCls}>Contact</label><input className={inputCls} name="guardianContact" value={form.guardianContact} onChange={handleChange} /></div>
                </>
              )}
              <div><label className={labelCls}>Witness Name</label><input className={inputCls} name="witnessName" value={form.witnessName} onChange={handleChange} /></div>
              <div><label className={labelCls}>Witness Relation</label><input className={inputCls} name="witnessRelation" value={form.witnessRelation} onChange={handleChange} /></div>
              <div><label className={labelCls}>Explained by Doctor</label><input className={inputCls} name="explainedByDoctorName" value={form.explainedByDoctorName} onChange={handleChange} /></div>
              <div><label className={labelCls}>Doctor Reg. No.</label><input className={inputCls} name="doctorRegNo" value={form.doctorRegNo} onChange={handleChange} /></div>
            </div>
            <div className="mt-3">
              <label className={labelCls}>Additional Notes</label>
              <textarea className={inputCls} rows={2} name="additionalNotes" value={form.additionalNotes} onChange={handleChange} />
            </div>
          </div>

          <div className="flex gap-3 justify-end mb-6">
            <button onClick={() => setMode("list")} className="px-5 py-2 bg-gray-200 rounded text-sm">Cancel</button>
            <button onClick={save} disabled={loading} className="px-5 py-2 bg-green-600 text-white rounded text-sm font-medium">
              {loading ? "Saving..." : "Create Consent Form"}
            </button>
          </div>
        </div>
      )}

      {mode === "view" && selected && (
        <div>
          <div className="flex gap-3 mb-4">
            <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Print PDF</button>
            {selected.status === "PENDING" && <button onClick={() => sign(selected)} className="px-4 py-2 bg-green-600 text-white rounded text-sm">Sign Consent</button>}
          </div>
          <div ref={printRef} className="bg-white p-8 rounded shadow max-w-2xl mx-auto text-sm">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold">{selected.consentTitle || "CONSENT FORM"}</h2>
              <p className="text-xs text-gray-500">NABH PRE.3 · PRE.4 · Status: {selected.status}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 border-b pb-4">
              <div><span className="font-semibold">UHID:</span> {selected.UHID}</div>
              <div><span className="font-semibold">Patient:</span> {selected.patientName}</div>
              <div><span className="font-semibold">Age/Gender:</span> {selected.age} / {selected.gender}</div>
              <div><span className="font-semibold">IPD No:</span> {selected.ipdNo}</div>
              <div><span className="font-semibold">Consent Type:</span> {selected.consentType}</div>
              <div><span className="font-semibold">Language:</span> {selected.languageUsed}</div>
            </div>
            {selected.procedureDescription && <div className="mb-3"><p className="font-semibold">Description:</p><p className="ml-2 whitespace-pre-wrap">{selected.procedureDescription}</p></div>}
            {selected.risksDisclosed?.length > 0 && <div className="mb-3"><p className="font-semibold">Risks Disclosed:</p><ul className="list-disc ml-6">{selected.risksDisclosed.map((r,i) => <li key={i}>{r}</li>)}</ul></div>}
            {selected.benefitsExplained?.length > 0 && <div className="mb-3"><p className="font-semibold">Benefits Explained:</p><ul className="list-disc ml-6">{selected.benefitsExplained.map((r,i) => <li key={i}>{r}</li>)}</ul></div>}
            {selected.alternativesDisclosed?.length > 0 && <div className="mb-3"><p className="font-semibold">Alternatives Discussed:</p><ul className="list-disc ml-6">{selected.alternativesDisclosed.map((r,i) => <li key={i}>{r}</li>)}</ul></div>}
            <div className="mt-8 pt-4 border-t grid grid-cols-2 gap-4 text-xs">
              <div><p className="font-semibold">Patient / Guardian Signature</p><p>Name: {selected.guardianName || selected.patientName}</p>{selected.guardianRelation && <p>Relation: {selected.guardianRelation}</p>}<div className="border-b border-gray-400 mt-6 mb-1" /><p>Signature</p></div>
              <div><p className="font-semibold">Witness</p><p>Name: {selected.witnessName || "-"}</p><p>Relation: {selected.witnessRelation || "-"}</p><div className="border-b border-gray-400 mt-6 mb-1" /><p>Signature</p></div>
              <div><p className="font-semibold">Doctor</p><p>Name: {selected.explainedByDoctorName || "-"}</p><p>Reg. No: {selected.doctorRegNo || "-"}</p><div className="border-b border-gray-400 mt-6 mb-1" /><p>Signature & Stamp</p></div>
              <div><p className="font-semibold">Date & Time</p><p>{new Date(selected.createdAt).toLocaleString()}</p>{selected.signedAt && <p>Signed: {new Date(selected.signedAt).toLocaleString()}</p>}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
