/**
 * MLCAutoStamp — drop into ANY patient-document page to auto-apply the MLC
 * stamp if the patient (by UHID) currently has an MLC on file.
 *
 * Usage:
 *   <MLCAutoStamp uhid={patient.UHID} />                  // watermark seal
 *   <MLCAutoStamp uhid={patient.UHID} variant="banner" /> // print header strip
 *
 * Fetches `/api/patients/uhid/:uhid` once and looks at `isMLC + mlcNumber`,
 * which the MLC service backfills when a new MLC is created. Silent on
 * non-MLC patients (renders nothing).
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import MLCStamp from "./MLCStamp";

export default function MLCAutoStamp({ uhid, variant = "watermark" }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!uhid) { setInfo(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${uhid}`);
        const p = data?.data || data;
        if (cancelled) return;
        if (p?.isMLC && p?.mlcNumber) {
          setInfo({ mlrNumber: p.mlcNumber });
        } else {
          setInfo(null);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [uhid]);

  if (!info?.mlrNumber) return null;
  return <MLCStamp mlrNumber={info.mlrNumber} variant={variant} />;
}
