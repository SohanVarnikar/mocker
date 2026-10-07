import { Router } from "express";
import { configStore } from "../config.js";
import { normalizeEndpoint, normalizeEntity } from "../normalize.js";
import {
  readEntityRecords,
  reseedEntity,
  ensureEntityStoresInitialized,
} from "../store.js";

const router = Router();

router.get("/export", (req, res) => {
  const config = configStore.exportConfig();
  // Snapshot current stored records as seed data so teammates get the same dataset.
  if (req.query.includeData === "true") {
    config.entities = config.entities.map((e) => ({
      ...e,
      seedData: readEntityRecords(e.name),
    }));
  }
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="api-mocker-config.json"',
  );
  res.json(config);
});

router.post("/import", async (req, res) => {
  const {
    mode = "merge",
    reseed = true,
    endpoints = [],
    entities = [],
  } = req.body;
  if (!Array.isArray(endpoints) || !Array.isArray(entities)) {
    return res
      .status(400)
      .json({ error: '"endpoints" and "entities" must be arrays' });
  }
  const invalid = [
    ...endpoints.filter((e) => !e?.path),
    ...entities.filter((e) => !e?.name),
  ];
  if (invalid.length) {
    return res
      .status(400)
      .json({
        error: 'Every endpoint needs a "path" and every entity needs a "name"',
      });
  }

  const normalizedEntities = entities.map(normalizeEntity);
  const existingNames = new Set(configStore.listEntities().map((e) => e.name));

  await configStore.importConfig(
    {
      endpoints: endpoints.map(normalizeEndpoint),
      entities: normalizedEntities,
    },
    mode,
  );

  // Overwrite always resets data; merge only resets when asked, otherwise only new entities are seeded.
  for (const entity of normalizedEntities) {
    if (reseed || mode === "overwrite" || !existingNames.has(entity.name)) {
      await reseedEntity(entity);
    }
  }
  await ensureEntityStoresInitialized(configStore.listEntities());

  res.json(configStore.exportConfig());
});

export default router;
