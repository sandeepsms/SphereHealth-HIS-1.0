// import React, { useEffect, useState } from "react";
// import { getPatients } from "../Services/userService";
// import { DataTable } from "primereact/datatable";
// import { Column } from "primereact/column";
// import { FilterMatchMode, FilterOperator } from "primereact/api";
// import { InputText } from "primereact/inputtext";
// import { IconField } from "primereact/iconfield";
// import { InputIcon } from "primereact/inputicon";
// import { Button } from "primereact/button";
// import "../../css/Patient.css"; // import custom css
// import { getPatientbyID } from "../Services/userService";

// import { Sidebar } from "primereact/sidebar";
// import { useNavigate } from "react-router-dom";
// import ProductActions from "./ProductActions";

// function PatientsTable() {
//   const [patients, setPatients] = useState([]);
//   const [filters, setFilters] = useState({
//     global: { value: null, matchMode: FilterMatchMode.CONTAINS }, //search method all
//     name: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
//     age: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
//     contact: { value: null, matchMode: FilterMatchMode.IN },
//     birth: { value: null, matchMode: FilterMatchMode.EQUALS },
//     gender: { value: null, matchMode: FilterMatchMode.EQUALS },
//     blood: { value: null, matchMode: FilterMatchMode.EQUALS },
//     martial: { value: null, matchMode: FilterMatchMode.EQUALS },
//     address: { value: null, matchMode: FilterMatchMode.EQUALS },
//     email: { value: null, matchMode: FilterMatchMode.EQUALS },
//   });
//   const [loading, setLoading] = useState(true);
//   const [globalFilterValue, setGlobalFilterValue] = useState("");
//   const [PatientUHID, setpatientUHID] = useState();

//   const navigate = useNavigate();

//   const onGlobalFilterChange = (e) => {
//     const value = e.target.value;
//     let _filters = { ...filters };

//     _filters["global"].value = value;

//     setFilters(_filters);
//     setGlobalFilterValue(value);
//   };
//   const getAllPatients = async () => {
//     try {
//       const getPatient = await getPatients();
//       console.log("User Data:", getPatient);
//       if (getPatient.length > 0) {
//         setLoading(false);
//       }
//       setPatients(getPatient); // ✅ store data in state
//     } catch (error) {
//       console.error(error);
//     }
//   };
//   const formatDate = (birth) => {
//     if (!birth) return "";
//     return birth.split("T")[0]; // sirf date
//   };
//   useEffect(() => {
//     getAllPatients();
//   }, []);
//   const renderHeader = () => {
//     return (
//       <div className="flex justify-content-end">
//         <IconField iconPosition="left">
//           <InputIcon className="pi pi-search" />
//           <InputText
//             value={globalFilterValue}
//             onChange={onGlobalFilterChange}
//             placeholder="Keyword Search"
//           />
//         </IconField>
//       </div>
//     );
//   };
//   return (
//     <div className="p-5">
//       <div className="p-5">
//         {/* 🔹 Heading + Search in one row */}
//         <div className="flex justify-between items-center mb-4">
//           <h2 className="text-2xl font-bold">Patients List</h2>

//           <span className="p-input-icon-left ">
//             <i className="pi pi-search relative left-6 items-center " />
//             <InputText
//               value={globalFilterValue}
//               onChange={onGlobalFilterChange}
//               placeholder="Search patients..."
//             />
//           </span>
//         </div>
//       </div>
//       <DataTable
//         value={patients}
//         paginator
//         rows={10}
//         stripedRows
//         rowsPerPageOptions={[5, 10, 25, 50]}
//         currentPageReportTemplate="{first} to {last} of {totalRecords}"
//         filters={filters}
//         filterDisplay="row"
//         loading={loading}

//         globalFilterFields={[
//           "name",
//           "age",
//           "contact",
//           "birth",
//           "gender",
//           "blood",
//           "martial",
//           "address",
//           "email",
//           "UHID",
//         ]}
//         emptyMessage=" Patient are not found."
//         className="custom-datatable"
//       >
//         <Column field="name" filterField="name" header="Name" sortable></Column>
//         <Column field="age" filterField="age" header="Age" sortable></Column>
//         <Column
//           field="contact"
//           filterField="contact"
//           header="Contact"
//           sortable
//         ></Column>
//         <Column
//           field="birth"
//           filterField="birth"
//           header="D.O.B"
//           sortable
//           body={(rowData) => formatDate(rowData.birth)}
//         ></Column>
//         <Column
//           field="gender"
//           filterField="gender"
//           header="Gender"
//           sortable
//         ></Column>
//         <Column
//           field="blood"
//           filterField="blood"
//           header="Blood Group"
//           sortable
//         ></Column>
//         <Column
//           field="martial"
//           filterField="martial"
//           header="Martial Status"
//           sortable
//         ></Column>
//         <Column
//           field="address"
//           filterField="address"
//           header="Address"
//           sortable
//         ></Column>
//         <Column
//           field="email"
//           filterField="email"
//           header="Email"
//           sortable
//         ></Column>

