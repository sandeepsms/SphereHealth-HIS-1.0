import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { hospitalChargesService } from "../../Services/charges/hospitalChargesService";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

// PrimeReact
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";

function CreateHospitalCharges() {
  const navigate = useNavigate();
  const toast = useRef(null);
  const [loading, setLoading] = useState(false);
  const [tpaList, setTpaList] = useState([]);
  const [formData, setFormData] = useState({
    tpaName: "",
    charges: [
      {
        chargeName: "",
        chargeType: "",
        amount: 0,
        discount: 0,
        totalAmount: 0,
        perUnit: "one time",
      },
    ],
  });

  // ✅ Exact enum values from backend
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
    loadTPAs();
  }, []);

  const loadTPAs = async () => {
    try {
      const response = await axios.get(API_ENDPOINTS.TPA);
      const tpas = response.data.data || response.data;
      setTpaList(
        tpas.map((tpa) => ({
          label: `${tpa.tpaName} (${tpa.tpaCode})`,
          value: tpa.tpaName,
        })),
      );
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load TPAs",
        life: 3000,
      });
    }
  };

  const handleAddCharge = () => {
    setFormData({
      ...formData,
      charges: [
        ...formData.charges,
        {
          chargeName: "",
          chargeType: "",
          amount: 0,
          discount: 0,
          totalAmount: 0,
          perUnit: "one time",
        },
      ],
    });
  };

  const handleRemoveCharge = (index) => {
    const updatedCharges = formData.charges.filter((_, i) => i !== index);
    setFormData({ ...formData, charges: updatedCharges });
  };

  const handleChargeChange = (index, field, value) => {
    const updatedCharges = [...formData.charges];
    updatedCharges[index][field] = value;

    // ✅ Auto-calculate totalAmount when amount or discount changes
    if (field === "amount" || field === "discount") {
      const amount = field === "amount" ? value : updatedCharges[index].amount;
      const discount =
        field === "discount" ? value : updatedCharges[index].discount;
      updatedCharges[index].totalAmount = amount - (amount * discount) / 100;
    }

    setFormData({ ...formData, charges: updatedCharges });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.tpaName) {
      toast.current.show({
        severity: "warn",
        summary: "Warning",
        detail: "Please select a TPA",
        life: 3000,
      });
      return;
    }

    const validCharges = formData.charges.filter(
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
      setLoading(true);
      await hospitalChargesService.createHospitalCharges({
        tpaName: formData.tpaName,
        charges: validCharges,
      });
      toast.current.show({
        severity: "success",
        summary: "Success",
        detail: "Hospital charges created successfully!",
        life: 3000,
      });
      setTimeout(() => navigate("/hospital-charges"), 1500);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to create charges",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <Toast ref={toast} />

      <Card
        title="Create Hospital Charges"
        style={{ backgroundColor: "#FFFFFF", borderRadius: "8px" }}
      >
        <form onSubmit={handleSubmit}>
          {/* TPA Selection */}
          <div className="mb-4">
            <label
              className="block mb-2 font-medium"
              style={{ color: "#374151" }}
            >
              Select TPA <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <Dropdown
              value={formData.tpaName}
              options={tpaList}
              onChange={(e) => setFormData({ ...formData, tpaName: e.value })}
              placeholder="-- Select TPA --"
              className="w-full"
              filter
            />
          </div>

          {/* Charges Section */}
          <div className="mb-4">
            <div className="flex justify-content-between align-items-center mb-3">
              <label className="block font-medium" style={{ color: "#374151" }}>
                Charges <span style={{ color: "#EF4444" }}>*</span>
              </label>
              <Button
                type="button"
                label="Add Charge"
                icon="pi pi-plus"
                onClick={handleAddCharge}
                style={{ backgroundColor: "#10B981", borderColor: "#10B981" }}
                size="small"
              />
            </div>

            <div className="flex flex-column gap-3">
              {formData.charges.map((charge, index) => (
                <Card
                  key={index}
                  style={{
                    backgroundColor: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                  }}
                >
                  <div className="grid">
                    {/* Charge Name */}
                    <div className="col-12 md:col-6">
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

                    {/* Charge Type */}
                    <div className="col-12 md:col-6">
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

                    {/* Per Unit */}
                    <div className="col-12 md:col-4">
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

                    {/* Amount */}
                    <div className="col-12 md:col-4">
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

                    {/* Discount */}
                    <div className="col-12 md:col-4">
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

                    {/* Total Amount (Auto-calculated) */}
                    <div className="col-12 md:col-12">
                      <label className="block mb-2 text-sm font-medium">
                        Total Amount (Auto-calculated)
                      </label>
                      <div className="flex gap-2">
                        <InputNumber
                          value={charge.totalAmount}
                          mode="currency"
                          currency="INR"
                          locale="en-IN"
                          className="w-full"
                          disabled
                          style={{ backgroundColor: "#F3F4F6" }}
                        />
                        {formData.charges.length > 1 && (
                          <Button
                            type="button"
                            icon="pi pi-trash"
                            onClick={() => handleRemoveCharge(index)}
                            style={{
                              backgroundColor: "#EF4444",
                              borderColor: "#EF4444",
                            }}
                            size="small"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
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
              label={loading ? "Creating..." : "Create Charges"}
              icon="pi pi-check"
              loading={loading}
              style={{ backgroundColor: "#4F46E5", borderColor: "#4F46E5" }}
            />
          </div>
        </form>
      </Card>
    </div>
  );
}

export default CreateHospitalCharges;
