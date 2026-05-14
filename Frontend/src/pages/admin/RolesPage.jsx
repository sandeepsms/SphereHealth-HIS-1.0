/**
 * RolesPage.jsx — admin overview of every role + what they can access.
 *
 * Helps admins answer questions like:
 *   - "What does a Receptionist see when they log in?"
 *   - "Which roles can issue refunds?"
 *   - "Who has access to pharmacy dispense?"
 *
 * Two views:
 *   1. Grid view (default) — every role as a card with the modules they
 *      access, action count, and a "View permissions" button.
 *   2. Matrix view — full role × module matrix with checkmarks, for
 *      side-by-side comparison.
 */
import React, { useState, useMemo } from "react";
import {
  AdminPage, Hero, KPI, Card, Badge, Modal, TabStrip, C,
} from "../../Components/admin-theme";
import {
  ROLES, MODULES, MODULE_ROLES, ACTIONS,
  modulesForRole, actionsForRole, roleSeesModule,
} from "../../config/permissions";

const VIEW_TABS = [
  { key: "grid",   label: "Role cards",      icon: "pi-th-large" },
  { key: "matrix", label: "Access matrix",   icon: "pi-table" },
  { key: "actions",label: "Action catalogue",icon: "pi-list" },
];

export default function RolesPage() {
  const [view, setView] = useState("grid");
  const [zoom, setZoom] = useState(null); // role being inspected

  const kpis = useMemo(() => ({
    roles: ROLES.length,
    modules: MODULES.length,
    actions: Object.keys(ACTIONS).length,
    avgModulesPerRole: Math.round(ROLES.reduce((s, r) => s + modulesForRole(r.key).length, 0) / ROLES.length),
  }), []);

  return (
    <AdminPage>
      <Hero icon="pi-shield" color="purple"
        title="Roles & Permissions"
        subtitle="What every role can see and do · single source of truth for sidebar, route guards, and action gates" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Defined roles"      value={kpis.roles}             color={C.purple} icon="pi-shield" />
        <KPI label="Top-level modules"  value={kpis.modules}           color={C.blue}   icon="pi-th-large" />
        <KPI label="Fine-grained actions" value={kpis.actions}          color={C.amber}  icon="pi-list" />
        <KPI label="Avg modules / role" value={kpis.avgModulesPerRole} color={C.green}  icon="pi-chart-line" />
      </div>

      <TabStrip tabs={VIEW_TABS} value={view} onChange={setView} accent={C.purple} accentL={C.purpleL} />

      {view === "grid"    && <RoleGrid onInspect={setZoom} />}
      {view === "matrix"  && <RoleMatrix />}
      {view === "actions" && <ActionsCatalogue />}

      {zoom && <RoleDetailModal role={zoom} onClose={() => setZoom(null)} />}
    </AdminPage>
  );
}

