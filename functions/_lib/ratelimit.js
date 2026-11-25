// Best-effort rate limit that never persists anything about the client.
// The key is a one-way hash of the IP with a random salt that lives only in
// this isolate's memory. When the isolate recycles, every counter and the salt
// are gone. Across many isolates the limit is approximate by design; a hard
// limit belongs in a Cloudflare WAF rate-limiting rule.

let salt = null; // created lazily: random values are not allowed in global scope
const buckets = new Map();
const MAX_KEYS = 5000;

async function keyOf(ip) {
  if (!salt) salt = crypto.getRandomValues(new Uint8Array(16));
  const data = new TextEncoder().encode(String(ip));
  const buf = new Uint8Array(salt.length + data.length);
  buf.set(salt);
  buf.set(data, salt.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

// Returns true when the request is over the limit.
export async function overLimit(ip, limit, windowMs = 60000, now = Date.now()) {
  const k = await keyOf(ip || 'unknown');
  let b = buckets.get(k);
  if (!b || now - b.start >= windowMs) {
    if (buckets.size >= MAX_KEYS) {
      for (const [key, v] of buckets) if (now - v.start >= windowMs) buckets.delete(key);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    b = { start: now, n: 0 };
    buckets.set(k, b);
  }
  b.n += 1;
  return b.n > limit;
}

// Throttle for aggregate drop counters, so a flood cannot become a write flood.
const lastCount = new Map();
export function shouldCount(kind, now = Date.now(), everyMs = 30000) {
  const last = lastCount.get(kind) || 0;
  if (now - last < everyMs) return false;
  if (lastCount.size >= 50 && !lastCount.has(kind)) return false;
  lastCount.set(kind, now);
  return true;
}
