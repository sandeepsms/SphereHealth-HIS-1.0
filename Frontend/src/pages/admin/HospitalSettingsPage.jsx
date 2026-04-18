import React, { useState, useEffect, useRef } from "react";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

/* ─── Reusable field components ─────────────────────────────────────────── */
function Field({ label, name, value, onChange, type = "text", placeholder = "", half = false, hint }) {
  return (
    <div style={{ gridColumn: half ? "span 1" : "span 2", display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={LS.label}>{label}</label>
      <input
        type={type} name={name} value={value || ""} placeholder={placeholder}
        onChange={onChange} style={LS.input}
      />
      {hint && <span style={{ fontSize: 11, color: "#94a3b8" }}>{hint}</span>}
    </div>
  );
}

function Toggle({ label, name, checked, onChange, description }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{label}</div>
        {description && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange({ target: { name, type: "checkbox", checked: !checked } })}
        style={{
          width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
          background: checked ? "#2563eb" : "#cbd5e1", position: "relative", transition: "background .2s", flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: "50%", background: "#fff",
          transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.2)",
        }} />
      </button>
    </div>
  );
}

/* ─── Section Card ──────────────────────────────────────────────────────── */
function Section({ title, icon, color = "#1e293b", children }) {
  return (
    <div style={LS.card}>
      <div style={{ ...LS.cardHeader, borderLeft: `4px solid ${color}` }}>
        <i className={`pi ${icon}`} style={{ color, fontSize: 16 }} />
        <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{title}</span>
      </div>
      <div style={LS.cardBody}>{children}</div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function HospitalSettingsPage() {
  const { settings: ctx, reload } = useHospitalSettings();
  const [form,    setForm]    = useState({ ...ctx });
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [preview, setPreview] = useState(ctx.logo || "");
  const fileRef = useRef(null);

  /* Sync context into form when it loads */
  useEffect(() => {
    setForm({ ...ctx });
    setPreview(ctx.logo || "");
  }, [ctx]);

  const handle = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  /* Logo upload → base64 */
  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { alert("Logo must be under 500 KB"); return; }
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
    setSaved(false);
    try {
      const res  = await fetch(`${API_URL}/hospital-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) { setSaved(true); reload(); setTimeout(() => setSaved(false), 3000); }
      else alert("Save failed: " + json.message);
    } catch (e) {
      alert("Network error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={LS.page}>
      {/* ── Page Header ── */}
      <div style={LS.pageHeader}>
        <div>
          <h1 style={LS.pageTitle}>🏥 Hospital Settings</h1>
          <p style={LS.pageSubtitle}>Manage hospital profile, branding, and print header/footer — used across all patient documents & bills</p>
        </div>
        <button onClick={save} disabled={saving} style={saving ? { ...LS.saveBtn, opacity: .7 } : LS.saveBtn}>
          {saving ? "⏳ Saving…" : saved ? "✅ Saved!" : "💾 Save Settings"}
        </button>
      </div>

      {saved && (
        <div style={LS.successBanner}>
          ✅ Settings saved successfully! All print headers and footers will now use the updated information.
        </div>
      )}

      {/* ── Logo & Branding ── */}
      <Section title="Logo & Branding" icon="pi-image" color="#7c3aed">
        <div style={LS.grid}>
          {/* Logo Preview */}
          <div style={{ gridColumn: "span 2" }}>
            <label style={LS.label}>Hospital Logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 8 }}>
              <div style={{ width: 140, height: 90, border: "2px dashed #cbd5e1", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", overflow: "hidden" }}>
                {preview
                  ? <img src={preview} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  : <span style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>No logo<br />uploaded</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} id="logo-upload" />
                <label htmlFor="logo-upload" style={{ ...LS.outlineBtn, cursor: "pointer" }}>📁 Upload Logo</label>
                {preview && <button type="button" onClick={removeLogo} style={LS.dangerBtn}>🗑 Remove</button>}
                <span style={{ fontSize: 11, color: "#94a3b8" }}>PNG/JPG · Max 500 KB · Recommended: 300×150px</span>
              </div>
              <div style={{ marginLeft: 20 }}>
                <label style={LS.label}>Logo Width in Print (px)</label>
                <input type="number" name="logoWidth" value={form.logoWidth || 120} onChange={handle} style={{ ...LS.input, width: 100, marginTop: 4 }} min={40} max={300} />
              </div>
            </div>
          </div>

          <Field label="Hospital Name"  name="hospitalName"  value={form.hospitalName}  onChange={handle} placeholder="e.g. SphereHealth Hospital" />
          <Field label="Tagline / Accreditation" name="tagline" value={form.tagline} onChange={handle} placeholder="e.g. NABH Accredited Multi-Specialty Hospital" />
        </div>

        {/* Accreditation Toggles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Toggle label="NABH Accredited" name="nabh" checked={!!form.nabh} onChange={handle} description="Shows NABH badge on prints" />
          <Toggle label="NABL Accredited" name="nabl" checked={!!form.nabl} onChange={handle} description="Shows NABL badge on prints" />
        </div>
      </Section>

      {/* ── Address ── */}
      <Section title="Hospital Address" icon="pi-map-marker" color="#0891b2">
        <div style={LS.grid}>
          <Field label="Address Line 1"  name="addressLine1" value={form.addressLine1} onChange={handle} placeholder="Building, Street" />
          <Field label="Address Line 2"  name="addressLine2" value={form.addressLine2} onChange={handle} placeholder="Area, Landmark (optional)" />
          <Field label="City"            name="city"         value={form.city}         onChange={handle} placeholder="City" half />
          <Field label="State"           name="state"        value={form.state}        onChange={handle} placeholder="State" half />
          <Field label="Pincode"         name="pincode"      value={form.pincode}      onChange={handle} placeholder="Pincode" half />
          <Field label="Country"         name="country"      value={form.country}      onChange={handle} placeholder="India" half />
        </div>
      </Section>

      {/* ── Contact ── */}
      <Section title="Contact Information" icon="pi-phone" color="#059669">
        <div style={LS.grid}>
          <Field label="Primary Phone"   name="phone1"   value={form.phone1}   onChange={handle} placeholder="+91-XXXXX-XXXXX" half />
          <Field label="Secondary Phone" name="phone2"   value={form.phone2}   onChange={handle} placeholder="+91-XXXXX-XXXXX (optional)" half />
          <Field label="Email Address"   name="email"    value={form.email}    onChange={handle} type="email" placeholder="billing@hospital.in" half />
          <Field label="Website"         name="website"  value={form.website}  onChange={handle} placeholder="www.hospital.in" half />
          <Field label="Fax"             name="fax"      value={form.fax}      onChange={handle} placeholder="Fax number (optional)" half />
        </div>
      </Section>

      {/* ── Legal & Registration ── */}
      <Section title="Legal & Registration" icon="pi-verified" color="#d97706">
        <div style={LS.grid}>
          <Field label="GSTIN"            name="gstin"          value={form.gstin}          onChange={handle} placeholder="22AAAAA0000A1Z5" half />
          <Field label="PAN Number"       name="panNumber"      value={form.panNumber}      onChange={handle} placeholder="AAAPA0000A" half />
          <Field label="Registration No." name="registrationNo" value={form.registrationNo} onChange={handle} placeholder="Hospital Registration Number" half />
          <Field label="Rohini ID"        name="rohiniId"       value={form.rohiniId}       onChange={handle} placeholder="Rohini ID (for insurance)" half />
        </div>
      </Section>

      {/* ── Print Settings ── */}
      <Section title="Print Header & Footer Settings" icon="pi-print" color="#1d4ed8">
        <div style={LS.grid}>
          <div style={{ gridColumn: "span 1" }}>
            <label style={LS.label}>Header Background Color</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <input type="color" name="printHeaderColor" value={form.printHeaderColor || "#1e293b"} onChange={handle}
                style={{ width: 48, height: 36, border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 2 }} />
              <input type="text" name="printHeaderColor" value={form.printHeaderColor || "#1e293b"} onChange={handle} style={{ ...LS.input, width: 110 }} />
              <span style={{ width: 60, height: 28, background: form.printHeaderColor, borderRadius: 6, border: "1px solid #e2e8f0" }} />
            </div>
          </div>
          <div style={{ gridColumn: "span 1" }}>
            <label style={LS.label}>Accent / Highlight Color</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <input type="color" name="printAccentColor" value={form.printAccentColor || "#1d4ed8"} onChange={handle}
                style={{ width: 48, height: 36, border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 2 }} />
              <input type="text" name="printAccentColor" value={form.printAccentColor || "#1d4ed8"} onChange={handle} style={{ ...LS.input, width: 110 }} />
              <span style={{ width: 60, height: 28, background: form.printAccentColor, borderRadius: 6, border: "1px solid #e2e8f0" }} />
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Toggle label="Show Logo in Prints" name="showLogoInPrint" checked={!!form.showLogoInPrint} onChange={handle} description="Display hospital logo on bills and documents" />
          <Toggle label="Show Tagline in Prints" name="showTaglineInPrint" checked={!!form.showTaglineInPrint} onChange={handle} description="Display accreditation tagline below hospital name" />
        </div>
      </Section>

      {/* ── Bill Footer ── */}
      <Section title="Bill Footer & Terms" icon="pi-file-edit" color="#db2777">
        <div style={LS.grid}>
          <Field label="Footer Thank-You Note" name="billFooterNote" value={form.billFooterNote} onChange={handle} placeholder="Thank you for choosing our hospital." />
          <Field label="Terms Line 1" name="termsLine1" value={form.termsLine1} onChange={handle} placeholder="Computer generated bill..." />
          <Field label="Terms Line 2" name="termsLine2" value={form.termsLine2} onChange={handle} placeholder="All charges as per tariff..." />
          <Field label="Terms Line 3" name="termsLine3" value={form.termsLine3} onChange={handle} placeholder="For queries, contact Billing Dept." />
        </div>
      </Section>

      {/* ── Bank Details ── */}
      <Section title="Bank Details (for Payment Receipts)" icon="pi-building-columns" color="#475569">
        <div style={LS.grid}>
          <Field label="Bank Name"      name="bankName"   value={form.bankName}   onChange={handle} placeholder="State Bank of India" half />
          <Field label="Account Number" name="accountNo"  value={form.accountNo}  onChange={handle} placeholder="XXXX XXXX XXXX" half />
          <Field label="IFSC Code"      name="ifscCode"   value={form.ifscCode}   onChange={handle} placeholder="SBIN0001234" half />
          <Field label="Branch"         name="bankBranch" value={form.bankBranch} onChange={handle} placeholder="Branch Name" half />
        </div>
      </Section>

      {/* ── Print Preview ── */}
      <Section title="Print Header Preview" icon="pi-eye" color="#7c3aed">
        <div style={{ background: form.printHeaderColor || "#1e293b", borderRadius: 8, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {form.showLogoInPrint && form.logo && (
              <img src={form.logo} alt="Logo" style={{ height: 50, objectFit: "contain", borderRadius: 4, background: "#fff", padding: 4 }} />
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{form.hospitalName || "Hospital Name"}</div>
              {form.showTaglineInPrint && form.tagline && (
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>{form.tagline}</div>
              )}
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                {[form.city, form.state].filter(Boolean).join(", ")}
                {form.phone1 && ` · 📞 ${form.phone1}`}
                {form.email && ` · ✉ ${form.email}`}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: form.printAccentColor || "#60a5fa", fontWeight: 700, fontSize: 16 }}>PATIENT BILL</div>
            {form.nabh && <span style={{ background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>NABH</span>}
            {form.nabl && <span style={{ background: "#60a5fa22", color: "#60a5fa", border: "1px solid #60a5fa44", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, marginLeft: 4 }}>NABL</span>}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 10, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, borderLeft: "3px solid #e2e8f0" }}>
          <strong>Terms (preview):</strong> {form.termsLine1}
        </div>
      </Section>

      {/* ── Save Button (bottom) ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, paddingBottom: 40 }}>
        <button onClick={save} disabled={saving} style={saving ? { ...LS.saveBtn, opacity: .7 } : LS.saveBtn}>
          {saving ? "⏳ Saving…" : saved ? "✅ Saved!" : "💾 Save All Settings"}
        </button>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */
const LS = {
  page:        { maxWidth: 960, margin: "0 auto", padding: "4px 0 40px", fontFamily: "'Segoe UI', Arial, sans-serif" },
  pageHeader:  { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  pageTitle:   { fontSize: 22, fontWeight: 800, color: "#1e293b", margin: 0 },
  pageSubtitle:{ fontSize: 13, color: "#64748b", marginTop: 4 },
  successBanner:{ background: "#dcfce7", color: "#15803d", border: "1px solid #86efac", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontWeight: 600, fontSize: 13 },
  card:        { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.06)" },
  cardHeader:  { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  cardBody:    { padding: "20px 24px" },
  grid:        { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" },
  label:       { fontSize: 12, fontWeight: 600, color: "#374151", letterSpacing: ".3px" },
  input:       { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, color: "#1e293b", outline: "none", boxSizing: "border-box", background: "#fff", transition: "border .15s" },
  saveBtn:     { background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px #2563eb44" },
  outlineBtn:  { background: "#fff", color: "#2563eb", border: "1.5px solid #2563eb", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, textAlign: "center" },
  dangerBtn:   { background: "#fff", color: "#dc2626", border: "1.5px solid #dc2626", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
};
