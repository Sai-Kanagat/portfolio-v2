// GET /api/ops/demos?days=30 -> { demos:[{demo_id,opens,starts,engaged,ends,visitors,avg_ms,camera:{prompt,granted,denied,...},top_actions:[{action,n}]}] }
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const rows = await all(env,
    `SELECT json_extract(params,'$.demo_id') AS demo_id, name,
       json_extract(params,'$.kind') AS kind, json_extract(params,'$.state') AS state, json_extract(params,'$.action') AS action,
       COUNT(*) AS n, COUNT(DISTINCT vid) AS visitors, AVG(json_extract(params,'$.ms')) AS avg_ms
     FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w}
       AND name IN ('demo_open','demo_start','demo_engaged','demo_end','demo_action','media_result','model_state','demo_error')
       AND json_extract(params,'$.demo_id') IS NOT NULL
     GROUP BY demo_id, name, kind, state, action`, [from, to]);
  const m = new Map();
  for (const r of rows) {
    const d = m.get(r.demo_id) || { demo_id: r.demo_id, opens: 0, starts: 0, engaged: 0, ends: 0, errors: 0, visitors: 0, avg_ms: null, camera: {}, mic: {}, top_actions: [] };
    if (r.name === 'demo_open') { d.opens += r.n; d.visitors = Math.max(d.visitors, r.visitors); }
    else if (r.name === 'demo_start') d.starts += r.n;
    else if (r.name === 'demo_engaged') d.engaged += r.n;
    else if (r.name === 'demo_end') { d.ends += r.n; d.avg_ms = r.avg_ms; }
    else if (r.name === 'demo_error') d.errors += r.n;
    else if (r.name === 'media_result' && (r.kind === 'camera' || r.kind === 'mic')) d[r.kind][r.state] = (d[r.kind][r.state] || 0) + r.n;
    else if (r.name === 'demo_action' && r.action) d.top_actions.push({ action: r.action, n: r.n });
    m.set(r.demo_id, d);
  }
  const demos = [...m.values()].map((d) => ({ ...d, top_actions: d.top_actions.sort((a, b) => b.n - a.n).slice(0, 10) })).sort((a, b) => b.opens - a.opens);
  return reply(url, { demos });
}
