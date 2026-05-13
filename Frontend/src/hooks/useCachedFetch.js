/**
 * useCachedFetch — Roadmap E18 (stale-while-revalidate).
 *
 * Minimal SWR-style hook. Returns cached data immediately if present
 * while firing a network request in the background. New result
 * replaces the cache and re-renders subscribers.
 *
 * In-memory cache only (sessionStorage promo would bloat); good enough
 * for the patient panel where the user opens the same chart multiple
 * times during a shift. Cache TTL = 30 seconds; older than that and we
 * still return the stale value but re-fetch synchronously so the UI
 * never blanks.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";

const cache = new Map();       // key → { data, fetchedAt }
const inflight = new Map();    // key → Promise (dedup concurrent fetches)
const subscribers = new Map(); // key → Set<setter>
const TTL_MS = 30_000;

function notify(key, data) {
  const set = subscribers.get(key);
  if (set) set.forEach((s) => s(data));
}

async function fetcher(key, url, options = {}) {
  if (inflight.has(key)) return inflight.get(key);
  const p = axios.get(url, options)
    .then((r) => {
      const data = r.data;
      cache.set(key, { data, fetchedAt: Date.now() });
      notify(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function useCachedFetch(url, { enabled = true, options = {}, key } = {}) {
  const cacheKey = key || url;
  const [data, setData] = useState(() => cache.get(cacheKey)?.data ?? null);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!enabled || !url) return;

    // Subscribe to cache notifications for this key.
    if (!subscribers.has(cacheKey)) subscribers.set(cacheKey, new Set());
    const set = subscribers.get(cacheKey);
    const onUpdate = (next) => { if (mounted.current) setData(next); };
    set.add(onUpdate);

    const cached = cache.get(cacheKey);
    const stale  = !cached || Date.now() - cached.fetchedAt > TTL_MS;
    if (cached) setData(cached.data);

    if (stale) {
      setLoading(!cached);
      setError(null);
      fetcher(cacheKey, url, options)
        .then(() => setLoading(false))
        .catch((e) => { setError(e); setLoading(false); });
    }

    return () => { set.delete(onUpdate); };
  }, [url, cacheKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    cache.delete(cacheKey);
    return fetcher(cacheKey, url, options).catch(() => null);
  }, [cacheKey, url]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch };
}

// Public: invalidate a cache entry from anywhere (e.g. after a mutation).
export function invalidateCache(keyOrUrl) { cache.delete(keyOrUrl); }
