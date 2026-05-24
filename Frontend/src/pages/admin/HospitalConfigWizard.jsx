/**
 * HospitalConfigWizard.jsx — Single admin page where the hospital admin enters
 * / edits every hospital-specific config that the HIS prints, bills, and signs
 * with. Replaces the ad-hoc "edit settings in DB" approach.
 *
 * Seven tabs, one Save button at the bottom that PUTs the whole settings
 * object to /api/hospital-settings. The page is a thin wrapper around the
 * existing HospitalSettings singleton schema — every field round-trips
 * naturally because the schema is loose-by-design (every property optional
 * with a safe default).
 *
 *   1. Hospital Details   — name / address / contact / reg / established
 *   2. Branding           — logo / letterhead banner / primary+accent colour
 *   3. Tax & GST          — GSTIN / PAN / HSN-SAC / GST state
 *   4. Bank Details       — for receipt footer
 *   5. Print Footer Terms — termsLine1/2/3 + footer note
 *   6. NABH               — accreditation cert + validity
 *   7. Operations         — OPD hours + 24×7 emergency
 *
 * Shares /api/hospital-settings with the older HospitalSettingsPage (which
 * stays for deep multi-row editing like bank-account arrays, accreditation
 * lists, etc.). This wizard is the canonical entry-point for admins who
 * want a single guided form.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import { clearHospitalSettingsCache } from "../../Components/print/useHospitalSettings";
import { API_BASE_URL as API_URL } from "../../config/api";
import "./HospitalConfigWizard.css";

/* Cross-tab + cross-cache broadcast helper.
   - Drops the print module-cache locally so this tab's PrintShell-routed
     documents re-fetch on next open.
   - Posts on a BroadcastChannel so OTHER same-origin tabs (e.g. a nurse's
     screen with a patient loaded) also clear and refetch.
   - Writes a storage tickler so browsers without BroadcastChannel
     (iOS Safari) still propagate via the `storage` event.
   Wrapped in try/catch — if any API is missing we silently no-op rather
   than blocking the save. */
const broadcastHospitalSettingsInvalidated = () => {
  try { clearHospitalSettingsCache(); } catch { /* no-op */ }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel("his-hospital-settings");
      bc.postMessage({ type: "invalidated", at: Date.now() });
      bc.close();
    }
  } catch { /* older browsers — no-op */ }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("his-settings-version", String(Date.now()));
    }
  } catch { /* private mode / disabled storage — no-op */ }
};

const TABS = [
  { key: "details",   label: "Hospital Details",  icon: "pi-id-card"          },
  { key: "branding",  label: "Branding",          icon: "pi-image"            },
  { key: "tax",       label: "Tax & GST",         icon: "pi-receipt"          },
  { key: "bank",      label: "Bank Details",      icon: "pi-building-columns" },
  { key: "footer",    label: "Print Footer",      icon: "pi-print"            },
  { key: "nabh",      label: "NABH",              icon: "pi-verified"         },
  { key: "ops",       label: "Operations",        icon: "pi-clock"            },
];

/* Strip Mongo-volatile fields so the dirty-check doesn't trip on
   updatedAt / __v changes coming back from the server. */
const stripVolatile = (o) => {
  const c = { ...(o || {}) };
  delete c._id; delete c.__v; delete c.createdAt; delete c.updatedAt;
  return c;
};

