/**
 * Appointments.jsx — Receptionist appointment booking & check-in
 *
 * Flow: Pick doctor → pick date → pick slot → book → patient arrives → check-in (opens OPD visit)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";
import "../../Components/clinical/clinical-forms.css";

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUSES = ["Booked", "CheckedIn", "Completed", "Cancelled", "NoShow"];

export default function Appointments() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Booked");
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState(todayISO());
  const [showBook, setShowBook] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.set("date", filterDate);
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/appointments?${params}`);
      setList(data?.data || []);
    } catch (e) { toast.error("Could not load appointments"); }
    finally { setLoading(false); }
  }, [filterDate]);
  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s so reception sees walk-ins / new bookings
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    let r = list.filter(a => (a.status || "Booked") === tab);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(a =>
      (a.patientName || "").toLowerCase().includes(s) ||
      (a.patientPhone || "").toLowerCase().includes(s) ||
      (a.appointmentNumber || "").toLowerCase().includes(s) ||
      (a.UHID || "").toLowerCase().includes(s)
    );
    return r;
  }, [list, tab, search]);

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = list.filter(a => (a.status || "Booked") === s).length;
    return acc;
  }, {});

  const checkIn = async (apt) => {
    if (!window.confirm(`Check in ${apt.patientName} and create OPD visit?`)) return;
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/appointments/${apt._id}/check-in`, {});
      toast.success("Checked in — OPD visit created");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Check-in failed");
    }
  };

  const sendWhatsAppReminder = (apt) => {
    if (!apt.patientPhone) return toast.warning("No phone number on file");
    const phone = (apt.patientPhone || "").replace(/\D/g, "");
    const num = phone.length === 10 ? `91${phone}` : phone;
    const dateStr = fmtDate(apt.appointmentDate);
    const msg = `Dear ${apt.patientName}, this is a reminder for your appointment with Dr. ${apt.doctorName || ""} on ${dateStr} at ${apt.slotTime}. Appointment #: ${apt.appointmentNumber}. Please arrive 10 minutes early. — SphereHealth Hospital`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-calendar" /> Appointments</div>
          <div className="rx-header-meta">Slot-based OPD booking · Doctor schedules · Check-in to OPD</div>
        </div>
        <div className="rx-header-actions">
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                 className="rx-header-date" />
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => setShowBook(true)}>
            <i className="pi pi-plus" /> Book Appointment
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      <div className="rx-tabs">
        {STATUSES.map(s => (
          <button key={s} className={`rx-tab ${tab === s ? "rx-tab--active" : ""}`} onClick={() => setTab(s)}>
            {s} <span className="rx-tab-count">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search by patient, phone, UHID, appointment #…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">📅</span>
          No {tab.toLowerCase()} appointments for {fmtDate(filterDate)}
        </div>
      ) : filtered.map(apt => {
        const cls = apt.status === "Booked"     ? "booked" :
                    apt.status === "CheckedIn"  ? "checkedin" :
                    apt.status === "Completed"  ? "done" :
                    apt.status === "Cancelled"  ? "revoked" :
                    apt.status === "NoShow"     ? "expired" : "pending";
        return (
          <div key={apt._id} className="rx-card">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {apt.patientName}
                <span className={`rx-card-stage rx-card-stage--${cls}`}>{apt.status || "Booked"}</span>
                <span className="rx-mono-tag rx-slot-time-tag">
                  {apt.slotTime}
                </span>
              </div>
              <div className="rx-card-meta">
                <span>Apt #: <strong>{apt.appointmentNumber}</strong></span>
                {apt.UHID && <span>UHID: <strong>{apt.UHID}</strong></span>}
                <span>Phone: <strong>{apt.patientPhone}</strong></span>
                <span>Doctor: <strong>{apt.doctorId?.personalInfo?.fullName || apt.doctorName || "—"}</strong></span>
                <span>Date: <strong>{fmtDate(apt.appointmentDate)}</strong></span>
                {apt.chiefComplaint && <span>Reason: <strong>{apt.chiefComplaint}</strong></span>}
                {apt.checkedInAt && <span className="rx-text-success">Checked-in: <strong>{fmtDateTime(apt.checkedInAt)}</strong></span>}
                {apt.cancelReason && <span className="rx-text-danger">Reason: <strong>{apt.cancelReason}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              {apt.status === "Booked" && (
                <>
                  <button className="rx-action-btn" onClick={() => sendWhatsAppReminder(apt)} title="Send WhatsApp reminder">
                    <i className="pi pi-whatsapp rx-wa-icon" /> Remind
                  </button>
                  <button className="rx-action-btn rx-action-btn--success" onClick={() => checkIn(apt)}>
                    <i className="pi pi-sign-in" /> Check-In
                  </button>
                  <button className="rx-action-btn rx-action-btn--danger" onClick={() => setCancelTarget(apt)}>
                    <i className="pi pi-times" /> Cancel
                  </button>
                </>
              )}
              {apt.status === "CheckedIn" && (apt.opdVisitNumber || apt.opdVisitId) && (
                <button className="rx-action-btn rx-action-btn--primary"
                        onClick={() => navigate(`/opd-details/${apt.opdVisitNumber || apt.opdVisitId}`)}>
                  <i className="pi pi-external-link" /> Open OPD Visit
                </button>
              )}
            </div>
          </div>
        );
      })}

      {showBook && (
        <BookAppointmentModal
          onClose={() => setShowBook(false)}
          onDone={() => { setShowBook(false); load(); }}
          defaultDate={filterDate || todayISO()}
        />
      )}

      {cancelTarget && (
        <CancelModal
          apt={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); load(); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function BookAppointmentModal({ onClose, onDone, defaultDate }) {
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Patient bits (lookup by phone or fresh entry)
  const [phone, setPhone] = useState("");
  const [uhid, setUhid] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Backend defaults limit=10 — bump it so hospitals with more than 10
    // doctors don't lose the rest from the dropdown.
    axios.get(API_ENDPOINTS.DOCTORS, { params: { limit: 500 } })
      .then(({ data }) => setDoctors(data?.data || data || []))
      .catch(() => toast.error("Could not load doctors"));
  }, []);

  useEffect(() => {
    if (!doctorId || !date) { setSlots([]); return; }
    setLoadingSlots(true);
    axios.get(`${API_ENDPOINTS.BASE}/appointments/slots?doctorId=${doctorId}&date=${date}`)
      .then(({ data }) => setSlots(data?.grid || []))
      .catch(() => toast.error("Could not load slots"))
      .finally(() => setLoadingSlots(false));
  }, [doctorId, date]);

  const lookupPatient = async () => {
    if (!phone || phone.length < 10) return;
    try {
      // Patient search supports name/UHID/phone with a single ?q= param
      const { data } = await axios.get(`${API_ENDPOINTS.PATIENTS}/search?q=${encodeURIComponent(phone)}&limit=5`);
      const list = data?.data || data || [];
      // Prefer an exact phone match
      const p = list.find(x => (x.contactNumber || "").replace(/\D/g, "").endsWith(phone.replace(/\D/g, ""))) || list[0];
      if (p) {
        setUhid(p.UHID || "");
        setPatientId(p._id || "");
        setPatientName(p.fullName || p.patientName || "");
        toast.success(`Found: ${p.UHID || p.fullName}`);
      } else {
        toast.info("No patient found with that phone — enter name to book a new one");
      }
    } catch (e) { /* silent */ }
  };

  const book = async () => {
    if (!doctorId || !date || !selectedSlot || !patientName || !phone) {
      return toast.error("Doctor, date, slot, patient name & phone are required");
    }
    setSaving(true);
    try {
      const doctor = doctors.find(d => d._id === doctorId);
      await axios.post(`${API_ENDPOINTS.BASE}/appointments`, {
        patientId, UHID: uhid, patientName, patientPhone: phone,
        doctorId,
        doctorName: doctor?.personalInfo?.fullName || doctor?.fullName || "",
        // Doctor schema stores `department` at the ROOT (ObjectId ref), not under
        // `professional`. Reading the wrong path left every appointment with no
        // departmentId and broke the department filter on the checked-in OPD visit.
        departmentId: doctor?.department?._id || doctor?.department || undefined,
        appointmentDate: date,
        slotTime: selectedSlot,
        chiefComplaint,
      });
      toast.success("Appointment booked");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Booking failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-calendar-plus" />
          <span className="rx-modal-title">Book Appointment</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">

          <div className="rx-grid-2-wide">
            <div className="his-field-group">
              <label className="his-label">Doctor *</label>
              <select className="his-field" value={doctorId} onChange={e => { setDoctorId(e.target.value); setSelectedSlot(""); }}>
                <option value="">-- Select doctor --</option>
                {doctors.map(d => (
                  <option key={d._id} value={d._id}>
                    {d.personalInfo?.fullName || d.fullName} — {d.professional?.specialization || d.specialization || "General"}
                  </option>
                ))}
              </select>
            </div>
            <div className="his-field-group">
              <label className="his-label">Date *</label>
              <input className="his-field" type="date" value={date} min={todayISO()} onChange={e => { setDate(e.target.value); setSelectedSlot(""); }} />
            </div>
          </div>

          {doctorId && date && (
            <div className="his-field-group">
              <label className="his-label">Available Slots</label>
              {loadingSlots ? (
                <div className="rx-slot-msg"><i className="pi pi-spin pi-spinner" /> Loading slots…</div>
              ) : slots.length === 0 ? (
                <div className="rx-slot-msg">No slots for this date</div>
              ) : (
                <div className="rx-slot-grid">
                  {slots.map(s => (
                    <button
                      key={s.slot}
                      type="button"
                      disabled={s.booked}
                      className={`rx-slot ${s.booked ? "rx-slot--booked" : ""} ${selectedSlot === s.slot ? "rx-slot--selected" : ""}`}
                      onClick={() => !s.booked && setSelectedSlot(s.slot)}
                      title={s.booked ? `Booked: ${s.bookingInfo?.patient}` : "Available"}
                    >
                      {s.slot}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rx-modal-divider">
            <div className="rx-grid-2-wide">
              <div className="his-field-group">
                <label className="his-label">Patient Phone *</label>
                <div className="rx-input-group">
                  <input className="his-field" value={phone} onChange={e => setPhone(e.target.value)} onBlur={lookupPatient} placeholder="10-digit mobile" />
                  <button type="button" className="rx-action-btn" onClick={lookupPatient}><i className="pi pi-search" /></button>
                </div>
              </div>
              <div className="his-field-group">
                <label className="his-label">UHID (auto)</label>
                <input className="his-field rx-field-readonly" value={uhid} readOnly placeholder="Auto-filled if patient exists" />
              </div>
            </div>
            <div className="his-field-group">
              <label className="his-label">Patient Name *</label>
              <input className="his-field" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Chief Complaint / Reason</label>
              <input className="his-field" value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} placeholder="e.g. Fever, follow-up, routine checkup" />
            </div>
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary" onClick={book} disabled={saving || !selectedSlot}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Confirm Booking
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function CancelModal({ apt, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const cancel = async () => {
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/appointments/${apt._id}/cancel`, { reason });
      toast.success("Appointment cancelled");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Cancel failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-times" />
          <span className="rx-modal-title">Cancel Appointment — {apt.patientName}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--danger">
            ⚠ Cancelling will free this slot. Apt #: <strong>{apt.appointmentNumber}</strong> · Slot: <strong>{apt.slotTime}</strong>
          </div>
          <div className="his-field-group">
            <label className="his-label">Reason</label>
            <textarea className="his-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Patient called to cancel, doctor unavailable, rescheduled" />
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Keep Appointment</button>
          <button className="rx-modal-btn-primary rx-btn-primary--er" onClick={cancel} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-times"}`} /> Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
