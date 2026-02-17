import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { hospitalChargesService } from "../../Services/charges/hospitalChargesService";

// PrimeReact Imports
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";

function HospitalChargesList() {
  const navigate = useNavigate();
  const toast = useRef(null);
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState(null);

  // ✅ View Modal State
  const [viewDialogVisible, setViewDialogVisible] = useState(false);
  const [selectedCharges, setSelectedCharges] = useState(null);

  const statusOptions = [
    { label: "All", value: null },
    { label: "Active", value: true },
    { label: "Inactive", value: false },
  ];

  useEffect(() => {
    loadCharges();
  }, [searchTerm, filterActive]);

  const loadCharges = async () => {
    try {
      setLoading(true);
      const filters = {};

      if (searchTerm) filters.search = searchTerm;
      if (filterActive !== null) filters.isActive = filterActive;

      const data = await hospitalChargesService.getAllHospitalCharges(filters);
      setCharges(data);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load hospital charges",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  // ✅ View Charges Handler
  const handleViewCharges = (rowData) => {
    setSelectedCharges(rowData);
    setViewDialogVisible(true);
  };

  const handleToggleStatus = async (id) => {
    try {
      await hospitalChargesService.toggleActiveStatus(id);
      toast.current.show({
        severity: "success",
        summary: "Success",
        detail: "Status updated successfully",
        life: 3000,
      });
      loadCharges();
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to toggle status",
        life: 3000,
      });
    }
  };

  const confirmDelete = (id) => {
    confirmDialog({
      message: "Are you sure you want to delete this?",
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: () => handleDelete(id),
      reject: () => {},
    });
  };

  const handleDelete = async (id) => {
    try {
      await hospitalChargesService.deleteHospitalCharges(id);
      toast.current.show({
        severity: "success",
        summary: "Success",
        detail: "Hospital charges deleted successfully",
        life: 3000,
      });
      loadCharges();
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to delete hospital charges",
        life: 3000,
      });
    }
  };

  const statusBodyTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
      />
    );
  };

  const chargesCountBodyTemplate = (rowData) => {
    return <span>{rowData.charges?.length || 0} charges</span>;
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        {/* ✅ View Button */}
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          className="p-button-sm"
          style={{ color: "#10B981", borderColor: "#10B981" }}
          onClick={() => handleViewCharges(rowData)}
          tooltip="View Details"
          tooltipOptions={{ position: "top" }}
        />
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          className="p-button-sm"
          style={{ color: "#4F46E5", borderColor: "#4F46E5" }}
          onClick={() => navigate(`/hospital-charges/edit/${rowData._id}`)}
          tooltip="Edit"
          tooltipOptions={{ position: "top" }}
        />
        <Button
          icon={rowData.isActive ? "pi pi-ban" : "pi pi-check"}
          rounded
          outlined
          className="p-button-sm"
          style={{ color: "#F59E0B", borderColor: "#F59E0B" }}
          onClick={() => handleToggleStatus(rowData._id)}
          tooltip={rowData.isActive ? "Deactivate" : "Activate"}
          tooltipOptions={{ position: "top" }}
        />
        <Button
          icon="pi pi-trash"
          rounded
          outlined
          className="p-button-sm"
          style={{ color: "#EF4444", borderColor: "#EF4444" }}
          onClick={() => confirmDelete(rowData._id)}
          tooltip="Delete"
          tooltipOptions={{ position: "top" }}
        />
      </div>
    );
  };

  const header = (
    <div className="flex flex-wrap gap-3 align-items-center justify-content-between">
      <h2 className="m-0" style={{ color: "#1F2937", fontWeight: "600" }}>
        Hospital Charges
      </h2>
      <div className="flex gap-2">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by TPA..."
            className="p-inputtext-sm"
          />
        </span>
        <Dropdown
          value={filterActive}
          options={statusOptions}
          onChange={(e) => setFilterActive(e.value)}
          placeholder="Filter Status"
          className="p-inputtext-sm"
        />
        <Button
          label="Add New"
          icon="pi pi-plus"
          style={{ backgroundColor: "#4F46E5", borderColor: "#4F46E5" }}
          onClick={() => navigate("/hospital-charges/create")}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F9FAFB",
      }}
    >
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* ✅ Main Card - Compact & Clean */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          padding: "1rem", // ✅ Reduced padding
          minHeight: "100vh",
        }}
      >
        <DataTable
          value={charges}
          loading={loading}
          header={header}
          paginator
          rows={10}
          rowsPerPageOptions={[5, 10, 25, 50]}
          dataKey="_id"
          emptyMessage="No hospital charges found"
          stripedRows // ✅ Added zebra stripes
          size="small" // ✅ Compact table
          responsiveLayout="scroll"
        >
          <Column
            field="tpaName"
            header="TPA Name"
            sortable
            style={{ minWidth: "200px" }}
          />
          <Column
            field="tpaCode"
            header="TPA Code"
            sortable
            style={{ minWidth: "150px" }}
          />
          <Column
            header="Total Charges"
            body={chargesCountBodyTemplate}
            sortable
            style={{ minWidth: "150px" }}
          />
          <Column
            header="Status"
            body={statusBodyTemplate}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            header="Actions"
            body={actionBodyTemplate}
            style={{ minWidth: "200px" }}
          />
        </DataTable>
      </div>

      {/* ✅ View Charges Modal */}
      <Dialog
        header={
          <div>
            <h3 className="m-0" style={{ color: "#1F2937" }}>
              Hospital Charges Details
            </h3>
            {selectedCharges && (
              <p
                className="mt-2 mb-0"
                style={{ color: "#6B7280", fontSize: "14px" }}
              >
                TPA: {selectedCharges.tpaName} ({selectedCharges.tpaCode})
              </p>
            )}
          </div>
        }
        visible={viewDialogVisible}
        maximizable
        style={{
          width: "95vw",
          maxWidth: "none",
        }}
        contentStyle={{
          maxHeight: "calc(100vh - 200px)",
          overflowY: "auto",
          padding: "1.5rem", // ✅ Better padding
        }}
        onHide={() => setViewDialogVisible(false)}
        modal
        draggable={false}
      >
        {selectedCharges && (
          <div>
            {/* TPA Info Section */}
            <div
              className="grid mb-4 p-3"
              style={{
                backgroundColor: "#F9FAFB",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
              }}
            >
              <div className="col-12 md:col-6 lg:col-3">
                <p
                  className="mb-1"
                  style={{
                    color: "#6B7280",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                >
                  TPA NAME
                </p>
                <p
                  className="m-0"
                  style={{
                    fontWeight: "600",
                    color: "#1F2937",
                    fontSize: "14px",
                  }}
                >
                  {selectedCharges.tpaName}
                </p>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <p
                  className="mb-1"
                  style={{
                    color: "#6B7280",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                >
                  TPA CODE
                </p>
                <p
                  className="m-0"
                  style={{
                    fontWeight: "600",
                    color: "#1F2937",
                    fontSize: "14px",
                  }}
                >
                  {selectedCharges.tpaCode}
                </p>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <p
                  className="mb-1"
                  style={{
                    color: "#6B7280",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                >
                  TOTAL CHARGES
                </p>
                <p
                  className="m-0"
                  style={{
                    fontWeight: "600",
                    color: "#1F2937",
                    fontSize: "14px",
                  }}
                >
                  {selectedCharges.charges?.length || 0} charges
                </p>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <p
                  className="mb-1"
                  style={{
                    color: "#6B7280",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                >
                  STATUS
                </p>
                <Tag
                  value={selectedCharges.isActive ? "Active" : "Inactive"}
                  severity={selectedCharges.isActive ? "success" : "danger"}
                />
              </div>
            </div>

            {/* Charges List */}
            <div>
              <h4
                className="mb-3"
                style={{
                  color: "#374151",
                  fontSize: "16px",
                  fontWeight: "600",
                }}
              >
                Charges List ({selectedCharges.charges?.length || 0})
              </h4>

              {selectedCharges.charges && selectedCharges.charges.length > 0 ? (
                <div className="flex flex-column gap-3">
                  {selectedCharges.charges.map((charge, index) => (
                    <div
                      key={index}
                      style={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        padding: "1rem",
                      }}
                    >
                      <div className="grid">
                        <div className="col-12 md:col-6 lg:col-4">
                          <p
                            className="mb-1"
                            style={{
                              color: "#6B7280",
                              fontSize: "11px",
                              fontWeight: "500",
                              textTransform: "uppercase",
                            }}
                          >
                            Charge Name
                          </p>
                          <p
                            className="m-0"
                            style={{
                              fontWeight: "600",
                              color: "#1F2937",
                              fontSize: "14px",
                            }}
                          >
                            {charge.chargeName}
                          </p>
                        </div>
                        <div className="col-12 md:col-6 lg:col-2">
                          <p
                            className="mb-1"
                            style={{
                              color: "#6B7280",
                              fontSize: "11px",
                              fontWeight: "500",
                              textTransform: "uppercase",
                            }}
                          >
                            Charge Type
                          </p>
                          <Tag value={charge.chargeType} severity="info" />
                        </div>
                        <div className="col-12 md:col-4 lg:col-2">
                          <p
                            className="mb-1"
                            style={{
                              color: "#6B7280",
                              fontSize: "11px",
                              fontWeight: "500",
                              textTransform: "uppercase",
                            }}
                          >
                            Amount
                          </p>
                          <p
                            className="m-0"
                            style={{
                              fontWeight: "600",
                              color: "#059669",
                              fontSize: "14px",
                            }}
                          >
                            ₹{charge.amount?.toLocaleString("en-IN") || 0}
                          </p>
                        </div>
                        <div className="col-12 md:col-4 lg:col-2">
                          <p
                            className="mb-1"
                            style={{
                              color: "#6B7280",
                              fontSize: "11px",
                              fontWeight: "500",
                              textTransform: "uppercase",
                            }}
                          >
                            Discount
                          </p>
                          <p
                            className="m-0"
                            style={{
                              fontWeight: "600",
                              color: "#DC2626",
                              fontSize: "14px",
                            }}
                          >
                            {charge.discount || 0}%
                          </p>
                        </div>
                        <div className="col-12 md:col-4 lg:col-2">
                          <p
                            className="mb-1"
                            style={{
                              color: "#6B7280",
                              fontSize: "11px",
                              fontWeight: "500",
                              textTransform: "uppercase",
                            }}
                          >
                            Per Unit
                          </p>
                          <Tag value={charge.perUnit} severity="warning" />
                        </div>
                        <div className="col-12 md:col-12 lg:col-12">
                          <div
                            style={{
                              marginTop: "0.5rem",
                              paddingTop: "0.75rem",
                              borderTop: "1px dashed #E5E7EB",
                            }}
                          >
                            <p
                              className="mb-1"
                              style={{
                                color: "#6B7280",
                                fontSize: "11px",
                                fontWeight: "500",
                                textTransform: "uppercase",
                              }}
                            >
                              Total Amount (After Discount)
                            </p>
                            <p
                              className="m-0"
                              style={{
                                fontWeight: "700",
                                color: "#4F46E5",
                                fontSize: "18px",
                              }}
                            >
                              ₹
                              {charge.totalAmount?.toLocaleString("en-IN") || 0}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="text-center p-5"
                  style={{
                    backgroundColor: "#F9FAFB",
                    borderRadius: "8px",
                    border: "1px dashed #D1D5DB",
                  }}
                >
                  <i
                    className="pi pi-inbox"
                    style={{ fontSize: "3rem", color: "#9CA3AF" }}
                  ></i>
                  <p
                    className="mt-3 mb-0"
                    style={{ color: "#6B7280", fontSize: "14px" }}
                  >
                    No charges found
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default HospitalChargesList;
