// Components/bed/BedActionMenu.jsx
// Status-aware action menu that opens when a bed is clicked in the
// Live Bed Map. Shows a curated, ordered set of actions specific to
// the bed's current status, so the nurse / doctor / receptionist
// can pick the right next step in one tap.

import React, { useEffect } from "react";
import { Dialog } from "primereact/dialog";

const STATUS_META = {
  Available:   { color: "#16a34a", bg: "#dcfce7", icon: "pi-check-circle",      label: "Available" },
  Occupied:    { color: "#dc2626", bg: "#fee2e2", icon: "pi-user",              label: "Occupied" },
  Reserved:    { color: "#2563eb", bg: "#dbeafe", icon: "pi-bookmark",          label: "Reserved" },
  Maintenance: { color: "#d97706", bg: "#fef3c7", icon: "pi-wrench",            label: "Maintenance" },
  Blocked:     { color: "#475569", bg: "#f1f5f9", icon: "pi-ban",               label: "Blocked" },
};

const Action = ({ icon, label, sub, color, danger, primary, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="bm-bed-action"
    style={{
      "--act-color": danger ? "#dc2626" : primary ? color : "#475569",
      "--act-bg":    danger ? "#fee2e2" : primary ? `${color}22` : "#f8fafc",
    }}
  >
    <span className="bm-bed-action__icon" style={{ background: danger ? "#fee2e2" : `${color || "#475569"}1a`, color: danger ? "#dc2626" : (color || "#475569") }}>
      <i className={`pi ${icon}`} />
    </span>
    <span className="bm-bed-action__body">
      <span className="bm-bed-action__label">{label}</span>
      {sub && <span className="bm-bed-action__sub">{sub}</span>}
    </span>
    <i className="pi pi-chevron-right bm-bed-action__chev" />
  </button>
);

const BedActionMenu = ({ bed, onClose, actions = {}, perms = {} }) => {
  // Lock body scroll while open
  useEffect(() => {
    if (!bed) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [bed]);

  if (!bed) return null;
  const meta = STATUS_META[bed.status] || STATUS_META.Available;
  const patient = bed.currentAdmission?.patientId || {};
  const isOcc   = bed.status === "Occupied";
  const isAvail = bed.status === "Available";
  const isRes   = bed.status === "Reserved";
  const isMnt   = bed.status === "Maintenance";
  const isBlk   = bed.status === "Blocked";
  // R7bb-E/D5-HIGH-1 — Caller passes `perms` derived from useAuth().can().
  // Default to true so the menu still works if a caller forgets to pass
  // perms (legacy embedders). Backend always enforces; this is UI polish.
  const {
    canAssignBed = true,
    canTransfer  = true,
    canDischarge = true,
  } = perms;

  return (
    <Dialog
      visible={true}
      modal
      onHide={onClose}
      showHeader={false}
      style={{ width: 520, maxWidth: "96vw" }}
      contentStyle={{ padding: 0, borderRadius: 16, overflow: "hidden" }}
    >
      {/* Header */}
      <div style={{
        padding: "16px 22px",
        background: `linear-gradient(135deg, ${meta.color}, ${meta.color}cc)`,
        color: "white",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11,
              background: "rgba(255,255,255,.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>
              <i className={`pi ${meta.icon}`} />
            </span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".2px" }}>
                Bed {bed.bedNumber}
              </div>
              <div style={{ fontSize: 11, opacity: .85 }}>
                {bed.wardName || "—"} · {bed.roomNumber || "—"} · Floor {bed.floorNumber || "—"}
              </div>
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{
            background: "rgba(255,255,255,.18)", border: "none", color: "white",
            width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 13,
          }}>
            <i className="pi pi-times" />
          </button>
        </div>

        {/* Status pill row */}
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          <span style={{
            background: "rgba(255,255,255,.22)", padding: "3px 10px",
            borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".4px",
          }}>{meta.label}</span>
          {bed.precautionLevel && bed.precautionLevel !== "Standard" && (
            <span style={{
              background: "rgba(255,255,255,.22)", padding: "3px 10px",
              borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".4px",
            }}>
              <i className="pi pi-shield" style={{ fontSize: 9, marginRight: 4 }} />
              {bed.precautionLevel} isolation
            </span>
          )}
          {Array.isArray(bed.isolationFlags) && bed.isolationFlags.length > 0 && (
            <span style={{
              background: "rgba(255,255,255,.22)", padding: "3px 10px",
              borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".4px",
            }}>
              {bed.isolationFlags.slice(0, 2).join(", ")}{bed.isolationFlags.length > 2 ? ` +${bed.isolationFlags.length - 2}` : ""}
            </span>
          )}
        </div>

        {/* Patient strip (only for Occupied) */}
        {isOcc && (patient.fullName || patient.UHID) && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "rgba(255,255,255,.13)",
            borderRadius: 9,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              width: 34, height: 34, borderRadius: "50%",
              background: "white", color: meta.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 13, flexShrink: 0,
            }}>
              {(patient.fullName || "?").slice(0, 1).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                {patient.fullName || patient.patientName || "Unknown patient"}
              </div>
              <div style={{ fontSize: 10.5, opacity: .85 }}>
                {patient.UHID && <>UHID: {patient.UHID}</>}
                {patient.age != null && <> · {patient.age}Y</>}
                {patient.gender && <> · {patient.gender}</>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, background: "#fff" }}>
        {/* ── AVAILABLE ── */}
        {isAvail && (
          <>
            {/* R7bb-E/D5-HIGH-1 — Admit / Reserve / Maintenance / Block
                require ipd.assign-bed (Admin/Receptionist/Doctor). Ward
                Boy + Housekeeping viewers see info-only menu. */}
            {canAssignBed && (
              <Action icon="pi-user-plus" label="Admit Patient"
                sub="Search existing or register new admission"
                color="#16a34a" primary
                onClick={() => actions.onAdmit?.(bed)} />
            )}
            {canAssignBed && (
              <Action icon="pi-bookmark" label="Reserve Bed"
                sub="Hold for a scheduled admission"
                color="#2563eb"
                onClick={() => actions.onReserve?.(bed)} />
            )}
            <Action icon="pi-shield" label="Add Isolation Flag"
              sub="MRSA · COVID · TB · Contact · Droplet · Airborne"
              color="#dc2626"
              onClick={() => actions.onIsolation?.(bed)} />
            <Action icon="pi-cog" label="Manage Equipment"
              sub="Ventilator · monitor · IV pump · etc."
              color="#475569"
              onClick={() => actions.onEquipment?.(bed)} />
            {canAssignBed && (
              <Action icon="pi-wrench" label="Mark Maintenance"
                sub="Send to housekeeping cleaning queue"
                color="#d97706"
                onClick={() => actions.onMaintenance?.(bed)} />
            )}
            {canAssignBed && (
              <Action icon="pi-ban" label="Block Bed"
                sub="Disable temporarily (renovation, etc.)"
                color="#475569"
                onClick={() => actions.onBlock?.(bed)} />
            )}
          </>
        )}

        {/* ── OCCUPIED ── */}
        {isOcc && (
          <>
            <Action icon="pi-id-card" label="View Patient File"
              sub="Full timeline · diagnosis · notes · orders"
              color="#2563eb" primary
              onClick={() => actions.onViewPatient?.(bed)} />
            <Action icon="pi-book" label="Doctor Notes"
              sub="Daily progress · ICU · procedure · consultation"
              color="#7c3aed"
              onClick={() => actions.onDoctorNotes?.(bed)} />
            <Action icon="pi-heart" label="Nursing Notes"
              sub="Vitals · MEWS · wound · intake/output"
              color="#db2777"
              onClick={() => actions.onNursingNotes?.(bed)} />
            <Action icon="pi-chart-bar" label="Treatment Chart · MAR"
              sub="Medication administration record"
              color="#0d9488"
              onClick={() => actions.onMAR?.(bed)} />
            {/* R7bb-E/D5-HIGH-1 — Transfer gated by ipd.transfer. */}
            {canTransfer && (
              <Action icon="pi-arrows-h" label="Transfer to Another Bed"
                sub="Initiate transfer · nurse handover follows"
                color="#7c3aed"
                onClick={() => actions.onTransfer?.(bed)} />
            )}
            <Action icon="pi-shield" label="Update Isolation"
              sub="Add or remove precaution flags"
              color="#dc2626"
              onClick={() => actions.onIsolation?.(bed)} />
            <Action icon="pi-dollar" label="Estimate Charges"
              sub="Current bed-days × tariff + add-ons"
              color="#0891b2"
              onClick={() => actions.onEstimate?.(bed)} />
            {/* R7bb-E/D5-HIGH-1 — Discharge gated by ipd.discharge. */}
            {canDischarge && (
              <Action icon="pi-sign-out" label="Discharge Patient"
                sub="Free the bed · queue for cleaning"
                danger
                onClick={() => actions.onDischarge?.(bed)} />
            )}
          </>
        )}

        {/* ── RESERVED ── */}
        {isRes && (
          <>
            {/* R7bb-E/D5-HIGH-1 — Reservation lifecycle gated by ipd.assign-bed. */}
            {canAssignBed && (
              <Action icon="pi-check-circle" label="Complete Admission"
                sub="Convert reservation into an active stay"
                color="#16a34a" primary
                onClick={() => actions.onAdmit?.(bed)} />
            )}
            {canAssignBed && (
              <Action icon="pi-clock" label="Extend Hold"
                sub="Push reservedUntil further out"
                color="#2563eb"
                onClick={() => actions.onExtendReservation?.(bed)} />
            )}
            {canAssignBed && (
              <Action icon="pi-times-circle" label="Cancel Reservation"
                sub="Free the bed · mark Available"
                danger
                onClick={() => actions.onCancelReservation?.(bed)} />
            )}
          </>
        )}

        {/* ── MAINTENANCE ── */}
        {isMnt && (
          <>
            {/* R7bb-E/D5-HIGH-1 — Bed state changes gated by ipd.assign-bed. */}
            {canAssignBed && (
              <Action icon="pi-check-circle" label="Mark Available"
                sub="Cleaning complete · ready for next patient"
                color="#16a34a" primary
                onClick={() => actions.onClearMaintenance?.(bed)} />
            )}
            <Action icon="pi-bookmark-fill" label="Update Housekeeping State"
              sub={`Current: ${bed.housekeeping?.state || "Idle"}`}
              color="#d97706"
              onClick={() => actions.onHousekeeping?.(bed)} />
            {canAssignBed && (
              <Action icon="pi-ban" label="Move to Blocked"
                sub="If maintenance will take longer"
                color="#475569"
                onClick={() => actions.onBlock?.(bed)} />
            )}
          </>
        )}

        {/* ── BLOCKED ── */}
        {isBlk && canAssignBed && (
          <>
            <Action icon="pi-check-circle" label="Unblock · Mark Available"
              sub="Bed returns to active inventory"
              color="#16a34a" primary
              onClick={() => actions.onUnblock?.(bed)} />
            <Action icon="pi-wrench" label="Move to Maintenance"
              sub="Send to housekeeping queue instead"
              color="#d97706"
              onClick={() => actions.onMaintenance?.(bed)} />
          </>
        )}

        {/* ── Common (always shown at bottom) ── */}
        <div style={{ borderTop: "1px dashed #e2e8f0", margin: "6px 0", paddingTop: 6 }} />
        <Action icon="pi-info-circle" label="Bed Information"
          sub="Room · floor · category · equipment · history"
          color="#475569"
          onClick={() => actions.onInfo?.(bed)} />
      </div>
    </Dialog>
  );
};

export default BedActionMenu;
