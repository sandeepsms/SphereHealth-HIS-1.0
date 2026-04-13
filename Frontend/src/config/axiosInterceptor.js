/**
 * Axios request interceptor — attaches JWT token to every request.
 * Import this once in main.jsx before App renders.
 */
import axios from "axios";

axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("his_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // If 401 from server (expired/invalid token), clear session and redirect to login
    if (error?.response?.status === 401) {
      const isLoginRoute = error?.config?.url?.includes("/auth/login");
      if (!isLoginRoute) {
        localStorage.removeItem("his_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
