import fs from "node:fs";
import fs_promises from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { STORE_DIR, configStore, writeJsonAtomic } from "./config.js";
import { httpError } from "./asyncRouter.js";

/**
 * Entity records live in data/store/<entity>.json. They are cached in memory so
 * mock requests don't re-read and re-parse the file each time; the cache is
 * reloaded automatically when the file is edited outside the app.
 *
 * Arrays returned by readEntityRecords() are shared with the cache and must be
 * treated as read-only: build a new array and pass it to writeEntityRecords().
 */
const cache = new Map(); // name -> { records, version, persistedVersion, mtimeMs, size, derived }
const writeChains = new Map(); // name -> promise of the latest queued flush

function storeFile(name) {
  return path.join(STORE_DIR, `${name}.json`);
}

function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function newEntry(records, stat) {
  return {
    records,
    version: 0,
    persistedVersion: 0,
    mtimeMs: stat?.mtimeMs ?? null,
    size: stat?.size ?? null,
    derived: new Map(),
  };
}

function loadFromDisk(name) {
  const file = storeFile(name);
  const stat = statOrNull(file);
  let records = [];
  if (stat) {
    const raw = fs.readFileSync(file, "utf-8");
    if (raw.trim()) {
      try {
        records = JSON.parse(raw);
      } catch (err) {
        throw httpError(500, `store/${name}.json is not valid JSON: ${err.message}`);
      }
    }
    if (!Array.isArray(records)) {
      throw httpError(500, `store/${name}.json must contain a JSON array`);
    }
  }
  const entry = newEntry(records, stat);
  cache.set(name, entry);
  return entry;
}

function getEntry(name) {
  const entry = cache.get(name);
  if (entry) {
    // Unsaved in-memory changes win; otherwise reload if the file changed on disk.
    if (entry.persistedVersion < entry.version) return entry;
    const stat = statOrNull(storeFile(name));
    if ((stat?.mtimeMs ?? null) === entry.mtimeMs && (stat?.size ?? null) === entry.size) {
      return entry;
    }
  }
  return loadFromDisk(name);
}

export function readEntityRecords(name) {
  return getEntry(name).records;
}

async function flush(name, entry, targetVersion) {
  if (entry.failed) throw entry.failed; // changes queued on an entry whose write failed are lost too
  if (cache.get(name) !== entry) return; // entity was dropped meanwhile
  if (entry.persistedVersion >= targetVersion) return; // a later flush already wrote this
  const version = entry.version;
  const file = storeFile(name);
  try {
    await writeJsonAtomic(file, entry.records);
  } catch (err) {
    // Discard the unsaved in-memory state so reads fall back to what is actually on disk.
    entry.failed = err;
    if (cache.get(name) === entry) cache.delete(name);
    throw err;
  }
  const stat = statOrNull(file);
  entry.persistedVersion = Math.max(entry.persistedVersion, version);
  entry.mtimeMs = stat?.mtimeMs ?? null;
  entry.size = stat?.size ?? null;
}

/**
 * Replaces an entity's records. The cache is updated immediately; disk writes are
 * serialized per entity and coalesced, so a burst of saves results in one write
 * of the latest data rather than one full-file rewrite per save.
 */
export function writeEntityRecords(name, records) {
  if (!Array.isArray(records)) throw httpError(400, "Records must be an array");
  let entry = cache.get(name);
  if (!entry) {
    entry = newEntry(records, null);
    cache.set(name, entry);
  }
  entry.records = records;
  entry.version++;
  entry.derived = new Map();
  const target = entry.version;

  const prev = writeChains.get(name) || Promise.resolve();
  const task = prev.catch(() => {}).then(() => flush(name, entry, target));
  writeChains.set(name, task);
  task
    .finally(() => {
      if (writeChains.get(name) === task) writeChains.delete(name);
    })
    .catch(() => {});
  return task.then(() => records);
}

/** Forgets an entity's cached records and deletes its store file. */
export async function dropEntityStore(name) {
  const pending = writeChains.get(name);
  cache.delete(name);
  if (pending) await pending.catch(() => {});
  await fs_promises.rm(storeFile(name), { force: true });
}

function derived(name, key, compute) {
  const entry = getEntry(name);
  if (!entry.derived.has(key)) entry.derived.set(key, compute(entry.records));
  return entry.derived.get(key);
}

/** Map of String(record[field]) -> records, rebuilt lazily after each write. */
export function indexBy(name, field) {
  return derived(name, `index:${field}`, (records) => {
    const index = new Map();
    for (const record of records) {
      const value = record?.[field];
      if (value == null) continue;
      const key = String(value);
      const bucket = index.get(key);
      if (bucket) bucket.push(record);
      else index.set(key, [record]);
    }
    return index;
  });
}

export function recordColumns(name) {
  return derived(name, "columns", (records) => {
    const keys = new Set();
    for (const record of records) {
      if (record && typeof record === "object") for (const k of Object.keys(record)) keys.add(k);
    }
    return [...keys];
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = typeof a === "object" ? JSON.stringify(a) : String(a);
  const sb = typeof b === "object" ? JSON.stringify(b) : String(b);
  return collator.compare(sa, sb);
}

function matchesText(record, needle) {
  if (!record || typeof record !== "object") return false;
  for (const value of Object.values(record)) {
    if (value == null) continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (text.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Server-side filtering, sorting and paging so the UI never has to load a whole store. */
export function queryRecords(name, { q, field, value, sortBy, sortDir, offset = 0, limit = 50 } = {}) {
  let rows = readEntityRecords(name);
  if (field) rows = indexBy(name, field).get(String(value ?? "")) || [];
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) => matchesText(r, needle));
  }
  if (sortBy) {
    const dir = sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * compareValues(a?.[sortBy], b?.[sortBy]));
  }
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(1000, Math.max(1, Number(limit) || 50));
  return {
    total: rows.length,
    offset: start,
    limit: size,
    items: rows.slice(start, start + size),
    columns: recordColumns(name),
  };
}

// Whole-string tokens only, e.g. "{{today+30d}}" (YYYY-MM-DD) or "{{now-1d}}" (ISO timestamp).
const SEED_DATE_TOKEN = /^\{\{\s*(today|now)\s*(?:([+-])\s*(\d+)\s*d)?\s*\}\}$/;

export function resolveSeedTokens(value) {
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

/** Seed data comes from `entity.seedData` when provided, else from config/seeds/<name>.json. */
export function seedRecords(entity) {
  const seed = Array.isArray(entity.seedData)
    ? entity.seedData
    : configStore.getSeedData(entity.name);
  return resolveSeedTokens(Array.isArray(seed) ? seed : []);
}

export async function reseedEntity(entity) {
  return writeEntityRecords(entity.name, seedRecords(entity));
}

export async function ensureEntityStoresInitialized(entities) {
  for (const entity of entities) {
    if (!cache.has(entity.name) && !fs.existsSync(storeFile(entity.name))) {
      await writeEntityRecords(entity.name, seedRecords(entity));
    }
  }
}

export async function clearEntity(name) {
  return writeEntityRecords(name, []);
}

export function nextEntityId(entity, records) {
  if (entity.idStrategy === "uuid") return nanoid(10);
  const idField = entity.idField || "id";
  // A loop rather than Math.max(...ids), which overflows the call stack on large stores.
  let max = 0;
  for (const record of records) {
    const n = Number(record?.[idField]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}
