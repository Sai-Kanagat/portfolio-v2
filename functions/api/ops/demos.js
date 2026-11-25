// GET /api/ops/demos?days=30&device=desktop|mobile|tablet
//   -> { demos:[{ demo_id, opens, starts, engaged_10, engaged_60, ends, errors, visitors, avg_ms,
//        sessions:{opened,started,engaged_10,engaged_60,ended,errored},     DISTINCT visits that sent the step, any order
//        funnel:{opened,started,engaged_10,engaged_60},                     DISTINCT visits that reached the step AND every step before it, so it only goes down
//        skipped:{started,engaged_10,engaged_60},                           visits that sent the step without the steps before it (for example a start with no open event)
//        camera:{state:events}, camera_sessions:{state:visits}, mic:{...}, mic_sessions:{...},
//        model:{loaded,failed,loaded_sessions,failed_sessions,avg_ms,ms_n,delegates:[{delegate,loaded,failed}]},
//        top_actions:[{action,n,sessions}] }],
//      page_actions:[{page,action,n,sessions,visitors}] }
// Page-level interactions are sent as demo_action with a demo_id that starts with pg. (for example pg.home). They are not demos, so they
// are kept out of demos[] and listed as page_actions.
// Events are what was sent, visits are people-sessions: one visit that opens a demo three times is three open events and one visit.
// demo_engaged is sent once at 10 s and once at 60 s of active time. They are kept apart (engaged_10, engaged_60).
import { all, reply, scopeOf, rangeOf, deviceFilter, badDevice } from '../../_lib/ops.js';

