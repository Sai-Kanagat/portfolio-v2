// GET /api/ops/heatmap?path=/work&device=desktop&kind=click|tap|move&days=30 -> { path, device, kind, cells:[{x,y,n}], total }
// Test rows excluded unless include=test. Owner traffic is never binned.
import { all, reply, rangeOf, pathParam, scopeOf } from '../../_lib/ops.js';
import { json } from '../../_lib/http.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url);
  const path = pathParam(url); if (!path) return json({ error: 'path' }, 400);
  const device = ['desktop', 'mobile', 'tablet'].includes(url.searchParams.get('device')) ? url.searchParams.get('device') : 'desktop';
  const kind = ['click', 'tap', 'move'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'click';
  const test = scopeOf(url).test;
  const cells = await all(env,
    `SELECT x, y, SUM(n) AS n FROM cursor_bins WHERE path = ?1 AND device = ?2 AND kind = ?3 AND day >= ?4 AND day <= ?5 AND (?6 = 1 OR test = '') GROUP BY x, y`,
    [path, device, kind, new Date(from).toISOString().slice(0, 10), new Date(Math.min(to, Date.now())).toISOString().slice(0, 10), test ? 1 : 0]);
  return reply(url, { path, device, kind, cells, total: cells.reduce((s, c) => s + c.n, 0) });
}
