/**
 * useReceptionistPresence — heartbeat hook
 *
 * Calls POST /api/presence/heartbeat every 30s while the component is
 * mounted, including the optional current resource + action. So the
 * Reception Dashboard's "Active Receptionists" widget can show:
 *   "Geeta — registering Mr. Sharma · 30s ago"
 *
 * Sends an explicit "clear" on unmount so the receptionist drops off
 * the active list immediately when they navigate away.
 *
 * Usage:
 *   useReceptionistPresence({
 *     type: "patient", id: patientId, label: patientName,
 *     action: "registering"
 *   });
 */
import { useEffect, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";
import { useAuth } from "../context/AuthContext";

const HEARTBEAT_MS = 30000; // 30s

export function useReceptionistPresence(resource) {
  const { user } = useAuth();
  const resRef = useRef(resource);
  resRef.current = resource;

  useEffect(() => {
    if (!user) return undefined;

    const send = async () => {
      try {
        const r = resRef.current || {};
        await axios.post(
          `${API_ENDPOINTS.BASE}/presence/heartbeat`,
          {
            userId:   user._id || user.id,
            userName: user.fullName || user.name ||
                      `${user.firstName || ""} ${user.lastName || ""}`.trim(),
            userRole: user.role || "Receptionist",
            currentResource: r.type ? { type: r.type, id: r.id || null, label: r.label || "" } : { type: "idle" },
            action: r.action || "viewing",
          },
        );
      } catch { /* silent — non-critical */ }
    };

    send();                       // initial heartbeat
    const t = setInterval(send, HEARTBEAT_MS);

    return () => {
      clearInterval(t);
      // Clear presence on unmount (fire-and-forget)
      try {
        const uid = user._id || user.id;
        axios.post(`${API_ENDPOINTS.BASE}/presence/clear`, { userId: uid }).catch(() => {});
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
}
