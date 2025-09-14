


// import React from "react";
// import { Link, useLocation } from "react-router-dom";

// export default function Sidebar({ isOpen, toggleSidebar }) {
//   const location = useLocation();
//   const menuItems = [
//     { name: "Registration", path: "/registration" },
//     { name: "Find Patient", path: "/Allpatient" },
//     { name: "Doctor", path: "/doctor" },
//     { name: "Receptionist", path: "/receptionist" },
//     { name: "Nurse", path: "/nurse" },
//       { name: "Bill OPD", path: "/services" },
//   ];

//   return (
//     <div
//       className={`offcanvas offcanvas-start ${isOpen ? "show" : ""}`}
//       tabIndex="-1"
//       style={{ width:260,visibility: isOpen ? "visible" : "hidden" }}
//     >
//       {/* Sidebar Header */}
//       <div className="offcanvas-header btn-custom text-white p-3 ">
//         <h5 className="offcanvas-title">Menu</h5>
//         <button
//           type="button"
//           className="btn-close btn-close-white"
//           aria-label="Close"
//           onClick={toggleSidebar}
//         ></button>
//       </div>

//       {/* Sidebar Body */}
//       <div className="offcanvas-body p-0">
//         <ul className="list-group list-group-flush">
//           {menuItems.map((item) => {
//             const isActive = location.pathname === item.path;      
//         return (
//               <li key={item.name} className="list-group-item">
//                 <Link
//                   to={item.path}
//                   className={`text-decoration-none d-block px-3 py-2 rounded ${
//                     isActive ? "btn-custom text-white fw-bold" : "text-dark"
//                   }`}
//                   onClick={toggleSidebar}
//                 >
//                   {item.name}
//                 </Link>
//               </li>
//             );
//           })}
//         </ul>
//       </div>
//     </div>
//   );
// }



import React from "react";
import { Link, useLocation } from "react-router-dom";

import {
  UserPlus,
  Search,
  Stethoscope,
  ClipboardList,
  UserRound,   // 👈 Nurse ki jagah UserRound use kiya
  FileText,
} from "lucide-react";

export default function Sidebar({ isOpen, toggleSidebar }) {
  const location = useLocation();

  const menuItems = [
    { name: "Registration", path: "/registration", icon: <UserPlus size={18} /> },
    { name: "Find Patient", path: "/Allpatient", icon: <Search size={18} /> },
    // { name: "Doctor", path: "/doctor", icon: <Stethoscope size={18} /> },
    // { name: "Receptionist", path: "/receptionist", icon: <ClipboardList size={18} /> },
    { name: "Nurse", path: "/nurse", icon: <UserRound size={18} /> },  // ✅ fixed
    { name: "Bill Service", path: "/services", icon: <FileText size={18} /> },
      { name: "OPD Bill Print", path: "/opd", icon: <FileText size={18} /> },
       { name: "OPD Data Print", path: "/opdprint", icon: <FileText size={18} /> },
        { name: "TPA Service", path: "/TPA", icon: <FileText size={18} /> },
  ];

  return (
    <div
      className={`offcanvas offcanvas-start ${isOpen ? "show" : ""}`}
      tabIndex="-1"
      style={{ width: 260, visibility: isOpen ? "visible" : "hidden" }}
    >
      {/* Sidebar Header */}
      <div className="offcanvas-header btn-custom text-white p-3">
        <h5 className="offcanvas-title">Menu</h5>
        <button
          type="button"
          className="btn-close btn-close-white"
          aria-label="Close"
          onClick={toggleSidebar}
        ></button>
      </div>

      {/* Sidebar Body */}
      <div className="offcanvas-body p-0">
        <ul className="list-group list-group-flush">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.name} className="list-group-item">
                <Link
                  to={item.path}
                  className={`d-flex align-items-center gap-2 text-decoration-none px-3 py-2 rounded ${
                    isActive
                      ? "btn-custom text-white fw-bold"
                      : "text-dark fw-normal"
                  }`}
                  onClick={toggleSidebar}
                >
                  <span
                    className={`icon ${
                      isActive ? "text-white" : "text-secondary"
                    }`}
                  >
                    {item.icon}
                  </span>
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}



