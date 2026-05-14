/**
 * DoctorListPage.jsx — admin page for hospital doctors / consultants.
 *
 * Redesigned to the latest theme: teal hero band, KPI strip, primary
 * card with search + add button + table. Edit/Add flow continues to
 * use the existing DoctorFormPage at /doctors/new and /doctors/:id/edit.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { doctorService } from "../../Services/doctors/doctorService";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, RowAction, Badge,
  SearchInput, PrimaryButton, C,
} from "../../Components/admin-theme";

const fullNameOf = (d) => `${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim() || "—";

const DoctorListPage = () => {
  const navigate = useNavigate();
  const [rows, setRows]    = useState([]);
  const [q, setQ]          = useState("");
  const [loading, setLoad] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      setLoad(true);
      const data = await doctorService.getAllDoctors();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { toast.error("Failed to load doctors"); }
    finally { setLoad(false); }
  };

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return rows.filter(d =>
      rx.test(d.doctorId || "")
      || rx.test(fullNameOf(d))
      || rx.test(d.department?.departmentName || "")
      || rx.test(d.professional?.specialization || "")
      || rx.test(d.contact?.mobileNumber || "")
      || rx.test(d.contact?.email || "")
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    const active = rows.filter(d => d.isActive).length;
    const departments = new Set(rows.map(d => d.department?.departmentName).filter(Boolean));
    const specs = new Set(rows.map(d => d.professional?.specialization).filter(Boolean));
    const seniorCount = rows.filter(d => (d.professional?.experience || 0) >= 10).length;
    return { total: rows.length, active, departments: departments.size, specs: specs.size, senior: seniorCount };
  }, [rows]);

  const remove = (id, name) => {
    if (!window.confirm(`Delete doctor ${name || ""}? This cannot be undone.`)) return;
    doctorService.deleteDoctor(id)
      .then(() => { toast.success("Doctor deleted"); load(); })
      .catch(() => toast.error("Failed to delete doctor"));
  };

  return (
    <AdminPage>
      <Hero icon="pi-user" color="teal"
        title="Doctor Management"
        subtitle="Consultants, registered doctors, specialisations, department mapping" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total Doctors"   value={kpis.total}       color={C.teal}   icon="pi-user" />
        <KPI label="Active"          value={kpis.active}      color={C.green}  icon="pi-check-circle" />
        <KPI label="Departments"     value={kpis.departments} color={C.blue}   icon="pi-building" />
        <KPI label="Specialisations" value={kpis.specs}       color={C.purple} icon="pi-tag" />
        <KPI label="Senior (≥10 yr)" value={kpis.senior}      color={C.amber}  icon="pi-star" />
      </div>

      <Card title="All Doctors" color={C.teal} icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SearchInput value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search id / name / department / specialisation…" width={300} />
            <PrimaryButton icon="pi-plus" label="Add Doctor" color={C.teal}
              onClick={() => navigate("/doctors/new")} />
          </div>
        }
        padding={0}>
        <Table cols={["Doctor ID", "Name", "Contact", "Department", "Specialisation", "Experience", "Status", "Action"]}>
          {loading
            ? <EmptyRow span={8} text="Loading…" />
            : filtered.length === 0
              ? <EmptyRow span={8} text={q ? `No doctors match "${q}"` : "No doctors yet — click Add Doctor to enroll one."} />
              : filtered.map((d, i) => {
                const name = fullNameOf(d);
                const initials = name.split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase() || "DR";
                return (
                  <tr key={d._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                    <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontWeight: 700 }}>{d.doctorId || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.tealL, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0, border: `1.5px solid ${C.teal}30` }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{name}</div>
                          {d.professional?.qualification && (
                            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{d.professional.qualification}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11 }}>{d.contact?.mobileNumber || "—"}</div>
                      {d.contact?.email && (
                        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{d.contact.email}</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", color: C.muted }}>{d.department?.departmentName || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{d.professional?.specialization || "—"}</td>
                    <td style={{ padding: "9px 12px", fontWeight: 700 }}>{d.professional?.experience || 0} yr</td>
                    <td style={{ padding: "9px 12px" }}>
                      <Badge value={d.isActive ? "Active" : "Inactive"} palette={d.isActive ? "active" : "inactive"} />
                    </td>
                    <td style={{ padding: "7px 12px" }}>
                      <RowAction icon="pi-pencil" label="Edit"   color={C.blue} onClick={() => navigate(`/doctors/${d._id}/edit`)} />
                      <RowAction icon="pi-trash"  label="Delete" color={C.red}  onClick={() => remove(d._id, name)} />
                    </td>
                  </tr>
                );
              })}
        </Table>
      </Card>
    </AdminPage>
  );
};

export default DoctorListPage;