/* ════════════════════════════════════════════════════════════════
   GRID VIEW — one card per role
══════════════════════════════════════════════════════════════════ */
function RoleGrid({ onInspect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
      {ROLES.map(r => {
        const mods = modulesForRole(r.key);
        const acts = actionsForRole(r.key);
        return (
          <div key={r.key} style={{
            background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
            overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)", display: "flex", flexDirection: "column",
          }}>
            {/* Header */}
            <div style={{ padding: "12px 14px", background: r.light, borderBottom: `1px solid ${r.color}20`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: r.color + "18", border: `1.5px solid ${r.color}30`,
                color: r.color, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`pi ${r.icon}`} style={{ fontSize: 17 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: r.color }}>{r.label}</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "DM Mono, monospace", marginTop: 1 }}>{r.key}</div>
              </div>
            </div>

            <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>{r.desc}</div>

              <div style={{ display: "flex", gap: 8 }}>
                <ModuleCount label="Modules" value={mods.length} color={r.color} />
                <ModuleCount label="Actions" value={acts.length} color={r.color} />
              </div>

              <div>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                  Accessible modules
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {mods.length === 0
                    ? <span style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>No module access — likely a support role.</span>
                    : mods.slice(0, 6).map(m => (
                      <span key={m.id} style={{
                        padding: "2px 9px", borderRadius: 4,
                        background: m.color + "12", color: m.color, border: `1px solid ${m.color}30`,
                        fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                        <i className={`pi ${m.icon}`} style={{ fontSize: 9 }} />
                        {m.label}
                      </span>
                    ))}
                  {mods.length > 6 && (
                    <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>+{mods.length - 6} more</span>
                  )}
                </div>
              </div>
            </div>

            <button onClick={() => onInspect(r)}
              style={{
                padding: "9px 14px", border: "none",
                background: r.color, color: "#fff",
                fontWeight: 800, fontSize: 12, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
              View all permissions
              <i className="pi pi-arrow-right" style={{ fontSize: 11 }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ModuleCount({ label, value, color }) {
  return (
    <div style={{ flex: 1, padding: "7px 10px", background: color + "08", border: `1px solid ${color}20`, borderRadius: 7 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MATRIX VIEW — role × module grid with checkmarks
══════════════════════════════════════════════════════════════════ */
function RoleMatrix() {
  return (
    <Card title="Access matrix · Roles × Modules" color={C.blue} icon="pi-table" padding={0}>
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
              <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: ".5px", textTransform: "uppercase", whiteSpace: "nowrap", borderRight: `1.5px solid ${C.border}`, position: "sticky", left: 0, background: C.subtle, zIndex: 1 }}>
                Role
              </th>
              {MODULES.map(m => (
                <th key={m.id} style={{ padding: "9px 6px", textAlign: "center", fontSize: 9.5, fontWeight: 800, color: m.color, letterSpacing: ".3px", textTransform: "uppercase", minWidth: 86 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <i className={`pi ${m.icon}`} style={{ fontSize: 13 }} />
                    {m.label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r, i) => (
              <tr key={r.key} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "9px 12px", borderRight: `1.5px solid ${C.border}`, position: "sticky", left: 0, background: i % 2 ? "#fafbfc" : "#fff", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: r.color + "18", color: r.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className={`pi ${r.icon}`} style={{ fontSize: 11 }} />
                    </div>
                    <span style={{ fontWeight: 700, color: r.color }}>{r.label}</span>
                  </div>
                </td>
                {MODULES.map(m => {
                  const ok = roleSeesModule(r.key, m.id);
                  return (
                    <td key={m.id} style={{ padding: "9px 6px", textAlign: "center" }}>
                      {ok
                        ? <i className="pi pi-check-circle" style={{ color: m.color, fontSize: 14 }} title="Access" />
                        : <i className="pi pi-minus" style={{ color: "#cbd5e1", fontSize: 12 }} title="No access" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   ACTIONS CATALOGUE — every fine-grained action with allowed roles
══════════════════════════════════════════════════════════════════ */
function ActionsCatalogue() {
  // Group by namespace before the dot.
  const grouped = useMemo(() => {
    const g = {};
    for (const [action, roles] of Object.entries(ACTIONS)) {
      const [ns] = action.split(".");
      (g[ns] ||= []).push({ action, roles });
    }
    return g;
  }, []);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {Object.entries(grouped).map(([ns, items]) => (
        <Card key={ns} title={ns.charAt(0).toUpperCase() + ns.slice(1)} color={C.amber} icon="pi-list" padding={0}>
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: ".5px", textTransform: "uppercase", width: 220 }}>Action</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: ".5px", textTransform: "uppercase" }}>Allowed roles</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ action, roles }, idx) => (
                  <tr key={action} style={{ borderTop: `1px solid ${C.border}`, background: idx % 2 ? "#fafbfc" : "#fff" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "DM Mono, monospace", fontWeight: 700, color: C.text }}>{action}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {roles.map(rkey => {
                          const meta = ROLES.find(r => r.key === rkey) || { color: C.slate, light: C.subtle, label: rkey };
                          return (
                            <span key={rkey} style={{
                              padding: "2px 8px", borderRadius: 4,
                              background: meta.light, color: meta.color, border: `1px solid ${meta.color}30`,
                              fontSize: 10, fontWeight: 700,
                            }}>{meta.label}</span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ROLE DETAIL MODAL — full breakdown of one role
══════════════════════════════════════════════════════════════════ */
function RoleDetailModal({ role, onClose }) {
  const mods = modulesForRole(role.key);
  const acts = actionsForRole(role.key);
  const inaccessible = MODULES.filter(m => !mods.find(x => x.id === m.id));
  return (
    <Modal title={role.label} icon={role.icon} color={role.color} onClose={onClose} hideFooter size={780}>
      <div style={{ padding: "10px 12px", background: role.light, border: `1.5px solid ${role.color}30`, borderRadius: 8, fontSize: 12, color: role.color, marginBottom: 14 }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        {role.desc}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <Card title="Accessible modules" color={role.color} icon="pi-th-large" padding={12}>
          {mods.length === 0
            ? <div style={{ color: C.muted, fontSize: 12, fontStyle: "italic" }}>No top-level modules. Likely a support role accessed through other workflows.</div>
            : mods.map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px dashed ${C.border}` }}>
                <i className={`pi ${m.icon}`} style={{ color: m.color, fontSize: 12, width: 16, textAlign: "center" }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 12 }}>{m.label}</span>
                <code style={{ fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace" }}>{m.home}</code>
              </div>
            ))}
        </Card>

        <Card title={`Restricted (${inaccessible.length})`} color={C.muted} icon="pi-lock" padding={12}>
          {inaccessible.length === 0
            ? <div style={{ color: C.green, fontSize: 12, fontWeight: 700 }}>Full module access.</div>
            : inaccessible.map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px dashed ${C.border}`, opacity: 0.55 }}>
                <i className={`pi ${m.icon}`} style={{ fontSize: 12, width: 16, textAlign: "center" }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 12 }}>{m.label}</span>
              </div>
            ))}
        </Card>
      </div>

      <Card title={`Actions allowed (${acts.length})`} color={C.amber} icon="pi-key" padding={12}>
        {acts.length === 0
          ? <div style={{ color: C.muted, fontSize: 12, fontStyle: "italic" }}>No fine-grained actions.</div>
          : <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {acts.map(a => (
              <code key={a} style={{ padding: "3px 9px", borderRadius: 4, background: C.amberL, color: "#92400e", border: `1px solid ${C.amber}30`, fontSize: 10.5, fontWeight: 700, fontFamily: "DM Mono, monospace" }}>{a}</code>
            ))}
          </div>}
      </Card>
    </Modal>
  );
}
