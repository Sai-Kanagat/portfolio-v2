// Small response helpers shared by every function. No dependencies.

export const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...extra },
  });
}

export function empty(status = 204, extra = {}) {
  return new Response(null, { status, headers: { ...NO_STORE, ...extra } });
}

export function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE, ...extra },
  });
}

// Country code from the edge. The header is set by Cloudflare and cannot be
// forged from outside in production. request.cf is the fallback.
export function countryOf(request) {
  const h = request.headers.get('cf-ipcountry');
  const c = (h || (request.cf && request.cf.country) || '').toString().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : null;
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
