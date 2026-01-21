// import React, { useEffect, useState } from "react";
// import { Field, FieldArray, Formik, Form, getIn } from "formik";
// import { Button } from "primereact/button";
// import * as yup from "yup";

// import "../../../css/servise.css";
// import { toast } from "react-toastify";

// import { Servicebill } from "../../Services/userbill";

// import { useLocation } from "react-router-dom";
// import { InputText } from "primereact/inputtext";
// import AddTpa from "./AddTpa";
// import{tpaService} from "../../Services/tpa/tpaService"

// function ServiceAdd() {
//   const [heading, setHeading] = useState();

//   // const location = useLocation();

//   // const isTPA = location.pathname.includes("/tpaAdd");
//   // useEffect(() => {
//   //   if (isTPA) {
//   //     setHeading("Add TPA");
//   //   } else {
//   //     setHeading("Add Service");
//   //   }
//   // });

//   const validationSchema = yup.object().shape({
//     User: yup.array().of(
//       yup.object().shape({
//         tpaName: yup
//           .string()
//           .max(15, "Max 15 chars allowed")
//           .required("Enter the TPAName"),
//         tpaCode: yup
//           .number()
//           .typeError("TPACode must be a number")
//           .required("Enter the TPACode"),
//         phone: yup.number().typeError("Mobile Number must be a number"),
//       }),
//     ),

//     // TPA: yup.array().when([], {
//     //   is: () => isTPA, // ✅ Sirf tab validate kare jab TPA page pe ho
//     //   then: (schema) =>
//     //     schema.of(
//     //       yup.object().shape({
//     //         TPAName: yup
//     //           .string()
//     //           .max(15, "Max 15 chars allowed")
//     //           .required("Enter the TPA Name"),
//     //         TPACode: yup
//     //           .number()
//     //           .typeError("TPACode must be a number")
//     //           .required("Enter the TPA Code"),
//     //         MobileNo: yup.number().typeError("Mobile number must be a number"),

//     //       }),
//     //     ),
//     //   otherwise: (schema) => schema.notRequired(), // ❌ Agar TPA page nahi hai to validate na karo
//     // }),
//   });

//   const Input = ({ field, form, placeholder }) => {
//     const errorMessage = getIn(form.errors, field.name);
//     return (
//       <div className="input-wrapper">
//         <input {...field} placeholder={placeholder} className="input-box" />
//         {errorMessage && <div className="error-text">{errorMessage}</div>}
//       </div>
//     );
//   };

//   return (
//     <>
//       {/* dynamic show form by URL (Params) */}

//       <div className="container-fluid">
//         <div className="text-center">
//           <h2 className="title" style={{ marginTop: "100px" }}>
//             {heading} TPA Bill Form
//           </h2>
//         </div>
//         <Formik
//           // enableReinitialize
//           initialValues={{
//             TPAservice: [
//               {
//                 tpaName: "",
//                 tpaCode: "",
//                 phone: "",
//               },
//             ],
//           }}
//           validationSchema={validationSchema}
//           onSubmit={async (values, { resetForm }) => {
//             console.log(values);

//             try {
//               const ourresponse = await tpaService.createTPA(values);
//               toast.success(ourresponse.data.message);
//               resetForm();

//               console.log("Final Submitted Data:", values);
//             } catch (error) {
//               toast.error(error.response.data.message);
//               console.log("errordata", error);
//               resetForm();
//             }
//           }}
//         >
//           {({ values, handleSubmit }) => (
//             <Form
//               onSubmit={handleSubmit}
//               className="form-container"
//               style={{ margin: "100px" }}
//             >
//               <FieldArray name="TPAservice">
//                 {({ remove, push }) => (
//                   <div>
//                     <div className="row d-flex justify-content-between">
//                       {/* <div className="  row text-center w-50 ">
//                         {isTPA && (
//                           <>
//                             <div className="col-md-4">
//                               <Field
//                                 name="tpaName"
//                                 as="input"
//                                 placeholder="Enter TPA Name"
//                                 className="form-control "
//                               />
//                             </div>
//                             <div className="col-md-4">
//                               <Field
//                                 name="tpaCode"
//                                 as="input"
//                                 placeholder="Enter TPA Code"
//                                 className="form-control"
//                               />
//                             </div>
//                             <div className="col-md-4">
//                               <Field
//                                 name="phone"
//                                 as="input"
//                                 placeholder="Enter Mobile No"
//                                 className="form-control"
//                               />
//                             </div>
//                           </>
//                         )}
//                       </div> */}

