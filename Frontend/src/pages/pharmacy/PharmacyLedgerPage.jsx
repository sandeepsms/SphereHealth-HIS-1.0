/**
 * PharmacyLedgerPage.jsx (R7hr-3)
 *
 * Pharmacist-scoped IPD ledger. Surfaces ONLY the pharmacy slice for a
 * single admission:
 *   - Patient header (name / UHID / IPD No / bed / consultant)
 *   - Day-wise medicines dispensed with per-day subtotal + per-bill rows
 *   - Pharmacy outstanding (running balance)
 *   - "Collect Payment" panel — Cash / Card / UPI with txn refs
 *   - "Take Advance Deposit" panel — patient credit pool
 *
 * Deliberately DOES NOT show: bed charges, doctor visits, nursing,
 * services, equipment, consumables, lab / radiology, full hospital
 * outstanding. The pharmacist never sees the complete hospital bill —
 * only what they can act on (medicines + payment + advance).
 *
 * Routed at /pharmacy/ledger/:admissionId. Query params (passed from
 * the Live Indents page) optionally seed patient details so the page
 * renders identity instantly while sales fetch in the background.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { fmtINR } from "../../Components/print/amountWords";
// R7hr-5: re-print a single sale and pre-warm the pharmacy-bill template
// cache. Same hook the Dispense flow uses so the bill comes out identical
// to the one issued at counter time.
import { openPrint } from "../../Components/print/openPrint";
// R7hr-7: surface the logged-in user as "Prepared by" + "Counter" on
// re-prints so the bill carries real provenance instead of "Pharmacist"
// placeholder text.
import { useAuth } from "../../context/AuthContext";

const C = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#0f172a",
  muted:  "#64748b",
  orange: "#ea580c",
  green:  "#15803d",
  blue:   "#1d4ed8",
  red:    "#b91c1c",
  amber:  "#a16207",
};

const dec = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "object" && v.$numberDecimal) return parseFloat(v.$numberDecimal) || 0;
  return 0;
};

const dateKey = (d) => new Date(d).toLocaleDateString("en-CA"); // YYYY-MM-DD for sorting
const dateLabel = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "short" });

/**
 * Props (all optional — page works as both a route and an embedded tab):
 *   embedded     — when true, the back button calls onBack() instead of
 *                  navigate(-1) so the parent tab strip stays in control.
 *   admissionId  — wins over the route param when present. Lets the parent
 *                  (PharmacyHomePage / IPDCreditTab) mount this component
 *                  for any selected admission without changing the URL.
 *   seedPatient  — { UHID, patientName, admissionNumber, bed, consultant }
 *                  initial banner identity; falls back to URL query string
 *                  parsing in route-mode, then to first-sale hydration.
 *   onBack       — called by the back button in embedded mode.
 */
