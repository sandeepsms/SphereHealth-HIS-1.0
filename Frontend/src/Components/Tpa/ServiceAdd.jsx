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
      }),
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
          })),
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
                      item.Amount - (item.Amount * item.Discount) / 100 || 0;

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
