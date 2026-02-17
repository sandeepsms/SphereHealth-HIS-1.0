import React, { useState, useEffect } from "react";
import { Formik, Form, FieldArray } from "formik";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import * as yup from "yup";
import { toast } from "react-toastify";
import { tpaService } from "../../Services/tpa/tpaService";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../styles/AddTpa.css";
import { roomCategoryService } from "../../Services/roomCategoryService";

// ── Empty room charge row ────────────────────────────────────────────────────
const emptyRoomCharge = {
  roomCategory: "",
  doctorVisit: 0,
  nursingCharge: 0,
  roomRent: 0,
  rmoCharge: 0,
  daycareCharge: 0,
};

function AddTpa() {
  const [tpaList, setTpaList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingTPA, setEditingTPA] = useState(null);
  const [viewingTPA, setViewingTPA] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({
    visible: false,
    tpa: null,
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedRoomCategory, setRoomcategorydata] = useState([]);

  const itemsPerPage = 10;

  const validationSchema = yup.object({
    tpaName: yup.string().max(30, "Max 30 chars").required("TPA Name required"),
    tpaCode: yup.string().required("TPA Code required"),
    phone: yup
      .string()
      .matches(/^[0-9]{10}$/, "Valid 10 digit number required")
      .required("Phone required"),
    email: yup.string().email("Invalid email"),
    contactPerson: yup.string(),
    address: yup.string(),
  });

  const fetchTPAs = async () => {
    setLoading(true);
    try {
      const response = await tpaService.getAllTPAs();
      console.log("Fetched TPAs:", response.data);
      const filteredData = showDeleted
        ? response.data || []
        : (response.data || []).filter((tpa) => tpa.isActive !== false);
      setTpaList(filteredData);
      setFilteredList(filteredData);
    } catch (error) {
      console.error("Error fetching TPAs:", error);
      toast.error(error?.response?.data?.message || "Error fetching TPAs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTPAs();
    fetchRoomdata();
  }, [showDeleted]);

  const fetchRoomdata = async () => {
    setLoading(true);
    try {
      const response = await roomCategoryService.getAllCategories();
      const options = response.map((item) => ({
        labelcategoryName: `${item.categoryName}`,
        labelroomtype: `${item.roomType}`,
        value: item._id,
        roomType: item.roomType,
        categoryName: item.categoryName,
      }));
      console.log("Room options:", options);
      setRoomcategorydata(options);
    } catch (error) {
      toast.error("Error fetching room data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const filtered = tpaList.filter(
      (tpa) =>
        tpa.tpaName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tpa.tpaCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tpa.phone?.includes(searchTerm) ||
        tpa.email?.toLowerCase().includes(searchTerm.toLowerCase()),
    );
    setFilteredList(filtered);
    setCurrentPage(1);
  }, [searchTerm, tpaList]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredList.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredList.length / itemsPerPage);

  // ── Build initial roomCharges when editing ───────────────────────────────
  const buildInitialRoomCharges = () => {
    if (editingTPA?.roomCharges?.length > 0) {
      return editingTPA.roomCharges.map((rc) => ({
        roomCategory: rc.roomCategory?._id || rc.roomCategory || "",
        doctorVisit: rc.doctorVisit || 0,
        nursingCharge: rc.nursingCharge || 0,
        roomRent: rc.roomRent || 0,
        rmoCharge: rc.rmoCharge || 0,
        daycareCharge: rc.daycareCharge || 0,
      }));
    }
    return [{ ...emptyRoomCharge }];
  };

  const handleSubmit = async (values, { resetForm }) => {
    try {
      // Clean roomCharges — skip rows with no category selected
      const cleanedCharges = values.roomCharges
        .filter((rc) => rc.roomCategory)
        .map((rc) => ({
          roomCategory: rc.roomCategory,
          doctorVisit: Number(rc.doctorVisit) || 0,
          nursingCharge: Number(rc.nursingCharge) || 0,
          roomRent: Number(rc.roomRent) || 0,
          rmoCharge: Number(rc.rmoCharge) || 0,
          daycareCharge: Number(rc.daycareCharge) || 0,
        }));

      const payload = { ...values, roomCharges: cleanedCharges };

      if (editingTPA) {
        console.log("Updating TPA:", editingTPA._id, payload);
        await tpaService.updateTPA(editingTPA._id, payload);
        toast.success("TPA Updated Successfully");
        setEditingTPA(null);
      } else {
        console.log("Creating TPA:", payload);
        await tpaService.createTPA(payload);
        toast.success("TPA Added Successfully");
      }
      resetForm();
      await fetchTPAs();
    } catch (error) {
      console.error("Submit error:", error);
      toast.error(error?.response?.data?.message || "Error occurred");
    }
  };

  const handleEdit = (tpa) => {
    console.log("Editing TPA:", tpa);
    setEditingTPA(tpa);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmDelete = (tpa) => {
    console.log("Confirm delete TPA:", tpa);
    setDeleteDialog({ visible: true, tpa });
  };

  const handleDelete = async () => {
    if (!deleteDialog.tpa || !deleteDialog.tpa._id) {
      toast.error("Invalid TPA ID");
      return;
    }

    setDeleting(true);
    const tpaId = deleteDialog.tpa._id;
    const tpaName = deleteDialog.tpa.tpaName;

    try {
      const response = await tpaService.deleteTPA(tpaId);
      console.log("Delete response:", response);
      toast.success(`TPA "${tpaName}" deleted successfully`);
      setDeleteDialog({ visible: false, tpa: null });
      await fetchTPAs();
    } catch (error) {
      console.error("Delete error details:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Failed to delete TPA";
      toast.error(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  const deleteDialogFooter = (
    <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
      <Button
        label="No"
        icon="pi pi-times"
        onClick={() => setDeleteDialog({ visible: false, tpa: null })}
        className="p-button-text"
        style={{ minWidth: "100px" }}
        disabled={deleting}
      />
      <Button
        label={deleting ? "Deleting..." : "Yes"}
        icon={deleting ? "pi pi-spin pi-spinner" : "pi pi-check"}
        onClick={handleDelete}
        className="p-button-danger"
        style={{ minWidth: "100px" }}
        disabled={deleting}
      />
    </div>
  );

  const ViewModal = ({ tpa, onClose }) => {
    if (!tpa) return null;
    return (
      <Dialog
        header="TPA Details"
        visible={true}
        style={{ width: "500px" }}
        onHide={onClose}
        modal
      >
        <div style={{ padding: "10px" }}>
          <table style={{ width: "100%" }}>
            <tbody>
              {[
                ["TPA Name", tpa.tpaName],
                ["TPA Code", tpa.tpaCode],
                ["Phone", tpa.phone],
                ["Email", tpa.email || "N/A"],
                ["Contact Person", tpa.contactPerson || "N/A"],
                ["Address", tpa.address || "N/A"],
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

  return (
    <div
      style={{
        padding: "20px",
        backgroundColor: "#f5f5f5",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 600,
            color: "#2c3e50",
            margin: 0,
          }}
        >
          TPA Management
        </h1>
      </div>

      {/* Add/Edit Form */}
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          padding: "30px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          marginBottom: "30px",
        }}
      >
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 600,
            color: "#2c3e50",
            marginBottom: "25px",
          }}
        >
          {editingTPA ? "Edit TPA" : "Add New TPA"}
        </h2>

        <Formik
          initialValues={{
            tpaName: editingTPA?.tpaName || "",
            tpaCode: editingTPA?.tpaCode || "",
            phone: editingTPA?.phone || "",
            email: editingTPA?.email || "",
            contactPerson: editingTPA?.contactPerson || "",
            address: editingTPA?.address || "",
            roomCharges: buildInitialRoomCharges(),
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
              {/* ── Basic Info Grid (same as original) ── */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: "20px",
                  marginBottom: "25px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    TPA Name <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="tpaName"
                    value={values.tpaName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter TPA Name"
                    className={
                      errors.tpaName && touched.tpaName ? "p-invalid" : ""
                    }
                  />
                  {errors.tpaName && touched.tpaName && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.tpaName}
                    </small>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    TPA Code <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="tpaCode"
                    value={values.tpaCode}
                    onChange={(e) => {
                      e.target.value = e.target.value.toUpperCase();
                      handleChange(e);
                    }}
                    onBlur={handleBlur}
                    placeholder="Enter TPA Code"
                    className={
                      errors.tpaCode && touched.tpaCode ? "p-invalid" : ""
                    }
                    style={{ textTransform: "uppercase" }}
                  />
                  {errors.tpaCode && touched.tpaCode && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.tpaCode}
                    </small>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Phone Number <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="phone"
                    value={values.phone}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter 10 digit phone"
                    maxLength={10}
                    className={errors.phone && touched.phone ? "p-invalid" : ""}
                  />
                  {errors.phone && touched.phone && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.phone}
                    </small>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Email
                  </label>
                  <InputText
                    name="email"
                    type="email"
                    value={values.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter Email"
                    className={errors.email && touched.email ? "p-invalid" : ""}
                  />
                  {errors.email && touched.email && (
                    <small
                      style={{
                        color: "#dc3545",
                        fontSize: "12px",
                        marginTop: "5px",
                      }}
                    >
                      {errors.email}
                    </small>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Contact Person
                  </label>
                  <InputText
                    name="contactPerson"
                    value={values.contactPerson}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter Contact Person"
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    Address
                  </label>
                  <InputTextarea
                    name="address"
                    value={values.address}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter Address"
                    rows={3}
                  />
                </div>
              </div>

              {/* ── Room Charges Section — FieldArray ── */}
              <FieldArray name="roomCharges">
                {({ push, remove }) => (
                  <div style={{ marginBottom: "25px" }}>
                    {/* Section header with Add button */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "15px",
                      }}
                    >
                      <h3
                        style={{
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "#2c3e50",
                          margin: 0,
                        }}
                      >
                        Room Charges
                      </h3>
                      <Button
                        type="button"
                        label="Add Room Category"
                        icon="pi pi-plus"
                        className="p-button-outlined p-button-sm"
                        style={{ fontSize: "13px" }}
                        onClick={() => push({ ...emptyRoomCharge })}
                      />
                    </div>

                    {/* One card per room category */}
                    {values.roomCharges.map((rc, index) => (
                      <div
                        key={index}
                        style={{
                          border: "1px solid #dee2e6",
                          borderRadius: "6px",
                          padding: "20px",
                          marginBottom: "15px",
                          backgroundColor: "#fafafa",
                          position: "relative",
                        }}
                      >
                        {/* Remove row button */}
                        {values.roomCharges.length > 1 && (
                          <Button
                            type="button"
                            icon="pi pi-times"
                            className="p-button-rounded p-button-danger p-button-text p-button-sm"
                            onClick={() => remove(index)}
                            style={{
                              position: "absolute",
                              top: "10px",
                              right: "10px",
                              width: "28px",
                              height: "28px",
                            }}
                            tooltip="Remove"
                            tooltipOptions={{ position: "top" }}
                          />
                        )}

                        {/* Room Category Dropdown - Full Width */}
                        <div style={{ marginBottom: "20px" }}>
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "14px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              Room Category{" "}
                              <span style={{ color: "#dc3545" }}>*</span>
                            </label>
                            <Dropdown
                              value={rc.roomCategory}
                              options={selectedRoomCategory}
                              optionLabel="labelroomtype"
                              optionValue="value"
                              placeholder="Select Room Category"
                              filter
                              onChange={(e) =>
                                setFieldValue(
                                  `roomCharges[${index}].roomCategory`,
                                  e.value,
                                )
                              }
                              className={
                                touched?.roomCharges?.[index]?.roomCategory &&
                                errors?.roomCharges?.[index]?.roomCategory
                                  ? "p-invalid"
                                  : ""
                              }
                              style={{ width: "100%" }}
                            />
                            {touched?.roomCharges?.[index]?.roomCategory &&
                              errors?.roomCharges?.[index]?.roomCategory && (
                                <small
                                  style={{
                                    color: "#dc3545",
                                    fontSize: "12px",
                                    marginTop: "5px",
                                  }}
                                >
                                  {errors.roomCharges[index].roomCategory}
                                </small>
                              )}
                          </div>
                        </div>

                        {/* Charge Fields Grid - 5 columns */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 1fr)",
                            gap: "15px",
                          }}
                        >
                          {/* Doctor Visit */}
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              Doctor Visit
                            </label>
                            <InputText
                              name={`roomCharges[${index}].doctorVisit`}
                              value={rc.doctorVisit}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="0"
                              type="number"
                              min="0"
                            />
                          </div>

                          {/* Nursing Charge */}
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              Nursing Charge
                            </label>
                            <InputText
                              name={`roomCharges[${index}].nursingCharge`}
                              value={rc.nursingCharge}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="0"
                              type="number"
                              min="0"
                            />
                          </div>

                          {/* Room Rent */}
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              Room Rent
                            </label>
                            <InputText
                              name={`roomCharges[${index}].roomRent`}
                              value={rc.roomRent}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="0"
                              type="number"
                              min="0"
                            />
                          </div>

                          {/* RMO Charge */}
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              RMO Charge
                            </label>
                            <InputText
                              name={`roomCharges[${index}].rmoCharge`}
                              value={rc.rmoCharge}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="0"
                              type="number"
                              min="0"
                            />
                          </div>

                          {/* Daycare Charge — NEW FIELD */}
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <label
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#495057",
                                marginBottom: "8px",
                              }}
                            >
                              Daycare Charge
                            </label>
                            <InputText
                              name={`roomCharges[${index}].daycareCharge`}
                              value={rc.daycareCharge}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="0"
                              type="number"
                              min="0"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </FieldArray>

              {/* Submit Buttons */}
              <div style={{ display: "flex", gap: "10px" }}>
                <Button
                  type="submit"
                  label={editingTPA ? "Update TPA" : "Add TPA"}
                  icon="pi pi-check"
                  className="p-button-success"
                />
                {editingTPA && (
                  <Button
                    type="button"
                    label="Cancel"
                    icon="pi pi-times"
                    className="p-button-secondary"
                    onClick={() => {
                      setEditingTPA(null);
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
            placeholder="Search by name, code, phone or email..."
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
            Showing {currentItems.length} of {filteredList.length} TPAs
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
                "TPA ID",
                "Name",
                "Contact",
                "TPA Code",
                "Contact Person",
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
                  colSpan="6"
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
                  <div style={{ marginTop: "10px" }}>TPA is Loading...</div>
                </td>
              </tr>
            ) : currentItems.length > 0 ? (
              currentItems.map((tpa, index) => (
                <tr
                  key={tpa._id}
                  style={{
                    borderBottom: "1px solid #e9ecef",
                    transition: "background-color 0.2s",
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
                    TPA-{1000 + indexOfFirstItem + index + 1}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    {tpa.tpaName}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    <div>{tpa.phone}</div>
                    <div style={{ color: "#6c757d", fontSize: "12px" }}>
                      {tpa.email || ""}
                    </div>
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
                        padding: "4px 12px",
                        borderRadius: "5px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {tpa.tpaCode}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    {tpa.contactPerson || "N/A"}
                  </td>
                  <td
                    style={{
                      padding: "12px 15px",
                      fontSize: "14px",
                      color: "#495057",
                    }}
                  >
                    <div style={{ display: "flex", gap: "5px" }}>
                      <Button
                        icon="pi pi-eye"
                        className="p-button-rounded p-button-info p-button-text"
                        onClick={() => setViewingTPA(tpa)}
                        tooltip="View"
                        tooltipOptions={{ position: "top" }}
                      />
                      <Button
                        icon="pi pi-pencil"
                        className="p-button-rounded p-button-warning p-button-text"
                        onClick={() => handleEdit(tpa)}
                        tooltip="Edit"
                        tooltipOptions={{ position: "top" }}
                        disabled={tpa.isActive === false}
                      />
                      <Button
                        icon={
                          tpa.isActive === false
                            ? "pi pi-replay"
                            : "pi pi-trash"
                        }
                        className={`p-button-rounded p-button-text ${
                          tpa.isActive === false
                            ? "p-button-success"
                            : "p-button-danger"
                        }`}
                        onClick={() => confirmDelete(tpa)}
                        tooltip={tpa.isActive === false ? "Restore" : "Delete"}
                        tooltipOptions={{ position: "top" }}
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="6"
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#6c757d",
                    fontSize: "16px",
                  }}
                >
                  No TPAs found
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
              backgroundColor: "white",
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
        onHide={() => setDeleteDialog({ visible: false, tpa: null })}
        modal
      >
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <i
            className="pi pi-exclamation-triangle"
            style={{ fontSize: "2rem", color: "#dc3545" }}
          />
          <span>
            Are you sure you want to delete{" "}
            <strong>{deleteDialog.tpa?.tpaName}</strong>?
          </span>
        </div>
      </Dialog>

      {/* View Modal */}
      {viewingTPA && (
        <ViewModal tpa={viewingTPA} onClose={() => setViewingTPA(null)} />
      )}
    </div>
  );
}

export default AddTpa;
