import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "primereact/resources/themes/lara-light-blue/theme.css";  
import "primereact/resources/primereact.min.css";  
import "primeicons/primeicons.css";
// import './index.css'
import App from "./App.jsx";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastContainer position="top-right" autoClose={3000} />
    <App />
  </StrictMode>
);
