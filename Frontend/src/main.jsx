import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// ⭐ PrimeReact CSS imports - ONLY ONCE!
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";

// Toast CSS
import "react-toastify/dist/ReactToastify.css";

// HIS Design System - load before index.css
import "./his-design.css";

// Your custom CSS - MUST BE LAST
import "./index.css";

import "./config/axiosInterceptor"; // attach JWT to all axios requests
import App from "./App.jsx";
import { ToastContainer } from "react-toastify";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastContainer position="top-right" autoClose={3000} />
    <App />
  </StrictMode>,
);
