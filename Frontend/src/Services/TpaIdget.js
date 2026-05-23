import axios from "axios";
import { API_BASE_URL } from "../config/api";
import { unwrapResponse } from "../utils/apiResponse";

// R7bj-F8: switch to the canonical {success, data, meta?} envelope
// so callers no longer need the `?legacy=1` shim. We return the
// envelope `data` directly to preserve the existing call surface,
// but errors now surface cleanly via thrown Error with the server
// message instead of an opaque axios reject.
export const getTpaId = async (TpaId) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/Servicebilldata/getTpaId/${TpaId}`
    );
    const { ok, data, error } = unwrapResponse(response);
    if (!ok) {
      throw new Error(error?.message || "Failed to fetch TPA");
    }
    return data;
  } catch (error) {
    console.error("Error fetching patient data:", error?.message || error);
    throw error;
  }
};
