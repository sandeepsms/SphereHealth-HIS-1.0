/**
 * ClinicalLayout.jsx
 * Wraps any clinical page with the AdmittedPatientPanel on the left.
 * Usage:
 *   <ClinicalLayout onPatientSelect={handleSelect} selectedId={selected?._id}>
 *     <YourPageContent />
 *   </ClinicalLayout>
 */
import React from "react";
import AdmittedPatientPanel from "./AdmittedPatientPanel";

export default function ClinicalLayout({ children, onPatientSelect, selectedId, pageType }) {
  return (
    <div style={{
      display: "flex",
      minHeight: "calc(100vh - 52px)",
      // Negative margin to fill full width (AppShell adds 20px padding)
      margin: "-20px",
    }}>
      <AdmittedPatientPanel
        onPatientSelect={onPatientSelect}
        selectedId={selectedId}
        pageType={pageType}
      />
      <div style={{
        flex: 1,
        padding: "20px",
        overflowY: "auto",
        overflowX: "hidden",
        minWidth: 0,
      }}>
        {children}
      </div>
    </div>
  );
}
