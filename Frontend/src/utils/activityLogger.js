/**
 * activityLogger.js
 * ════════════════════════════════════════════════════════════════
 * Frontend-side companion to the Backend activityLogger middleware.
 *
 * Backend already auto-captures every successful POST/PUT/PATCH/DELETE
 * via Express middleware (see Backend/services/Clinical/activityLogger.js).
 * That covers form submits, saves, deletes, etc.
 *
 * But there's a class of UI events that NEVER hit the backend:
 *   • Tab switches inside a panel
 *   • Dropdown / radio selections that aren't yet submitted
 *   • Modal opens (preview state, no API call)
 *   • Button clicks for view/print/export
 *   • Field edits that the user types but doesn't save
 *
 * Without this helper, those "har button click" / "har dropdown select"
 * events would never make it into the patient file. This logger fires
 * them through `POST /api/patient-file/:uhid/log` (built in Phase 1).
 *
 * Design:
 *   • Singleton — never instantiated, the module export IS the logger.
 *   • Fire-and-forget — never blocks the UI; rejects are swallowed.
 *   • Dedupe — same (module, action, area) within 800 ms is collapsed
 *     to one row. Prevents a noisy double-click from polluting the feed.
 *   • Hookable — `useActivityLog(uhid, defaults)` returns a stable `log`
 *     function pre-bound to the patient, so components don't repeat
 *     `uhid` everywhere.
 *
 * Usage (programmatic):
 *   import { logActivity } from "../../utils/activityLogger";
 *   logActivity({ uhid, module: "PatientPanel", action: "navigation", area: "tab:vitals" });
 *
 * Usage (hook — cleaner inside a component):
 *   const log = useActivityLog(patient?.UHID, {
 *     module: "PatientPanel.Doctor",
 *     admissionId: admission?._id,
 *     ipdNo: admission?.admissionNumber,
 *   });
 *   <button onClick={() => { log({ action: "click", area: "shift-bed.open" }); openShiftModal(); }}>
 */

import axios from "axios";
import { useCallback, useMemo, useRef } from "react";
import { API_ENDPOINTS } from "../config/api";

// ── In-memory dedupe cache: { "uhid|module|action|area": lastTimestampMs }
const lastFired = new Map();
const DEDUPE_WINDOW_MS = 800;

// ── Cap cache size so we don't leak across long sessions.
const MAX_CACHE = 500;

function pruneCache() {
  if (lastFired.size <= MAX_CACHE) return;
  const now = Date.now();
  for (const [key, ts] of lastFired) {
    // Drop anything older than 5 minutes when we hit the cap.
    if (now - ts > 5 * 60_000) lastFired.delete(key);
  }
}

/**
 * Fire an activity log entry.
 *
 * @param {Object} fields
 * @param {string} fields.uhid         REQUIRED — patient UHID
 * @param {string} fields.module       REQUIRED — short module name (e.g. "PatientPanel.Doctor")
 * @param {string} fields.action       REQUIRED — one of: view, click, select, field-edit,
 *                                                form-submit, navigation, print, export,
 *                                                sign, amend, cancel, create, update, delete, other
 * @param {string} [fields.area]       finer-grained area inside the module
 *                                     (e.g. "tab:vitals", "shift-bed.open", "complete-file")
 * @param {string} [fields.summary]    human-readable one-liner shown in the audit feed
 * @param {string} [fields.sourceModel] linked Mongoose model name (e.g. "DoctorNotes")
 * @param {string} [fields.sourceId]   linked document _id
 * @param {Object} [fields.before]     snapshot before the change
 * @param {Object} [fields.after]      snapshot after the change
 * @param {string[]} [fields.tags]     free-form tags for filtering
 * @param {string} [fields.ipdNo]      admission IPD number for cross-linking
 * @param {string} [fields.admissionId] admission ObjectId
 * @returns {Promise<void>} resolves once the POST is enqueued (never rejects)
 */
