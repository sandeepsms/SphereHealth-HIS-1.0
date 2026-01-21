// import React, { useEffect, useState } from "react";
// import { Field, FieldArray, Formik, Form, getIn } from "formik";
// import { Button } from "primereact/button";
// import * as yup from "yup";

// import "../../../css/servise.css";
// import { toast } from "react-toastify";

// import { Servicebill } from "../../Services/userbill";
// import { Dropdown } from "primereact/dropdown";
// import { useLocation } from "react-router-dom";
// import { InputText } from "primereact/inputtext";
// import AddTpa from "./AddTpa";
// import { Card } from "primereact/card";
// import { tpaService } from "../../Services/tpa/tpaService";

// function ServiceAdd() {
//   const [heading, setHeading] = useState();
//   const [tpaList, setTpaList] = useState([]);
//   const [initialLoading, setInitialLoading] = useState(true);
//   const [errors, setErrors] = useState({});

//   console.log("666666688888888------", tpaList);

//   // <AddTpa Component={ServiceAdd} />

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
//         Name: yup
//           .string()
//           .max(15, "Max 15 chars allowed")
//           .required("Enter the Name"),
//         Amount: yup
//           .number()
//           .typeError("Amount must be a number")
//           .required("Enter the Amount"),
//         Discount: yup.number().typeError("Amount must be a number"),
//         Totalamount: yup.number(),
//       }),
//     ),

//     TPA: yup.array().when([], {
//       is: () => isTPA, // ✅ Sirf tab validate kare jab TPA page pe ho
//       then: (schema) =>
//         schema.of(
//           yup.object().shape({
//             TPAName: yup
//               .string()
//               .max(15, "Max 15 chars allowed")
//               .required("Enter the TPA Name"),
//             TPAAmount: yup
//               .number()
//               .typeError("Amount must be a number")
//               .required("Enter the TPA Amount"),
//             TPADiscount: yup.number().typeError("Discount must be a number"),
//             TPATotalamount: yup.number(),
//           }),
//         ),
//       otherwise: (schema) => schema.notRequired(), // ❌ Agar TPA page nahi hai to validate na karo
//     }),
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

//   useEffect(() => {
//     fetchTPA();
//     setInitialLoading(false);
//   }, []);

//   const fetchTPA = async () => {
//     try {
//       const data = await tpaService.getActiveTPAs();
//       if (data.success) {
//         const formattedTPA = data.data.map((tpa) => ({
//           label: tpa.tpaName,
//           value: tpa._id,
//         }));
//         setTpaList(formattedTPA);
//       } else {
//         console.error("No TPA data received:", data);
//         setTpaList([]);
//       }
//     } catch (error) {
//       console.error("Error fetching TPA:", error);
//       toast.current?.show({
//         severity: "warn",
//         summary: "Warning",
//         detail: "TPA data unavailable",
//         life: 3000,
//       });
//       setTpaList([]);
//     }
//   };

//   return (
//     <>
//       {/* dynamic show form by URL (Params) */}

//       <div className="container-fluid">
//         <div className="text-center">
//           <h2 className="title" style={{ marginTop: "100px" }}>
//             {heading} Bill Form
//           </h2>
//         </div>
//         <Formik
//           // enableReinitialize
//           initialValues={{
//             tpaname: "",
//             service: [
//               {
//                 Name: "",
//                 Amount: 0,
//                 Discount: 0,
//                 Totalamount: 0,
//               },
//             ],
//           }}
//           validationSchema={validationSchema}
//           onSubmit={async (values, { resetForm }) => {
//             console.log(values, isTPA);

//             try {
//               const ourresponse = await Promise.all([
//                 fetchTPA(),
//                 Servicebill(values),
//               ]);

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
//           {({ values, handleSubmit, setFieldValue }) => (
//             <Form
//               onSubmit={handleSubmit}
//               className="form-container"
//               style={{ margin: "100px" }}
//             >
//               <FieldArray name="service">
//                 {({ remove, push }) => (
//                   <div>
//                     <div className="row d-flex justify-content-between">
//                       <div className="col-lg-2">
//                         <Card className="mb-4">
//                           <label className="font-semibold block mb-2">
//                             TPA (Optional)
//                           </label>
//                           <Dropdown
//                             value={values.tpaname}
//                             options={tpaList}
//                             onChange={(e) => setFieldValue("tpaname", e.value)}
//                             placeholder={
//                               tpaList.length
//                                 ? "Select TPA"
//                                 : "TPA data loading..."
//                             }
//                             filter
//                             showClear
//                             className={errors.tpa ? "p-invalid" : ""}
//                             style={{ width: "full" }}
//                           />
//                           {tpaList.length === 0 && !initialLoading && (
//                             <small className="text-500 block mt-1">
//                               No TPA available
//                             </small>
//                           )}
//                         </Card>

//                         <Button
//                           type="button"
//                           severity="success"
//                           onClick={() =>
//                             push({
//                               Name: "",
//                               Amount: 0,
//                               Discount: 0,
//                               Totalamount: 0,
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
//                           <th>Name</th>
//                           <th>Amount</th>
//                           <th>Discount</th>
//                           <th>Total</th>
//                           <th>Action</th>
//                         </tr>
//                       </thead>
//                       <tbody>
//                         {values.service.map((val, index) => (
//                           <tr key={index}>
//                             <td>
//                               <Field
//                                 name={`service[${index}].Name`}
//                                 component={Input}
//                                 placeholder="Enter Name"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`service[${index}].Amount`}
//                                 component={Input}
//                                 placeholder="Enter Amount"
//                               />
//                             </td>

