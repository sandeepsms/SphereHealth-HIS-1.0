import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import "../../css/bedcss.css";
import { getPatientbyID } from "../Services/userService";
import { useParams } from "react-router-dom";

const API = "http://localhost:5000/api";

const bedFormSchema = Yup.object({
  id: Yup.string().required("Bed ID required"),
  ward: Yup.string().required("Ward required"),
  type: Yup.string().required(),
  status: Yup.string().oneOf(["available", "occupied", "maintenance"]),
  notes: Yup.string().nullable(),
  floor: Yup.string().required("Floor required"),
});

const assignSchema = Yup.object({
  bedId: Yup.string().required("Select bed"),
  name: Yup.string().required("Patient name required"),
  age: Yup.number().nullable(),
});

export default function BedManagementSingleFile() {
  const [beds, setBeds] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [message, setMessage] = useState(null);
  const [charges, setCharges] = useState(null);
  const [floorFilter, setFloorFilter] = useState("all");
  const [Uhid, setuhid] = useState(null);
  const [detail, setDetail] = useState(null);
  // const [patientId, setPatientId] = useState(null);
  const [selectedBedId, setSelectedBedId] = useState(null);
  const [assignedBedId, setAssignedBedId] = useState(null);
  const [chargesByBed, setChargesByBed] = useState({});
  const [showprice, setShowprice] = useState(false);
  const [hasFetchedCharges, setHasFetchedCharges] = useState(false);
  const [transfer, setTransfer] = useState("");
  const [showchargesintransfer, setShowchargesintransfer] = useState(false);
  const [totalCharge, setTotalcharge] = useState(0);
  const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState("");

console.log("-------------------kk",categories);

  const intervalRef = useRef(null);

  useEffect(() => {
    if (!assignedBedId) return;

    intervalRef.current = setInterval(() => {
      fetchCharges(assignedBedId);
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [assignedBedId]);

  const stopTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };




//  const payload = [
//   {
//   category: "General",   // dropdown से value आएगी
//   price: 500,            // input field से आएगा
//   createdAt: new Date().toISOString()
// },
//  {
//   category: "ICU",   // dropdown से value आएगी
//   price: 1000,            // input field से आएगा
//   createdAt: new Date().toISOString()
// }
// ];

// useEffect(() => {
//   const fetchDatacharge = async () => {
//     try {
//       const res = await axios.post(`${API}/ward-charges`, payload);

//       console.log("beddddddddddddddddddd", res.data);
//       setCategories(res.data);
//     } catch (e) {
//       console.error(e);
//       setMessage("Failed to fetch beds");
//     }
//   };

//   fetchDatacharge();
// }, []); // dependency array required




useEffect(() => {
  const fetchCategories = async () => {
    try {
      const res = await axios.get(`${API}/ward-charges`);
      setCategories(res.data);  // <-- yahin se aa raha hai categories
    } catch (error) {
      console.error("Failed to load categories", error);
    }
  };

  fetchCategories();
}, []);



  const handleShowCharges = () => {
    if (hasFetchedCharges) {
      alert("✅ Charges already fetched — API will not run again.");
      return;
    }

    fetchCharges(assignedBedId); // ✅ API ONLY once chalegi
    setHasFetchedCharges(true); // ✅ Mark as fetched
  };

  const { UHID } = useParams();

  console.log("ppppppppppppppppddddddddddd", Uhid);

  useEffect(() => {
    if (!UHID) return console.log("not found UHID");

    getPatientbyID(UHID)
      .then((res) => {
        setuhid(res.UHID);
        // setTpaId(res.TPAid);
        // setMLC(res.MLC);
        setDetail(res);
        console.log("Patient datasssssshhhhhhh:", res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);





//   useEffect(() => {
//   const fetchDatacharge = async () => {
//     try {
//       const res = await axios.post(`${API}/ward-charges:id`);

//       console.log("beddddddddddddddddddd", res.data);
//       // setCategories(res.data);
//     } catch (e) {
//       console.error(e);
//       setMessage("Failed to fetch beds");
//     }
//   };

//   fetchDatacharge();
// }, []);


  const fetchBeds = async () => {
    try {
      const res = await axios.get(`${API}/beds`);
      console.log("beddddddddddddddddddd", res);

      setBeds(res.data);
    } catch (e) {
      console.error(e);
      setMessage("Failed to fetch beds");
      setTimeout(() => setMessage(null), 2000);
    }
  };

  useEffect(() => {
    fetchBeds();
    // eslint-disable-next-line
  }, []);

  const generateNextId = () => {
    if (beds.length === 0) return "1";
    const max = Math.max(...beds.map((b) => Number(b.id)));
    return String(max + 1);
  };

  // Unique floors computed below (duplicate declaration removed)

  // counts
  const counts = beds.reduce(
    (acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    },
    { available: 0, occupied: 0, maintenance: 0 }
  );

  const floors = Array.from(new Set(beds.map((b) => String(b.floor || ""))))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  const perFloor = floors.reduce((acc, fl) => {
    const items = beds.filter((b) => String(b.floor) === fl);
    acc[fl] = items.reduce(
      (obj, b) => {
        obj[b.status] = (obj[b.status] || 0) + 1;
        obj.total += 1;
        return obj;
      },
      { available: 0, occupied: 0, maintenance: 0, total: 0 }
    );
    return acc;
  }, {});

  // helper to refresh and show message
  const refreshWithMsg = async (msg) => {
    await fetchBeds();
    setMessage(msg);
    setTimeout(() => setMessage(null), 2000);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete bed " + id + "?")) return;
    await axios.delete(`${API}/beds/${id}`);
    await refreshWithMsg("Bed deleted");
  };

  const openEdit = (bed) => {
    setEditing(bed);
    setShowForm(true);
  };

  const openAdd = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openAssignModal = (bed) => {
    setEditing(bed || null);
    setShowAssign(true);
  };

  const quickStatusChange = async (bed, status) => {
    if (status === "available") {
      // discharge endpoint clears patient
      await axios.post(`${API}/beds/${bed.id}/discharge`);
      await refreshWithMsg("Set available");
    } else if (status === "maintenance") {
      // update status only
      await axios.put(`${API}/beds/${bed.id}`, {
        ...bed,
        status: "maintenance",
        patient: null,
      });
      await refreshWithMsg("Set maintenance");
    } else if (status === "occupied") {
      // occupy with placeholder patient
      await axios.post(`${API}/beds/${bed.id}/assign`, {
        name: "Unknown",
        age: null,
      });
      await refreshWithMsg("Set occupied");
    }
  };

  const filteredBeds = () =>
    beds.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (floorFilter !== "all" && String(b.floor) !== String(floorFilter))
        return false;
      if (
        query &&
        // !`${b.id} ${b.ward} ${b.type} ${b.status} ${
        !`${b.id} ${b.ward} ${b.type} ${b.status} F${b.floor} ${
          (b.patient && b.patient.name) || ""
        }`

          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      return true;
    });

  // Group beds by floor → ward → beds
  const grouped = beds.reduce((acc, bed) => {
    // const floor = bed.floor || "Unknown";
    const floor = String(bed.floor ?? "").trim() !== "" ? bed.floor : "Unknown";

    if (!acc[floor]) acc[floor] = {};
    if (!acc[floor][bed.ward]) acc[floor][bed.ward] = [];
    acc[floor][bed.ward].push(bed);
    return acc;
  }, {});

  // const assignBed = async (bedId, patientId) => {
  //   await axios.put(`${API}/beds/assign/${bedId}`, { patientId });
  //   fetchBeds();  // refresh beds list
  // };

  const fetchCharges = async (bedId) => {
    try {
      const res = await axios.get(`${API}/beds/${bedId}/charges`);
      const key = String(bedId);
      // const totalCharges = res.data?.totalCharge ?? null;
      // setTotalcharge(totalCharges);

      setChargesByBed((prev) => ({   
        ...prev,
        [key]: res.data,

        // ✅ store per bed
      }));
      setTotalcharge(res.data?.totalCharge ?? 0);
      setShowprice(true);
    } catch (err) {
      console.error(err);
    }
  };

  function bedtransfer() {
    let reasion = prompt("Reasion of Bed Transfer");
    setTransfer(reasion);
    setShowchargesintransfer(true);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto start">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Bed Management</h1>
          <div className="text-sm text-gray-600 mt-1">
            <span style={{ color: "green" }}>
              {" "}
              Available: {counts.available}
            </span>{" "}
            <span style={{ color: "red" }}>
              {" "}
              • Occupied: {counts.occupied} •{" "}
            </span>
            <span style={{ color: "blue" }}>
              {" "}
              Maintenance: {counts.maintenance}
            </span>
          </div>

          {floors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {" "}
              {floors.map((fl) => (
                <span key={fl} className="px-2 py-1 rounded border bg-gray-50">
                  <b>F{fl}</b>:
                  <span className="ml-1" style={{ color: "green" }}>
                    {" "}
                    Available : {perFloor[fl].available}
                  </span>
                  <span className="ml-1" style={{ color: "red" }}>
                    {" "}
                    Occupied : {perFloor[fl].occupied}
                  </span>
                  <span className="ml-1" style={{ color: "blue" }}>
                    {" "}
                    Maintenance : {perFloor[fl].maintenance}
                  </span>
                  <span className="ml-1 text-gray-600">
                    {" "}
                    / Total: {perFloor[fl].total}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={openAdd}
            className="px-3 py-2 rounded bg-blue-600 text-white"
          >
            + Add Bed
          </button>
          <button
            onClick={() => openAssignModal(null)}
            className="px-3 py-2 rounded bg-green-600 text-white"
          >
            Assign Patient
          </button>
          <button
            onClick={() => {
              const name = window.prompt("Name for auto-assign:");
              if (!name) return;
              const age = window.prompt("Age (optional):");
              // choose first available and call assign
              const available = beds.find((b) => b.status === "available");
              if (!available) return alert("No available beds");
              axios
                .post(`${API}/beds/${available.id}/assign`, {
                  name,
                  age: age ? Number(age) : null,
                })
                .then(() => fetchBeds());
            }}
            className="px-3 py-2 rounded border"
          >
            Auto-Assign
          </button>
        </div>
      </header>

      <div className="flex gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by bed/patient/ward"
          className="flex-1 p-2 border rounded"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="occupied">Occupied</option>
          <option value="maintenance">Maintenance</option>
        </select>

        <select
          value={floorFilter}
          onChange={(e) => setFloorFilter(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="all">All Floors</option>
          {floors.map((fl) => (
            <option key={fl} value={fl}>
              Floor {fl}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div className="mb-4 p-2 bg-green-100 text-green-800 rounded">
          {message}
        </div>
      )}

      <div className="mt-6">
        {Object.keys(grouped)
          .sort()
          .map((floor) => (
            <div key={floor} className="mb-6 p-4 border rounded bg-gray-50">
              <h2 className="text-xl font-bold mb-2">Floor {floor}</h2>

              {Object.keys(grouped[floor]).map((ward) => (
                <div key={ward} className="ml-4 mb-3">
                  <h3 className="text-lg font-semibold">Ward {ward}</h3>

                  <ul className="ml-6 list-disc">
                    {grouped[floor][ward].map((bed) => (
                      <li key={bed.id} className="text-sm">
                        Bed {bed.id} —
                        <span className="capitalize ml-1">{bed.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredBeds().map((bed) => (
          <div key={bed.id} className="p-4 border rounded shadow-sm bg-white">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-lg font-medium">
                  {bed.id}{" "}
                  <span className="text-sm text-gray-500">
                    {/* / Ward {bed.ward} */}
                    {/* / F{bed.floor} / Ward {bed.ward} */}
                    Floor {bed.floor} • Ward {bed.ward}
                  </span>
                </div>

                <div className="text-sm text-gray-600">
                  {bed.type} — <span className="capitalize">{bed.status}</span>
                </div>
                {bed.notes && (
                  <div className="mt-2 text-sm text-gray-700">
                    Notes: {bed.notes}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="text-sm">
                  {bed.patient ? (
                    <div>
                      <div className="font-medium">{bed.patient.name}</div>
                      <div className="text-xs text-gray-500">
                        Age: {bed.patient.age || "—"}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">No patient</div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(bed)}
                    className="px-2 py-1 text-sm border rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(bed.id)}
                    className="px-2 py-1 text-sm border rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex gap-2 mb-3">
              {bed.status !== "occupied" && (
                <button
                  onClick={() => openAssignModal(bed)}
                  className="px-3 py-1 rounded bg-green-600 text-white text-sm"
                >
                  Assign
                </button>
              )}
              {bed.status === "occupied" && (
                <button
                  onClick={() => {
                    // fetchCharges(bed._id);
                    stopTimer();
                    if (!window.confirm(`Discharge patient from ${bed.id}?`))
                      return;
                    axios
                      .post(`${API}/beds/${bed.id}/discharge`)
                      .then(() => fetchBeds());
                  }}
                  className="px-3 py-1 rounded bg-yellow-500 text-white text-sm"
                >
                  Discharge
                </button>
              )}

              <button
                onClick={() => quickStatusChange(bed, "maintenance")}
                className="px-3 py-1 rounded border text-sm"
              >
                Maintenance
              </button>
              <button
                onClick={() => quickStatusChange(bed, "available")}
                className="px-3 py-1 rounded border text-sm"
              >
                Set Available
              </button>

              <button
                onClick={() => {
                  bedtransfer(), openEdit(bed);
                }}
                className="px-3 py-1 rounded border text-sm"
              >
                Bed Transfer
              </button>
            </div>
            <div className="">
              <button
                className="bg-green-600 text-white"
                onClick={() => {
                  handleShowCharges();
                }}
              >
                Show Charges
              </button>

              <button
                onClick={() => {
                  setShowprice(false), stopTimer();
                }}
                className="bg-danger text-white"
                style={{ marginLeft: "6px" }}
              >
                Clear Charges
              </button>

              <div>
                {" "}
                {showprice && (
                  <div>
                    {/* <p>⏱ Hours: {charges.hours}</p>
                    <p>💵 Hourly Charge: ₹{charges.hourlyCharge}</p>
                    <p>💰 Total Charge: ₹{charges.totalCharge}</p> */}
                    {chargesByBed[bed._id] && (
                      <p>Total Charge: ₹{chargesByBed[bed._id].totalCharge}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Assign modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Assign Patient to Bed</h2>
              <button
                onClick={() => setShowAssign(false)}
                className="text-gray-600"
              >
                Close
              </button>
            </div>

            <Formik
              initialValues={{
                bedId: editing ? editing._id : "",
                name: detail?.name || "",
                age: detail?.age || "",

                patientUHID: "",

                hourlyCharge: "",
                totalCharge: totalCharge,
              }}
              validationSchema={assignSchema}
              onSubmit={async (values, { setSubmitting, resetForm }) => {
                console.log("valuesssssssssby", values);

                try {
                  // First API call: assign the patient (name, age) to the bed
                  await axios.post(`${API}/beds/${values.bedId}/assign`, {
                    name: values.name,
                    age: values.age ? Number(values.age) : null,
                  });
                  setAssignedBedId(values.bedId);

                  // Second API call: update the same bed with patientId and hourlyCharge
                  // await axios.put(`${API}/beds/${values.bedId}/assign`,{
                  //   patientId: values.patientId,
                  //   hourlyCharge: values.hourlyCharge,
                  // });

                  await axios.put(`${API}/beds/${values.bedId}/assign`, {
                    patientUHID: Uhid,
                    hourlyCharge: values.hourlyCharge,
                    totalCharge: values.totalCharge,
                  });

                  //  await axios.put(`${API}/beds/assign/${bedId}`, { patientId },
                  //       {
                  //                 patientId: values.patientId,
                  //                 hourlyCharge: values.hourlyCharge,
                  //               });

                  //                 const assignBed = async (bedId, patientId) => {
                  //   await axios.put(`${API}/beds/assign/${bedId}`, { patientId });
                  //   fetchBeds();  // refresh beds list
                  // };

                  setSubmitting(false);
                  await fetchBeds();
                  setShowAssign(false);
                  setMessage(`Assigned ${values.name} to ${values.bedId}`);
                  setTimeout(() => setMessage(null), 1500);
                  resetForm();
                } catch (error) {
                  setSubmitting(false);
                  // Handle error
                }
              }}
            >
              {({ values, handleChange, setFieldValue, errors, touched }) => (
                <Form className="grid grid-cols-1 gap-3">
                  <label className="block text-sm">Select Bed</label>
                  <Field
                    as="select"
                    name="bedId"
                    className="w-full p-2 border rounded"
                  >
                    <option value="">-- choose bed --</option>

                    {beds
                      .filter(
                        (b) =>
                          b.status === "available" || b.status === "maintenance"
                      )
                      .map((b) => (
                        <option key={b._id} value={b._id}>
                          {/* Display bedNumber (b.id), but send _id */}
                          {b.id} (F{b.floor} • Ward {b.ward}) — {b.type} —{" "}
                          {b.status}
                        </option>
                      ))}
                  </Field>

                  {errors.bedId && touched.bedId && (
                    <div className="text-xs text-red-600">{errors.bedId}</div>
                  )}

                  <label className="block text-sm">Patient Name</label>
                  <Field name="name" className="w-full p-2 border rounded" />
                  {errors.name && touched.name && (
                    <div className="text-xs text-red-600">{errors.name}</div>
                  )}

                  <label className="block text-sm">
                    Patient Age (optional)
                  </label>
                  <Field name="age" className="w-full p-2 border rounded" />
                  {/* <label className="block text-sm">Bed Charges:</label>
                  <Field
                    name="hourlyCharge"
                    type="number"
                    placeholder="Hourly Charge"
                    className="input"
                  /> */}

                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setShowAssign(false)}
                      className="px-3 py-2 border rounded"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-2 bg-green-600 text-white rounded"
                    >
                      Assign
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      )}

      {/* Add / Edit bed form modal (Formik) */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-lg w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {editing ? `Edit ${editing.id}` : "Add Bed"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-600"
              >
                Close
              </button>
            </div>

            <Formik
              initialValues={{
                id: editing ? editing.id : "",
                ward: editing ? editing.ward : "",
                type: editing ? editing.type : "General",
                status: editing ? editing.status : "available",
                notes: editing ? editing.notes || "" : "",
                floor: editing ? String(editing.floor || "") : "",
                transfer: transfer,
              }}
              enableReinitialize
              validationSchema={bedFormSchema}
              onSubmit={async (values, { setSubmitting, resetForm }) => {
                try {
                  if (editing) {
                    await axios.put(`${API}/beds/${editing.id}`, values);
                    await fetchBeds();

                    setMessage("Bed updated");
                  } else {
                    await axios.post(`${API}/beds`, {
                      ...values,
                      patient: null,
                    });
                    await fetchBeds();
                    setMessage("Bed added");
                  }
                } catch (e) {
                  alert("Error: " + (e.response?.data?.message || e.message));
                }
                setSubmitting(false);
                setShowForm(false);
                setTimeout(() => setMessage(null), 1500);
                resetForm();
              }}
            >
              {({ values, handleChange, setFieldValue, errors, touched }) => (
                <Form className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm">Bed ID</label>
                    <Field
                      name="id"
                      disabled={!!editing}
                      className="w-full p-2 border rounded"
                    />
                    {errors.id && touched.id && (
                      <div className="text-xs text-red-600">{errors.id}</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm">Ward</label>
                    <Field name="ward" className="w-full p-2 border rounded" />
                    {errors.ward && touched.ward && (
                      <div className="text-xs text-red-600">{errors.ward}</div>
                    )}
                  </div>
                  +{" "}
                  <div>
                    <label className="block text-sm">Floor</label>
                    <Field
                      as="select"
                      name="floor"
                      className="w-full p-2 border rounded"
                    >
                      <option value="">-- select --</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                    </Field>
                    {errors.floor && touched.floor && (
                      <div className="text-xs text-red-600">{errors.floor}</div>
                    )}
                  </div>
                  {/* <div>
                    <label className="block text-sm">Type</label>
                    <Field
                      as="select"
                      name="type"
                      className="w-full p-2 border rounded"
                    >
                      <option>General</option>
                      <option>ICU</option>
                      <option>Stepdown</option>
                    </Field>
                  </div> */}

                  <div>
  <label className="block text-sm">Type</label>

  <Field
    as="select"
    name="type"
    className="w-full p-2 border rounded"
    onChange={(e) => {
      setFieldValue("type", e.target.value);   // Formik mein set hoga
      setSelectedCategory(e.target.value);     // Tumhara local state bhi update
    }}
  >
    <option value={selectedCategory}>Select Category</option>

    {categories.map((item) => (
      <option key={item.category} value={item.category}>
        {item.category}
      </option>
    ))}
  </Field>
</div>

                  <div>
                    <label className="block text-sm">Status</label>
                    <Field
                      as="select"
                      name="status"
                      className="w-full p-2 border rounded"
                    >
                      <option value="available">Available</option>
                      <option value="occupied">Occupied</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="BedTransfer">Bed Transfer</option>
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm">Notessssssssss</label>
                    <Field name="notes" className="w-full p-2 border rounded" />
                  </div>
                  {transfer && (
                    <div>
                      <label className="block text-sm">Bed Charges:</label>
                      <Field
                        name="hourlyCharge"
                        type="number"
                        placeholder="Hourly Charge"
                        className=" input w-full p-2 border rounded"
                      />
                    </div>
                  )}
                  <div className="mt-4 flex justify-end gap-2 md:col-span-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                      }}
                      className="px-3 py-2 border rounded"
                    >
                      Cancel
                    </button>


                    <button
                      type="submit"
                      className="px-3 py-2 bg-blue-600 text-white rounded"
                    >
                      {editing ? "Update" : "Addss"}      
                    </button>



                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      )}

      <footer className="mt-6 text-xs text-gray-500"></footer>
    </div>
  );
}
