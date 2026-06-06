/**
 * IndentRaisePage.jsx — Nurse raises a drug indent to pharmacy.
 *
 * Route: /nursing/indent/raise/:admissionId
 * Backend: POST /api/indents { admissionId, items, urgency, notes }
 *
 * Two tabs to compose the items list:
 *   1. From Prescription — lists this admission's active DoctorOrder
 *      medications. One-click select, qty pre-filled from prescribed
 *      dose; backs the indent line with doctorOrderId so the audit
 *      trail proves it's NOT off-prescription.
 *   2. Other Drug       — DrugAutocomplete free-search for emergencies
 *      / consumables / off-formulary items. Requires a reason.
 *
 * Urgency: Routine / Urgent / STAT (colored badges, drives queue sort
 * + audio chime on pharmacist's side).
 */
// R7hr-12-S3 (D9-02 + D9-05): useRef for synchronous submit mutex; AbortController for chained loads.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import API_ENDPOINTS from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import DrugAutocomplete from "../../Components/clinical/DrugAutocomplete";
// R7az-D5-HIGH-4 — toMoney() unwraps Decimal128/{$numberDecimal:"…"}
// wire shapes for the per-drug unit-price stored on the indent line.
import { toMoney } from "../../utils/money";

const C = {
  primary: "#1d4ed8", accent: "#7c3aed",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
};

const URGENCY_TONE = {
  Routine: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  Urgent:  { bg: "#fef3c7", fg: "#a16207", border: "#fcd34d" },
  STAT:    { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
};

/* ── StockPill — small "Available: N · Exp: …" chip ──
   Rendered next to every drug surface on this page so the nurse can
   spot a stock-out before adding a row. Colour-coded:
     • green  = healthy stock (≥ 10 units)
     • amber  = low stock (1-9) OR expiring within 60 days
     • red    = out of stock (0)
     • slate  = unknown (drug not found in /pharmacy/stock rollup)
   Stays compact so it fits inside DoctorOrder cards + autocomplete row. */
function StockPill({ stock, compact = false }) {
  if (!stock) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: compact ? "1px 6px" : "2px 7px", borderRadius: 999,
        fontSize: compact ? 9 : 10, fontWeight: 700,
        background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1",
        fontFamily: "'DM Mono', monospace",
      }}>
        <i className="pi pi-question-circle" style={{ fontSize: compact ? 8 : 9 }} />
        Stock unknown
      </span>
    );
  }
  const qty       = Number(stock.available) || 0;
  const expiry    = stock.expiry ? new Date(stock.expiry) : null;
  const daysToExp = expiry ? Math.floor((expiry.getTime() - Date.now()) / 86400000) : Infinity;
  const expSoon   = daysToExp < 60;
  const isOut     = qty === 0;
  const isLow     = qty > 0 && qty < 10;
  const isOk      = qty >= 10 && !expSoon;
  const palette = isOut ? { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5", icon: "pi-exclamation-triangle" }
                : isLow ? { bg: "#fef3c7", fg: "#a16207", border: "#fcd34d", icon: "pi-exclamation-circle" }
                : isOk  ? { bg: "#dcfce7", fg: "#15803d", border: "#86efac", icon: "pi-box" }
                        : { bg: "#fef3c7", fg: "#a16207", border: "#fcd34d", icon: "pi-clock" };
  return (
    <span title={`${qty} unit${qty === 1 ? "" : "s"} across ${stock.batches || 0} batch${stock.batches === 1 ? "" : "es"}${expiry ? " · nearest expiry " + expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: compact ? "1px 6px" : "2px 8px", borderRadius: 999,
        fontSize: compact ? 9 : 10, fontWeight: 800,
        background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`,
        fontFamily: "'DM Mono', monospace",
      }}>
      <i className={`pi ${palette.icon}`} style={{ fontSize: compact ? 8 : 9 }} />
      {isOut ? "Out of stock" : `${qty} avail`}
      {!isOut && expSoon && expiry && (
        <span style={{ marginLeft: 2 }}>· Exp {expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
      )}
    </span>
  );
}

