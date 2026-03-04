import React, { useState } from "react";
import { Dropdown } from "primereact/dropdown";
import { AutoComplete } from "primereact/autocomplete";

export default function SearchBar({
  Dropdowndata,
  valuedata,
  onchanges,
  onSearchChange,
}) {
  return (
    <div className="card flex justify-content-center p-0">
      <AutoComplete
        value={valuedata}
        suggestions={Dropdowndata}
        completeMethod={(e) => onSearchChange(e.query)}
        field="label"
        onChange={(e) => onchanges(e.value)}
        placeholder="Search Patient By UHID"
        className="w-full md:w-14rem"
      />
    </div>
  );
}
