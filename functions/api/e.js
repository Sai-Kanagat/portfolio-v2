// POST /api/e  ingest endpoint (tracking/CONTRACT.md wire format).
// 204 stored, 400 invalid, 403 origin, 413 size, 429 rate. Bots get 204 and are
// dropped (header x-sk-dropped says why). No IP, user agent or typed text is stored.
import { empty, json, countryOf } from '../_lib/http.js';
import { requestOriginAllowed } from '../_lib/origin.js';
import { overLimit, shouldCount } from '../_lib/ratelimit.js';
import { isBotUA, isHeadlessOnly, deviceOf } from '../_lib/ua.js';
import { validateBatch, MAX_BYTES, Reject } from '../_lib/validate.js';
import { writeBatch, countDrop } from '../_lib/store.js';

async function readLimited(request, max) {
  const reader = request.body && request.body.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {}
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function drop(env, ctx, kind, detail) {
  if (shouldCount(kind + ':' + detail)) ctx.waitUntil(countDrop(env, kind, detail));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return empty(405, { Allow: 'POST' });

  if (!requestOriginAllowed(request, env)) {
    drop(env, context, 'origin', '');
    return json({ error: 'origin' }, 403);
  }

  const limit = Math.min(Math.max(parseInt(env.RATE_LIMIT_PER_MIN, 10) || 120, 1), 100000);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (await overLimit(ip, limit)) {
    drop(env, context, 'rate', '');
    return json({ error: 'rate' }, 429, { 'Retry-After': '60' });
  }

  const declared = parseInt(request.headers.get('content-length') || '0', 10);
  if (declared > MAX_BYTES) {
    drop(env, context, 'oversize', '');
    return json({ error: 'size' }, 413);
  }
  const raw = await readLimited(request, MAX_BYTES);
  if (raw === null) {
    drop(env, context, 'oversize', '');
    return json({ error: 'size' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    drop(env, context, 'invalid', 'json');
    return json({ error: 'json' }, 400);
  }

  let batch;
  try {
    batch = validateBatch(body);
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    drop(env, context, e.code === 'unknown_event' ? 'unknown_event' : 'invalid', e.code === 'unknown_event' ? e.detail : e.code);
    return json({ error: e.code }, 400);
  }

  // Bots and previewers are dropped after validation so the check cannot be
  // used to probe the schema. Headless Chrome is allowed for flagged test traffic.
  const ua = request.headers.get('user-agent') || '';
  const botish = isBotUA(ua) && !(batch.ctx.test && isHeadlessOnly(ua));
  if (botish) return empty(204, { 'x-sk-dropped': 'bot' });

  try {
    await writeBatch(env, batch, { country: countryOf(request), device: deviceOf(ua) });
  } catch (e) {
    console.error('ingest write failed', e && e.message);
    return json({ error: 'store' }, 503);
  }
  return empty(204);
}
