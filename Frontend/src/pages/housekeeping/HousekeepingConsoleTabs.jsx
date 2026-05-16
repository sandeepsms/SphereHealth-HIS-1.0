/**
 * HousekeepingConsoleTabs.jsx — ops tabs for the Housekeeping console.
 *
 * Five export components: ShiftTab, SpillageTab, ChecklistTab,
 * InventoryTab, PestTab.
 *
 * Note: ShiftTab reuses the SAME backend endpoints as Ward Boy
 * (/api/ward-ops/shift/*). Shift is a cross-role primitive — there's
 * no separate "housekeeping shift" collection.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  KPI, Card, Table, Empty, Badge, PrimaryButton, Modal, Field, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtAgo = (d) => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h`;
  return `${Math.floor(hrs / 24)} d`;
};

/* ══════════════════════════════════════════════════════════════
   SHIFT — reuses /api/ward-ops/shift/*
══════════════════════════════════════════════════════════════ */
export function ShiftTab() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [ward, setWard] = useState("");
  const [notes, setNotes] = useState("");
  const [handover, setHandover] = useState("");
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

  const onStart = async () => { try { await axios.post(`${API}/ward-ops/shift/start`, { ward }, authHdr()); toast.success("Shift started"); refresh(); } catch (e) { toast.error(e?.response?.data?.message || "Failed"); } };
  const onEnd = async () => { try { await axios.post(`${API}/ward-ops/shift/end`, { shiftNotes: notes, handoverNotes: handover }, authHdr()); toast.success("Shift closed"); setNotes(""); setHandover(""); refresh(); } catch (e) { toast.error(e?.response?.data?.message || "Failed"); } };
  const onBreakStart = async () => { try { await axios.post(`${API}/ward-ops/shift/break/start`, { reason: breakReason }, authHdr()); toast.success("Break started"); setBreakReason(""); refresh(); } catch (e) { toast.error(e?.response?.data?.message || "Failed"); } };
  const onBreakEnd = async () => { try { await axios.post(`${API}/ward-ops/shift/break/end`, {}, authHdr()); toast.success("Break ended"); refresh(); } catch (e) { toast.error(e?.response?.data?.message || "Failed"); } };

  const onBreak = current?.breaks?.length && !current.breaks[current.breaks.length - 1].endedAt;
  const liveMin = current ? Math.floor((Date.now() - new Date(current.startedAt)) / 60000) : 0;

  return (
    <>
      <Card title={current ? `Shift open · ${liveMin} min` : "No active shift"} color={current ? C.green : C.muted} icon="pi-clock"
        right={current && <Badge value={onBreak ? "ON BREAK" : "ACTIVE"} />}>
        {!current ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Assigned area / zone (optional)">
              <input value={ward} onChange={(e) => setWard(e.target.value)} placeholder="OT-block / Ward-1 / Public"
                style={{ width: 240, padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }} />
            </Field>
            <PrimaryButton label="Start Shift" icon="pi-play" color={C.teal} onClick={onStart} />
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
              <KPI label="Started" value={new Date(current.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} color={C.green} icon="pi-play" />
              <KPI label="Area" value={current.ward || "—"} color={C.blue} icon="pi-th-large" />
              <KPI label="Breaks" value={current.breaks?.length || 0} color={C.amber} icon="pi-pause" />
              <KPI label="Active" value={`${liveMin} min`} color={C.purple} icon="pi-stopwatch" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
              {!onBreak ? (
                <>
                  <input value={breakReason} onChange={(e) => setBreakReason(e.target.value)} placeholder="Break reason"
                    style={{ flex: 1, minWidth: 180, padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
                  <button onClick={onBreakStart} style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.amber}`, background: C.amber + "15", color: C.amber, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                    <i className="pi pi-pause" style={{ marginRight: 5 }} />Start Break
                  </button>
                </>
              ) : (
                <button onClick={onBreakEnd} style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.green}`, background: C.green + "15", color: C.green, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                  <i className="pi pi-play" style={{ marginRight: 5 }} />End Break
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {current && (
        <div style={{ marginTop: 14 }}>
          <Card title="End shift" color={C.red} icon="pi-stop">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Shift notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
              <Field label="Handover notes"><textarea value={handover} onChange={(e) => setHandover(e.target.value)} rows={2} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <PrimaryButton label="End Shift" icon="pi-stop" color={C.red} onClick={onEnd} />
            </div>
          </Card>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title={`Recent shifts (${history.length})`} color={C.muted} icon="pi-history">
            <Table cols={[{ label: "Date" }, { label: "Area" }, { label: "Started" }, { label: "Ended" }, { label: "Active min", align: "right" }]}>
              {history.map((s, i) => (
                <tr key={i}>
                  <td>{new Date(s.startedAt).toLocaleDateString("en-IN")}</td>
                  <td style={{ color: C.muted }}>{s.ward || "—"}</td>
                  <td>{new Date(s.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{s.endedAt ? new Date(s.endedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : <Badge value="OPEN" />}</td>
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
   SPILLAGE — biohazard cleanup log
══════════════════════════════════════════════════════════════ */
export function SpillageTab() {
  const { can } = useAuth();
  const canWrite = can("house.spillage");
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [cleaning, setCleaning] = useState(null);

  const refresh = async () => { try { const r = await axios.get(`${API}/housekeeping/spillage?days=30`, authHdr()); setRows(r.data?.data || []); } catch {} };
  useEffect(() => { refresh(); }, []);

  const contain = async (id) => { try { await axios.patch(`${API}/housekeeping/spillage/${id}/contain`, {}, authHdr()); toast.success("Contained"); refresh(); } catch (e) { toast.error(e?.response?.data?.message || "Failed"); } };

  return (
    <>
      <Card title="Spillage / biohazard incidents (last 30 days)" color={C.red} icon="pi-exclamation-triangle"
        right={canWrite && <PrimaryButton label="Report spillage" icon="pi-plus" color={C.red} onClick={() => setShow(true)} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-shield" text="No spillage incidents in window — clean record!" />
        ) : (
          <Table cols={[
            { label: "When" }, { label: "Area" }, { label: "Type" },
            { label: "Volume" }, { label: "Reported by" }, { label: "Status" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: 11.5 }}>{new Date(r.reportedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ fontWeight: 700 }}>{r.area}{r.location ? ` · ${r.location}` : ""}</td>
                <td><Badge value={r.type.toUpperCase()} /></td>
                <td>{r.volumeEst}</td>
                <td style={{ fontSize: 12 }}>{r.reportedByName}<div style={{ color: C.muted, fontSize: 11 }}>{r.reportedByRole}</div></td>
                <td><Badge value={r.status.toUpperCase()} /></td>
                <td>
                  {canWrite && r.status === "reported" && (
                    <button onClick={() => contain(r._id)} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.amber}40`, background: "#fff", color: C.amber, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Contain</button>
                  )}
                  {canWrite && r.status === "contained" && (
                    <button onClick={() => setCleaning(r)} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Mark cleaned</button>
                  )}
                  {r.status === "cleaned" && (
                    <span style={{ fontSize: 11, color: C.muted }}>By {r.cleanedByName}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {show && <SpillageReportModal onClose={() => setShow(false)} onDone={() => { setShow(false); refresh(); }} />}
      {cleaning && <SpillageCleanModal incident={cleaning} onClose={() => setCleaning(null)} onDone={() => { setCleaning(null); refresh(); }} />}
    </>
  );
}

function SpillageReportModal({ onClose, onDone }) {
  const [form, setForm] = useState({ area: "", location: "", type: "blood", volumeEst: "small", patientUHID: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.area) { toast.error("Area required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/housekeeping/spillage`, form, authHdr()); toast.success("Reported"); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="🟥 Report spillage" icon="pi-exclamation-triangle" color={C.red} onClose={onClose} submitLabel="Report" submitting={saving} onSubmit={submit}>
      <Field label="Area"><input autoFocus value={form.area} onChange={(e) => setForm(f => ({...f, area: e.target.value}))} placeholder="Ward-1 / OT-3 / Lab / Corridor-G1"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Specific location"><input value={form.location} onChange={(e) => setForm(f => ({...f, location: e.target.value}))} placeholder="Near bed 5 / outside ICU"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Type">
          <select value={form.type} onChange={(e) => setForm(f => ({...f, type: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option value="blood">Blood</option><option value="body-fluid">Body fluid</option>
            <option value="vomit">Vomit</option><option value="urine">Urine</option>
            <option value="stool">Stool</option><option value="chemical">Chemical</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Volume">
          <select value={form.volumeEst} onChange={(e) => setForm(f => ({...f, volumeEst: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>small</option><option>medium</option><option>large</option>
          </select>
        </Field>
      </div>
      <Field label="Patient UHID (if applicable)"><input value={form.patientUHID} onChange={(e) => setForm(f => ({...f, patientUHID: e.target.value}))}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

function SpillageCleanModal({ incident, onClose, onDone }) {
  const [productsRaw, setProductsRaw] = useState("Bleach 10%, Phenol");
  const [protocol, setProtocol] = useState("spillage");
  const [reportedIC, setReportedIC] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/housekeeping/spillage/${incident._id}/clean`, {
        productsUsed: productsRaw.split(",").map(s => s.trim()).filter(Boolean),
        protocolFollowed: protocol,
        reportedToInfectionControl: reportedIC,
        notes,
      }, authHdr());
      toast.success("Cleaned"); onDone();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Mark spillage cleaned" icon="pi-check" color={C.green} onClose={onClose} submitLabel="Confirm" submitting={saving} onSubmit={submit}>
      <Field label="Products used (comma-sep)"><input value={productsRaw} onChange={(e) => setProductsRaw(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Protocol followed"><input value={protocol} onChange={(e) => setProtocol(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>
        <input type="checkbox" checked={reportedIC} onChange={(e) => setReportedIC(e.target.checked)} />
        Reported to Infection Control
      </label>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   CHECKLIST — daily area cleaning compliance (NABH HIC.6)
══════════════════════════════════════════════════════════════ */
export function ChecklistTab() {
  const { can } = useAuth();
  const canWrite = can("house.checklist");
  const [today, setToday] = useState([]);
  const [show, setShow] = useState(false);

  const refresh = async () => { try { const r = await axios.get(`${API}/housekeeping/checklist/today`, authHdr()); setToday(r.data?.data || []); } catch {} };
  useEffect(() => { refresh(); }, []);

  return (
    <>
      <Card title="Today's area cleaning logs" color={C.blue} icon="pi-check-square"
        right={canWrite && <PrimaryButton label="Log cleaning" icon="pi-plus" color={C.blue} onClick={() => setShow(true)} />}>
        {today.length === 0 ? (
          <Empty icon="pi-check-square" text="No checklist entries for today yet. Log first cleaning to start." />
        ) : (
          <Table cols={[
            { label: "Area" }, { label: "Shift" }, { label: "Type" }, { label: "Performed by" },
            { label: "Items", align: "right" }, { label: "Done", align: "right" }, { label: "Status" },
          ]}>
            {today.map((r, i) => {
              const total = r.checks?.length || 0;
              const done  = (r.checks || []).filter(c => c.done).length;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{r.area}</td>
                  <td><Badge value={r.shift.toUpperCase()} /></td>
                  <td style={{ fontSize: 12 }}>{r.cleaningType}</td>
                  <td>{r.performedByName}</td>
                  <td style={{ textAlign: "right" }}>{total}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: done === total ? C.green : C.amber }}>{done}/{total}</td>
                  <td><Badge value={r.status.toUpperCase()} /></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {show && <ChecklistLogModal onClose={() => setShow(false)} onDone={() => { setShow(false); refresh(); }} />}
    </>
  );
}

function ChecklistLogModal({ onClose, onDone }) {
  const [defaults, setDefaults] = useState([]);
  const [form, setForm] = useState({ area: "", shift: "morning", cleaningType: "routine", remarks: "", supervisedByName: "", productsRaw: "" });
  const [checks, setChecks] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/housekeeping/checklist/defaults`, authHdr()).then(r => {
      setDefaults(r.data?.data || []);
      setChecks((r.data?.data || []).map(c => ({ ...c })));
    });
  }, []);

  const toggle = (i) => setChecks(chks => chks.map((c, j) => j === i ? { ...c, done: !c.done } : c));

  const submit = async () => {
    if (!form.area) { toast.error("Area required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/housekeeping/checklist`, {
        ...form, checks,
        productsUsed: form.productsRaw.split(",").map(s => s.trim()).filter(Boolean),
      }, authHdr());
      toast.success("Logged");
      onDone();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };

  return (
    <Modal title="Log area cleaning" icon="pi-check-square" color={C.blue} onClose={onClose}
      submitLabel="Save" submitting={saving} onSubmit={submit} size={620}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
        <Field label="Area"><input autoFocus value={form.area} onChange={(e) => setForm(f => ({...f, area: e.target.value}))} placeholder="OT-1 / ICU / Ward-MGW / Lab"
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Shift">
          <select value={form.shift} onChange={(e) => setForm(f => ({...f, shift: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>morning</option><option>afternoon</option><option>night</option>
          </select>
        </Field>
        <Field label="Cleaning type">
          <select value={form.cleaningType} onChange={(e) => setForm(f => ({...f, cleaningType: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>routine</option><option>terminal</option><option>spot</option>
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 12, padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 8, letterSpacing: ".5px" }}>NABH HIC.6 CHECKLIST</div>
        {checks.map((c, i) => (
          <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={c.done} onChange={() => toggle(i)} style={{ width: 16, height: 16, accentColor: C.green }} />
            <span style={{ color: c.done ? C.green : C.text, fontWeight: c.done ? 700 : 400, textDecoration: c.done ? "" : "" }}>{c.item}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <Field label="Products used (comma-sep)"><input value={form.productsRaw} onChange={(e) => setForm(f => ({...f, productsRaw: e.target.value}))}
          placeholder="Phenol, Bleach 10%, Lysol"
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Supervised by"><input value={form.supervisedByName} onChange={(e) => setForm(f => ({...f, supervisedByName: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <Field label="Remarks"><textarea value={form.remarks} onChange={(e) => setForm(f => ({...f, remarks: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   INVENTORY — chemicals + cleaning supplies
══════════════════════════════════════════════════════════════ */
export function InventoryTab() {
  const { can } = useAuth();
  const canWrite = can("house.inventory");
  const [rows, setRows] = useState([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [show, setShow] = useState(false);

  const refresh = async () => { try { const r = await axios.get(`${API}/housekeeping/inventory${lowOnly ? "?lowStock=true" : ""}`, authHdr()); setRows(r.data?.data || []); } catch {} };
  useEffect(() => { refresh(); }, [lowOnly]);

  const receive = async (id) => {
    const qty = prompt("Quantity received?");
    if (!qty) return;
    try { await axios.patch(`${API}/housekeeping/inventory/${id}/receive`, { qty: Number(qty) }, authHdr()); toast.success("Stock updated"); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
  };
  const consume = async (id) => {
    const qty = prompt("Quantity consumed?");
    if (!qty) return;
    try { await axios.patch(`${API}/housekeeping/inventory/${id}/consume`, { qty: Number(qty) }, authHdr()); toast.success("Stock updated"); refresh(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
  };

  return (
    <>
      <Card title="Chemical / supply inventory" color={C.purple} icon="pi-box"
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setLowOnly(v => !v)}
              style={{ padding: "5px 12px", borderRadius: 999, border: `1.5px solid ${lowOnly ? C.red : C.border}`, background: lowOnly ? C.red + "15" : "#fff", color: lowOnly ? C.red : C.muted, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>
              {lowOnly ? "✓ Low stock only" : "Low stock only"}
            </button>
            {canWrite && <PrimaryButton label="Add / edit" icon="pi-plus" color={C.purple} onClick={() => setShow(true)} />}
          </div>
        }>
        {rows.length === 0 ? (
          <Empty icon="pi-box" text="No inventory records yet. Add the first product." />
        ) : (
          <Table cols={[
            { label: "Product" }, { label: "Category" }, { label: "Stock", align: "right" },
            { label: "Reorder at", align: "right" }, { label: "Last received" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => {
              const low = r.currentStock <= r.reorderLevel;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{r.productName}</td>
                  <td><Badge value={r.category} /></td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: low ? C.red : C.text }}>{r.currentStock} {r.unit}</td>
                  <td style={{ textAlign: "right", color: C.muted }}>{r.reorderLevel} {r.unit}</td>
                  <td style={{ fontSize: 11.5, color: C.muted }}>{r.lastReceivedAt ? `${r.lastReceivedQty} on ${new Date(r.lastReceivedAt).toLocaleDateString("en-IN")}` : "—"}</td>
                  <td>
                    {canWrite && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => receive(r._id)} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Receive</button>
                        <button onClick={() => consume(r._id)} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.amber}40`, background: "#fff", color: C.amber, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>- Consume</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {show && <InventoryModal onClose={() => setShow(false)} onDone={() => { setShow(false); refresh(); }} />}
    </>
  );
}

function InventoryModal({ onClose, onDone }) {
  const [form, setForm] = useState({ productName: "", category: "disinfectant", unit: "L", currentStock: "", reorderLevel: 10, vendor: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.productName) { toast.error("Product name required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/housekeeping/inventory`, form, authHdr()); toast.success("Saved"); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Add / edit product" icon="pi-box" color={C.purple} onClose={onClose} submitLabel="Save" submitting={saving} onSubmit={submit}>
      <Field label="Product name (upserts on this key)"><input autoFocus value={form.productName} onChange={(e) => setForm(f => ({...f, productName: e.target.value}))} placeholder="Phenol / Bleach / Lysol / Handwash"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm(f => ({...f, category: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>disinfectant</option><option>detergent</option><option>floor-cleaner</option>
            <option>sanitiser</option><option>bleach</option><option>deodoriser</option><option>other</option>
          </select>
        </Field>
        <Field label="Unit"><input value={form.unit} onChange={(e) => setForm(f => ({...f, unit: e.target.value}))} placeholder="L / kg / piece"
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Reorder level"><input type="number" value={form.reorderLevel} onChange={(e) => setForm(f => ({...f, reorderLevel: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Current stock"><input type="number" value={form.currentStock} onChange={(e) => setForm(f => ({...f, currentStock: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Vendor"><input value={form.vendor} onChange={(e) => setForm(f => ({...f, vendor: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   PEST CONTROL — scheduled treatments + audit
══════════════════════════════════════════════════════════════ */
export function PestTab() {
  const { can } = useAuth();
  const canWrite = can("house.pest");
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [completing, setCompleting] = useState(null);
  const refresh = async () => { try { const r = await axios.get(`${API}/housekeeping/pest`, authHdr()); setRows(r.data?.data || []); } catch {} };
  useEffect(() => { refresh(); }, []);

  return (
    <>
      <Card title="Pest control schedule + audit" color={C.amber} icon="pi-shield"
        right={canWrite && <PrimaryButton label="Schedule treatment" icon="pi-plus" color={C.amber} onClick={() => setShow(true)} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-shield" text="No scheduled treatments." />
        ) : (
          <Table cols={[
            { label: "Scheduled" }, { label: "Area" }, { label: "Type" }, { label: "Vendor" },
            { label: "Status" }, { label: "Performed" }, { label: "Next" }, { label: "Action" },
          ]}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12 }}>{new Date(r.scheduledDate).toLocaleDateString("en-IN")}</td>
                <td style={{ fontWeight: 700 }}>{r.area}</td>
                <td><Badge value={r.treatmentType.toUpperCase()} /></td>
                <td style={{ color: C.muted, fontSize: 11.5 }}>{r.vendor || "—"}</td>
                <td><Badge value={r.status.toUpperCase()} /></td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{r.performedAt ? new Date(r.performedAt).toLocaleDateString("en-IN") : "—"}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{r.nextScheduled ? new Date(r.nextScheduled).toLocaleDateString("en-IN") : "—"}</td>
                <td>
                  {canWrite && (r.status === "scheduled" || r.status === "overdue") && (
                    <button onClick={() => setCompleting(r)} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Complete</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {show && <PestScheduleModal onClose={() => setShow(false)} onDone={() => { setShow(false); refresh(); }} />}
      {completing && <PestCompleteModal pest={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); refresh(); }} />}
    </>
  );
}

function PestScheduleModal({ onClose, onDone }) {
  const [form, setForm] = useState({ scheduledDate: todayISO(), area: "", vendor: "", treatmentType: "general", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.area) { toast.error("Area required"); return; }
    setSaving(true);
    try { await axios.post(`${API}/housekeeping/pest`, form, authHdr()); toast.success("Scheduled"); onDone(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title="Schedule pest control" icon="pi-shield" color={C.amber} onClose={onClose} submitLabel="Schedule" submitting={saving} onSubmit={submit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Date"><input type="date" value={form.scheduledDate} onChange={(e) => setForm(f => ({...f, scheduledDate: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Type">
          <select value={form.treatmentType} onChange={(e) => setForm(f => ({...f, treatmentType: e.target.value}))}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option>general</option><option>cockroach</option><option>rodent</option><option>mosquito</option>
            <option>fumigation</option><option>termite</option><option>other</option>
          </select>
        </Field>
      </div>
      <Field label="Area"><input value={form.area} onChange={(e) => setForm(f => ({...f, area: e.target.value}))} placeholder="Kitchen / Ward-1 / Whole building"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Vendor"><input value={form.vendor} onChange={(e) => setForm(f => ({...f, vendor: e.target.value}))} placeholder="External pest control agency"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}

function PestCompleteModal({ pest, onClose, onDone }) {
  const [form, setForm] = useState({ performedByName: "", productsRaw: "", durationHr: "", nextScheduled: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/housekeeping/pest/${pest._id}/complete`, {
        ...form,
        productsUsed: form.productsRaw.split(",").map(s => s.trim()).filter(Boolean),
      }, authHdr());
      toast.success("Completed"); onDone();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title={`Complete: ${pest.area}`} icon="pi-check" color={C.green} onClose={onClose} submitLabel="Mark Done" submitting={saving} onSubmit={submit}>
      <Field label="Performed by (vendor staff)"><input value={form.performedByName} onChange={(e) => setForm(f => ({...f, performedByName: e.target.value}))}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <Field label="Products used"><input value={form.productsRaw} onChange={(e) => setForm(f => ({...f, productsRaw: e.target.value}))}
        placeholder="Cypermethrin, Imidacloprid"
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <Field label="Duration (hr)"><input type="number" step="0.5" value={form.durationHr} onChange={(e) => setForm(f => ({...f, durationHr: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
        <Field label="Next scheduled"><input type="date" value={form.nextScheduled} onChange={(e) => setForm(f => ({...f, nextScheduled: e.target.value}))}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} /></Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} rows={2}
        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} /></Field>
    </Modal>
  );
}
