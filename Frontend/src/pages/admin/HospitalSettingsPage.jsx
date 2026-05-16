/**
 * HospitalSettingsPage.jsx — admin page for full hospital identity,
 * branding, legal, print, and bank/payment configuration.
 *
 * Five tabs, each a deep section:
 *   1. Identity & Branding   — logos / accreditations / about / socials
 *   2. Address & Contact     — main address / maps / multi-phone / dept contacts
 *   3. Legal & Registration  — tax IDs / hospital registrations / statutory / ABDM / licences with expiries
 *   4. Print & Footer        — header layout / colours / watermark / page settings / signatures / terms
 *   5. Bank Details          — multi bank accounts / UPI QR / cheque / payment gateway
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import {
  AdminPage, Hero, TabStrip, Card, Field, Check, ImageUpload, SubCard, Badge as ThemeBadge,
  Table, EmptyRow, RowAction, C,
} from "../../Components/admin-theme";

import { API_BASE_URL as API_URL } from "../../config/api";

const TABS = [
  { key: "identity", label: "Identity & Branding", icon: "pi-image" },
  { key: "address",  label: "Address & Contact",   icon: "pi-map-marker" },
  { key: "legal",    label: "Legal & Registration",icon: "pi-verified" },
  { key: "print",    label: "Print & Footer",      icon: "pi-print" },
  { key: "bank",     label: "Bank & Payment",      icon: "pi-building-columns" },
];

export default function HospitalSettingsPage() {
  const { settings: ctx, reload } = useHospitalSettings();
  const [tab, setTab]     = useState("identity");
  const [form, setForm]   = useState({ ...ctx });
  const [orig, setOrig]   = useState({ ...ctx });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...ctx });
    setOrig({ ...ctx });
  }, [ctx]);

  const dirty = useMemo(() => JSON.stringify(stripVolatile(form)) !== JSON.stringify(stripVolatile(orig)), [form, orig]);

  const handle = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };
  const setField  = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const toggle    = (name) => () => setForm(f => ({ ...f, [name]: !f[name] }));
  const setNested = (parent, key) => (v) => setForm(f => ({ ...f, [parent]: { ...(f[parent] || {}), [key]: v } }));
  const setNestedE = (parent, key) => (e) => setForm(f => ({ ...f, [parent]: { ...(f[parent] || {}), [key]: e.target.value } }));

  const save = async () => {
    setSaving(true);
    try {
      const res  = await fetch(`${API_URL}/hospital-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("Settings saved — every print and document now uses the updated profile");
        setOrig({ ...form });
        reload();
      } else toast.error("Save failed: " + (json.message || "unknown error"));
    } catch (e) { toast.error("Network error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <AdminPage>
      <Hero icon="pi-building" color="blue"
        title="Hospital Settings"
        subtitle="Master configuration · used by every patient document, bill, prescription and digital export"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {dirty && (
              <span style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,.2)", border: "1.5px solid rgba(255,255,255,.4)" }}>
                <i className="pi pi-circle-fill" style={{ fontSize: 7, marginRight: 5, color: "#fcd34d" }} />
                Unsaved changes
              </span>
            )}
            <button onClick={save} disabled={!dirty || saving}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: dirty ? "#fff" : "rgba(255,255,255,.25)",
                color: dirty ? "#1e40af" : "rgba(255,255,255,.6)",
                fontWeight: 800, fontSize: 12.5,
                cursor: dirty && !saving ? "pointer" : "default",
                display: "inline-flex", alignItems: "center", gap: 7,
                boxShadow: dirty ? "0 2px 10px rgba(0,0,0,.18)" : "none",
              }}>
              <i className={`pi ${saving ? "pi-spin pi-spinner" : (dirty ? "pi-save" : "pi-check")}`} style={{ fontSize: 12 }} />
              {saving ? "Saving…" : dirty ? "Save changes" : "All saved"}
            </button>
          </div>
        } />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} accent={C.blue} accentL={C.blueL} />

      {tab === "identity" && <IdentityTab form={form} handle={handle} toggle={toggle} setField={setField} setNestedE={setNestedE} />}
      {tab === "address"  && <AddressTab  form={form} handle={handle} setField={setField} setForm={setForm} />}
      {tab === "legal"    && <LegalTab    form={form} handle={handle} toggle={toggle} setForm={setForm} />}
      {tab === "print"    && <PrintTab    form={form} handle={handle} toggle={toggle} setField={setField} setForm={setForm} />}
      {tab === "bank"     && <BankTab     form={form} handle={handle} setField={setField} setForm={setForm} />}
    </AdminPage>
  );
}

const stripVolatile = (o) => {
  const c = { ...(o || {}) };
  delete c._id; delete c.__v; delete c.createdAt; delete c.updatedAt;
  return c;
};

/* ════════════════════════════════════════════════════════════════
   1. IDENTITY & BRANDING
══════════════════════════════════════════════════════════════════ */
function IdentityTab({ form, handle, toggle, setField, setNestedE }) {
  const HOSPITAL_TYPES = ["Private", "Government", "Trust", "Society", "Clinic"];
  const list = form.accreditations || [];
  const updList = (newList) => setField("accreditations")(newList);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Logos */}
      <Card title="Hospital Logos" color={C.purple} icon="pi-image">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
          <ImageUpload label="Header logo (primary)"
            value={form.logo} onChange={setField("logo")}
            hint="Used in document headers. PNG/JPG · max 500 KB · ~300×150px." />
          <ImageUpload label="Secondary logo / watermark"
            value={form.secondaryLogo} onChange={setField("secondaryLogo")}
            hint="Smaller logo for watermark / footer prints." />
          <ImageUpload label="Letterhead banner"
            value={form.letterheadBanner} onChange={setField("letterheadBanner")}
            hint="Wide image strip across the top of letterhead. ~1500×200px."
            width={200} height={80} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Logo width in print (px)">
            <input className="his-field" type="number" name="logoWidth"
              value={form.logoWidth || 120} onChange={handle} min={40} max={300}
              style={{ width: 120 }} />
          </Field>
        </div>
      </Card>

      {/* Basic identity */}
      <Card title="Hospital Identity" color={C.blue} icon="pi-id-card">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <Field label="Hospital name" required>
            <input className="his-field" name="hospitalName" value={form.hospitalName || ""} onChange={handle} placeholder="SphereHealth Hospital" />
          </Field>
          <Field label="Hospital type">
            <select className="his-field" name="hospitalType" value={form.hospitalType || "Private"} onChange={handle}>
              {HOSPITAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Tagline / accreditation line">
            <input className="his-field" name="tagline" value={form.tagline || ""} onChange={handle} placeholder="NABH Accredited Multi-Specialty Hospital" />
          </Field>
          <Field label="Tagline (local language, optional)">
            <input className="his-field" name="taglineLocal" value={form.taglineLocal || ""} onChange={handle} placeholder="हिंदी / regional tagline shown alongside" />
          </Field>
          <Field label="Established year">
            <input className="his-field" type="number" name="establishedYear" value={form.establishedYear || ""} onChange={handle} placeholder="1998" min={1850} max={new Date().getFullYear()} />
          </Field>
          <Field label="Bed count">
            <input className="his-field" type="number" name="bedCount" value={form.bedCount || 0} onChange={handle} placeholder="150" min={0} />
          </Field>
          <Field label="Operating hours (shown on prints)">
            <input className="his-field" name="operatingHours" value={form.operatingHours || ""} onChange={handle} placeholder="24×7 emergency · OPD 9 AM – 9 PM" />
          </Field>
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Mission statement">
            <textarea className="his-textarea" rows={3} name="missionStatement" value={form.missionStatement || ""} onChange={handle}
              placeholder="Our mission — patient-first care, ethical practice, accessible to every economic strata." />
          </Field>
          <Field label="About blurb (shown on discharge summary, certificates)">
            <textarea className="his-textarea" rows={3} name="aboutBlurb" value={form.aboutBlurb || ""} onChange={handle}
              placeholder="A 150-bed multi-specialty hospital established in 1998, accredited by NABH …" />
          </Field>
        </div>
      </Card>

      {/* Accreditations */}
      <Card title="Accreditations & Certifications" color={C.green} icon="pi-verified"
        right={
          <button onClick={() => updList([...list, { name: "", certNumber: "", issuedBy: "", issuedOn: null, expiresOn: null, showOnPrint: true }])}
            style={addBtn(C.green)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add accreditation
          </button>
        }>
        <div style={{ padding: "8px 12px", background: C.greenL, border: `1px solid ${C.green}30`, borderRadius: 7, fontSize: 11.5, color: "#166534", marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          Add NABH, NABL, JCI, ISO etc. Expiring certificates show an amber warning so the admin remembers to renew. Toggle "Show on print" to surface the badge on every document.
        </div>
        {list.length === 0
          ? <EmptyState text="No accreditations yet. Click Add to record NABH / NABL / JCI / ISO certifications." />
          : list.map((a, idx) => {
            const daysToExpiry = a.expiresOn ? Math.floor((new Date(a.expiresOn).getTime() - Date.now()) / 86400000) : null;
            const expiryColor = daysToExpiry == null ? null : daysToExpiry < 0 ? C.red : daysToExpiry < 90 ? C.amber : C.green;
            const updRow = (k, v) => updList(list.map((x, i) => i === idx ? { ...x, [k]: v } : x));
            return (
              <div key={idx} style={{ padding: 12, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 10, background: "#fff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.5fr 1.5fr 1fr 1fr auto", gap: 10 }}>
                  <Field label="Standard">
                    <input className="his-field" value={a.name || ""} onChange={e => updRow("name", e.target.value)} placeholder="NABH / NABL / JCI / ISO 9001" />
                  </Field>
                  <Field label="Certificate number">
                    <input className="his-field" value={a.certNumber || ""} onChange={e => updRow("certNumber", e.target.value)} placeholder="NABH-FC-12345" style={{ fontFamily: "DM Mono, monospace" }} />
                  </Field>
                  <Field label="Issued by">
                    <input className="his-field" value={a.issuedBy || ""} onChange={e => updRow("issuedBy", e.target.value)} placeholder="Quality Council of India" />
                  </Field>
                  <Field label="Issued on">
                    <input type="date" className="his-field" value={dateInput(a.issuedOn)} onChange={e => updRow("issuedOn", e.target.value)} />
                  </Field>
                  <Field label="Expires on">
                    <input type="date" className="his-field" value={dateInput(a.expiresOn)} onChange={e => updRow("expiresOn", e.target.value)} />
                  </Field>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                    <RowAction icon="pi-trash" label="Remove" color={C.red} onClick={() => updList(list.filter((_, i) => i !== idx))} />
                  </div>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                  <Check label="Show this badge on prints" v={a.showOnPrint} on={() => updRow("showOnPrint", !a.showOnPrint)} />
                  {daysToExpiry != null && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 4,
                      background: expiryColor + "15", color: expiryColor, border: `1px solid ${expiryColor}40` }}>
                      {daysToExpiry < 0
                        ? `Expired ${-daysToExpiry} day${-daysToExpiry === 1 ? "" : "s"} ago`
                        : `Expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"}`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

        <SubCard title="Quick toggles (also flow into pharmacy bills)" color={C.muted} icon="pi-bookmark">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Check label="NABH Accredited" v={form.nabh} on={toggle("nabh")} />
            <Check label="NABL Accredited" v={form.nabl} on={toggle("nabl")} />
          </div>
        </SubCard>
      </Card>

      {/* Socials */}
      <Card title="Social Media & Online Presence" color={C.pink} icon="pi-share-alt">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Facebook page URL">
            <input className="his-field" value={form.socials?.facebook || ""} onChange={setNestedE("socials", "facebook")} placeholder="https://facebook.com/yourhospital" />
          </Field>
          <Field label="Instagram handle">
            <input className="his-field" value={form.socials?.instagram || ""} onChange={setNestedE("socials", "instagram")} placeholder="@yourhospital" />
          </Field>
          <Field label="LinkedIn company URL">
            <input className="his-field" value={form.socials?.linkedin || ""} onChange={setNestedE("socials", "linkedin")} placeholder="https://linkedin.com/company/yourhospital" />
          </Field>
          <Field label="Twitter / X handle">
            <input className="his-field" value={form.socials?.twitter || ""} onChange={setNestedE("socials", "twitter")} placeholder="@yourhospital" />
          </Field>
          <Field label="YouTube channel">
            <input className="his-field" value={form.socials?.youtube || ""} onChange={setNestedE("socials", "youtube")} placeholder="https://youtube.com/@yourhospital" />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   2. ADDRESS & CONTACT
══════════════════════════════════════════════════════════════════ */
function AddressTab({ form, handle, setField, setForm }) {
  const contacts = form.departmentContacts || [];
  const updContacts = (next) => setField("departmentContacts")(next);
  const areas = form.serviceAreas || [];
  const updAreas = (next) => setField("serviceAreas")(next);
  const [newArea, setNewArea] = useState("");
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Primary Address" color={C.teal} icon="pi-map-marker">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "span 2" }}>
            <Field label="Address line 1" required>
              <input className="his-field" name="addressLine1" value={form.addressLine1 || ""} onChange={handle} placeholder="Building, Street" />
            </Field>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <Field label="Address line 2">
              <input className="his-field" name="addressLine2" value={form.addressLine2 || ""} onChange={handle} placeholder="Area, Landmark (optional)" />
            </Field>
          </div>
          <Field label="City"><input className="his-field" name="city" value={form.city || ""} onChange={handle} /></Field>
          <Field label="State"><input className="his-field" name="state" value={form.state || ""} onChange={handle} /></Field>
          <Field label="Pincode"><input className="his-field" name="pincode" value={form.pincode || ""} onChange={handle} /></Field>
          <Field label="Country"><input className="his-field" name="country" value={form.country || "India"} onChange={handle} /></Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <SubCard title="Location on map" icon="pi-globe">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <Field label="Google Maps share URL">
                <input className="his-field" name="googleMapsUrl" value={form.googleMapsUrl || ""} onChange={handle} placeholder="https://maps.app.goo.gl/…" />
              </Field>
              <Field label="Latitude">
                <input className="his-field" name="latitude" value={form.latitude || ""} onChange={handle} placeholder="28.9931" style={{ fontFamily: "DM Mono, monospace" }} />
              </Field>
              <Field label="Longitude">
                <input className="his-field" name="longitude" value={form.longitude || ""} onChange={handle} placeholder="77.0151" style={{ fontFamily: "DM Mono, monospace" }} />
              </Field>
            </div>
          </SubCard>
        </div>
      </Card>

      <Card title="Service Areas Covered" color={C.amber} icon="pi-flag"
        right={
          <span style={{ fontSize: 10.5, color: C.muted }}>{areas.length} area{areas.length === 1 ? "" : "s"}</span>
        }>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Cities / districts your homecare and emergency response covers. Shown to patients on the website / portal.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input className="his-field" value={newArea} onChange={e => setNewArea(e.target.value)}
            placeholder="e.g. Sonipat, Panipat, Karnal" style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === "Enter" && newArea.trim()) { updAreas([...areas, newArea.trim()]); setNewArea(""); } }} />
          <button onClick={() => { if (newArea.trim()) { updAreas([...areas, newArea.trim()]); setNewArea(""); } }} style={addBtn(C.amber)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {areas.length === 0 ? <span style={{ fontSize: 11.5, color: C.muted, fontStyle: "italic" }}>No service areas added yet.</span> :
            areas.map((a, i) => (
              <span key={i} style={{ padding: "3px 10px 3px 12px", borderRadius: 999, background: C.amberL, color: "#92400e", border: `1px solid ${C.amber}40`, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {a}
                <button onClick={() => updAreas(areas.filter((_, j) => j !== i))} style={{ background: "transparent", border: "none", color: "#92400e", cursor: "pointer", padding: 0, lineHeight: 1 }}>
                  <i className="pi pi-times" style={{ fontSize: 9 }} />
                </button>
              </span>
            ))}
        </div>
      </Card>

      <Card title="Phone & Helplines" color={C.green} icon="pi-phone">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Primary phone">
            <input className="his-field" name="phone1" value={form.phone1 || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX" />
          </Field>
          <Field label="Secondary phone">
            <input className="his-field" name="phone2" value={form.phone2 || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX" />
          </Field>
          <Field label="Emergency / casualty line">
            <input className="his-field" name="emergencyPhone" value={form.emergencyPhone || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX" />
          </Field>
          <Field label="WhatsApp Business">
            <input className="his-field" name="whatsappBusiness" value={form.whatsappBusiness || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX" />
          </Field>
          <Field label="Toll-free helpline">
            <input className="his-field" name="tollFreeNumber" value={form.tollFreeNumber || ""} onChange={handle} placeholder="1800-XXX-XXXX" />
          </Field>
          <Field label="Fax">
            <input className="his-field" name="fax" value={form.fax || ""} onChange={handle} placeholder="Fax number (optional)" />
          </Field>
        </div>
      </Card>

      <Card title="Email & Web" color={C.blue} icon="pi-envelope">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Primary email">
            <input className="his-field" type="email" name="email" value={form.email || ""} onChange={handle} placeholder="info@hospital.in" />
          </Field>
          <Field label="Billing email">
            <input className="his-field" type="email" name="billingEmail" value={form.billingEmail || ""} onChange={handle} placeholder="billing@hospital.in" />
          </Field>
          <Field label="Patient support email">
            <input className="his-field" type="email" name="supportEmail" value={form.supportEmail || ""} onChange={handle} placeholder="support@hospital.in" />
          </Field>
          <Field label="Hospital website">
            <input className="his-field" name="website" value={form.website || ""} onChange={handle} placeholder="https://www.hospital.in" />
          </Field>
          <Field label="Patient portal URL">
            <input className="his-field" name="patientPortalUrl" value={form.patientPortalUrl || ""} onChange={handle} placeholder="https://portal.hospital.in" />
          </Field>
        </div>
      </Card>

      <Card title="Department Contacts" color={C.purple} icon="pi-users"
        right={
          <button onClick={() => updContacts([...contacts, { label: "", phone: "", email: "", notes: "" }])} style={addBtn(C.purple)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add department
          </button>
        }>
        {contacts.length === 0
          ? <EmptyState text="Add department-specific lines (Reception, Pharmacy, Lab, Billing, Emergency)." />
          : contacts.map((c, idx) => {
            const updRow = (k, v) => updContacts(contacts.map((x, i) => i === idx ? { ...x, [k]: v } : x));
            return (
              <div key={idx} style={{ padding: 12, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 10, background: "#fff", display: "grid", gridTemplateColumns: "1fr 1.2fr 1.5fr 1.5fr auto", gap: 10 }}>
                <Field label="Label">
                  <input className="his-field" value={c.label || ""} onChange={e => updRow("label", e.target.value)} placeholder="Reception / Pharmacy / Lab" />
                </Field>
                <Field label="Phone">
                  <input className="his-field" value={c.phone || ""} onChange={e => updRow("phone", e.target.value)} placeholder="+91-XXXXX-XXXXX" />
                </Field>
                <Field label="Email">
                  <input className="his-field" type="email" value={c.email || ""} onChange={e => updRow("email", e.target.value)} placeholder="dept@hospital.in" />
                </Field>
                <Field label="Notes / hours">
                  <input className="his-field" value={c.notes || ""} onChange={e => updRow("notes", e.target.value)} placeholder="9 AM – 9 PM" />
                </Field>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                  <RowAction icon="pi-trash" label="Remove" color={C.red} onClick={() => updContacts(contacts.filter((_, i) => i !== idx))} />
                </div>
              </div>
            );
          })}
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   3. LEGAL & REGISTRATION
══════════════════════════════════════════════════════════════════ */
function LegalTab({ form, handle, toggle, setForm }) {
  const licences = form.licences || [];
  const updL = (next) => setForm(f => ({ ...f, licences: next }));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Tax Identifiers" color={C.amber} icon="pi-percentage">
        <div style={{ padding: "9px 12px", background: C.amberL, border: `1px solid ${C.amber}30`, borderRadius: 7, fontSize: 11.5, color: "#92400e", marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          These identifiers print on every bill, tax invoice and TDS certificate. Validate carefully before saving.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="GSTIN" required>
            <input className="his-field" name="gstin" value={form.gstin || ""} onChange={handle}
              placeholder="22AAAAA0000A1Z5" style={{ fontFamily: "DM Mono, monospace", textTransform: "uppercase", letterSpacing: ".5px" }} />
          </Field>
          <Field label="PAN number">
            <input className="his-field" name="panNumber" value={form.panNumber || ""} onChange={handle}
              placeholder="AAAPA0000A" style={{ fontFamily: "DM Mono, monospace", textTransform: "uppercase" }} />
          </Field>
          <Field label="TAN (TDS account no.)">
            <input className="his-field" name="tanNumber" value={form.tanNumber || ""} onChange={handle}
              placeholder="DELL00000A" style={{ fontFamily: "DM Mono, monospace", textTransform: "uppercase" }} />
          </Field>
          <Field label="CIN (for Pvt Ltd hospitals)">
            <input className="his-field" name="cinNumber" value={form.cinNumber || ""} onChange={handle}
              placeholder="U85110DL2010PTC123456" style={{ fontFamily: "DM Mono, monospace", textTransform: "uppercase" }} />
          </Field>
        </div>
      </Card>

      <Card title="Hospital Registrations" color={C.blue} icon="pi-verified">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="State health-dept registration no.">
            <input className="his-field" name="registrationNo" value={form.registrationNo || ""} onChange={handle} placeholder="Hospital registration number" />
          </Field>
          <Field label="Issuing authority">
            <input className="his-field" name="registrationAuthority" value={form.registrationAuthority || ""} onChange={handle} placeholder="State health department" />
          </Field>
          <Field label="Registration expires">
            <input className="his-field" type="date" name="registrationExpires" value={dateInput(form.registrationExpires)} onChange={handle} />
          </Field>
          <Field label="Rohini ID (IRDA)">
            <input className="his-field" name="rohiniId" value={form.rohiniId || ""} onChange={handle} placeholder="ROHINI ID for cashless" style={{ fontFamily: "DM Mono, monospace" }} />
          </Field>
          <Field label="Society registration no.">
            <input className="his-field" name="societyRegNo" value={form.societyRegNo || ""} onChange={handle} placeholder="For society / trust hospitals" />
          </Field>
          <Field label="Trust deed reference">
            <input className="his-field" name="trustDeedRef" value={form.trustDeedRef || ""} onChange={handle} placeholder="Deed registration ref" />
          </Field>
        </div>
      </Card>

      <Card title="Statutory Codes" color={C.purple} icon="pi-shield">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="EPF code">
            <input className="his-field" name="epfNumber" value={form.epfNumber || ""} onChange={handle} placeholder="Provident Fund establishment code" />
          </Field>
          <Field label="ESI registration">
            <input className="his-field" name="esiNumber" value={form.esiNumber || ""} onChange={handle} placeholder="ESI code" />
          </Field>
          <Field label="Professional tax registration">
            <input className="his-field" name="professionalTaxRegNo" value={form.professionalTaxRegNo || ""} onChange={handle} placeholder="PT registration" />
          </Field>
        </div>
      </Card>

      <Card title="ABDM / Digital Health" color={C.teal} icon="pi-database">
        <div style={{ padding: "9px 12px", background: C.tealL, border: `1px solid ${C.teal}30`, borderRadius: 7, fontSize: 11.5, color: "#0f766e", marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          ABDM (Ayushman Bharat Digital Mission) identifiers — required if you push FHIR bundles to ABHA personal health records.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="HFR (Health Facility Registry) ID">
            <input className="his-field" name="hfrId" value={form.hfrId || ""} onChange={handle} placeholder="HFR-XXXX-XXXX" style={{ fontFamily: "DM Mono, monospace" }} />
          </Field>
          <Field label="Hospital ABHA address">
            <input className="his-field" name="abhaAddress" value={form.abhaAddress || ""} onChange={handle} placeholder="hospital@abdm" style={{ fontFamily: "DM Mono, monospace" }} />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
            <Check label="FHIR bundle export enabled" v={form.fhirEnabled} on={toggle("fhirEnabled")} />
          </div>
        </div>
      </Card>

      <Card title="Operational Licences & Permits" color={C.red} icon="pi-id-card"
        right={
          <button onClick={() => updL([...licences, { label: "", number: "", issuedBy: "", issuedOn: null, expiresOn: null }])} style={addBtn(C.red)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add licence
          </button>
        }>
        <div style={{ padding: "9px 12px", background: C.redL, border: `1px solid ${C.red}30`, borderRadius: 7, fontSize: 11.5, color: "#991b1b", marginBottom: 14 }}>
          <i className="pi pi-exclamation-circle" style={{ marginRight: 6 }} />
          Track Drug Licence, Blood Bank Licence, Bio-Medical Waste Authorisation, Pollution Control, Fire NOC, Lift licence — anything with an expiry. Cards turn amber within 90 days of expiry.
        </div>
        {licences.length === 0
          ? <EmptyState text="No operational licences tracked yet — click Add licence above." />
          : licences.map((l, idx) => {
            const daysToExpiry = l.expiresOn ? Math.floor((new Date(l.expiresOn).getTime() - Date.now()) / 86400000) : null;
            const expiryColor = daysToExpiry == null ? null : daysToExpiry < 0 ? C.red : daysToExpiry < 90 ? C.amber : C.green;
            const updRow = (k, v) => updL(licences.map((x, i) => i === idx ? { ...x, [k]: v } : x));
            return (
              <div key={idx} style={{ padding: 12, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 10, background: "#fff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1.4fr 1fr 1fr auto", gap: 10 }}>
                  <Field label="Licence type">
                    <input className="his-field" value={l.label || ""} onChange={e => updRow("label", e.target.value)} placeholder="Drug Licence / Blood Bank / Fire NOC / BMW" />
                  </Field>
                  <Field label="Licence number">
                    <input className="his-field" value={l.number || ""} onChange={e => updRow("number", e.target.value)} placeholder="MH/20B/2024-001" style={{ fontFamily: "DM Mono, monospace" }} />
                  </Field>
                  <Field label="Issued by">
                    <input className="his-field" value={l.issuedBy || ""} onChange={e => updRow("issuedBy", e.target.value)} placeholder="State Drug Controller" />
                  </Field>
                  <Field label="Issued on">
                    <input type="date" className="his-field" value={dateInput(l.issuedOn)} onChange={e => updRow("issuedOn", e.target.value)} />
                  </Field>
                  <Field label="Expires on">
                    <input type="date" className="his-field" value={dateInput(l.expiresOn)} onChange={e => updRow("expiresOn", e.target.value)} />
                  </Field>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                    <RowAction icon="pi-trash" label="Remove" color={C.red} onClick={() => updL(licences.filter((_, i) => i !== idx))} />
                  </div>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                  <input className="his-field" placeholder="Notes (optional)" value={l.notes || ""} onChange={e => updRow("notes", e.target.value)} style={{ flex: 1 }} />
                  {daysToExpiry != null && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 4,
                      background: expiryColor + "15", color: expiryColor, border: `1px solid ${expiryColor}40`, marginLeft: 10, whiteSpace: "nowrap" }}>
                      {daysToExpiry < 0 ? `Expired ${-daysToExpiry}d ago` : daysToExpiry < 90 ? `Expires in ${daysToExpiry}d` : `Valid for ${daysToExpiry}d`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

        <SubCard title="Pharmacy-specific (legacy fields, still read by pharmacy bills)" color={C.muted} icon="pi-bookmark">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Drug Licence (pharmacy)">
              <input className="his-field" name="drugLicenseNumber" value={form.drugLicenseNumber || form.drugLicenseNo || ""}
                onChange={(e) => setForm(f => ({ ...f, drugLicenseNumber: e.target.value, drugLicenseNo: e.target.value }))}
                placeholder="MH/20B/2024-001" style={{ fontFamily: "DM Mono, monospace" }} />
            </Field>
            <Field label="FSSAI number">
              <input className="his-field" name="fssaiNumber" value={form.fssaiNumber || ""} onChange={handle}
                placeholder="FSSAI licence / registration" style={{ fontFamily: "DM Mono, monospace" }} />
            </Field>
          </div>
        </SubCard>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   4. PRINT & FOOTER
══════════════════════════════════════════════════════════════════ */
function PrintTab({ form, handle, toggle, setField, setForm }) {
  const sigs = form.signatures || [];
  const updS = (next) => setField("signatures")(next);
  const headerColor = form.printHeaderColor || "#1e293b";
  const accentColor = form.printAccentColor || "#1d4ed8";
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Live preview */}
      <Card title="Live Print Header Preview" color={C.purple} icon="pi-eye">
        <div style={{
          background: headerColor, borderRadius: 8, padding: "18px 22px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          boxShadow: "0 4px 14px rgba(15,23,42,.18)",
          textAlign: form.printHeaderAlign || "left",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {form.showLogoInPrint && form.logo && (
              <img src={form.logo} alt="" style={{ height: 50, objectFit: "contain", borderRadius: 4, background: "#fff", padding: 4 }} />
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{form.hospitalName || "Hospital Name"}</div>
              {form.showTaglineInPrint && form.tagline && (
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)", marginTop: 2 }}>{form.tagline}</div>
              )}
              {form.showAddressInHeader && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", marginTop: 2 }}>
                  {[form.city, form.state].filter(Boolean).join(", ")}
                </div>
              )}
              {form.showContactInHeader && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", marginTop: 1 }}>
                  {form.phone1 && <>📞 {form.phone1}</>}
                  {form.email && <> · ✉ {form.email}</>}
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: accentColor, fontWeight: 800, fontSize: 16, marginBottom: 6 }}>PATIENT BILL</div>
            {form.showAccreditationBadges && (
              <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
                {form.nabh && <PreviewBadge color="#22c55e" label="NABH" />}
                {form.nabl && <PreviewBadge color="#60a5fa" label="NABL" />}
                {(form.accreditations || []).filter(a => a.showOnPrint && a.name).map((a, i) =>
                  <PreviewBadge key={i} color="#f59e0b" label={a.name} />)}
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 10, padding: "8px 12px", background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 6, borderLeft: `3px solid ${accentColor}`, fontSize: 12, color: C.slate }}>
          <b>Terms preview:</b> {form.termsLine1 || "Add terms below to preview here."}
        </div>
      </Card>

      <Card title="Header Layout" color={C.blue} icon="pi-window-maximize">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Header alignment">
            <select className="his-field" name="printHeaderAlign" value={form.printHeaderAlign || "left"} onChange={handle}>
              <option value="left">Left aligned</option>
              <option value="center">Centered</option>
              <option value="right">Right aligned</option>
            </select>
          </Field>
          <Field label="Header height (mm)">
            <input className="his-field" type="number" name="printHeaderHeight" value={form.printHeaderHeight || 80} onChange={handle} min={40} max={150} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <SubCard title="What to show in the header" icon="pi-eye">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Check label="Show logo"           v={form.showLogoInPrint}        on={toggle("showLogoInPrint")} />
              <Check label="Show tagline"        v={form.showTaglineInPrint}     on={toggle("showTaglineInPrint")} />
              <Check label="Show accreditation badges" v={form.showAccreditationBadges} on={toggle("showAccreditationBadges")} />
              <Check label="Show address in header"    v={form.showAddressInHeader}     on={toggle("showAddressInHeader")} />
              <Check label="Show contact in header"    v={form.showContactInHeader}     on={toggle("showContactInHeader")} />
            </div>
          </SubCard>
        </div>
      </Card>

      <Card title="Print Colours" color={C.pink} icon="pi-palette">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ColorField label="Header background" name="printHeaderColor" value={headerColor} onChange={handle} />
          <ColorField label="Accent / highlight"  name="printAccentColor" value={accentColor} onChange={handle} />
        </div>
      </Card>

      <Card title="Watermark" color={C.amber} icon="pi-cloud">
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.2fr", gap: 14, alignItems: "end" }}>
          <Field label="Watermark text">
            <input className="his-field" name="watermarkText" value={form.watermarkText || ""} onChange={handle} placeholder="ORIGINAL · CONFIDENTIAL · DRAFT" />
          </Field>
          <Field label="Opacity">
            <input className="his-field" type="number" step="0.01" min={0} max={1}
              name="watermarkOpacity" value={form.watermarkOpacity ?? 0.08} onChange={handle} />
          </Field>
          <ImageUpload label="Watermark image (optional)" value={form.watermarkImage} onChange={setField("watermarkImage")}
            hint="Light-grey PNG works best. Renders behind page content." width={120} height={70} maxKB={200} />
        </div>
      </Card>

      <Card title="Page Settings" color={C.teal} icon="pi-file">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          <Field label="Default paper size">
            <select className="his-field" name="defaultPaperSize" value={form.defaultPaperSize || "A4"} onChange={handle}>
              <option value="A4">A4 (210×297 mm)</option>
              <option value="A5">A5 (148×210 mm)</option>
              <option value="Letter">US Letter</option>
              <option value="Legal">US Legal</option>
            </select>
          </Field>
          <Field label="Margin (mm)">
            <input className="his-field" type="number" name="defaultMarginMm" value={form.defaultMarginMm || 12} onChange={handle} min={5} max={25} />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <Check label="Show page numbers" v={form.showPageNumbers} on={toggle("showPageNumbers")} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <Check label="Show QR on bills" v={form.showQrOnBills} on={toggle("showQrOnBills")} />
          </div>
        </div>
        {form.showQrOnBills && (
          <div style={{ marginTop: 10 }}>
            <Field label="QR payload type">
              <select className="his-field" name="qrPayloadType" value={form.qrPayloadType || "billUrl"} onChange={handle} style={{ width: 220 }}>
                <option value="billUrl">Bill view URL</option>
                <option value="upiLink">UPI pay link (uses your UPI ID)</option>
                <option value="none">Custom (use callbacks)</option>
              </select>
            </Field>
          </div>
        )}
      </Card>

      <Card title="Signatures & Seals" color={C.purple} icon="pi-pencil"
        right={
          <button onClick={() => updS([...sigs, { role: "", name: "", imageDataUrl: "", showOn: ["bill"] }])} style={addBtn(C.purple)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add signature
          </button>
        }>
        <div style={{ padding: "9px 12px", background: C.purpleL, border: `1px solid ${C.purple}30`, borderRadius: 7, fontSize: 11.5, color: "#5b21b6", marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          Upload authorised signatory / medical superintendent signatures. Pick which document types they print on.
        </div>
        {sigs.length === 0
          ? <EmptyState text="No signatures yet — add an Authorised Signatory for prints." />
          : sigs.map((s, idx) => {
            const updRow = (k, v) => updS(sigs.map((x, i) => i === idx ? { ...x, [k]: v } : x));
            const toggleDoc = (doc) => {
              const list = s.showOn || [];
              updRow("showOn", list.includes(doc) ? list.filter(d => d !== doc) : [...list, doc]);
            };
            return (
              <div key={idx} style={{ padding: 12, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 10, background: "#fff", display: "grid", gridTemplateColumns: "200px 1fr 1fr auto", gap: 14, alignItems: "start" }}>
                <ImageUpload value={s.imageDataUrl} onChange={(v) => updRow("imageDataUrl", v)}
                  hint="PNG with transparent background works best." width={170} height={70} maxKB={150} />
                <div style={{ display: "grid", gap: 10 }}>
                  <Field label="Role">
                    <input className="his-field" value={s.role || ""} onChange={e => updRow("role", e.target.value)} placeholder="Authorised Signatory / Medical Superintendent / Billing Manager" />
                  </Field>
                  <Field label="Name">
                    <input className="his-field" value={s.name || ""} onChange={e => updRow("name", e.target.value)} placeholder="Dr. A. Sharma" />
                  </Field>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Print on</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {["bill", "prescription", "certificate", "discharge", "lab-report"].map(doc => (
                      <Check key={doc} label={doc.charAt(0).toUpperCase() + doc.slice(1).replace("-", " ")} v={(s.showOn || []).includes(doc)} on={() => toggleDoc(doc)} />
                    ))}
                  </div>
                </div>
                <div style={{ paddingTop: 4 }}>
                  <RowAction icon="pi-trash" label="Remove" color={C.red} onClick={() => updS(sigs.filter((_, i) => i !== idx))} />
                </div>
              </div>
            );
          })}
        <SubCard title="Hospital seal / stamp" icon="pi-bookmark">
          <ImageUpload value={form.hospitalSeal} onChange={setField("hospitalSeal")}
            hint="Round official seal — auto-printed on certificates and discharge summaries." width={120} height={120} maxKB={200} />
        </SubCard>
      </Card>

      <Card title="Bill Footer & Policies" color={C.red} icon="pi-file-edit">
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Footer thank-you note">
            <input className="his-field" name="billFooterNote" value={form.billFooterNote || ""} onChange={handle}
              placeholder="Thank you for choosing our hospital." />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Terms line 1">
              <input className="his-field" name="termsLine1" value={form.termsLine1 || ""} onChange={handle} />
            </Field>
            <Field label="Terms line 2">
              <input className="his-field" name="termsLine2" value={form.termsLine2 || ""} onChange={handle} />
            </Field>
            <Field label="Terms line 3">
              <input className="his-field" name="termsLine3" value={form.termsLine3 || ""} onChange={handle} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Refund policy (printed below totals)">
              <textarea className="his-textarea" rows={2} name="refundPolicy" value={form.refundPolicy || ""} onChange={handle}
                placeholder="Refunds processed within 7 working days subject to deduction of bank charges." />
            </Field>
            <Field label="Late-payment policy">
              <textarea className="his-textarea" rows={2} name="latePaymentPolicy" value={form.latePaymentPolicy || ""} onChange={handle}
                placeholder="Outstanding balances beyond 30 days attract 1.5% / month interest." />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   5. BANK & PAYMENT DETAILS
══════════════════════════════════════════════════════════════════ */
function BankTab({ form, handle, setField, setForm }) {
  const accounts = form.bankAccounts || [];
  const updA = (next) => setField("bankAccounts")(next);
  const setPrimary = (idx) => updA(accounts.map((a, i) => ({ ...a, isPrimary: i === idx })));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Bank Accounts" color={C.slate} icon="pi-building-columns"
        right={
          <button onClick={() => updA([...accounts, { bankName: "", accountNo: "", ifscCode: "", bankBranch: "", accountType: "Current", isPrimary: accounts.length === 0 }])} style={addBtn(C.slate)}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add bank account
          </button>
        }>
        <div style={{ padding: "9px 12px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 11.5, color: C.muted, marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          The <b>Primary</b> account is the default — printed on advance / final bill receipts. Others appear as alternates.
        </div>
        {accounts.length === 0
          ? <EmptyState text="No bank accounts yet — click Add bank account above." />
          : accounts.map((a, idx) => {
            const updRow = (k, v) => updA(accounts.map((x, i) => i === idx ? { ...x, [k]: v } : x));
            return (
              <div key={idx} style={{
                padding: 14, marginBottom: 12, borderRadius: 10,
                background: a.isPrimary ? C.blueL : "#fff",
                border: `2px solid ${a.isPrimary ? C.blue : C.border}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a.isPrimary
                      ? <ThemeBadge value="Primary" palette="approved" />
                      : <button onClick={() => setPrimary(idx)} style={{ background: "#fff", border: `1.5px solid ${C.blue}`, color: C.blue, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 5, cursor: "pointer" }}>Set primary</button>}
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{a.bankName || "—"}</span>
                  </div>
                  <RowAction icon="pi-trash" label="Remove" color={C.red} onClick={() => {
                    const next = accounts.filter((_, i) => i !== idx);
                    if (a.isPrimary && next.length > 0) next[0].isPrimary = true;
                    updA(next);
                  }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr 1fr 1fr", gap: 10 }}>
                  <Field label="Bank name">
                    <input className="his-field" value={a.bankName || ""} onChange={e => updRow("bankName", e.target.value)} placeholder="State Bank of India" />
                  </Field>
                  <Field label="Account holder">
                    <input className="his-field" value={a.accountHolder || ""} onChange={e => updRow("accountHolder", e.target.value)} placeholder={form.hospitalName || "Hospital name"} />
                  </Field>
                  <Field label="Account no.">
                    <input className="his-field" value={a.accountNo || ""} onChange={e => updRow("accountNo", e.target.value)} placeholder="XXXX XXXX XXXX" style={{ fontFamily: "DM Mono, monospace" }} />
                  </Field>
                  <Field label="IFSC code">
                    <input className="his-field" value={a.ifscCode || ""} onChange={e => updRow("ifscCode", e.target.value.toUpperCase())} placeholder="SBIN0001234" style={{ fontFamily: "DM Mono, monospace" }} />
                  </Field>
                  <Field label="Account type">
                    <select className="his-field" value={a.accountType || "Current"} onChange={e => updRow("accountType", e.target.value)}>
                      <option value="Current">Current</option>
                      <option value="Savings">Savings</option>
                      <option value="NRO">NRO</option>
                      <option value="NRE">NRE</option>
                    </select>
                  </Field>
                  <Field label="Branch">
                    <input className="his-field" value={a.bankBranch || ""} onChange={e => updRow("bankBranch", e.target.value)} placeholder="Sector 14, Sonipat" />
                  </Field>
                  <Field label="SWIFT (for foreign remittance)">
                    <input className="his-field" value={a.swiftCode || ""} onChange={e => updRow("swiftCode", e.target.value)} placeholder="SBININBBXXX" style={{ fontFamily: "DM Mono, monospace" }} />
                  </Field>
                  <Field label="Notes (optional)">
                    <input className="his-field" value={a.notes || ""} onChange={e => updRow("notes", e.target.value)} placeholder="Used for cash deposits only" />
                  </Field>
                </div>
              </div>
            );
          })}
      </Card>

      <Card title="UPI / Digital Payment" color={C.green} icon="pi-mobile">
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr", gap: 18 }}>
          <ImageUpload label="UPI QR code image" value={form.upiQrImage} onChange={setField("upiQrImage")}
            hint="Auto-printed on bills. Generate at your bank's UPI portal."
            width={170} height={170} maxKB={300} />
          <Field label="UPI ID">
            <input className="his-field" name="upiId" value={form.upiId || ""} onChange={handle}
              placeholder="hospital@upi" style={{ fontFamily: "DM Mono, monospace" }} />
          </Field>
          <Field label="UPI handler name (printed on receipt)">
            <input className="his-field" name="upiHandlerName" value={form.upiHandlerName || ""} onChange={handle}
              placeholder="SphereHealth Hospital" />
          </Field>
        </div>
      </Card>

      <Card title="Cheque Settings" color={C.amber} icon="pi-credit-card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
          <Field label="Cheque payable to">
            <input className="his-field" name="chequePayableTo" value={form.chequePayableTo || ""} onChange={handle}
              placeholder={form.hospitalName || "Hospital name as it should appear on cheques"} />
          </Field>
          <Field label="Cheque delivery address (if different from main)">
            <input className="his-field" name="chequeDeliveryAddress" value={form.chequeDeliveryAddress || ""} onChange={handle}
              placeholder="Accounts Dept, ground floor, Block-A" />
          </Field>
        </div>
      </Card>

      <Card title="Payment Gateway (online payments)" color={C.purple} icon="pi-shopping-cart">
        <div style={{ padding: "9px 12px", background: C.purpleL, border: `1px solid ${C.purple}30`, borderRadius: 7, fontSize: 11.5, color: "#5b21b6", marginBottom: 14 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          Display-only here — the actual secret key lives in the server <code>.env</code> file. We store only the provider + Key-ID so admins know which gateway is active.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
          <Field label="Provider">
            <select className="his-field" name="paymentGatewayProvider" value={form.paymentGatewayProvider || ""} onChange={handle}>
              <option value="">— None / cash-only —</option>
              <option value="Razorpay">Razorpay</option>
              <option value="Stripe">Stripe</option>
              <option value="PayU">PayU</option>
              <option value="CCAvenue">CCAvenue</option>
              <option value="Cashfree">Cashfree</option>
            </select>
          </Field>
          <Field label="Public Key ID (not the secret)">
            <input className="his-field" name="paymentGatewayKeyId" value={form.paymentGatewayKeyId || ""} onChange={handle}
              placeholder="rzp_test_xxxxxxxxxxxx" style={{ fontFamily: "DM Mono, monospace" }} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Small helpers
══════════════════════════════════════════════════════════════════ */
function PreviewBadge({ color, label }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 10,
      background: `${color}22`, color, border: `1px solid ${color}55`,
      fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", marginLeft: 4,
    }}>{label}</span>
  );
}

function ColorField({ label, name, value, onChange }) {
  return (
    <Field label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="color" name={name} value={value} onChange={onChange}
          style={{ width: 48, height: 38, border: `1.5px solid ${C.border}`, borderRadius: 7, cursor: "pointer", padding: 2, flexShrink: 0 }} />
        <input className="his-field" type="text" name={name} value={value} onChange={onChange}
          style={{ width: 120, fontFamily: "DM Mono, monospace" }} />
        <div style={{ width: 60, height: 30, background: value, borderRadius: 6, border: `1.5px solid ${C.border}`, flexShrink: 0 }} />
      </div>
    </Field>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: "20px 16px", textAlign: "center", color: C.muted, background: C.subtle, border: `1.5px dashed ${C.border}`, borderRadius: 9, fontSize: 12, fontStyle: "italic" }}>
      {text}
    </div>
  );
}

const addBtn = (color) => ({
  padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${color}40`,
  background: "#fff", color, fontSize: 11, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 5,
});

const dateInput = (v) => v ? new Date(v).toISOString().slice(0, 10) : "";
