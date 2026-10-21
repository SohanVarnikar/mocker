import { asyncRouter, httpError } from "../asyncRouter.js";
import { configStore } from "../config.js";
import {
  readEntityRecords,
  writeEntityRecords,
  reseedEntity,
  clearEntity,
  seedRecords,
  queryRecords,
  nextEntityId,
  indexBy,
  dropEntityStore,
} from "../store.js";
import { validateReferences, deleteRecords } from "../relations.js";
import { normalizeEntity } from "../normalize.js";

const router = asyncRouter();

function requireEntity(name) {
  const entity = configStore.getEntity(name);
  if (!entity) throw httpError(404, `Entity "${name}" not found`);
  return entity;
}

function findById(entity, id) {
  return indexBy(entity.name, entity.idField || "id").get(String(id))?.[0];
}

router.get("/", (req, res) => {
  const entities = configStore.listEntities().map((e) => ({
    ...e,
    recordCount: readEntityRecords(e.name).length,
  }));
  res.json(entities);
});

router.get("/:name", (req, res) => {
  const entity = requireEntity(req.params.name);
  res.json({
    ...entity,
    recordCount: readEntityRecords(entity.name).length,
    seedCount: configStore.getSeedData(entity.name).length,
  });
});

router.post("/", async (req, res) => {
  const entity = normalizeEntity(req.body);
  if (configStore.getEntity(entity.name)) {
    throw httpError(409, `Entity "${entity.name}" already exists`);
  }
  const saved = await configStore.saveEntity(entity);
  await writeEntityRecords(entity.name, seedRecords(entity));
  res.status(201).json(saved);
});

// Partial updates: fields not sent (e.g. scope, defaults, seed data) are kept.
router.put("/:name", async (req, res) => {
  const existing = requireEntity(req.params.name);
  const entity = normalizeEntity({ ...existing, ...req.body, name: existing.name });
  const saved = await configStore.saveEntity(entity);
  res.json(saved);
});

router.delete("/:name", async (req, res) => {
  requireEntity(req.params.name);
  await configStore.deleteEntity(req.params.name);
  await dropEntityStore(req.params.name);
  res.status(204).end();
});

// ---- Records (the mock "database" contents) ----

router.get("/:name/records", (req, res) => {
  const entity = requireEntity(req.params.name);
  res.json(readEntityRecords(entity.name));
});

// Paged/filtered view for the UI: ?offset&limit&q&field&value&sortBy&sortDir
router.get("/:name/query", (req, res) => {
  const entity = requireEntity(req.params.name);
  res.json(queryRecords(entity.name, req.query));
});

router.put("/:name/records", async (req, res) => {
  const entity = requireEntity(req.params.name);
  if (!Array.isArray(req.body)) throw httpError(400, "Body must be an array of records");
  await writeEntityRecords(entity.name, req.body);
  res.json({ count: req.body.length });
});

router.post("/:name/records", async (req, res) => {
  const entity = requireEntity(req.params.name);
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw httpError(400, "Body must be a JSON object");
  }
  const idField = entity.idField || "id";
  const records = readEntityRecords(entity.name);
  const record = { ...req.body };
  if (record[idField] == null || record[idField] === "") {
    record[idField] = nextEntityId(entity, records);
  } else if (findById(entity, record[idField])) {
    throw httpError(409, `A ${entity.name} record with ${idField} ${record[idField]} already exists`);
  }
  validateReferences(entity, record);
  await writeEntityRecords(entity.name, [...records, record]);
  res.status(201).json(record);
});

router.put("/:name/records/:id", async (req, res) => {
  const entity = requireEntity(req.params.name);
  const idField = entity.idField || "id";
  const existing = findById(entity, req.params.id);
  if (!existing) throw httpError(404, "Record not found");
  const updated = { ...existing, ...req.body, [idField]: existing[idField] };
  validateReferences(entity, updated);
  const records = readEntityRecords(entity.name).map((r) => (r === existing ? updated : r));
  await writeEntityRecords(entity.name, records);
  res.json(updated);
});

router.delete("/:name/records/:id", async (req, res) => {
  const entity = requireEntity(req.params.name);
  const existing = findById(entity, req.params.id);
  if (!existing) throw httpError(404, "Record not found");
  const related = await deleteRecords(entity, [existing]);
  res.json({ deleted: true, related });
});

router.post("/:name/reseed", async (req, res) => {
  const entity = requireEntity(req.params.name);
  const records = await reseedEntity(entity);
  res.json({ count: records.length });
});

router.post("/:name/clear", async (req, res) => {
  const entity = requireEntity(req.params.name);
  await clearEntity(entity.name);
  res.json({ count: 0 });
});

// Makes the current stored records the entity's seed data (what Reseed / import restore).
router.post("/:name/seed-from-records", async (req, res) => {
  const entity = requireEntity(req.params.name);
  const records = readEntityRecords(entity.name);
  await configStore.saveSeedData(entity.name, records);
  res.json({ seedCount: records.length });
});

export default router;