export default function HospitalConfigWizard() {
  const { settings: ctx, reload } = useHospitalSettings();
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState({});
  const [orig, setOrig] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...ctx });
    setOrig({ ...ctx });
  }, [ctx]);

  const dirty = useMemo(
    () => JSON.stringify(stripVolatile(form)) !== JSON.stringify(stripVolatile(orig)),
    [form, orig],
  );

  const upd = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e?.target?.type === "checkbox" ? e.target.checked : (e?.target?.value ?? e),
    }));
  const updRaw = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const token = sessionStorage.getItem("his_token");
      const res = await fetch(`${API_URL}/hospital-settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        // Drop print module-cache + broadcast to other tabs BEFORE the toast,
        // so the moment the admin sees "saved" every consumer is already
        // refetching fresh values (logo / name / GSTIN / etc.).
        broadcastHospitalSettingsInvalidated();
        toast.success("Hospital configuration saved — every print and document now uses these values.");
        setOrig({ ...form });
        reload();
      } else {
        toast.error("Save failed: " + (json.message || "unknown error"));
      }
    } catch (e) {
      toast.error("Network error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hcw-shell">
      {/* ── Hero / save bar ── */}
      <header className="hcw-hero">
        <div className="hcw-hero__left">
          <i className="pi pi-cog hcw-hero__icon" />
          <div>
            <h1 className="hcw-hero__title">Hospital Configuration</h1>
            <p className="hcw-hero__subtitle">
              One-stop wizard for every hospital-specific value the HIS prints, bills, and signs.
            </p>
          </div>
        </div>
        <div className="hcw-hero__right">
          {dirty && <span className="hcw-pill hcw-pill--warn">Unsaved changes</span>}
          <button className="hcw-save" onClick={save} disabled={!dirty || saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : (dirty ? "pi-save" : "pi-check")}`} />
            {saving ? "Saving…" : dirty ? "Save all" : "All saved"}
          </button>
        </div>
      </header>

      {/* ── Tab strip ── */}
      <nav className="hcw-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            className={`hcw-tab ${tab === t.key ? "hcw-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span className="hcw-tab__index">{i + 1}</span>
            <i className={`pi ${t.icon}`} />
            <span className="hcw-tab__label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Tab body ── */}
      <main className="hcw-body">
        {tab === "details"  && <DetailsTab  form={form} upd={upd} />}
        {tab === "branding" && <BrandingTab form={form} upd={upd} updRaw={updRaw} />}
        {tab === "tax"      && <TaxTab      form={form} upd={upd} />}
        {tab === "bank"     && <BankTab     form={form} upd={upd} />}
        {tab === "footer"   && <FooterTab   form={form} upd={upd} />}
        {tab === "nabh"     && <NabhTab     form={form} upd={upd} />}
        {tab === "ops"      && <OpsTab      form={form} upd={upd} />}
      </main>

      {/* ── Bottom save bar — single button per requirement ── */}
      <footer className="hcw-footer">
        <button className="hcw-save hcw-save--lg" onClick={save} disabled={!dirty || saving}>
          <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-save"}`} />
          {saving ? "Saving…" : "Save Hospital Configuration"}
        </button>
        <span className="hcw-footer__hint">
          PUTs the entire settings object to /api/hospital-settings
        </span>
      </footer>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Reusable input row
═══════════════════════════════════════════════════════════════════ */
function Row({ label, hint, required, children, span = 1 }) {
  return (
    <label className={`hcw-row hcw-row--span-${span}`}>
      <span className="hcw-row__label">
        {label}
        {required && <em className="hcw-row__req"> *</em>}
      </span>
      {children}
      {hint && <small className="hcw-row__hint">{hint}</small>}
    </label>
  );
}

