import { nanoid } from "nanoid";
import { httpError } from "./asyncRouter.js";

const ON_DELETE = new Set(["none", "cascade", "setNull", "restrict"]);
// Entity names become file names (store/<name>.json, config/seeds/<name>.json).
const ENTITY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function toList(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

function normalizeEntityLink(link) {
  if (!link) return null;
  const out = { ...link };
  for (const key of ["expand", "embed"]) {
    const names = toList(link[key]);
    if (names.length) out[key] = names;
    else delete out[key];
  }
  return out;
}

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
    entityLink: normalizeEntityLink(input.entityLink),
    scenarios,
    activeScenarioId: input.activeScenarioId || scenarios[0]?.id || null,
  };
}

function defaultAlias(field) {
  if (/.Id$/.test(field)) return field.slice(0, -2);
  if (/._id$/.test(field)) return field.slice(0, -3);
  return `${field}Ref`;
}

function normalizeRelations(relations, entityName) {
  if (!Array.isArray(relations)) return [];
  return relations
    .filter((r) => r && typeof r.field === "string" && r.field.trim() && typeof r.entity === "string" && r.entity.trim())
    .map((r) => {
      const field = r.field.trim();
      const relation = {
        field,
        entity: r.entity.trim(),
        as: (typeof r.as === "string" && r.as.trim()) || defaultAlias(field),
        onDelete: ON_DELETE.has(r.onDelete) ? r.onDelete : "none",
      };
      if (r.validate) relation.validate = true;
      if (relation.as === field) {
        throw httpError(400, `Relation alias "${relation.as}" on ${entityName} must differ from its field name`);
      }
      return relation;
    });
}

export function normalizeEntity(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!ENTITY_NAME.test(name)) {
    throw httpError(
      400,
      `Invalid entity name "${input.name ?? ""}": use letters, digits, "-", "_" or "."`,
    );
  }
  const entity = {
    name,
    idField: input.idField || "id",
    idParam: input.idParam || input.idField || "id",
    idStrategy: input.idStrategy === "uuid" ? "uuid" : "increment",
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
  const relations = normalizeRelations(input.relations, name);
  if (relations.length) entity.relations = relations;
  // Only present when the caller supplies seed data; otherwise the existing seed file is kept.
  if (Array.isArray(input.seedData)) entity.seedData = input.seedData;
  return entity;
}
