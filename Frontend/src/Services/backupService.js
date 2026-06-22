// Services/backupService.js
// R7hr-272 — Admin Backup & Recovery API wrapper. Uses the app's global axios
// (Authorization header is set on axios defaults by AuthContext).
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

export const backupService = {
  getStatus: () =>
    axios.get(API_ENDPOINTS.BACKUP_STATUS).then((r) => r.data),

  runBackup: () =>
    axios.post(API_ENDPOINTS.BACKUP_RUN).then((r) => r.data),

  // Authenticated download → fetch as a blob, then trigger a Save dialog. A
  // plain <a href> would skip the Authorization header and 401.
  downloadBackup: async (file) => {
    const res = await axios.get(API_ENDPOINTS.BACKUP_DOWNLOAD(file), {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default backupService;
