/**
 * HospitalChargesList.jsx — admin page for TPA / insurance charge sheets.
 *
 * Redesigned to the latest theme: purple hero band, KPI strip, primary
 * card with search + status filter + add button + table, and a
 * full-screen view-details modal rendered with theme primitives.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { hospitalChargesService } from "../../Services/charges/hospitalChargesService";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, RowAction, Badge,
  Modal, Field, SearchInput, PrimaryButton, C,
} from "../../Components/admin-theme";
import { confirm } from "../../Components/common/ConfirmDialog";
import { useAuth } from "../../context/AuthContext";

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const HospitalChargesList = () => {
  const navigate = useNavigate();
  // R7bb-E/D5-HIGH-3 — Receptionist + Accountant + TPA Coord can READ
  // tariff sheets (billing.read), but only Admin (departments.write)
  // may add/edit/toggle/delete. Hide the action affordances so
  // viewers don't see CTAs the backend would 403 on.
  const { can } = useAuth();
  const canMutate = typeof can === "function" ? can("departments.write") : false;
  const [rows, setRows]    = useState([]);
  const [q, setQ]          = useState("");
  const [statusF, setStatusF] = useState("all"); // all | active | inactive
  const [loading, setLoad] = useState(false);
  const [view, setView]    = useState(null);     // charge sheet being viewed

  useEffect(() => { load(); }, [q, statusF]);
  const load = async () => {
    try {
      setLoad(true);
      const filters = {};
      if (q.trim())       filters.search = q.trim();
      if (statusF !== "all") filters.isActive = statusF === "active";
      const data = await hospitalChargesService.getAllHospitalCharges(filters);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { toast.error("Failed to load hospital charges"); }
    finally { setLoad(false); }
  };

  const kpis = useMemo(() => {
    const active = rows.filter(r => r.isActive).length;
    const totalLines = rows.reduce((s, r) => s + (r.charges?.length || 0), 0);
    const totalValue = rows.reduce((s, r) => s + (r.charges || []).reduce((ss, c) => ss + Number(c.totalAmount || c.amount || 0), 0), 0);
    return { sheets: rows.length, active, lines: totalLines, value: totalValue };
  }, [rows]);

  const toggle = async (id) => {
    try {
      await hospitalChargesService.toggleActiveStatus(id);
      toast.success("Status updated");
      load();
    } catch (e) { toast.error("Failed to update status"); }
  };

  const remove = async (id, name) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Delete charge sheet?",
      body: `This will permanently remove the "${name}" charge sheet and all its line items. This cannot be undone.`,
      danger: true,
      confirmLabel: "Delete",
    }))) return;
    try {
      await hospitalChargesService.deleteHospitalCharges(id);
      toast.success("Charge sheet deleted");
      load();
    } catch (e) { toast.error("Failed to delete"); }
  };

  return (
    <AdminPage>
      <Hero icon="pi-shield" color="purple"
        title="Hospital Charges"
        subtitle="TPA / insurance tariff sheets — drives cashless billing rates" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Charge Sheets"   value={kpis.sheets} color={C.purple} icon="pi-shield" />
        <KPI label="Active"          value={kpis.active} color={C.green}  icon="pi-check-circle" />
        <KPI label="Total Charges"   value={kpis.lines}  color={C.blue}   icon="pi-list" />
        <KPI label="Total Value"     value={fmtINR(kpis.value)} color={C.amber} icon="pi-money-bill" />
      </div>

      <Card title="All Charge Sheets" color={C.purple} icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SearchInput value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search by TPA name or code…" width={260} />
            <select className="his-field" value={statusF} onChange={e => setStatusF(e.target.value)}
              style={{ width: 130, padding: "7px 10px", fontSize: 12, fontWeight: 700 }}>
              <option value="all">All status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            {/* R7bb-E/D5-HIGH-3 — Add gated by departments.write. */}
            {canMutate && (
              <PrimaryButton icon="pi-plus" label="Add Charge Sheet" color={C.purple}
                onClick={() => navigate("/hospital-charges/create")} />
            )}
          </div>
        }
        padding={0}>
        <Table cols={["TPA Name", "TPA Code", "Charges", "Total Value", "Status", "Action"]}>
          {loading
            ? <EmptyRow span={6} text="Loading…" />
            : rows.length === 0
              ? <EmptyRow span={6} text={q || statusF !== "all" ? "No charge sheets match these filters" : "No charge sheets yet — click Add Charge Sheet to create one."} />
              : rows.map((r, i) => {
                const sheetTotal = (r.charges || []).reduce((s, c) => s + Number(c.totalAmount || c.amount || 0), 0);
                return (
                  <tr key={r._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ fontWeight: 700 }}>{r.tpaName}</div>
                    </td>
                    <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>{r.tpaCode || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ fontWeight: 700 }}>{r.charges?.length || 0}</span>
                      <span style={{ color: C.muted, fontSize: 10.5, marginLeft: 4 }}>charge{r.charges?.length === 1 ? "" : "s"}</span>
                    </td>
                    <td style={{ padding: "9px 12px", fontWeight: 700, color: C.green }}>{fmtINR(sheetTotal)}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <Badge value={r.isActive ? "Active" : "Inactive"} palette={r.isActive ? "active" : "inactive"} />
                    </td>
                    <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                      {/* View is read-only, always visible. Mutations gated. */}
                      <RowAction icon="pi-eye"    label="View"   color={C.green}  onClick={() => setView(r)} />
                      {canMutate && (
                        <>
                          <RowAction icon="pi-pencil" label="Edit"   color={C.blue}   onClick={() => navigate(`/hospital-charges/edit/${r._id}`)} />
                          <RowAction icon={r.isActive ? "pi-ban" : "pi-check"}
                            label={r.isActive ? "Off" : "On"}
                            color={C.amber}
                            onClick={() => toggle(r._id)} />
                          <RowAction icon="pi-trash"  label="Delete" color={C.red}    onClick={() => remove(r._id, r.tpaName)} />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
        </Table>
      </Card>

      {view && (
        <Modal
          title={`${view.tpaName} · ${view.tpaCode || ""}`}
          icon="pi-shield"
          color={C.purple}
          onClose={() => setView(null)}
          hideFooter
          size={1100}
        >
          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 14 }}>
            <SummaryStat label="TPA Name"      value={view.tpaName} />
            <SummaryStat label="TPA Code"      value={view.tpaCode || "—"} mono />
            <SummaryStat label="Total Charges" value={`${view.charges?.length || 0}`} />
            <SummaryStat label="Status"        value={<Badge value={view.isActive ? "Active" : "Inactive"} palette={view.isActive ? "active" : "inactive"} />} />
          </div>

          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>
            Charges list <span style={{ color: C.muted, fontWeight: 600, fontSize: 11 }}>({view.charges?.length || 0})</span>
          </div>

          {(view.charges && view.charges.length > 0) ? (
            <Table cols={["#", "Charge name", "Type", "Amount", "Discount", "Per Unit", "Total"]} compact>
              {view.charges.map((c, idx) => (
                <tr key={idx} style={{ borderTop: `1px solid ${C.border}`, background: idx % 2 ? "#fafbfc" : "#fff" }}>
                  <td style={{ padding: "6px 10px", color: C.muted, fontFamily: "DM Mono, monospace" }}>{idx + 1}</td>
                  <td style={{ padding: "6px 10px", fontWeight: 700 }}>{c.chargeName}</td>
                  <td style={{ padding: "6px 10px" }}><Badge value={c.chargeType || "—"} palette="opd" /></td>
                  <td style={{ padding: "6px 10px", fontWeight: 700 }}>{fmtINR(c.amount)}</td>
                  <td style={{ padding: "6px 10px", color: C.red, fontWeight: 700 }}>{c.discount || 0}%</td>
                  <td style={{ padding: "6px 10px" }}><Badge value={c.perUnit || "—"} palette="ipd" /></td>
                  <td style={{ padding: "6px 10px", fontWeight: 800, color: C.purple, fontSize: 13 }}>{fmtINR(c.totalAmount)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <div style={{ padding: "30px 16px", textAlign: "center", background: C.subtle, border: `1.5px dashed ${C.border}`, borderRadius: 9, color: C.muted }}>
              <i className="pi pi-inbox" style={{ fontSize: 36, marginBottom: 8, display: "block" }} />
              No charges defined on this sheet yet.
            </div>
          )}
        </Modal>
      )}
    </AdminPage>
  );
};

function SummaryStat({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: mono ? "DM Mono, monospace" : undefined }}>{value}</div>
    </div>
  );
}

export default HospitalChargesList;