//                             <td className="discount-cell">
//                               <div className="input-with-symboldd">
//                                 <Field
//                                   name={`service[${index}].Discount`}
//                                   component={Input}
//                                   placeholder="Discount"
//                                 />
//                                 {/* <span className="percent-symbol">%</span> */}
//                               </div>
//                             </td>

//                             <td className="total-cell">
//                               {
//                                 (val.Totalamount =
//                                   val.Amount -
//                                   (val.Amount * val.Discount) / 100)
//                               }
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





import React, { useEffect, useState } from "react";
import { Formik, Form, Field, FieldArray, getIn } from "formik";
import * as yup from "yup";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Card } from "primereact/card";
import { toast } from "react-toastify";

import { Servicebill } from "../../Services/userbill";
import { tpaService } from "../../Services/tpa/tpaService";

function ServiceAdd() {
  const [tpaList, setTpaList] = useState([]);

  /* ================= VALIDATION ================= */
  const validationSchema = yup.object({
    service: yup.array().of(
      yup.object({
        Name: yup.string().required("Enter Name"),
        Amount: yup.number().typeError("Amount must be number").required(),
        Discount: yup.number().typeError("Discount must be number"),
      })
    ),
  });

  /* ================= INPUT (SAME STYLE) ================= */
  const Input = ({ field, form, placeholder }) => {
    const error = getIn(form.errors, field.name);
    return (
      <div>
        <input {...field} placeholder={placeholder} className="form-control" />
        {error && <small className="text-danger">{error}</small>}
      </div>
    );
  };

  /* ================= FETCH TPA ================= */
  const fetchTPA = async () => {
    try {
      const res = await tpaService.getActiveTPAs();
      if (res.success) {
        setTpaList(
          res.data.map((tpa) => ({
            label: tpa.tpaName,
            value: tpa.tpaName, // ✅ name hi jaayega
          }))
        );
      }
    } catch {
      toast.error("TPA load failed");
    }
  };

  useEffect(() => {
    fetchTPA();
  }, []);

  return (
    <Formik
      initialValues={{
        tpaName: "",
        service: [
          {
            Name: "",
            Amount: "",
            Discount: "",
            Totalamount: 0,
          },
        ],
      }}
      validationSchema={validationSchema}
      onSubmit={async (values, { resetForm }) => {
        try {
          // 🟢 Ensure totalamount set
          const payload = {
            ...values,
            service: values.service.map((s) => ({
              ...s,
              Totalamount:
                Number(s.Amount || 0) -
                (Number(s.Amount || 0) * Number(s.Discount || 0)) / 100,
            })),
          };

          console.log("FINAL PAYLOAD 👉", payload);
          await Servicebill(payload);
          toast.success("Service saved successfully");
          resetForm();
        } catch (err) {
          toast.error(err?.response?.data?.message || "API Error");
        }
      }}
    >
      {({ values, setFieldValue }) => (
        <Form className="container-fluid">
          {/* ---------- TPA DROPDOWN (SAME LOOK) ---------- */}
          <div className="row">
            <div className="col-lg-3">
              <Card className="mb-3">
                <label className="font-semibold mb-2">TPA (Optional)</label>
                <Dropdown
                  value={values.tpaName}
                  options={tpaList}
                  onChange={(e) => setFieldValue("tpaName", e.value)}
                  placeholder="Select TPA"
                  filter
                  showClear
                  className="w-100"
                />
              </Card>

              <Button
                type="button"
                severity="success"
                onClick={() =>
                  setFieldValue("service", [
                    ...values.service,
                    { Name: "", Amount: "", Discount: "", Totalamount: 0 },
                  ])
                }
              >
                + Add
              </Button>
            </div>
          </div>

          {/* ---------- SERVICE TABLE (SAME STYLE AS BEFORE) ---------- */}
          <FieldArray name="service">
            {({ remove }) => (
              <table className="custom-table mt-4">
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
                  {values.service.map((item, index) => {
                    const total =
                      item.Amount -
                        (item.Amount * item.Discount) / 100 || 0;

                    return (
                      <tr key={index}>
                        <td>
                          <Field
                            name={`service[${index}].Name`}
                            component={Input}
                            placeholder="Service Name"
                          />
                        </td>

                        <td>
                          <Field
                            name={`service[${index}].Amount`}
                            component={Input}
                            placeholder="Amount"
                          />
                        </td>

                        <td>
                          <Field
                            name={`service[${index}].Discount`}
                            component={Input}
                            placeholder="Discount %"
                          />
                        </td>

                        <td>{total}</td>

                        <td>
                          <i
                            className="pi pi-trash text-danger"
                            style={{ cursor: "pointer" }}
                            onClick={() => remove(index)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </FieldArray>

          {/* ---------- SUBMIT ---------- */}
          <div className="mt-4">
            <Button type="submit" severity="info">
              Submit
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
}

export default ServiceAdd;
