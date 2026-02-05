import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Toast } from "primereact/toast";
import { ConfirmDialog } from "primereact/confirmdialog";
import { Tag } from "primereact/tag";
import { Card } from "primereact/card";
import { billingService } from "../../Services/billing/billingService";

const BillsList = () => {
  const navigate = useNavigate();
  const toast = useRef(null);

  // 🔥 FIX: Initialize as empty array
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalRecords, setTotalRecords] = useState(0);
  const [lazyParams, setLazyParams] = useState({
    first: 0,
    rows: 10,
    page: 1,
  });

  const [filters, setFilters] = useState({
    UHID: "",
    patientName: "",
    billNumber: "",
    status: "",
    startDate: null,
    endDate: null,
  });

  const [stats, setStats] = useState(null);

  const statusOptions = [
    { label: "All", value: "" },
    { label: "Draft", value: "draft" },
    { label: "Generated", value: "generated" },
    { label: "Partial", value: "partial" },
    { label: "Paid", value: "paid" },
    { label: "Cancelled", value: "cancelled" },
  ];

  useEffect(() => {
    loadBills();
    loadStats();
  }, [lazyParams, filters]);

  const loadBills = async () => {
    try {
      setLoading(true);
      const response = await billingService.getAllBills(
        {
          ...filters,
          startDate: filters.startDate?.toISOString(),
          endDate: filters.endDate?.toISOString(),
        },
        lazyParams.page,
        lazyParams.rows,
      );

      // 🔥 FIX: Always ensure bills is an array
      const billsData = response?.bills || response?.data || [];
      setBills(Array.isArray(billsData) ? billsData : []);

      setTotalRecords(response?.pagination?.total || 0);
    } catch (error) {
      console.error("Load bills error:", error);
      // 🔥 FIX: Reset to empty array on error
      setBills([]);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to load bills",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await billingService.getBillStats({
        startDate: filters.startDate?.toISOString(),
        endDate: filters.endDate?.toISOString(),
      });
      setStats(statsData);
    } catch (error) {
      console.error("Failed to load stats:", error);
      // Don't show error toast for stats, just log it
    }
  };

  const onPage = (event) => {
    setLazyParams({
      ...lazyParams,
      first: event.first,
      rows: event.rows,
      page: event.page + 1,
    });
  };

  const handleFilter = (key, value) => {
    setFilters({ ...filters, [key]: value });
    setLazyParams({ ...lazyParams, first: 0, page: 1 });
  };

  const clearFilters = () => {
    setFilters({
      UHID: "",
      patientName: "",
      billNumber: "",
      status: "",
      startDate: null,
      endDate: null,
    });
  };

  const statusBodyTemplate = (rowData) => {
    const severity =
      rowData.status === "paid"
        ? "success"
        : rowData.status === "partial"
          ? "warning"
          : rowData.status === "cancelled"
            ? "danger"
            : "info";

    return (
      <Tag
        value={rowData.status?.toUpperCase() || "DRAFT"}
        severity={severity}
      />
    );
  };

  const amountBodyTemplate = (rowData) => {
    return `₹${rowData.financials?.total?.toFixed(2) || 0}`;
  };

  const balanceBodyTemplate = (rowData) => {
    const balance = rowData.financials?.balance || 0;
    return (
      <span
        className={balance > 0 ? "text-red-600 font-bold" : "text-green-600"}
      >
        ₹{balance.toFixed(2)}
      </span>
    );
  };

  const dateBodyTemplate = (rowData) => {
    return new Date(rowData.createdAt).toLocaleDateString("en-IN");
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-eye"
          className="p-button-sm p-button-info"
          onClick={() => navigate(`/billing/view/${rowData._id}`)}
          tooltip="View Bill"
        />
        {rowData.status === "draft" && (
          <Button
            icon="pi pi-pencil"
            className="p-button-sm p-button-warning"
            onClick={() => navigate(`/billing/edit/${rowData._id}`)}
            tooltip="Edit Bill"
          />
        )}
      </div>
    );
  };

  return (
    <div className="p-4">
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* Stats Cards */}
      {stats && (
        <div className="grid mb-4">
          <div className="col-12 md:col-3">
            <Card className="bg-blue-50">
              <div className="flex justify-content-between align-items-center">
                <div>
                  <div className="text-500 mb-2">Total Bills</div>
                  <div className="text-3xl font-bold text-blue-600">
                    {stats.total || 0}
                  </div>
                </div>
                <i className="pi pi-file text-blue-600 text-4xl"></i>
              </div>
            </Card>
          </div>
          <div className="col-12 md:col-3">
            <Card className="bg-green-50">
              <div className="flex justify-content-between align-items-center">
                <div>
                  <div className="text-500 mb-2">Total Revenue</div>
                  <div className="text-3xl font-bold text-green-600">
                    ₹{((stats.totalRevenue || 0) / 1000).toFixed(1)}K
                  </div>
                </div>
                <i className="pi pi-money-bill text-green-600 text-4xl"></i>
              </div>
            </Card>
          </div>
          <div className="col-12 md:col-3">
            <Card className="bg-purple-50">
              <div className="flex justify-content-between align-items-center">
                <div>
                  <div className="text-500 mb-2">Collected</div>
                  <div className="text-3xl font-bold text-purple-600">
                    ₹{((stats.totalCollected || 0) / 1000).toFixed(1)}K
                  </div>
                </div>
                <i className="pi pi-check-circle text-purple-600 text-4xl"></i>
              </div>
            </Card>
          </div>
          <div className="col-12 md:col-3">
            <Card className="bg-red-50">
              <div className="flex justify-content-between align-items-center">
                <div>
                  <div className="text-500 mb-2">Pending</div>
                  <div className="text-3xl font-bold text-red-600">
                    ₹{((stats.totalPending || 0) / 1000).toFixed(1)}K
                  </div>
                </div>
                <i className="pi pi-exclamation-circle text-red-600 text-4xl"></i>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid">
          <div className="col-12 md:col-3">
            <span className="p-float-label">
              <InputText
                id="uhid"
                value={filters.UHID}
                onChange={(e) => handleFilter("UHID", e.target.value)}
                className="w-full"
              />
              <label htmlFor="uhid">UHID</label>
            </span>
          </div>
          <div className="col-12 md:col-3">
            <span className="p-float-label">
              <InputText
                id="patientName"
                value={filters.patientName}
                onChange={(e) => handleFilter("patientName", e.target.value)}
                className="w-full"
              />
              <label htmlFor="patientName">Patient Name</label>
            </span>
          </div>
          <div className="col-12 md:col-3">
            <span className="p-float-label">
              <InputText
                id="billNumber"
                value={filters.billNumber}
                onChange={(e) => handleFilter("billNumber", e.target.value)}
                className="w-full"
              />
              <label htmlFor="billNumber">Bill Number</label>
            </span>
          </div>
          <div className="col-12 md:col-3">
            <Dropdown
              value={filters.status}
              options={statusOptions}
              onChange={(e) => handleFilter("status", e.value)}
              placeholder="Select Status"
              className="w-full"
            />
          </div>
          <div className="col-12 md:col-3">
            <Calendar
              value={filters.startDate}
              onChange={(e) => handleFilter("startDate", e.value)}
              placeholder="Start Date"
              dateFormat="dd/mm/yy"
              className="w-full"
            />
          </div>
          <div className="col-12 md:col-3">
            <Calendar
              value={filters.endDate}
              onChange={(e) => handleFilter("endDate", e.value)}
              placeholder="End Date"
              dateFormat="dd/mm/yy"
              className="w-full"
            />
          </div>
          <div className="col-12 md:col-6">
            <div className="flex gap-2">
              <Button
                label="Clear Filters"
                icon="pi pi-filter-slash"
                className="p-button-outlined"
                onClick={clearFilters}
              />
              <Button
                label="Refresh"
                icon="pi pi-refresh"
                onClick={loadBills}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Bills Table */}
      <Card>
        <DataTable
          value={bills}
          lazy
          paginator
          first={lazyParams.first}
          rows={lazyParams.rows}
          totalRecords={totalRecords}
          onPage={onPage}
          loading={loading}
          rowsPerPageOptions={[10, 20, 50]}
          emptyMessage="No bills found"
          responsiveLayout="scroll"
        >
          <Column
            field="billNumber"
            header="Bill No"
            body={(row) => row.billNumber || "DRAFT"}
          />
          <Column field="UHID" header="UHID" />
          <Column field="patientName" header="Patient Name" />
          <Column field="tpaName" header="TPA" />
          <Column field="billingType" header="Type" />
          <Column header="Date" body={dateBodyTemplate} />
          <Column header="Amount" body={amountBodyTemplate} />
          <Column header="Balance" body={balanceBodyTemplate} />
          <Column header="Status" body={statusBodyTemplate} />
          <Column header="Actions" body={actionBodyTemplate} />
        </DataTable>
      </Card>
    </div>
  );
};

export default BillsList;
