// GET /api/ops/live  -> { now, active_sessions, events_1m, events_30m, top_pages:[{path,n}], recent:[{ts,name,path,device,country,link,params}] }
import { all, one, reply } from '../../_lib/ops.js';
import { scopeOf } from '../../_lib/ops.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const w = scopeOf(url).where();
  const now = Date.now();
  const [a, b, c] = await Promise.all([
    one(env, `SELECT COUNT(*) AS n FROM sessions WHERE last_ts > ?1 AND ${w}`, [now - 5 * 60000]),
    one(env, `SELECT SUM(ts > ?1) AS m1, COUNT(*) AS m30 FROM events WHERE ts > ?2 AND ${w}`, [now - 60000, now - 30 * 60000]),
    all(env, `SELECT path, COUNT(*) AS n FROM events WHERE ts > ?1 AND name = 'page_view' AND ${w} GROUP BY path ORDER BY n DESC LIMIT 10`, [now - 30 * 60000]),
  ]);
  const recent = await all(env, `SELECT ts, name, path, device, country, link, params FROM events WHERE ${w} ORDER BY id DESC LIMIT 50`);
  return reply(url, { now, active_sessions: a.n || 0, events_1m: b.m1 || 0, events_30m: b.m30 || 0, top_pages: c, recent });
}
