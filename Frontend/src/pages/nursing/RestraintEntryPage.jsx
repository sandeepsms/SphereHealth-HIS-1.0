/**
 * RestraintEntryPage.jsx — R7du / NABH COP.17
 *
 * Nurse-driven restraint episode entry. POSTs to /api/restraints which
 * calls emitRestraint() inside the backend. Doctor enters the restraint
 * order as plain text in nursing communication; the bedside nurse fills
 * this structured form to populate the COP.17 register.
 *
 * Auto-loads patient via UHID search (mirrors CapriniDVTAssessmentPage).
 * The page surfaces:
 *   1. Order header — orderingDoctor name + datetime
 *   2. Restraint classification — type radio + device checkboxes +
 *      chemical agent (conditional)
 *   3. Indication — reason free-text + reasonCategory dropdown
 *   4. Timing + monitoring frequency
 *   5. Alternatives tried (multi-checkbox — NABH evidence of least-
 *      restrictive measure)
 *   6. Consent (where capacity exists)
 *   7. Active restraints list — Mark Removed button → modal
 *   8. Last-10 history
 *
 * URL: /nursing/restraints  (and /nursing/restraints/:uhid)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useParams } from "react-router-dom";
import {
  AdminPage, Hero, Card, SubCard, Check, Field, PrimaryButton, Badge, Table, EmptyRow, Modal, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

// ─── Catalogues ──────────────────────────────────────────────────────
const RESTRAINT_TYPES = [
  { value: "physical", label: "Physical" },
  { value: "chemical", label: "Chemical" },
  { value: "both",     label: "Both" },
];

const PHYSICAL_DEVICES = [
  { code: "wrist-soft",  label: "Wrist — soft (cloth/foam)" },
  { code: "wrist-hard",  label: "Wrist — hard (leather/locked)" },
  { code: "ankle",       label: "Ankle restraint" },
  { code: "torso",       label: "Torso / vest restraint" },
  { code: "mittens",     label: "Mittens (no-finger-grip)" },
  { code: "bedrails",    label: "4-side bed-rails" },
  { code: "lap-belt",    label: "Lap belt / pelvic restraint" },
];

const REASON_CATEGORIES = [
  { value: "Safety",       label: "Safety — risk of self/others harm" },
  { value: "Medical",      label: "Medical — line/tube protection" },
  { value: "Behavioural",  label: "Behavioural — severe agitation" },
  { value: "PostOp",       label: "Post-op — emergence delirium" },
  { value: "Procedural",   label: "Procedural — short-term during procedure" },
];

const MONITORING_FREQS = [
  { value: "q15min", label: "q15 min (chemical / acute)" },
  { value: "q30min", label: "q30 min (physical — standard)" },
  { value: "q1h",    label: "q1 hour" },
  { value: "q2h",    label: "q2 hours" },
];

const ALTERNATIVES = [
  "Verbal de-escalation",
  "Family presence at bedside",
  "Environmental modification (lighting, noise)",
  "Distraction (TV / music / activity)",
  "Redirection / reorientation",
  "1:1 sitter / bedside attendant",
  "Pain control reassessed",
  "Toileting / hydration offered",
];

const REMOVAL_REASONS = [
  "No longer indicated — patient calm",
  "Condition resolved",
  "Family/caregiver took over supervision",
  "Adverse event — restraint removed",
  "Doctor order to discontinue",
];

// ─── Helpers ────────────────────────────────────────────────────────
const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const nowLocalDatetime = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const STATUS_TONE = { Active: "red", Removed: "ok", Expired: "muted" };

// ─── Component ──────────────────────────────────────────────────────
export default function RestraintEntryPage() {
  const { user } = useAuth();
  const { uhid: uhidParam } = useParams();
  const [uhid, setUhid] = useState((uhidParam || "").toUpperCase());
  const [patient, setPatient] = useState(null);
  const [list, setList] = useState([]);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [restraintType, setRestraintType] = useState("physical");
  const [devices, setDevices] = useState({});
  const [chemicalAgent, setChemicalAgent] = useState("");
  const [reason, setReason] = useState("");
  const [reasonCategory, setReasonCategory] = useState("Safety");
  const [startTime, setStartTime] = useState(nowLocalDatetime());
  const [monitoringFrequency, setMonitoringFrequency] = useState("q30min");
  const [orderingDoctor, setOrderingDoctor] = useState("");
  const [orderTime, setOrderTime] = useState(nowLocalDatetime());
  const [appliedBy, setAppliedBy] = useState("");
  const [alternativesTried, setAlternativesTried] = useState({});
  const [consentObtained, setConsentObtained] = useState(false);
  const [consentFrom, setConsentFrom] = useState("");

  // Removal modal
  const [removing, setRemoving] = useState(null);          // restraint row being removed
  const [removalReason, setRemovalReason] = useState(REMOVAL_REASONS[0]);
  const [removedAt, setRemovedAt] = useState(nowLocalDatetime());
  const [removalSubmitting, setRemovalSubmitting] = useState(false);

  // Auto-fill appliedBy from logged-in nurse
  useEffect(() => {
    if (!user || appliedBy) return;
    const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim();
    if (name) setAppliedBy(name);
  }, [user, appliedBy]);

  // Auto-pick chemical-mode monitoring freq when type flips to chemical
  useEffect(() => {
    if (restraintType === "chemical" && monitoringFrequency === "q30min") {
      setMonitoringFrequency("q15min");
    }
  }, [restraintType]); // eslint-disable-line

  // Auto-load patient if a UHID param was passed in URL
  useEffect(() => {
    if (uhidParam && uhidParam.trim()) {
      findPatient(uhidParam.trim().toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhidParam]);

  const findPatient = useCallback(async (uhidVal) => {
    const target = (uhidVal || uhid).trim().toUpperCase();
    if (!target) return;
    try {
      const r = await axios.get(`${API}/patients/uhid/${target}`, authHdr());
      const p = r.data?.data || r.data?.patient || r.data;
      if (p?.UHID) {
        setPatient(p);
        setUhid(p.UHID);
        await loadList(p.UHID);
      } else {
        toast.error("Patient not found");
        setPatient(null);
        setList([]);
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Patient lookup failed");
      setPatient(null);
      setList([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhid]);

  const loadList = useCallback(async (uhidVal) => {
    try {
      const r = await axios.get(`${API}/restraints/${uhidVal}?limit=50`, authHdr());
      setList(r.data?.data || []);
    } catch (_) {
      setList([]);
    }
  }, []);

  const activeRestraints = useMemo(() => list.filter((r) => r.status === "Active"), [list]);
  const recentHistory    = useMemo(() => list.filter((r) => r.status !== "Active").slice(0, 10), [list]);

  const toggleDevice = (code) => setDevices((d) => ({ ...d, [code]: !d[code] }));
  const toggleAlt = (label) => setAlternativesTried((a) => ({ ...a, [label]: !a[label] }));

  const resetForm = () => {
    setRestraintType("physical");
    setDevices({});
    setChemicalAgent("");
    setReason("");
    setReasonCategory("Safety");
    setStartTime(nowLocalDatetime());
    setMonitoringFrequency("q30min");
    setAlternativesTried({});
    setConsentObtained(false);
    setConsentFrom("");
  };

  const handleSubmit = async () => {
    if (!patient?.UHID) return toast.error("Search a patient first");
    if (!reason.trim()) return toast.error("Reason is required (NABH COP.17 mandatory field)");
    if (restraintType === "physical" && !Object.values(devices).some(Boolean)) {
      return toast.error("Select at least one physical restraint device");
    }
    if ((restraintType === "chemical" || restraintType === "both") && !chemicalAgent.trim()) {
      return toast.error("Chemical agent is required for chemical restraint");
    }
    if (!orderingDoctor.trim()) return toast.error("Ordering doctor is required");

    setSaving(true);
    try {
      const restraintDevice = Object.entries(devices).filter(([, v]) => v).map(([k]) => k);
      const alternatives = Object.entries(alternativesTried).filter(([, v]) => v).map(([k]) => k);

      const payload = {
        UHID: patient.UHID,
        restraintType,
        restraintDevice,
        chemicalAgent: chemicalAgent.trim(),
        reason: reason.trim(),
        reasonCategory,
        startTime: new Date(startTime).toISOString(),
        monitoringFrequency,
        orderingDoctor: orderingDoctor.trim(),
        appliedBy: appliedBy.trim(),
        alternativesTried: alternatives,
        consentObtained,
        consentFrom: consentFrom.trim(),
      };

      const r = await axios.post(`${API}/restraints`, payload, authHdr());
      if (r.data?.success) {
        toast.success(`Restraint logged · ${restraintType} · ${monitoringFrequency} monitoring`);
        resetForm();
        await loadList(patient.UHID);
      } else {
        toast.error(r.data?.message || "Save failed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    if (!removing?._id) return;
    setRemovalSubmitting(true);
    try {
      const r = await axios.patch(
        `${API}/restraints/${removing._id}/remove`,
        {
          removedAt: new Date(removedAt).toISOString(),
          removalReason,
        },
        authHdr(),
      );
      if (r.data?.success) {
        toast.success("Restraint marked Removed");
        setRemoving(null);
        await loadList(patient.UHID);
      } else {
        toast.error(r.data?.message || "Failed to mark removed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to mark removed");
    }
    setRemovalSubmitting(false);
  };

  return (
    <AdminPage>
      <Hero
        icon="pi-lock"
        title="Restraint Register"
        subtitle="Physical / chemical restraint episodes · auto-populates NABH COP.17"
        color="pink"
      />

      {/* NABH banner */}
      <div style={{
        margin: "0 0 14px",
        padding: "10px 16px",
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        color: "#991b1b",
        fontSize: 12.5,
        fontWeight: 600,
      }}>
        <i className="pi pi-info-circle" style={{ marginRight: 7 }} />
        NABH AAC.5 / IPSG.6 — restraint requires a written doctor order, documented least-restrictive
        alternative, and reassessment minimum q4h. Monitoring interval depends on type
        (chemical = q15min, physical = q30min by default).
      </div>

      <Card title="Patient">
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <Field label="UHID">
            <input
              value={uhid}
              onChange={(e) => setUhid(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && findPatient()}
              placeholder="UH00000001"
              style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, minWidth: 180 }}
            />
          </Field>
          <PrimaryButton label="Find Patient" icon="pi-search" onClick={() => findPatient()} />
          {patient && (
            <div style={{ marginLeft: 12, padding: "8px 14px", background: "#f0f9ff", border: `1px solid #bae6fd`, borderRadius: 8, fontSize: 13 }}>
              <strong>{patient.fullName || patient.firstName}</strong> · {patient.gender} · {patient.age}y · UHID {patient.UHID}
            </div>
          )}
        </div>
      </Card>

      {patient && (
        <>
          {/* Active restraints (if any) */}
          <Card title={`Active restraints · ${activeRestraints.length}`} color={C.red}>
            {activeRestraints.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 12.5, padding: "8px 4px" }}>
                No active restraint episodes for this patient.
              </div>
            ) : (
              <Table cols={["Started", "Type", "Devices / Agent", "Reason", "Monitor", "Order Dr", "Action"]}>
                {activeRestraints.map((r) => (
                  <tr key={r._id}>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{fmt(r.startTime)}</td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                      <Badge value={r.restraintType} palette="emergency" />
                    </td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                      {Array.isArray(r.restraintDevice) && r.restraintDevice.length ? r.restraintDevice.join(", ") : "—"}
                      {r.chemicalAgent ? ` / ${r.chemicalAgent}` : ""}
                    </td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.reason}</td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.monitoringFrequency}</td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.orderingDoctor || "—"}</td>
                    <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                      <button
                        onClick={() => {
                          setRemoving(r);
                          setRemovedAt(nowLocalDatetime());
                          setRemovalReason(REMOVAL_REASONS[0]);
                        }}
                        style={{
                          padding: "5px 12px", border: "none", borderRadius: 6, background: C.red, color: "#fff",
                          fontWeight: 700, fontSize: 11, cursor: "pointer",
                        }}
                      >
                        <i className="pi pi-check-circle" style={{ marginRight: 5 }} />Mark Removed
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {/* Entry form */}
          <Card title="Record new restraint episode" color={C.red}>
            <SubCard title="1. Doctor order">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Ordering doctor" required>
                  <input
                    value={orderingDoctor}
                    onChange={(e) => setOrderingDoctor(e.target.value)}
                    placeholder="Dr. Full Name"
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
                <Field label="Order datetime">
                  <input
                    type="datetime-local"
                    value={orderTime}
                    onChange={(e) => setOrderTime(e.target.value)}
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted, fontStyle: "italic" }}>
                NABH COP.17 — restraint requires a written doctor order. The order itself is
                entered as plain text in nursing communication; this field records the name and
                time so the COP.17 register row can prove authorisation.
              </div>
            </SubCard>

            <SubCard title="2. Restraint type">
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {RESTRAINT_TYPES.map((t) => (
                  <label key={t.value} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="radio"
                      name="restraintType"
                      checked={restraintType === t.value}
                      onChange={() => setRestraintType(t.value)}
                      style={{ accentColor: C.red, width: 16, height: 16 }}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </SubCard>

            {(restraintType === "physical" || restraintType === "both") && (
              <SubCard title="3a. Physical device(s)">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                  {PHYSICAL_DEVICES.map((d) => (
                    <Check
                      key={d.code}
                      label={d.label}
                      v={!!devices[d.code]}
                      on={() => toggleDevice(d.code)}
                    />
                  ))}
                </div>
              </SubCard>
            )}

            {(restraintType === "chemical" || restraintType === "both") && (
              <SubCard title="3b. Chemical agent">
                <Field label="Drug / dose / route" required>
                  <input
                    value={chemicalAgent}
                    onChange={(e) => setChemicalAgent(e.target.value)}
                    placeholder="e.g. Inj Haloperidol 5 mg IM"
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
              </SubCard>
            )}

            <SubCard title="4. Indication">
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Field label="Reason (clinical justification)" required>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Pulling at IV / ET tube; aggressive towards staff"
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value)}
                    style={{ padding: 8, border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  >
                    {REASON_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </SubCard>

            <SubCard title="5. Timing & monitoring">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="Start time" required>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
                <Field label="Monitoring frequency">
                  <select
                    value={monitoringFrequency}
                    onChange={(e) => setMonitoringFrequency(e.target.value)}
                    style={{ padding: 8, border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  >
                    {MONITORING_FREQS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Applied by">
                  <input
                    value={appliedBy}
                    onChange={(e) => setAppliedBy(e.target.value)}
                    placeholder="Nurse full name"
                    style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  />
                </Field>
              </div>
            </SubCard>

            <SubCard title="6. Least-restrictive alternatives tried first (NABH evidence)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                {ALTERNATIVES.map((a) => (
                  <Check
                    key={a}
                    label={a}
                    v={!!alternativesTried[a]}
                    on={() => toggleAlt(a)}
                  />
                ))}
              </div>
            </SubCard>

            <SubCard title="7. Consent">
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <Check
                  label="Consent obtained from patient / family"
                  v={consentObtained}
                  on={() => setConsentObtained((v) => !v)}
                />
                {consentObtained && (
                  <Field label="Consent from">
                    <input
                      value={consentFrom}
                      onChange={(e) => setConsentFrom(e.target.value)}
                      placeholder="Patient / Spouse / Son / Daughter"
                      style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, minWidth: 220 }}
                    />
                  </Field>
                )}
              </div>
            </SubCard>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <PrimaryButton
                label={saving ? "Saving…" : "Record Restraint Episode"}
                icon="pi-save"
                onClick={handleSubmit}
                disabled={saving}
                busy={saving}
                color={C.red}
              />
            </div>
          </Card>

          {/* History */}
          <Card title={`Restraint history — last ${recentHistory.length}`} color={C.muted}>
            <Table cols={["Started", "Removed", "Type", "Devices / Agent", "Reason", "Duration (min)", "By"]}>
              {recentHistory.length === 0 ? (
                <EmptyRow span={7} text="No prior restraint episodes for this patient" />
              ) : recentHistory.map((r) => (
                <tr key={r._id}>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{fmt(r.startTime)}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{fmt(r.removedAt)}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                    <Badge value={r.restraintType} palette={STATUS_TONE[r.status] || "default"} />
                  </td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                    {Array.isArray(r.restraintDevice) && r.restraintDevice.length ? r.restraintDevice.join(", ") : "—"}
                    {r.chemicalAgent ? ` / ${r.chemicalAgent}` : ""}
                  </td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.reason}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.durationMinutes ?? "—"}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.appliedBy || "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {/* Removal modal */}
      {removing && (
        <Modal
          title={`Mark Restraint Removed — ${removing.restraintType}`}
          color={C.red}
          icon="pi-check-circle"
          onClose={() => setRemoving(null)}
          onSubmit={handleRemove}
          submitting={removalSubmitting}
          submitLabel="Confirm Removal"
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12.5, color: "#991b1b" }}>
              <strong>Started:</strong> {fmt(removing.startTime)} ·{" "}
              <strong>Reason:</strong> {removing.reason}
            </div>
            <Field label="Removed at" required>
              <input
                type="datetime-local"
                value={removedAt}
                onChange={(e) => setRemovedAt(e.target.value)}
                style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
              />
            </Field>
            <Field label="Removal reason" required>
              <select
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                style={{ padding: 8, border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
              >
                {REMOVAL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
