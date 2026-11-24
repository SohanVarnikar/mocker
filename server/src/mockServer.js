import express from "express";
import cors from "cors";
import { configStore } from "./config.js";
import { matchEndpoint } from "./routeMatcher.js";
import { performEntityOperation } from "./entityOperations.js";
import { describeLastImport } from "./csvOperations.js";
import { toNameSet } from "./relations.js";
import { renderTemplate, renderText, parseHeaders, scenarioMatches } from "./templating.js";
import { addLogEntry } from "./requestLog.js";
import { jsonErrorHandler } from "./asyncRouter.js";
import { multipartBody } from "./multipart.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Uploaded files are logged as a short description instead of their content.
function loggedRequestBody(req) {
  const files = Object.entries(req.files || {});
  if (!files.length) return req.body;
  return {
    ...req.body,
    ...Object.fromEntries(files.map(([name, f]) => [name, `${f.filename} (${f.size} bytes, ${f.mimeType})`])),
  };
}

export function createMockServer() {
  const app = express();

  if (configStore.getSettings().corsEnabled) {
    app.use(cors());
  }
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(multipartBody());

  app.use(async (req, res, next) => {
    try {
      await handleMockRequest(req, res);
    } catch (err) {
      next(err);
    }
  });
  app.use(jsonErrorHandler);

  return app;
}

async function handleMockRequest(req, res) {
  const start = Date.now();
  const urlPath = req.path;
  const requestBody = loggedRequestBody(req);
  const log = (entry) =>
    addLogEntry({
      method: req.method,
      path: urlPath,
      durationMs: Date.now() - start,
      requestBody,
      ...entry,
    });
  const match = matchEndpoint(
    configStore.listEndpoints(),
    req.method,
    urlPath,
  );

  if (!match) {
    const body = { error: `No mock defined for ${req.method} ${urlPath}` };
    res.status(404).json(body);
    log({ endpointLabel: null, scenarioName: null, statusCode: 404, responseBody: body });
    return;
  }

  const { endpoint, params } = match;
  const endpointLabel = `${endpoint.method} ${endpoint.path}`;
  const request = { body: req.body, query: req.query, params, files: req.files || {} };
  const matchCtx = { request, params };
  const scenario =
    endpoint.scenarios.find((s) => scenarioMatches(s, matchCtx)) ||
    endpoint.scenarios.find((s) => s.id === endpoint.activeScenarioId) ||
    endpoint.scenarios[0];

  if (!scenario) {
    const body = {
      error: `Endpoint ${endpointLabel} has no response scenario configured`,
    };
    res.status(500).json(body);
    log({ endpointLabel, scenarioName: null, statusCode: 500, responseBody: body });
    return;
  }

  const link = endpoint.entityLink;
  let result = null;
  let lastImport;
  try {
    if (link && scenario.usesEntity) {
      const entity = configStore.getEntity(link.entityName);
      if (!entity)
        throw Object.assign(
          new Error(`Entity "${link.entityName}" not found`),
          { status: 500 },
        );
      // bodyTemplate reshapes the request body (rendered like a response body) before it is stored.
      const entityBody = link.bodyTemplate
        ? renderTemplate(link.bodyTemplate, matchCtx)
        : req.body;
      result = await performEntityOperation(
        entity,
        link.operation,
        params,
        entityBody,
        {
          // Configured on the endpoint, or requested ad hoc via ?_expand=a,b&_embed=c
          expand: toNameSet(link.expand, req.query._expand),
          embed: toNameSet(link.embed, req.query._embed),
          nested: link.nested,
          rawBody: req.body,
          files: request.files,
          import: link.import,
          export: link.export,
          batches: link.batches,
        },
      );
    }
    if (link?.batches) lastImport = describeLastImport(link.batches, params);
  } catch (err) {
    const status = err.status || 500;
    // Operations may provide the backend's own error body (e.g. upload errors); others get { error }.
    const body = err.body ?? { error: err.message };
    res.status(status).json(body);
    log({ endpointLabel, scenarioName: scenario.name, statusCode: status, responseBody: body });
    return;
  }

  if (scenario.delayMs) await sleep(scenario.delayMs);

  const ctx = { request, result, params, lastImport };
  const headers = parseHeaders(scenario.headers);
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  // A non-JSON Content-Type (e.g. text/csv) renders the body as plain text instead of JSON.
  const isText = Boolean(contentType) && !/json/i.test(contentType);
  let responseBody;
  try {
    responseBody = isText ? renderText(scenario.body, ctx) : renderTemplate(scenario.body, ctx);
  } catch (err) {
    res.status(500).json({ error: err.message });
    log({ endpointLabel, scenarioName: scenario.name, statusCode: 500, responseBody: { error: err.message } });
    return;
  }

  // An empty body sends no bytes (and no Content-Type / Content-Disposition describing them).
  const isEmpty = isText ? responseBody === "" : String(scenario.body ?? "").trim() === "";
  for (const [key, value] of Object.entries(headers)) {
    if (isEmpty && /^content-(type|disposition)$/i.test(key)) continue;
    res.setHeader(key, renderText(value, ctx));
  }
  res.status(scenario.statusCode || 200);
  if (isEmpty) res.end();
  else if (isText) res.send(responseBody);
  else res.json(responseBody);

  log({
    endpointLabel,
    scenarioName: scenario.name,
    statusCode: scenario.statusCode || 200,
    responseBody: isEmpty ? null : responseBody,
  });
}
