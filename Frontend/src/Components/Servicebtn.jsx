// import React from "react";
// import { Field, FieldArray, Formik, Form, getIn } from "formik";
// import { Button } from "primereact/button";
// import * as yup from "yup";

// function Servicebtn() {
//   const validationSchema = yup.object().shape({
//     User: yup.array().of(
//       yup.object().shape({
//         Name: yup.string().max(10, "Max 10 chars allowed"),
//         Amount: yup.number().required("Enter amount"),
//         Discount: yup.number().required("Enter discount"),
//         Totalamount: yup.number(),
//       })
//     ),
//   });

//   const Input = ({ field, form ,placeholder}) => {
//     const errorMessage = getIn(form.errors, field.name);
//     return (
//       <>
//          <input {...field} placeholder={placeholder}/>
//         {errorMessage && <div style={{ color: "red" }}>{errorMessage}</div>}
//       </>
//     );
//   };

//   return (
//     <Formik
//       initialValues={{
//         User: [
//           {
//             id: Date.now(),
//             Name: "",
//             Amount: 0,
//             Discount: 0,
//             Totalamount: 0,
//           },
//         ],
//       }}
//       validationSchema={validationSchema}
//       onSubmit={(values) => {
//         // Calculate totals before submit
//         const updated = values.User.map((u) => ({
//           ...u,
//           Totalamount: u.Amount - u.Amount * u.Discount,
//         }));
//         console.log(updated);
//       }}
//     >
//       {({ values, handleSubmit }) => (
//         <form onSubmit={handleSubmit}>

//           <FieldArray name="User">
//             {({ remove, push }) => (
//              <>
//              <table class="table " style={{margin:"150px"}}>
//   <thead>
//     <tr>
//       <th scope="col">ID</th>
//       <th scope="col">Name</th>
//       <th scope="col">Amount</th>
//       <th scope="col">Discount</th>
//        <th scope="col">Totalamount</th>

//     </tr>
//   </thead>
//   <tbody>
//     {values.User.map((val,index)=>{
//       return(

//  <tr>
//       <th scope="row">{val.id}</th>
//       <td>
//          <Field
//     name={`User[${index}].Name`}
//      component={Input}
//     placeholder="Enter Name"
//       />
//       </td>
//       <td>
//          <Field
//     name={`User[${index}].Amount`}
//      component={Input}
//     placeholder="Enter Name"
//       />
//       </td>

//        <td>
//          <Field
//     name={`User[${index}].Discount`}
//      component={Input}
//     placeholder="Enter Name"
//       />
//       </td>
//       <td>
//         {
// (val.Totalamount = val.Amount - (val.Amount * val.Discount) / 100)
//     }
//       </td>
//     </tr>

//       )
//     })}

//   </tbody>
// </table>

//              </>

//             )}
//           </FieldArray>

//           <div>
//             <button type="submit">Submit</button>
//           </div>

//         </form>
//       )}
//     </Formik>
//   );
// }

// export default Servicebtn;

import React, { useEffect, useState } from "react";
import { Field, FieldArray, Formik, Form, getIn } from "formik";
import { Button } from "primereact/button";
import * as yup from "yup";
import "../../css/servise.css";
import { toast } from "react-toastify";
import { Servicebill } from "../Services/userbill";
import { useLocation } from "react-router-dom";
import { InputText } from "primereact/inputtext";

