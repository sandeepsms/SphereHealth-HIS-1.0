/**
 * ColdChainPage.jsx  (R7bk — sidebar nav coverage)
 *
 * Cold-chain temperature log per WHO PQS E003 + NABH MOM.2.
 *
 *   URL: /cold-chain
 *
 * Layout:
 *   • 3 KPIs (open breaches / readings-24h / fridges)
 *   • "+ Log Reading" button + Active Breaches table with Acknowledge action
 *   • Recent readings table (filterable by fridgeId)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";

const FRIDGE_TYPES = ["FRIDGE", "FREEZER", "ROOM_TEMP"];

const EMPTY_FORM = {
  fridgeId: "",
  fridgeLabel: "",
  fridgeLocation: "",
  fridgeType: "FRIDGE",
  temperatureC: "",
  humidityPct: "",
  incidentNotes: "",
};

export default function ColdChainPage() {
  const { can } = useAuth();
  const [breaches, setBreaches] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fridgeFilter, setFridgeFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAck, setShowAck] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ackNote, setAckNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, h] = await Promise.all([
        axios.get(`${API}/cold-chain/breaches`, authHdr()),
        fridgeFilter
          ? axios.get(`${API}/cold-chain/fridge/${encodeURIComponent(fridgeFilter)}`, authHdr())
          : Promise.resolve({ data: { data: [] } }),
      ]);
      setBreaches(b.data?.data || []);
      setHistory(h.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load cold-chain data");
    }
    setLoading(false);
  }, [fridgeFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const kpis = useMemo(() => ({
    open: breaches.length,
    fridges: new Set([...breaches, ...history].map(r => r.fridgeId)).size,
    readings: history.length,
  }), [breaches, history]);

  const log = async () => {
    if (!form.fridgeId.trim() || form.temperatureC === "" || isNaN(Number(form.temperatureC))) {
      toast.warn("fridgeId + temperatureC required"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        temperatureC: Number(form.temperatureC),
        humidityPct: form.humidityPct === "" ? null : Number(form.humidityPct),
      };
      await axios.post(`${API}/cold-chain/log`, payload, authHdr());
      toast.success("Reading logged");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchAll();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to log");
    }
    setSaving(false);
  };

  const ack = async () => {
    if (!ackNote.trim()) { toast.warn("Corrective action required"); return; }
    setSaving(true);
    try {
      await axios.put(`${API}/cold-chain/breach/${showAck._id}/acknowledge`,
        { correctiveAction: ackNote.trim() }, authHdr());
      toast.success("Breach acknowledged");
      setShowAck(null); setAckNote("");
      fetchAll();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to acknowledge");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-bolt" color="blue"
        title="Cold Chain Log"
        subtitle="NABH MOM.2 / WHO PQS E003 — fridge/freezer temperature with auto-breach detection." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open Breaches" value={kpis.open} color={C.red}   icon="pi-exclamation-triangle" />
        <KPI label="Fridges"        value={kpis.fridges} color={C.blue} icon="pi-server" />
        <KPI label="Readings (filtered)" value={kpis.readings} color={C.green} icon="pi-list" />
      </div>

      <Card title="Active Breaches (unacknowledged)" icon="pi-exclamation-circle">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <SearchInput value={fridgeFilter} onChange={setFridgeFilter} placeholder="Filter by fridgeId (e.g. PHM-VAC-01)" />
          {can("pharmacy.cold-chain.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ Log Reading</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading...</div> : breaches.length === 0 ? <Empty msg="No open breaches" /> : (
          <Table
            headers={["Recorded", "Fridge", "Temp", "Range", "Notes", ""]}
            rows={breaches.map(r => [
              fmtDT(r.recordedAt),
              `${r.fridgeId} (${r.fridgeType})`,
              <Badge tone="red">{r.temperatureC}°C</Badge>,
              r.fridgeType === "FRIDGE" ? "2-8°C" : r.fridgeType === "FREEZER" ? "-25 to -20°C" : "15-25°C",
              r.incidentNotes || "—",
              can("pharmacy.cold-chain.write") ? (
                <PrimaryButton small onClick={() => setShowAck(r)}>Acknowledge</PrimaryButton>
              ) : null,
            ])}
          />
        )}
      </Card>

      {fridgeFilter && history.length > 0 && (
        <Card title={`Recent readings — ${fridgeFilter}`} icon="pi-history">
          <Table
            headers={["Time", "Temp", "Humidity", "In Range", "Recorded By"]}
            rows={history.slice(0, 30).map(r => [
              fmtDT(r.recordedAt),
              `${r.temperatureC}°C`,
              r.humidityPct != null ? `${r.humidityPct}%` : "—",
              r.inRange ? <Badge tone="green">OK</Badge> : <Badge tone="red">OUT</Badge>,
              r.recordedByName || "—",
            ])}
          />
        </Card>
      )}

      {showCreate && (
        <Modal title="Log Temperature Reading" onClose={() => setShowCreate(false)} size="md">
          <Field label="Fridge ID" required>
            <input value={form.fridgeId} onChange={e => setForm({...form, fridgeId: e.target.value})}
              placeholder="e.g. PHM-VAC-01" />
          </Field>
          <Field label="Label">
            <input value={form.fridgeLabel} onChange={e => setForm({...form, fridgeLabel: e.target.value})}
              placeholder="e.g. Vaccine Fridge A" />
          </Field>
          <Field label="Location">
            <input value={form.fridgeLocation} onChange={e => setForm({...form, fridgeLocation: e.target.value})} />
          </Field>
          <Field label="Type" required>
            <select value={form.fridgeType} onChange={e => setForm({...form, fridgeType: e.target.value})}>
              {FRIDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Temperature (°C)" required>
            <input type="number" step="0.1" value={form.temperatureC}
              onChange={e => setForm({...form, temperatureC: e.target.value})} />
          </Field>
          <Field label="Humidity (%)">
            <input type="number" step="1" min="0" max="100" value={form.humidityPct}
              onChange={e => setForm({...form, humidityPct: e.target.value})} />
          </Field>
          <Field label="Notes (required if breach)">
            <textarea rows={2} value={form.incidentNotes}
              onChange={e => setForm({...form, incidentNotes: e.target.value})} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <PrimaryButton onClick={log} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
          </div>
        </Modal>
      )}

      {showAck && (
        <Modal title="Acknowledge Breach" onClose={() => setShowAck(null)} size="sm">
          <div style={{ marginBottom: 10, fontSize: 13 }}>
            Fridge <b>{showAck.fridgeId}</b> at <b>{showAck.temperatureC}°C</b> — {fmtDT(showAck.recordedAt)}
          </div>
          <Field label="Corrective Action" required>
            <textarea rows={3} value={ackNote} onChange={e => setAckNote(e.target.value)}
              placeholder="e.g. Fridge door closed, temperature restored within 15 min." />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <PrimaryButton onClick={ack} disabled={saving}>{saving ? "Saving…" : "Acknowledge"}</PrimaryButton>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