const NAMES = "'demo_open','demo_start','demo_engaged','demo_end','demo_action','media_result','model_state','demo_error'";
const FUNNEL = ['opened', 'started', 'engaged_10', 'engaged_60'];

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const dev = deviceFilter(url, 3);
  if (!dev.ok) return badDevice();
  const binds = [from, to, ...dev.binds];
  const [rows, flags, modelSessions] = await Promise.all([
    all(env,
      `SELECT json_extract(params,'$.demo_id') AS demo_id, name,
         json_extract(params,'$.kind') AS kind, json_extract(params,'$.state') AS state, json_extract(params,'$.action') AS action,
         CASE WHEN name = 'demo_engaged' THEN CASE WHEN COALESCE(json_extract(params,'$.seconds'), 0) >= 60 THEN 60 ELSE 10 END END AS milestone,
         json_extract(params,'$.delegate') AS delegate,
         COUNT(*) AS n, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT vid) AS visitors,
         SUM(json_extract(params,'$.ms')) AS ms_sum, COUNT(json_extract(params,'$.ms')) AS ms_n
       FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w}${dev.sql}
         AND name IN (${NAMES})
         AND json_extract(params,'$.demo_id') IS NOT NULL
       GROUP BY demo_id, name, kind, state, action, milestone, delegate`, binds),
    // One row per (demo, visit) with a flag per step, then summed: the visits that did the step, and the ones that did it in order.
    all(env,
      `SELECT demo_id, COUNT(*) AS touched,
         SUM(o) AS opened, SUM(st) AS started, SUM(e10) AS engaged_10, SUM(e60) AS engaged_60, SUM(en) AS ended, SUM(er) AS errored,
         SUM(o AND st) AS f_started, SUM(o AND st AND e10) AS f_engaged_10, SUM(o AND st AND e10 AND e60) AS f_engaged_60,
         SUM(st AND NOT o) AS s_started, SUM(e10 AND NOT (o AND st)) AS s_engaged_10, SUM(e60 AND NOT (o AND st AND e10)) AS s_engaged_60
       FROM (
         SELECT json_extract(params,'$.demo_id') AS demo_id, sid,
           MAX(name = 'demo_open') AS o, MAX(name = 'demo_start') AS st,
           MAX(name = 'demo_engaged' AND COALESCE(json_extract(params,'$.seconds'), 0) < 60) AS e10,
           MAX(name = 'demo_engaged' AND COALESCE(json_extract(params,'$.seconds'), 0) >= 60) AS e60,
           MAX(name = 'demo_end') AS en, MAX(name = 'demo_error') AS er
         FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w}${dev.sql}
           AND name IN ('demo_open','demo_start','demo_engaged','demo_end','demo_error')
           AND json_extract(params,'$.demo_id') IS NOT NULL
         GROUP BY demo_id, sid)
       GROUP BY demo_id`, binds),
    all(env,
      `SELECT json_extract(params,'$.demo_id') AS demo_id, json_extract(params,'$.state') AS state, COUNT(DISTINCT sid) AS sessions
       FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w}${dev.sql} AND name = 'model_state' AND json_extract(params,'$.demo_id') IS NOT NULL
       GROUP BY demo_id, state`, binds),
  ]);

  const m = new Map();
  const get = (id) => {
    let d = m.get(id);
    if (!d) {
      d = {
        demo_id: id, opens: 0, starts: 0, engaged_10: 0, engaged_60: 0, ends: 0, errors: 0, visitors: 0, avg_ms: null,
        sessions: { opened: 0, started: 0, engaged_10: 0, engaged_60: 0, ended: 0, errored: 0 },
        funnel: { opened: 0, started: 0, engaged_10: 0, engaged_60: 0 }, skipped: { started: 0, engaged_10: 0, engaged_60: 0 },
        camera: {}, camera_sessions: {}, mic: {}, mic_sessions: {},
        model: { loaded: 0, failed: 0, loaded_sessions: 0, failed_sessions: 0, avg_ms: null, ms_n: 0, delegates: [] },
        top_actions: [],
      };
      m.set(id, d);
    }
    return d;
  };
  const endMs = new Map(); const loadMs = new Map(); const dg = new Map();
  const isPage = (id) => typeof id === 'string' && id.startsWith('pg.');
  const pageActions = [];
  for (const r of rows) {
    if (isPage(r.demo_id)) { if (r.name === 'demo_action' && r.action) pageActions.push({ page: r.demo_id.slice(3), action: String(r.action), n: r.n, sessions: r.sessions, visitors: r.visitors }); continue; }
    const d = get(r.demo_id);
    if (r.name === 'demo_open') { d.opens += r.n; d.visitors += r.visitors; }
    else if (r.name === 'demo_start') d.starts += r.n;
    else if (r.name === 'demo_engaged') d[r.milestone === 60 ? 'engaged_60' : 'engaged_10'] += r.n;
    else if (r.name === 'demo_end') { d.ends += r.n; const e = endMs.get(r.demo_id) || { s: 0, n: 0 }; e.s += r.ms_sum || 0; e.n += r.ms_n; endMs.set(r.demo_id, e); }
    else if (r.name === 'demo_error') d.errors += r.n;
    else if (r.name === 'media_result' && (r.kind === 'camera' || r.kind === 'mic')) {
      d[r.kind][r.state] = (d[r.kind][r.state] || 0) + r.n;
      d[r.kind + '_sessions'][r.state] = (d[r.kind + '_sessions'][r.state] || 0) + r.sessions;
    } else if (r.name === 'demo_action' && r.action) d.top_actions.push({ action: r.action, n: r.n, sessions: r.sessions });
    else if (r.name === 'model_state' && (r.state === 'loaded' || r.state === 'failed')) {
      d.model[r.state] += r.n;
      if (r.state === 'loaded') { const e = loadMs.get(r.demo_id) || { s: 0, n: 0 }; e.s += r.ms_sum || 0; e.n += r.ms_n; loadMs.set(r.demo_id, e); }
      const k = r.demo_id + '\u0000' + (r.delegate || 'unknown');
      const x = dg.get(k) || { demo_id: r.demo_id, delegate: r.delegate || 'unknown', loaded: 0, failed: 0 };
      x[r.state] += r.n; dg.set(k, x);
    }
  }
  for (const f of flags) {
    if (isPage(f.demo_id)) continue;
    const d = get(f.demo_id);
    d.sessions = { opened: f.opened || 0, started: f.started || 0, engaged_10: f.engaged_10 || 0, engaged_60: f.engaged_60 || 0, ended: f.ended || 0, errored: f.errored || 0 };
    d.funnel = { opened: f.opened || 0, started: f.f_started || 0, engaged_10: f.f_engaged_10 || 0, engaged_60: f.f_engaged_60 || 0 };
    d.skipped = { started: f.s_started || 0, engaged_10: f.s_engaged_10 || 0, engaged_60: f.s_engaged_60 || 0 };
  }
  for (const r of modelSessions) if (!isPage(r.demo_id) && r.state === 'loaded' || r.state === 'failed') get(r.demo_id).model[r.state + '_sessions'] = r.sessions;
  for (const x of dg.values()) get(x.demo_id).model.delegates.push({ delegate: x.delegate, loaded: x.loaded, failed: x.failed });
  for (const [id, e] of endMs) get(id).avg_ms = e.n ? e.s / e.n : null;
  for (const [id, e] of loadMs) { const mm = get(id).model; mm.avg_ms = e.n ? e.s / e.n : null; mm.ms_n = e.n; }
  const demos = [...m.values()].map((d) => ({ ...d, top_actions: d.top_actions.sort((a, b) => b.n - a.n).slice(0, 10) })).sort((a, b) => b.opens - a.opens || String(a.demo_id).localeCompare(String(b.demo_id)));
  pageActions.sort((a, b) => b.n - a.n || a.page.localeCompare(b.page) || a.action.localeCompare(b.action));
  return reply(url, { demos, page_actions: pageActions }, dev.value);
}
