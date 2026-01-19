import React, { useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { TabView, TabPanel } from "primereact/tabview";
import FloorList from "../Components/floor/FloorList";
import FloorForm from "../Components/floor/FloorForm";
import FloorCard from "../Components/floor/FloorCard";
import { floorService } from "../Services/floorService";

const FloorManagement = () => {
  const [showForm, setShowForm] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [floors, setFloors] = useState([]);

  const handleEdit = (floor) => {
    setSelectedFloor(floor);
    setShowForm(true);
  };

  const handleAdd = () => {
    setSelectedFloor(null);
    setShowForm(true);
  };

  const handleSave = () => {
    setRefreshKey((prev) => prev + 1);
    loadFloors();
  };

  const handleDelete = async (floor) => {
    if (window.confirm(`Are you sure you want to delete ${floor.floorName}?`)) {
      try {
        await floorService.deleteFloor(floor._id);
        loadFloors();
      } catch (error) {
        console.error("Error deleting floor:", error);
      }
    }
  };

  const loadFloors = async () => {
    try {
      const data = await floorService.getAllFloors();
      setFloors(data);
    } catch (error) {
      console.error("Error loading floors:", error);
    }
  };

  React.useEffect(() => {
    loadFloors();
  }, [refreshKey]);

  const headerTemplate = (
    <div className="flex justify-content-between align-items-center">
      <div className="flex align-items-center flex-column flex-grow-1">
        <div className="flex align-items-center gap-2 mb-2">
          <i className="pi pi-building text-3xl text-primary"></i>
          <h2 className="m-0 p-2 text-2xl font-bold text-900">
            Floor Management
          </h2>
        </div>
        <p className="m-0 text-sm text-600">
          Manage hospital floors and their details
        </p>
      </div>
      <Button
        label="Add New Floor"
        icon="pi pi-plus"
        onClick={handleAdd}
        className="p-button-success m-2"
      />
    </div>
  );

  return (
    <div className=" p-2 " style={{ marginTop: "45px" }}>
      <Card header={headerTemplate} className="shadow-1">
        <TabView
          activeIndex={activeTab}
          onTabChange={(e) => setActiveTab(e.index)}
          className="mt-1"
        >
          <TabPanel header="List View" leftIcon="pi pi-list mr-2">
            <div className="mt-1">
              <FloorList onEdit={handleEdit} onRefresh={refreshKey} />
            </div>
          </TabPanel>

          <TabPanel header="Card View" leftIcon="pi pi-th-large mr-2">
            {floors.length === 0 ? (
              <div className="text-center p-6 mt-4">
                <i
                  className="pi pi-inbox mb-4"
                  style={{
                    fontSize: "5rem",
                    color: "#cbd5e1",
                  }}
                ></i>
                <h3 className="text-xl font-semibold text-700 mb-2">
                  No Floors Found
                </h3>
                <p className="text-600 mb-4">
                  Get started by creating your first floor
                </p>
                <Button
                  label="Create First Floor"
                  icon="pi pi-plus"
                  onClick={handleAdd}
                  className="p-button-primary"
                />
              </div>
            ) : (
              <div
                className="grid mt-4"
                style={{
                  gap: "1.5rem",
                }}
              >
                {floors.map((floor) => (
                  <div key={floor._id} className="col-12 md:col-6 lg:col-4">
                    <FloorCard
                      floor={floor}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabPanel>
        </TabView>
      </Card>

      <FloorForm
        visible={showForm}
        onHide={() => {
          setShowForm(false);
          setSelectedFloor(null);
        }}
        floor={selectedFloor}
        onSave={handleSave}
      />
    </div>
  );
};

export default FloorManagement;
