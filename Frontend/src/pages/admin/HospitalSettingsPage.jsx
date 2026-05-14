/**
 * HospitalSettingsPage.jsx — admin page for hospital identity, branding,
 * print settings, legal fields, bank details.
 *
 * Redesigned to the latest theme:
 * - Orange hero band with Save button on the right
 * - Tab strip to navigate between 5 logical sections
 *   (Identity · Address & Contact · Legal · Print & Branding · Bill & Bank)
 * - Each tab body uses the shared Card / Field / Check / Modal primitives
 * - Live print-header preview always at the top of the Print tab
 * - Unsaved-changes ribbon appears the moment any field is touched
 */
import React, { useEffect, useRef, useState, useMemo } from "react";
import { toast } from "react-toastify";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import {
  AdminPage, Hero, TabStrip, Card, Field, Check, PrimaryButton, C,
} from "../../Components/admin-theme";

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const TABS = [
  { key: "identity", label: "Identity & Branding", icon: "pi-image" },
  { key: "address",  label: "Address & Contact",   icon: "pi-map-marker" },
  { key: "legal",    label: "Legal & Registration",icon: "pi-verified" },
  { key: "print",    label: "Print & Footer",      icon: "pi-print" },
  { key: "bank",     label: "Bank Details",        icon: "pi-building-columns" },
];

