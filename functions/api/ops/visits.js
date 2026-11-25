// GET /api/ops/visits?days=7&limit=50&before=<first_ts>&device=desktop|mobile|tablet -> { sessions:[{sid,first_ts,last_ts,landing,link,ref_host,country,device,pages,events,active_s}] }
// GET /api/ops/visits?sid=<16 hex> -> { session, events:[{ts,name,path,params}] }   (timeline of one anonymous visit)
import { all, one, reply, scopeOf, rangeOf, deviceFilter, badDevice } from '../../_lib/ops.js';
import { json } from '../../_lib/http.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const w = scopeOf(url).where();
  const sid = url.searchParams.get('sid');
  if (sid !== null) {
    if (!/^[0-9a-f]{16}$/.test(sid)) return json({ error: 'sid' }, 400);
    const session = await one(env, 'SELECT * FROM sessions WHERE sid = ?1', [sid]);
    const events = await all(env, 'SELECT ts, name, path, params FROM events WHERE sid = ?1 ORDER BY ts, id LIMIT 1000', [sid]);
    return reply(url, { session, events });
  }
  const { from, to } = rangeOf(url);
  const dev = deviceFilter(url, 4);
  if (!dev.ok) return badDevice();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const before = Number(url.searchParams.get('before')) || to;
  const sessions = await all(env,
    `SELECT sid, first_ts, last_ts, landing, link, ref_host, country, device, pages, events, ROUND(active_ms / 1000.0) AS active_s
     FROM sessions WHERE first_ts >= ?1 AND first_ts < ?2 AND ${w}${dev.sql} ORDER BY first_ts DESC LIMIT ?3`, [from, before, limit, ...dev.binds]);
  return reply(url, { sessions }, dev.value);
}
