import React from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Card } from "primereact/card";

const FilterBar = ({
  searchValue,
  onSearchChange,
  filters = [],
  onFilterChange,
  onClear,
  onRefresh,
}) => {
  return (
    <Card className="mb-3">
      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ flex: "1", minWidth: "250px" }}>
          <span className="p-input-icon-left" style={{ width: "100%" }}>
            <i className="pi pi-search" />
            <InputText
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search..."
              style={{ width: "100%" }}
            />
          </span>
        </div>

        {filters.map((filter, index) => (
          <div key={index} style={{ minWidth: "200px" }}>
            <Dropdown
              value={filter.value}
              options={filter.options}
              onChange={(e) => onFilterChange(filter.name, e.value)}
              placeholder={filter.placeholder}
              showClear={filter.showClear !== false}
              style={{ width: "100%" }}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: "5px" }}>
          {onClear && (
            <Button
              icon="pi pi-times"
              className="p-button-outlined p-button-secondary"
              onClick={onClear}
              tooltip="Clear Filters"
            />
          )}
          {onRefresh && (
            <Button
              icon="pi pi-refresh"
              className="p-button-outlined"
              onClick={onRefresh}
              tooltip="Refresh"
            />
          )}
        </div>
      </div>
    </Card>
  );
};

export default FilterBar;
