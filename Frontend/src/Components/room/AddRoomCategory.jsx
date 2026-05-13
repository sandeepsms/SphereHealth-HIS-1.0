import React, { useState, useEffect } from "react";
import { Formik, Form } from "formik";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import * as yup from "yup";
import { toast } from "react-toastify";

import { roomCategoryService } from "../../Services/roomCategoryService";
import BedSectionHeader from "../bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmFilter, BmEmpty, BmPill, BmIconBtn,
  BmAvatar, BmCellStack, BmPrice, BmClass, BmChip,
} from "../bed/BedPrimitives";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../styles/AddTpa.css";

// ── Room Type Options (from backend model enum) ──────────────────────────────
const ROOM_TYPE_OPTIONS = [
  { label: "General Ward", value: "General Ward" },
  { label: "ICU", value: "ICU" },
  { label: "NICU", value: "NICU" },
  { label: "CCU", value: "CCU" },
  { label: "HDU", value: "HDU" },
  { label: "Private Room", value: "Private Room" },
  { label: "Semi-Private", value: "Semi-Private" },
  { label: "Deluxe", value: "Deluxe" },
  { label: "Suite", value: "Suite" },
  { label: "Emergency", value: "Emergency" },
  { label: "Daycare", value: "Daycare" },
  { label: "Isolation", value: "Isolation" },
  { label: "Maternity", value: "Maternity" },
  { label: "Pediatric", value: "Pediatric" },
  { label: "Operation Theatre", value: "Operation Theatre" },
  { label: "Recovery Room", value: "Recovery Room" },
  { label: "Other", value: "Other" },
];