function Section({ title, icon, children, color = "blue" }) {
  return (
    <section className={`hcw-section hcw-section--${color}`}>
      <header className="hcw-section__head">
        <i className={`pi ${icon}`} />
        <h2>{title}</h2>
      </header>
      <div className="hcw-grid">{children}</div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 1 — Hospital Details
═══════════════════════════════════════════════════════════════════ */
function DetailsTab({ form, upd }) {
  return (
    <>
      <Section title="Identity" icon="pi-id-card" color="blue">
        <Row label="Hospital name" required>
          <input className="hcw-input" value={form.hospitalName || ""} onChange={upd("hospitalName")} placeholder="e.g. Apollo Hospital" />
        </Row>
        <Row label="Tagline (under name)">
          <input className="hcw-input" value={form.tagline || ""} onChange={upd("tagline")} placeholder="NABH Accredited Multi-Specialty Hospital" />
        </Row>
        <Row label="Established year">
          <input className="hcw-input" type="number" min={1850} max={new Date().getFullYear()} value={form.establishedYear || ""} onChange={upd("establishedYear")} placeholder="1998" />
        </Row>
        <Row label="Hospital registration #" hint="State health-department registration">
          <input className="hcw-input" value={form.registrationNo || ""} onChange={upd("registrationNo")} placeholder="HR/HOSP/2003/0421" />
        </Row>
      </Section>

      <Section title="Address" icon="pi-map-marker" color="purple">
        <Row label="Street / Line 1" span={2}>
          <input className="hcw-input" value={form.addressLine1 || ""} onChange={upd("addressLine1")} placeholder="Plot 14, Sector 7" />
        </Row>
        <Row label="Line 2" span={2}>
          <input className="hcw-input" value={form.addressLine2 || ""} onChange={upd("addressLine2")} placeholder="Near Civil Hospital" />
        </Row>
        <Row label="City">
          <input className="hcw-input" value={form.city || ""} onChange={upd("city")} placeholder="Sonipat" />
        </Row>
        <Row label="State">
          <input className="hcw-input" value={form.state || ""} onChange={upd("state")} placeholder="Haryana" />
        </Row>
        <Row label="PIN code">
          <input className="hcw-input" value={form.pincode || ""} onChange={upd("pincode")} placeholder="131001" />
        </Row>
        <Row label="Country">
          <input className="hcw-input" value={form.country || ""} onChange={upd("country")} placeholder="India" />
        </Row>
      </Section>

      <Section title="Contact" icon="pi-phone" color="green">
        <Row label="Primary phone" required>
          <input className="hcw-input" value={form.phone1 || ""} onChange={upd("phone1")} placeholder="+91 130 244 0000" />
        </Row>
        <Row label="Secondary phone">
          <input className="hcw-input" value={form.phone2 || ""} onChange={upd("phone2")} placeholder="" />
        </Row>
        <Row label="Email" required>
          <input className="hcw-input" type="email" value={form.email || ""} onChange={upd("email")} placeholder="info@spherehealth.com" />
        </Row>
        <Row label="Website">
          <input className="hcw-input" value={form.website || ""} onChange={upd("website")} placeholder="https://spherehealth.com" />
        </Row>
      </Section>

      <Section title="Hospital Admin Contact" icon="pi-user" color="orange">
        <Row label="Admin name" hint="Escalation contact for the HIS — not printed">
          <input className="hcw-input" value={form.adminName || ""} onChange={upd("adminName")} placeholder="Dr. Sandeep" />
        </Row>
        <Row label="Admin phone">
          <input className="hcw-input" value={form.adminPhone || ""} onChange={upd("adminPhone")} placeholder="+91 99999 11111" />
        </Row>
        <Row label="Admin email" span={2}>
          <input className="hcw-input" type="email" value={form.adminEmail || ""} onChange={upd("adminEmail")} placeholder="admin@spherehealth.com" />
        </Row>
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 2 — Branding
═══════════════════════════════════════════════════════════════════ */
function BrandingTab({ form, upd, updRaw }) {
  const readFileAsDataURL = (file, onLoaded) => {
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error("Image too large — keep under 500 KB.");
      return;
    }
    const r = new FileReader();
    r.onload = (ev) => onLoaded(ev.target.result);
    r.readAsDataURL(file);
  };

  return (
    <>
      <Section title="Logos & Letterhead" icon="pi-image" color="purple">
        <Row label="Primary logo (header)" hint="PNG / JPG · ~300×150 px · ≤ 500 KB">
          <div className="hcw-uploader">
            {form.logo && <img src={form.logo} alt="logo" className="hcw-uploader__preview" />}
            <input type="file" accept="image/*" onChange={(e) => readFileAsDataURL(e.target.files?.[0], updRaw("logo"))} />
            {form.logo && (
              <button type="button" className="hcw-btn-link" onClick={() => updRaw("logo")("")}>
                Remove
              </button>
            )}
          </div>
        </Row>
        <Row label="Letterhead banner" hint="Wide strip · ~1500×200 px">
          <div className="hcw-uploader">
            {form.letterheadBanner && <img src={form.letterheadBanner} alt="banner" className="hcw-uploader__preview hcw-uploader__preview--wide" />}
            <input type="file" accept="image/*" onChange={(e) => readFileAsDataURL(e.target.files?.[0], updRaw("letterheadBanner"))} />
            {form.letterheadBanner && (
              <button type="button" className="hcw-btn-link" onClick={() => updRaw("letterheadBanner")("")}>
                Remove
              </button>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Colours" icon="pi-palette" color="orange">
        <Row label="Primary colour (header background)">
          <div className="hcw-colorrow">
            <input type="color" className="hcw-color" value={form.printHeaderColor || "#1e293b"} onChange={upd("printHeaderColor")} />
            <input className="hcw-input hcw-input--mono" value={form.printHeaderColor || ""} onChange={upd("printHeaderColor")} placeholder="#1e293b" />
          </div>
        </Row>
        <Row label="Accent colour (rules, badges)">
          <div className="hcw-colorrow">
            <input type="color" className="hcw-color" value={form.printAccentColor || "#1d4ed8"} onChange={upd("printAccentColor")} />
            <input className="hcw-input hcw-input--mono" value={form.printAccentColor || ""} onChange={upd("printAccentColor")} placeholder="#1d4ed8" />
          </div>
        </Row>
      </Section>

      <Section title="Live preview" icon="pi-eye" color="blue">
        <div className="hcw-preview" style={{ "--hcw-pv-bg": form.printHeaderColor || "#1e293b", "--hcw-pv-accent": form.printAccentColor || "#1d4ed8" }}>
          <div className="hcw-preview__head">
            {form.logo
              ? <img src={form.logo} alt="logo" className="hcw-preview__logo" />
              : <div className="hcw-preview__logo hcw-preview__logo--placeholder">LOGO</div>}
            <div>
              <div className="hcw-preview__name">{form.hospitalName || "Hospital Name"}</div>
              <div className="hcw-preview__tag">{form.tagline || "Tagline"}</div>
              <div className="hcw-preview__addr">
                {[form.addressLine1, form.city, form.state].filter(Boolean).join(" · ") || "Address line"}
              </div>
            </div>
          </div>
          <div className="hcw-preview__rule" />
          <div className="hcw-preview__sample">
            Sample document body — heading, paragraph, signature block. The accent rule above uses the accent colour.
          </div>
        </div>
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 3 — Tax & GST
═══════════════════════════════════════════════════════════════════ */
function TaxTab({ form, upd }) {
  return (
    <>
      <Section title="GST Registration" icon="pi-receipt" color="purple">
        <Row label="GSTIN" hint="15-character GST identification number">
          <input className="hcw-input hcw-input--mono" value={form.gstin || ""} onChange={upd("gstin")} placeholder="06AAACS1234A1Z5" maxLength={15} />
        </Row>
        <Row label="GST registration state" hint="Decides intra-vs-inter-state on every bill">
          <input className="hcw-input" value={form.gstRegState || ""} onChange={upd("gstRegState")} placeholder="Haryana" />
        </Row>
        <Row label="PAN">
          <input className="hcw-input hcw-input--mono" value={form.panNumber || ""} onChange={upd("panNumber")} placeholder="AAACS1234A" maxLength={10} />
        </Row>
        <Row label="TAN (TDS account)">
          <input className="hcw-input hcw-input--mono" value={form.tanNumber || ""} onChange={upd("tanNumber")} placeholder="DELS12345E" maxLength={10} />
        </Row>
      </Section>

      <Section title="HSN / SAC" icon="pi-tag" color="green">
        <Row label="Default HSN/SAC" hint="SAC 9993 = healthcare services. Applied when a charge row's own HSN/SAC is blank.">
          <input className="hcw-input hcw-input--mono" value={form.defaultHsnSac || ""} onChange={upd("defaultHsnSac")} placeholder="9993" />
        </Row>
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 4 — Bank Details (for receipt footer)
═══════════════════════════════════════════════════════════════════ */
function BankTab({ form, upd }) {
  return (
    <>
      <Section title="Primary Bank Account" icon="pi-building-columns" color="blue">
        <Row label="Bank name">
          <input className="hcw-input" value={form.bankName || ""} onChange={upd("bankName")} placeholder="HDFC Bank" />
        </Row>
        <Row label="Account holder">
          <input className="hcw-input" value={form.accountHolderName || ""} onChange={upd("accountHolderName")} placeholder="SphereHealth Hospital Pvt. Ltd." />
        </Row>
        <Row label="Account number">
          <input className="hcw-input hcw-input--mono" value={form.accountNo || ""} onChange={upd("accountNo")} placeholder="50100123456789" />
        </Row>
        <Row label="IFSC code">
          <input className="hcw-input hcw-input--mono" value={form.ifscCode || ""} onChange={upd("ifscCode")} placeholder="HDFC0000123" maxLength={11} />
        </Row>
        <Row label="Branch name" span={2}>
          <input className="hcw-input" value={form.bankBranch || ""} onChange={upd("bankBranch")} placeholder="Sector 14, Sonipat" />
        </Row>
      </Section>

      <Section title="UPI / Digital" icon="pi-mobile" color="orange">
        <Row label="UPI ID" hint="Shown on receipts & QR codes">
          <input className="hcw-input hcw-input--mono" value={form.upiId || ""} onChange={upd("upiId")} placeholder="yourhospital@bank" />
        </Row>
        <Row label="Cheque payable to">
          <input className="hcw-input" value={form.chequePayableTo || ""} onChange={upd("chequePayableTo")} placeholder="Hospital name" />
        </Row>
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 5 — Print Footer Terms
═══════════════════════════════════════════════════════════════════ */
function FooterTab({ form, upd }) {
  const len = (s) => String(s || "").length;
  return (
    <>
      <Section title="Footer text" icon="pi-comment" color="blue">
        <Row label="Footer note" span={2} hint="Single greeting line below the totals">
          <input className="hcw-input" value={form.billFooterNote || ""} onChange={upd("billFooterNote")} placeholder="Thank you for choosing our hospital." maxLength={200} />
        </Row>
      </Section>

      <Section title="Terms & Conditions" icon="pi-list" color="purple">
        <Row label={`Term 1 (${len(form.termsLine1)}/200)`} span={2}>
          <textarea className="hcw-textarea" rows={2} maxLength={200} value={form.termsLine1 || ""} onChange={upd("termsLine1")} placeholder="This is a computer-generated bill and does not require a physical signature." />
        </Row>
        <Row label={`Term 2 (${len(form.termsLine2)}/200)`} span={2}>
          <textarea className="hcw-textarea" rows={2} maxLength={200} value={form.termsLine2 || ""} onChange={upd("termsLine2")} placeholder="All charges are as per the approved hospital tariff. Payments once made are non-refundable." />
        </Row>
        <Row label={`Term 3 (${len(form.termsLine3)}/200)`} span={2}>
          <textarea className="hcw-textarea" rows={2} maxLength={200} value={form.termsLine3 || ""} onChange={upd("termsLine3")} placeholder="For queries, contact the Billing Department." />
        </Row>
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 6 — NABH accreditation
═══════════════════════════════════════════════════════════════════ */
function NabhTab({ form, upd }) {
  // Date input wants YYYY-MM-DD. The schema persists Date; we format both ways.
  const isoDate = form.nabhValidUntil ? String(form.nabhValidUntil).slice(0, 10) : "";
  const expiresSoon = (() => {
    if (!isoDate) return false;
    const days = Math.floor((new Date(isoDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 90;
  })();
  const expired = (() => {
    if (!isoDate) return false;
    return new Date(isoDate) < new Date();
  })();

  return (
    <>
      <Section title="NABH Accreditation" icon="pi-verified" color="green">
        <Row label="Certificate number" hint="Issued by Quality Council of India">
          <input className="hcw-input hcw-input--mono" value={form.nabhCertNumber || ""} onChange={upd("nabhCertNumber")} placeholder="NABH-H-2-2021-0023" />
        </Row>
        <Row label="Valid until">
          <input className="hcw-input" type="date" value={isoDate} onChange={upd("nabhValidUntil")} />
        </Row>
        {(expired || expiresSoon) && (
          <div className={`hcw-banner hcw-banner--${expired ? "danger" : "warn"} hcw-row--span-2`}>
            <i className={`pi ${expired ? "pi-times-circle" : "pi-exclamation-triangle"}`} />
            {expired
              ? "NABH certificate has expired — renewal overdue. Patients see 'NABH Accredited' on prints but the body certificate has lapsed."
              : "NABH certificate expires within 90 days. Begin renewal paperwork."}
          </div>
        )}
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TAB 7 — Operations
═══════════════════════════════════════════════════════════════════ */
function OpsTab({ form, upd }) {
  return (
    <>
      <Section title="OPD Operating Hours" icon="pi-clock" color="blue">
        <Row label="OPD start time">
          <input className="hcw-input" type="time" value={form.opdStartTime || "09:00"} onChange={upd("opdStartTime")} />
        </Row>
        <Row label="OPD end time">
          <input className="hcw-input" type="time" value={form.opdEndTime || "21:00"} onChange={upd("opdEndTime")} />
        </Row>
        <Row label="Display string on prints" span={2} hint="Free-text shown in print headers — generated from the times above unless overridden">
          <input className="hcw-input" value={form.operatingHours || ""} onChange={upd("operatingHours")} placeholder="24×7 emergency · OPD 9 AM – 9 PM" />
        </Row>
      </Section>

      <Section title="Emergency" icon="pi-bolt" color="orange">
        <Row label="" span={2}>
          <label className="hcw-toggle">
            <input type="checkbox" checked={form.emergency24x7 !== false} onChange={upd("emergency24x7")} />
            <span className="hcw-toggle__label">Emergency open 24×7 (badge shown on every patient document)</span>
          </label>
        </Row>
      </Section>
    </>
  );
}
