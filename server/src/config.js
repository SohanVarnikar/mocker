import fs from "node:fs";
import fs_promises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR =
  process.env.MOCKER_DATA_DIR || path.join(__dirname, "..", "data");
export const CONFIG_DIR = path.join(DATA_DIR, "config");
export const SEEDS_DIR = path.join(CONFIG_DIR, "seeds");
export const STORE_DIR = path.join(DATA_DIR, "store");

const ENDPOINTS_FILE = path.join(CONFIG_DIR, "endpoints.json");
const ENTITIES_FILE = path.join(CONFIG_DIR, "entities.json");
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

const DEFAULT_SETTINGS = {
  mockPort: 4000,
  adminPort: 4001,
  corsEnabled: true,
};

function ensureDirs() {
  for (const dir of [DATA_DIR, CONFIG_DIR, SEEDS_DIR, STORE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJsonSync(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf-8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Windows reports these when another process (editor, indexer, antivirus) briefly holds the file.
const TRANSIENT_FS_ERRORS = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${nanoid(6)}.tmp`;
  await fs_promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  for (let attempt = 0; ; attempt++) {
    try {
      await fs_promises.rename(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 8 || !TRANSIENT_FS_ERRORS.has(err.code)) {
        await fs_promises.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      await sleep(25 * 2 ** attempt);
    }
  }
}

function writeJsonSync(file, data) {
  const tmp = `${file}.${nanoid(6)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

export function seedFile(name) {
  return path.join(SEEDS_DIR, `${name}.json`);
}

function splitSeedData(entity) {
  const { seedData, ...definition } = entity;
  return { definition, seedData };
}

/**
 * In-memory config store for endpoints/entities/settings, backed by JSON files
 * in data/config/. Entity seed data lives in data/config/seeds/<entity>.json so
 * entities.json stays small no matter how much mock data an entity carries.
 */
class ConfigStore {
  constructor() {
    ensureDirs();
    this.endpoints = readJsonSync(ENDPOINTS_FILE, []);
    this.entities = this.#migrateInlineSeedData(readJsonSync(ENTITIES_FILE, []));
    this.settings = { ...DEFAULT_SETTINGS, ...readJsonSync(SETTINGS_FILE, {}) };
  }

  // Older versions stored seedData inline in entities.json; move it to seeds/<name>.json.
  #migrateInlineSeedData(entities) {
    if (!entities.some((e) => "seedData" in e)) return entities;
    const migrated = entities.map((entity) => {
      const { definition, seedData } = splitSeedData(entity);
      if (Array.isArray(seedData)) writeJsonSync(seedFile(entity.name), seedData);
      return definition;
    });
    writeJsonSync(ENTITIES_FILE, migrated);
    return migrated;
  }

  // ---- Endpoints ----
  listEndpoints() {
    return this.endpoints;
  }

  getEndpoint(id) {
    return this.endpoints.find((e) => e.id === id) || null;
  }

  #upsertEndpoint(endpoint) {
    const idx = this.endpoints.findIndex((e) => e.id === endpoint.id);
    if (idx >= 0) this.endpoints[idx] = endpoint;
    else this.endpoints.push(endpoint);
    return idx < 0;
  }

  async saveEndpoint(endpoint) {
    if (!endpoint.id) endpoint.id = nanoid(10);
    this.#upsertEndpoint(endpoint);
    await writeJsonAtomic(ENDPOINTS_FILE, this.endpoints);
    return endpoint;
  }

  async deleteEndpoint(id) {
    this.endpoints = this.endpoints.filter((e) => e.id !== id);
    await writeJsonAtomic(ENDPOINTS_FILE, this.endpoints);
  }

  async replaceEndpoints(list) {
    this.endpoints = list;
    await writeJsonAtomic(ENDPOINTS_FILE, this.endpoints);
  }

  // ---- Entities ----
  listEntities() {
    return this.entities;
  }

  getEntity(name) {
    return this.entities.find((e) => e.name === name) || null;
  }

  #upsertEntity(definition) {
    const idx = this.entities.findIndex((e) => e.name === definition.name);
    if (idx >= 0) this.entities[idx] = definition;
    else this.entities.push(definition);
    return idx < 0;
  }

  /** Saves an entity definition; its seed data is only replaced when `seedData` is provided. */
  async saveEntity(entity) {
    const { definition, seedData } = splitSeedData(entity);
    if (Array.isArray(seedData)) await this.saveSeedData(definition.name, seedData);
    this.#upsertEntity(definition);
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
    return definition;
  }

  async deleteEntity(name) {
    this.entities = this.entities.filter((e) => e.name !== name);
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
    await fs_promises.rm(seedFile(name), { force: true });
  }

  getSeedData(name) {
    return readJsonSync(seedFile(name), []);
  }

  async saveSeedData(name, records) {
    await writeJsonAtomic(seedFile(name), records);
  }

  // ---- Settings ----
  getSettings() {
    return this.settings;
  }

  async saveSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    await writeJsonAtomic(SETTINGS_FILE, this.settings);
    return this.settings;
  }

  // ---- Import / Export ----
  exportConfig({ seedDataFor = (name) => this.getSeedData(name) } = {}) {
    return {
      exportedAt: new Date().toISOString(),
      endpoints: this.endpoints,
      entities: this.entities.map((e) => ({ ...e, seedData: seedDataFor(e.name) })),
    };
  }

  /** Imports endpoints/entities in a single write per file; returns added/updated counts. */
  async importConfig({ endpoints = [], entities = [] }, mode = "merge") {
    const overwrite = mode === "overwrite";
    const summary = {
      endpoints: { added: 0, updated: 0 },
      entities: { added: 0, updated: 0 },
    };

    // Endpoints without an id reuse the id of an existing method+path so re-imports update in place.
    const prepared = endpoints.map((ep) => ({
      ...ep,
      id:
        ep.id ||
        (!overwrite &&
          this.endpoints.find((e) => e.method === ep.method && e.path === ep.path)?.id) ||
        nanoid(10),
    }));

    if (overwrite) {
      summary.endpoints.added = prepared.length;
      this.endpoints = prepared;
    } else {
      for (const ep of prepared) {
        if (this.#upsertEndpoint(ep)) summary.endpoints.added++;
        else summary.endpoints.updated++;
      }
    }

    const previousNames = new Set(this.entities.map((e) => e.name));
    if (overwrite) this.entities = [];
    for (const entity of entities) {
      const { definition, seedData } = splitSeedData(entity);
      if (Array.isArray(seedData) || overwrite) {
        await this.saveSeedData(definition.name, Array.isArray(seedData) ? seedData : []);
      }
      this.#upsertEntity(definition);
      if (previousNames.has(definition.name)) summary.entities.updated++;
      else summary.entities.added++;
    }
    if (overwrite) {
      const kept = new Set(this.entities.map((e) => e.name));
      for (const name of previousNames) {
        if (!kept.has(name)) await fs_promises.rm(seedFile(name), { force: true });
      }
    }

    await writeJsonAtomic(ENDPOINTS_FILE, this.endpoints);
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
    return summary;
  }
}

export const configStore = new ConfigStore();