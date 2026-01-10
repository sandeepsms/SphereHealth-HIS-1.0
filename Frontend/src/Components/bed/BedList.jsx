import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { bedService } from "../../services/bedService";
import { formatDateTime, formatCurrency } from "../../utils/helpers";
import { BED_STATUS_COLORS } from "../../utils/constants";

const BedList = ({ onEdit, onRefresh, onBook }) => {
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  useEffect(() => {
    fetchBeds();
  }, [onRefresh]);

  const fetchBeds = async () => {
    setLoading(true);
    try {
      const data = await bedService.getAllBeds();
      setBeds(data);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load beds",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (bed) => {
    confirmDialog({
      message: `Are you sure you want to delete Bed ${bed.bedNumber}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await bedService.deleteBed(bed._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Bed deleted successfully",
            life: 3000,
          });
          fetchBeds();
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete bed",
            life: 3000,
          });
        }
      },
    });
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", gap: "5px" }}>
        {rowData.status === "Available" && (
          <Button
            icon="pi pi-calendar-plus"
            className="p-button-rounded p-button-text p-button-success"
            onClick={() => onBook(rowData)}
            tooltip="Book Bed"
          />
        )}
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-text p-button-info"
          onClick={() => onEdit(rowData)}
          tooltip="Edit"
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-text p-button-danger"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
        />
      </div>
    );
  };

  const statusBodyTemplate = (rowData) => {
    const getSeverity = () => {
      switch (rowData.status) {
        case "Available":
          return "success";
        case "Occupied":
          return "danger";
        case "Maintenance":
          return "warning";
        case "Blocked":
          return "secondary";
        case "Reserved":
          return "info";
        default:
          return "secondary";
      }
    };

    return <Tag value={rowData.status} severity={getSeverity()} />;
  };

  const priceBodyTemplate = (rowData) => {
    return formatCurrency(rowData.pricing?.perBedDailyRate || 0);
  };

  const locationBodyTemplate = (rowData) => {
    return (
      <div>
        <div>
          <strong>Building:</strong> {rowData.buildingName}
        </div>
        <div>
          <strong>Floor:</strong> {rowData.floorNumber}
        </div>
        <div>
          <strong>Ward:</strong> {rowData.wardName || "N/A"}
        </div>
        <div>
          <strong>Room:</strong> {rowData.roomNumber}
        </div>
      </div>
    );
  };

  const dateBodyTemplate = (rowData) => {
    return formatDateTime(rowData.createdAt);
  };

  return (
    <>
      <Toast ref={toast} />
      <ConfirmDialog />
      <DataTable
        value={beds}
        loading={loading}
        paginator
        rows={10}
        rowsPerPageOptions={[5, 10, 25, 50]}
        tableStyle={{ minWidth: "50rem" }}
        emptyMessage="No beds found"
        stripedRows
      >
        <Column field="bedNumber" header="Bed Number" sortable />
        <Column header="Location" body={locationBodyTemplate} />
        <Column
          field="status"
          header="Status"
          body={statusBodyTemplate}
          sortable
        />
        <Column header="Daily Rate" body={priceBodyTemplate} sortable />
        <Column
          field="createdAt"
          header="Created At"
          body={dateBodyTemplate}
          sortable
        />
        <Column
          header="Actions"
          body={actionBodyTemplate}
          style={{ width: "150px" }}
        />
      </DataTable>
    </>
  );
};

export default BedList;
