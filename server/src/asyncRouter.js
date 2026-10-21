import { Router } from "express";

const METHODS = ["get", "post", "put", "patch", "delete", "all"];

// Express 4 ignores rejected promises from async handlers, which leaves the request
// hanging forever. Forward them to the error middleware instead.
function wrap(handler) {
  if (typeof handler !== "function" || handler.length > 3) return handler;
  return function wrapped(req, res, next) {
    const out = handler(req, res, next);
    if (out && typeof out.then === "function") out.catch(next);
  };
}

export function asyncRouter() {
  const router = Router();
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map(wrap));
  }
  return router;
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Turns body-parser and handler errors into `{ error }` JSON responses.
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message = err.message || "Unexpected server error";
  if (err.type === "entity.too.large") {
    message = `Request body is too large (${formatBytes(err.length)}; limit ${formatBytes(err.limit)})`;
  } else if (err.type === "entity.parse.failed") {
    message = `Request body is not valid JSON: ${err.message}`;
  }
  if (status >= 500) console.error("[api-mocker]", err);
  res.status(status).json({ error: message });
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "unknown size";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
