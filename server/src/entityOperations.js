import { readEntityRecords, writeEntityRecords, indexBy, nextEntityId, resolveSeedTokens } from "./store.js";
import { withRelations, validateReferences, deleteRecords } from "./relations.js";
import { httpError } from "./asyncRouter.js";

// entity.scope maps record field -> path param, so nested routes only see their parent's records.
function scopeValues(entity, params) {
  const values = {};
  for (const [field, param] of Object.entries(entity.scope || {})) {
    if (params[param] !== undefined) values[field] = params[param];
  }
  return values;
}

function inScope(record, scope) {
  return Object.entries(scope).every(
    ([field, value]) => String(record[field]) === String(value),
  );
}

/**
 * Performs a CRUD-style operation against an entity's store, mimicking a real
 * backend so multiple linked endpoints (e.g. POST + PUT) observe each other's
 * changes. `options.expand` / `options.embed` add related records to the result.
 */
export async function performEntityOperation(
  entity,
  operation,
  params,
  requestBody,
  options = {},
) {
  const idField = entity.idField || "id";
  const idParam = entity.idParam || "id";
  const scope = scopeValues(entity, params);
  const notFound = (id) => httpError(404, `${entity.name} with ${idField} ${id} was not found`);
  const findRecord = (id) =>
    (indexBy(entity.name, idField).get(String(id)) || []).find((r) => inScope(r, scope));

  switch (operation) {
    case "list": {
      const records = readEntityRecords(entity.name).filter((r) => inScope(r, scope));
      return withRelations(entity, records, options);
    }
    case "getById": {
      const id = params[idParam];
      const record = findRecord(id);
      if (!record) throw notFound(id);
      return withRelations(entity, record, options);
    }
    case "create": {
      const records = readEntityRecords(entity.name);
      const record = {
        [idField]: nextEntityId(entity, records),
        ...resolveSeedTokens(entity.defaults || {}),
        ...(requestBody || {}),
        ...scope,
        createdAt: new Date().toISOString(),
      };
      validateReferences(entity, record);
      await writeEntityRecords(entity.name, [...records, record]);
      return withRelations(entity, record, options);
    }
    case "update": {
      const id = params[idParam];
      const existing = findRecord(id);
      if (!existing) throw notFound(id);
      const updated = {
        ...existing,
        ...(requestBody || {}),
        ...scope,
        [idField]: existing[idField],
        updatedAt: new Date().toISOString(),
      };
      validateReferences(entity, updated);
      const records = readEntityRecords(entity.name).map((r) => (r === existing ? updated : r));
      await writeEntityRecords(entity.name, records);
      return withRelations(entity, updated, options);
    }
    case "delete": {
      const id = params[idParam];
      const existing = findRecord(id);
      if (!existing) throw notFound(id);
      const related = await deleteRecords(entity, [existing]);
      const result = { deleted: true, [idField]: existing[idField] };
      if (Object.keys(related).length) result.related = related;
      return result;
    }
    default:
      throw httpError(500, `Unknown entity operation "${operation}"`);
  }
}
