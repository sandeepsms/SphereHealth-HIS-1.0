import React, { useState, useEffect } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { bedService } from "../../Services/bedService";
import { wardService } from "../../Services/wardService";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";

const labelStyle = {
  display: "block",
  marginBottom: 4,
  fontSize: 12,
  fontWeight: 500,
  color: "#4b5563",
};

const Stat = ({ label, value, color }) => (
  <div style={{ fontSize: 13, color: "#6b7280" }}>
    {label}: <strong style={{ color, fontWeight: 600 }}>{value}</strong>
  </div>
);

const BedVisualLayout = () => {
  const [beds, setBeds] = useState([]);
  const [filteredBeds, setFilteredBeds] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [wards, setWards] = useState([]);
  const [rooms, setRooms] = useState([]);

  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [selectedWard, setSelectedWard] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);

  const [loading, setLoading] = useState(false);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedBed, setSelectedBed] = useState(null);

  // Patient data - Ye aap API se fetch kar sakte ho
  const patientData = {
    UHID: "UH2024001",
    patientId: "PAT001",
    fullName: "Rahul Kumar",
    fatherName: "Suresh Kumar",
    dateOfBirth: "1998-05-15",
    gender: "Male",
    maritalStatus: "Single",
    contactNumber: "9876543210",
    alternateContact: "9123456789",
    email: "rahul.kumar@example.com",
    address: {
      street: "MG Road",
      city: "Lucknow",
      state: "Uttar Pradesh",
      pincode: "226001",
      completeAddress: "MG Road, Near Hanuman Mandir, Lucknow",
    },
    emergencyContact: {
      name: "Anita Kumar",
      relationship: "Mother",
      phone: "9988776655",
    },
    bloodGroup: "O+",
    knownAllergies: ["Penicillin"],
    chronicConditions: ["Diabetes"],
    currentMedications: ["Metformin"],
    pastSurgicalHistory: "Appendix surgery in 2015",
    familyHistory: "Father has hypertension",
  };

  const [bookingData, setBookingData] = useState({
    UHID: "",
    patientId: "",
    patientName: "",
    admissionDate: new Date().toISOString().split("T")[0],
    expectedDischargeDate: "",
    department: "General Medicine",
    reasonForAdmission: "",
    contactNumber: "",
    bloodGroup: "",
    email: "",
  });

  const toast = React.useRef(null);

  const departments = [
    "Cardiology",
    "Neurology",
    "Orthopedics",
    "General Medicine",
    "General Surgery",
    "Pediatrics",
    "ICU",
    "Emergency Medicine",
  ];

  // ----------------- LOADERS -----------------
  useEffect(() => {
    loadBuildings();
    loadBeds();
  }, []);

  useEffect(() => {
    if (selectedBuilding) {
      loadFloors();
    } else {
      setFloors([]);
      setSelectedFloor(null);
    }
  }, [selectedBuilding]);

  useEffect(() => {
    if (selectedFloor) {
      loadWards();
      loadRooms();
    } else {
      setWards([]);
      setRooms([]);
      setSelectedWard(null);
      setSelectedRoom(null);
    }
  }, [selectedFloor]);

  useEffect(() => {
    filterBeds();
  }, [beds, selectedBuilding, selectedFloor, selectedWard, selectedRoom]);

  const loadBuildings = async () => {
    try {
      const response = await buildingService.getAllBuildings();
      const data = response.data || response || [];
      setBuildings(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading buildings:", error);
      setBuildings([]);
    }
  };

  const loadFloors = async () => {
    try {
      const response = await floorService.getAllFloors();
      const data = response.data || response || [];
      const filtered = Array.isArray(data)
        ? data.filter((f) => {
            const floorBuildingId =
              typeof f.building === "object" ? f.building._id : f.building;
            return String(floorBuildingId) === String(selectedBuilding);
          })
        : [];
      setFloors(filtered);
    } catch (error) {
      console.error("Error loading floors:", error);
      setFloors([]);
    }
  };

  const loadWards = async () => {
    try {
      const response = await wardService.getAllWards();
      const data = response.data || response || [];
      const filtered = Array.isArray(data)
        ? data.filter((w) => {
            const wardFloorId =
              typeof w.floor === "object" ? w.floor._id : w.floor;
            return String(wardFloorId) === String(selectedFloor);
          })
        : [];
      setWards(filtered);
    } catch (error) {
      console.error("Error loading wards:", error);
      setWards([]);
    }
  };

  const loadRooms = async () => {
    try {
      const response = await roomService.getAllRooms();
      const data = response.data || response || [];
      const filtered = Array.isArray(data)
        ? data.filter((r) => {
            const roomFloorId =
              typeof r.floor === "object" ? r.floor._id : r.floor;
            return String(roomFloorId) === String(selectedFloor);
          })
        : [];
      setRooms(filtered);
    } catch (error) {
      console.error("Error loading rooms:", error);
      setRooms([]);
    }
  };

  const loadBeds = async () => {
    setLoading(true);
    try {
      const response = await bedService.getAllBeds();
      let bedsArray = [];
      if (Array.isArray(response)) bedsArray = response;
      else if (response?.data && Array.isArray(response.data))
        bedsArray = response.data;
      else if (response?.beds && Array.isArray(response.beds))
        bedsArray = response.beds;

      setBeds(bedsArray);
      setFilteredBeds(bedsArray);
    } catch (error) {
      console.error("Error loading beds:", error);
      setBeds([]);
      setFilteredBeds([]);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load beds",
      });
    } finally {
      setLoading(false);
    }
  };

  // ----------------- FILTER -----------------
  const filterBeds = () => {
    if (!Array.isArray(beds)) {
      setFilteredBeds([]);
      return;
    }

    let filtered = [...beds];

    if (selectedBuilding) {
      filtered = filtered.filter((bed) => {
        const bedBuildingId =
          typeof bed.building === "object" ? bed.building._id : bed.building;
        return String(bedBuildingId) === String(selectedBuilding);
      });
    }

    if (selectedFloor) {
      filtered = filtered.filter((bed) => {
        const bedFloorId =
          typeof bed.floor === "object" ? bed.floor._id : bed.floor;
        return String(bedFloorId) === String(selectedFloor);
      });
    }

    if (selectedWard) {
      filtered = filtered.filter((bed) => {
        const bedWardId =
          typeof bed.ward === "object" ? bed.ward._id : bed.ward;
        return bedWardId && String(bedWardId) === String(selectedWard);
      });
    }

    if (selectedRoom) {
      filtered = filtered.filter((bed) => {
        const bedRoomId =
          typeof bed.room === "object" ? bed.room._id : bed.room;
        return String(bedRoomId) === String(selectedRoom);
      });
    }

    setFilteredBeds(filtered);
  };

  // ----------------- GROUPING BY ROOM ID -----------------
  const groupBedsByRoom = () => {
    const grouped = {};
    if (!Array.isArray(filteredBeds)) return grouped;

    filteredBeds.forEach((bed) => {
      const roomId = typeof bed.room === "object" ? bed.room._id : bed.room;
      const roomNumber = bed.roomNumber || bed.room?.roomNumber || "Unknown";
      const roomName =
        bed.roomName || bed.room?.roomName || `Room ${roomNumber}`;

      if (!grouped[roomId]) {
        grouped[roomId] = {
          roomId: roomId,
          roomName: roomName,
          roomNumber: roomNumber,
          floorNumber: bed.floorNumber || bed.floor?.floorNumber || "N/A",
          beds: [],
        };
      }
      grouped[roomId].beds.push(bed);
    });

    return grouped;
  };

  // ----------------- UI HELPERS -----------------
  const getBedColor = (status) => {
    switch (status) {
      case "Available":
        return "#22c55e";
      case "Occupied":
        return "#ef4444";
      case "Maintenance":
        return "#fbbf24";
      case "Reserved":
        return "#3b82f6";
      case "Blocked":
        return "#9ca3af";
      default:
        return "#d1d5db";
    }
  };

  const handleBedClick = (bed) => {
    if (bed.status === "Available") {
      setSelectedBed(bed);

      // Patient data automatically fill ho jayega
      setBookingData({
        UHID: patientData.UHID,
        patientId: patientData.patientId,
        patientName: patientData.fullName,
        admissionDate: new Date().toISOString().split("T")[0],
        expectedDischargeDate: "",
        department: "General Medicine",
        reasonForAdmission: "",
        contactNumber: patientData.contactNumber,
        bloodGroup: patientData.bloodGroup,
        email: patientData.email,
      });

      setShowBookingModal(true);
    } else {
      toast.current?.show({
        severity: "warn",
        summary: "Unavailable",
        detail: `This bed is ${bed.status}`,
        life: 2000,
      });
    }
  };

  const handleBookBed = async () => {
    try {
      await bedService.bookBed(selectedBed._id, bookingData);
      toast.current?.show({
        severity: "success",
        summary: "Success",
        detail: "Bed booked successfully",
      });
      setShowBookingModal(false);
      loadBeds();
      setBookingData({
        UHID: "",
        patientId: "",
        patientName: "",
        admissionDate: new Date().toISOString().split("T")[0],
        expectedDischargeDate: "",
        department: "General Medicine",
        reasonForAdmission: "",
        contactNumber: "",
        bloodGroup: "",
        email: "",
      });
    } catch (error) {
      console.error("Error booking bed:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to book bed",
      });
    }
  };

  const resetFilters = () => {
    setSelectedBuilding(null);
    setSelectedFloor(null);
    setSelectedWard(null);
    setSelectedRoom(null);
  };

  const stats = {
    total: filteredBeds.length,
    available: filteredBeds.filter((b) => b.status === "Available").length,
    occupied: filteredBeds.filter((b) => b.status === "Occupied").length,
  };

  const groupedBeds = groupBedsByRoom();

  // ----------------- RENDER -----------------
  return (
    <div
      style={{
        background: "#f3f4f6",
        minHeight: "100vh",
        marginTop: "70px",
      }}
    >
      <Toast ref={toast} />

      {/* HEADER */}
      <div
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          padding: "16px 24px",
          position: "sticky",
          top: 70,
          zIndex: 5,
        }}
      >
        <div className="flex justify-content-between align-items-center">
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                color: "#111827",
              }}
            >
              Bed Management System
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "#6b7280",
                marginTop: 2,
              }}
            >
              Select available beds for booking
            </p>
          </div>
          <Button
            icon="pi pi-refresh"
            label="Refresh"
            onClick={loadBeds}
            loading={loading}
            className="p-button-sm p-button-outlined"
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      {/* FILTERS */}
      <div
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          padding: "14px 24px 10px",
        }}
      >
        <div className="grid">
          <div className="col-3">
            <label style={labelStyle}>Building</label>
            <Dropdown
              value={selectedBuilding}
              options={(buildings || []).map((b) => ({
                label: b.buildingName,
                value: b._id,
              }))}
              onChange={(e) => {
                setSelectedBuilding(e.value);
                setSelectedFloor(null);
                setSelectedWard(null);
                setSelectedRoom(null);
              }}
              placeholder="All buildings"
              showClear
              className="w-full p-inputtext-sm"
            />
          </div>

          <div className="col-3">
            <label style={labelStyle}>Floor</label>
            <Dropdown
              value={selectedFloor}
              options={(floors || []).map((f) => ({
                label: f.floorName || `Floor ${f.floorNumber}`,
                value: f._id,
              }))}
              onChange={(e) => {
                setSelectedFloor(e.value);
                setSelectedWard(null);
                setSelectedRoom(null);
              }}
              placeholder="All floors"
              showClear
              className="w-full p-inputtext-sm"
              disabled={!selectedBuilding}
            />
          </div>

          <div className="col-3">
            <label style={labelStyle}>Ward</label>
            <Dropdown
              value={selectedWard}
              options={(wards || []).map((w) => ({
                label: w.wardName,
                value: w._id,
              }))}
              onChange={(e) => setSelectedWard(e.value)}
              placeholder="All wards"
              showClear
              className="w-full p-inputtext-sm"
              disabled={!selectedFloor}
            />
          </div>

          <div className="col-3">
            <label style={labelStyle}>Room</label>
            <Dropdown
              value={selectedRoom}
              options={(rooms || []).map((r) => ({
                label: r.roomNumber,
                value: r._id,
              }))}
              onChange={(e) => setSelectedRoom(e.value)}
              placeholder="All rooms"
              showClear
              className="w-full p-inputtext-sm"
              disabled={!selectedFloor}
            />
          </div>
        </div>

        <div
          className="flex justify-content-end gap-2"
          style={{ marginTop: 6 }}
        >
          <Button
            label="Clear Filters"
            className="p-button-text p-button-sm"
            icon="pi pi-filter-slash"
            onClick={resetFilters}
          />
        </div>
      </div>

      {/* STATS */}
      <div
        style={{
          background: "#f9fafb",
          padding: "10px 24px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div className="flex gap-4">
          <Stat label="Total" value={stats.total} color="#111827" />
          <Stat label="Available" value={stats.available} color="#16a34a" />
          <Stat label="Occupied" value={stats.occupied} color="#6b7280" />
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px" }}>
            <i
              className="pi pi-spin pi-spinner"
              style={{ fontSize: 32, color: "#6b7280" }}
            />
          </div>
        ) : Object.keys(groupedBeds).length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "60px", color: "#6b7280" }}
          >
            <i
              className="pi pi-inbox"
              style={{
                fontSize: 48,
                marginBottom: 16,
                display: "block",
              }}
            />
            <p style={{ fontSize: 16 }}>No beds found</p>
            <Button
              label="Reset Filters"
              onClick={resetFilters}
              className="p-button-sm p-button-outlined mt-3"
            />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "20px",
            }}
          >
            {Object.entries(groupedBeds).map(([roomId, roomData]) => (
              <div
                key={roomId}
                style={{
                  borderRadius: 0,
                  overflow: "hidden",
                  background: "#ffffff",
                  boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                  border: "1px solid #e5e7eb",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 180,
                }}
              >
                {/* Room header */}
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #0f766e 0%, #14b8a6 60%, #22c55e 100%)",
                    padding: "12px 16px",
                    color: "#ecfdf5",
                  }}
                >
                  <div className="flex justify-content-between align-items-center">
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          textTransform: "uppercase",
                          opacity: 0.9,
                          fontWeight: 500,
                        }}
                      >
                        Floor {roomData.floorNumber}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          letterSpacing: 0.3,
                        }}
                      >
                        {roomData.roomName}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#064e3b",
                        background: "#bbf7d0",
                        padding: "4px 12px",
                        borderRadius: 9999,
                        border: "1px solid #86efac",
                        fontWeight: 700,
                      }}
                    >
                      {roomData.beds.length} beds
                    </span>
                  </div>
                </div>

                {/* Bed grid */}
                <div
                  style={{
                    padding: "12px 8px 12px 8px",
                    display: "grid",
                    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                    gap: "8px",
                    justifyItems: "center",
                  }}
                >
                  {roomData.beds.map((bed) => {
                    const isAvailable = bed.status === "Available";
                    const borderColor = getBedColor(bed.status);
                    // Database se actual bedNumber use karo
                    const label = bed.bedNumber || "N/A";

                    return (
                      <button
                        key={bed._id}
                        type="button"
                        onClick={() => handleBedClick(bed)}
                        style={{
                          width: "100%",
                          height: 52,
                          background: "#ffffff",
                          borderRadius: 6,
                          border: `2px solid ${borderColor}`,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: isAvailable ? "pointer" : "not-allowed",
                          padding: "6px 4px",
                          fontWeight: 700,
                          color: "#0f172a",
                          transition: "all 0.15s ease",
                          outline: "none",
                          gap: 2,
                        }}
                        onMouseEnter={(e) => {
                          if (isAvailable) {
                            e.currentTarget.style.transform =
                              "translateY(-2px)";
                            e.currentTarget.style.boxShadow =
                              "0 6px 16px rgba(15,118,110,0.25)";
                            e.currentTarget.style.background = "#ecfdf5";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "translateY(0)";
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.background = "#ffffff";
                        }}
                        title={`${label} - ${bed.status}`}
                      >
                        <svg
                          width="18"
                          height="12"
                          viewBox="0 0 18 12"
                          fill="none"
                          style={{ marginBottom: 1 }}
                        >
                          <rect
                            x="1"
                            y="0"
                            width="16"
                            height="4"
                            rx="1"
                            fill={borderColor}
                          />
                          <rect
                            x="2"
                            y="3"
                            width="14"
                            height="6"
                            rx="1"
                            fill={borderColor}
                            opacity="0.8"
                          />
                          <circle
                            cx="4"
                            cy="11"
                            r="1.5"
                            fill={borderColor}
                            opacity="0.6"
                          />
                          <circle
                            cx="14"
                            cy="11"
                            r="1.5"
                            fill={borderColor}
                            opacity="0.6"
                          />
                        </svg>

                        <span
                          style={{
                            fontSize: 11,
                            letterSpacing: 0.5,
                            fontWeight: 800,
                          }}
                        >
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LEGEND */}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          background: "#ffffff",
          padding: "12px 16px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#4b5563",
            marginBottom: 8,
          }}
        >
          Legend
        </div>
        {[
          { label: "Available", color: "#22c55e" },
          { label: "Occupied", color: "#ef4444" },
          { label: "Maintenance", color: "#fbbf24" },
          { label: "Reserved", color: "#3b82f6" },
          { label: "Blocked", color: "#9ca3af" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex align-items-center gap-2"
            style={{ marginBottom: 4 }}
          >
            <div
              style={{
                width: 16,
                height: 14,
                background: "#ffffff",
                borderRadius: 3,
                border: `1.5px solid ${item.color}`,
              }}
            />
            <span style={{ fontSize: 11, color: "#4b5563" }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* BOOKING MODAL - COMPLETELY UPDATED */}
      <Dialog
        visible={showBookingModal}
        style={{ width: "650px" }}
        header="Book Bed"
        modal
        onHide={() => setShowBookingModal(false)}
      >
        {selectedBed && (
          <div>
            {/* Bed Information */}
            <div
              style={{
                background: "linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)",
                padding: 14,
                borderRadius: 8,
                marginBottom: 20,
                color: "#ffffff",
              }}
            >
              <div className="grid">
                <div className="col-4">
                  <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 4 }}>
                    Bed Number
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {selectedBed.bedNumber || "N/A"}
                  </div>
                </div>
                <div className="col-4">
                  <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 4 }}>
                    Room Number
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {selectedBed.roomNumber ||
                      selectedBed.room?.roomNumber ||
                      "N/A"}
                  </div>
                </div>
                <div className="col-4">
                  <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 4 }}>
                    Rate / Day
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    ₹
                    {selectedBed.pricing?.perBedDailyRate ||
                      selectedBed.dailyRate ||
                      0}
                  </div>
                </div>
              </div>
            </div>

            {/* Patient Information Section */}
            <div
              style={{
                background: "#f9fafb",
                padding: "10px 14px",
                borderRadius: 6,
                marginBottom: 16,
                borderLeft: "3px solid #14b8a6",
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f766e",
                }}
              >
                Patient Information
              </h4>
            </div>

            {/* UHID & Patient ID */}
            <div className="grid mb-3">
              <div className="col-6">
                <label style={labelStyle}>UHID *</label>
                <InputText
                  value={bookingData.UHID}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      UHID: e.target.value,
                    })
                  }
                  placeholder="Enter UHID"
                  className="w-full p-inputtext-sm"
                />
              </div>

              <div className="col-6">
                <label style={labelStyle}>Patient ID *</label>
                <InputText
                  value={bookingData.patientId}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      patientId: e.target.value,
                    })
                  }
                  placeholder="Enter Patient ID"
                  className="w-full p-inputtext-sm"
                />
              </div>
            </div>

            {/* Patient Name */}
            <div className="mb-3">
              <label style={labelStyle}>Patient Name *</label>
              <InputText
                value={bookingData.patientName}
                onChange={(e) =>
                  setBookingData({
                    ...bookingData,
                    patientName: e.target.value,
                  })
                }
                placeholder="Enter patient name"
                className="w-full p-inputtext-sm"
              />
            </div>

            {/* Contact Number & Blood Group */}
            <div className="grid mb-3">
              <div className="col-6">
                <label style={labelStyle}>Contact Number *</label>
                <InputText
                  value={bookingData.contactNumber}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      contactNumber: e.target.value,
                    })
                  }
                  placeholder="Enter contact number"
                  className="w-full p-inputtext-sm"
                />
              </div>

              <div className="col-6">
                <label style={labelStyle}>Blood Group</label>
                <InputText
                  value={bookingData.bloodGroup}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      bloodGroup: e.target.value,
                    })
                  }
                  placeholder="e.g., O+, A-, B+"
                  className="w-full p-inputtext-sm"
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-3">
              <label style={labelStyle}>Email</label>
              <InputText
                value={bookingData.email}
                onChange={(e) =>
                  setBookingData({
                    ...bookingData,
                    email: e.target.value,
                  })
                }
                placeholder="Enter email address"
                className="w-full p-inputtext-sm"
              />
            </div>
            {/* Admission Details Section */}
            <div
              style={{
                background: "#f9fafb",
                padding: "10px 14px",
                borderRadius: 6,
                marginBottom: 16,
                marginTop: 20,
                borderLeft: "3px solid #14b8a6",
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f766e",
                }}
              >
                Admission Details
              </h4>
            </div>

            {/* Department */}
            <div className="mb-3">
              <label style={labelStyle}>Department *</label>
              <Dropdown
                value={bookingData.department}
                options={departments.map((d) => ({ label: d, value: d }))}
                onChange={(e) =>
                  setBookingData({
                    ...bookingData,
                    department: e.value,
                  })
                }
                placeholder="Select department"
                className="w-full p-inputtext-sm"
              />
            </div>

            {/* Admission Date & Expected Discharge */}
            <div className="grid mb-3">
              <div className="col-6">
                <label style={labelStyle}>Admission Date *</label>
                <InputText
                  type="date"
                  value={bookingData.admissionDate}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      admissionDate: e.target.value,
                    })
                  }
                  className="w-full p-inputtext-sm"
                />
              </div>
              <div className="col-6">
                <label style={labelStyle}>Expected Discharge</label>
                <InputText
                  type="date"
                  value={bookingData.expectedDischargeDate}
                  onChange={(e) =>
                    setBookingData({
                      ...bookingData,
                      expectedDischargeDate: e.target.value,
                    })
                  }
                  className="w-full p-inputtext-sm"
                />
              </div>
            </div>

            {/* Reason for Admission */}
            <div className="mb-4">
              <label style={labelStyle}>Reason for Admission *</label>
              <InputTextarea
                value={bookingData.reasonForAdmission}
                onChange={(e) =>
                  setBookingData({
                    ...bookingData,
                    reasonForAdmission: e.target.value,
                  })
                }
                rows={3}
                placeholder="Enter reason for admission..."
                className="w-full p-inputtext-sm"
              />
            </div>

            {/* Action Buttons */}
            <div
              className="flex justify-content-end gap-2"
              style={{ marginTop: 20 }}
            >
              <Button
                label="Cancel"
                onClick={() => setShowBookingModal(false)}
                className="p-button-outlined p-button-sm"
                style={{ width: 100 }}
              />
              <Button
                label="Book Bed"
                onClick={handleBookBed}
                disabled={
                  !bookingData.UHID ||
                  !bookingData.patientId ||
                  !bookingData.patientName ||
                  !bookingData.contactNumber ||
                  !bookingData.reasonForAdmission
                }
                className="p-button-sm"
                style={{ width: 120 }}
              />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
export default BedVisualLayout;