function AddRoomCategory() {
  const [categoryList, setCategoryList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState(null);
  const [viewingCategory, setViewingCategory] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({
    visible: false,
    category: null,
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);

  const itemsPerPage = 10;

  const validationSchema = yup.object({
    categoryName: yup
      .string()
      .max(50, "Max 50 chars")
      .required("Category name is required"),
    categoryCode: yup
      .string()
      .max(20, "Max 20 chars")
      .required("Category code is required"),
    description: yup.string(),
    roomType: yup.string().required("Room type is required"),
  });

  // ── Fetch all categories ──────────────────────────────────────────────────
  const fetchCategories = async () => {
    setLoading(true);
    try {
      const response = await roomCategoryService.getAllCategories();
      console.log("Fetched categories:", response);
      const filteredData = showDeleted
        ? response || []
        : (response || []).filter((cat) => cat.isActive !== false);
      setCategoryList(filteredData);
      setFilteredList(filteredData);
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error(error?.message || "Error fetching categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [showDeleted]);

  // ── Search filter ─────────────────────────────────────────────────────────
  useEffect(() => {
    const filtered = categoryList.filter(
      (cat) =>
        cat.categoryName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.categoryCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.roomType?.toLowerCase().includes(searchTerm.toLowerCase()),
    );
    setFilteredList(filtered);
    setCurrentPage(1);
  }, [searchTerm, categoryList]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredList.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredList.length / itemsPerPage);

  // ── Submit Handler ────────────────────────────────────────────────────────
  const handleSubmit = async (values, { resetForm }) => {
    try {
      if (editing) {
        console.log("Updating Room Category:", editing._id, values);
        await roomCategoryService.updateCategory(editing._id, values);
        toast.success("Room Category Updated Successfully");
        setEditing(null);
      } else {
        console.log("Creating Room Category:", values);
        await roomCategoryService.createCategory(values);
        toast.success("Room Category Added Successfully");
      }
      resetForm();
      await fetchCategories();
    } catch (error) {
      console.error("Submit error:", error);
      toast.error(
        error?.response?.data?.message || error.message || "Error occurred",
      );
    }
  };

  // ── Edit Handler ──────────────────────────────────────────────────────────
  const handleEdit = (category) => {
    console.log("Editing category:", category);
    setEditing(category);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Delete Handlers ───────────────────────────────────────────────────────
  const confirmDelete = (category) => {
    console.log("Confirm delete category:", category);
    setDeleteDialog({ visible: true, category });
  };

  const handleDelete = async () => {
    if (!deleteDialog.category?._id) {
      toast.error("Invalid category ID");
      return;
    }

    setDeleting(true);
    const categoryId = deleteDialog.category._id;
    const categoryName = deleteDialog.category.categoryName;

    try {
      await roomCategoryService.deleteCategory(categoryId);
      toast.success(`Category "${categoryName}" deleted successfully`);
      setDeleteDialog({ visible: false, category: null });
      await fetchCategories();
    } catch (error) {
      console.error("Delete error:", error);
      toast.error(
        error?.response?.data?.message ||
          error.message ||
          "Failed to delete category",
      );
    } finally {
      setDeleting(false);
    }
  };

  // ── View Modal Component ──────────────────────────────────────────────────
  const ViewModal = ({ category, onClose }) => {
    if (!category) return null;
    return (
      <Dialog
        header="Category Details"
        visible={true}
        style={{ width: "500px" }}
        onHide={onClose}
        modal
      >
        <div style={{ padding: "10px" }}>
          <table style={{ width: "100%" }}>
            <tbody>
              {[
                ["Category Name", category.categoryName],
                ["Category Code", category.categoryCode],
                ["Room Type", category.roomType],
                ["Description", category.description || "N/A"],
                ["Status", category.isActive ? "Active" : "Inactive"],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td
                    style={{
                      fontWeight: 600,
                      color: "#495057",
                      padding: "10px 0",
                      width: "40%",
                    }}
                  >
                    {label}:
                  </td>
                  <td style={{ color: "#212529", padding: "10px 0" }}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    );
  };

  // ── Delete Dialog Footer ──────────────────────────────────────────────────
  const deleteDialogFooter = (
    <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
      <Button
        label="No"
        icon="pi pi-times"
        onClick={() => setDeleteDialog({ visible: false, category: null })}
        className="p-button-text"
        disabled={deleting}
      />
      <Button
        label={deleting ? "Deleting..." : "Yes"}
        icon={deleting ? "pi pi-spin pi-spinner" : "pi pi-check"}
        onClick={handleDelete}
        className="p-button-danger"
        disabled={deleting}
      />
    </div>
  );

  /* Aggregate stats — total / by classification / active */
  const _stats = (() => {
    const list = Array.isArray(categoryList) ? categoryList : [];
    const active = list.filter(c => c.isActive !== false).length;
    const byClass = new Set(list.map(c => c.classification).filter(Boolean));
    const minRate = list.length ? Math.min(...list.map(c => c.defaultPricing?.perBedDailyRate || Infinity).filter(n => Number.isFinite(n))) : 0;
    const maxRate = list.length ? Math.max(...list.map(c => c.defaultPricing?.perBedDailyRate || 0)) : 0;
    return [
      { key: "total",   label: "Categories",   value: list.length, icon: "pi-th-large",     tone: "purple" },
      { key: "active",  label: "Active",       value: active,       icon: "pi-check-circle", tone: "green"  },
      { key: "classes", label: "Tier classes", value: byClass.size, icon: "pi-tags",         tone: "blue"   },
      { key: "rates",   label: "Daily rate range", value: list.length ? `₹${minRate}-${maxRate}` : "—", icon: "pi-dollar", tone: "amber" },
    ];
  })();

  return (
    <div className="bm-page">
      <BedSectionHeader
        title="Room Categories"
        subtitle="Pricing tiers + amenities — Economy, Standard, Premium, Deluxe, VIP"
        icon="pi-th-large"
      />

      <BmStatStrip stats={_stats} />

      {/* Add/Edit Form */}
      <div
        className="bm-card"
        style={{
          padding: "24px 28px",
          marginBottom: 18,
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 800,
            color: "#0f172a",
            marginBottom: "18px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            letterSpacing: ".2px",
          }}
        >
          <i className={`pi ${editing ? "pi-pencil" : "pi-plus-circle"}`} style={{ color: "#db2777" }} />
          {editing ? "Edit Room Category" : "Add New Room Category"}
        </h2>

        <Formik
          initialValues={{
            categoryName: editing?.categoryName || "",
            categoryCode: editing?.categoryCode || "",
            description: editing?.description || "",
            roomType: editing?.roomType || "General Ward",
          }}
          enableReinitialize
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({
            values,
            errors,
            touched,
            handleChange,
            handleBlur,
            resetForm,
            setFieldValue,
          }) => (
            <Form>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: "20px",
                  marginBottom: "25px",
                }}
              >
                {/* Category Name */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Category Name <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="categoryName"
                    value={values.categoryName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter Category Name"
                    className={
                      errors.categoryName && touched.categoryName
                        ? "p-invalid"
                        : ""
                    }
                  />
                  {errors.categoryName && touched.categoryName && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.categoryName}
                    </small>
                  )}
                </div>

                {/* Category Code */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Category Code <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="categoryCode"
                    value={values.categoryCode}
                    onChange={(e) => {
                      e.target.value = e.target.value.toUpperCase();
                      handleChange(e);
                    }}
                    onBlur={handleBlur}
                    placeholder="Enter Category Code"
                    className={
                      errors.categoryCode && touched.categoryCode
                        ? "p-invalid"
                        : ""
                    }
                    style={{ textTransform: "uppercase" }}
                  />
                  {errors.categoryCode && touched.categoryCode && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.categoryCode}
                    </small>
                  )}
                </div>

                {/* Room Type Dropdown — FIXED */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Room Type <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <Dropdown
                    name="roomType"
                    value={values.roomType}
                    options={ROOM_TYPE_OPTIONS}
                    onChange={(e) => setFieldValue("roomType", e.value)}
                    placeholder="Select Room Type"
                    className={
                      errors.roomType && touched.roomType ? "p-invalid" : ""
                    }
                    style={{ width: "100%" }}
                  />
                  {errors.roomType && touched.roomType && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.roomType}
                    </small>
                  )}
                </div>

                {/* Description */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Description
                  </label>
                  <InputTextarea
                    name="description"
                    value={values.description}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter Description (optional)"
                    rows={3}
                    className={
                      errors.description && touched.description
                        ? "p-invalid"
                        : ""
                    }
                  />
                  {errors.description && touched.description && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.description}
                    </small>
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: "flex", gap: "10px" }}>
                <Button
                  type="submit"
                  label={editing ? "Update Room Category" : "Add Room Category"}
                  icon="pi pi-check"
                  className="p-button-success"
                />
                {editing && (
                  <Button
                    type="button"
                    label="Cancel"
                    icon="pi pi-times"
                    className="p-button-secondary"
                    onClick={() => {
                      setEditing(null);
                      resetForm();
                    }}
                  />
                )}
              </div>
            </Form>
          )}
        </Formik>
      </div>

      <BmCard
        title="Configured Categories"
        icon="pi-th-large"
        count={filteredList.length === categoryList.length ? categoryList.length : `${filteredList.length}/${categoryList.length}`}
        action={
          <>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 11, fontWeight: 700, color: "#475569",
              padding: "5px 12px", borderRadius: 999,
              background: showDeleted ? "#fee2e2" : "#f1f5f9",
              border: `1px solid ${showDeleted ? "#fca5a5" : "#e2e8f0"}`,
              cursor: "pointer",
            }}>
              <input type="checkbox" checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
                style={{ cursor: "pointer", accentColor: "#dc2626" }} />
              Show deleted
            </label>
            <BmFilter value={searchTerm} onChange={setSearchTerm} placeholder="Search by name / code / room type…" />
          </>
        }
      >
        {loading ? (
          <BmEmpty icon="pi-spin pi-spinner" title="Loading categories…" />
        ) : currentItems.length === 0 ? (
          categoryList.length === 0 ? (
            <BmEmpty icon="pi-th-large" title="No room categories yet"
              msg="Categories define pricing tiers (Economy → VIP) used by every room."
              ctaLabel="Use the form above" ctaIcon="pi-arrow-up" onCta={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
          ) : (
            <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term." />
          )
        ) : (
          <div style={{ padding: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {currentItems.map((cat, index) => {
              const pricing = cat.defaultPricing || {};
              const amenities = Array.isArray(cat.defaultAmenities) ? cat.defaultAmenities : [];
              const isDeleted = cat.isActive === false;
              return (
                <div key={cat._id} className="bm-grid-card bm-grid-card--pink"
                  style={{
                    opacity: isDeleted ? 0.6 : 1,
                    filter: isDeleted ? "grayscale(.3)" : "none",
                    background: cat.color
                      ? `linear-gradient(135deg, ${cat.color}10, #fff)`
                      : undefined,
                  }}>
                  <div className="bm-grid-card__head">
                    <BmAvatar icon="pi-th-large" tone="pink" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bm-grid-card__title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        {cat.categoryName}
                        <span style={{
                          fontSize: 9.5, fontWeight: 800, padding: "2px 7px", borderRadius: 5,
                          background: "#fce7f3", color: "#9d174d", letterSpacing: ".4px",
                        }}>{cat.categoryCode}</span>
                      </div>
                      <div className="bm-grid-card__sub">
                        ID: CAT-{1000 + indexOfFirstItem + index + 1} · {cat.roomType || "—"}
                      </div>
                    </div>
                  </div>

                  {cat.classification && (
                    <div style={{ margin: "6px 0 8px" }}>
                      <BmClass value={cat.classification} />
                    </div>
                  )}

                  {pricing.perBedDailyRate > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <BmPrice value={pricing.perBedDailyRate} unit="bed/day" />
                      {(pricing.nursingCharges > 0 || pricing.equipmentCharges > 0) && (
                        <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                          {pricing.nursingCharges > 0   && <>+ ₹{pricing.nursingCharges} nursing </>}
                          {pricing.equipmentCharges > 0 && <>+ ₹{pricing.equipmentCharges} equipment </>}
                          {pricing.securityDeposit > 0  && <>· ₹{pricing.securityDeposit} deposit</>}
                        </div>
                      )}
                    </div>
                  )}

                  {(cat.minBeds || cat.maxBeds) && (
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
                      <i className="pi pi-th-large" style={{ marginRight: 4, fontSize: 10 }} />
                      {cat.minBeds || "—"} to {cat.maxBeds || "—"} beds
                    </div>
                  )}

                  {cat.description && (
                    <div style={{ fontSize: 11.5, color: "#475569", marginBottom: 8, lineHeight: 1.45 }}>
                      {cat.description.length > 90 ? cat.description.slice(0, 90) + "…" : cat.description}
                    </div>
                  )}

                  {amenities.length > 0 && (
                    <div className="bm-chip-row" style={{ marginBottom: 8 }}>
                      {amenities.slice(0, 4).map((a, i) => <BmChip key={i} icon="pi-check">{a}</BmChip>)}
                      {amenities.length > 4 && <BmChip>+{amenities.length - 4}</BmChip>}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: "1px dashed #e2e8f0" }}>
                    <BmPill tone={isDeleted ? "danger" : "ok"} icon={isDeleted ? "pi-times" : "pi-check"}>
                      {isDeleted ? "Inactive" : "Active"}
                    </BmPill>
                    <div className="bm-row-actions">
                      <BmIconBtn icon="pi-eye"    variant="info"   title="View"   onClick={() => setViewingCategory(cat)} />
                      <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"   onClick={() => handleEdit(cat)}     disabled={isDeleted} />
                      <BmIconBtn icon={isDeleted ? "pi-replay" : "pi-trash"} variant={isDeleted ? "info" : "danger"}
                        title={isDeleted ? "Restore" : "Delete"} onClick={() => confirmDelete(cat)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: "flex", justifyContent: "center", alignItems: "center",
            padding: 14, gap: 6, borderTop: "1px solid #e2e8f0",
          }}>
            <BmIconBtn icon="pi-angle-double-left" title="First page"
              onClick={() => setCurrentPage(1)} disabled={currentPage === 1} />
            <BmIconBtn icon="pi-angle-left" title="Previous"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} />
            {[...Array(totalPages)].map((_, i) => {
              const page = i + 1;
              if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
                return (
                  <button key={page} onClick={() => setCurrentPage(page)}
                    style={{
                      minWidth: 32, height: 28, borderRadius: 7,
                      border: "1.5px solid " + (currentPage === page ? "#db2777" : "#e2e8f0"),
                      background: currentPage === page ? "#db2777" : "#fff",
                      color: currentPage === page ? "#fff" : "#475569",
                      fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                    }}>{page}</button>
                );
              } else if (page === currentPage - 2 || page === currentPage + 2) {
                return <span key={page} style={{ padding: "0 5px", color: "#94a3b8", fontWeight: 700, fontSize: 11 }}>…</span>;
              }
              return null;
            })}
            <BmIconBtn icon="pi-angle-right" title="Next"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} />
            <BmIconBtn icon="pi-angle-double-right" title="Last page"
              onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} />
          </div>
        )}
      </BmCard>

      {/* Delete Confirmation Dialog */}
      <Dialog
        header="Confirm Delete"
        visible={deleteDialog.visible}
        style={{ width: "400px" }}
        footer={deleteDialogFooter}
        onHide={() => setDeleteDialog({ visible: false, category: null })}
        modal
      >
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <i
            className="pi pi-exclamation-triangle"
            style={{ fontSize: "2rem", color: "#dc3545" }}
          />
          <span>
            Are you sure you want to delete{" "}
            <strong>{deleteDialog.category?.categoryName}</strong>?
          </span>
        </div>
      </Dialog>

      {/* View Modal */}
      {viewingCategory && (
        <ViewModal
          category={viewingCategory}
          onClose={() => setViewingCategory(null)}
        />
      )}
    </div>
  );
}

export default AddRoomCategory;
