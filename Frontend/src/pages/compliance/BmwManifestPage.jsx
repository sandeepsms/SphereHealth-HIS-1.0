/**
 * BmwManifestPage.jsx  (R7bk — sidebar nav coverage)
 *
 * Bio-Medical Waste transport manifest (BMW Rules 2016 Form-IV).
 *
 *   URL: /bmw-manifest
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
  d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short" }) : "—";

const BAG_COLORS = ["YELLOW", "RED", "BLUE", "WHITE", "BLACK", "CYTOTOXIC"];
const CATEGORIES = ["INFECTIOUS", "ANATOMICAL", "SHARPS", "CHEMICAL", "CYTOTOXIC", "GENERAL"];

const EMPTY_BAG = { barcode: "", bagColor: "YELLOW", category: "INFECTIOUS", weight_kg: "", fromWard: "" };
const EMPTY_FORM = {
  cbwtfName: "",
  cbwtfLicenceNumber: "",
  vehicleNumber: "",
  driverName: "",
  driverPhone: "",
  bags: [{ ...EMPTY_BAG }],
};

export default function BmwManifestPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/bmw-manifest`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const kpis = useMemo(() => ({
    total: rows.length,
    pendingPcb: rows.filter(r => !r.pcbReturnFiled).length,
    totalBags: rows.reduce((s, r) => s + (r.totalBags || 0), 0),
  }), [rows]);

  const addBag = () => setForm({ ...form, bags: [...form.bags, { ...EMPTY_BAG }] });
  const setBag = (i, k, v) => {
    const bags = [...form.bags];
    bags[i] = { ...bags[i], [k]: v };
    setForm({ ...form, bags });
  };
  const removeBag = (i) => setForm({ ...form, bags: form.bags.filter((_, j) => j !== i) });

  const create = async () => {
    if (!form.cbwtfName.trim() || form.bags.length === 0) {
      toast.warn("CBWTF name + at least one bag required"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        bags: form.bags.map(b => ({ ...b, weight_kg: Number(b.weight_kg) || 0 })),
      };
      await axios.post(`${API}/bmw-manifest`, payload, authHdr());
      toast.success("Manifest created");
      setShowCreate(false); setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to create");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-truck" color="green"
        title="BMW Transport Manifest"
        subtitle="BMW Rules 2016 Form-IV — barcoded bags handed over to CBWTF + monthly PCB return." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total Manifests" value={kpis.total} color={C.blue} icon="pi-list" />
        <KPI label="Pending PCB" value={kpis.pendingPcb} color={C.amber} icon="pi-clock" />
        <KPI label="Bags Tracked" value={kpis.totalBags} color={C.green} icon="pi-box" />
      </div>

      <Card title="Manifest Register" icon="pi-table">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {can("compliance.bmw.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ New Manifest</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading…</div> : rows.length === 0 ? <Empty msg="No manifests yet." /> : (
          <Table
            headers={["#", "Date", "CBWTF", "Vehicle", "Bags", "Weight (kg)", "PCB Filed"]}
            rows={rows.map(r => [
              r.manifestNumber || "—",
              fmtDT(r.manifestDate || r.createdAt),
              r.cbwtfName || "—",
              r.vehicleNumber || "—",
              r.totalBags || (r.bags?.length || 0),
              r.totalWeight_kg || "—",
              r.pcbReturnFiled ? <Badge tone="green">YES</Badge> : <Badge tone="amber">No</Badge>,
            ])}
          />
        )}
      </Card>

      {showCreate && (
        <Modal title="New BMW Manifest" onClose={() => setShowCreate(false)} size="lg">
          <Field label="CBWTF Name" required>
            <input value={form.cbwtfName} onChange={e => setForm({...form, cbwtfName: e.target.value})} />
          </Field>
          <Field label="CBWTF Licence #">
            <input value={form.cbwtfLicenceNumber} onChange={e => setForm({...form, cbwtfLicenceNumber: e.target.value})} />
          </Field>
          <Field label="Vehicle #">
            <input value={form.vehicleNumber} onChange={e => setForm({...form, vehicleNumber: e.target.value})} />
          </Field>
          <Field label="Driver">
            <input value={form.driverName} onChange={e => setForm({...form, driverName: e.target.value})} />
          </Field>
          <Field label="Driver Phone">
            <input value={form.driverPhone} onChange={e => setForm({...form, driverPhone: e.target.value})} />
          </Field>
          <div style={{ marginTop: 12, marginBottom: 6, fontWeight: 600 }}>Bags ({form.bags.length})</div>
          {form.bags.map((b, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.2fr 0.8fr 1fr 30px", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input placeholder="Barcode" value={b.barcode} onChange={e => setBag(i, "barcode", e.target.value)} />
              <select value={b.bagColor} onChange={e => setBag(i, "bagColor", e.target.value)}>
                {BAG_COLORS.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={b.category} onChange={e => setBag(i, "category", e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <input type="number" step="0.1" placeholder="kg" value={b.weight_kg} onChange={e => setBag(i, "weight_kg", e.target.value)} />
              <input placeholder="From ward" value={b.fromWard} onChange={e => setBag(i, "fromWard", e.target.value)} />
              <button onClick={() => removeBag(i)} style={{ background: "#fee", color: "#b00", border: "1px solid #fbb", borderRadius: 4 }}>×</button>
            </div>
          ))}
          <button onClick={addBag} style={{ marginTop: 6, padding: "4px 12px" }}>+ Add Bag</button>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <PrimaryButton onClick={create} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
