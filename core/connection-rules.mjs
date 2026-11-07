// Connection field rules shared by R2Store (main process) and the settings form.
// No Node dependencies: the renderer bundles this file too.
export const R2_HOST = /^[a-z0-9]+(?:\.[a-z]+)?\.r2\.cloudflarestorage\.com$/;
export const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

// null when the endpoint is acceptable, otherwise the error code. Test mode
// accepts only the loopback storage server.
export function endpointProblem(value, { allowLocal = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'invalid_endpoint';
  }
  const host = allowLocal
    ? url.hostname === '127.0.0.1'
    : url.protocol === 'https:' && R2_HOST.test(url.hostname);
  const bare =
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === '/' || url.pathname === '');
  return host && bare ? null : 'invalid_endpoint';
}

export const bucketProblem = (value) =>
  typeof value === 'string' && BUCKET.test(value) ? null : 'invalid_bucket';
