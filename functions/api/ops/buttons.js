// GET /api/ops/buttons?days=7&path=/work -> { buttons:[{track_id,zone,path,clicks,visitors,sessions,per_session,last_ts}] }
import { all, reply, scopeOf, rangeOf, pathParam } from '../../_lib/ops.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const p = pathParam(url);
  const buttons = await all(env,
    `SELECT json_extract(params,'$.track_id') AS track_id, MAX(json_extract(params,'$.zone')) AS zone, path,
       COUNT(*) AS clicks, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT sid) AS sessions,
       ROUND(1.0 * COUNT(*) / COUNT(DISTINCT sid), 2) AS per_session, MAX(ts) AS last_ts
     FROM events WHERE name = 'ui_click' AND ts >= ?1 AND ts < ?2 AND (?3 IS NULL OR path = ?3) AND ${w}
     GROUP BY track_id, path ORDER BY clicks DESC LIMIT 500`, [from, to, p]);
  return reply(url, { buttons });
}