export async function logActivity(fields = {}) {
  const { uhid, module: mod, action, area = "" } = fields;
  if (!uhid || !mod || !action) return; // soft fail — missing critical key

  const dedupeKey = `${uhid}|${mod}|${action}|${area}`;
  const now = Date.now();
  const last = lastFired.get(dedupeKey) || 0;
  if (now - last < DEDUPE_WINDOW_MS) return; // collapsed dupe
  lastFired.set(dedupeKey, now);
  pruneCache();

  try {
    await axios.post(`${API_ENDPOINTS.BASE}/patient-file/${uhid}/log`, {
      module: mod,
      action,
      area,
      summary:     fields.summary || "",
      sourceModel: fields.sourceModel || "",
      sourceId:    fields.sourceId || null,
      before:      fields.before,
      after:       fields.after,
      tags:        Array.isArray(fields.tags) ? fields.tags : [],
      isFlagged:   !!fields.isFlagged,
      ipdNo:       fields.ipdNo || "",
      admissionId: fields.admissionId || null,
    });
  } catch {
    // Audit is best-effort. Never surface failures to the user.
  }
}

/**
 * React hook — returns a stable `log` function pre-bound to the patient.
 *
 * The hook accepts a `defaults` object whose fields are merged into every
 * call. Re-renders that only change unrelated values won't break referential
 * equality (the returned function is memoised on the JSON-stringified
 * defaults), so it's safe to drop into a useEffect dep list.
 *
 * @param {string} uhid       patient UHID (null/undefined → no-op logger)
 * @param {Object} [defaults] fields merged into every log() call
 * @returns {(fields:object)=>Promise<void>}
 */
export function useActivityLog(uhid, defaults = {}) {
  // Capture the latest defaults object in a ref so the returned function
  // stays referentially stable but always reads fresh values.
  const ref = useRef(defaults);
  ref.current = defaults;

  return useCallback(
    (fields = {}) => {
      if (!uhid) return Promise.resolve();
      return logActivity({ uhid, ...ref.current, ...fields });
    },
    [uhid], // intentionally tight dep — defaults read via ref
  );
}

/**
 * Helper for tracking a "select" event (dropdown / radio / checkbox).
 * Usage:
 *   <select onChange={(e) => { onSelectLog("reason", e.target.value); setForm(...); }} />
 *
 * Returns a curried function so it's easy to drop into form props.
 */
export function makeSelectLogger(log, areaPrefix) {
  return (field, value, extras = {}) =>
    log({
      action: "select",
      area: `${areaPrefix}.${field}`,
      summary: `${field} = ${value}`,
      ...extras,
    });
}

/**
 * Bound logger object that's convenient when you have many distinct
 * actions in one component. Memoised — only re-built when uhid changes.
 *
 * Example:
 *   const a = useBoundLogger(uhid, { module: "PatientPanel.Doctor", admissionId });
 *   <button onClick={() => a.click("shift-bed.open")}>Shift Bed</button>
 *   <select onChange={(e) => a.select("reason", e.target.value)}>...
 */
export function useBoundLogger(uhid, defaults = {}) {
  const log = useActivityLog(uhid, defaults);
  return useMemo(
    () => ({
      log,
      view:   (area, extras) => log({ action: "view",        area, ...extras }),
      click:  (area, extras) => log({ action: "click",       area, ...extras }),
      select: (field, value, extras) => log({ action: "select", area: field, summary: `${field} = ${value}`, ...extras }),
      submit: (area, extras) => log({ action: "form-submit", area, ...extras }),
      nav:    (area, extras) => log({ action: "navigation",  area, ...extras }),
      print:  (area, extras) => log({ action: "print",       area, ...extras }),
      exportFile: (area, extras) => log({ action: "export",  area, ...extras }),
      cancel: (area, extras) => log({ action: "cancel",      area, ...extras }),
    }),
    [log],
  );
}
