import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getVitalSheet, deleteVitalSheet } from "../../Services/vital/vitalService";
import { Button } from "primereact/button";

function VitalsView() {
  const { uhid } = useParams();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  // Date filter states
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allRecords, setAllRecords] = useState([]);

  useEffect(() => {
    loadVitals();
  }, []);

  const loadVitals = async () => {
    const res = await getVitalSheet(uhid);
    if (res?.success) {
      const data = Array.isArray(res.data) ? res.data : [res.data];
      data.sort((a, b) => new Date(b.date) - new Date(a.date));

      setAllRecords(data);
      setRecords(data);
    }
  };

  const handleDelete = async (record) => {
    if (
      !window.confirm(
        `Are you sure you want to delete record dated ${record.date}?`,
      )
    )
      return;

    const res = await deleteVitalSheet(uhid, record.date);
    if (res?.success) {
      setRecords((prev) => prev.filter((r) => r.date !== record.date));
    }
  };

  const applyFilter = () => {
    if (!startDate && !endDate) return;

    const filtered = allRecords.filter((r) => {
      const d = new Date(r.date);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    setRecords(filtered);
  };

  const resetFilter = () => {
    setRecords(allRecords);
    setStartDate("");
    setEndDate("");
  };

  const patient = records[0]?.patientInfo || {};

  const formatDateDMY = (dateStr) => {
    if (!dateStr) return "";

    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    return `${day}-${month}-${year}`;
  };

  return (
    <div className=" p-4 mt-5 print-section bg-light">
      {/* Top Header */}
      <div className="mb-3 bg-white p-4">
        <div className="d-flex justify-content-between align-items-center">
          <Button
            label="Print"
            icon="pi pi-print"
            className="no-print"
            onClick={() => window.print()}
          />

          <div>
            <h2>Vitals Sheet</h2>
          </div>
          <div className="d-flex gap-2 align-items-center ">
            <input
              type="date"
              className="form-control no-print"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />

            <Button
              label="Apply"
              className="p-button-sm text-center p-2 w-50 no-print"
              onClick={applyFilter}
            />

            <Button
              label="Reset"
              className="p-button-secondary p-button-sm text-center p-2 w-50 no-print"
              onClick={resetFilter}
            />
          </div>
        </div>
        <hr />
        <div className="row gx-2 mt-3">
          <div className="row-2">
            <p>
              <strong>Patient Name:</strong> {patient.name}
            </p>
          </div>
          <div className="row-2">
            <p>
              <strong>Age:</strong> {patient.age}
            </p>
          </div>
          <div className="row-2">
            <p>
              <strong>Gender:</strong> {patient.gender}
            </p>
          </div>
          <div className="row-2">
            <p>
              <strong>UHID:</strong> {uhid}
            </p>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <p>No Vitals Found</p>
      ) : (
        records.map((record, idx) => (
          <div key={idx} className="record mb-4 border rounded p-3 bg-white">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Date: {formatDateDMY(record.date)}</h5>

              <div className="d-print-none">
                <Button
                  icon="pi pi-pencil"
                  onClick={() =>
                    navigate(`/vitals/${uhid}`, {
                      state: {
                        editMode: true,
                        record: record,
                      },
                    })
                  }
                />

                <Button
                  icon="pi pi-trash"
                  className="mx-1 no-print"
                  onClick={() => handleDelete(record)}
                  size="small"
                  severity="danger"
                />
              </div>
            </div>

            {/* Table */}
            <div className="table-responsive print-table">
              <table className="table table-bordered table-sm">
                <thead className="table-light text-center">
                  <tr>
                    <th>Time</th>

                    {record.activeVitals
                      .filter(
                        (v) =>
                          !["bp systolic", "bp diastolic"].includes(
                            v.name.toLowerCase(),
                          ),
                      )
                      .map((v, i) => {
                        const unit =
                          v.unit ||
                          record.tableData?.[0]?.values?.[v.name]?.unit;

                        return (
                          <th key={i}>
                            {v.name}
                            {unit && (
                              <span className="text-muted"> ({unit})</span>
                            )}
                          </th>
                        );
                      })}

                    <th>
                      BP <span className="text-muted">(mmHg)</span>
                    </th>

                    <th>Notes</th>
                    <th>Nurse</th>
                  </tr>
                </thead>

                <tbody className="text-center">
                  {record.tableData.map((row, i) => {
                    const sys = row.values?.["BP Systolic"]?.value;
                    const dia = row.values?.["BP Diastolic"]?.value;

                    return (
                      <tr key={i}>
                        <td>{row.time}</td>

                        {record.activeVitals
                          .filter(
                            (v) =>
                              !["bp systolic", "bp diastolic"].includes(
                                v.name.toLowerCase(),
                              ),
                          )
                          .map((v, j) => (
                            <td key={j}>{row.values?.[v.name]?.value ?? ""}</td>
                          ))}

                        <td className="fw-semibold">
                          {sys || dia ? `${sys ?? "-"} / ${dia ?? "-"}` : ""}
                        </td>

                        <td>{row.notes}</td>
                        <td>{row.nurse}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default VitalsView;
