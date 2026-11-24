// GET /api/ops/pages?days=7 -> { pages:[{path,views,visitors,leaves,avg_visible_s,avg_active_s,avg_max_scroll}] }  (leaves = sample size for the averages)
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const pages = await all(env,
    `SELECT path,
       SUM(name = 'page_view') AS views,
       COUNT(DISTINCT CASE WHEN name = 'page_view' THEN vid END) AS visitors,
       SUM(name = 'page_leave') AS leaves,
       AVG(CASE WHEN name = 'page_leave' THEN json_extract(params,'$.visible_s') END) AS avg_visible_s,
       AVG(CASE WHEN name = 'page_leave' THEN json_extract(params,'$.active_s') END) AS avg_active_s,
       AVG(CASE WHEN name = 'page_leave' THEN json_extract(params,'$.max_scroll') END) AS avg_max_scroll
     FROM events WHERE ts >= ?1 AND ts < ?2 AND name IN ('page_view','page_leave') AND ${w}
     GROUP BY path ORDER BY views DESC LIMIT 200`, [from, to]);
  return reply(url, { pages });
}
