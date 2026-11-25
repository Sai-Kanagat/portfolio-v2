// GET /api/ops/buttons?days=7&path=/work&device=desktop|mobile|tablet
//   -> { buttons:[{track_id,zone,path,clicks,visitors,sessions,per_session,last_ts,page_sessions,click_rate}],
//        paths:[{path,sessions}], truncated }
// Only controls that were clicked at least once are rows here. The dashboard merges the build-time list ops/controls.json (every known control)
// so the ones with zero clicks show as 0. If truncated is true the clicked list was cut at MAX rows and zero rows must not be inferred.
//   sessions        distinct visits that clicked this control
//   page_sessions   distinct visits that viewed this path (a page_view event on it), same period, scope and device. NOT only the visits that clicked.
//   click_rate      sessions / page_sessions, null when nobody viewed the path. It can pass 1 if a page_view was lost, it is never clamped.
//   paths           page_sessions for every viewed path, clicked or not, so the dashboard has a denominator for controls with zero clicks too
import { all, reply, scopeOf, rangeOf, pathParam, deviceFilter, badDevice } from '../../_lib/ops.js';

const MAX = 5000;

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const dev = deviceFilter(url, 4);
  if (!dev.ok) return badDevice();
  const p = pathParam(url);
  const binds = [from, to, p, ...dev.binds];
  const [rows, viewed] = await Promise.all([
    all(env,
      `SELECT json_extract(params,'$.track_id') AS track_id, MAX(json_extract(params,'$.zone')) AS zone, path,
         COUNT(*) AS clicks, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT sid) AS sessions,
         ROUND(1.0 * COUNT(*) / COUNT(DISTINCT sid), 2) AS per_session, MAX(ts) AS last_ts
       FROM events WHERE name = 'ui_click' AND ts >= ?1 AND ts < ?2 AND (?3 IS NULL OR path = ?3) AND ${w}${dev.sql}
       GROUP BY track_id, path ORDER BY clicks DESC LIMIT ${MAX + 1}`, binds),
    all(env,
      `SELECT path, COUNT(DISTINCT sid) AS sessions
       FROM events WHERE name = 'page_view' AND ts >= ?1 AND ts < ?2 AND (?3 IS NULL OR path = ?3) AND ${w}${dev.sql}
       GROUP BY path ORDER BY sessions DESC LIMIT ${MAX + 1}`, binds),
  ]);
  const truncated = rows.length > MAX || viewed.length > MAX;
  const paths = viewed.slice(0, MAX);
  const den = new Map(paths.map((r) => [r.path, r.sessions]));
  const buttons = rows.slice(0, MAX).map((b) => {
    const page_sessions = den.get(b.path) || 0;
    return { ...b, page_sessions, click_rate: page_sessions ? Math.round((b.sessions / page_sessions) * 10000) / 10000 : null };
  });
  return reply(url, { buttons, paths, truncated }, dev.value);
}
