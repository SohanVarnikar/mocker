import { nanoid } from "nanoid";

const TOKEN_SOURCE = ":[a-zA-Z_][a-zA-Z0-9_]*|\\{\\{\\s*[^}]+\\s*\\}\\}";
const QUOTED_TOKEN_PATTERN = new RegExp(`"(${TOKEN_SOURCE})"`, "g");
const BARE_TOKEN_PATTERN = new RegExp(TOKEN_SOURCE, "g");

function getPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function resolveToken(token, ctx) {
  if (token.startsWith(":")) {
    return ctx.params ? ctx.params[token.slice(1)] : undefined;
  }
  // {{ ... }}
  const inner = token.slice(2, -2).trim();
  const segments = inner.split(".");
  const root = segments[0];

  if (root === "now") return new Date().toISOString();
  if (root === "uuid") return nanoid(10);
  if (root === "result") return getPath(ctx.result, segments.slice(1));
  if (root === "request") return getPath(ctx.request, segments.slice(1));
  return undefined;
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
 *
 * Tokens are resolved to their JSON representation, so both quoted
 * ("value": ":id") and bare ("value": {{result}}) placeholders work.
 */
export function renderTemplate(templateStr, ctx) {
  if (templateStr == null || templateStr === "") return null;

  // Phase 1: tokens written as a quoted JSON string, e.g. "id": ":id" or
  // "name": "{{request.body.name}}" — replace the whole quoted token
  // (including its surrounding quotes) with the JSON representation of value.
  let substituted = templateStr.replace(
    QUOTED_TOKEN_PATTERN,
    (_match, token) => {
      const value = resolveToken(token, ctx);
      return JSON.stringify(value === undefined ? null : value);
    },
  );

  // Phase 2: tokens written bare (unquoted) to splice in a whole object/array,
  // e.g. "products": {{result}} — replace directly with its JSON form.
  substituted = substituted.replace(BARE_TOKEN_PATTERN, (token) => {
    const value = resolveToken(token, ctx);
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
