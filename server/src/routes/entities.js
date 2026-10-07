import { Router } from "express";
import { configStore } from "../config.js";
import {
  readEntityRecords,
  writeEntityRecords,
  reseedEntity,
  clearEntity,
  seedRecords,
} from "../store.js";
import { normalizeEntity } from "../normalize.js";

const router = Router();

router.get("/", (req, res) => {
  const entities = configStore.listEntities().map((e) => ({
    ...e,
    recordCount: readEntityRecords(e.name).length,
  }));
  res.json(entities);
});

router.get("/:name", (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  res.json({ ...entity, recordCount: readEntityRecords(entity.name).length });
});

router.post("/", async (req, res) => {
  const entity = normalizeEntity(req.body);
  if (configStore.getEntity(entity.name)) {
    return res
      .status(409)
      .json({ error: `Entity "${entity.name}" already exists` });
  }
  const saved = await configStore.saveEntity(entity);
  await writeEntityRecords(entity.name, seedRecords(entity));
  res.status(201).json(saved);
});

router.put("/:name", async (req, res) => {
  const existing = configStore.getEntity(req.params.name);
  if (!existing) return res.status(404).json({ error: "Entity not found" });
  const entity = normalizeEntity({ ...req.body, name: req.params.name });
  const saved = await configStore.saveEntity(entity);
  res.json(saved);
});

router.delete("/:name", async (req, res) => {
  await configStore.deleteEntity(req.params.name);
  res.status(204).end();
});

// ---- Records (the mock "database" contents) ----

router.get("/:name/records", (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  res.json(readEntityRecords(entity.name));
});

router.put("/:name/records", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  if (!Array.isArray(req.body))
    return res.status(400).json({ error: "Body must be an array of records" });
  await writeEntityRecords(entity.name, req.body);
  res.json(req.body);
});

router.post("/:name/records", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  const records = readEntityRecords(entity.name);
  records.push(req.body);
  await writeEntityRecords(entity.name, records);
  res.status(201).json(req.body);
});

router.put("/:name/records/:id", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  const idField = entity.idField || "id";
  const records = readEntityRecords(entity.name);
  const idx = records.findIndex(
    (r) => String(r[idField]) === String(req.params.id),
  );
  if (idx < 0) return res.status(404).json({ error: "Record not found" });
  records[idx] = {
    ...records[idx],
    ...req.body,
    [idField]: records[idx][idField],
  };
  await writeEntityRecords(entity.name, records);
  res.json(records[idx]);
});

router.delete("/:name/records/:id", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  const idField = entity.idField || "id";
  const records = readEntityRecords(entity.name);
  const filtered = records.filter(
    (r) => String(r[idField]) !== String(req.params.id),
  );
  await writeEntityRecords(entity.name, filtered);
  res.status(204).end();
});

router.post("/:name/reseed", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  const records = await reseedEntity(entity);
  res.json(records);
});

router.post("/:name/clear", async (req, res) => {
  const entity = configStore.getEntity(req.params.name);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  const records = await clearEntity(entity.name);
  res.json(records);
});

export default router;
