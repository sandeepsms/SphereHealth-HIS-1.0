import React, { useState, useEffect } from "react";
import { Formik, Form } from "formik";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import * as yup from "yup";
import { toast } from "react-toastify";

import { roomCategoryService } from "../../Services/roomCategoryService";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../styles/AddTpa.css";

function AddRoomCategory() {
  const [editing, setediting] = useState(false);

  const validationSchema = yup.object({
    categoryName: yup
      .string()
      .max(30, "Max 30 chars")
      .required("categoryName is required"),
    categoryCode: yup.string().required("categoryCode is required"),

    description: yup.string(),
    roomType: yup.string().required("roomType is required"),
  });

  const handleSubmit = async (values, { resetForm }) => {
    try {
      if (editing) {
        console.log("Updating TPA:", editing._id, values);
        await roomCategoryService.updateCategory(editing._id, values);
        toast.success("Room Category Updated Successfully");
        setediting(null);
      } else {
        console.log("Creating TPA:", values);
        await roomCategoryService.createCategory(values);
        toast.success("Room Category Added Successfully");
      }
      resetForm();
      
    } catch (error) {
      console.error("Submit error:", error);
      toast.error(error?.response?.data?.message || "Error occurred");
    }
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
          Add Room Category
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
          {editing ? "Edit Room Category" : "Add New Room Category"}
        </h2>

        <Formik
          initialValues={{
            categoryName: editing?.categoryName || "",
            categoryCode: editing?.categoryCode || "",
            description: editing?.description || "",
            roomType: editing?.roomType || "",
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

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                  category Code <span style={{ color: "#dc3545" }}>*</span>
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
                  <InputText
                    name="description"
                    value={values.description}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter description"
                 
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

                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#495057",
                      marginBottom: "8px",
                    }}
                  >
                    RoomType  <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <InputText
                    name="roomType"
                    value={values.roomType}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Enter RoomType"
                    className={errors.roomType && touched.roomType ? "p-invalid" : ""}
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
              </div>

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
                      setediting(null);
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
      {/* <div
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
       </div> */}

      {/* Table */}
      {/* <div
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
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 TPA ID
               </th>
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 Name
               </th>
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 Contact
               </th>
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 TPA Code
               </th>
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 Contact Person
               </th>
               <th
                 style={{
                   padding: "15px",
                   textAlign: "left",
                   fontWeight: 600,
                   fontSize: "14px",
                 }}
               >
                 Actions
               </th>
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
      {/* {totalPages > 1 && (
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
       </div> */}

      {/* Delete Confirmation Dialog */}
      {/* <Dialog
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
       </Dialog> */}

      {/* View Modal */}
      {/* {viewingTPA && (
        <ViewModal tpa={viewingTPA} onClose={() => setViewingTPA(null)} />
      )} */}
    </div>
  );
}

export default AddRoomCategory;
