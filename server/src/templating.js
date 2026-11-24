import { nanoid } from "nanoid";

const TOKEN_SOURCE = ":[a-zA-Z_][a-zA-Z0-9_]*|\\{\\{\\s*[^}]+\\s*\\}\\}";
const JSON_TOKEN_PATTERN = new RegExp(`"(${TOKEN_SOURCE})"|(${TOKEN_SOURCE})`, "g");

function getPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// key=value pairs of a filter; values with spaces are quoted: map net='Net Sales'
const FILTER_ARG = /([^\s=]+)=(?:'([^']*)'|"([^"]*)"|(\S*))/g;

function applyFilter(value, filterText) {
  const m = /^(\w+)\s*([\s\S]*)$/.exec(filterText.trim());
  if (m?.[1] === "map") {
    const table = {};
    for (const [, key, single, double, bare] of m[2].matchAll(FILTER_ARG)) {
      table[key] = single ?? double ?? bare;
    }
    return value != null && Object.hasOwn(table, String(value)) ? table[String(value)] : value;
  }
  throw Object.assign(new Error(`Unknown template filter "${filterText.trim()}"`), { status: 500 });
}

function resolveToken(token, ctx) {
  if (token.startsWith(":")) {
    return ctx.params ? ctx.params[token.slice(1)] : undefined;
  }
  // {{ path | filter args }}
  const [path, ...filters] = token.slice(2, -2).split("|");
  const segments = path.trim().split(".");
  const root = segments[0];

  let value;
  if (root === "now") value = new Date().toISOString();
  else if (root === "uuid") value = nanoid(10);
  else if (root === "result") value = getPath(ctx.result, segments.slice(1));
  else if (root === "request") value = getPath(ctx.request, segments.slice(1));
  else if (root === "lastImport") value = getPath(ctx.lastImport, segments.slice(1));
  for (const filter of filters) value = applyFilter(value, filter);
  return value;
}

/**
 * Renders a JSON-shaped response body template. Supports:
 *   :paramName                    -> path param value
 *   {{request.body.field}}        -> value from the incoming request
 *   {{request.query.field}}
 *   {{request.params.field}}
 *   {{result}} / {{result.field}} -> value(s) from an entity operation
 *   {{now}}                       -> current ISO timestamp
 *   {{uuid}}                      -> a generated id
 *   {{lastImport.today}}          -> latest import batch (entityLink.batches): today / user / time
 *   {{path | map A=x B='y z'}}    -> replaces a value found in the table, others pass through
 *
 * Tokens are resolved to their JSON representation, so both quoted
 * ("value": ":id") and bare ("value": {{result}}) placeholders work.
 */
export function renderTemplate(templateStr, ctx) {
  if (templateStr == null || templateStr === "") return null;

  // Resolve quoted and bare tokens together so inserted user data is never evaluated as a template.
  const substituted = templateStr.replace(JSON_TOKEN_PATTERN, (_match, quoted, bare) => {
    const value = resolveToken(quoted || bare, ctx);
    return JSON.stringify(value === undefined ? null : value);
  });

  try {
    return JSON.parse(substituted);
  } catch {
    const err = new Error(
      `Response body template is not valid JSON after rendering: ${substituted}`,
    );
    err.status = 500;
    throw err;
  }
}

const TEXT_TOKEN_PATTERN = /\{\{[^}]+\}\}/g;

/**
 * Renders a plain-text template (non-JSON bodies such as CSV, and header values): only {{...}}
 * tokens are replaced, strings as-is, null/undefined as "" and objects as JSON.
 */
export function renderText(templateStr, ctx) {
  if (templateStr == null) return "";
  return String(templateStr).replace(TEXT_TOKEN_PATTERN, (token) => {
    const value = resolveToken(token, ctx);
    if (value == null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

/**
 * A scenario's optional `match` maps dotted paths (e.g. "request.body.customerNumber",
 * "request.query.status", "params.rebateId") to expected values; all must be equal.
 */
export function scenarioMatches(scenario, ctx) {
  const entries = Object.entries(scenario.match || {});
  if (!entries.length) return false;
  return entries.every(([dotted, expected]) => {
    const actual = getPath(ctx, dotted.split("."));
    return actual !== undefined && String(actual) === String(expected);
  });
}

export function parseHeaders(headerText) {
  if (!headerText) return {};
  const headers = {};
  for (const line of headerText.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}
