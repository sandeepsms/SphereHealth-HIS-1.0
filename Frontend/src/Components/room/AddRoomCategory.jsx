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
import { BmStatStrip, BmCard } from "../bed/BedPrimitives";
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

      {/* Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "15px",
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
          <i
            className="pi pi-search"
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "#6c757d",
              zIndex: 1,
            }}
          />
          <InputText
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, code, or room type..."
            style={{ width: "100%", paddingLeft: "40px" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              fontSize: "14px",
              color: "#495057",
            }}
          >
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Show Deleted
          </label>

          <span style={{ color: "#6c757d", fontSize: "14px" }}>
            Showing {currentItems.length} of {filteredList.length} categories
          </span>
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ backgroundColor: "#17a2b8", color: "white" }}>
            <tr>
              {[
                "ID",
                "Category Name",
                "Code",
                "Room Type",
                "Description",
                "Status",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "15px",
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: "14px",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan="7"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#6c757d",
                  }}
                >
                  <i
                    className="pi pi-spin pi-spinner"
                    style={{ fontSize: "2rem" }}
                  />
                  <div style={{ marginTop: "10px" }}>Loading categories...</div>
                </td>
              </tr>
            ) : currentItems.length > 0 ? (
              currentItems.map((cat, index) => (
                <tr
                  key={cat._id}
                  style={{
                    borderBottom: "1px solid #e9ecef",
                    transition: "background-color 0.2s",
                    opacity: cat.isActive === false ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#f8f9fa")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    CAT-{1000 + indexOfFirstItem + index + 1}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#212529",
                    }}
                  >
                    {cat.categoryName}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    <span
                      style={{
                        backgroundColor: "#17a2b8",
                        color: "white",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {cat.categoryCode}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "13px",
                      color: "#495057",
                    }}
                  >
                    {cat.roomType}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "13px",
                      color: "#6c757d",
                      maxWidth: "200px",
                    }}
                  >
                    {cat.description
                      ? cat.description.substring(0, 50) +
                        (cat.description.length > 50 ? "..." : "")
                      : "—"}
                  </td>
                  <td style={{ padding: "12px 15px" }}>
                    <span
                      style={{
                        backgroundColor: cat.isActive ? "#d4edda" : "#f8d7da",
                        color: cat.isActive ? "#155724" : "#721c24",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {cat.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 15px" }}>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <Button
                        icon="pi pi-eye"
                        className="p-button-rounded p-button-info p-button-text"
                        onClick={() => setViewingCategory(cat)}
                        tooltip="View"
                        tooltipOptions={{ position: "top" }}
                      />
                      <Button
                        icon="pi pi-pencil"
                        className="p-button-rounded p-button-warning p-button-text"
                        onClick={() => handleEdit(cat)}
                        tooltip="Edit"
                        tooltipOptions={{ position: "top" }}
                        disabled={cat.isActive === false}
                      />
                      <Button
                        icon={
                          cat.isActive === false
                            ? "pi pi-replay"
                            : "pi pi-trash"
                        }
                        className={`p-button-rounded p-button-text ${cat.isActive === false ? "p-button-success" : "p-button-danger"}`}
                        onClick={() => confirmDelete(cat)}
                        tooltip={cat.isActive === false ? "Restore" : "Delete"}
                        tooltipOptions={{ position: "top" }}
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="7"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#6c757d",
                    fontSize: "16px",
                  }}
                >
                  No categories found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "20px",
              gap: "8px",
              borderTop: "1px solid #e9ecef",
            }}
          >
            <Button
              icon="pi pi-angle-double-left"
              className="p-button-outlined"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              style={{ minWidth: "40px", height: "40px" }}
            />
            <Button
              icon="pi pi-angle-left"
              className="p-button-outlined"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              style={{ minWidth: "40px", height: "40px" }}
            />

            {[...Array(totalPages)].map((_, i) => {
              const page = i + 1;
              if (
                page === 1 ||
                page === totalPages ||
                (page >= currentPage - 1 && page <= currentPage + 1)
              ) {
                return (
                  <Button
                    key={page}
                    label={String(page)}
                    className={currentPage === page ? "" : "p-button-outlined"}
                    onClick={() => setCurrentPage(page)}
                    style={{
                      minWidth: "40px",
                      height: "40px",
                      backgroundColor:
                        currentPage === page ? "#17a2b8" : "transparent",
                      color: currentPage === page ? "white" : "#495057",
                      borderColor: currentPage === page ? "#17a2b8" : "#dee2e6",
                    }}
                  />
                );
              } else if (page === currentPage - 2 || page === currentPage + 2) {
                return (
                  <span
                    key={page}
                    style={{
                      padding: "8px 5px",
                      color: "#6c757d",
                      fontWeight: 600,
                    }}
                  >
                    ...
                  </span>
                );
              }
              return null;
            })}

            <Button
              icon="pi pi-angle-right"
              className="p-button-outlined"
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
              style={{ minWidth: "40px", height: "40px" }}
            />
            <Button
              icon="pi pi-angle-double-right"
              className="p-button-outlined"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              style={{ minWidth: "40px", height: "40px" }}
            />
          </div>
        )}
      </div>

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
