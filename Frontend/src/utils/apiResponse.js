/**
 * Frontend/src/utils/apiResponse.js
 * ────────────────────────────────────────────────────────────────────
 * R7bj-F8 — adapter for the canonical {success, data, meta?} envelope
 * shipped by Backend/utils/apiEnvelope.js. Falls back to legacy shapes
 * gracefully so we can migrate one page at a time without breaking
 * unmigrated callsites.
 *
 * Recognised inputs (in order of preference):
 *   1. axios response object → resp.data is the JSON body
 *   2. raw JSON body
 *   3. Error envelope: {success:false, message, code?}
 *   4. New envelope: {success:true, data, meta?}
 *   5. Legacy "scattered keys" envelope: {success:true, count, pagination, ...rest}
 *      → packs unknown keys into data (or meta) so existing pages keep working
 *   6. Raw array/object (legacy TPA, no success flag)
 *
 * Standard return shape:
 *   { ok: boolean, data: any, meta: object|null, error: {message, code}|null }
 *
 * Usage:
 *   const { ok, data, error } = unwrapResponse(await axios.get(...));
 *   if (!ok) { toast.error(error.message); return; }
 *   setRows(data);
 *
 * Lists with pagination:
 *   const { ok, data, meta } = unwrapResponse(resp);
 *   setRows(data);
 *   setTotal(meta?.total ?? meta?.count ?? data.length);
 */

export function unwrapResponse(resp) {
  // axios wraps the JSON body as resp.data — accept either the wrapper
  // or the bare body.
  const body = resp && typeof resp === "object" && "data" in resp && !("success" in resp)
    ? resp.data
    : resp;

  if (body == null) {
    return {
      ok: false,
      data: null,
      meta: null,
      error: { message: "Empty response", code: "EMPTY" },
    };
  }

  // Error envelope — backend `sendErr` shape.
  if (body.success === false) {
    return {
      ok: false,
      data: null,
      meta: null,
      error: {
        message: body.message || "Request failed",
        code: body.code || null,
      },
    };
  }

  // New envelope: {success:true, data, meta?}
  // We also tolerate legacy controllers that placed `data` alongside
  // top-level `count`/`total`/`pagination` (R7bg-3 transitional shape) —
  // those keys get folded into meta so consumers can keep reading them.
  if (body.success === true && "data" in body) {
    const { count, total, pagination } = body;
    const synthMeta =
      body.meta ||
      (count != null || total != null || pagination
        ? {
            ...(count != null ? { count } : {}),
            ...(total != null ? { total } : {}),
            ...(pagination ? { pagination } : {}),
          }
        : null);
    return {
      ok: true,
      data: body.data,
      meta: synthMeta,
      error: null,
    };
  }

  // Legacy: success flag but data scattered alongside count/pagination.
  if (body.success === true) {
    const { success: _s, data, meta, count, total, pagination, ...rest } = body;
    const synthMeta =
      meta ||
      (count != null || total != null || pagination
        ? {
            ...(count != null ? { count } : {}),
            ...(total != null ? { total } : {}),
            ...(pagination ? { pagination } : {}),
          }
        : null);
    return {
      ok: true,
      data: data !== undefined ? data : (Object.keys(rest).length ? rest : null),
      meta: synthMeta,
      error: null,
    };
  }

  // Raw array/object (no envelope at all — legacy TPA, public endpoints, etc.)
  return {
    ok: true,
    data: body,
    meta: null,
    error: null,
  };
}

/**
 * Convenience for list endpoints. Always returns an array for `data`
 * and a non-null meta object so callers don't need null-guards on
 * `meta?.count`.
 */
export function unwrapList(resp) {
  const { ok, data, meta, error } = unwrapResponse(resp);
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []);
  return {
    ok,
    data: arr,
    meta: meta || { count: arr.length },
    error,
  };
}

export default unwrapResponse;
