/**
 * useAutoSave.js
 * Debounced localStorage draft persistence for clinical forms.
 *
 * Usage:
 *   const { savedAt, loadDraft, clearDraft } = useAutoSave(draftKey, formState, 2000);
 *
 * - draftKey  : unique string, e.g. `sphere_draft_opd_${visitNumber}`
 *              Pass null/undefined to disable (e.g. when no patient selected yet)
 * - formState : any JSON-serialisable object (all form state)
 * - delay     : debounce ms (default 2000)
 *
 * Returns:
 *   savedAt   : Date | null — timestamp of last successful local save
 *   loadDraft : () => object | null — call inside patient-load effect
 *   clearDraft: () => void — call after successful API submit/sign
 *   hasDraft  : boolean — true when a stored draft exists for this key
 */
import { useState, useEffect, useCallback, useRef } from "react";

export function useAutoSave(draftKey, formState, delay = 2000) {
  const [savedAt, setSavedAt] = useState(null);
  const [hasDraft, setHasDraft] = useState(false);
  const timerRef = useRef(null);

  /* Check if a draft already exists whenever the key changes */
  useEffect(() => {
    if (!draftKey) { setHasDraft(false); return; }
    setHasDraft(!!localStorage.getItem(draftKey));
  }, [draftKey]);

  /* Debounced save: runs after `delay` ms of no state change */
  useEffect(() => {
    if (!draftKey || !formState) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify({
          ...formState,
          _meta: { savedAt: new Date().toISOString(), key: draftKey },
        });
        localStorage.setItem(draftKey, payload);
        setSavedAt(new Date());
        setHasDraft(true);
      } catch (e) {
        /* storage full or serialisation error — fail silently */
        console.warn("[AutoSave] Failed to save draft:", e);
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, JSON.stringify(formState), delay]);

  /* Load a stored draft (call this inside patient-load effect) */
  const loadDraft = useCallback(() => {
    if (!draftKey) return null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Remove internal meta before returning to caller
      const { _meta, ...rest } = data;
      return { data: rest, savedAt: _meta?.savedAt ? new Date(_meta.savedAt) : null };
    } catch {
      return null;
    }
  }, [draftKey]);

  /* Clear draft after successful submit */
  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    localStorage.removeItem(draftKey);
    setSavedAt(null);
    setHasDraft(false);
  }, [draftKey]);

  return { savedAt, hasDraft, loadDraft, clearDraft };
}