export default function PharmacyLedgerPage({
  embedded = false,
  admissionId: admIdProp,
  seedPatient,
  onBack,
} = {}) {
  const routeParams = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth() || {};

  // Prop wins over route param so the parent can mount any admission's
  // ledger in-place. Both are present in route mode — useParams() returns
  // the captured segment; the prop is undefined.
  const admissionId = admIdProp || routeParams.admissionId;

  // Patient identity. Seed first from the explicit prop (embedded mode),
  // then from the URL query string (route mode), then hydrate later from
  // the first sale row if neither source provided it.
  const [patient, setPatient] = useState(() => seedPatient || {
    UHID:            search.get("uhid") || "",
    patientName:     search.get("name") || "",
    admissionNumber: search.get("ipd")  || "",
    bed:             search.get("bed")  || "",
    consultant:      search.get("doc")  || "",
  });

  // Back-button handler: parent callback if embedded, else router pop.
  const goBack = () => (onBack ? onBack() : navigate(-1));

  const [sales, setSales]       = useState([]);
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading]   = useState(true);

  // Collect Payment modal state
  const [collect, setCollect]   = useState(null); // { sale, max }
  const [colAmt, setColAmt]     = useState("");
  const [colMode, setColMode]   = useState("Cash");
  const [colTxn, setColTxn]     = useState("");
  const [colSaving, setColSaving] = useState(false);

  // Take Advance modal state
  const [advOpen, setAdvOpen]   = useState(false);
  const [advAmt, setAdvAmt]     = useState("");
  const [advMode, setAdvMode]   = useState("Cash");
  const [advTxn, setAdvTxn]     = useState("");
  const [advSaving, setAdvSaving] = useState(false);

  const load = async () => {
    if (!patient.UHID) {
      // Without a UHID we can't pull sales (the credit endpoint groups
      // by admissionId but doesn't return the per-sale detail). Show
      // a banner and the back button.
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Pull all pharmacy sales for this UHID, then filter to this
      // admission. Avoids needing a new backend endpoint and keeps
      // the contract identical to the OPD Rx page's dup-dispense
      // lookup added in R7hp-4.
      // R7hr-7: pull patient identity + admission details too so the
      // consolidated bill renders Age/Sex/Contact/Doctor instead of "—".
      // Both fetches are best-effort — they fall through gracefully
      // when the endpoints don't exist for retail-mode deployments.
      const [salesR, advR, patR, admR] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/pharmacy/sales`, { params: { uhid: patient.UHID, limit: 500 } }),
        axios.get(`${API_ENDPOINTS.BASE}/billing/advance/uhid/${encodeURIComponent(patient.UHID)}`).catch(() => ({ data: { data: [] } })),
        // R7hr-7-FIX-2: correct path is /patients/uhid/:uhid (was
        // /by-uhid/ — that endpoint doesn't exist and silently 404'd,
        // so AGE/SEX/CONTACT still showed "—" after the first fix.
        axios.get(`${API_ENDPOINTS.BASE}/patients/uhid/${encodeURIComponent(patient.UHID)}`).catch(() => null),
        admissionId
          ? axios.get(`${API_ENDPOINTS.BASE}/admissions/${admissionId}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      const patBody = patR?.data?.data || patR?.data || null;
      const admBody = admR?.data?.data || admR?.data || null;
      const allSales = salesR?.data?.data || [];
      // Filter to this admission (sales carry admissionId) and exclude
      // cancelled rows so the ledger reflects active charges only.
      const adm = String(admissionId);
      const mine = allSales.filter(s =>
        String(s.admissionId || "") === adm && s.status !== "Cancelled"
      );
      setSales(mine);
      // /billing/advance/uhid/:uhid varies in shape across builds — could
      // return an array directly, { data: [...] }, { data: { items: [...] }},
      // or a single summary object. Normalise to an array so the reduce()
      // in totals never throws.
      const advRaw = advR?.data?.data ?? advR?.data ?? [];
      const advArr = Array.isArray(advRaw)
        ? advRaw
        : Array.isArray(advRaw?.items)    ? advRaw.items
        : Array.isArray(advRaw?.advances) ? advRaw.advances
        : Array.isArray(advRaw?.deposits) ? advRaw.deposits
        : advRaw && typeof advRaw === "object"
          ? [advRaw]   // single summary object — wrap so KPI shows it
          : [];
      setAdvances(advArr);
      // R7hr-7: Enrich patient state with age/sex/contact (from Patient
      // master) + consulting doctor (from Admission). Without these the
      // consolidated bill print showed AGE/SEX "—", CONTACT "—", DOCTOR
      // "—" because the page only carried what the indent button passed
      // via query string.
      // R7hr-7-FIX-2: Admission model stores the attending doctor in
      // `doctorName` (line 16 of admissionModel.js), NOT `consultantName`.
      // Without this alias the consolidated bill still showed
      // DOCTOR "—" even after the patient lookup was fixed.
      // Also walk `patBody.contact?.mobile` / `.email` / `.address.city`
      // and `patBody.dateOfBirth` → age, since the patient master nests
      // these instead of keeping them flat at the root.
      const ageFromDob = (dob) => {
        if (!dob) return "";
        const d = new Date(dob); if (isNaN(d)) return "";
        const ms = Date.now() - d.getTime();
        return String(Math.max(0, Math.floor(ms / (365.25 * 24 * 3600 * 1000))));
      };
      setPatient(p => ({
        ...p,
        patientName:     mine[0]?.patientName     || patBody?.fullName || patBody?.firstName || patBody?.patientName || p.patientName,
        admissionNumber: mine[0]?.admissionNumber || admBody?.admissionNumber || p.admissionNumber,
        age:             patBody?.age || patBody?.ageYears || ageFromDob(patBody?.dateOfBirth || patBody?.dob) || p.age || "",
        gender:          patBody?.gender || patBody?.sex || p.gender || "",
        contactNumber:   patBody?.contactNumber || patBody?.mobile || patBody?.phone || patBody?.contact?.mobile || patBody?.contact?.phone || p.contactNumber || "",
        consultant:      admBody?.doctorName || admBody?.consultantName || admBody?.consultingDoctor || admBody?.attendingDoctorName || p.consultant || "",
        bed:             p.bed || [admBody?.bedNumber, admBody?.wardName].filter(Boolean).join(" · "),
      }));
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || "Failed to load pharmacy ledger");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [admissionId, patient.UHID]);

  /* ── Derived totals (pharmacy only) ─────────────────────────── */
  const totals = useMemo(() => {
    let billed = 0, paid = 0, outstanding = 0;
    for (const s of sales) {
      billed      += dec(s.grandTotal);
      paid        += dec(s.amountPaid);
      outstanding += dec(s.balanceDue);
    }
    const advanceBalance = advances.reduce((sum, a) => sum + dec(a.remainingAmount ?? a.balance ?? a.amount), 0);
    return { billed, paid, outstanding, advanceBalance };
  }, [sales, advances]);

  /* ── Group by day for day-wise view ─────────────────────────── */
  const byDay = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      const k = dateKey(s.createdAt);
      const cur = m.get(k) || { date: s.createdAt, sales: [], total: 0, paid: 0, due: 0 };
      cur.sales.push(s);
      cur.total += dec(s.grandTotal);
      cur.paid  += dec(s.amountPaid);
      cur.due   += dec(s.balanceDue);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
  }, [sales]);

  /* ── Collect Payment submit ─────────────────────────────────── */
  const submitCollect = async () => {
    const amt = Number(colAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.warn("Enter an amount > 0");
    if (collect && amt > collect.max + 0.01) return toast.warn(`Amount exceeds bill outstanding (${fmtINR(collect.max)})`);
    setColSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/pharmacy/sales/${collect.sale._id}/collect-credit`, {
        amount: amt, mode: colMode, txnRef: colTxn,
      });
      toast.success(`Collected ${fmtINR(amt)} via ${colMode}`);
      setCollect(null); setColAmt(""); setColTxn("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally { setColSaving(false); }
  };

  /* ── R7hr-5: Apply advance against an outstanding bill ───────── */
  // `applyingId` tracks the in-flight sale to disable the button + show a
  // spinner; null when idle. We call the new POST /pharmacy/sales/:id/
  // apply-advance endpoint, which decrements the patient's PatientAdvance
  // pool atomically and pushes a "Advance" row into the sale's
  // collectionLog (sourceAdvanceId back-link).
  const [applyingId, setApplyingId] = useState(null);
  const applyAdvanceToSale = async (sale, applyAmount /* optional */) => {
    setApplyingId(sale._id);
    try {
      const body = applyAmount != null ? { amount: applyAmount } : {};
      const r = await axios.post(
        `${API_ENDPOINTS.BASE}/pharmacy/sales/${sale._id}/apply-advance`,
        body,
      );
      const applied = r?.data?.meta?.applied ?? 0;
      toast.success(`Applied ${fmtINR(applied)} from advance`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally {
      setApplyingId(null);
    }
  };

  /* ── R7hr-5: Re-print a pharmacy bill ────────────────────────── */
  // Same hook the Dispense flow uses (openPrint("pharmacy-bill", …))
  // so a re-print from the ledger comes out identical to the original
  // bill issued at counter time. We pass the seed patient identity so
  // the header is filled even when the sale record doesn't carry every
  // patient field.
  const printSaleBill = (sale) => {
    openPrint("pharmacy-bill", {
      ...sale,
      patientName:     sale.patientName     || patient.patientName,
      patientUHID:     sale.patientUHID     || sale.UHID || patient.UHID,
      admissionNumber: sale.admissionNumber || patient.admissionNumber,
      bedNumber:       sale.bedNumber       || patient.bed,
      consultantName:  sale.consultantName  || patient.consultant,
      doctorName:      sale.doctorName      || patient.consultant,
      // R7hr-7: same patient + preparer enrichment as the consolidated
      // print so individual re-prints aren't degraded vs counter receipts.
      age:             sale.age           || patient.age,
      gender:          sale.gender        || patient.gender,
      contactNumber:   sale.contactNumber || patient.contactNumber,
      preparedBy:      sale.preparedBy    || user?.fullName || user?.name || "",
      counter:         sale.counter       || user?.fullName || user?.employeeId || "",
    });
  };

  /* ── R7hr-6: Consolidated interim / final pharmacy bill ──────── */
  // Flattens every dispense for this admission into a single payload
  // the existing PharmacyBill template can render. `billLabel` drives
  // the document header — "INTERIM PHARMACY BILL" (running total
  // printable at any time) vs "FINAL PHARMACY BILL" (issued at
  // settlement, locked tone). Mirrors the IPD Live Ledger's
  // interim-vs-final flow.
  const buildConsolidatedPayload = (label) => {
    const items = sales
      .filter(s => s.status !== "Cancelled")
      .flatMap(s => (s.items || []).map(it => ({
        ...it,
        // R7hr-7: PharmacySale.items defaults discountAmount /
        // taxableAmount / gstAmount to Decimal128(0) and stores batch
        // under `batchNumber`. The template's `!= null` ternary was
        // accepting the 0 as a literal — strip those Decimal128(0)
        // fields here so per-line Amount and totalTaxable/GST are
        // computed from gross instead of frozen at ₹0. We also alias
        // batchNumber → batchNo and expiryDate → expiry so the columns
        // populate (template fallback chain now covers both).
        discountAmount: undefined,
        taxableAmount:  undefined,
        gstAmount:      undefined,
        batchNo:        it.batchNo || it.batchNumber,
        expiry:         it.expiry || it.expiryDate,
        // Stamp the source bill on each line so the consolidated
        // print can show "Paracetamol 1g × 6 (PHM-26-0007, 04 Jun)"
        // without losing the per-dispense breadcrumb.
        sourceBillNumber: s.billNumber,
        sourceDate: s.createdAt,
      })));
    const subTotal    = sales.reduce((acc, s) => acc + dec(s.subTotal),   0);
    const grandTotal  = sales.reduce((acc, s) => acc + dec(s.grandTotal), 0);
    const amountPaid  = sales.reduce((acc, s) => acc + dec(s.amountPaid), 0);
    const balanceDue  = sales.reduce((acc, s) => acc + dec(s.balanceDue), 0);
    const collectionLog = sales.flatMap(s => s.collectionLog || []);
    const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const prefix = label.startsWith("FINAL") ? "FNL" : "INT";
    // R7hr-7: bill number now `FNL-PHM-IPD2602-260604` (strip the hyphen
    // inside the admission number so the document slug stays scannable).
    const admSlug = (patient.admissionNumber || "").replace(/[^A-Z0-9]/gi, "");
    return {
      billLabel: label,
      billNumber: `${prefix}-PHM-${admSlug || yymmdd}-${yymmdd}`,
      saleType: "IPD",
      patientName:     patient.patientName,
      patientUHID:     patient.UHID,
      UHID:            patient.UHID,
      // R7hr-7: pass age/sex/contact/doctor so the patient strip on the
      // print shows real values instead of "—".
      age:             patient.age,
      gender:          patient.gender,
      contactNumber:   patient.contactNumber,
      doctorName:      patient.consultant,
      consultantName:  patient.consultant,
      admissionNumber: patient.admissionNumber,
      bedNumber:       patient.bed,
      // R7hr-7: "Prepared by" + "Counter" from the logged-in user so
      // the print carries real provenance instead of "Pharmacist"
      // placeholder text.
      preparedBy:      user?.fullName || user?.name || "",
      counter:         user?.fullName || user?.employeeId || "",
      items,
      subTotal,
      grandTotal,
      amountPaid,
      balanceDue,
      collectionLog,
      paymentMode: balanceDue > 0 ? "Credit" : "Mixed",
      createdAt: new Date(),
      isConsolidated: true,
      consolidatedFrom: sales.length,
      note: label.startsWith("FINAL")
        ? `Final settlement bill — consolidated of ${sales.length} dispense(s) on this admission.`
        : `Running total · ${sales.length} dispense(s) to date · final bill issued at settlement.`,
    };
  };
  const printInterimBill = () => {
    if (!sales.length) return toast.warn("No pharmacy charges yet — nothing to print");
    openPrint("pharmacy-bill", buildConsolidatedPayload("INTERIM PHARMACY BILL"));
  };
  const printFinalBill = () => {
    if (!sales.length) return toast.warn("No pharmacy charges yet — nothing to print");
    if (totals.outstanding > 0) {
      const ok = window.confirm(
        `Outstanding ${fmtINR(totals.outstanding)} still pending.\n` +
        `A "Final" bill normally means everything is settled.\n\nPrint Final anyway?`
      );
      if (!ok) return;
    }
    openPrint("pharmacy-bill", buildConsolidatedPayload("FINAL PHARMACY BILL"));
  };

  /* ── Take Advance Deposit submit ────────────────────────────── */
  const submitAdvance = async () => {
    const amt = Number(advAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.warn("Enter an amount > 0");
    setAdvSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/billing/advance`, {
        UHID: patient.UHID,
        admissionId,
        amount: amt,
        paymentMode: advMode,
        paymentRef: advTxn,
        purpose: "Pharmacy advance",
        source: "Pharmacy",
      });
      toast.success(`Advance ${fmtINR(amt)} deposited`);
      setAdvOpen(false); setAdvAmt(""); setAdvTxn("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally { setAdvSaving(false); }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  // In embedded mode the parent tab supplies the page chrome, so we
  // drop the full-page background + min-height + outer padding to avoid
  // a "page-inside-page" double frame.
  return (
    <div style={embedded
      ? { padding: 0, background: "transparent" }
      : { padding: 18, background: C.bg, minHeight: "100vh" }}>
      <div style={embedded ? { width: "100%" } : { maxWidth: 1280, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div>
            <button onClick={goBack} style={{
              padding: "5px 12px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, marginBottom: 10,
            }}>
              <i className="pi pi-arrow-left" style={{ marginRight: 5 }} /> {embedded ? "Back to list" : "Back"}
            </button>
            <h1 style={{ margin: 0, fontSize: 22, color: C.text, fontWeight: 800 }}>
              <i className="pi pi-receipt" style={{ marginRight: 8, color: C.orange }} />
              Pharmacy Ledger
            </h1>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Pharmacy charges only · Hospital-wide bill is not visible here
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* R7hr-6: Interim Bill — running total of every dispense
                printable any time. Greyed when there's nothing on the
                ledger yet. */}
            <button onClick={printInterimBill} disabled={!sales.length} style={{
              padding: "9px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: sales.length ? "pointer" : "not-allowed",
              opacity: sales.length ? 1 : 0.55,
            }}>
              <i className="pi pi-file" style={{ marginRight: 5 }} /> Interim Bill
            </button>
            {/* R7hr-6: Final Bill — consolidated settlement print.
                Highlighted green when outstanding === 0 (the natural
                "ready to issue" moment); muted otherwise but still
                callable behind a confirm() guard for edge cases. */}
            <button onClick={printFinalBill} disabled={!sales.length} style={{
              padding: "9px 16px",
              background: totals.outstanding === 0 && sales.length ? C.green : "#fff",
              color:      totals.outstanding === 0 && sales.length ? "#fff"   : C.green,
              border: `1.5px solid ${C.green}`,
              borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: sales.length ? "pointer" : "not-allowed",
              opacity: sales.length ? 1 : 0.55,
            }}>
              <i className="pi pi-check-square" style={{ marginRight: 5 }} /> Final Bill
            </button>
            <button onClick={() => setAdvOpen(true)} style={{
              padding: "9px 16px", background: "#fff", color: C.blue, border: `1.5px solid ${C.blue}`,
              borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
              <i className="pi pi-plus-circle" style={{ marginRight: 6 }} /> Take Advance
            </button>
            <button onClick={load} style={{
              padding: "9px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
            }}>
              <i className="pi pi-refresh" style={{ marginRight: 4 }} /> Refresh
            </button>
          </div>
        </div>

        {/* Patient banner */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14,
          marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
        }}>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Patient</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginTop: 2 }}>{patient.patientName || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>UHID · IPD No</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
              {patient.UHID} · {patient.admissionNumber || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Bed</div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{patient.bed || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Consultant</div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{patient.consultant || "—"}</div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          {[
            { label: "Pharmacy Billed",      value: totals.billed,      color: C.text,   icon: "pi-shopping-cart" },
            { label: "Collected (Pharmacy)", value: totals.paid,        color: C.green,  icon: "pi-check-circle" },
            { label: "Outstanding",          value: totals.outstanding, color: C.red,    icon: "pi-exclamation-triangle" },
            { label: "Advance Balance",      value: totals.advanceBalance, color: C.blue, icon: "pi-wallet" },
          ].map((k, i) => (
            <div key={i} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: `${k.color}15`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`pi ${k.icon}`} style={{ fontSize: 18, color: k.color }} />
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: k.color, marginTop: 2 }}>{fmtINR(k.value)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* R7hr-5: Auto-suggest advance application when there's both
            outstanding pharmacy charges AND an advance balance available.
            One-click [Apply ₹X] surfaces a Cash-flow that mirrors what the
            IPD Live Ledger does for ward-level bills. */}
        {totals.advanceBalance > 0 && totals.outstanding > 0 && (() => {
          const applyAmt = Math.min(totals.advanceBalance, totals.outstanding);
          // Pick the oldest outstanding sale to consume first — matches
          // the FIFO behaviour the backend uses internally.
          const targetSale = sales
            .filter(s => dec(s.balanceDue) > 0)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
          return (
            <div style={{
              background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10,
              padding: "12px 16px", marginBottom: 14, display: "flex",
              alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <i className="pi pi-wallet" style={{ fontSize: 18, color: "#a16207" }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#78350f" }}>
                  Patient has {fmtINR(totals.advanceBalance)} advance available
                </div>
                <div style={{ fontSize: 11.5, color: "#92400e", marginTop: 2 }}>
                  Outstanding {fmtINR(totals.outstanding)} — apply {fmtINR(applyAmt)} from
                  advance to clear {applyAmt >= totals.outstanding ? "the full bill" : "the oldest bill first"}.
                </div>
              </div>
              {targetSale && (
                <button
                  onClick={() => applyAdvanceToSale(targetSale, applyAmt)}
                  disabled={applyingId === targetSale._id}
                  style={{
                    padding: "9px 18px", background: "#a16207", color: "#fff", border: "none",
                    borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
                    minWidth: 150,
                  }}
                >
                  <i className={`pi ${applyingId === targetSale._id ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ marginRight: 6 }} />
                  {applyingId === targetSale._id ? "Applying…" : `Apply ${fmtINR(applyAmt)}`}
                </button>
              )}
            </div>
          );
        })()}

        {/* Day-wise medicines */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div style={{
            padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: "#fafbfc",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
              <i className="pi pi-calendar" style={{ marginRight: 6, color: C.orange }} />
              Medicines Dispensed — Day-wise
            </h2>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
              {sales.length} bill{sales.length === 1 ? "" : "s"} · {byDay.length} day{byDay.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Loading…</div>
          ) : byDay.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
              No pharmacy charges for this admission yet.
            </div>
          ) : (
            byDay.map(day => (
              <div key={dateKey(day.date)} style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{
                  padding: "10px 16px", background: "#fcfcfd",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderBottom: `1px dashed ${C.border}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    <i className="pi pi-calendar-times" style={{ marginRight: 6, color: C.orange, fontSize: 11 }} />
                    {dateLabel(day.date)}
                  </div>
                  <div style={{ display: "flex", gap: 18, fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    <span>Billed: <strong style={{ color: C.text }}>{fmtINR(day.total)}</strong></span>
                    <span>Paid: <strong style={{ color: C.green }}>{fmtINR(day.paid)}</strong></span>
                    {day.due > 0 && <span>Due: <strong style={{ color: C.red }}>{fmtINR(day.due)}</strong></span>}
                  </div>
                </div>
                {day.sales.map(sale => {
                  const due = dec(sale.balanceDue);
                  return (
                    <div key={sale._id} style={{ padding: "10px 16px", borderBottom: `1px dashed ${C.border}` }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        fontSize: 12, marginBottom: 6,
                      }}>
                        <div>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: C.text }}>
                            {sale.billNumber}
                          </span>
                          <span style={{ color: C.muted, marginLeft: 8 }}>
                            {new Date(sale.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span style={{
                            marginLeft: 8, padding: "1px 7px", borderRadius: 8, fontSize: 9.5, fontWeight: 700,
                            background: due > 0 ? "#fef3c7" : "#dcfce7",
                            color:      due > 0 ? "#a16207" : "#15803d",
                            textTransform: "uppercase", letterSpacing: ".3px",
                          }}>
                            {due > 0 ? "Partial" : "Paid"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                          <span style={{ color: C.muted, fontSize: 11 }}>
                            Total <strong style={{ color: C.text }}>{fmtINR(sale.grandTotal)}</strong> ·
                            Paid <strong style={{ color: C.green, marginLeft: 4 }}>{fmtINR(sale.amountPaid)}</strong> ·
                            Due <strong style={{ color: due > 0 ? C.red : C.muted, marginLeft: 4 }}>{fmtINR(due)}</strong>
                          </span>
                          {/* R7hr-5: per-row Apply-advance shortcut.
                              Shown only when this bill is unpaid AND the
                              patient has any advance balance. Mirrors the
                              IPD Live Ledger's per-row action affordance. */}
                          {due > 0 && totals.advanceBalance > 0 && (
                            <button
                              onClick={() => applyAdvanceToSale(sale, Math.min(due, totals.advanceBalance))}
                              disabled={applyingId === sale._id}
                              title={`Apply ${fmtINR(Math.min(due, totals.advanceBalance))} from advance`}
                              style={{
                                padding: "4px 10px", background: "#a16207", color: "#fff", border: "none",
                                borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                              }}>
                              <i className={`pi ${applyingId === sale._id ? "pi-spin pi-spinner" : "pi-wallet"}`} style={{ marginRight: 4, fontSize: 10 }} />
                              {applyingId === sale._id ? "…" : "Apply Adv"}
                            </button>
                          )}
                          {due > 0 && (
                            <button onClick={() => { setCollect({ sale, max: due }); setColAmt(due.toFixed(2)); }} style={{
                              padding: "4px 12px", background: C.green, color: "#fff", border: "none",
                              borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            }}>
                              <i className="pi pi-money-bill" style={{ marginRight: 4, fontSize: 10 }} /> Collect
                            </button>
                          )}
                          {/* R7hr-5: re-print the pharmacy bill regardless
                              of paid/due — pharmacist may need a duplicate
                              for a returning patient or ward audit. */}
                          <button onClick={() => printSaleBill(sale)} title="Print pharmacy bill" style={{
                            padding: "4px 10px", background: "#fff", color: C.blue, border: `1px solid ${C.blue}`,
                            borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          }}>
                            <i className="pi pi-print" style={{ marginRight: 4, fontSize: 10 }} /> Print
                          </button>
                        </div>
                      </div>
                      {Array.isArray(sale.items) && sale.items.length > 0 && (
                        <div style={{ paddingLeft: 14, fontSize: 11, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {sale.items.map((it, i) => (
                            <span key={i} style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
                              {it.drugName || it.itemName} × {it.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Collect Payment modal ── */}
      {collect && (
        <div onClick={() => !colSaving && setCollect(null)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, width: 460, maxWidth: "92vw", padding: 22,
          }}>
            <h3 style={{ margin: "0 0 4px 0", color: C.green, fontSize: 16 }}>
              <i className="pi pi-money-bill" style={{ marginRight: 6 }} />
              Collect Payment
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              Bill {collect.sale.billNumber} · Outstanding <strong>{fmtINR(collect.max)}</strong>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Amount</label>
                <input type="number" autoFocus value={colAmt} onChange={e => setColAmt(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, marginTop: 3 }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Mode</label>
                <select value={colMode} onChange={e => setColMode(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                  {["Cash","Card","UPI","Mixed"].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {colMode !== "Cash" && (
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {colMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                  </label>
                  <input value={colTxn} onChange={e => setColTxn(e.target.value.slice(0, 64))}
                    placeholder={colMode === "Card" ? "•••• 1234" : "UTR / VPA / PSP ref"}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3, fontFamily: "'DM Mono', monospace" }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setCollect(null)} disabled={colSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: colSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitCollect} disabled={colSaving} style={{
                padding: "8px 18px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: colSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${colSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                {colSaving ? "Saving…" : "Collect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Take Advance modal ── */}
      {advOpen && (
        <div onClick={() => !advSaving && setAdvOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, width: 460, maxWidth: "92vw", padding: 22,
          }}>
            <h3 style={{ margin: "0 0 4px 0", color: C.blue, fontSize: 16 }}>
              <i className="pi pi-wallet" style={{ marginRight: 6 }} />
              Take Advance Deposit
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              {patient.patientName} · UHID {patient.UHID} · Pharmacy advance pool
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Amount</label>
                <input type="number" autoFocus value={advAmt} onChange={e => setAdvAmt(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, marginTop: 3 }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Mode</label>
                <select value={advMode} onChange={e => setAdvMode(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                  {["Cash","Card","UPI","Mixed"].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {advMode !== "Cash" && (
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {advMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                  </label>
                  <input value={advTxn} onChange={e => setAdvTxn(e.target.value.slice(0, 64))}
                    placeholder={advMode === "Card" ? "•••• 1234" : "UTR / VPA / PSP ref"}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3, fontFamily: "'DM Mono', monospace" }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setAdvOpen(false)} disabled={advSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: advSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitAdvance} disabled={advSaving} style={{
                padding: "8px 18px", background: C.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: advSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${advSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                {advSaving ? "Saving…" : "Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
