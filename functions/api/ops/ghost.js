// GET /api/ops/ghost?days=30 -> { starts, ends, stop_clicks, modes:[{mode,n}], end_reasons:[{reason,n}], interrupts:[{input,n,avg_ms}] }  (auto cursor, haunt_* events only)
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';
// An IN list on name, not LIKE 'haunt_%': LIKE cannot use idx_events_name_ts, so it read every event in the period.
const HAUNT = ['haunt_start', 'haunt_mode', 'haunt_end', 'haunt_interrupted', 'haunt_stop_click'].map((n) => `'${n}'`).join(',');
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const rows = await all(env,
    `SELECT name, COALESCE(json_extract(params,'$.mode'), json_extract(params,'$.reason'), json_extract(params,'$.input')) AS k, COUNT(*) AS n, AVG(json_extract(params,'$.ms')) AS avg_ms
     FROM events WHERE ts >= ?1 AND ts < ?2 AND name IN (${HAUNT}) AND ${w} GROUP BY name, k`, [from, to]);
  const sum = (name) => rows.filter((r) => r.name === name).reduce((s, r) => s + r.n, 0);
  return reply(url, {
    starts: sum('haunt_start'), ends: sum('haunt_end'), stop_clicks: sum('haunt_stop_click'),
    modes: rows.filter((r) => r.name === 'haunt_mode').map((r) => ({ mode: r.k, n: r.n })),
    end_reasons: rows.filter((r) => r.name === 'haunt_end').map((r) => ({ reason: r.k, n: r.n })),
    interrupts: rows.filter((r) => r.name === 'haunt_interrupted').map((r) => ({ input: r.k, n: r.n, avg_ms: r.avg_ms })),
  });
}
