import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";

const API = API_ENDPOINTS.NURSING_CARE_PLANS;

const emptyAssessment = {
  consciousnessLevel: "Alert",
  mobility: "Independent",
  nutritionStatus: "Good",
  eliminationPattern: "Normal",
  selfCareAbility: "Full",
  painPresent: false,
  painScore: 0,
  skinCondition: "Intact",
  fallRisk: "Low",
  pressureUlcerRisk: "Low",
  ivAccess: false,
  urinaryCatheter: false,
  nasogastricTube: false,
  oxygenSupport: false,
  oxygenFlowRate: "",
  additionalNotes: "",
};

const emptyProblem = {
  problemStatement: "",
  relatedTo: "",
  evidencedBy: "",
  priority: "MEDIUM",
  shortTermGoal: "",
  longTermGoal: "",
  interventions: [{ intervention: "", frequency: "", responsible: "Nurse" }],
  evaluation: "",
  status: "ACTIVE",
};

const COMMON_PROBLEMS = [
  { problemStatement: "Acute Pain", relatedTo: "Surgical incision / medical condition", evidencedBy: "Patient reports pain score > 3" },
  { problemStatement: "Risk for Infection", relatedTo: "IV access / surgical wound / invasive procedure", evidencedBy: "Presence of IV line / wound" },
  { problemStatement: "Impaired Mobility", relatedTo: "Post-surgical / weakness", evidencedBy: "Unable to ambulate independently" },
  { problemStatement: "Risk for Falls", relatedTo: "Weakness / medication / altered sensorium", evidencedBy: "High fall risk score" },
  { problemStatement: "Impaired Nutrition", relatedTo: "Poor oral intake / nausea", evidencedBy: "Inadequate dietary intake" },
  { problemStatement: "Anxiety", relatedTo: "Hospitalization / diagnosis", evidencedBy: "Patient expresses fear/worry" },
  { problemStatement: "Risk for Pressure Ulcer", relatedTo: "Immobility / prolonged bed rest", evidencedBy: "Braden score assessment" },
  { problemStatement: "Altered Elimination", relatedTo: "Immobility / catheter / medication", evidencedBy: "Urinary catheter in situ" },
];

