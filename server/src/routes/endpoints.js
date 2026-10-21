import { asyncRouter } from "../asyncRouter.js";
import { configStore } from "../config.js";
import { normalizeEndpoint } from "../normalize.js";

const router = asyncRouter();

router.get("/", (req, res) => {
  res.json(configStore.listEndpoints());
});

router.get("/:id", (req, res) => {
  const endpoint = configStore.getEndpoint(req.params.id);
  if (!endpoint) return res.status(404).json({ error: "Endpoint not found" });
  res.json(endpoint);
});

router.post("/", async (req, res) => {
  const endpoint = normalizeEndpoint(req.body);
  const saved = await configStore.saveEndpoint(endpoint);
  res.status(201).json(saved);
});

router.put("/:id", async (req, res) => {
  const existing = configStore.getEndpoint(req.params.id);
  if (!existing) return res.status(404).json({ error: "Endpoint not found" });
  const endpoint = normalizeEndpoint({ ...req.body, id: req.params.id });
  const saved = await configStore.saveEndpoint(endpoint);
  res.json(saved);
});

router.delete("/:id", async (req, res) => {
  await configStore.deleteEndpoint(req.params.id);
  res.status(204).end();
});

export default router;
