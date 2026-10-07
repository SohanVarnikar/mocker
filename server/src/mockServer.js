import express from "express";
import cors from "cors";
import { configStore } from "./config.js";
import { matchEndpoint } from "./routeMatcher.js";
import { performEntityOperation } from "./store.js";
import { renderTemplate, parseHeaders, scenarioMatches } from "./templating.js";
import { addLogEntry } from "./requestLog.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockServer() {
  const app = express();

  if (configStore.getSettings().corsEnabled) {
    app.use(cors());
  }
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(async (req, res) => {
    const start = Date.now();
    const urlPath = req.path;
    const match = matchEndpoint(
      configStore.listEndpoints(),
      req.method,
      urlPath,
    );

    if (!match) {
      const body = { error: `No mock defined for ${req.method} ${urlPath}` };
      res.status(404).json(body);
      addLogEntry({
        method: req.method,
        path: urlPath,
        endpointLabel: null,
        scenarioName: null,
        statusCode: 404,
        durationMs: Date.now() - start,
        requestBody: req.body,
        responseBody: body,
      });
      return;
    }

    const { endpoint, params } = match;
    const endpointLabel = `${endpoint.method} ${endpoint.path}`;
    const matchCtx = {
      request: { body: req.body, query: req.query, params },
      params,
    };
    const scenario =
      endpoint.scenarios.find((s) => scenarioMatches(s, matchCtx)) ||
      endpoint.scenarios.find((s) => s.id === endpoint.activeScenarioId) ||
      endpoint.scenarios[0];

    if (!scenario) {
      const body = {
        error: `Endpoint ${endpointLabel} has no response scenario configured`,
      };
      res.status(500).json(body);
      addLogEntry({
        method: req.method,
        path: urlPath,
        endpointLabel,
        scenarioName: null,
        statusCode: 500,
        durationMs: Date.now() - start,
        requestBody: req.body,
        responseBody: body,
      });
      return;
    }

    let result = null;
    if (endpoint.entityLink && scenario.usesEntity) {
      const entity = configStore.getEntity(endpoint.entityLink.entityName);
      try {
        if (!entity)
          throw Object.assign(
            new Error(`Entity "${endpoint.entityLink.entityName}" not found`),
            { status: 500 },
          );
        result = await performEntityOperation(
          entity,
          endpoint.entityLink.operation,
          params,
          req.body,
        );
      } catch (err) {
        const status = err.status || 500;
        const body = { error: err.message };
        res.status(status).json(body);
        addLogEntry({
          method: req.method,
          path: urlPath,
          endpointLabel,
          scenarioName: scenario.name,
          statusCode: status,
          durationMs: Date.now() - start,
          requestBody: req.body,
          responseBody: body,
        });
        return;
      }
    }

    if (scenario.delayMs) await sleep(scenario.delayMs);

    const ctx = {
      request: { body: req.body, query: req.query, params },
      result,
      params,
    };
    let responseBody;
    try {
      responseBody = renderTemplate(scenario.body, ctx);
    } catch (err) {
      res.status(500).json({ error: err.message });
      addLogEntry({
        method: req.method,
        path: urlPath,
        endpointLabel,
        scenarioName: scenario.name,
        statusCode: 500,
        durationMs: Date.now() - start,
        requestBody: req.body,
        responseBody: { error: err.message },
      });
      return;
    }

    const headers = parseHeaders(scenario.headers);
    for (const [key, value] of Object.entries(headers))
      res.setHeader(key, value);
    res.status(scenario.statusCode || 200);
    res.json(responseBody);

    addLogEntry({
      method: req.method,
      path: urlPath,
      endpointLabel,
      scenarioName: scenario.name,
      statusCode: scenario.statusCode || 200,
      durationMs: Date.now() - start,
      requestBody: req.body,
      responseBody,
    });
  });

  return app;
}
