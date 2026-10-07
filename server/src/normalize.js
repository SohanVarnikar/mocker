import { nanoid } from "nanoid";

export function normalizeEndpoint(input) {
  const scenarios = (input.scenarios || []).map((s) => {
    const scenario = {
      id: s.id || nanoid(8),
      name: s.name || "Scenario",
      statusCode: Number(s.statusCode) || 200,
      delayMs: Number(s.delayMs) || 0,
      headers: s.headers || "",
      body: s.body ?? "{}",
      usesEntity: s.usesEntity !== false,
    };
    if (s.match && typeof s.match === "object" && Object.keys(s.match).length) {
      scenario.match = s.match;
    }
    return scenario;
  });
  return {
    id: input.id,
    method: (input.method || "GET").toUpperCase(),
    path: input.path || "/",
    description: input.description || "",
    tag: input.tag || "",
    enabled: input.enabled !== false,
    requestShape: input.requestShape || {},
    entityLink: input.entityLink || null,
    scenarios,
    activeScenarioId: input.activeScenarioId || scenarios[0]?.id || null,
  };
}

export function normalizeEntity(input) {
  const entity = {
    name: input.name,
    idField: input.idField || "id",
    idParam: input.idParam || input.idField || "id",
    idStrategy: input.idStrategy === "uuid" ? "uuid" : "increment",
    seedData: Array.isArray(input.seedData) ? input.seedData : [],
  };
  if (
    input.scope &&
    typeof input.scope === "object" &&
    Object.keys(input.scope).length
  ) {
    entity.scope = input.scope;
  }
  if (
    input.defaults &&
    typeof input.defaults === "object" &&
    Object.keys(input.defaults).length
  ) {
    entity.defaults = input.defaults;
  }
  return entity;
}
