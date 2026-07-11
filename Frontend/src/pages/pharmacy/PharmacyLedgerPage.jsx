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
 * Routed at /pharmacy/ledger/:admissionId. The Live Indents page passes
 * patient identity via React Router history-state (location.state) so
 * the page renders identity instantly while sales fetch in the
 * background. On direct navigation / page refresh (no state present)
 * the page hydrates identity from GET /admissions/:admissionId.
 *
 * R7hr-12 (D9-01): patient identifiers (UHID, name, IPD admission no,
 * bed/ward, consultant) used to ride in the URL query string and were
 * captured by browser history, access logs and analytics beacons.
 * Removed — only the opaque admissionId ObjectId remains in the URL.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
// R7hr-12 (D9-01): switched from useSearchParams → useLocation so the
// Live-Indents → Live-Ledger seed travels via history-state instead of
// URL query string. PHI must never appear in window.location.
import { useParams, useLocation, useNavigate } from "react-router-dom";
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
  blue:   "#4f46e5",
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
  // R7hr-12 (D9-01): history-state seed (from PharmacyIndentsPage's
  // navigate(..., { state: { seedPatient } })). location.state is
  // attached to the History API entry, NOT the URL — so PHI never
  // touches window.location, browser history bar, access logs or any
  // analytics beacon that snapshots the URL.
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth() || {};

  // Prop wins over route param so the parent can mount any admission's
  // ledger in-place. Both are present in route mode — useParams() returns
  // the captured segment; the prop is undefined.
  const admissionId = admIdProp || routeParams.admissionId;

  // Patient identity. Seed priority:
  //   1. Explicit `seedPatient` prop (embedded-tab mode in PharmacyHomePage)
  //   2. React Router history-state seed (Live-Indents click)
  //   3. Empty placeholder — load() will hydrate from
  //      GET /admissions/:admissionId and GET /patients/uhid/:uhid
  // R7hr-12: removed query-string fallback that previously read
  // search.get("uhid"|"name"|"ipd"|"bed"|"doc"). PHI in URLs was a P0
  // leak — see PHARMACY_AUDIT_R7hr-12.json finding D9-01.
  const stateSeed = location.state?.seedPatient;
  const [patient, setPatient] = useState(() => seedPatient || stateSeed || {
    UHID:            "",
    patientName:     "",
    admissionNumber: "",
    bed:             "",
    consultant:      "",
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

  // R7hr-13 — Refund Advance modal state.
  // The receptionist /ReceptionBilling already had this flow but the
  // pharmacist did not — they couldn't return the unspent portion of a
  // patient's advance without leaving the pharmacy module. The modal
  // picks one advance row with remaining balance (FIFO default), takes
  // amount + reason + refund mode, then calls the existing
  // POST /api/billing/advance/:advanceId/refund endpoint and prints a
  // refund-receipt slip (same template used by ReceptionBilling +
  // AccountsConsole — UI consistency for the patient-facing print).
  const [refOpen, setRefOpen]   = useState(false);
  const [refAdvId, setRefAdvId] = useState("");      // chosen advance _id
  const [refAmt, setRefAmt]     = useState("");
  const [refReason, setRefReason] = useState("");
  // R7hr(TPA-UI): NABH-P3.5 refund-to-kin capture (optional).
  const [refToName, setRefToName] = useState("");
  const [refToRel,  setRefToRel]  = useState("");
  const [refMode, setRefMode]   = useState("CASH");
  const [refTxn, setRefTxn]     = useState("");
  const [refSaving, setRefSaving] = useState(false);
  const refundableAdvances = useMemo(() => advances
    .filter(a => a && a.status !== "REFUNDED" && a.status !== "CANCELLED")
    .map(a => {
      const total    = dec(a.amount);
      const applied  = dec(a.appliedAmount);
      const refunded = dec(a.refundedAmount);
      const remaining = Math.max(0, +(total - applied - refunded).toFixed(2));
      return { ...a, remaining };
    })
    .filter(a => a.remaining > 0)
    .sort((x, y) => new Date(x.createdAt || x.paidAt || 0) - new Date(y.createdAt || y.paidAt || 0)),
  [advances]);

  // R7hr-12-S3 (D9-04): AbortController for the 4-way load() fetch.
  // Mirrors PharmacyIndentsPage.jsx L96-L143 — abort any in-flight
  // request before kicking off a new one (route param change, manual
  // Refresh click) and on unmount, so a slow first-admission fetch
  // can't paint stale patientName/admissionNumber over a freshly-
  // selected second admission. In React 19 unmounted state setters
  // are silent no-ops (no console warning), but the brief
  // wrong-banner flash on a route-mode admission switch was still
  // worth closing for hygiene + parity with the rest of the
  // pharmacy module.
  const loadAbortRef = useRef(null);

  const load = async () => {
    if (!admissionId) {
      // No admission target at all — render the banner empty + back btn.
      setLoading(false);
      return;
    }
    // Cancel any prior in-flight load before launching a new one.
    if (loadAbortRef.current) { try { loadAbortRef.current.abort(); } catch (_) {} }
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true);
    try {
      // R7hr-12 (D9-01): fetch the admission FIRST so we can hydrate UHID
      // from the route param alone. Previously load() bailed early when
      // `patient.UHID` was empty, but now that the URL no longer carries
      // PHI, that early-return would have produced a permanent blank
      // page on direct navigation / refresh. The admission body carries
      // UHID + patientName + admissionNumber + bedNumber/wardName +
      // attendingDoctor, so this single fetch is enough to drive
      // everything downstream.
      const admR = await axios
        .get(`${API_ENDPOINTS.BASE}/admissions/${admissionId}`, { signal: ctrl.signal })
        .catch((e) => {
          // Re-throw abort so the outer catch can swallow it silently;
          // other failures still resolve to null (legacy fallback).
          if (e?.name === "CanceledError" || e?.name === "AbortError" || axios.isCancel?.(e)) throw e;
          return null;
        });
      const admBody = admR?.data?.data || admR?.data || null;

      // UHID priority: explicit seed (prop / history-state) wins so we
      // don't refetch identity the parent already provided; otherwise
      // pull it from the admission body.
      const uhid = patient.UHID || admBody?.UHID || "";
      if (!uhid) {
        // Admission lookup failed AND no seed — surface a useful error
        // instead of silently hanging on a blank banner.
        toast.error("Could not resolve patient for this admission");
        setLoading(false);
        return;
      }

      // Pull all pharmacy sales for this UHID, then filter to this
      // admission. Avoids needing a new backend endpoint and keeps
      // the contract identical to the OPD Rx page's dup-dispense
      // lookup added in R7hp-4.
      // R7hr-7: pull patient identity too so the consolidated bill
      // renders Age/Sex/Contact/Doctor instead of "—".
      // Both fetches are best-effort — they fall through gracefully
      // when the endpoints don't exist for retail-mode deployments.
      // R7hr-12-S3 (D9-09): pass `admissionId` to the sales fetch so
      // long-stay patients (oncology, dialysis, chronic geriatrics)
      // with > 500 lifetime sales can't have their oldest IPD days
      // silently dropped by the limit=500 ceiling — we then only
      // pull rows for THIS admission instead of the patient's full
      // history. The client still keeps the post-fetch
      // String(s.admissionId) === adm filter for defence-in-depth in
      // case the deployed backend hasn't been updated yet to honour
      // the param (the param is additive — older backends ignore it).
      const [salesR, advR, patR] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/pharmacy/sales`, {
          params: { uhid, admissionId, limit: 500 },
          signal: ctrl.signal,
        }),
        axios.get(`${API_ENDPOINTS.BASE}/billing/advance/uhid/${encodeURIComponent(uhid)}`, { signal: ctrl.signal })
          .catch((e) => {
            if (e?.name === "CanceledError" || e?.name === "AbortError" || axios.isCancel?.(e)) throw e;
            return { data: { data: [] } };
          }),
        // R7hr-7-FIX-2: correct path is /patients/uhid/:uhid (was
        // /by-uhid/ — that endpoint doesn't exist and silently 404'd,
        // so AGE/SEX/CONTACT still showed "—" after the first fix.
        axios.get(`${API_ENDPOINTS.BASE}/patients/uhid/${encodeURIComponent(uhid)}`, { signal: ctrl.signal })
          .catch((e) => {
            if (e?.name === "CanceledError" || e?.name === "AbortError" || axios.isCancel?.(e)) throw e;
            return null;
          }),
      ]);
      const patBody = patR?.data?.data || patR?.data || null;
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
        // R7hr-12 (D9-01): UHID is now hydrated from the admission body
        // (or first sale) rather than from the URL query string. Falls
        // back to the seed (prop / history-state) so we don't blank an
        // already-known UHID if the admission fetch shape changes.
        UHID:            uhid || admBody?.UHID || mine[0]?.patientUHID || p.UHID,
        patientName:     mine[0]?.patientName     || patBody?.fullName || patBody?.firstName || patBody?.patientName || admBody?.patientName || p.patientName,
        admissionNumber: mine[0]?.admissionNumber || admBody?.admissionNumber || p.admissionNumber,
        age:             patBody?.age || patBody?.ageYears || ageFromDob(patBody?.dateOfBirth || patBody?.dob) || p.age || "",
        gender:          patBody?.gender || patBody?.sex || p.gender || "",
        contactNumber:   patBody?.contactNumber || patBody?.mobile || patBody?.phone || patBody?.contact?.mobile || patBody?.contact?.phone || admBody?.contactNumber || p.contactNumber || "",
        // R7hr-7-FIX3: real admission field is `attendingDoctor`
        // (string name, line 196 of admissionModel.js). The earlier
        // `doctorName` lookup was a comment red-herring — that field
        // only exists nested inside treatmentTeam[].doctorName.
        consultant:      admBody?.attendingDoctor || admBody?.doctorName || admBody?.consultantName || admBody?.consultingDoctor || (admBody?.treatmentTeam?.[0]?.doctorName) || p.consultant || "",
        // PD-01 (sprint review fix): hydrate address + tpa from the patient
        // master body so the AdvanceReceipt demographic strip has something to
        // read — previously these were never captured, so the enrichment below
        // was inert (address blank, payer always "Self").
        address:         patBody?.address || admBody?.address || p.address || null,
        tpa:             patBody?.tpa || admBody?.tpa || p.tpa || null,
        bed:             p.bed || [admBody?.bedNumber, admBody?.wardName].filter(Boolean).join(" · "),
      }));
    } catch (e) {
      // R7hr-12-S3 (D9-04): silently swallow aborted requests — they're
      // the expected outcome of a re-fired load() or unmount, not a
      // user-facing error.
      if (e?.name === "CanceledError" || e?.name === "AbortError" || axios.isCancel?.(e)) return;
      toast.error(e?.response?.data?.message || e.message || "Failed to load pharmacy ledger");
    } finally {
      // Only flip loading off when this controller is still the active
      // one — otherwise a fresh load() already turned it back on.
      if (loadAbortRef.current === ctrl) setLoading(false);
    }
  };
  // R7hr-12 (D9-01): keyed on admissionId alone — load() now derives
  // UHID from the admission body itself, so we don't need to re-run
  // when patient.UHID flips from "" → resolved. Previously the deps
  // included patient.UHID to retry once the URL query string seed
  // arrived, but that pathway is gone.
  // R7hr-12-S3 (D9-04): cleanup returns an abort so a slow fetch
  // mid-unmount can't write to dead state. Mirrors the pattern at
  // PharmacyIndentsPage.jsx L143.
  useEffect(() => {
    load();
    return () => {
      if (loadAbortRef.current) { try { loadAbortRef.current.abort(); } catch (_) {} }
    };
    /* eslint-disable-next-line */
  }, [admissionId]);

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
    // R7hr-12-S2 (D9-03): require a txn-ref for any non-cash mode so the
    // collection row is reconciliable against bank/PSP statements. Empty
    // colTxn on a Card/UPI/Mixed receipt creates a permanent unverifiable
    // audit row (the value is persisted into Sale.collectionLog[].txnRef
    // and emitted into ClinicalAudit.after.txnRef) — exactly the NABH
    // MOM.4 / GST §35 evidentiary gap the audit flagged. UI already hides
    // the field for Cash; this guard makes it mandatory for everything
    // else.
    if (colMode !== "Cash" && !String(colTxn || "").trim()) {
      return toast.warn(`Txn reference required for ${colMode} collection`);
    }
    setColSaving(true);
    try {
      // R7hr-12-S2 (D4-04): capture the response so we can extract the
      // freshly-pushed collectionLog row (carries the backend-issued
      // PHM-COLL-YY-NNNN receiptNumber generated atomically inside the
      // retryVersionError block in pharmacyController.collectCredit).
      // Mirrors the reception payment-receipt flow at ReceptionBilling
      // L1207-L1249 — every payment recorded must hand the patient a
      // printable slip (NABH AAC.7 / IMS.2). Pre-R7hr-12 the receipt
      // number was generated, stored, and silently discarded.
      const r = await axios.post(
        `${API_ENDPOINTS.BASE}/pharmacy/sales/${collect.sale._id}/collect-credit`,
        { amount: amt, mode: colMode, txnRef: colTxn },
      );
      const updatedSale = r?.data?.data || r?.data || null;
      toast.success(`Collected ${fmtINR(amt)} via ${colMode}`);
      // Fire the payment receipt before clearing modal state so we keep
      // a reference to the collected sale + amount. openPrint stashes the
      // payload into sessionStorage + opens a new tab, so it's safe to
      // continue with state resets immediately after the call returns.
      try {
        const lastCol = Array.isArray(updatedSale?.collectionLog) && updatedSale.collectionLog.length
          ? updatedSale.collectionLog[updatedSale.collectionLog.length - 1]
          : null;
        const receiptNo =
          (lastCol && lastCol.receiptNumber) ||
          `${updatedSale?.billNumber || collect.sale.billNumber}-COLL`;
        const newBalance = Number(
          updatedSale?.balanceDue?.$numberDecimal ??
          updatedSale?.balanceDue ??
          Math.max(0, collect.max - amt),
        );
        openPrint("payment-receipt", {
          receiptNo,
          patientName:  patient.patientName,
          uhid:         patient.UHID,
          visitType:    "IPD",
          visitNo:      patient.admissionNumber,
          ipdNo:        patient.admissionNumber,
          age:          patient.age,
          gender:       patient.gender,
          amount:       amt,
          method:       colMode,
          refNo:        colTxn || "",
          receivedBy:   user?.fullName || user?.name || "Pharmacy",
          paidAt:       new Date().toISOString(),
          purpose:      newBalance <= 0.005
            ? `Full settlement of pharmacy bill ${updatedSale?.billNumber || collect.sale.billNumber}`
            : `Part-payment towards pharmacy bill ${updatedSale?.billNumber || collect.sale.billNumber}`,
          billTotal:    Number(updatedSale?.grandTotal?.$numberDecimal ?? updatedSale?.grandTotal ?? collect.sale.grandTotal ?? 0),
          totalPaid:    Number(updatedSale?.amountPaid?.$numberDecimal ?? updatedSale?.amountPaid ?? 0),
          runningBalance: newBalance,
          remarks:      "",
          // PrintAudit anchor — use the existing PharmacyBill entity type
          // so PharmacySale.printCount tracks per-bill reprints. The
          // entityNumber carries the receipt number so the audit row is
          // unambiguous in the print register.
          printAudit: {
            entityType:   "PharmacyBill",
            entityId:     updatedSale?._id || collect.sale._id,
            entityNumber: receiptNo,
            UHID:         patient.UHID,
            patientName:  patient.patientName,
          },
        });
      } catch (_) { /* print failure non-blocking */ }
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
  // R7hr-11: state-based `applyingId` only gates AFTER React re-renders;
  // a fast double-click before the next frame can still fire the handler
  // twice. The synchronous ref-mutex below short-circuits the 2nd call
  // immediately. Backend is also transactional now (R7hr-11 controller
  // refactor) so a slipped duplicate would just throw ALREADY_PAID without
  // over-debiting the advance, but defence-in-depth at the UI gives the
  // user a clean "already in flight" experience.
  const applyMutexRef   = React.useRef(new Set());
  const applyAdvanceToSale = async (sale, applyAmount /* optional */) => {
    if (applyMutexRef.current.has(String(sale._id))) return;
    applyMutexRef.current.add(String(sale._id));
    setApplyingId(sale._id);
    try {
      const body = applyAmount != null ? { amount: applyAmount } : {};
      const r = await axios.post(
        `${API_ENDPOINTS.BASE}/pharmacy/sales/${sale._id}/apply-advance`,
        body,
      );
      const applied = r?.data?.meta?.applied ?? 0;
      const advanceRemaining = r?.data?.meta?.advanceRemaining ?? 0;
      toast.success(`Applied ${fmtINR(applied)} from advance`);
      // R7hr-12-S2 (D4-04): print a payment receipt after a successful
      // advance application. Backend pushes a {mode:"Advance"} row onto
      // sale.collectionLog with a fresh PHM-COLL-YY-NNNN receiptNumber
      // (atomic counter inside the withTransaction block at
      // pharmacyController.applyAdvanceToSale L1744-L1804) — that receipt
      // was being generated and silently discarded. Patient now walks
      // away from the credit-clearance counter with paper proof of the
      // advance-deduction, closing the NABH AAC.7 / IMS.2 audit gap.
      try {
        const updatedSale = r?.data?.data || null;
        const lastCol = Array.isArray(updatedSale?.collectionLog) && updatedSale.collectionLog.length
          ? updatedSale.collectionLog[updatedSale.collectionLog.length - 1]
          : null;
        const receiptNo =
          (lastCol && lastCol.receiptNumber) ||
          `${updatedSale?.billNumber || sale.billNumber}-ADV`;
        const newBalance = Number(
          updatedSale?.balanceDue?.$numberDecimal ??
          updatedSale?.balanceDue ??
          Math.max(0, dec(sale.balanceDue) - applied),
        );
        if (applied > 0) {
          openPrint("payment-receipt", {
            receiptNo,
            patientName:  patient.patientName,
            uhid:         patient.UHID,
            visitType:    "IPD",
            visitNo:      patient.admissionNumber,
            ipdNo:        patient.admissionNumber,
            age:          patient.age,
            gender:       patient.gender,
            amount:       applied,
            method:       "cash", // method drives the styling chip; "Advance"
                                  // isn't a METHOD_STYLE key in PaymentReceipt
                                  // so we tag the purpose line with the
                                  // ADVANCE-APPLIED context instead.
            refNo:        "",
            receivedBy:   user?.fullName || user?.name || "Pharmacy",
            paidAt:       new Date().toISOString(),
            purpose:      newBalance <= 0.005
              ? `Advance applied — full settlement of pharmacy bill ${updatedSale?.billNumber || sale.billNumber}`
              : `Advance applied towards pharmacy bill ${updatedSale?.billNumber || sale.billNumber}`,
            billTotal:    Number(updatedSale?.grandTotal?.$numberDecimal ?? updatedSale?.grandTotal ?? sale.grandTotal ?? 0),
            totalPaid:    Number(updatedSale?.amountPaid?.$numberDecimal ?? updatedSale?.amountPaid ?? 0),
            runningBalance: newBalance,
            remarks:      `Advance pool remaining: ${fmtINR(advanceRemaining)}`,
            // PrintAudit anchor — see comment in submitCollect above.
            printAudit: {
              entityType:   "PharmacyBill",
              entityId:     updatedSale?._id || sale._id,
              entityNumber: receiptNo,
              UHID:         patient.UHID,
              patientName:  patient.patientName,
            },
          });
        }
      } catch (_) { /* print failure non-blocking */ }
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally {
      setApplyingId(null);
      applyMutexRef.current.delete(String(sale._id));
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
      // R7hr-12-S2 (D7-04): forward ward + saleType so the IPD-context
      // strip in PharmacyBill surfaces Ward and gates correctly on IPD.
      wardName:        sale.wardName        || patient.wardName || patient.ward,
      saleType:        sale.saleType        || "IPD",
      consultantName:  sale.consultantName  || patient.consultant,
      doctorName:      sale.doctorName      || patient.consultant,
      // R7hr-7: same patient + preparer enrichment as the consolidated
      // print so individual re-prints aren't degraded vs counter receipts.
      age:             sale.age           || patient.age,
      gender:          sale.gender        || patient.gender,
      contactNumber:   sale.contactNumber || patient.contactNumber,
      preparedBy:      sale.preparedBy    || user?.fullName || user?.name || "",
      counter:         sale.counter       || user?.fullName || user?.employeeId || "",
      // R7hr-12-S2 (D7-05): PrintAudit anchor for per-sale reprints from
      // the ledger. Pre-fix the spread `...sale` carried the stored
      // printCount snapshot but reprints from THIS page never POST'd to
      // /api/print-audit (no printAudit block on the payload), so the
      // counter never advanced — the same audit row was reproducible
      // indefinitely. Anchoring on PharmacySale._id makes
      // pharmacy-bill reprints from the ledger bump
      // PharmacySale.printCount and surface the DUPLICATE watermark on
      // every reprint past the first. Mirrors the pattern at
      // PharmacyHomePage L1152/L1441/L1564/L1594/L1821.
      printAudit: {
        entityType:   "PharmacyBill",
        entityId:     sale._id,
        entityNumber: sale.billNumber,
        UHID:         sale.patientUHID || sale.UHID || patient.UHID,
        patientName:  sale.patientName  || patient.patientName,
      },
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
    const prefix = label.startsWith("FINAL") ? "FNL" : "INT";
    // R7hr-12-S3 (D7-12): use the FULL sanitized admission number after
    // the prefix instead of a 4-char trailing slice. The earlier
    // "trailing 4 chars" approach (R7hr-7-FIX3) collided on two scenarios:
    //   1. Cross-year same-day: IPD-26-0102 vs IPD-27-0102 both → "0102"
    //      → `INT-PHM-0102` on both bills.
    //   2. Blank admissionNumber: the MMDD fallback collides every year
    //      on the same calendar day for any walk-in/anonymous record.
    // Full sanitized admission number (`INT-PHM-IPD26-0102`) is unique
    // by construction. When admissionNumber is unavailable we widen the
    // fallback to YYMMDD+HHMM so two same-day reprints for two different
    // blank-IPD records still get distinct numbers. Reprints of the same
    // running interim still resolve to the same admission-based number
    // (it IS the same document); a final is issued once per admission so
    // no collision risk on that side either.
    const admSlug = (patient.admissionNumber || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    // YYMMDDHHMM — finer than the prior MMDD fallback so anonymous
    // records minted minutes apart don't share a bill number.
    const fallback = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
    const billNumber = `${prefix}-PHM-${admSlug || fallback}`;
    return {
      billLabel: label,
      billNumber,
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
      // R7hr-12-S2 (D7-04): pass wardName too so the PharmacyBill's
      // IPD-context strip renders Ward instead of perpetual "—".
      wardName:        patient.wardName || patient.ward,
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
      // R7hr-12-S2 (D7-05): PrintAudit anchor. Consolidated INT/FNL
      // bills span multiple PharmacySale rows so they have no single
      // backing entity. We register a new `PharmacyConsolidatedBill`
      // entity type in PrintAuditModel/ENTITY_MODEL (backend) that
      // anchors on admissionId. ENTITY_MODEL maps it to `null` so
      // printCount falls back to a count of prior PrintAudit rows for
      // the same admission anchor — i.e. each admission has its own
      // duplicate counter for the INT/FNL document family without
      // polluting Admission.printCount (which IPDFile/MARSheet use).
      // Pre-R7hr-12 these reprints silently skipped audit entirely:
      // FINAL PHARMACY BILL could be reprinted 30 times without a
      // single audit row or DUPLICATE watermark — exactly the GST
      // §48(4) / NABH duplicate-copy violation the audit flagged.
      printAudit: {
        entityType:   "PharmacyConsolidatedBill",
        entityId:     admissionId,
        // R7hr-12-S3 (D7-12): use the same hoisted billNumber so the
        // PrintAudit row matches the document header verbatim.
        entityNumber: billNumber,
        UHID:         patient.UHID,
        patientName:  patient.patientName,
      },
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
    // R7hr-12-S2 (D9-03): require a txn-ref for any non-cash advance so
    // the deposit row is reconciliable against bank/PSP statements. Same
    // rationale as submitCollect — empty advTxn on a cashless advance
    // creates a permanent unverifiable audit row (NABH MOM.4 / GST §35
    // evidentiary gap). The patientAdvanceService backend currently only
    // "soft-warns" on missing transactionId (services/Billing/
    // patientAdvanceService.js L65-L70), so this UI guard is the first
    // enforceable gate.
    if (advMode !== "Cash" && !String(advTxn || "").trim()) {
      return toast.warn(`Txn reference required for ${advMode} advance`);
    }
    setAdvSaving(true);
    try {
      const r = await axios.post(`${API_ENDPOINTS.BASE}/billing/advance`, {
        UHID: patient.UHID,
        admissionId,
        amount: amt,
        paymentMode: advMode,
        paymentRef: advTxn,
        purpose: "Pharmacy advance",
        source: "Pharmacy",
      });
      toast.success(`Advance ${fmtINR(amt)} deposited`);
      // R7hr-12-S3 (D9-10): auto-print the AdvanceReceipt after a
      // successful deposit. Every other money-mutating action in the
      // module (dispense, refund, collect-credit, apply-advance) auto-
      // prints — advance deposit was the lone hole. A patient handing
      // over cash for an advance expects paper proof for their records,
      // for corporate / TPA settlement, and for the pharmacist to
      // attach to the day-end register (NABH MOM.4 / AAC.7). Payload
      // mirrors ReceptionBilling's printAdvanceReceipt at L148-L179
      // so the print looks identical regardless of origin. Wrapped in
      // try/catch so a popup-blocked print failure doesn't surface as
      // a deposit error.
      try {
        const adv = r?.data?.data || r?.data || null;
        const receiptNo  = adv?.receiptNumber || `ADV-${Date.now()}`;
        const paidAt     = adv?.paidAt || adv?.createdAt || new Date().toISOString();
        const fullName   = [patient.title, patient.patientName].filter(Boolean).join(" ");
        openPrint("advance-receipt", {
          receiptNo,
          patientName:   fullName || patient.patientName,
          uhid:          patient.UHID,
          ipdNo:         patient.admissionNumber,
          admissionDate: patient.admissionDate || null,
          bedNumber:     patient.bed || null,
          wardName:      patient.wardName || patient.ward || null,
          gender:        patient.gender || "",
          age:           patient.age || "",
          contactNumber: patient.contactNumber || patient.mobile || "",
          // PD-01 (sprint review fix): compose from the real address sub-fields
          // (now hydrated above) — never fall back to the raw object
          // ([object Object]). patient.tpa may be a populated object (tpaName||
          // name) or absent -> "Self".
          completeAddress: patient.address?.completeAddress
                             || [patient.address?.city, patient.address?.district, patient.address?.state]
                                .filter(Boolean).join(", ")
                             || "",
          payer:         patient.tpa?.tpaName || patient.tpa?.name || patient.payer || "Self",
          doctor:        patient.consultant || "",
          date:          paidAt,
          amount:        amt,
          method:        advMode,
          refNo:         advTxn || "",
          depositPurpose: "Pharmacy advance",
          preparedBy:    user?.fullName || user?.name || "Pharmacy",
          // R7bh-F1 / META-1: PrintAudit anchor — bumps printCount on the
          // underlying PatientAdvance so reprints render the DUPLICATE
          // watermark and a row lands in the PrintAudit register.
          printAudit: {
            entityType:   "AdvanceReceipt",
            entityId:     adv?._id,
            entityNumber: receiptNo,
            UHID:         patient.UHID,
            patientName:  fullName || patient.patientName,
          },
        });
      } catch (_) { /* print failure non-blocking */ }
      setAdvOpen(false); setAdvAmt(""); setAdvTxn("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally { setAdvSaving(false); }
  };

  /* ── R7hr-13: Refund Advance — open + submit + print receipt ─ */
  // Mirror-mutex against fast double-clicks (same pattern as R7hr-11
  // applyAdvanceToSale fix). Backend already has idempotencyGuard but
  // the UI sub-frame race would still create confusing toast spam.
  const refundMutexRef = useRef(false);
  const openRefundModal = () => {
    if (!refundableAdvances.length) {
      return toast.warn("No refundable advance — patient pool is empty or fully applied");
    }
    const first = refundableAdvances[0];
    setRefAdvId(String(first._id));
    setRefAmt(first.remaining.toFixed(2));
    setRefReason("");
    setRefMode("CASH");
    setRefTxn("");
    setRefToName("");
    setRefToRel("");
    setRefOpen(true);
  };
  const submitRefund = async () => {
    if (refundMutexRef.current) return;
    const amt = Number(refAmt);
    if (!Number.isFinite(amt) || amt <= 0)   return toast.warn("Enter an amount > 0");
    if (!refReason.trim())                    return toast.warn("Reason is required (NABH audit trail)");
    if (!refAdvId)                            return toast.warn("Pick an advance row");
    const chosen = refundableAdvances.find(a => String(a._id) === String(refAdvId));
    if (!chosen)                              return toast.warn("Selected advance is no longer refundable — refresh");
    if (amt > chosen.remaining + 0.01)        return toast.warn(`Max refundable on this row is ${fmtINR(chosen.remaining)}`);
    if ((refMode === "UPI" || refMode === "BANK_TRANSFER") && !refTxn.trim()) {
      return toast.warn("Transaction reference required for UPI / Bank Transfer");
    }
    refundMutexRef.current = true;
    setRefSaving(true);
    try {
      const r = await axios.post(
        `${API_ENDPOINTS.BASE}/billing/advance/${refAdvId}/refund`,
        {
          amount: amt,
          refundReason: refReason.trim(),
          mode: refMode,
          transactionId: refTxn.trim() || undefined,
          refundedToName: refToName.trim() || undefined,
          refundedToRelation: refToRel.trim() || undefined,
        },
      );
      const refunded = r?.data?.data || r?.data || chosen;
      toast.success(`Refunded ${fmtINR(amt)} from advance`);
      // Print refund slip — matches the "refund-receipt" slug used by
      // ReceptionBilling's printAdvanceRefundReceipt + AccountsConsole
      // so the patient-facing print looks identical across all three
      // origin points.
      try {
        openPrint("refund-receipt", {
          receiptNo:        `${(refunded.receiptNumber || chosen.receiptNumber || "ADV")}-RF`,
          patientName:      patient.patientName,
          uhid:             patient.UHID,
          admissionNumber:  patient.admissionNumber,
          bedNumber:        patient.bed,
          consultantName:   patient.consultant,
          age:              patient.age,
          gender:           patient.gender,
          contactNumber:    patient.contactNumber,
          refundAmount:     amt,
          refundMode:       refMode,
          refundReason:     refReason.trim(),
          transactionId:    refTxn.trim(),
          refundedAt:       refunded.refundedAt || new Date().toISOString(),
          sourceReceiptNo:  chosen.receiptNumber,
          sourceMethod:     chosen.paymentMode,
          sourceAmount:     dec(chosen.amount),
          originalApplied:  dec(chosen.appliedAmount),
          originalRefunded: dec(refunded.refundedAmount ?? amt),
          refundedBy:       (user && (user.fullName || user.userName)) || "Pharmacy",
          counterNo:        (user && (user.counter || user.counterNo)) || "PH-1",
          purpose:          "Pharmacy advance refund",
        });
      } catch (_) { /* print failure non-blocking */ }
      setRefOpen(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally {
      setRefSaving(false);
      refundMutexRef.current = false;
    }
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
            {/* R7hr-13: Refund Advance — surfaces only when the patient
                pool has an unspent balance. Grey when empty so the slot
                stays predictable but un-clickable. Print fires on
                success (same refund-receipt slug as ReceptionBilling). */}
            <button
              onClick={openRefundModal}
              disabled={totals.advanceBalance <= 0}
              title={totals.advanceBalance > 0
                ? `Refund up to ${fmtINR(totals.advanceBalance)} from advance pool`
                : "No unspent advance available to refund"}
              style={{
                padding: "9px 16px",
                background: "#fff",
                color: totals.advanceBalance > 0 ? "#b45309" : C.muted,
                border: `1.5px solid ${totals.advanceBalance > 0 ? "#b45309" : C.border}`,
                borderRadius: 8, fontWeight: 700, fontSize: 12,
                cursor: totals.advanceBalance > 0 ? "pointer" : "not-allowed",
                opacity: totals.advanceBalance > 0 ? 1 : 0.55,
              }}>
              <i className="pi pi-undo" style={{ marginRight: 6 }} /> Refund Advance
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
          alignItems: "center", justifyContent: "center", zIndex: 1100,
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
                  {/* R7hr-12-S2 (D9-03): show explicit "Required" on the
                      label so the cashier sees the validation rule before
                      hitting Submit. submitCollect blocks empty values
                      for any non-Cash mode. */}
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {colMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                    <span style={{ color: "#dc2626", marginLeft: 4 }}>* Required</span>
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
          alignItems: "center", justifyContent: "center", zIndex: 1100,
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
                  {/* R7hr-12-S2 (D9-03): show explicit "Required" on the
                      label so the cashier sees the validation rule
                      before hitting Submit. submitAdvance blocks empty
                      values for any non-Cash mode. */}
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {advMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                    <span style={{ color: "#dc2626", marginLeft: 4 }}>* Required</span>
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

      {/* ── R7hr-13: Refund Advance modal ── */}
      {refOpen && (
        <div onClick={() => !refSaving && setRefOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1100,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, width: 520, maxWidth: "94vw", padding: 22,
          }}>
            <h3 style={{ margin: "0 0 4px 0", color: "#b45309", fontSize: 16 }}>
              <i className="pi pi-undo" style={{ marginRight: 6 }} />
              Refund Advance
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              {patient.patientName} · UHID {patient.UHID} · Returns unspent advance + prints receipt
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                  Advance row
                </label>
                <select value={refAdvId} onChange={e => {
                  setRefAdvId(e.target.value);
                  const a = refundableAdvances.find(x => String(x._id) === e.target.value);
                  if (a) setRefAmt(a.remaining.toFixed(2));
                }} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                  {refundableAdvances.map(a => (
                    <option key={a._id} value={a._id}>
                      {(a.receiptNumber || "ADV").toString()} · deposited {fmtINR(dec(a.amount))} · remaining {fmtINR(a.remaining)} · {a.paymentMode || ""}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Refund amount</label>
                  <input type="number" autoFocus value={refAmt} onChange={e => setRefAmt(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Refund mode</label>
                  <select value={refMode} onChange={e => setRefMode(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                    {["CASH", "UPI", "BANK_TRANSFER"].map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                  Reason <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input value={refReason} onChange={e => setRefReason(e.target.value.slice(0, 240))}
                  placeholder="NABH audit trail — e.g. patient discharged with advance unspent"
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }} />
              </div>
              {(refMode === "UPI" || refMode === "BANK_TRANSFER") && (
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    Txn reference {refMode === "UPI" ? "(UPI ref)" : "(NEFT/IMPS UTR)"}
                  </label>
                  <input value={refTxn} onChange={e => setRefTxn(e.target.value.slice(0, 64))}
                    placeholder={refMode === "UPI" ? "UPI ref" : "NEFT/IMPS UTR"}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3, fontFamily: "'DM Mono', monospace" }} />
                </div>
              )}
              {/* R7hr(TPA-UI): refund-to-kin — actual recipient when not the patient */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    Received by (if not patient)
                  </label>
                  <input value={refToName} onChange={e => setRefToName(e.target.value.slice(0, 120))}
                    placeholder="Recipient's full name"
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    Relation to patient
                  </label>
                  <input value={refToRel} onChange={e => setRefToRel(e.target.value.slice(0, 60))}
                    placeholder="e.g. Son, Wife"
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setRefOpen(false)} disabled={refSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: refSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitRefund} disabled={refSaving} style={{
                padding: "8px 18px", background: "#b45309", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: refSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${refSaving ? "pi-spin pi-spinner" : "pi-print"}`} style={{ marginRight: 5 }} />
                {refSaving ? "Refunding…" : "Refund + Print"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
