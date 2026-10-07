/**
 * Compiles an Express-style path pattern (e.g. "/api/products/:id") into a
 * regex + ordered param names, without pulling in a routing dependency.
 */
export function compileRoutePattern(pathPattern) {
  const paramNames = [];
  const segments = pathPattern.split('/').filter(Boolean);
  const regexParts = segments.map((seg) => {
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      return '([^/]+)';
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp(`^/${regexParts.join('/')}/?$`);
  return { regex, paramNames };
}

/**
 * Finds the first enabled endpoint whose method + path pattern matches the
 * given request. Endpoints are matched in definition order.
 */
export function matchEndpoint(endpoints, method, urlPath) {
  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;
    if (endpoint.method.toUpperCase() !== method.toUpperCase()) continue;
    const { regex, paramNames } = compileRoutePattern(endpoint.path);
    const match = regex.exec(urlPath);
    if (!match) continue;
    const params = {};
    paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { endpoint, params };
  }
  return null;
}
