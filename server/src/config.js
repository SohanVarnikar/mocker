import fs from "node:fs";
import fs_promises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR =
  process.env.MOCKER_DATA_DIR || path.join(__dirname, "..", "data");
export const CONFIG_DIR = path.join(DATA_DIR, "config");
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
  for (const dir of [DATA_DIR, CONFIG_DIR, STORE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonSync(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf-8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${nanoid(6)}.tmp`;
  await fs_promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs_promises.rename(tmp, file);
}

/**
 * In-memory config store for endpoints/entities/settings, backed by JSON files
 * in data/config/. Every mutation persists to disk and updates the in-memory
 * copy so the mock server always reflects the latest state without restarting.
 */
class ConfigStore {
  constructor() {
    ensureDirs();
    this.endpoints = readJsonSync(ENDPOINTS_FILE, []);
    this.entities = readJsonSync(ENTITIES_FILE, []);
    this.settings = { ...DEFAULT_SETTINGS, ...readJsonSync(SETTINGS_FILE, {}) };
  }

  // ---- Endpoints ----
  listEndpoints() {
    return this.endpoints;
  }

  getEndpoint(id) {
    return this.endpoints.find((e) => e.id === id) || null;
  }

  async saveEndpoint(endpoint) {
    const isNew = !endpoint.id;
    if (isNew) endpoint.id = nanoid(10);
    const idx = this.endpoints.findIndex((e) => e.id === endpoint.id);
    if (idx >= 0) this.endpoints[idx] = endpoint;
    else this.endpoints.push(endpoint);
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

  async saveEntity(entity) {
    const idx = this.entities.findIndex((e) => e.name === entity.name);
    if (idx >= 0) this.entities[idx] = entity;
    else this.entities.push(entity);
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
    return entity;
  }

  async deleteEntity(name) {
    this.entities = this.entities.filter((e) => e.name !== name);
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
  }

  async replaceEntities(list) {
    this.entities = list;
    await writeJsonAtomic(ENTITIES_FILE, this.entities);
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
  exportConfig() {
    return {
      exportedAt: new Date().toISOString(),
      endpoints: this.endpoints,
      entities: this.entities,
    };
  }

  async importConfig({ endpoints = [], entities = [] }, mode = "merge") {
    // Endpoints without an id reuse the id of an existing method+path so re-imports update in place.
    const prepared = endpoints.map((ep) => ({
      ...ep,
      id:
        ep.id ||
        (mode !== "overwrite" &&
          this.endpoints.find(
            (e) => e.method === ep.method && e.path === ep.path,
          )?.id) ||
        nanoid(10),
    }));
    if (mode === "overwrite") {
      await this.replaceEndpoints(prepared);
      await this.replaceEntities(entities);
      return;
    }
    // merge: upsert by id/name
    for (const ep of prepared) await this.saveEndpoint(ep);
    for (const ent of entities) await this.saveEntity(ent);
  }
}

export const configStore = new ConfigStore();