function Servicebtn() {
  const [heading, setHeading] = useState();

  const location = useLocation();

  const isTPA = location.pathname.includes("/TPA");
  useEffect(() => {
    if (isTPA) {
      setHeading("Add TPA");
    } else {
      setHeading("Add Service");
    }
  });

  const validationSchema = yup.object().shape({
    User: yup.array().of(
      yup.object().shape({
        Name: yup
          .string()
          .max(15, "Max 15 chars allowed")
          .required("Enter the Name"),
        Amount: yup
          .number()
          .typeError("Amount must be a number")
          .required("Enter the Amount"),
        Discount: yup.number().typeError("Amount must be a number"),
        Totalamount: yup.number(),
      })
    ),

    TPA: yup.array().when([], {
      is: () => isTPA, // ✅ Sirf tab validate kare jab TPA page pe ho
      then: (schema) =>
        schema.of(
          yup.object().shape({
            TPAName: yup
              .string()
              .max(15, "Max 15 chars allowed")
              .required("Enter the TPA Name"),
            TPAAmount: yup
              .number()
              .typeError("Amount must be a number")
              .required("Enter the TPA Amount"),
            TPADiscount: yup.number().typeError("Discount must be a number"),
            TPATotalamount: yup.number(),
          })
        ),
      otherwise: (schema) => schema.notRequired(), // ❌ Agar TPA page nahi hai to validate na karo
    }),
  });

  const Input = ({ field, form, placeholder }) => {
    const errorMessage = getIn(form.errors, field.name);
    return (
      <div className="input-wrapper">
        <input {...field} placeholder={placeholder} className="input-box" />
        {errorMessage && <div className="error-text">{errorMessage}</div>}
      </div>
    );
  };

  return (
    <>
      {/* dynamic show form by URL (Params) */}

      <div className="container-fluid">
        <div className="text-center">
          <h2 className="title" style={{ marginTop: "100px" }}>
            {heading} Form
          </h2>
        </div>
        <Formik
          // enableReinitialize
          initialValues={{
            tpa_name: "",
            service: [
              {
                Name: "",
                Amount: 0,
                Discount: 0,
                Totalamount: 0,
              },
            ],
          }}
          validationSchema={validationSchema}
          onSubmit={async (values, { resetForm }) => {
            console.log(values, isTPA);

            try {
              const ourresponse = await Servicebill(values);
              toast.success(ourresponse.data.message);
              resetForm();

              console.log("Final Submitted Data:", values);
            } catch (error) {
              toast.error(error.response.data.message);
              console.log("errordata", error);
              resetForm();
            }
          }}
        >
          {({ values, handleSubmit }) => (
            <Form
              onSubmit={handleSubmit}
              className="form-container"
              style={{ margin: "100px" }}
            >
              <FieldArray name="service">
                {({ remove, push }) => (
                  <div>
                    <div className="row d-flex justify-content-between">
                      <div className="col-lg-2 text-center w-50">
                        {isTPA && (
                          <Field
                            name="tpa_name"
                            as="input"
                            placeholder="Enter TPA Name"
                            className="form-control"
                          />
                        )}
                      </div>

                      <div className="col-lg-2">
                        <Button
                          type="button"
                          severity="success"
                          onClick={() =>
                            push({
                              Name: "",
                              Amount: 0,
                              Discount: 0,
                              Totalamount: 0,
                            })
                          }
                        >
                          + Add
                        </Button>
                      </div>
                    </div>
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Amount</th>
                          <th>Discount</th>
                          <th>Total</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {values.service.map((val, index) => (
                          <tr key={index}>
                            <td>
                              <Field
                                name={`service[${index}].Name`}
                                component={Input}
                                placeholder="Enter Name"
                              />
                            </td>
                            <td>
                              <Field
                                name={`service[${index}].Amount`}
                                component={Input}
                                placeholder="Enter Amount"
                              />
                            </td>

                            <td className="discount-cell">
                              <div className="input-with-symboldd">
                                <Field
                                  name={`service[${index}].Discount`}
                                  component={Input}
                                  placeholder="Discount"
                                />
                                {/* <span className="percent-symbol">%</span> */}
                              </div>
                            </td>

                            <td className="total-cell">
                              {
                                (val.Totalamount =
                                  val.Amount -
                                  (val.Amount * val.Discount) / 100)
                              }
                            </td>
                            <td>
                              <a onClick={() => remove(index)}>
                                <i className="pi pi-trash text-danger"></i>
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </FieldArray>

              <div className="submit-row">
                <Button type="submit" severity="info">
                  Submit
                </Button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </>
  );
}

export default Servicebtn;
