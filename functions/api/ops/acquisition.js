// GET /api/ops/acquisition?days=7  -> { sessions, channels:[{channel,sessions,visitors,active_s}], referrers:[{ref_host,sessions}], utm:[{utm_source,utm_medium,utm_campaign,sessions}], countries:[{country,sessions}] }
import { all, one, reply, scopeOf, rangeOf, channelOf } from '../../_lib/ops.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const { from, to } = rangeOf(url);
  const w = scopeOf(url).where();
  const base = `FROM sessions WHERE first_ts >= ?1 AND first_ts < ?2 AND ${w}`;
  const [total, rows, referrers, utm, countries] = await Promise.all([
    one(env, `SELECT COUNT(*) AS n, COUNT(DISTINCT vid) AS v ${base}`, [from, to]),
    all(env, `SELECT link, utm_source, ref_host, COUNT(*) AS sessions, COUNT(DISTINCT vid) AS visitors, SUM(active_ms) AS active_ms ${base} GROUP BY link, utm_source, ref_host`, [from, to]),
    all(env, `SELECT ref_host, COUNT(*) AS sessions ${base} AND ref_host IS NOT NULL GROUP BY ref_host ORDER BY sessions DESC LIMIT 25`, [from, to]),
    all(env, `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS sessions ${base} AND utm_source IS NOT NULL GROUP BY 1,2,3 ORDER BY sessions DESC LIMIT 25`, [from, to]),
    all(env, `SELECT country, COUNT(*) AS sessions ${base} GROUP BY country ORDER BY sessions DESC LIMIT 25`, [from, to]),
  ]);
  const ch = new Map();
  for (const r of rows) {
    const k = channelOf(r);
    const c = ch.get(k) || { channel: k, sessions: 0, visitors: 0, active_s: 0 };
    c.sessions += r.sessions; c.visitors += r.visitors; c.active_s += Math.round((r.active_ms || 0) / 1000);
    ch.set(k, c);
  }
  return reply(url, { sessions: total.n || 0, visitors: total.v || 0, channels: [...ch.values()].sort((a, b) => b.sessions - a.sessions), referrers, utm, countries });
}
