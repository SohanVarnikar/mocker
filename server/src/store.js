import fs from "node:fs";
import fs_promises from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { STORE_DIR } from "./config.js";

// Serializes writes per-entity file so overlapping requests (e.g. a create and
// an update firing close together) can never interleave and corrupt the file.
const writeQueues = new Map();

function queueWrite(name, task) {
  const prev = writeQueues.get(name) || Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(
    name,
    next.catch(() => {}),
  );
  return next;
}

function storeFile(name) {
  return path.join(STORE_DIR, `${name}.json`);
}

// Whole-string tokens only, e.g. "{{today+30d}}" (YYYY-MM-DD) or "{{now-1d}}" (ISO timestamp).
const SEED_DATE_TOKEN = /^\{\{\s*(today|now)\s*(?:([+-])\s*(\d+)\s*d)?\s*\}\}$/;

function resolveSeedTokens(value) {
  if (Array.isArray(value)) return value.map(resolveSeedTokens);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveSeedTokens(v)]),
    );
  }
  if (typeof value !== "string") return value;
  const m = SEED_DATE_TOKEN.exec(value);
  if (!m) return value;
  const date = new Date();
  if (m[2])
    date.setUTCDate(date.getUTCDate() + (m[2] === "-" ? -1 : 1) * Number(m[3]));
  return m[1] === "today"
    ? date.toISOString().slice(0, 10)
    : date.toISOString();
}

export function seedRecords(entity) {
  return resolveSeedTokens(
    Array.isArray(entity.seedData) ? entity.seedData : [],
  );
}

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

export function readEntityRecords(name) {
  const file = storeFile(name);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf-8");
  if (!raw.trim()) return [];
  return JSON.parse(raw);
}

export async function writeEntityRecords(name, records) {
  return queueWrite(name, async () => {
    const file = storeFile(name);
    const tmp = `${file}.${nanoid(6)}.tmp`;
    await fs_promises.writeFile(tmp, JSON.stringify(records, null, 2), "utf-8");
    await fs_promises.rename(tmp, file);
    return records;
  });
}

export async function reseedEntity(entity) {
  await writeEntityRecords(entity.name, seedRecords(entity));
  return readEntityRecords(entity.name);
}

export async function ensureEntityStoresInitialized(entities) {
  for (const entity of entities) {
    const file = storeFile(entity.name);
    if (!fs.existsSync(file)) {
      await writeEntityRecords(entity.name, seedRecords(entity));
    }
  }
}

export async function clearEntity(name) {
  await writeEntityRecords(name, []);
  return [];
}

export function nextEntityId(entity, records) {
  if (entity.idStrategy === "uuid") return nanoid(10);
  const numericIds = records
    .map((r) => Number(r[entity.idField]))
    .filter((n) => Number.isFinite(n));
  const max = numericIds.length ? Math.max(...numericIds) : 0;
  return max + 1;
}

/**
 * Performs a CRUD-style operation against an entity's local JSON file store,
 * mimicking a real backend so multiple linked endpoints (e.g. POST + PUT)
 * observe each other's changes.
 */
export async function performEntityOperation(
  entity,
  operation,
  params,
  requestBody,
) {
  const idField = entity.idField || "id";
  const idParam = entity.idParam || "id";
  const records = readEntityRecords(entity.name);
  const scope = scopeValues(entity, params);
  const matchesRecord = (r, id) =>
    String(r[idField]) === String(id) && inScope(r, scope);

  switch (operation) {
    case "list": {
      return records.filter((r) => inScope(r, scope));
    }
    case "getById": {
      const id = params[idParam];
      const record = records.find((r) => matchesRecord(r, id));
      if (!record) {
        const err = new Error(
          `${entity.name} with ${idField} ${id} was not found`,
        );
        err.status = 404;
        throw err;
      }
      return record;
    }
    case "create": {
      const id = nextEntityId(entity, records);
      const record = {
        [idField]: id,
        ...resolveSeedTokens(entity.defaults || {}),
        ...(requestBody || {}),
        ...scope,
        createdAt: new Date().toISOString(),
      };
      records.push(record);
      await writeEntityRecords(entity.name, records);
      return record;
    }
    case "update": {
      const id = params[idParam];
      const idx = records.findIndex((r) => matchesRecord(r, id));
      if (idx < 0) {
        const err = new Error(
          `${entity.name} with ${idField} ${id} was not found`,
        );
        err.status = 404;
        throw err;
      }
      records[idx] = {
        ...records[idx],
        ...(requestBody || {}),
        ...scope,
        [idField]: records[idx][idField],
        updatedAt: new Date().toISOString(),
      };
      await writeEntityRecords(entity.name, records);
      return records[idx];
    }
    case "delete": {
      const id = params[idParam];
      const idx = records.findIndex((r) => matchesRecord(r, id));
      if (idx < 0) {
        const err = new Error(
          `${entity.name} with ${idField} ${id} was not found`,
        );
        err.status = 404;
        throw err;
      }
      const [removed] = records.splice(idx, 1);
      await writeEntityRecords(entity.name, records);
      return { deleted: true, [idField]: removed[idField] };
    }
    default: {
      const err = new Error(`Unknown entity operation "${operation}"`);
      err.status = 500;
      throw err;
    }
  }
}
