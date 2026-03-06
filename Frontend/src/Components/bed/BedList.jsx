import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { bedService } from "../../Services/bedService";
import { formatDateTime } from "../../utils/helpers";

const BedList = ({ onEdit, onRefresh, onBook, onView }) => {
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
      acceptClassName: "p-button-danger",
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
      <div className="flex align-items-center gap-2">
        {/* View */}
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          severity="info"
          size="small"
          onClick={() => onView && onView(rowData)}
          tooltip="View Details"
          tooltipOptions={{ position: "top" }}
        />

        {/* Book — only when Available */}
        {rowData.status === "Available" && (
          <Button
            icon="pi pi-calendar-plus"
            rounded
            outlined
            severity="success"
            size="small"
            onClick={() => onBook(rowData)}
            tooltip="Book Bed"
            tooltipOptions={{ position: "top" }}
          />
        )}

        {/* Edit */}
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="warning"
          size="small"
          onClick={() => onEdit(rowData)}
          tooltip="Edit"
          tooltipOptions={{ position: "top" }}
        />

        {/* Delete */}
        <Button
          icon="pi pi-trash"
          rounded
          outlined
          severity="danger"
          size="small"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
          tooltipOptions={{ position: "top" }}
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
    return (
      <Tag
        value={rowData.status}
        severity={getSeverity()}
        style={{ minWidth: "90px", justifyContent: "center" }}
      />
    );
  };

  const locationBodyTemplate = (rowData) => {
    return (
      <div className="flex flex-column gap-1 text-sm">
        <span>
          <i className="pi pi-building mr-1 text-primary" />
          <strong>Building:</strong> {rowData.buildingName}
        </span>
        <span>
          <i className="pi pi-th-large mr-1 text-primary" />
          <strong>Floor:</strong> {rowData.floorNumber}
        </span>
        <span>
          <i className="pi pi-heart mr-1 text-primary" />
          <strong>Ward:</strong> {rowData.wardName || "N/A"}
        </span>
        <span>
          <i className="pi pi-home mr-1 text-primary" />
          <strong>Room:</strong> {rowData.roomNumber}
        </span>
      </div>
    );
  };

  const dateBodyTemplate = (rowData) => (
    <span className="text-sm text-color-secondary">
      {formatDateTime(rowData.createdAt)}
    </span>
  );

  const bedNumberBodyTemplate = (rowData) => (
    <span className="font-semibold text-primary">{rowData.bedNumber}</span>
  );

  const bedTypeBodyTemplate = (rowData) => (
    <span className="font-medium">{rowData.bedType || "—"}</span>
  );

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
        stripedRows
        showGridlines
        size="small"
        emptyMessage="No beds found."
        sortMode="multiple"
        removableSort
        filterDisplay="menu"
        style={{ fontSize: "0.9rem" }}
        className="p-datatable-beds"
        paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
        currentPageReportTemplate="Showing {first} to {last} of {totalRecords} beds"
      >
        <Column
          field="bedNumber"
          header="Bed No."
          sortable
          filter
          filterPlaceholder="Search bed"
          body={bedNumberBodyTemplate}
          style={{ minWidth: "100px" }}
        />

        <Column
          field="bedType"
          header="Bed Type"
          sortable
          filter
          filterPlaceholder="Search type"
          body={bedTypeBodyTemplate}
          style={{ minWidth: "130px" }}
        />

        <Column
          header="Location"
          body={locationBodyTemplate}
          style={{ minWidth: "200px" }}
        />

        <Column
          field="status"
          header="Status"
          sortable
          filter
          filterPlaceholder="Filter status"
          body={statusBodyTemplate}
          style={{ minWidth: "130px", textAlign: "center" }}
        />

        <Column
          field="createdAt"
          header="Created At"
          sortable
          body={dateBodyTemplate}
          style={{ minWidth: "150px" }}
        />

        <Column
          header="Actions"
          body={actionBodyTemplate}
          style={{ minWidth: "180px", textAlign: "center" }}
          frozen
          alignFrozen="right"
        />
      </DataTable>
    </>
  );
};

export default BedList;
