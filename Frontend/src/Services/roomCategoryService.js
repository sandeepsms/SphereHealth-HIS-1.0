const API_BASE = "http://localhost:5000/api";

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeCategory = (category) => {
  if (!category) return category;
  return {
    ...category,
    _id: extractId(category._id),
  };
};

export const roomCategoryService = {
  getAllCategories: async () => {
    try {
      const response = await fetch(`${API_BASE}/room-categories`);
      const data = await response.json();
      const categories = Array.isArray(data)
        ? data
        : data.data || data.categories || [];
      return categories.map(normalizeCategory);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getCategoryById: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/room-categories/${id}`);
      const category = await response.json();
      return normalizeCategory(category);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createCategory: async (data) => {
    try {
      const response = await fetch(`${API_BASE}/room-categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const category = await response.json();
      return normalizeCategory(category);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateCategory: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/room-categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const category = await response.json();
      return normalizeCategory(category);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  deleteCategory: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/room-categories/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  seedDefaultCategories: async () => {
    try {
      const response = await fetch(`${API_BASE}/room-categories/seed`, {
        method: "POST",
      });
      const data = await response.json();
      const categories = Array.isArray(data) ? data : data.data || [];
      return categories.map(normalizeCategory);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
