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
// R7bz: app-root ErrorBoundary with criticalError = full-screen takeover
// if any unhandled render crash escapes the per-tab boundaries inside
// AccountsConsole etc. This is the LAST line of defense — the per-tab
// boundaries still catch and contain locally; this only fires when the
// crash happens outside those boundaries (e.g. inside the router shell,
// a sidebar component, an early route render).
import ErrorBoundary from "./Components/ErrorBoundary.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastContainer position="top-right" autoClose={3000} />
    <ErrorBoundary criticalError label="App root">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