//           <Column
//           field="uhid"
//           filterField="uhid"
//           header="UHID"
//           sortable
//         ></Column>

//         <Column
//           header="Actions"
//           body={(rowData) => {
//             return (
//               <Button
//                 icon="pi pi-pencil"
//                 className="p-button-rounded p-button-success mr-2"
//                 onClick={() => navigate(`/doctor/${rowData.UHID}`)}
//               />
//             );
//           }}
//           style={{ textAlign: "center", width: "8em" }}
//         />
//       </DataTable>
//     </div>
//   );
// }

// export default PatientsTable;

import React, { useEffect, useState, useRef } from "react";
import { getPatients } from "../Services/userService";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { FilterMatchMode } from "primereact/api";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { classNames } from "primereact/utils";
import { useNavigate } from "react-router-dom";
import { Menu } from "primereact/menu";
import "../../css/Patient.css"; // custom css

function PatientsTable() {
  const [patients, setPatients] = useState([]);
  const [filters, setFilters] = useState({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  });
  const [loading, setLoading] = useState(true);
  const [globalFilterValue, setGlobalFilterValue] = useState("");

  // states for dialogs
  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const menuRight = useRef(null);
  const navigate = useNavigate();

  const getAllPatients = async () => {
    try {
      const getPatient = await getPatients();
      if (getPatient.length > 0) {
        setLoading(false);
      }
      setPatients(getPatient);
    } catch (error) {
      console.error(error);
    }
  };

  const formatDate = (birth) => {
    if (!birth) return "";
    return birth.split("T")[0];
  };

  useEffect(() => {
    getAllPatients();
  }, []);

  // global search
  const onGlobalFilterChange = (e) => {
    const value = e.target.value;
    let _filters = { ...filters };
    _filters["global"].value = value;
    setFilters(_filters);
    setGlobalFilterValue(value);
  };

  // ---------------------- EDIT ----------------------
  const handleEdit = (rowData) => {
    setSelectedPatient({ ...rowData });
    setEditDialogVisible(true);
  };

  const handleSave = () => {
    setSubmitted(true);
    if (!selectedPatient.name) return; // validation

    let updated = [...patients];
    const index = updated.findIndex((p) => p.UHID === selectedPatient.UHID);
    if (index >= 0) {
      updated[index] = selectedPatient;
    }
    setPatients(updated);
    setEditDialogVisible(false);
    setSelectedPatient({});
    setSubmitted(false);
  };

  // ---------------------- DELETE ----------------------
  const handleDeleteConfirm = (rowData) => {
    setSelectedPatient(rowData);
    setDeleteDialogVisible(true);
  };

  const handleDelete = () => {
    setPatients(patients.filter((p) => p.UHID !== selectedPatient.UHID));
    setDeleteDialogVisible(false);
    setSelectedPatient({});
  };

  const items = [
    {
      // label: "Options",
      items: [
        {
          label: "Edit",
          icon: "pi pi-pencil",
        },
        {
          label: "Delete",
          icon: "pi pi-trash",
        },
        {
          // icon : 'pi pi-user-plus',
          template: (item, options) => {
            return (
              <div
                className="p-menuitem-content"
                icon="pi pi-user-plus"
                data-pc-section="content"
                onMouseMove={(e) => options.onMouseMove(e)}
              >
                <a className="p-menuitem-link" onClick={() => navigate(`/doctor/${item.UHID}`)}>
                  <span className="p-menuitem-icon pi pi-user-plus" />{" "}
                  {/* 👈 icon here */}
                  <span className="p-menuitem-text">Doctor</span>
                </a>
              </div>
            );
          },
        },
      ],
    },
  ];
  // ---------------------- ACTION BUTTONS ----------------------
  // 👇 Yeh actionBody function banalo
  const actionBody = (rowData) => {
    return (
      <div className="">
        {/* Edit Button */}
        <Menu
          model={items}
          popup
          ref={menuRight}
          id="popup_menu_right"
          popupAlignment="right"
        />
        {/* <Button
          label=""
          icon="pi pi-ellipsis-v"
          className="mr-2"
          onClick={(event) => menuRight.current.toggle(event)}
          aria-controls="popup_menu_right"
          aria-haspopup
          severity="primary"
        /> */}
        <a onClick={(event) => menuRight.current.toggle(event)}
          aria-controls="popup_menu_right"
          aria-haspopup> 
          <i className="pi pi-ellipsis-v"></i>
           </a>

        {/* <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="info"
          onClick={() => handleEdit(rowData)}
        /> */}

        {/* Delete Button */}
        {/* <Button
          icon="pi pi-trash"
          rounded
          outlined
          severity="danger"
          onClick={() => handleDeleteConfirm(rowData)}
        /> */}

        {/* Doctor Assignment Button */}
        <Button
          label="doctor"
          icon="pi pi-user-plus"
          rounded
          outlined
          severity="success"
          onClick={() => navigate(`/doctor/${rowData.UHID}`)}
        />
      </div>
    );
  };

  // ---------------------- RENDER ----------------------
  const header = (
    <div className="d-flex justify-content-between align-items-center">
      <h5 className=" colortext">Patients List</h5>
      <div className="topHeaderSeacrh">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={globalFilterValue}
            onChange={onGlobalFilterChange}
            placeholder="Search patients..."
          />
        </span>
        <Button
          label="Add Patient"
          icon="pi pi-plus"
          severity="primary"
          onClick={handleDelete}
          className="addPatientbutton"
        />
      </div>
    </div>
  );

  return (
    <div className="container-fluid">
      <div className="p-4 mt-6 bg-white rounded">
        {/* main div */}
        <div className="tablePagination">
          <DataTable
            value={patients}
            paginator
            rows={10}
            stripedRows
            rowsPerPageOptions={[5, 10, 25, 50]}
            filters={filters}
            loading={loading}
            globalFilterFields={[
              "name",
              "age",
              "contact",
              "birth",
              "gender",
              "email",
              "UHID",
            ]}
            filterDisplay="menu"
            emptyMessage="No patients found."
            header={header}
            className="custom-datatable"
            tableStyle={{ minWidth: '50rem' }}
          >
            <Column field="name" header="Name" sortable />
            <Column field="age" header="Age" sortable />
            <Column field="contact" header="Contact" sortable />
            <Column
              field="birth"
              header="D.O.B"
              sortable
              body={(rowData) => formatDate(rowData.birth)}
            />
            <Column field="gender" header="Gender" sortable />
            <Column field="email" header="Email" sortable style={{ width: '20%' }} />

            {/* ✅ All Actions in Single Column */}
            <Column
              header="Actions"
              body={actionBody}
              style={{ width: "18em" }}
            />
          </DataTable>
        </div>

        {/* ----------------- Edit Dialog ----------------- */}
        <Dialog
          visible={editDialogVisible}
          style={{ width: "32rem" }}
          header="Edit Patient"
          modal
          className="p-fluid"
          onHide={() => setEditDialogVisible(false)}
          footer={
            <>
              <Button
                label="Cancel"
                icon="pi pi-times"
                outlined
                onClick={() => setEditDialogVisible(false)}
              />
              <Button label="Save" icon="pi pi-check" onClick={handleSave} />
            </>
          }
        >
          <div className="field">
            <label htmlFor="name" className="font-bold">
              Name
            </label>
            <InputText
              id="name"
              value={selectedPatient.name || ""}
              onChange={(e) =>
                setSelectedPatient({ ...selectedPatient, name: e.target.value })
              }
              required
              autoFocus
              className={classNames({
                "p-invalid": submitted && !selectedPatient.name,
              })}
            />
            {submitted && !selectedPatient.name && (
              <small className="p-error">Name is required.</small>
            )}
          </div>

          <div className="field">
            <label htmlFor="age" className="font-bold">
              Age
            </label>
            <InputNumber
              id="age"
              value={selectedPatient.age || 0}
              onValueChange={(e) =>
                setSelectedPatient({ ...selectedPatient, age: e.value })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="contact" className="font-bold">
              Contact
            </label>
            <InputNumber
              id="contact"
              value={selectedPatient.contact || 0}
              onValueChange={(e) =>
                setSelectedPatient({ ...selectedPatient, contact: e.value })
              }
              useGrouping={false} // 👈disables commas
            />
          </div>

          <div className="field">
            <label htmlFor="email" className="font-bold">
              Email
            </label>
            <InputText
              id="email"
              value={selectedPatient.email || ""}
              onChange={(e) =>
                setSelectedPatient({
                  ...selectedPatient,
                  email: e.target.value,
                })
              }
              required
              autoFocus
              className={classNames({
                "p-invalid": submitted && !selectedPatient.email,
              })}
            />
          </div>

          <div className="field">
            <label htmlFor="address" className="font-bold">
              Address
            </label>
            <InputTextarea
              id="address"
              value={selectedPatient.address || ""}
              onChange={(e) =>
                setSelectedPatient({
                  ...selectedPatient,
                  address: e.target.value,
                })
              }
              rows={3}
              cols={20}
            />
          </div>
        </Dialog>

        {/* ----------------- Delete Dialog ----------------- */}
        <Dialog
          visible={deleteDialogVisible}
          style={{ width: "28rem" }}
          header="Confirm Delete"
          modal
          onHide={() => setDeleteDialogVisible(false)}
          footer={
            <>
              <Button
                label="No"
                icon="pi pi-times"
                outlined
                onClick={() => setDeleteDialogVisible(false)}
              />
              <Button
                label="Yes"
                icon="pi pi-check"
                severity="danger"
                onClick={handleDelete}
              />
            </>
          }
        >
          <div className="confirmation-content">
            <i
              className="pi pi-exclamation-triangle mr-3"
              style={{ fontSize: "2rem" }}
            />
            {selectedPatient && (
              <span>
                Are you sure you want to delete <b>{selectedPatient.name}</b>?
              </span>
            )}
          </div>
        </Dialog>
      </div>
    </div>
  );
}

export default PatientsTable;
