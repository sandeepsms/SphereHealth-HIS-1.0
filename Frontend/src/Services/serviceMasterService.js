import API_ENDPOINTS from '../config/api';

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeService = (service) => {
  if (!service) return service;
  return {
    ...service,
    _id: extractId(service._id),
  };
};

export const serviceMasterService = {
  getAllServices: async () => {
    try {
      const response = await fetch(API_ENDPOINTS.SERVICES);
      const data = await response.json();
      const services = Array.isArray(data)
        ? data
        : data.data || data.services || [];
      return services.map(normalizeService);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getServiceById: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.SERVICES}/${id}`);
      const service = await response.json();
      return normalizeService(service);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getServicesByCategory: async (category) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.SERVICES}/category/${category}`);
      const data = await response.json();
      const services = Array.is(data) ? data : [];
return services.map(normalizeService);
} catch (error) {
console.error("Error:", error);
return [];
}
},
createService: async (data) => {
try {
const response = await fetch(API_ENDPOINTS.SERVICES, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(data),
});
const service = await response.json();
return normalizeService(service);
} catch (error) {
console.error("Error:", error);
throw error;
}
},
updateService: async (id, data) => {
  try {
    const response = await fetch(`${API_ENDPOINTS.SERVICES}/${id}`, {
method: "PUT",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(data),
});
const service = await response.json();
return normalizeService(service);
} catch (error) {
console.error("Error:", error);
throw error;
}
},
deleteService: async (id) => {
  try {
    const response = await fetch(`${API_ENDPOINTS.SERVICES}/${id}`, {
method: "DELETE",
});
return await response.json();
} catch (error) {
console.error("Error:", error);
throw error;
}
},
seedDefaultServices: async () => {
  try {
    const response = await fetch(`${API_ENDPOINTS.SERVICES}/seed`, {
method: "POST",
});
const data = await response.json();
const services = Array.isArray(data) ? data : data.data || [];
return services.map(normalizeService);
} catch (error) {
console.error("Error:", error);
throw error;
}
},
};