//                       <div className="col-lg-2">
//                         <Button
//                           type="button"
//                           severity="success"
//                           onClick={() =>
//                             push({
//                               tpaName: "",
//                               tpaCode: "",
//                               phone: "",
//                             })
//                           }
//                         >
//                           + Add
//                         </Button>
//                       </div>
//                     </div>
//                     <table className="custom-table">
//                       <thead>
//                         <tr>
//                           <th>TPAName</th>
//                           <th>TPACode</th>
//                           <th>Mobile No</th>

//                           <th>Action</th>
//                         </tr>
//                       </thead>
//                       <tbody>
//                         {values.TPAservice.map((val, index) => (
//                           <tr key={index}>
//                             <td>
//                               <Field
//                                 name={`TPAservice[${index}].tpaName`}
//                                 component={Input}
//                                 placeholder="Enter TPA Name"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`TPAservice[${index}].tpaCode`}
//                                 component={Input}
//                                 placeholder="Enter TPA Code"
//                               />
//                             </td>

//                             <td className="discount-cell">
//                               <div className="input-with-symboldd">
//                                 <Field
//                                   name={`TPAservice[${index}].phone`}
//                                   component={Input}
//                                   placeholder="Enter Mobile No"
//                                 />
//                                 {/* <span className="percent-symbol">%</span> */}
//                               </div>
//                             </td>

//                             <td>
//                               <a onClick={() => remove(index)}>
//                                 <i className="pi pi-trash text-danger"></i>
//                               </a>
//                             </td>
//                           </tr>
//                         ))}
//                       </tbody>
//                     </table>
//                   </div>
//                 )}
//               </FieldArray>

//               <div className="submit-row">
//                 <Button type="submit" severity="info">
//                   Submit
//                 </Button>
//               </div>
//             </Form>
//           )}
//         </Formik>
//       </div>
//     </>
//   );
// }

// export default ServiceAdd;

import React from "react";
import { Field, Formik, Form, getIn } from "formik";
import { Button } from "primereact/button";
import * as yup from "yup";
import { toast } from "react-toastify";

import "../../../css/servise.css";
import { tpaService } from "../../Services/tpa/tpaService";

function ServiceAdd() {
  // ==========================
  // VALIDATION
  // ==========================
  const validationSchema = yup.object({
    tpaName: yup
      .string()
      .max(30, "Max 30 chars allowed")
      .required("TPA Name required"),

    tpaCode: yup.string().required("TPA Code required"),

    phone: yup
      .string()
      .matches(/^[0-9]{10}$/, "Enter valid 10 digit mobile")
      .required("Mobile required"),
  });

  // ==========================
  // INPUT COMPONENT
  // ==========================
  const Input = ({ field, form, placeholder }) => {
    const error = getIn(form.errors, field.name);
    const touch = getIn(form.touched, field.name);

    return (
      <div>
        <input {...field} placeholder={placeholder} className="input-box" />
        {error && touch && <small className="error-text">{error}</small>}
      </div>
    );
  };

  return (
    <div className="container-fluid">
      <div className="text-center">
        <h2 className="title mt-5">Add TPA</h2>
      </div>

      <Formik
        initialValues={{
          tpaName: "",
          tpaCode: "",
          phone: "",
        }}
        validationSchema={validationSchema}
        onSubmit={async (values, { resetForm }) => {
          try {
            await tpaService.createTPA(values);
            toast.success("TPA Added Successfully");
            resetForm();
          } catch (error) {
            toast.error(error?.response?.data?.message || "Error");
          }
        }}
      >
        {() => (
          <Form className="form-container mt-5">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>TPA Name</th>
                  <th>TPA Code</th>
                  <th>Mobile No</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>
                    <Field
                      name="tpaName"
                      component={Input}
                      placeholder="Enter TPA Name"
                    />
                  </td>

                  <td>
                    <Field
                      name="tpaCode"
                      component={Input}
                      placeholder="Enter TPA Code"
                    />
                  </td>

                  <td>
                    <Field
                      name="phone"
                      component={Input}
                      placeholder="Enter Mobile No"
                    />
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="text-center mt-4">
              <Button type="submit" severity="info">
                Submit
              </Button>
            </div>
          </Form>
        )}
      </Formik>
    </div>
  );
}

export default ServiceAdd;
