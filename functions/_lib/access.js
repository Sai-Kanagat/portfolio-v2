// Cloudflare Access JWT verification, done in the function so /ops and
// /api/ops fail closed even if the Access application is misconfigured.
// RS256 only. Checks kid, signature, iss, aud, exp, nbf and the email allow list.
// Missing configuration denies everything.
import { json, text } from './http.js';

const TEAM_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
let jwksCache = { team: '', at: 0, keys: [] };
const keyCache = new Map();

function b64uBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

async function getJwks(env, team, force) {
  // Test hook: only honoured when ALLOW_TEST_JWKS is explicitly bound to "1".
  if (env.ALLOW_TEST_JWKS === '1' && env.TEST_JWKS_JSON) return JSON.parse(env.TEST_JWKS_JSON).keys || [];
  const now = Date.now();
  if (!force && jwksCache.team === team && now - jwksCache.at < 600000) return jwksCache.keys;
  if (force && jwksCache.team === team && now - jwksCache.at < 60000) return jwksCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error('jwks');
  const keys = (await r.json()).keys || [];
  jwksCache = { team, at: now, keys };
  keyCache.clear();
  return keys;
}

async function importKey(jwk) {
  const id = jwk.kid + ':' + jwk.n;
  if (keyCache.has(id)) return keyCache.get(id);
  const k = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  keyCache.set(id, k);
  return k;
}

export async function verifyAccess(request, env) {
  const team = (env.CF_ACCESS_TEAM_DOMAIN || '').toLowerCase();
  const aud = env.CF_ACCESS_AUD || '';
  const emails = (env.OPS_ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (!TEAM_RE.test(team) || !aud || !emails.length) return { ok: false, reason: 'unconfigured' };
  let token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('cookie') || '');
    token = m && m[1];
  }
  if (!token) return { ok: false, reason: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  try {
    const header = b64uJson(parts[0]);
    const claims = b64uJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'alg' };
    let keys = await getJwks(env, team, false);
    let jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) {
      keys = await getJwks(env, team, true);
      jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    }
    if (!jwk) return { ok: false, reason: 'kid' };
    const key = await importKey(jwk);
    const okSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!okSig) return { ok: false, reason: 'signature' };
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== `https://${team}`) return { ok: false, reason: 'iss' };
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return { ok: false, reason: 'aud' };
    if (typeof claims.exp !== 'number' || claims.exp + 30 < now) return { ok: false, reason: 'exp' };
    if (typeof claims.nbf === 'number' && claims.nbf - 30 > now) return { ok: false, reason: 'nbf' };
    const email = String(claims.email || '').toLowerCase();
    if (!email || !emails.includes(email)) return { ok: false, reason: 'email' };
    return { ok: true, email };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// Shared guard for the two middleware files.
export async function guard(context, { api }) {
  const { request, env, next } = context;
  const v = await verifyAccess(request, env);
  const hdr = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
  if (!v.ok) {
    console.warn('ops denied:', v.reason);
    return api ? json({ error: 'forbidden' }, 403, hdr) : text('Forbidden', 403, hdr);
  }
  if (api && request.method !== 'GET' && request.method !== 'HEAD') {
    // Access uses a cookie, so state-changing calls need a same-origin Origin.
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403, hdr);
  }
  context.data.email = v.email;
  const res = await next();
  const out = new Response(res.body, res);
  for (const [k, val] of Object.entries(hdr)) out.headers.set(k, val);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'no-referrer');
  return out;
}
