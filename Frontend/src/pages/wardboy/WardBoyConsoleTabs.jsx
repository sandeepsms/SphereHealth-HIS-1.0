/**
 * WardBoyConsoleTabs.jsx — Phase B + C tabs for the Ward Boy console.
 *
 * Split out of WardBoyConsole.jsx because the file was getting large.
 * Exports 5 components (Shift / Equipment / Supplies / CodeBlue / Mortuary)
 * that the parent imports.
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  KPI, Card, Table, Empty, Badge,
  PrimaryButton, Modal, Field, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { useDebounce } from "../../utils/pollingHelpers";

import { API_BASE_URL as API } from "../../config/api";
// R7bj-F9 / 10-X-HIGH-1: drop legacy localStorage fallback (see WardBoyConsole).
const authHdr = () => ({ headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` } });

const fmtAgo = (d) => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

const FilterPill = ({ label, value, current, setCurrent, color }) => (
  <button onClick={() => setCurrent(value === current ? "" : value)}
    style={{
      padding: "5px 12px", borderRadius: 999,
      border: `1.5px solid ${value === current ? color : C.border}`,
      background: value === current ? color + "15" : "#fff",
      color: value === current ? color : C.muted,
      fontWeight: 700, fontSize: 11.5, cursor: "pointer",
    }}>{label}</button>
);

/* ══════════════════════════════════════════════════════════════
   SHIFT — clock in/out + break tracking
══════════════════════════════════════════════════════════════ */
export function ShiftTab() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [ward,    setWard]    = useState("");
  const [notes,   setNotes]   = useState("");
  const [handover,setHandover]= useState("");
  const [breakReason, setBreakReason] = useState("");

  const refresh = async () => {
    try {
      const [cur, hist] = await Promise.all([
        axios.get(`${API}/ward-ops/shift/current`, authHdr()).then(r => r.data?.data).catch(() => null),
        axios.get(`${API}/ward-ops/shift/history`, authHdr()).then(r => r.data?.data || []).catch(() => []),
      ]);
      setCurrent(cur); setHistory(hist);
    } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const onStart = async () => {
    try { await axios.post(`${API}/ward-ops/shift/start`, { ward }, authHdr()); toast.success("Shift started."); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Start failed"); }
  };
  const onEnd = async () => {
    try { await axios.post(`${API}/ward-ops/shift/end`, { shiftNotes: notes, handoverNotes: handover }, authHdr()); toast.success("Shift closed."); setNotes(""); setHandover(""); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "End failed"); }
  };
  const onBreakStart = async () => {
    try { await axios.post(`${API}/ward-ops/shift/break/start`, { reason: breakReason }, authHdr()); toast.success("Break started."); setBreakReason(""); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Break failed"); }
  };
  const onBreakEnd = async () => {
    try { await axios.post(`${API}/ward-ops/shift/break/end`, {}, authHdr()); toast.success("Break ended."); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "End-break failed"); }
  };

  const onBreak = current?.breaks?.length && !current.breaks[current.breaks.length - 1].endedAt;
  const liveMin = current ? Math.floor((Date.now() - new Date(current.startedAt)) / 60000) : 0;

  return (
    <>
      <Card title={current ? `Shift open · ${liveMin} min` : "No active shift"} color={current ? C.green : C.muted} icon="pi-clock"
        right={current && <Badge value={onBreak ? "ON BREAK" : "ACTIVE"} />}>
        {!current ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Assigned ward (optional)">
              <input value={ward} onChange={(e) => setWard(e.target.value)} placeholder="MGW / FGW / ICU"
                style={{ width: 200, padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }} />
            </Field>
            <PrimaryButton label="Start Shift" icon="pi-play" color={C.teal} onClick={onStart} />
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
              <KPI label="Started"  value={new Date(current.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} color={C.green} icon="pi-play" />
              <KPI label="Ward"     value={current.ward || "—"} color={C.blue} icon="pi-th-large" />
              <KPI label="Breaks"   value={current.breaks?.length || 0} color={C.amber} icon="pi-pause" />
              <KPI label="Active"   value={`${liveMin} min`} color={C.purple} icon="pi-stopwatch" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
              {!onBreak ? (
                <>
                  <input value={breakReason} onChange={(e) => setBreakReason(e.target.value)} placeholder="Break reason (lunch / tea)"
                    style={{ flex: 1, minWidth: 180, padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
                  <button onClick={onBreakStart}
                    style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.amber}`, background: C.amber + "15", color: C.amber, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                    <i className="pi pi-pause" style={{ marginRight: 5 }} />Start Break
                  </button>
                </>
              ) : (
                <button onClick={onBreakEnd}
                  style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.green}`, background: C.green + "15", color: C.green, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                  <i className="pi pi-play" style={{ marginRight: 5 }} />End Break
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {current && (
        <div style={{ marginTop: 14 }}>
          <Card title="End shift / handover" color={C.red} icon="pi-stop">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Shift notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
              </Field>
              <Field label="Pending tasks handover (for next shift)">
                <textarea value={handover} onChange={(e) => setHandover(e.target.value)} rows={2}
                  placeholder="e.g. Bed 14 stretcher needs replacement. Oxygen cylinder for bed 7 due at 8am."
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
              </Field>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <PrimaryButton label="End Shift" icon="pi-stop" color={C.red} onClick={onEnd} />
            </div>
          </Card>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title={`Recent shifts (last ${history.length})`} color={C.muted} icon="pi-history">
            <Table cols={[
              { label: "Date" }, { label: "Ward" }, { label: "Started" }, { label: "Ended" },
              { label: "Breaks", align: "right" }, { label: "Active min", align: "right" },
            ]}>
              {history.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{new Date(s.startedAt).toLocaleDateString("en-IN")}</td>
                  <td style={{ color: C.muted }}>{s.ward || "—"}</td>
                  <td style={{ fontSize: 11.5 }}>{new Date(s.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ fontSize: 11.5 }}>{s.endedAt ? new Date(s.endedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : <Badge value="OPEN" />}</td>
                  <td style={{ textAlign: "right" }}>{s.breaks?.length || 0}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{s.totalActiveMin ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   EQUIPMENT — issue / return register
══════════════════════════════════════════════════════════════ */
export function EquipmentTab() {
  const { can } = useAuth();
  const canWrite = can("ward.equipment");
  const [rows, setRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState("issued");
  const [q, setQ] = useState("");
  const [showIssueModal, setShowIssueModal] = useState(false);

  // R7bj-F9 — debounce search-as-you-type (no longer waits for Enter) + cancel
  // in-flight request on each filter change so a fast typist doesn't get a
  // late stale response over-writing the fresh one.
  const debouncedQ = useDebounce(q, 300);
  const abortRef = useRef(null);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedQ) params.set("q", debouncedQ);
    axios.get(`${API}/ward-ops/equipment?${params}`, { ...authHdr(), signal: ctrl.signal })
      .then(r => setRows(r.data?.data || []))
      .catch(e => { if (e.name !== "CanceledError" && e.name !== "AbortError") console.error(e); });
    return () => ctrl.abort();
  }, [statusFilter, debouncedQ]);

  const refresh = () => {
    // Forced refresh (Issue modal → onDone): bump statusFilter dep via setter
    // would be wrong; just re-fire the same fetch by cancelling + re-running.
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedQ) params.set("q", debouncedQ);
    axios.get(`${API}/ward-ops/equipment?${params}`, { ...authHdr(), signal: ctrl.signal })
      .then(r => setRows(r.data?.data || []))
      .catch(e => { if (e.name !== "CanceledError" && e.name !== "AbortError") console.error(e); });
  };

  const onReturn = async (id, condition) => {
    try { await axios.patch(`${API}/ward-ops/equipment/${id}/return`, { conditionOnReturn: condition }, authHdr()); toast.success("Returned."); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Return failed"); }
  };

  return (
    <>
      <Card title="Equipment register" color={C.purple} icon="pi-cog"
        right={canWrite && <PrimaryButton label="Issue equipment" icon="pi-plus" color={C.purple} onClick={() => setShowIssueModal(true)} />}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          {[{v: "issued", lbl: "Out"}, {v: "returned", lbl: "Returned"}, {v: "lost", lbl: "Lost"}, {v: "", lbl: "All"}].map(o => (
            <FilterPill key={o.v} label={o.lbl} value={o.v} current={statusFilter} setCurrent={setStatusFilter} color={C.purple} />
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / serial / person… (auto)"
            style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
        </div>
        {rows.length === 0 ? (
          <Empty icon="pi-cog" text={statusFilter === "issued" ? "Nothing currently out." : "No records."} />
        ) : (
          <Table cols={[
            { label: "Equipment" }, { label: "Serial" }, { label: "Issued to" },
            { label: "When" }, { label: "Status" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 700 }}>{r.equipmentName}<div style={{ color: C.muted, fontSize: 11 }}>{r.category}</div></td>
                <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{r.serialNumber || "—"}</td>
                <td>{r.issuedToName || "—"}<div style={{ color: C.muted, fontSize: 11 }}>{r.issuedToWard}</div></td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtAgo(r.issuedAt)}</td>
                <td><Badge value={r.status === "issued" ? "OUT" : r.status.toUpperCase()} /></td>
                <td>
                  {r.status === "issued" && canWrite && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => onReturn(r._id, "OK")}
                        style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Return OK</button>
                      <button onClick={() => onReturn(r._id, "Damaged")}
                        style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.amber}40`, background: "#fff", color: C.amber, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Damaged</button>
                      <button onClick={() => onReturn(r._id, "Lost")}
                        style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.red}40`, background: "#fff", color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Lost</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {showIssueModal && <EquipmentIssueModal onClose={() => setShowIssueModal(false)} onDone={() => { setShowIssueModal(false); refresh(); }} />}
    </>
  );
}

function EquipmentIssueModal({ onClose, onDone }) {
  const [form, setForm] = useState({ equipmentName: "", category: "Wheelchair", serialNumber: "", issuedToName: "", issuedToWard: "", expectedReturnAt: "" });
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.equipmentName) { toast.error("Equipment name required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/ward-ops/equipment/issue`, form, authHdr()); toast.success("Issued."); onDone && onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Issue failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Issue equipment" icon="pi-arrow-up-right" color={C.purple} onClose={onClose}
      submitLabel="Issue" submitting={saving} onSubmit={submit}>
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Equipment name">
          <input value={form.equipmentName} onChange={(e) => u("equipmentName", e.target.value)} placeholder="Wheelchair / BP cuff / Suction…"
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Category">
            <select value={form.category} onChange={(e) => u("category", e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
              {["Wheelchair","Stretcher","BP","ECG","Oxygen","Suction","Nebuliser","Pulse Oximeter","IV Stand","Crash Cart","Other"].map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Serial / asset #">
            <input value={form.serialNumber} onChange={(e) => u("serialNumber", e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Issued to (name)">
            <input value={form.issuedToName} onChange={(e) => u("issuedToName", e.target.value)} placeholder="Recipient nurse / ward boy"
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
          </Field>
          <Field label="Ward / room">
            <input value={form.issuedToWard} onChange={(e) => u("issuedToWard", e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
          </Field>
        </div>
        <Field label="Expected return (optional)">
          <input type="datetime-local" value={form.expectedReturnAt} onChange={(e) => u("expectedReturnAt", e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
        </Field>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUPPLIES — daily linen + BMW
══════════════════════════════════════════════════════════════ */
export function SuppliesTab() {
  const { can } = useAuth();
  const canWrite = can("ward.supplies");
  const today = new Date().toISOString().slice(0,10);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ date: today, ward: "Main", linen: { issued: "", returned: "", soiled: "", lost: "" }, bmw: { yellow: "", red: "", blue: "", white: "", black: "" }, notes: "" });
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try { const r = await axios.get(`${API}/ward-ops/supplies?days=7`, authHdr()); setRows(r.data?.data || []); }
    catch {}
  };
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/ward-ops/supplies`, form, authHdr());
      toast.success("Recorded.");
      refresh();
    } catch (e) { toast.error(e?.response?.data?.message || "Save failed"); }
    setSaving(false);
  };

  return (
    <>
      <Card title={`Linen + BMW log · ${form.date} · ${form.ward}`} color={C.green} icon="pi-inbox">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
          <Field label="Date">
            <input type="date" value={form.date} max={today} onChange={(e) => setForm(f => ({...f, date: e.target.value}))}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
          </Field>
          <Field label="Ward">
            <input value={form.ward} onChange={(e) => setForm(f => ({...f, ward: e.target.value}))}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
          </Field>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginTop: 8, marginBottom: 4 }}>LINEN (sets)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[{k:"issued",lbl:"Issued"},{k:"returned",lbl:"Returned"},{k:"soiled",lbl:"Soiled"},{k:"lost",lbl:"Lost"}].map(({k,lbl}) => (
            <Field key={k} label={lbl}>
              <input type="number" min="0" value={form.linen[k]} onChange={(e) => setForm(f => ({...f, linen: {...f.linen, [k]: e.target.value}}))} disabled={!canWrite}
                style={{ width: "100%", padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            </Field>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginTop: 12, marginBottom: 4 }}>BMW (kg, by colour bag)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {[
            {k:"yellow",lbl:"🟡 Yellow"},{k:"red",lbl:"🔴 Red"},{k:"blue",lbl:"🔵 Blue"},
            {k:"white",lbl:"⚪ White (Sharps)"},{k:"black",lbl:"⚫ Black"},
          ].map(({k,lbl}) => (
            <Field key={k} label={lbl}>
              <input type="number" min="0" step="0.1" value={form.bmw[k]} onChange={(e) => setForm(f => ({...f, bmw: {...f.bmw, [k]: e.target.value}}))} disabled={!canWrite}
                style={{ width: "100%", padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            </Field>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Notes">
            <input value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} disabled={!canWrite}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
          </Field>
        </div>
        {canWrite && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <PrimaryButton label="Save (upserts today)" icon="pi-save" color={C.green} onClick={submit} busy={saving} />
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title="Last 7 days" color={C.muted} icon="pi-history">
            <Table cols={[
              { label: "Date" }, { label: "Ward" },
              { label: "Linen Iss", align: "right" }, { label: "Lost", align: "right" },
              { label: "🟡", align: "right" }, { label: "🔴", align: "right" }, { label: "🔵", align: "right" },
              { label: "⚪", align: "right" }, { label: "⚫", align: "right" },
            ]}>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.date).toLocaleDateString("en-IN")}</td>
                  <td>{r.ward}</td>
                  <td style={{ textAlign: "right" }}>{r.linen?.issued ?? 0}</td>
                  <td style={{ textAlign: "right", color: (r.linen?.lost || 0) > 0 ? C.red : C.muted }}>{r.linen?.lost ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{r.bmw?.yellow ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{r.bmw?.red ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{r.bmw?.blue ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{r.bmw?.white ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{r.bmw?.black ?? 0}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   CODE BLUE — alert log + response tracking
══════════════════════════════════════════════════════════════ */
export function CodeBlueTab() {
  const { can } = useAuth();
  const canWrite = can("ward.code-blue");
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(null);
  const refresh = async () => {
    try { const r = await axios.get(`${API}/ward-ops/code-blue?days=30`, authHdr()); setRows(r.data?.data || []); }
    catch {}
  };
  useEffect(() => { refresh(); }, []);

  const respond = async (id) => {
    try { await axios.post(`${API}/ward-ops/code-blue/${id}/respond`, {}, authHdr()); toast.success("Logged your arrival."); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
  };

  return (
    <>
      <Card title="Code Blue alerts (last 30 days)" color={C.red} icon="pi-bolt"
        right={canWrite && <PrimaryButton label="Raise Code Blue" icon="pi-bolt" color={C.red} onClick={() => setShow(true)} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-shield" text="No code blue events in the window — a good sign." />
        ) : (
          <Table cols={[
            { label: "When" }, { label: "Location" }, { label: "Patient" },
            { label: "Responders", align: "right" }, { label: "Delay", align: "right" },
            { label: "Outcome" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: 11.5 }}>{new Date(r.alertedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ fontWeight: 700 }}>{r.location}{r.bedNumber ? ` / ${r.bedNumber}` : ""}</td>
                <td>{r.patientName || "—"}<div style={{ color: C.muted, fontSize: 11 }}>{r.UHID}</div></td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{r.responders?.length || 0}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: r.arrivalDelaySec > 120 ? C.red : C.green }}>
                  {r.arrivalDelaySec != null ? `${r.arrivalDelaySec}s` : "—"}
                </td>
                <td><Badge value={(r.outcome || "ongoing").replace(/-/g," ").toUpperCase()} /></td>
                <td>
                  {r.outcome === "ongoing" && canWrite && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => respond(r._id)}
                        style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.blue}40`, background: "#fff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>I'm there</button>
                      <button onClick={() => setClosing(r)}
                        style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.red}40`, background: "#fff", color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Close</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {show && <CodeBlueCreateModal onClose={() => setShow(false)} onDone={() => { setShow(false); refresh(); }} />}
      {closing && <CodeBlueCloseModal event={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} />}
    </>
  );
}

function CodeBlueCreateModal({ onClose, onDone }) {
  const [form, setForm] = useState({ location: "", bedNumber: "", UHID: "", patientName: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.location) { toast.error("Location required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/ward-ops/code-blue`, form, authHdr()); toast.success("Code Blue logged. Responders alerted!"); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="🚨 Raise Code Blue" icon="pi-bolt" color={C.red} onClose={onClose} submitLabel="Alert" submitting={saving} onSubmit={submit}>
      <Field label="Location"><input autoFocus value={form.location} onChange={(e) => setForm(f => ({...f, location: e.target.value}))} placeholder="Ward / Room"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Bed #"><input value={form.bedNumber} onChange={(e) => setForm(f => ({...f, bedNumber: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="UHID"><input value={form.UHID} onChange={(e) => setForm(f => ({...f, UHID: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Patient"><input value={form.patientName} onChange={(e) => setForm(f => ({...f, patientName: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <Field label="Notes (optional)"><textarea value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

function CodeBlueCloseModal({ event, onClose, onDone }) {
  const [outcome, setOutcome] = useState("resuscitated");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await axios.post(`${API}/ward-ops/code-blue/${event._id}/close`, { outcome, notes }, authHdr()); toast.success("Closed."); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Close Code Blue" icon="pi-check" color={C.green} onClose={onClose} submitLabel="Close" submitting={saving} onSubmit={submit}>
      <Field label="Outcome">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
          <option value="resuscitated">Resuscitated · stable</option>
          <option value="shifted-to-icu">Shifted to ICU</option>
          <option value="pronounced-dead">Pronounced dead</option>
          <option value="false-alarm">False alarm</option>
        </select>
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   MORTUARY — death + body shift + family handover register
══════════════════════════════════════════════════════════════ */
export function MortuaryTab() {
  const { can } = useAuth();
  const canWrite = can("ward.mortuary");
  const [rows, setRows] = useState([]);
  const [showDeclare, setShowDeclare] = useState(false);
  const [shifting, setShifting] = useState(null);
  const [handing, setHanding] = useState(null);

  const refresh = async () => {
    try { const r = await axios.get(`${API}/ward-ops/mortuary`, authHdr()); setRows(r.data?.data || []); }
    catch {}
  };
  useEffect(() => { refresh(); }, []);

  return (
    <>
      <Card title="Mortuary register" color={C.muted} icon="pi-shield"
        right={canWrite && <PrimaryButton label="Declare death" icon="pi-plus" color={C.muted} onClick={() => setShowDeclare(true)} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-shield" text="No mortuary records." />
        ) : (
          <Table cols={[
            { label: "Patient" }, { label: "Age/Sex" }, { label: "Death declared" },
            { label: "Cause" }, { label: "MLC" }, { label: "Status" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 700 }}>{r.patientName}<div style={{ color: C.muted, fontSize: 11 }}>{r.UHID}</div></td>
                <td style={{ fontSize: 12 }}>{r.age ?? "—"} / {r.gender || "—"}</td>
                <td style={{ fontSize: 11.5 }}>{new Date(r.deathDeclaredAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}<div style={{ color: C.muted, fontSize: 11 }}>{r.deathDeclaredByName}</div></td>
                <td style={{ fontSize: 12, maxWidth: 200 }}>{r.causeOfDeath || "—"}</td>
                <td>{r.isMLC ? <Badge value={`MLC ${r.mlcNumber || ""}`} /> : "—"}</td>
                <td><Badge value={r.status.replace(/-/g, " ").toUpperCase()} /></td>
                <td>
                  {canWrite && r.status === "declared" && (
                    <button onClick={() => setShifting(r)}
                      style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.blue}40`, background: "#fff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Shift to mortuary</button>
                  )}
                  {canWrite && r.status === "in-mortuary" && (
                    <button onClick={() => setHanding(r)}
                      style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Handover</button>
                  )}
                  {r.status === "handed-over" && (
                    <span style={{ fontSize: 11, color: C.muted }}>To {r.receivedBy} ({r.relationship})</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {showDeclare && <DeclareDeathModal onClose={() => setShowDeclare(false)} onDone={() => { setShowDeclare(false); refresh(); }} />}
      {shifting && <ShiftToMortuaryModal record={shifting} onClose={() => setShifting(null)} onDone={() => { setShifting(null); refresh(); }} />}
      {handing  && <HandoverModal record={handing} onClose={() => setHanding(null)} onDone={() => { setHanding(null); refresh(); }} />}
    </>
  );
}

function DeclareDeathModal({ onClose, onDone }) {
  const [form, setForm] = useState({ UHID: "", patientName: "", age: "", gender: "Male", causeOfDeath: "", isMLC: false, mlcNumber: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.UHID || !form.patientName) { toast.error("UHID + name required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/ward-ops/mortuary/declare`, form, authHdr()); toast.success("Death declared."); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Declare death" icon="pi-shield" color={C.muted} onClose={onClose} submitLabel="Declare" submitting={saving} onSubmit={submit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        <Field label="UHID"><input value={form.UHID} onChange={(e) => setForm(f => ({...f, UHID: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Patient name"><input value={form.patientName} onChange={(e) => setForm(f => ({...f, patientName: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Age"><input type="number" value={form.age} onChange={(e) => setForm(f => ({...f, age: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Gender">
          <select value={form.gender} onChange={(e) => setForm(f => ({...f, gender: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
        </Field>
      </div>
      <Field label="Cause of death"><input value={form.causeOfDeath} onChange={(e) => setForm(f => ({...f, causeOfDeath: e.target.value}))}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
          <input type="checkbox" checked={form.isMLC} onChange={(e) => setForm(f => ({...f, isMLC: e.target.checked}))} />
          MLC case
        </label>
        {form.isMLC && (
          <input value={form.mlcNumber} onChange={(e) => setForm(f => ({...f, mlcNumber: e.target.value}))} placeholder="MLR number"
            style={{ flex: 1, padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
        )}
      </div>
    </Modal>
  );
}

function ShiftToMortuaryModal({ record, onClose, onDone }) {
  const [bodyTagId, setBodyTagId] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await axios.patch(`${API}/ward-ops/mortuary/${record._id}/shift`, { bodyTagId }, authHdr()); toast.success("Shifted."); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title={`Shift to mortuary — ${record.patientName}`} icon="pi-arrow-right" color={C.blue} onClose={onClose} submitLabel="Confirm shift" submitting={saving} onSubmit={submit}>
      <Field label="Body tag ID (label affixed)">
        <input value={bodyTagId} onChange={(e) => setBodyTagId(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
      </Field>
    </Modal>
  );
}

function HandoverModal({ record, onClose, onDone }) {
  const [form, setForm] = useState({ receivedBy: "", relationship: "", receiverPhone: "", receiverIdProof: "Aadhaar", receiverIdNumber: "", vehicleDetails: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.receivedBy || !form.relationship) { toast.error("Name + relationship required"); return; }
    setSaving(true);
    try { await axios.patch(`${API}/ward-ops/mortuary/${record._id}/handover`, form, authHdr()); toast.success("Handed over."); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title={`Handover — ${record.patientName}`} icon="pi-user" color={C.green} onClose={onClose} submitLabel="Confirm handover" submitting={saving} onSubmit={submit} size={620}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Received by (name)"><input value={form.receivedBy} onChange={(e) => setForm(f => ({...f, receivedBy: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Relationship"><input value={form.relationship} onChange={(e) => setForm(f => ({...f, relationship: e.target.value}))} placeholder="Son / Spouse / Father" style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Phone"><input value={form.receiverPhone} onChange={(e) => setForm(f => ({...f, receiverPhone: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="ID proof type">
          <select value={form.receiverIdProof} onChange={(e) => setForm(f => ({...f, receiverIdProof: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>Aadhaar</option><option>PAN</option><option>Voter ID</option><option>Driving License</option><option>Passport</option><option>Other</option>
          </select>
        </Field>
        <Field label="ID number"><input value={form.receiverIdNumber} onChange={(e) => setForm(f => ({...f, receiverIdNumber: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Vehicle details"><input value={form.vehicleDetails} onChange={(e) => setForm(f => ({...f, vehicleDetails: e.target.value}))} placeholder="Ambulance reg #" style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}
