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

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Merges plain objects recursively; any other value in `source` (arrays included) replaces the target's. */
export function mergeDeep(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeDeep(out[key], value) : value;
  }
  return out;
}

const bodyObject = (body) => (isPlainObject(body) ? body : {});

function dateOnly(value) {
  const text = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    ? text
    : null;
}

function dayBefore(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Operations on the items of an array field inside a record (e.g. a tier's `versions`),
 * configured by `entityLink.nested`:
 *   field                  array field holding the items
 *   idField                item id field (default "id")
 *   idParam                path param with the item id, for getById/update/delete
 *   idStrategy             "increment" (unique across all records, default) or "uuid"
 *   defaults               fields for items made by `create`
 *   supersede              on `create`: { idFrom, startField, endField } ends the item named by
 *                          request.body[idFrom] the day before the new item's startField, or
 *                          removes it when the new item starts on or before it
 *   deleteParentWhenEmpty  `delete` of the last item removes the whole record
 */
async function performNestedOperation(ctx, operation, params, requestBody, rawBody) {
  const { entity, nested, idField, idParam, findRecord, notFound } = ctx;
  const parentId = params[idParam];
  const parent = findRecord(parentId);
  if (!parent) throw notFound(parentId);

  const field = nested.field;
  const itemIdField = nested.idField || "id";
  const items = Array.isArray(parent[field]) ? parent[field] : [];
  const itemNotFound = (id) =>
    httpError(404, `${entity.name} ${parent[idField]} has no ${field} item with ${itemIdField} ${id}`);
  const findItem = (id) => items.find((item) => String(item?.[itemIdField]) === String(id));
  const save = async (nextItems) => {
    const updated = { ...parent, [field]: nextItems };
    const records = readEntityRecords(entity.name).map((r) => (r === parent ? updated : r));
    await writeEntityRecords(entity.name, records);
  };
  const itemParam = () => {
    const id = params[nested.idParam || "id"];
    const item = findItem(id);
    if (!item) throw itemNotFound(id);
    return item;
  };

  switch (operation) {
    case "list":
      return items;
    case "getById":
      return itemParam();
    case "create": {
      let id;
      if (nested.idStrategy === "uuid") {
        id = nextEntityId({ idStrategy: "uuid" }, []);
      } else {
        let max = 0;
        for (const record of readEntityRecords(entity.name)) {
          for (const item of Array.isArray(record?.[field]) ? record[field] : []) {
            const n = Number(item?.[itemIdField]);
            if (Number.isFinite(n) && n > max) max = n;
          }
        }
        id = max + 1;
      }
      const item = {
        [itemIdField]: id,
        ...mergeDeep(resolveSeedTokens(nested.defaults || {}), bodyObject(requestBody)),
      };
      let nextItems = [...items];
      const supersede = nested.supersede;
      const baseId = supersede ? bodyObject(rawBody)[supersede.idFrom] : undefined;
      if (baseId != null) {
        const startField = supersede.startField || "effectiveDate";
        const endField = supersede.endField || "endDate";
        const base = findItem(baseId);
        if (!base) throw itemNotFound(baseId);
        const start = dateOnly(item[startField]);
        if (!start) throw httpError(400, `${startField} must be a YYYY-MM-DD date`);
        const baseStart = dateOnly(base[startField]);
        if (baseStart && start <= baseStart) {
          nextItems = nextItems.filter((i) => i !== base);
        } else {
          const end = dayBefore(start);
          const baseEnd = dateOnly(base[endField]);
          if (!baseEnd || baseEnd > end) {
            nextItems = nextItems.map((i) => (i === base ? { ...base, [endField]: end } : i));
          }
        }
      }
      nextItems.push(item);
      await save(nextItems);
      return item;
    }
    case "update": {
      const existing = itemParam();
      const updated = {
        ...mergeDeep(existing, bodyObject(requestBody)),
        [itemIdField]: existing[itemIdField],
      };
      await save(items.map((i) => (i === existing ? updated : i)));
      return updated;
    }
    case "delete": {
      const existing = itemParam();
      const nextItems = items.filter((i) => i !== existing);
      const result = { deleted: true, [itemIdField]: existing[itemIdField] };
      if (!nextItems.length && nested.deleteParentWhenEmpty) {
        const related = await deleteRecords(entity, [parent]);
        result.parentDeleted = true;
        if (Object.keys(related).length) result.related = related;
      } else {
        await save(nextItems);
      }
      return result;
    }
    default:
      throw httpError(500, `Unknown entity operation "${operation}"`);
  }
}

/**
 * Performs a CRUD-style operation against an entity's store, mimicking a real
 * backend so multiple linked endpoints (e.g. POST + PUT) observe each other's
 * changes. `options.expand` / `options.embed` add related records to the result;
 * `options.nested` targets items of an array field inside a record instead.
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

  if (options.nested?.field) {
    return performNestedOperation(
      { entity, nested: options.nested, idField, idParam, findRecord, notFound },
      operation,
      params,
      requestBody,
      options.rawBody === undefined ? requestBody : options.rawBody,
    );
  }

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
        ...mergeDeep(resolveSeedTokens(entity.defaults || {}), bodyObject(requestBody)),
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
        ...mergeDeep(existing, bodyObject(requestBody)),
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