export default function HospitalSettingsPage() {
  const { settings: ctx, reload } = useHospitalSettings();
  const [tab, setTab]     = useState("identity");
  const [form, setForm]   = useState({ ...ctx });
  const [orig, setOrig]   = useState({ ...ctx });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(ctx.logo || "");
  const fileRef = useRef(null);

  useEffect(() => {
    setForm({ ...ctx });
    setOrig({ ...ctx });
    setPreview(ctx.logo || "");
  }, [ctx]);

  // Compare keys we care about (skip mongo internals) to detect dirty state.
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(orig || {}), ...Object.keys(form || {})]);
    for (const k of keys) {
      if (k.startsWith("_") || k === "createdAt" || k === "updatedAt") continue;
      if ((orig?.[k] ?? "") !== (form?.[k] ?? "")) return true;
    }
    return false;
  }, [form, orig]);

  const handle = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };
  const toggle = (name) => () => setForm(f => ({ ...f, [name]: !f[name] }));

  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error("Logo must be under 500 KB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target.result;
      setPreview(data);
      setForm(f => ({ ...f, logo: data }));
    };
    reader.readAsDataURL(file);
  };
  const removeLogo = () => {
    setPreview("");
    setForm(f => ({ ...f, logo: "" }));
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/hospital-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("Settings saved — all prints will use the updated profile");
        setOrig({ ...form });
        reload();
      } else {
        toast.error("Save failed: " + (json.message || "unknown error"));
      }
    } catch (e) {
      toast.error("Network error: " + e.message);
    } finally { setSaving(false); }
  };

  // Save button always visible in the hero's right slot.
  const saveButton = (
    <PrimaryButton
      icon={saving ? "pi-spin pi-spinner" : "pi-save"}
      label={saving ? "Saving…" : (dirty ? "Save changes" : "Saved")}
      onClick={save}
      busy={saving}
      disabled={!dirty}
      color="#fff"
    />
  );

  return (
    <AdminPage>
      <Hero icon="pi-building" color="blue"
        title="Hospital Settings"
        subtitle="Hospital profile · branding · print headers / footers — used across every patient document & bill"
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

      {tab === "identity" && <IdentityTab form={form} handle={handle} toggle={toggle} preview={preview} fileRef={fileRef} handleLogo={handleLogo} removeLogo={removeLogo} />}
      {tab === "address"  && <AddressTab  form={form} handle={handle} />}
      {tab === "legal"    && <LegalTab    form={form} handle={handle} />}
      {tab === "print"    && <PrintTab    form={form} handle={handle} toggle={toggle} />}
      {tab === "bank"     && <BankTab     form={form} handle={handle} />}
    </AdminPage>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB: Identity & Branding — logo + hospital name + tagline + NABH/NABL
══════════════════════════════════════════════════════════════════ */
function IdentityTab({ form, handle, toggle, preview, fileRef, handleLogo, removeLogo }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Logo" color={C.purple} icon="pi-image">
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{
            width: 160, height: 100, border: `2px dashed ${C.border}`, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: C.subtle, overflow: "hidden", flexShrink: 0,
          }}>
            {preview
              ? <img src={preview} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              : <span style={{ fontSize: 11, color: C.muted, textAlign: "center" }}>No logo<br />uploaded</span>}
          </div>

          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} id="logo-upload" />
              <label htmlFor="logo-upload" style={{
                padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.blue}`,
                background: "#fff", color: C.blue, fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <i className="pi pi-upload" /> Upload logo
              </label>
              {preview && (
                <button onClick={removeLogo} style={{
                  padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.red}`,
                  background: "#fff", color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  <i className="pi pi-trash" /> Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              PNG / JPG · max 500 KB · recommended 300×150 px for clean print.
            </div>
          </div>

          <div>
            <Field label="Logo width in print (px)">
              <input className="his-field" type="number" name="logoWidth"
                value={form.logoWidth || 120} onChange={handle} min={40} max={300}
                style={{ width: 120 }} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Hospital Identity" color={C.blue} icon="pi-building">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Hospital name" required>
            <input className="his-field" name="hospitalName" value={form.hospitalName || ""} onChange={handle}
              placeholder="SphereHealth Hospital" />
          </Field>
          <Field label="Tagline / accreditation line">
            <input className="his-field" name="tagline" value={form.tagline || ""} onChange={handle}
              placeholder="NABH Accredited Multi-Specialty Hospital" />
          </Field>
        </div>

        <div style={{ marginTop: 14, padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
            Accreditation badges (shown on prints)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Check label="NABH Accredited" v={form.nabh} on={toggle("nabh")} />
            <Check label="NABL Accredited" v={form.nabl} on={toggle("nabl")} />
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB: Address & Contact
══════════════════════════════════════════════════════════════════ */
function AddressTab({ form, handle }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Hospital Address" color={C.teal} icon="pi-map-marker">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "span 2" }}>
            <Field label="Address line 1">
              <input className="his-field" name="addressLine1" value={form.addressLine1 || ""} onChange={handle} placeholder="Building, Street" />
            </Field>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <Field label="Address line 2">
              <input className="his-field" name="addressLine2" value={form.addressLine2 || ""} onChange={handle} placeholder="Area, Landmark (optional)" />
            </Field>
          </div>
          <Field label="City">
            <input className="his-field" name="city" value={form.city || ""} onChange={handle} placeholder="City" />
          </Field>
          <Field label="State">
            <input className="his-field" name="state" value={form.state || ""} onChange={handle} placeholder="State" />
          </Field>
          <Field label="Pincode">
            <input className="his-field" name="pincode" value={form.pincode || ""} onChange={handle} placeholder="Pincode" />
          </Field>
          <Field label="Country">
            <input className="his-field" name="country" value={form.country || "India"} onChange={handle} placeholder="India" />
          </Field>
        </div>
      </Card>

      <Card title="Contact Information" color={C.green} icon="pi-phone">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Primary phone">
            <input className="his-field" name="phone1" value={form.phone1 || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX" />
          </Field>
          <Field label="Secondary phone">
            <input className="his-field" name="phone2" value={form.phone2 || ""} onChange={handle} placeholder="+91-XXXXX-XXXXX (optional)" />
          </Field>
          <Field label="Email address">
            <input className="his-field" type="email" name="email" value={form.email || ""} onChange={handle} placeholder="billing@hospital.in" />
          </Field>
          <Field label="Website">
            <input className="his-field" name="website" value={form.website || ""} onChange={handle} placeholder="www.hospital.in" />
          </Field>
          <Field label="Fax">
            <input className="his-field" name="fax" value={form.fax || ""} onChange={handle} placeholder="Fax number (optional)" />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB: Legal & Registration
══════════════════════════════════════════════════════════════════ */
function LegalTab({ form, handle }) {
  return (
    <Card title="Legal & Registration" color={C.amber} icon="pi-verified">
      <div style={{ padding: "10px 14px", background: C.amberL, border: `1.5px solid ${C.amber}30`, borderRadius: 9, marginBottom: 14, fontSize: 12, color: "#92400e" }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        These identifiers appear on every printed bill, prescription, and claim form. Double-check before saving.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="GSTIN" required>
          <input className="his-field" name="gstin" value={form.gstin || ""} onChange={handle}
            placeholder="22AAAAA0000A1Z5" style={{ fontFamily: "DM Mono, monospace", letterSpacing: ".5px" }} />
        </Field>
        <Field label="PAN number">
          <input className="his-field" name="panNumber" value={form.panNumber || ""} onChange={handle}
            placeholder="AAAPA0000A" style={{ fontFamily: "DM Mono, monospace", letterSpacing: ".5px" }} />
        </Field>
        <Field label="Hospital registration no.">
          <input className="his-field" name="registrationNo" value={form.registrationNo || ""} onChange={handle}
            placeholder="State health registration number" />
        </Field>
        <Field label="Rohini ID (for insurance)">
          <input className="his-field" name="rohiniId" value={form.rohiniId || ""} onChange={handle}
            placeholder="Rohini ID issued by IRDA" />
        </Field>
        <Field label="Drug License No. (pharmacy)">
          <input className="his-field" name="drugLicenseNumber" value={form.drugLicenseNumber || form.drugLicenseNo || ""} onChange={handle}
            placeholder="MH/20B/2024-001" style={{ fontFamily: "DM Mono, monospace", letterSpacing: ".5px" }} />
        </Field>
        <Field label="FSSAI number">
          <input className="his-field" name="fssaiNumber" value={form.fssaiNumber || ""} onChange={handle}
            placeholder="FSSAI registration / licence" />
        </Field>
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB: Print settings, colours, header preview, bill footer terms
══════════════════════════════════════════════════════════════════ */
function PrintTab({ form, handle, toggle }) {
  const headerColor = form.printHeaderColor || "#1e293b";
  const accentColor = form.printAccentColor || "#1d4ed8";
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Live Print Header Preview" color={C.purple} icon="pi-eye">
        <div style={{
          background: headerColor, borderRadius: 8, padding: "18px 22px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          boxShadow: "0 4px 14px rgba(15,23,42,.18)",
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
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", marginTop: 2 }}>
                {[form.city, form.state].filter(Boolean).join(", ")}
                {form.phone1 && ` · 📞 ${form.phone1}`}
                {form.email && ` · ✉ ${form.email}`}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: accentColor, fontWeight: 800, fontSize: 16, marginBottom: 6 }}>PATIENT BILL</div>
            {form.nabh && <Badge color="#22c55e" label="NABH" />}
            {form.nabl && <Badge color="#60a5fa" label="NABL" />}
          </div>
        </div>
        <div style={{ marginTop: 10, padding: "8px 12px", background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 6, borderLeft: `3px solid ${accentColor}`, fontSize: 12, color: C.slate }}>
          <b>Terms preview:</b> {form.termsLine1 || "Add a terms line below to preview it here."}
        </div>
      </Card>

      <Card title="Print Header Colours" color={C.blue} icon="pi-palette">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ColorField label="Header background" name="printHeaderColor" value={headerColor} onChange={handle} />
          <ColorField label="Accent / highlight"  name="printAccentColor" value={accentColor} onChange={handle} />
        </div>
        <div style={{ marginTop: 14, padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
            Header content toggles
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Check label="Show logo in prints"    v={form.showLogoInPrint}    on={toggle("showLogoInPrint")} />
            <Check label="Show tagline in prints" v={form.showTaglineInPrint} on={toggle("showTaglineInPrint")} />
          </div>
        </div>
      </Card>

      <Card title="Bill Footer & Terms" color={C.pink} icon="pi-file-edit">
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Footer thank-you note">
            <input className="his-field" name="billFooterNote" value={form.billFooterNote || ""} onChange={handle}
              placeholder="Thank you for choosing our hospital." />
          </Field>
          <Field label="Terms line 1">
            <input className="his-field" name="termsLine1" value={form.termsLine1 || ""} onChange={handle}
              placeholder="This is a computer-generated bill and does not require a physical signature." />
          </Field>
          <Field label="Terms line 2">
            <input className="his-field" name="termsLine2" value={form.termsLine2 || ""} onChange={handle}
              placeholder="All charges are as per the approved hospital tariff." />
          </Field>
          <Field label="Terms line 3">
            <input className="his-field" name="termsLine3" value={form.termsLine3 || ""} onChange={handle}
              placeholder="For queries, contact the Billing Department." />
          </Field>
        </div>
      </Card>
    </div>
  );
}

function Badge({ color, label }) {
  return (
    <span style={{
      display: "inline-block", marginLeft: 4,
      padding: "2px 8px", borderRadius: 10,
      background: `${color}22`, color, border: `1px solid ${color}55`,
      fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
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

/* ════════════════════════════════════════════════════════════════
   TAB: Bank details (for payment receipts)
══════════════════════════════════════════════════════════════════ */
function BankTab({ form, handle }) {
  return (
    <Card title="Bank Details" color={C.slate} icon="pi-building-columns">
      <div style={{ padding: "10px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9, marginBottom: 14, fontSize: 12, color: C.muted }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        Bank details are printed on advance / final bill receipts so patients can transfer the balance directly. Leave blank to skip the section on prints.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Bank name">
          <input className="his-field" name="bankName" value={form.bankName || ""} onChange={handle} placeholder="State Bank of India" />
        </Field>
        <Field label="Account number">
          <input className="his-field" name="accountNo" value={form.accountNo || ""} onChange={handle}
            placeholder="XXXX XXXX XXXX" style={{ fontFamily: "DM Mono, monospace" }} />
        </Field>
        <Field label="IFSC code">
          <input className="his-field" name="ifscCode" value={form.ifscCode || ""} onChange={handle}
            placeholder="SBIN0001234" style={{ fontFamily: "DM Mono, monospace", textTransform: "uppercase" }} />
        </Field>
        <Field label="Branch">
          <input className="his-field" name="bankBranch" value={form.bankBranch || ""} onChange={handle}
            placeholder="Branch name" />
        </Field>
        <Field label="UPI ID">
          <input className="his-field" name="upiId" value={form.upiId || ""} onChange={handle}
            placeholder="hospital@upi" style={{ fontFamily: "DM Mono, monospace" }} />
        </Field>
      </div>
    </Card>
  );
}
