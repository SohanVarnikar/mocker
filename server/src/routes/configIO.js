import { asyncRouter, httpError } from "../asyncRouter.js";
import { configStore } from "../config.js";
import { normalizeEndpoint, normalizeEntity } from "../normalize.js";
import {
  readEntityRecords,
  reseedEntity,
  ensureEntityStoresInitialized,
} from "../store.js";

const router = asyncRouter();

router.get("/export", (req, res) => {
  // Snapshot current stored records as seed data so teammates get the same dataset.
  const config =
    req.query.includeData === "true"
      ? configStore.exportConfig({ seedDataFor: readEntityRecords })
      : configStore.exportConfig();
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="api-mocker-config.json"',
  );
  res.json(config);
});

router.post("/import", async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Import body must be a JSON object with \"endpoints\" and/or \"entities\"");
  }
  const { mode = "merge", reseed = true, endpoints = [], entities = [] } = body;
  if (!("endpoints" in body) && !("entities" in body)) {
    throw httpError(
      400,
      'No "endpoints" or "entities" found. Is this an API Mocker config export?',
    );
  }
  if (!Array.isArray(endpoints) || !Array.isArray(entities)) {
    throw httpError(400, '"endpoints" and "entities" must be arrays');
  }
  if (mode !== "merge" && mode !== "overwrite") {
    throw httpError(400, '"mode" must be "merge" or "overwrite"');
  }
  const missingPath = endpoints.findIndex((e) => !e?.path);
  if (missingPath >= 0) throw httpError(400, `Endpoint #${missingPath + 1} has no "path"`);
  const missingName = entities.findIndex((e) => !e?.name);
  if (missingName >= 0) throw httpError(400, `Entity #${missingName + 1} has no "name"`);

  // Validate everything before writing anything, so a bad file can't half-import.
  const normalizedEndpoints = endpoints.map(normalizeEndpoint);
  const normalizedEntities = entities.map(normalizeEntity);
  const existingNames = new Set(configStore.listEntities().map((e) => e.name));

  const summary = await configStore.importConfig(
    { endpoints: normalizedEndpoints, entities: normalizedEntities },
    mode,
  );

  // Overwrite always resets data; merge only resets when asked, otherwise only new entities are seeded.
  const reseeded = [];
  for (const entity of normalizedEntities) {
    if (reseed || mode === "overwrite" || !existingNames.has(entity.name)) {
      await reseedEntity(entity);
      reseeded.push(entity.name);
    }
  }
  await ensureEntityStoresInitialized(configStore.listEntities());

  res.json({
    mode,
    ...summary,
    reseeded,
    totals: {
      endpoints: configStore.listEndpoints().length,
      entities: configStore.listEntities().length,
    },
  });
});

export default router;
