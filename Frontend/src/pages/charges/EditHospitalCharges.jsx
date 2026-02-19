import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { hospitalChargesService } from "../../Services/charges/hospitalChargesService";

// PrimeReact
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";

function EditHospitalCharges() {
  const navigate = useNavigate();
  const { id } = useParams(); // ✅ YE DOCUMENT ID HAI
  const toast = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chargesData, setChargesData] = useState(null);
  const [charges, setCharges] = useState([]);

  const chargeTypeOptions = [
    { label: "OPD Consultation", value: "OPD" },
    { label: "IPD Bed Charges", value: "IPD_BED" },
    { label: "ICU Bed Charges", value: "ICU_BED" },
    { label: "Emergency", value: "EMERGENCY" },
    { label: "Nurse Charges", value: "NURSE" },
    { label: "Doctor Visit", value: "DOCTOR_VISIT" },
    { label: "Operation Theater", value: "OPERATION_THEATER" },
    { label: "Ambulance", value: "AMBULANCE" },
    { label: "Dressing", value: "DRESSING" },
    { label: "Injection", value: "INJECTION" },
    { label: "Other", value: "OTHER" },
  ];

  const perUnitOptions = [
    { label: "One Time", value: "one time" },
    { label: "Per Day", value: "per day" },
    { label: "Per Visit", value: "per visit" },
  ];

  useEffect(() => {
    loadChargesData();
  }, [id]);

  const loadChargesData = async () => {
    try {
      setLoading(true);

      // ❌ WRONG - YE LINE COMMENT KAR DO
      // const data = await hospitalChargesService.getHospitalChargesByTPA(id);

      // ✅ CORRECT - YE USE KARO
      console.log("🔍 Loading hospital charges for document ID:", id);
      const data = await hospitalChargesService.getHospitalChargesById(id);

      console.log("✅ Loaded data:", data);

      setChargesData(data);
      setCharges(data.charges || []);
    } catch (error) {
      console.error("❌ Failed to load hospital charges:", error);
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail:
          error.response?.data?.message || "Failed to load hospital charges",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCharge = () => {
    setCharges([
      ...charges,
      {
        chargeName: "",
        chargeType: "",
        amount: 0,
        discount: 0,
        totalAmount: 0,
        perUnit: "one time",
      },
    ]);
  };

  const handleRemoveCharge = (index) => {
    const updatedCharges = charges.filter((_, i) => i !== index);
    setCharges(updatedCharges);
  };

  const handleChargeChange = (index, field, value) => {
    const updatedCharges = [...charges];
    updatedCharges[index][field] = value;

    // Auto-calculate totalAmount
    if (field === "amount" || field === "discount") {
      const amount = field === "amount" ? value : updatedCharges[index].amount;
      const discount =
        field === "discount" ? value : updatedCharges[index].discount;
      updatedCharges[index].totalAmount = amount - (amount * discount) / 100;
    }

    setCharges(updatedCharges);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validCharges = charges.filter(
      (c) => c.chargeName.trim() && c.chargeType && c.amount > 0,
    );

    if (validCharges.length === 0) {
      toast.current.show({
        severity: "warn",
        summary: "Warning",
        detail: "Please add at least one valid charge",
        life: 3000,
      });
      return;
    }

    try {
      setSaving(true);
      await hospitalChargesService.updateHospitalCharges(id, validCharges);
      toast.current.show({
        severity: "success",
        summary: "Success",
        detail: "Hospital charges updated successfully!",
        life: 3000,
      });
      setTimeout(() => navigate("/hospital-charges"), 1500);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to update charges",
        life: 3000,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex align-items-center justify-content-center"
        style={{ minHeight: "100vh", backgroundColor: "#F9FAFB" }}
      >
        <i
          className="pi pi-spin pi-spinner"
          style={{ fontSize: "3rem", color: "#4F46E5" }}
        ></i>
      </div>
    );
  }

  if (!chargesData) {
    return (
      <div
        className="flex align-items-center justify-content-center"
        style={{ minHeight: "100vh", backgroundColor: "#F9FAFB" }}
      >
        <Card>
          <p style={{ color: "#EF4444", fontSize: "18px" }}>
            Hospital charges not found
          </p>
          <Button
            label="Go Back"
            icon="pi pi-arrow-left"
            onClick={() => navigate("/hospital-charges")}
            className="mt-3"
          />
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F9FAFB",
        padding: "0",
      }}
    >
      <Toast ref={toast} />

      {/* Header Section */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #E5E7EB",
          padding: "1.5rem 2rem",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div className="flex justify-content-between align-items-center">
          <div>
            <h1 style={{ margin: 0, color: "#1F2937", fontSize: "24px" }}>
              Edit Hospital Charges
            </h1>
            <p style={{ margin: "0.5rem 0 0 0", color: "#6B7280" }}>
              TPA: {chargesData.tpaName} ({chargesData.tpaCode})
            </p>
          </div>
          <Button
            label="Back to List"
            icon="pi pi-arrow-left"
            onClick={() => navigate("/hospital-charges")}
            outlined
            style={{ color: "#6B7280", borderColor: "#6B7280" }}
          />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ padding: "2rem" }}>
        <form onSubmit={handleSubmit}>
          {/* Charges Section */}
          <Card
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "8px",
              marginBottom: "1.5rem",
            }}
          >
            <div className="flex justify-content-between align-items-center mb-4">
              <h2 style={{ margin: 0, color: "#374151", fontSize: "18px" }}>
                Charges <span style={{ color: "#EF4444" }}>*</span>
              </h2>
              <Button
                type="button"
                label="Add Charge"
                icon="pi pi-plus"
                onClick={handleAddCharge}
                style={{ backgroundColor: "#10B981", borderColor: "#10B981" }}
              />
            </div>

            <div className="flex flex-column gap-3">
              {charges.map((charge, index) => (
                <Card
                  key={index}
                  style={{
                    backgroundColor: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                  }}
                >
                  <div className="grid">
                    <div className="col-12 md:col-6 lg:col-3">
                      <label className="block mb-2 text-sm font-medium">
                        Charge Name <span style={{ color: "#EF4444" }}>*</span>
                      </label>
                      <InputText
                        value={charge.chargeName}
                        onChange={(e) =>
                          handleChargeChange(
                            index,
                            "chargeName",
                            e.target.value,
                          )
                        }
                        placeholder="e.g., Room Charges"
                        className="w-full"
                      />
                    </div>

                    <div className="col-12 md:col-6 lg:col-3">
                      <label className="block mb-2 text-sm font-medium">
                        Charge Type <span style={{ color: "#EF4444" }}>*</span>
                      </label>
                      <Dropdown
                        value={charge.chargeType}
                        options={chargeTypeOptions}
                        onChange={(e) =>
                          handleChargeChange(index, "chargeType", e.value)
                        }
                        placeholder="Select Type"
                        className="w-full"
                      />
                    </div>

                    <div className="col-12 md:col-6 lg:col-2">
                      <label className="block mb-2 text-sm font-medium">
                        Per Unit
                      </label>
                      <Dropdown
                        value={charge.perUnit}
                        options={perUnitOptions}
                        onChange={(e) =>
                          handleChargeChange(index, "perUnit", e.value)
                        }
                        className="w-full"
                      />
                    </div>

                    <div className="col-12 md:col-6 lg:col-2">
                      <label className="block mb-2 text-sm font-medium">
                        Amount <span style={{ color: "#EF4444" }}>*</span>
                      </label>
                      <InputNumber
                        value={charge.amount}
                        onValueChange={(e) =>
                          handleChargeChange(index, "amount", e.value || 0)
                        }
                        mode="currency"
                        currency="INR"
                        locale="en-IN"
                        className="w-full"
                      />
                    </div>

                    <div className="col-12 md:col-6 lg:col-2">
                      <label className="block mb-2 text-sm font-medium">
                        Discount (%)
                      </label>
                      <InputNumber
                        value={charge.discount}
                        onValueChange={(e) =>
                          handleChargeChange(index, "discount", e.value || 0)
                        }
                        min={0}
                        max={100}
                        suffix="%"
                        className="w-full"
                      />
                    </div>

                    <div className="col-12 lg:col-10">
                      <label className="block mb-2 text-sm font-medium">
                        Total Amount (Auto-calculated)
                      </label>
                      <InputNumber
                        value={charge.totalAmount}
                        mode="currency"
                        currency="INR"
                        locale="en-IN"
                        className="w-full"
                        disabled
                        style={{ backgroundColor: "#F3F4F6" }}
                      />
                    </div>

                    <div className="col-12 lg:col-2 flex align-items-end">
                      {charges.length > 1 && (
                        <Button
                          type="button"
                          label="Remove"
                          icon="pi pi-trash"
                          onClick={() => handleRemoveCharge(index)}
                          style={{
                            backgroundColor: "#EF4444",
                            borderColor: "#EF4444",
                            width: "100%",
                          }}
                        />
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Card>

          {/* Action Buttons - Sticky Footer */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderTop: "1px solid #E5E7EB",
              padding: "1.5rem 2rem",
              position: "sticky",
              bottom: 0,
              zIndex: 100,
              marginLeft: "-2rem",
              marginRight: "-2rem",
              marginBottom: "-2rem",
            }}
          >
            <div className="flex gap-2 justify-content-end">
              <Button
                type="button"
                label="Cancel"
                icon="pi pi-times"
                onClick={() => navigate("/hospital-charges")}
                outlined
                style={{ color: "#6B7280", borderColor: "#6B7280" }}
              />
              <Button
                type="submit"
                label={saving ? "Saving..." : "Update Charges"}
                icon="pi pi-check"
                loading={saving}
                style={{ backgroundColor: "#4F46E5", borderColor: "#4F46E5" }}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditHospitalCharges;
