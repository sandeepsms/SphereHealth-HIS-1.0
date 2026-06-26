/**
 * ICUBundlesPage.jsx — R7eg / R7ei
 *
 * Bundles of Care — ICU. One screen, one workflow:
 *   1. Auto-loads patient via location.state.uhid (useUhidFromLocation)
 *   2. Date + shift selector (Morning / Evening / Night)
 *   3. Six expandable bundle cards (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP)
 *   4. Each card: "Applicable to this patient?" toggle + checkbox list
 *      + per-item notes
 *   5. Live overall compliance % bar (green ≥90, amber 70–90, red <70)
 *   6. "Save Draft" + "Finalize Shift" + "Carry Forward From Previous Shift"
 *   7. R7ei — Recent Sheets panel (last 30 days), collapsible. Clicking
 *      a row jumps to that date+shift.
 *   8. R7ei — Hindi labels for headings + buttons + shift names.
 *   9. R7ei — Finalize soft-block when any bundle is at 0% compliance.
 *  10. R7ei — beforeunload guard fires when localItems has unsaved edits.
 *
 * Backend: /api/icu-bundles (one sheet per admission per date+shift).
 * Save / finalize emit ClinicalAudit events that feed the NABH HIC.5
 * Infection Control register.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import "../../Components/clinical/clinical-forms.css";
import { useAuth } from "../../context/AuthContext";
import { useUhidFromLocation } from "../../hooks/useUhidFromLocation";
import { API_ENDPOINTS } from "../../config/api";
import {
  getList, getByDateShift, upsertSheet, toggleItem, finalize,
  BUNDLE_DEFS, SHIFTS,
} from "../../Services/icuBundleService";

// R7ei — Bilingual string helper (no JSX). Used in window.confirm() /
// toast dialogs where we can't render React fragments. Falls back to
// English-only if hi is empty.
//
// Note: most user-facing JSX in this file (header / buttons / shift
// labels / bundle headings) renders the Hindi line as an explicit
// `<span>` sibling so the typography (size, weight, opacity) can be
// tuned per element — a single JSX helper would be too rigid.
const tStr = (en, hi) => (hi ? `${en}\n${hi}` : en);

// Hindi labels for the 3 shifts. Kept as a lookup so the same labels
// are reused on the shift selector + history panel + carry-forward
// confirmation.
const SHIFT_HI = { Morning: "प्रातः", Evening: "सायंकाल", Night: "रात्रि" };

// Hindi labels for the 6 bundle keys (clinical-term-style transliteration).
const BUNDLE_HI = {
  vap:    "वीएपी — वेंटिलेटर-संबंधी निमोनिया",
  cauti:  "सीएयूटीआई — कैथेटर-संबंधी मूत्र संक्रमण",
  clabsi: "सीएलएबीएसआई — सेंट्रल लाइन रक्त-संक्रमण",
  dvt:    "डीवीटी रोकथाम",
  sepsis: "सेप्सिस — एक-घंटा बंडल",
  sup:    "एसयूपी — स्ट्रेस अल्सर रोकथाम",
};

// Emerald/teal palette — matches the "quality / IC" tone for this page
// while keeping the layout primitives identical to DiabeticChartPage.
const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  green: "#16a34a", greenL: "#dcfce7",
  emerald: "#059669", emeraldL: "#d1fae5",
  teal: "#0d9488", tealL: "#ccfbf1",
  blue: "#4f46e5", blueL: "#eef2ff",
  slate: "#475569", slateL: "#f1f5f9",
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
// Heuristic default shift based on wall-clock — saves the nurse a tap
// when the page opens during the shift it's about to chart.
const defaultShift = () => {
  const h = new Date().getHours();
  if (h >= 7  && h < 14) return "Morning";
  if (h >= 14 && h < 21) return "Evening";
  return "Night";
};
// Prior shift in the rotation — used by the Carry Forward button to
// find the most recent saved sheet for the same admission.
const prevShift = (shift, date) => {
  if (shift === "Morning") {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
      shift: "Night",
    };
  }
  if (shift === "Evening") return { date, shift: "Morning" };
  return { date, shift: "Evening" }; // Night ← Evening (same day)
};

// R7hr-232 — the three bundles whose applicability is driven by an invasive
// device (VAP←ET/trach, CAUTI←Foley, CLABSI←central/PICC). The rest
// (DVT/Sepsis/SUP) are not device-linked and park in "Extra Bundle ▾".
const DEVICE_DRIVEN = new Set(["vap", "cauti", "clabsi"]);

function complianceTone(pct) {
  if (pct >= 90) return { color: C.green,   bg: C.greenL,   label: "Excellent" };
  if (pct >= 70) return { color: C.amber,   bg: C.amberL,   label: "Needs review" };
  return            { color: C.red,     bg: C.redL,     label: "Below target" };
}

export default function ICUBundlesPage() {
  const { user } = useAuth();
  const token = sessionStorage.getItem("his_token");
  const headers = { Authorization: `Bearer ${token}` };

  const [uhidIn,   setUhidIn]   = useState("");
  const [patient,  setPatient]  = useState(null);   // admission record
  const [date,     setDate]     = useState(todayISO());
  const [shift,    setShift]    = useState(defaultShift());
  const [sheet,    setSheet]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // Which bundle cards are expanded — by default expand the first two.
  const [expanded, setExpanded] = useState(() => ({ vap: true, cauti: true }));
  // R7hr-232 — extra (non-primary) bundles the nurse has pulled in from the
  // "Extra Bundle ▾" picker this session, plus whether that menu is open.
  const [revealed, setRevealed]   = useState(() => new Set());
  const [extraOpen, setExtraOpen] = useState(false);
  // Per-card local drafts so toggles feel instant even when the PATCH
  // is in-flight. Resets when the sheet is refetched.
  const [localItems, setLocalItems] = useState({}); // { [bundleKey]: { [itemKey]: { checked, notes } } }
  const [notes, setNotes] = useState("");
  // R7ei — Recent Sheets history (last 30 days) for the current UHID.
  // Loaded once per patient change and refreshed after every successful
  // saveDraft / finalize.
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  // R7ei — Snapshot of the last-saved state. Compared against
  // (localItems + notes) to decide whether the beforeunload guard
  // should fire. Reset on every successful save/finalize.
  const savedSnapshotRef = useRef({ localItems: {}, notes: "" });
  // Anchor for "scroll into view" after a history-row click.
  const editorTopRef = useRef(null);

  /* ── Read UHID from location.state (or scrubbed legacy URL) ── */
  const uhidFromLocation = useUhidFromLocation();
  useEffect(() => {
    if (uhidFromLocation && uhidFromLocation.trim()) {
      setUhidIn(uhidFromLocation.trim());
      loadPatient(uhidFromLocation.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhidFromLocation]);

  /* ── Reload sheet whenever patient / date / shift changes ── */
  useEffect(() => {
    if (patient?.UHID && date && shift) loadSheet(patient.UHID, date, shift, patient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.UHID, date, shift]);

  /* ── R7ei — Load last-30-day history on patient change ── */
  useEffect(() => {
    if (patient?.UHID) loadHistory(patient.UHID);
    else setHistory([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.UHID]);

  /* ── R7hr-184 — Invasive-device registry drives bundle applicability ──
     VAP ← ET tube / Tracheostomy · CAUTI ← Urinary catheter (Foley) ·
     CLABSI ← Central line / PICC. Devices are recorded by doctor/nurse
     on the patient banner (Doctor Notes / Nursing Notes header). */
  const [devices, setDevices] = useState(null); // null = not loaded yet
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!patient?._id) { setDevices(null); return; }
      try {
        const res = await axios.get(
          `${API_ENDPOINTS.BASE}/patient-devices/admission/${patient._id}?status=Active`,
          { headers },
        );
        if (!dead) setDevices(Array.isArray(res.data?.data) ? res.data.data : []);
      } catch (_) {
        // Soft fail — bundles stay manually toggleable if the registry
        // can't be read (older backend / role without mar.read).
        if (!dead) setDevices(null);
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?._id]);

  // Which active device satisfies each device-driven bundle (if any).
  const deviceFor = useMemo(() => {
    if (!Array.isArray(devices)) return null; // registry unavailable
    const find = (...types) => devices.find(d => types.includes(d.deviceType)) || null;
    return {
      vap:    find("ET_TUBE", "TRACHEOSTOMY"),
      cauti:  find("URINARY_CATHETER"),
      clabsi: find("CENTRAL_LINE", "PICC_LINE"),
    };
  }, [devices]);

  /* ── R7hr-232 — device-driven bundle VISIBILITY ──────────────────
     When the device registry is readable, only the bundles relevant to THIS
     patient stay on screen as cards:
       • a device-driven bundle (VAP/CAUTI/CLABSI) shows when its device is
         attached; with no device it drops into "Extra Bundle ▾".
       • the non-device bundles (DVT/Sepsis/SUP) start in "Extra Bundle ▾" and
         the nurse pulls them in when clinically indicated.
     A bundle already charted/signed is NEVER hidden. When the registry can't
     be read we fall back to showing every bundle (pre-R7hr-232 behaviour). */
  const registryReady = !!deviceFor;
  const bundleCharted = useCallback((key) => {
    const b = sheet?.[key];
    if (!b) return false;
    if (b.signedAt) return true;
    return Array.isArray(b.items) && b.items.some(i => i.checked);
  }, [sheet]);
  const isPrimaryBundle = useCallback((key) => {
    if (!registryReady) return true;             // registry unavailable → show all
    if (revealed.has(key)) return true;          // nurse pulled it from Extra
    if (bundleCharted(key)) return true;         // never hide existing work
    if (DEVICE_DRIVEN.has(key)) return !!deviceFor[key];
    return false;                                // DVT/Sepsis/SUP park in Extra
  }, [registryReady, revealed, bundleCharted, deviceFor]);
  const bundleSplit = useMemo(() => ({
    primary: BUNDLE_DEFS.filter(d => isPrimaryBundle(d.key)),
    extra:   BUNDLE_DEFS.filter(d => !isPrimaryBundle(d.key)),
  }), [isPrimaryBundle]);
  const revealBundle = (key) => {
    setRevealed(prev => { const n = new Set(prev); n.add(key); return n; });
    setApplicable(key, true);                    // make it active for charting + %
    setExpanded(p => ({ ...p, [key]: true }));   // open the card
    setExtraOpen(false);
  };

  // Auto-seed applicable flags from the registry — once per loaded
  // sheet+devices combination so a manual save isn't fought mid-edit.
  // Finalized sheets are never touched.
  const deviceSeedRef = useRef("");
  useEffect(() => {
    if (!sheet || sheet.status === "finalized" || !deviceFor) return;
    const sig = `${sheet._id || "new"}|${sheet.date}|${sheet.shift}|${(devices || []).map(d => d._id).join(",")}`;
    if (deviceSeedRef.current === sig) return;
    deviceSeedRef.current = sig;
    for (const key of ["vap", "cauti", "clabsi"]) {
      const want = !!deviceFor[key];
      const has  = sheet?.[key]?.applicable !== false;
      if (has !== want) setApplicable(key, want);
    }
    // R7hr-232 — park the non-device bundles (DVT/Sepsis/SUP) as N/A so they
    // sit in "Extra Bundle ▾" and don't drag the compliance %. Already-charted
    // bundles are left applicable; the nurse reveals any of them on demand.
    for (const key of ["dvt", "sepsis", "sup"]) {
      const b = sheet?.[key] || {};
      const charted = !!b.signedAt || (Array.isArray(b.items) && b.items.some(i => i.checked));
      if (charted) continue;
      if (b.applicable !== false) setApplicable(key, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?._id, sheet?.date, sheet?.shift, deviceFor]);

  /* ── R7ei — beforeunload guard while unsaved edits exist ── */
  useEffect(() => {
    const snap = savedSnapshotRef.current;
    const hasUnsaved =
      JSON.stringify(localItems) !== JSON.stringify(snap.localItems || {}) ||
      (notes || "") !== (snap.notes || "");
    if (!hasUnsaved) return;
    const handler = (e) => {
      e.preventDefault();
      // Modern browsers ignore the message string but require returnValue
      // to be set to anything non-empty to trigger the standard prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [localItems, notes]);

  const loadPatient = async (uhid) => {
    try {
      // ICU bundles are IPD-only — prefer a bedded admission.
      const res = await axios.get(
        `${API_ENDPOINTS.BASE}/admissions/active?hasBed=true&UHID=${encodeURIComponent(uhid)}`,
        { headers },
      );
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      const adm  = list[0];
      if (!adm) { toast.warn("No active admission for that UHID"); return; }
      setPatient(adm);
    } catch (e) {
      toast.error("Failed to load patient");
    }
  };

  const loadSheet = async (uhid, d, sh, adm) => {
    setLoading(true);
    try {
      const res = await getByDateShift(uhid, d, sh);
      let s = res?.data;
      if (!s) {
        // Create an empty sheet (seeds default checklists server-side).
        const created = await upsertSheet({
          UHID: uhid,
          admissionId: adm._id || adm.admissionId,
          patientId: adm.patientId?._id || adm.patientId,
          patientName: adm.patientName || adm.patientId?.fullName || "",
          admissionNumber: adm.admissionNumber,
          date: d, shift: sh,
        });
        s = created?.data;
      }
      setSheet(s);
      setLocalItems({});
      setNotes(s?.notes || "");
      // R7hr-232 — each sheet starts from the device-driven defaults.
      setRevealed(new Set());
      setExtraOpen(false);
      // R7ei — freshly-loaded sheet IS the saved baseline.
      savedSnapshotRef.current = { localItems: {}, notes: s?.notes || "" };
    } catch (e) {
      toast.error(e.message || "Failed to load bundles");
    } finally { setLoading(false); }
  };

  // R7ei — Recent Sheets (last 30 days). Best-effort; failure here
  // doesn't block the editor.
  const loadHistory = async (uhid) => {
    try {
      const res = await getList(uhid);
      setHistory(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      // Soft fail — the editor still works without the panel.
      setHistory([]);
    }
  };

  // R7ei — Jump to a specific date+shift row from the history panel.
  // Uses setDate / setShift directly (spec mentions setSelectedDate /
  // setSelectedShift — same setters under the local names).
  const openHistoryRow = (row) => {
    if (!row?.date || !row?.shift) return;
    setDate(row.date);
    setShift(row.shift);
    // Scroll the editor into view so the user knows the change took.
    requestAnimationFrame(() => {
      editorTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Build the merged view of items for a given bundle: server doc
  // overlaid with any local-only edits the user has made since last save.
  const itemsFor = useCallback((bundleKey) => {
    const def = BUNDLE_DEFS.find(b => b.key === bundleKey);
    const fromSheet = sheet?.[bundleKey]?.items || [];
    const fromLocal = localItems[bundleKey] || {};
    // Seed order from BUNDLE_DEFS so the UI is stable even if the
    // server doc was created with a different (legacy) order.
    return (def?.items || []).map(seed => {
      const onSheet = fromSheet.find(i => i.key === seed.key) || {};
      const local   = fromLocal[seed.key] || {};
      return {
        key: seed.key,
        label: seed.label,
        checked: local.checked !== undefined ? local.checked : !!onSheet.checked,
        notes:   local.notes   !== undefined ? local.notes   : (onSheet.notes || ""),
      };
    });
  }, [sheet, localItems]);

  const setLocalItem = (bundleKey, itemKey, patch) =>
    setLocalItems(prev => ({
      ...prev,
      [bundleKey]: {
        ...(prev[bundleKey] || {}),
        [itemKey]: { ...(prev[bundleKey]?.[itemKey] || {}), ...patch },
      },
    }));

  const setApplicable = (bundleKey, applicable) => {
    if (!sheet) return;
    setSheet(prev => ({
      ...prev,
      [bundleKey]: { ...(prev?.[bundleKey] || {}), applicable },
    }));
  };

  // ── Compliance live computation off the merged view ───────────────
  const compliance = useMemo(() => {
    const per = {};
    let total = 0;
    let count = 0;
    for (const def of BUNDLE_DEFS) {
      const applicable = sheet?.[def.key]?.applicable !== false;
      const items = itemsFor(def.key);
      if (!applicable) { per[def.key] = -1; continue; }
      if (items.length === 0) { per[def.key] = 0; continue; }
      const pct = Math.round((items.filter(i => i.checked).length / items.length) * 100);
      per[def.key] = pct;
      total += pct; count += 1;
    }
    const overall = count > 0 ? Math.round(total / count) : 0;
    return { per, overall };
  }, [sheet, itemsFor]);

  // ── Save draft ──────────────────────────────────────────────────
  const saveDraft = async () => {
    if (!sheet || saving) return;
    setSaving(true);
    try {
      // Build a partial bundles payload from the merged view.
      const payload = {
        UHID: sheet.UHID,
        admissionId: sheet.admissionId,
        patientId: sheet.patientId,
        patientName: sheet.patientName,
        admissionNumber: sheet.admissionNumber,
        date: sheet.date,
        shift: sheet.shift,
        notes,
      };
      for (const def of BUNDLE_DEFS) {
        payload[def.key] = {
          applicable: sheet?.[def.key]?.applicable !== false,
          items: itemsFor(def.key).map(i => ({
            key: i.key, label: i.label, checked: i.checked, notes: i.notes,
          })),
        };
      }
      const res = await upsertSheet(payload);
      setSheet(res.data);
      setLocalItems({});
      // R7ei — the just-saved server state IS the new baseline.
      savedSnapshotRef.current = { localItems: {}, notes: payload.notes || "" };
      // Refresh the Recent Sheets panel so the new row (or updated %)
      // shows up immediately.
      if (patient?.UHID) loadHistory(patient.UHID);
      toast.success("Draft saved");
    } catch (e) {
      toast.error(e.message || "Save failed");
    } finally { setSaving(false); }
  };

  // ── Finalize shift ───────────────────────────────────────────────
  const finalizeShift = async () => {
    if (!sheet || finalizing) return;
    if (sheet.status === "finalized") {
      toast.info("Shift already finalized");
      return;
    }
    if (!window.confirm(tStr(
      "Finalize this shift's bundles? You will not be able to edit after this.",
      "क्या आप इस शिफ्ट के बंडल फाइनलाइज़ करना चाहते हैं? इसके बाद संपादन संभव नहीं होगा।"
    ))) return;

    // R7ei — Stronger warning when any applicable bundle is at 0%.
    // -1 means the bundle is N/A (skipped from compliance), so filter
    // those out. compliance.per is already computed off the merged view.
    const zeroBundles = BUNDLE_DEFS
      .filter(def => compliance.per[def.key] === 0)
      .map(def => def.key.toUpperCase());
    if (zeroBundles.length > 0) {
      const ok = window.confirm(tStr(
        `You're about to finalize with ${zeroBundles.join(", ")} at 0% compliance.\nThis will register as missed care.\nContinue?`,
        `आप ${zeroBundles.join(", ")} को 0% अनुपालन पर फाइनलाइज़ करने जा रहे हैं।\nयह छूटी हुई देखभाल के रूप में दर्ज होगा।\nजारी रखें?`
      ));
      if (!ok) return;
    }

    setFinalizing(true);
    try {
      // Save any pending local edits first so the finalize sees the
      // latest checkbox state.
      await saveDraft();
      const res = await finalize(sheet._id);
      setSheet(res.data);
      // R7ei — finalized sheet is now the saved baseline; refresh history.
      savedSnapshotRef.current = { localItems: {}, notes: res.data?.notes || "" };
      if (patient?.UHID) loadHistory(patient.UHID);
      toast.success("Shift finalized");
    } catch (e) {
      toast.error(e.message || "Finalize failed");
    } finally { setFinalizing(false); }
  };

  // ── Carry forward from previous shift ───────────────────────────
  const carryForward = async () => {
    if (!patient || !sheet) return;
    if (sheet.status === "finalized") { toast.warn("Cannot edit a finalized shift"); return; }
    const prev = prevShift(shift, date);
    try {
      const res = await getByDateShift(patient.UHID, prev.date, prev.shift);
      const src = res?.data;
      if (!src) { toast.warn(`No saved sheet for ${prev.shift} (${prev.date})`); return; }
      // Copy applicable-flag + checked-state into local drafts so the
      // user can review before saving.
      const next = {};
      for (const def of BUNDLE_DEFS) {
        const srcBundle = src[def.key] || {};
        next[def.key] = {};
        for (const seed of def.items) {
          const srcItem = (srcBundle.items || []).find(i => i.key === seed.key);
          if (srcItem) next[def.key][seed.key] = { checked: !!srcItem.checked, notes: srcItem.notes || "" };
        }
      }
      // Also carry the applicable flags onto the current sheet view.
      setSheet(prev2 => {
        const updated = { ...prev2 };
        for (const def of BUNDLE_DEFS) {
          updated[def.key] = {
            ...(updated[def.key] || {}),
            applicable: src[def.key]?.applicable !== false,
          };
        }
        return updated;
      });
      // R7hr-232 — keep any carried-forward bundle visible even if it's a
      // non-device one, so the nurse can review the copied checks before save.
      setRevealed(prevSet => {
        const n = new Set(prevSet);
        for (const def of BUNDLE_DEFS) {
          if (src[def.key]?.applicable !== false) n.add(def.key);
        }
        return n;
      });
      setLocalItems(next);
      toast.success(`Carried forward from ${prev.shift} (${prev.date}) — review and save`);
    } catch (e) {
      toast.error(e.message || "Carry-forward failed");
    }
  };

  const locked = sheet?.status === "finalized";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{
          background: `linear-gradient(135deg, ${C.emerald}, ${C.teal})`,
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(5,150,105,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-shield" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Bundles of Care — ICU
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, opacity: .92, marginTop: 1 }}>
              आईसीयू देखभाल बंडल
            </div>
            <div style={{ fontSize: 12, opacity: .9, marginTop: 4 }}>
              VAP · CAUTI · CLABSI · DVT · Sepsis · SUP — NABH HIC.5 quality bundles
            </div>
          </div>
          {patient && (
            <div style={{ display: "flex", gap: 12, fontSize: 12, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {patient.patientName || patient.patientId?.fullName || patient.UHID}
                </div>
                <div style={{ opacity: .9, fontSize: 11 }}>
                  UHID {patient.UHID} · IPD {patient.admissionNumber || "—"}
                </div>
              </div>
              <button onClick={() => { setPatient(null); setSheet(null); setUhidIn(""); }}
                style={{
                  padding: "7px 12px", borderRadius: 8,
                  background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.3)",
                  color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer",
                }}>
                <i className="pi pi-refresh" style={{ fontSize: 10, marginRight: 4 }} />Change
              </button>
            </div>
          )}
        </div>

        {/* ── Patient search (when empty) ── */}
        {!patient && (
          <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1.5px solid ${C.border}`, marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <i className="pi pi-search" style={{ color: C.muted, fontSize: 14 }} />
            <input className="his-field" style={{ flex: 1, minWidth: 220 }}
              placeholder="Enter UHID to load ICU bundles…"
              value={uhidIn} onChange={e => setUhidIn(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadPatient(uhidIn.trim())} />
            <button onClick={() => loadPatient(uhidIn.trim())}
              style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: C.emerald, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              <i className="pi pi-arrow-circle-right" style={{ marginRight: 6 }} />Load Patient
            </button>
          </div>
        )}

        {/* ── Controls: date + shift selector + action buttons ── */}
        {patient && sheet && (
          <div style={{ background: C.card, borderRadius: 12, padding: "10px 14px", border: `1.5px solid ${C.border}`, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Date</label>
              <input type="date" className="his-field" style={{ width: 160 }}
                value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div style={{ width: 1, height: 22, background: C.border }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Shift</label>
              <div style={{ display: "flex", gap: 4 }}>
                {SHIFTS.map(s => (
                  <button key={s} onClick={() => setShift(s)}
                    title={SHIFT_HI[s] || s}
                    style={{
                      padding: "6px 12px", borderRadius: 7,
                      border: `1.5px solid ${shift === s ? C.emerald : C.border}`,
                      background: shift === s ? C.emeraldL : "#fff",
                      color: shift === s ? C.emerald : C.muted,
                      fontWeight: 700, fontSize: 11.5, cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1,
                    }}>
                    <span>{s}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>{SHIFT_HI[s]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            {locked ? (
              <span title="फाइनलाइज़्ड (Locked)" style={{
                padding: "6px 12px", borderRadius: 6, background: C.slateL,
                color: C.slate, fontSize: 11, fontWeight: 800,
                border: `1.5px solid ${C.border}`,
              }}>
                <i className="pi pi-lock" style={{ marginRight: 6, fontSize: 11 }} />FINALIZED
              </span>
            ) : (
              <>
                <button onClick={carryForward}
                  disabled={saving || finalizing}
                  title="पिछली शिफ्ट से कॉपी करें"
                  style={{
                    padding: "7px 12px", borderRadius: 8,
                    border: `1.5px solid ${C.blue}`,
                    background: "#fff", color: C.blue,
                    fontWeight: 700, fontSize: 12, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6, lineHeight: 1.1,
                  }}>
                  <i className="pi pi-arrow-right-arrow-left" style={{ fontSize: 11 }} />
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <span>Carry forward</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>आगे ले जाएं</span>
                  </span>
                </button>
                <button onClick={saveDraft}
                  disabled={saving || finalizing}
                  title="ड्राफ्ट सेव करें"
                  style={{
                    padding: "7px 12px", borderRadius: 8, border: "none",
                    background: saving ? "#94a3b8" : C.slate, color: "#fff",
                    fontWeight: 700, fontSize: 12, cursor: saving ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6, lineHeight: 1.1,
                  }}>
                  {saving ? (
                    <>
                      <i className="pi pi-spin pi-spinner" style={{ fontSize: 11 }} />
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <span>Saving…</span>
                        <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>सहेजा जा रहा है…</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <i className="pi pi-save" style={{ fontSize: 11 }} />
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <span>Save draft</span>
                        <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>ड्राफ्ट सहेजें</span>
                      </span>
                    </>
                  )}
                </button>
                <button onClick={finalizeShift}
                  disabled={saving || finalizing}
                  title="शिफ्ट फाइनलाइज़ करें"
                  style={{
                    padding: "7px 12px", borderRadius: 8, border: "none",
                    background: finalizing ? "#94a3b8" : C.emerald, color: "#fff",
                    fontWeight: 800, fontSize: 12, cursor: finalizing ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6, lineHeight: 1.1,
                  }}>
                  {finalizing ? (
                    <>
                      <i className="pi pi-spin pi-spinner" style={{ fontSize: 11 }} />
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <span>Finalizing…</span>
                        <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>फाइनलाइज़ हो रहा है…</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <i className="pi pi-check-circle" style={{ fontSize: 11 }} />
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <span>Finalize shift</span>
                        <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>शिफ्ट फाइनलाइज़ करें</span>
                      </span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Overall compliance bar ── */}
        {patient && sheet && (() => {
          const tone = complianceTone(compliance.overall);
          return (
            <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1.5px solid ${C.border}`, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
                  Overall Compliance
                </div>
                <span style={{
                  padding: "3px 9px", borderRadius: 4,
                  background: tone.bg, color: tone.color,
                  fontSize: 10.5, fontWeight: 800,
                  border: `1px solid ${tone.color}30`,
                }}>{tone.label}</span>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 22, fontWeight: 900, color: tone.color, fontFamily: "DM Mono, monospace" }}>
                  {compliance.overall}%
                </div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: C.slateL, overflow: "hidden" }}>
                <div style={{
                  width: `${compliance.overall}%`,
                  height: "100%",
                  background: tone.color,
                  transition: "width .25s",
                }} />
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                {BUNDLE_DEFS.map(def => {
                  const pct = compliance.per[def.key];
                  const applicable = sheet?.[def.key]?.applicable !== false;
                  if (!applicable) {
                    return (
                      <div key={def.key} style={{
                        padding: "4px 10px", borderRadius: 6,
                        background: C.slateL, color: C.muted,
                        fontSize: 10.5, fontWeight: 700,
                        border: `1px solid ${C.border}`,
                      }}>
                        {def.key.toUpperCase()} N/A
                      </div>
                    );
                  }
                  const t = complianceTone(pct);
                  return (
                    <div key={def.key} style={{
                      padding: "4px 10px", borderRadius: 6,
                      background: t.bg, color: t.color,
                      fontSize: 10.5, fontWeight: 800,
                      border: `1px solid ${t.color}30`,
                    }}>
                      {def.key.toUpperCase()} {pct}%
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── R7ei — Recent Sheets (last 30 days) ── */}
        {patient && (
          <div style={{
            background: C.card, borderRadius: 12, padding: "10px 14px",
            border: `1.5px solid ${C.border}`, marginBottom: 14,
          }}>
            <div
              onClick={() => setHistoryOpen(o => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                padding: "2px 0",
              }}
            >
              <i className="pi pi-history" style={{ fontSize: 14, color: C.teal }} />
              <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>
                Recent Sheets <span style={{ color: C.muted, fontWeight: 600 }}>· हाल की शीट्स</span>
              </div>
              <span style={{
                padding: "2px 8px", borderRadius: 999,
                background: C.tealL, color: C.teal,
                fontSize: 10.5, fontWeight: 800,
              }}>{history.length}</span>
              <div style={{ flex: 1 }} />
              <i className={`pi ${historyOpen ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ color: C.muted, fontSize: 12 }} />
            </div>
            {historyOpen && (
              <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                {history.length === 0 ? (
                  <div style={{ padding: 14, color: C.muted, fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
                    No prior bundles in the last 30 days. · पिछले 30 दिनों में कोई बंडल नहीं।
                  </div>
                ) : (
                  history.map(row => {
                    const isCurrent = row.date === date && row.shift === shift;
                    const tone = complianceTone(row.overallCompliancePct ?? 0);
                    const isFinalized = row.status === "finalized";
                    const nurse = row.finalizedBy || row.updatedBy || "—";
                    return (
                      <div
                        key={row._id}
                        onClick={() => openHistoryRow(row)}
                        style={{
                          padding: "8px 12px",
                          borderTop: `1px solid ${C.border}`,
                          display: "grid",
                          gridTemplateColumns: "140px 110px 110px 60px 1fr",
                          gap: 10, alignItems: "center",
                          cursor: "pointer",
                          background: isCurrent ? C.emeraldL : "#fff",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                          {row.date}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.slate }}>
                          {row.shift} <span style={{ color: C.muted }}>· {SHIFT_HI[row.shift] || ""}</span>
                        </div>
                        <span style={{
                          padding: "2px 8px", borderRadius: 999,
                          background: isFinalized ? C.slateL : C.amberL,
                          color: isFinalized ? C.slate : C.amber,
                          fontSize: 10, fontWeight: 800,
                          border: `1px solid ${isFinalized ? C.border : C.amber}30`,
                          justifySelf: "start",
                        }}>
                          {isFinalized ? "Finalized" : "Draft"}
                        </span>
                        <span style={{
                          padding: "2px 7px", borderRadius: 4,
                          background: tone.bg, color: tone.color,
                          fontSize: 10.5, fontWeight: 800,
                          border: `1px solid ${tone.color}30`,
                          justifySelf: "start",
                          fontFamily: "DM Mono, monospace",
                        }}>
                          {row.overallCompliancePct ?? 0}%
                        </span>
                        <div style={{ fontSize: 11, color: C.muted, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {nurse}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* R7ei — Anchor for "scroll into view" after history-row click. */}
        <div ref={editorTopRef} />

        {/* R7hr-184 — Device registry banner: which invasive devices are
            active and therefore which bundles will / won't be charted. */}
        {patient && sheet && deviceFor && (
          <div style={{
            background: "#f0fdfa", border: `1.5px solid ${C.teal}40`, borderRadius: 12,
            padding: "10px 16px", marginBottom: 12, fontSize: 12, color: "#115e59",
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontWeight: 800 }}>🩺 Devices / Lines:</span>
            {(devices || []).length === 0 && (
              <span style={{ color: C.muted }}>None recorded — VAP, CAUTI & CLABSI auto-marked N/A.</span>
            )}
            {(devices || []).map(d => (
              <span key={d._id} style={{ background: "#fff", border: `1px solid ${C.teal}50`, borderRadius: 999, padding: "2px 10px", fontWeight: 700, fontSize: 11 }}>
                {d.deviceLabel || d.deviceType}{d.size ? ` · ${d.size}` : ""} <span style={{ color: C.muted, fontWeight: 600 }}>since {new Date(d.placedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
              </span>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.muted }}>
              VAP / CAUTI / CLABSI applicability auto-set from registry · manage devices on the Doctor / Nursing Notes patient header
            </span>
          </div>
        )}

        {/* ── R7hr-232 — active-bundles header + "Extra Bundle ▾" picker ──
            Only the device-relevant (+ charted) bundles render as cards; the
            rest move into this dropdown so the nurse charts only what applies. */}
        {patient && sheet && registryReady && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 2px 10px", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>🛡 Bundles for this patient</div>
            <span style={{ fontSize: 11.5, color: C.muted }}>
              {bundleSplit.primary.length} active · device-linked &amp; charted
            </span>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <button type="button" onClick={() => setExtraOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: C.slate }}>
                ➕ Extra Bundle <span style={{ fontSize: 10 }}>▾</span>
                {bundleSplit.extra.length > 0 && (
                  <span style={{ marginLeft: 2, background: C.slateL, color: C.slate, borderRadius: 999, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{bundleSplit.extra.length}</span>
                )}
              </button>
              {extraOpen && (
                <>
                  <div onClick={() => setExtraOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
                  <div style={{ position: "absolute", right: 0, top: "118%", zIndex: 40, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 30px rgba(2,6,23,.18)", width: 330, maxHeight: 360, overflow: "auto", padding: 6 }}>
                    <div style={{ padding: "4px 8px 6px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted }}>Add another bundle</div>
                    {bundleSplit.extra.length === 0 && (
                      <div style={{ padding: "8px 10px", fontSize: 12, color: C.muted }}>All bundles are already on screen.</div>
                    )}
                    {bundleSplit.extra.map(def => {
                      const hint = DEVICE_DRIVEN.has(def.key)
                        ? `No ${def.key === "vap" ? "ET tube / tracheostomy" : def.key === "cauti" ? "urinary catheter" : "central line / PICC"} on file`
                        : "Optional — chart if clinically indicated";
                      return (
                        <button key={def.key} type="button" onClick={() => revealBundle(def.key)}
                          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 7, textAlign: "left" }}
                          onMouseEnter={e => { e.currentTarget.style.background = C.slateL; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                          <i className={`pi ${def.icon}`} style={{ fontSize: 14, color: C.teal, width: 18, textAlign: "center" }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.text }}>{def.key.toUpperCase()}</span>
                            <span style={{ display: "block", fontSize: 10.5, color: C.muted }}>{hint}</span>
                          </span>
                          <span style={{ fontSize: 11, color: C.teal, fontWeight: 800, whiteSpace: "nowrap" }}>+ Add</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* R7hr-232 — nothing device-linked: guide the nurse to the picker. */}
        {patient && sheet && registryReady && bundleSplit.primary.length === 0 && (
          <div style={{ background: C.card, border: `1.5px dashed ${C.border}`, borderRadius: 12, padding: "20px 18px", marginBottom: 12, textAlign: "center", color: C.muted, fontSize: 12.5 }}>
            No device-linked bundles for this patient. Use <strong style={{ color: C.slate }}>➕ Extra Bundle</strong> above to chart DVT / Sepsis / SUP if clinically indicated.
          </div>
        )}

        {/* ── Bundle cards ── */}
        {patient && sheet && bundleSplit.primary.map(def => {
          const applicable = sheet?.[def.key]?.applicable !== false;
          const items = itemsFor(def.key);
          const pct = compliance.per[def.key];
          const tone = applicable ? complianceTone(pct) : { color: C.muted, bg: C.slateL, label: "N/A" };
          const isOpen = !!expanded[def.key];
          return (
            <div key={def.key} style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 12, marginBottom: 12, overflow: "hidden",
              boxShadow: "0 1px 3px rgba(15,23,42,.04)",
            }}>
              {/* Card header */}
              <div
                onClick={() => setExpanded(p => ({ ...p, [def.key]: !p[def.key] }))}
                style={{
                  padding: "12px 18px",
                  background: applicable ? `linear-gradient(135deg, ${tone.bg}, #fff)` : C.slateL,
                  borderBottom: isOpen ? `1px solid ${C.border}` : "none",
                  display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                }}
              >
                <i className={`pi ${def.icon}`} style={{ fontSize: 18, color: applicable ? tone.color : C.muted }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{def.title}</div>
                  {/* R7ei — Hindi gloss for the 6 bundle headings. */}
                  {BUNDLE_HI[def.key] && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.slate, marginTop: 1 }}>
                      {BUNDLE_HI[def.key]}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{def.subtitle}</div>
                </div>
                {applicable && (
                  <div style={{ fontSize: 18, fontWeight: 900, color: tone.color, fontFamily: "DM Mono, monospace" }}>
                    {pct}%
                  </div>
                )}
                <span style={{
                  padding: "3px 9px", borderRadius: 4,
                  background: tone.bg, color: tone.color,
                  fontSize: 10.5, fontWeight: 800,
                  border: `1px solid ${tone.color}30`,
                }}>{tone.label}</span>
                <i className={`pi ${isOpen ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ color: C.muted, fontSize: 12 }} />
              </div>

              {/* Card body */}
              {isOpen && (
                <div style={{ padding: "12px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
                      Applicable to this patient?
                    </label>
                    {/* R7hr-184 — VAP/CAUTI/CLABSI applicability is driven
                        by the invasive-device registry: when the registry
                        is readable, show the device verdict instead of
                        the manual Yes/No toggle. DVT/Sepsis/SUP (and any
                        patient without registry access) keep the manual
                        toggle below. */}
                    {deviceFor && ["vap", "cauti", "clabsi"].includes(def.key) ? (
                      deviceFor[def.key] ? (
                        <span style={{ padding: "5px 12px", borderRadius: 6, background: C.emeraldL, color: C.emerald, border: `1.5px solid ${C.emerald}`, fontWeight: 700, fontSize: 11 }}>
                          🔌 Auto — {deviceFor[def.key].deviceLabel || deviceFor[def.key].deviceType} active since {new Date(deviceFor[def.key].placedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → Applicable
                        </span>
                      ) : (
                        <span style={{ padding: "5px 12px", borderRadius: 6, background: C.slateL, color: C.slate, border: `1.5px solid ${C.slate}50`, fontWeight: 700, fontSize: 11 }}>
                          🔌 Auto — no {def.key === "vap" ? "ET tube / tracheostomy" : def.key === "cauti" ? "urinary catheter" : "central line / PICC"} registered → N/A
                        </span>
                      )
                    ) : (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        disabled={locked}
                        onClick={() => setApplicable(def.key, true)}
                        style={{
                          padding: "5px 12px", borderRadius: 6,
                          border: `1.5px solid ${applicable ? C.emerald : C.border}`,
                          background: applicable ? C.emeraldL : "#fff",
                          color: applicable ? C.emerald : C.muted,
                          fontWeight: 700, fontSize: 11, cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.6 : 1,
                        }}>Yes</button>
                      <button
                        disabled={locked}
                        onClick={() => setApplicable(def.key, false)}
                        style={{
                          padding: "5px 12px", borderRadius: 6,
                          border: `1.5px solid ${!applicable ? C.slate : C.border}`,
                          background: !applicable ? C.slateL : "#fff",
                          color: !applicable ? C.slate : C.muted,
                          fontWeight: 700, fontSize: 11, cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.6 : 1,
                        }}>No (N/A)</button>
                    </div>
                    )}
                  </div>

                  {applicable ? (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                      {items.map((it, idx) => (
                        <div key={it.key} style={{
                          padding: "10px 14px",
                          borderTop: idx === 0 ? "none" : `1px solid ${C.border}`,
                          background: it.checked ? `${C.greenL}40` : "#fff",
                          display: "grid", gridTemplateColumns: "auto 1fr 220px", gap: 10, alignItems: "center",
                        }}>
                          <input
                            type="checkbox"
                            checked={!!it.checked}
                            disabled={locked}
                            onChange={e => setLocalItem(def.key, it.key, { checked: e.target.checked })}
                            style={{ width: 18, height: 18, cursor: locked ? "not-allowed" : "pointer", accentColor: C.emerald }}
                          />
                          <div style={{ fontSize: 12.5, color: C.text, fontWeight: it.checked ? 700 : 500 }}>
                            {it.label}
                          </div>
                          <input
                            type="text"
                            className="his-field"
                            disabled={locked}
                            placeholder="Notes (optional)"
                            value={it.notes}
                            onChange={e => setLocalItem(def.key, it.key, { notes: e.target.value })}
                            style={{ padding: "6px 8px", fontSize: 11.5 }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      padding: 14, borderRadius: 10, background: C.slateL,
                      color: C.muted, fontSize: 12, fontStyle: "italic",
                      border: `1px dashed ${C.border}`,
                    }}>
                      Marked Not Applicable — excluded from the overall compliance %.
                      Switch back to "Yes" to chart this bundle.
                    </div>
                  )}

                  {applicable && sheet?.[def.key]?.signedAt && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                      <i className="pi pi-verified" style={{ marginRight: 6, color: C.emerald }} />
                      Signed by <strong>{sheet[def.key].nurseName || "—"}</strong> on {new Date(sheet[def.key].signedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Sheet-level notes ── */}
        {patient && sheet && (
          <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1.5px solid ${C.border}`, marginBottom: 14 }}>
            <label className="his-label" style={{ marginBottom: 6, display: "block" }}>Shift notes (optional)</label>
            <textarea
              className="his-field"
              disabled={locked}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Free-text shift-level remarks for the IC officer — e.g. line removed at 14:00 after daily review, Foley out, etc."
              rows={3}
              style={{ width: "100%", fontSize: 12.5, resize: "vertical" }}
            />
            {sheet.finalizedAt && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted }}>
                <i className="pi pi-lock" style={{ marginRight: 6, color: C.emerald }} />
                Finalized by <strong>{sheet.finalizedBy || "—"}</strong> on {new Date(sheet.finalizedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 30, color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ marginRight: 8 }} />Loading bundles…
          </div>
        )}
      </div>
    </div>
  );
}