function NursingCarePlanContent({ selectedPatient }) {
  const [searchUHID, setSearchUHID] = useState("");
  const [searchIPD, setSearchIPD] = useState("");
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({ UHID: "", patientName: "", age: "", gender: "", ipdNo: "", nurseName: "", attendingDoctor: "", department: "", admissionAssessment: { ...emptyAssessment }, educationNeedsAssessed: false, educationTopics: "", educationBarriers: "", dischargeGoals: "" });
  const [problems, setProblems] = useState([{ ...emptyProblem }]);
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (selectedPatient?.UHID) {
      setSearchUHID(selectedPatient.UHID);
      setSearchIPD(selectedPatient.bedNumber || "");
    }
  }, [selectedPatient]);

  const search = async () => {
    setLoading(true);
    try {
      if (searchIPD) {
        const res = await axios.get(`${API}/ipd/${searchIPD.trim()}`);
        setPlan(res.data.data);
        if (res.data.data) openView(res.data.data);
      } else if (searchUHID) {
        const res = await axios.get(`${API}/uhid/${searchUHID.trim()}`);
        setPlan(res.data.data?.[0] || null);
        if (res.data.data?.[0]) openView(res.data.data[0]);
      }
    } catch { setPlan(null); }
    setLoading(false);
  };

  const openNew = () => {
    setForm(p => ({ ...p, UHID: searchUHID, ipdNo: searchIPD }));
    setProblems([{ ...emptyProblem, interventions: [{ intervention: "", frequency: "", responsible: "Nurse" }] }]);
    setMode("new");
  };

  const openView = (p) => { setPlan(p); setMode("view"); };

  const handleAssessment = (field, val) => {
    setForm(p => ({ ...p, admissionAssessment: { ...p.admissionAssessment, [field]: val } }));
  };

  const addProblem = () => setProblems(p => [...p, { ...emptyProblem, interventions: [{ intervention: "", responsible: "Nurse", frequency: "" }] }]);
  const removeProblem = (i) => setProblems(p => p.filter((_, idx) => idx !== i));

  const useTemplate = (tpl) => {
    setProblems(p => [...p, {
      ...emptyProblem,
      problemStatement: tpl.problemStatement,
      relatedTo: tpl.relatedTo,
      evidencedBy: tpl.evidencedBy,
      interventions: [{ intervention: "", frequency: "Each shift", responsible: "Nurse" }],
    }]);
  };

  const changeProblem = (i, field, val) => setProblems(p => p.map((pr, idx) => idx === i ? { ...pr, [field]: val } : pr));

  const addIntervention = (pi) => setProblems(p => p.map((pr, idx) => idx === pi ? { ...pr, interventions: [...pr.interventions, { intervention: "", frequency: "", responsible: "Nurse" }] } : pr));
  const changeIntervention = (pi, ii, field, val) => setProblems(p => p.map((pr, pidx) => pidx !== pi ? pr : {
    ...pr,
    interventions: pr.interventions.map((iv, iidx) => iidx === ii ? { ...iv, [field]: val } : iv),
  }));
  const removeIntervention = (pi, ii) => setProblems(p => p.map((pr, pidx) => pidx !== pi ? pr : { ...pr, interventions: pr.interventions.filter((_, iidx) => iidx !== ii) }));

  const save = async () => {
    setLoading(true);
    const payload = {
      ...form,
      educationTopics: form.educationTopics ? form.educationTopics.split(",").map(s => s.trim()).filter(Boolean) : [],
      nursingProblems: problems,
    };
    try {
      if (plan && plan._id) {
        await axios.put(`${API}/${plan._id}`, payload);
        setMsg("Care plan updated.");
      } else {
        await axios.post(API, payload);
        setMsg("Care plan created.");
      }
      setMode("list");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const inputCls = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const sectionCls = "bg-white rounded-lg shadow p-4 mb-4";
  const selectCls = inputCls;

  const priorityColor = { HIGH: "text-red-600", MEDIUM: "text-yellow-600", LOW: "text-green-600" };

  return (
    <div style={{ marginLeft: 260, padding: 24, minHeight: "100vh", background: "#f4f6fb" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Nursing Care Plan</h2>
          <p className="text-sm text-gray-500">NABH COP.1 — Individualized nursing care plan per admission</p>
        </div>
        {mode !== "list" && <button onClick={() => setMode("list")} className="px-4 py-2 bg-gray-200 rounded text-sm">Back</button>}
      </div>

      {msg && <div className="mb-3 p-3 bg-green-50 border border-green-300 text-green-700 rounded text-sm">{msg}</div>}

      {mode === "list" && (
        <div className={sectionCls}>
          <div className="flex gap-3 items-end mb-4">
            <div>
              <label className={labelCls}>Search by UHID</label>
              <input className={inputCls} value={searchUHID} onChange={e => setSearchUHID(e.target.value)} placeholder="UHID..." />
            </div>
            <div>
              <label className={labelCls}>or IPD No</label>
              <input className={inputCls} value={searchIPD} onChange={e => setSearchIPD(e.target.value)} placeholder="IPD No..." />
            </div>
            <button onClick={search} className="px-5 py-2 bg-blue-600 text-white rounded text-sm">Search</button>
            <button onClick={openNew} className="px-5 py-2 bg-green-600 text-white rounded text-sm">+ New Plan</button>
          </div>
          {loading && <p className="text-sm text-gray-500">Searching...</p>}
          {plan === null && !loading && (searchUHID || searchIPD) && <p className="text-sm text-gray-500">No care plan found. Create a new one.</p>}
        </div>
      )}

      {(mode === "new" || mode === "edit") && (
        <div>
          {/* Patient Info */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Patient Information</h3>
            <div className="grid grid-cols-4 gap-3">
              {[["UHID","UHID"],["patientName","Patient Name"],["age","Age"],["gender","Gender"],["ipdNo","IPD No"],["nurseName","Primary Nurse"],["attendingDoctor","Attending Doctor"],["department","Department"]].map(([name,label]) => (
                <div key={name}>
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} name={name} value={form[name]} onChange={e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Admission Assessment */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Admission Assessment</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["consciousnessLevel", "Consciousness", ["Alert","Drowsy","Confused","Unconscious","Sedated"]],
                ["mobility", "Mobility", ["Independent","Assisted","Dependent","Bedridden"]],
                ["nutritionStatus", "Nutrition Status", ["Good","Fair","Poor","On NGT","On TPN"]],
                ["eliminationPattern", "Elimination", ["Normal","Constipation","Diarrhea","Catheterized","Colostomy"]],
                ["selfCareAbility", "Self Care", ["Full","Partial","Dependent"]],
                ["skinCondition", "Skin Condition", ["Intact","Wound","Rash","Pressure Ulcer","Edema"]],
                ["fallRisk", "Fall Risk", ["Low","Medium","High"]],
                ["pressureUlcerRisk", "Pressure Ulcer Risk", ["Low","Medium","High"]],
              ].map(([field, label, opts]) => (
                <div key={field}>
                  <label className={labelCls}>{label}</label>
                  <select className={selectCls} value={form.admissionAssessment[field]} onChange={e => handleAssessment(field, e.target.value)}>
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-4 mt-3">
              {[["ivAccess","IV Access"],["urinaryCatheter","Urinary Catheter"],["nasogastricTube","NGT"],["oxygenSupport","O₂ Support"],["painPresent","Pain Present"]].map(([field,label]) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.admissionAssessment[field]} onChange={e => handleAssessment(field, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
            {form.admissionAssessment.painPresent && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Pain Score (0-10)</label>
                  <input type="number" min="0" max="10" className={inputCls} value={form.admissionAssessment.painScore} onChange={e => handleAssessment("painScore", e.target.value)} />
                </div>
              </div>
            )}
            {form.admissionAssessment.oxygenSupport && (
              <div className="mt-3 w-48">
                <label className={labelCls}>O₂ Flow Rate</label>
                <input className={inputCls} value={form.admissionAssessment.oxygenFlowRate} onChange={e => handleAssessment("oxygenFlowRate", e.target.value)} placeholder="e.g. 4L/min" />
              </div>
            )}
            <div className="mt-3">
              <label className={labelCls}>Additional Notes</label>
              <textarea className={inputCls} rows={2} value={form.admissionAssessment.additionalNotes} onChange={e => handleAssessment("additionalNotes", e.target.value)} />
            </div>
          </div>

          {/* Quick Add Problems */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Quick Add — Common Nursing Problems</h3>
            <div className="flex flex-wrap gap-2">
              {COMMON_PROBLEMS.map((tpl, i) => (
                <button key={i} onClick={() => useTemplate(tpl)} className="px-3 py-1 border border-blue-300 text-blue-600 rounded text-xs hover:bg-blue-50">
                  + {tpl.problemStatement}
                </button>
              ))}
            </div>
          </div>

          {/* Nursing Problems */}
          <div className={sectionCls}>
            <div className="flex justify-between items-center mb-3 border-b pb-2">
              <h3 className="font-bold text-gray-700">Nursing Problems & Care Plan</h3>
              <button onClick={addProblem} className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">+ Add Problem</button>
            </div>
            {problems.map((pr, pi) => (
              <div key={pi} className="border rounded-lg p-4 mb-4 bg-gray-50">
                <div className="flex justify-between items-start mb-3">
                  <span className="font-semibold text-gray-700">Problem #{pi + 1}</span>
                  <button onClick={() => removeProblem(pi)} className="text-red-500 text-xs px-2 py-1 bg-red-50 rounded">Remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="col-span-2">
                    <label className={labelCls}>Problem Statement (NANDA)</label>
                    <input className={inputCls} value={pr.problemStatement} onChange={e => changeProblem(pi, "problemStatement", e.target.value)} placeholder="e.g. Acute Pain" />
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    <select className={`${selectCls} font-semibold ${priorityColor[pr.priority]}`} value={pr.priority} onChange={e => changeProblem(pi, "priority", e.target.value)}>
                      {["HIGH","MEDIUM","LOW"].map(v => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Related To</label>
                    <input className={inputCls} value={pr.relatedTo} onChange={e => changeProblem(pi, "relatedTo", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Evidenced By</label>
                    <input className={inputCls} value={pr.evidencedBy} onChange={e => changeProblem(pi, "evidencedBy", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Short-term Goal</label>
                    <input className={inputCls} value={pr.shortTermGoal} onChange={e => changeProblem(pi, "shortTermGoal", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Long-term Goal</label>
                    <input className={inputCls} value={pr.longTermGoal} onChange={e => changeProblem(pi, "longTermGoal", e.target.value)} />
                  </div>
                </div>

                {/* Interventions */}
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-semibold text-gray-700">Nursing Interventions</label>
                    <button onClick={() => addIntervention(pi)} className="px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">+ Add</button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-xs font-semibold text-gray-500 px-1 mb-1">
                    <span>Intervention</span><span>Frequency</span><span>Responsible</span>
                  </div>
                  {pr.interventions.map((iv, ii) => (
                    <div key={ii} className="grid grid-cols-3 gap-1 mb-1">
                      <input className={inputCls} placeholder="Intervention..." value={iv.intervention} onChange={e => changeIntervention(pi, ii, "intervention", e.target.value)} />
                      <input className={inputCls} placeholder="Frequency..." value={iv.frequency} onChange={e => changeIntervention(pi, ii, "frequency", e.target.value)} />
                      <div className="flex gap-1">
                        <input className={inputCls} placeholder="Responsible..." value={iv.responsible} onChange={e => changeIntervention(pi, ii, "responsible", e.target.value)} />
                        <button onClick={() => removeIntervention(pi, ii)} className="px-1 bg-red-100 text-red-600 rounded text-xs">✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className={labelCls}>Evaluation / Outcome</label>
                  <textarea className={inputCls} rows={2} value={pr.evaluation} onChange={e => changeProblem(pi, "evaluation", e.target.value)} placeholder="Document evaluation of outcomes..." />
                </div>
              </div>
            ))}
          </div>

          {/* Education & Discharge */}
          <div className={sectionCls}>
            <h3 className="font-bold text-gray-700 mb-3 border-b pb-2">Patient Education & Discharge Planning</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Education Topics (comma separated)</label>
                <input className={inputCls} value={form.educationTopics} onChange={e => setForm(p => ({ ...p, educationTopics: e.target.value }))} placeholder="Disease, Medications, Diet..." />
              </div>
              <div>
                <label className={labelCls}>Education Barriers</label>
                <input className={inputCls} value={form.educationBarriers} onChange={e => setForm(p => ({ ...p, educationBarriers: e.target.value }))} placeholder="Language, Literacy..." />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Discharge Goals</label>
                <textarea className={inputCls} rows={2} value={form.dischargeGoals} onChange={e => setForm(p => ({ ...p, dischargeGoals: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end mb-6">
            <button onClick={() => setMode("list")} className="px-5 py-2 bg-gray-200 rounded text-sm">Cancel</button>
            <button onClick={save} disabled={loading} className="px-5 py-2 bg-green-600 text-white rounded text-sm font-medium">
              {loading ? "Saving..." : "Save Care Plan"}
            </button>
          </div>
        </div>
      )}

      {mode === "view" && plan && (
        <div className="bg-white rounded-lg shadow p-6 max-w-4xl mx-auto text-sm">
          <div className="flex justify-between mb-4">
            <div>
              <h3 className="font-bold text-lg">Nursing Care Plan</h3>
              <p className="text-gray-500 text-xs">UHID: {plan.UHID} | IPD: {plan.ipdNo} | Nurse: {plan.nurseName}</p>
            </div>
            <div className="flex gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${plan.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{plan.status}</span>
              <button onClick={() => { setForm({ ...plan, educationTopics: (plan.educationTopics || []).join(", ") }); setProblems(plan.nursingProblems || []); setMode("edit"); }} className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">Edit</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 border-b pb-3 text-sm">
            <div><span className="font-semibold">Patient:</span> {plan.patientName}</div>
            <div><span className="font-semibold">Doctor:</span> {plan.attendingDoctor}</div>
            <div><span className="font-semibold">Department:</span> {plan.department}</div>
            <div><span className="font-semibold">Assessment Date:</span> {plan.assessmentDate ? new Date(plan.assessmentDate).toLocaleDateString() : "-"}</div>
          </div>

          <h4 className="font-semibold mb-2">Nursing Problems ({plan.nursingProblems?.length || 0})</h4>
          {(plan.nursingProblems || []).map((pr, i) => (
            <div key={i} className="border rounded-lg p-3 mb-3 bg-gray-50">
              <div className="flex justify-between mb-1">
                <span className="font-semibold">{i + 1}. {pr.problemStatement}</span>
                <span className={`text-xs font-semibold ${priorityColor[pr.priority]}`}>{pr.priority}</span>
              </div>
              {pr.relatedTo && <p className="text-gray-600 text-xs">Related to: {pr.relatedTo}</p>}
              {pr.evidencedBy && <p className="text-gray-600 text-xs">Evidenced by: {pr.evidencedBy}</p>}
              {pr.interventions?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-gray-700">Interventions:</p>
                  {pr.interventions.map((iv, j) => <p key={j} className="text-xs ml-2">• {iv.intervention} ({iv.frequency}) — {iv.responsible}</p>)}
                </div>
              )}
              {pr.evaluation && <p className="mt-1 text-xs text-blue-700">Evaluation: {pr.evaluation}</p>}
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs ${pr.status === "RESOLVED" ? "bg-green-100 text-green-700" : pr.status === "ON_HOLD" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"}`}>{pr.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NursingCarePlanPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="nursing-care-plan">
      <NursingCarePlanContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
