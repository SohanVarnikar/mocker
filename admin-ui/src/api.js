const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  // Endpoints
  listEndpoints: () => request("/endpoints"),
  getEndpoint: (id) => request(`/endpoints/${id}`),
  createEndpoint: (data) =>
    request("/endpoints", { method: "POST", body: JSON.stringify(data) }),
  updateEndpoint: (id, data) =>
    request(`/endpoints/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEndpoint: (id) => request(`/endpoints/${id}`, { method: "DELETE" }),

  // Entities
  listEntities: () => request("/entities"),
  getEntity: (name) => request(`/entities/${name}`),
  createEntity: (data) =>
    request("/entities", { method: "POST", body: JSON.stringify(data) }),
  updateEntity: (name, data) =>
    request(`/entities/${name}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEntity: (name) => request(`/entities/${name}`, { method: "DELETE" }),

  // Entity records
  listRecords: (name) => request(`/entities/${name}/records`),
  replaceRecords: (name, records) =>
    request(`/entities/${name}/records`, {
      method: "PUT",
      body: JSON.stringify(records),
    }),
  addRecord: (name, record) =>
    request(`/entities/${name}/records`, {
      method: "POST",
      body: JSON.stringify(record),
    }),
  updateRecord: (name, id, record) =>
    request(`/entities/${name}/records/${id}`, {
      method: "PUT",
      body: JSON.stringify(record),
    }),
  deleteRecord: (name, id) =>
    request(`/entities/${name}/records/${id}`, { method: "DELETE" }),
  reseedEntity: (name) =>
    request(`/entities/${name}/reseed`, { method: "POST" }),
  clearEntity: (name) => request(`/entities/${name}/clear`, { method: "POST" }),

  // Logs
  listLogs: () => request("/logs"),
  clearLogs: () => request("/logs", { method: "DELETE" }),

  // Settings
  getSettings: () => request("/settings"),
  saveSettings: (data) =>
    request("/settings", { method: "PUT", body: JSON.stringify(data) }),

  // Import / Export
  exportConfig: (includeData = false) =>
    request(`/config/export${includeData ? "?includeData=true" : ""}`),
  importConfig: (data) =>
    request("/config/import", { method: "POST", body: JSON.stringify(data) }),
};
