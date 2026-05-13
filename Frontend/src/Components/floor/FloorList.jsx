import React, { useState, useEffect, useMemo, useRef } from "react";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { floorService } from "../../Services/floorService";
import { formatDateTime } from "../../utils/helpers";
import {
  BmEmpty, BmPill, BmIconBtn,
  BmAvatar, BmCellStack, BmChip,
} from "../bed/BedPrimitives";
import "../bed/bed-mgmt.css";

/**
 * Modern bm-table view of all floors. Filter string can be passed
 * from the parent page (FloorManagement) via the `globalFilter` prop
 * so the bm-card header search box drives the rows here.
 */
const FloorList = ({ onEdit, onRefresh, globalFilter = "" }) => {
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const fetchFloors = async () => {
      setLoading(true);
      try {
        const data = await floorService.getAllFloors();
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : data?.data || data?.floors || [];
        setFloors(arr);
      } catch (error) {
        if (!cancelled) {
          toast.current?.show({
            severity: "error", summary: "Error",
            detail: "Failed to load floors", life: 3000,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchFloors();
    return () => { cancelled = true; };
  }, [onRefresh]);

  const handleDelete = (floor) => {
    confirmDialog({
      message: `Delete floor "${floor.floorName || `Floor ${floor.floorNumber}`}"?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await floorService.deleteFloor(floor._id);
          toast.current?.show({
            severity: "success", summary: "Deleted",
            detail: "Floor removed", life: 2500,
          });
          // bump local copy
          setFloors((prev) => prev.filter((f) => f._id !== floor._id));
        } catch {
          toast.current?.show({
            severity: "error", summary: "Error",
            detail: "Failed to delete floor", life: 3000,
          });
        }
      },
    });
  };

  const filtered = useMemo(() => {
    const q = (globalFilter || "").trim().toLowerCase();
    if (!q) return floors;
    return floors.filter((f) =>
      String(f.floorNumber || "").toLowerCase().includes(q) ||
      (f.floorName || "").toLowerCase().includes(q) ||
      (f.building?.buildingName || f.buildingName || "").toLowerCase().includes(q)
    );
  }, [floors, globalFilter]);

  return (
    <>
      <Toast ref={toast} />
      <ConfirmDialog />

      {loading ? (
        <BmEmpty icon="pi-spin pi-spinner" title="Loading floors…" />
      ) : filtered.length === 0 ? (
        <BmEmpty
          icon={floors.length === 0 ? "pi-arrows-v" : "pi-search"}
          title={floors.length === 0 ? "No floors yet" : "No matches"}
          msg={floors.length === 0
            ? "Add your first floor inside a building. Wards and rooms sit on top of these."
            : "Try a different search term."}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="bm-table">
            <thead>
              <tr>
                <th>Floor</th>
                <th>Building</th>
                <th>Capacity</th>
                <th>Status</th>
                <th>Created</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const totalWards = Number(f.totalWards || f.wardCount) || 0;
                const totalRooms = Number(f.totalRooms || f.roomCount) || 0;
                const buildingName =
                  f.building?.buildingName || f.buildingName || "—";
                return (
                  <tr key={f._id}>
                    <td>
                      <BmCellStack
                        avatar={
                          <BmAvatar
                            icon="pi-arrows-v"
                            tone="orange"
                            label={String(f.floorNumber ?? "")}
                          />
                        }
                        title={f.floorName || `Floor ${f.floorNumber}`}
                        sub={`Floor ${f.floorNumber ?? "—"}`}
                      />
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <i className="pi pi-building" style={{ fontSize: 11, color: "#0891b2" }} />
                        {buildingName}
                      </span>
                    </td>
                    <td>
                      {totalWards === 0 && totalRooms === 0 ? (
                        <span className="muted">empty</span>
                      ) : (
                        <div className="bm-chip-row">
                          {totalWards > 0 && (
                            <BmChip icon="pi-home">
                              {totalWards} ward{totalWards === 1 ? "" : "s"}
                            </BmChip>
                          )}
                          {totalRooms > 0 && (
                            <BmChip icon="pi-box">
                              {totalRooms} room{totalRooms === 1 ? "" : "s"}
                            </BmChip>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {f.isActive === false ? (
                        <BmPill tone="danger" icon="pi-times">Inactive</BmPill>
                      ) : (
                        <BmPill tone="ok" icon="pi-check">Active</BmPill>
                      )}
                    </td>
                    <td>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {f.createdAt ? formatDateTime(f.createdAt) : "—"}
                      </span>
                    </td>
                    <td className="right">
                      <div className="bm-row-actions">
                        <BmIconBtn icon="pi-pencil" variant="info" title="Edit"
                          onClick={() => onEdit(f)} />
                        <BmIconBtn icon="pi-trash" variant="danger" title="Delete"
                          onClick={() => handleDelete(f)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default FloorList;
