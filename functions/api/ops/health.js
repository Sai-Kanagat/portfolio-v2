// GET /api/ops/health -> { last_event_ts, events_24h, sessions_24h, ingest:[{day,kind,detail,n}], checks:[{ts,check_name,status,detail}], consent:{shown,granted,denied} }
import { all, one, reply, scopeOf } from '../../_lib/ops.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const w = scopeOf(url).where(); const now = Date.now();
  const [last, c24, s24, ingest, checks, consent] = await Promise.all([
    one(env, 'SELECT MAX(ts) AS ts FROM events'),
    one(env, `SELECT COUNT(*) AS n FROM events WHERE ts > ?1 AND ${w}`, [now - 864e5]),
    one(env, `SELECT COUNT(*) AS n FROM sessions WHERE last_ts > ?1 AND ${w}`, [now - 864e5]),
    all(env, 'SELECT day, kind, detail, n FROM ingest_stats WHERE day >= ?1 ORDER BY day DESC, n DESC LIMIT 60', [new Date(now - 90 * 864e5).toISOString().slice(0, 10)]),
    all(env, 'SELECT ts, check_name, status, detail FROM health ORDER BY id DESC LIMIT 40'),
    all(env, `SELECT json_extract(params,'$.choice') AS choice, COUNT(*) AS n FROM events WHERE name = 'consent_choice' AND ts > ?1 AND ${w} GROUP BY choice`, [now - 30 * 864e5]),
  ]);
  const shown = (await one(env, `SELECT COUNT(*) AS n FROM events WHERE name = 'consent_shown' AND ts > ?1 AND ${w}`, [now - 30 * 864e5])).n || 0;
  const by = Object.fromEntries(consent.map((r) => [r.choice, r.n]));
  return reply(url, { last_event_ts: last.ts || null, events_24h: c24.n || 0, sessions_24h: s24.n || 0, ingest, checks, consent: { shown, granted: by.granted || by.accept || 0, denied: by.denied || by.decline || 0 } });
}
