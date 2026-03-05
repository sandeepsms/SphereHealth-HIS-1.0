import React, { useState } from "react";
import { Dropdown } from "primereact/dropdown";

export default function SearchBar({
  Dropdowndata,
  value,
  onchange,
  onSearchChange,
}) {
  return (
    <div className="card flex justify-content-center p-0">
      <Dropdown  
        value={value}
        onChange={(e) => onchange(e.value)}
        options={Dropdowndata}
        optionLabel="label"
        optionValue="value"
        placeholder="Search Patient"
        filter
        onFilter={(e) => onSearchChange(e.filter)}
        className="w-full md:w-14rem"
      />
    </div>
  );
}
