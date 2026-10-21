import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import endpointsRouter from "./routes/endpoints.js";
import entitiesRouter from "./routes/entities.js";
import logsRouter from "./routes/logs.js";
import settingsRouter from "./routes/settings.js";
import configIORouter from "./routes/configIO.js";
import { jsonErrorHandler } from "./asyncRouter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_UI_DIST =
  process.env.MOCKER_UI_DIR ||
  path.join(__dirname, "..", "..", "admin-ui", "dist");

export function createAdminServer() {
  const app = express();
  app.use(cors());
  // Config imports and raw record saves can carry large datasets.
  app.use(express.json({ limit: "200mb" }));

  app.use("/api/endpoints", endpointsRouter);
  app.use("/api/entities", entitiesRouter);
  app.use("/api/logs", logsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/config", configIORouter);
  app.use("/api", jsonErrorHandler);

  // In production (after `npm run build:ui`), serve the built Vue SPA from
  // the same admin port so the whole tool runs as a single `npm start`.
  if (fs.existsSync(ADMIN_UI_DIST)) {
    app.use(express.static(ADMIN_UI_DIST));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(ADMIN_UI_DIST, "index.html"));
    });
  }

  return app;
}