export default function IndentRaisePage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [admission, setAdmission] = useState(null);
  const [orders, setOrders] = useState([]);            // active DoctorOrders
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("prescription");      // "prescription" | "other"

  // Composed items list — the user ticks DoctorOrder lines or picks from
  // DrugAutocomplete; both paths push into this single array.
  const [items, setItems] = useState([]);
  const [urgency, setUrgency] = useState("Routine");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // "Other Drug" tab state
  const [otherDrug, setOtherDrug] = useState(null);
  const [otherDrugSearch, setOtherDrugSearch] = useState("");
  const [otherQty, setOtherQty] = useState(1);
  const [otherReason, setOtherReason] = useState("");

  // Live stock rollup — one /stock call gives us every drug's current
  // remaining + nearest expiry. We expose it as a Map keyed by both
  // drugId (preferred — exact match) and lowercased drugName (fallback
  // for DoctorOrder rows that didn't link to a Drug master row at the
  // time of prescription). Renders inline pills on every drug surface
  // (prescription cards, autocomplete, added-items list) so the nurse
  // sees a stock-out BEFORE raising the indent.
  const [stockMap, setStockMap] = useState({ byId: new Map(), byName: new Map() });
  const stockFor = useCallback((drugId, drugName) => {
    if (drugId && stockMap.byId.has(String(drugId))) return stockMap.byId.get(String(drugId));
    if (drugName) {
      const hit = stockMap.byName.get(String(drugName).toLowerCase().trim());
      if (hit) return hit;
    }
    return null;
  }, [stockMap]);

  // R7hr-12-S3 (D9-05): AbortController for the chained admission → orders → notes
  // → stock fetch. Without it, a fast back-button-and-reopen on a different
  // admission would let the older response land after the newer one and the
  // nurse would see stale orders / stale stock pills on the freshly-opened
  // admission. We abort the in-flight controller before each new load and on
  // unmount, and pass `{ signal }` to every axios call.
  const loadAbortRef = useRef(null);
  const load = useCallback(async () => {
    if (!admissionId) return;
    // Abort any in-flight load before starting a new one (admissionId change).
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const { signal } = controller;
    setLoading(true);
    try {
      // R7w: Two-step fetch — admission first, then doctor-orders keyed
      // by the admission's UHID + admissionNumber.
      //
      // Previously this was one Promise.all that issued
      //   GET /doctor-orders?admissionId=<ObjectId>&status=Active
      // Two bugs in that URL:
      //   1. Backend's GET /doctor-orders only filters by UHID + visitId
      //      (the admissionNumber string). `admissionId` is silently
      //      ignored, so the result set was every order ever.
      //   2. `status=Active` does not exist in the DoctorOrder status
      //      enum (Pending / Acknowledged / InProgress / Held / OnHold /
      //      Completed / Cancelled / Stopped). The filter therefore
      //      always returned an empty array — even on patients with
      //      live prescriptions.
      // Pharmacy stock rollup still runs in parallel — non-fatal failure.
      const [admRes, stockRes] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/admissions/${admissionId}`, { signal }),
        axios.get(`${API_ENDPOINTS.BASE}/pharmacy/stock`, { signal }).catch(() => ({ data: { data: [] } })),
      ]);
      if (signal.aborted) return;                              // R7hr-12-S3 (D9-05)
      const adm = admRes.data?.data || admRes.data;
      setAdmission(adm);

      // Now query doctor-orders by the admission's actual identifiers.
      //
      // R7gx-FIX — Status semantic drift: per R7bq-K, DoctorOrder.status
      // flips to "Completed" the moment the FIRST dose is administered,
      // NOT when the course finishes. So an order on q4h or BD schedule
      // spends most of its life flagged "Completed" while still being
      // dispensed daily. For indent eligibility we want every order
      // that's still being given to the patient — i.e. everything
      // EXCEPT Cancelled / Stopped (true terminal states).
      //
      // Previously this list was Pending,Acknowledged,InProgress,Held,
      // OnHold only — which hid every order that had been administered
      // at least once. That's why the "From Prescription" tab kept
      // showing 0 even on admissions with active MAR rows.
      const ACTIVE_STATUSES = "Pending,Acknowledged,InProgress,Held,OnHold,Completed";
      const visitId = adm?.admissionNumber || adm?.ipdNo || "";
      const uhid    = adm?.UHID || "";
      let list = [];
      if (uhid && visitId) {
        try {
          // R7hr-12-S3 (D9-05): chained call — pass { signal } so an admissionId
          // change aborts the in-flight fetch instead of letting it land late.
          const orderRes = await axios.get(
            `${API_ENDPOINTS.BASE}/doctor-orders?UHID=${encodeURIComponent(uhid)}&visitId=${encodeURIComponent(visitId)}&orderType=Medication&status=${encodeURIComponent(ACTIVE_STATUSES)}`,
            { signal },
          );
          list = orderRes.data?.data || orderRes.data?.orders || [];
        } catch (_) { /* leave list empty — the form still works via Other Drug */ }
      }
      if (signal.aborted) return;                              // R7hr-12-S3 (D9-05)

      // R7gx-FIX-2 — MAR PARITY: TreatmentChart (the MAR) aggregates
      // medications from TWO sources — the DoctorOrder collection AND
      // every doctorNote.noteDetails.medicationOrders / .infusionOrders
      // embedded array. Indent raise was reading only the first source,
      // so meds prescribed inline inside an Initial Assessment, Daily
      // Progress note, ICU note, etc. (without ever being promoted to
      // a standalone DoctorOrder document) never showed up on the
      // prescription tab. The pharmacist would see only a partial picture
      // of what the patient is on — a real dispensing-safety gap.
      //
      // Canonical reader: DoctorPatientPanel.TreatmentChartTab L1515-1551
      // — both lists are mirrored into the same shape for the MAR grid.
      // We mirror it here, then dedupe so DoctorOrder rows (real lifecycle)
      // win over note-embedded duplicates of the same drug.
      const noteEmbeddedOrders = [];
      if (visitId) {
        try {
          // R7hr-12-S3 (D9-05): chained call — pass { signal } so a quick
          // admissionId switch aborts the notes fetch.
          const noteRes = await axios.get(
            `${API_ENDPOINTS.BASE}/doctor-notes/ipd/${encodeURIComponent(visitId)}`,
            { signal },
          );
          const notes = noteRes.data?.data || noteRes.data?.notes
            || (Array.isArray(noteRes.data) ? noteRes.data : []);
          (Array.isArray(notes) ? notes : []).forEach((note) => {
            const nd      = note?.noteDetails || {};
            const meds    = Array.isArray(nd.medicationOrders) ? nd.medicationOrders : [];
            const infs    = Array.isArray(nd.infusionOrders)   ? nd.infusionOrders   : [];
            [...meds, ...infs].forEach((m, idx) => {
              const drugName = m?.drug || m?.drugFluid || m?.medicineName || "";
              if (!drugName) return;
              // Skip note-embedded rows that the doctor explicitly cancelled.
              const ms = String(m?.status || "").toLowerCase();
              if (ms === "cancelled" || ms === "stopped") return;
              noteEmbeddedOrders.push({
                _id:          `note-${note._id}-${idx}`,
                orderDetails: {
                  medicineName: drugName,
                  drugId:       m?.drugId || m?.medicineId || "",
                  medicineCode: m?.medicineCode || m?.itemCode || "",
                  dose:         m?.dose      || m?.volume || "",
                  form:         m?.form      || "",
                  frequency:    m?.frequency || m?.rate   || "",
                  route:        m?.route     || "",
                },
                status:    m?.status || "Active",
                orderedBy: note?.doctorName || note?.signedByName || "Doctor",
                source:    "note",
                noteRef:   note?._id,
                noteType:  note?.noteType || "",
              });
            });
          });
        } catch (_) { /* note fetch is best-effort — the form still works without it */ }
      }

      // Dedupe — DoctorOrder rows (real lifecycle + admin trail) outrank
      // note-embedded mirrors of the same drug. Match by drugId when both
      // sides have one, else by case-insensitive trimmed medicineName.
      const seen = new Set();
      const keyFor = (o) => {
        const d = o.orderDetails || {};
        const id = String(d.drugId || d.medicineId || "").trim();
        if (id) return `id:${id}`;
        const nm = String(d.medicineName || d.displayName || o.serviceName || "").toLowerCase().trim();
        return nm ? `nm:${nm}` : `oid:${o._id}`;
      };
      const merged = [];
      [...(Array.isArray(list) ? list : []), ...noteEmbeddedOrders].forEach((o) => {
        const k = keyFor(o);
        if (seen.has(k)) return;
        seen.add(k);
        merged.push(o);
      });
      setOrders(merged);

      // Build the dual-key lookup. The stock endpoint returns rows
      // shaped { drugId, drugName, totalRemaining, batchCount,
      // nearestExpiry }. We normalise drugName for case-insensitive
      // matching (DoctorOrder.medicineName casing isn't consistent).
      const rows = Array.isArray(stockRes.data?.data) ? stockRes.data.data : [];
      const byId   = new Map();
      const byName = new Map();
      for (const r of rows) {
        const entry = {
          available: Number(r.totalRemaining) || 0,
          batches:   Number(r.batchCount) || 0,
          expiry:    r.nearestExpiry || null,
          drugName:  r.drugName || "",
        };
        if (r.drugId)   byId.set(String(r.drugId), entry);
        if (r.drugName) byName.set(String(r.drugName).toLowerCase().trim(), entry);
      }
      if (signal.aborted) return;                              // R7hr-12-S3 (D9-05)
      setStockMap({ byId, byName });
    } catch (e) {
      // R7hr-12-S3 (D9-05): swallow abort-induced errors so a fast
      // admissionId switch / unmount doesn't toast a misleading red error.
      if (e?.name === "CanceledError" || e?.name === "AbortError" || signal.aborted) return;
      toast.error("Could not load admission: " + (e.response?.data?.message || e.message));
    } finally {
      // Only flip the loader off if this controller is still the active one
      // (i.e. we weren't superseded by a newer load()).
      if (!signal.aborted) setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => {
    load();
    // R7hr-12-S3 (D9-05): abort any in-flight load when the component
    // unmounts or admissionId changes — prevents stale setOrders / setStockMap.
    return () => { if (loadAbortRef.current) loadAbortRef.current.abort(); };
  }, [load]);

  /* ── DoctorOrder selection — tick a prescribed med ──────────── */
  const addFromOrder = (order) => {
    const detail = order.orderDetails || {};
    const drugName = detail.medicineName || detail.displayName || order.serviceName || "Drug";
    // Skip if same drugId+order already added
    if (items.some(i => String(i.doctorOrderId) === String(order._id))) {
      return toast.info("Already added");
    }
    setItems(prev => [...prev, {
      key: `ord-${order._id}`,
      drugName,
      drugCode:      detail.medicineCode || "",
      dose:          detail.dose || "",
      form:          detail.form || "",
      route:         detail.route || "",
      requestedQty:  1,
      sourceType:    "DoctorOrder",
      doctorOrderId: order._id,
      reason:        "",
    }]);
  };

  /* ── Manual / Other Drug — DrugAutocomplete pick + qty + reason ─ */
  const addOther = () => {
    // R7az-D5-HIGH-2 — Race-fix: only add when the user has explicitly
    // re-picked a drug from the autocomplete AND the visible search
    // string still matches that picked drug's display name. Pre-fix,
    // typing past the selected drug (e.g. picking "Amox 500" then
    // continuing to type "icillin 250") would still file the indent
    // against "Amox 500" because we only checked _id. Now: if the user
    // types past a selection we null `selectedDrug` (see onChange below)
    // and the button gates on selectedDrug !== null.
    if (!otherDrug?._id) return toast.warn("Pick a drug from the dropdown");
    const expected = otherDrug.brandName || otherDrug.genericName || "";
    if (otherDrugSearch.trim().toLowerCase() !== expected.trim().toLowerCase()) {
      return toast.warn("Search text doesn't match selected drug — pick again from the dropdown");
    }
    if (!Number(otherQty) || Number(otherQty) <= 0) return toast.warn("Quantity must be > 0");
    if (!otherReason.trim()) return toast.warn("Reason required for non-prescription indents");
    setItems(prev => [...prev, {
      key: `other-${Date.now()}`,
      drugName:      otherDrug.brandName || otherDrug.genericName || otherDrugSearch,
      drugId:        otherDrug._id,
      drugCode:      otherDrug.itemCode || otherDrug.drugCode || "",
      dose:          otherDrug.strength || "",
      form:          otherDrug.form || "",
      requestedQty:  Number(otherQty),
      sourceType:    "Manual",
      reason:        otherReason.trim(),
      // R7az-D5-HIGH-4 — Decimal128 unwrap so the indent line stores a
      // plain JS number for unitPrice (previously could be `{ $numberDecimal: "12.50" }`
      // which broke any downstream `Number(price) * qty` math).
      unitPrice:     toMoney(otherDrug.sellPriceCash ?? otherDrug.priceCash),
    }]);
    setOtherDrug(null); setOtherDrugSearch(""); setOtherQty(1); setOtherReason("");
  };

  const updateItemQty = (key, qty) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, requestedQty: Math.max(1, Number(qty) || 1) } : i));
  };
  const removeItem = (key) => setItems(prev => prev.filter(i => i.key !== key));

  // R7hr-12-S3 (D9-02): synchronous ref-mutex to block the double-click
  // window between the user releasing the mouse and React flipping `saving`
  // to true. Without this, a quick double-click on "Raise indent to pharmacy"
  // fires two POST /indents in flight before the disabled flag re-renders —
  // resulting in two stock reservations + two near-identical "Raised at …"
  // entries in the audit trail. Mirrors the pattern shipped in
  // PharmacyLedgerPage.applyAdvanceToSale (R7hr-11).
  const submitMutex = useRef(false);
  const submit = async () => {
    if (submitMutex.current) return;                          // R7hr-12-S3 (D9-02)
    if (!items.length) return toast.warn("Add at least one drug");
    // R7hr-12-S3 (D9-11): defence-in-depth — if the admission is discharged
    // we should never reach a live POST, even if the disabled-attribute on
    // Submit is removed in a future refactor.
    if (isDischarged) return;
    submitMutex.current = true;                               // R7hr-12-S3 (D9-02)
    setSaving(true);
    try {
      const payload = {
        admissionId,
        urgency,
        notes:  notes.trim() || undefined,
        items:  items.map(({ key, ...rest }) => rest),    // drop UI-only key
      };
      const { data } = await axios.post(`${API_ENDPOINTS.BASE}/indents`, payload);
      toast.success(`Indent ${data.data.indentNumber} raised to pharmacy`);
      navigate(-1);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSaving(false);
      submitMutex.current = false;                            // R7hr-12-S3 (D9-02)
    }
  };

  if (loading) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 32, color: C.primary }} />
      <div style={{ marginTop: 12, color: C.muted, fontSize: 13 }}>Loading admission…</div>
    </div>
  );
  if (!admission) return <div style={{ padding: 60, color: C.danger, textAlign: "center" }}>Admission not found</div>;

  const patient = admission.patientId || {};
  // R7az-D5-HIGH-3 — Block raising new indents against a discharged
  // admission. Pre-fix, the page rendered the full form so a nurse could
  // still POST /indents for a patient who was no longer in-house, the
  // pharmacy would queue and dispense, and the bill would be left
  // dangling against a closed admission.
  const isDischarged =
    (admission.status || "").toLowerCase() === "discharged" ||
    !!admission.dischargedAt || !!admission.dischargeDate;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "16px 20px 60px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={() => navigate(-1)} style={{
          padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.dark,
        }}>
          <i className="pi pi-arrow-left" style={{ marginRight: 6, fontSize: 11 }} />
          Back
        </button>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>Raise Pharmacy Indent</div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>
          {admission.admissionNumber}
        </span>
      </div>

      {/* Patient strip */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Patient</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.dark, marginTop: 2 }}>{patient.fullName || admission.UHID}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
              UHID: <strong style={{ color: C.dark }}>{admission.UHID}</strong> ·
              {patient.age ? ` ${patient.age}Y · ` : " "}{patient.gender || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Bed / Ward</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.dark, marginTop: 4 }}>
              {admission.bedId?.bedNumber || "—"} · {admission.bedId?.wardName || admission.department || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Consultant</div>
            <div style={{ fontSize: 12, color: C.dark, marginTop: 4 }}>
              {/* R7ey-F39: canonical field is attendingDoctor — phantom legacy fields kept as last-resort fallback */}
              {admission.attendingDoctor || admission.consultantDoctor?.fullName || admission.primaryConsultant || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Raised By</div>
            <div style={{ fontSize: 12, color: C.dark, marginTop: 4 }}>
              {user?.fullName || user?.name || "Nurse"} <span style={{ fontSize: 10, color: C.muted }}>({user?.role || "Nurse"})</span>
            </div>
          </div>
        </div>
      </div>

      {/* R7az-D5-HIGH-3 — Discharged admission banner. Prevents nurses
          from raising indents on a patient who's already left the ward.
          The Urgency selector + Add buttons + Submit button are all
          disabled below when `isDischarged` is true. */}
      {isDischarged && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fca5a5",
          borderRadius: 12, padding: "14px 18px", marginBottom: 14,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <i className="pi pi-ban" style={{ fontSize: 24, color: C.danger }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.danger, marginBottom: 2 }}>
              This patient has been discharged.
            </div>
            <div style={{ fontSize: 12, color: "#7f1d1d" }}>
              Indents cannot be raised against a discharged admission. If a return-visit medication
              is needed, raise it through OPD or contact the pharmacist directly.
            </div>
          </div>
        </div>
      )}

      {/* Urgency selector */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14, opacity: isDischarged ? 0.5 : 1, pointerEvents: isDischarged ? "none" : "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Urgency</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["Routine", "Urgent", "STAT"].map(u => {
            const t = URGENCY_TONE[u];
            const active = urgency === u;
            return (
              <button key={u} onClick={() => setUrgency(u)} style={{
                flex: 1, padding: "10px 14px",
                background: active ? t.fg : "#fff",
                color: active ? "#fff" : t.fg,
                border: `1.5px solid ${t.border}`,
                borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                fontWeight: 800, fontSize: 13, textTransform: "uppercase", letterSpacing: ".4px",
              }}>
                {u === "STAT" && active && <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />}
                {u}
              </button>
            );
          })}
        </div>
        {urgency === "STAT" && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontSize: 11, color: "#b91c1c", fontWeight: 700 }}>
            STAT — pharmacist will get a sound alert. Use only for emergencies (deteriorating patient, code-blue support).
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `2px solid ${C.border}`, marginBottom: 12 }}>
        {[
          { id: "prescription", label: `From Prescription (${orders.length})`, icon: "pi-file-edit" },
          { id: "other",        label: "Other Drug (free search)",             icon: "pi-search" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: tab === t.id ? C.card : "transparent",
            border: "none", borderBottom: tab === t.id ? `3px solid ${C.primary}` : "3px solid transparent",
            marginBottom: -2, cursor: "pointer", fontFamily: "inherit",
            fontWeight: tab === t.id ? 800 : 600, color: tab === t.id ? C.primary : C.muted, fontSize: 13,
          }}>
            <i className={`pi ${t.icon}`} style={{ marginRight: 6, fontSize: 12 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "prescription" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          {orders.length === 0 ? (
            <div style={{ padding: 20, color: C.muted, textAlign: "center", fontStyle: "italic" }}>
              No active medication orders for this admission. Switch to "Other Drug" to pick from inventory directly.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {orders.map(o => {
                const d = o.orderDetails || {};
                const drugName = d.medicineName || d.displayName || o.serviceName || "Drug";
                const added = items.some(i => String(i.doctorOrderId) === String(o._id));
                const stock = stockFor(d.drugId || d.medicineId, drugName);
                return (
                  <button key={o._id} onClick={() => addFromOrder(o)} disabled={added} style={{
                    textAlign: "left", padding: "10px 12px",
                    background: added ? "#dcfce7" : "#fff",
                    border: `1px solid ${added ? "#86efac" : C.border}`,
                    borderRadius: 8, cursor: added ? "default" : "pointer",
                    fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <i className={`pi ${added ? "pi-check-circle" : "pi-plus-circle"}`} style={{ fontSize: 12, color: added ? "#15803d" : C.primary }} />
                      <span style={{ fontWeight: 700, color: C.dark, fontSize: 13 }}>{drugName}</span>
                      <StockPill stock={stock} compact />
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, paddingLeft: 18 }}>
                      {d.dose || ""} {d.frequency || ""} {d.route || ""} · prescribed by {o.orderedBy || "Doctor"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "other" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 1.5fr 110px", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Drug *</label>
              <div style={{ marginTop: 4 }}>
                {/* R7az-D5-HIGH-2 — When the user types past a selection
                    (e.g. picked "Amox 500" then continues typing), null
                    selectedDrug so they must re-confirm by clicking a
                    dropdown row again. The submit-side addOther() also
                    verifies search-text matches the selected drug's
                    canonical name (defence in depth). */}
                <DrugAutocomplete
                  showLabel={false}
                  value={otherDrugSearch}
                  onChange={(v) => {
                    setOtherDrugSearch(v);
                    // If the typed text no longer matches the currently
                    // selected drug, force re-selection.
                    if (!v) {
                      setOtherDrug(null);
                    } else if (otherDrug) {
                      const expected = (otherDrug.brandName || otherDrug.genericName || "").trim().toLowerCase();
                      if (v.trim().toLowerCase() !== expected) setOtherDrug(null);
                    }
                  }}
                  onPick={(d) => { setOtherDrug(d); setOtherDrugSearch(d.brandName || d.genericName || ""); }}
                />
                {/* Live stock hint — appears the moment a drug is picked
                    so the nurse knows whether the indent will actually
                    be fulfillable (or if it's a stock-out before even
                    raising the request). */}
                {otherDrug && (
                  <div style={{ marginTop: 6 }}>
                    <StockPill stock={stockFor(otherDrug._id, otherDrug.brandName || otherDrug.genericName)} />
                  </div>
                )}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Qty *</label>
              <input type="number" min={1} value={otherQty} onChange={e => setOtherQty(e.target.value)}
                style={{ width: "100%", marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Reason *</label>
              <input type="text" value={otherReason} onChange={e => setOtherReason(e.target.value)}
                placeholder="e.g. Emergency consumable, off-prescription"
                style={{ width: "100%", marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <button onClick={addOther} disabled={!otherDrug} style={{
              padding: "9px 14px", background: C.primary, color: "#fff", border: "none",
              borderRadius: 8, cursor: otherDrug ? "pointer" : "not-allowed",
              fontFamily: "inherit", fontWeight: 700, fontSize: 12, opacity: otherDrug ? 1 : 0.5,
            }}>
              <i className="pi pi-plus" style={{ marginRight: 6 }} />Add
            </button>
          </div>
        </div>
      )}

      {/* Items list — composed indent */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontWeight: 800, color: C.dark, fontSize: 13 }}>
          Indent items ({items.length})
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 30, color: C.muted, textAlign: "center", fontStyle: "italic", fontSize: 13 }}>
            No items added yet. Use the tabs above to add drugs.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase" }}>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>Drug</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>Source</th>
                <th style={{ padding: "8px 10px", textAlign: "center", width: 80 }}>Qty</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>Reason / Notes</th>
                <th style={{ padding: "8px 10px", textAlign: "center", width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, color: C.dark }}>{it.drugName}</span>
                      <StockPill stock={stockFor(it.drugId, it.drugName)} compact />
                    </div>
                    {(it.dose || it.form || it.route) && (
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                        {it.form} {it.dose} {it.route && `· ${it.route}`}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      background: it.sourceType === "DoctorOrder" ? "#dbeafe" : "#fef3c7",
                      color:      it.sourceType === "DoctorOrder" ? "#1d4ed8" : "#a16207",
                      padding: "2px 7px", borderRadius: 6, textTransform: "uppercase", letterSpacing: ".3px",
                    }}>
                      {it.sourceType === "DoctorOrder" ? "Rx" : "Manual"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <input type="number" min={1} value={it.requestedQty}
                      onChange={e => updateItemQty(it.key, e.target.value)}
                      style={{ width: 60, padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "center", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </td>
                  <td style={{ padding: "8px 10px", color: C.muted, fontSize: 11 }}>{it.reason || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button onClick={() => removeItem(it.key)} title="Remove" style={{
                      width: 26, height: 26, padding: 0, background: "#fee2e2", color: C.danger,
                      border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer",
                    }}>
                      <i className="pi pi-times" style={{ fontSize: 11 }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Notes + Submit */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Notes for Pharmacist</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="e.g. CKD patient, avoid nephrotoxic. Substitute generic if Brand-X out of stock."
          style={{ width: "100%", marginTop: 6, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          {/* R7az-D5-HIGH-3 — Submit hard-gated on isDischarged. */}
          <button onClick={submit} disabled={saving || items.length === 0 || isDischarged} style={{
            padding: "10px 22px", background: C.primary, color: "#fff", border: "none",
            borderRadius: 8, cursor: saving ? "wait" : (items.length === 0 || isDischarged ? "not-allowed" : "pointer"),
            fontFamily: "inherit", fontWeight: 800, fontSize: 13,
            opacity: items.length === 0 || isDischarged ? 0.5 : 1,
          }}>
            {saving ? <><i className="pi pi-spin pi-spinner" /> Raising indent…</> : (
              <><i className="pi pi-send" style={{ marginRight: 6 }} />Raise indent to pharmacy</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
