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
// R7hr(BMW-FIX): Form-IV print — the printable reads the manifest doc's
// schema fields directly, so the row passes through as the payload.
import { openPrint } from "../../Components/print/openPrint";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short" }) : "—";

const BAG_COLORS = ["YELLOW", "RED", "BLUE", "WHITE", "BLACK", "CYTOTOXIC"];
const CATEGORIES = ["INFECTIOUS", "ANATOMICAL", "SHARPS", "CHEMICAL", "CYTOTOXIC", "GENERAL"];

// R7bm-F7 — `_rid` is a stable per-row id used as the React key.
// Form rows are user-editable (barcode can be empty during typing) so
// index keys cause field-blur focus loss when rows are added / removed
// mid-edit. The id is local-only and stripped before POST.
let _rowSeq = 0;
const _nextRowId = () => `bagrow-${Date.now().toString(36)}-${(++_rowSeq).toString(36)}`;
const makeBag = (overrides = {}) => ({
  _rid: _nextRowId(),
  barcode: "",
  bagColor: "YELLOW",
  category: "INFECTIOUS",
  weight_kg: "",
  fromWard: "",
  ...overrides,
});
const EMPTY_FORM = {
  cbwtfName: "",
  cbwtfLicenceNumber: "",
  vehicleNumber: "",
  driverName: "",
  driverPhone: "",
  bags: [makeBag()],
};

export default function BmwManifestPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // R7bm-F7 — AbortController-aware fetch so that an in-flight load
  // doesn't toast or setState into an unmounted page (the lifecycle was
  // missing in R7bl, which caused a memory-leak warning during heavy
  // tab-switching on the compliance dashboard).
  const fetchList = useCallback(async (signal) => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/bmw-manifest`, { ...authHdr(), signal });
      if (signal?.aborted) return;
      setRows(r.data?.data || []);
    } catch (e) {
      if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || signal?.aborted) return;
      toast.error(e?.response?.data?.message || "Failed to load");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchList(ac.signal);
    // Cancel in-flight requests on unmount. State resets are not safe
    // post-unmount (React 18 warns); the modal + form state are tied
    // to this component instance so they tear down naturally with it.
    return () => ac.abort();
  }, [fetchList]);

  const kpis = useMemo(() => ({
    total: rows.length,
    pendingPcb: rows.filter(r => !r.pcbReturnFiled).length,
    totalBags: rows.reduce((s, r) => s + (r.totalBags || 0), 0),
    // R7bm-F7 — Total weight is the headline figure on the BMW Form-IV
    // annual return; KPI card surfaces it alongside the other tallies.
    totalWeight: rows.reduce((s, r) => s + Number(r.totalWeight_kg || 0), 0),
  }), [rows]);

  const addBag = () => setForm({ ...form, bags: [...form.bags, makeBag()] });
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
        // Strip the local-only `_rid` React-key field before POST so the
        // backend doesn't have to ignore it.
        bags: form.bags.map(({ _rid, ...b }) => ({ ...b, weight_kg: Number(b.weight_kg) || 0 })),
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
        {/* R7bm-F7 — Form-IV annual-return figure; red tone signals
            "this is the regulator-reported number" so it can't go
            unnoticed during the monthly close. */}
        <KPI label="Total Weight (kg)" value={kpis.totalWeight.toFixed(2)} color={C.red} icon="pi-database" />
      </div>

      <Card title="Manifest Register" icon="pi-table">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {can("compliance.bmw.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ New Manifest</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading…</div> : rows.length === 0 ? <Empty msg="No manifests yet." /> : (
          <Table
            headers={["#", "Date", "CBWTF", "Vehicle", "Bags", "Weight (kg)", "PCB Filed", ""]}
            rows={rows.map(r => [
              r.manifestNumber || "—",
              fmtDT(r.manifestDate || r.createdAt),
              r.cbwtfName || "—",
              r.vehicleNumber || "—",
              r.totalBags || (r.bags?.length || 0),
              r.totalWeight_kg || "—",
              r.pcbReturnFiled ? <Badge tone="green">YES</Badge> : <Badge tone="amber">No</Badge>,
              <button key="print" onClick={() => openPrint("bmw-manifest", r)}
                title="Print Form-IV manifest"
                style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: 12 }}>
                🖨
              </button>,
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
            <div key={b._rid || `bag-${i}`} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.2fr 0.8fr 1fr 30px", gap: 6, marginBottom: 6, alignItems: "center" }}>
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
