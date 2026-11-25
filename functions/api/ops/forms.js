// GET /api/ops/forms?days=30
//   -> { forms:[{ form_id, view,start,field,error,attempt,success,failure,abandon,        EVENT counts
//                 sessions:{view,start,field,error,attempt,success,failure,abandon},       DISTINCT visits that sent the step
//                 funnel:{view,start,attempt,success},                                     visits that reached the step AND every step before it, so it only goes down
//                 skipped:{start,attempt,success},                                         visits that sent the step without the steps before it
//                 abandoned_after_start,                                                   visits in funnel.start that also abandoned (never above funnel.start, unlike sessions.abandon which counts any visit)
//                 abandon_fields:[{field,n}] }],
//        newsletter:{ view,fab_shown,fab_click,start,invalid,request,failed,confirmed,   events
//                     sessions:{...same keys}, funnel:{view,start,request,confirmed}, skipped:{start,request,confirmed},
//                     by_page:[{page_path, view,fab_shown,fab_click,start,invalid,request,failed,confirmed}] } }
// The newsletter box sends newsletter_* events and no form_* events, so it is aggregated here as its own block and never appears twice.
// newsletter_confirmed only exists once the Brevo webhook posts it, until then confirmed stays 0 and request is the last real step.
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';

const FORM_STEPS = { form_view: 'view', form_start: 'start', form_field: 'field', form_error: 'error', form_submit_attempt: 'attempt', form_submit_success: 'success', form_submit_failure: 'failure', form_abandon: 'abandon' };
const NL_STEPS = { newsletter_view: 'view', newsletter_fab_shown: 'fab_shown', newsletter_fab_click: 'fab_click', newsletter_start: 'start', newsletter_invalid: 'invalid', newsletter_request: 'request', newsletter_failed: 'failed', newsletter_confirmed: 'confirmed' };
const zero = (steps) => Object.fromEntries(Object.values(steps).map((k) => [k, 0]));
const FORM_NAMES = Object.keys(FORM_STEPS).map((n) => `'${n}'`).join(',');
const NL_NAMES = Object.keys(NL_STEPS).map((n) => `'${n}'`).join(',');

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const b = [from, to];
  const [ev, flags, fields, nlEv, nlFlags] = await Promise.all([
    all(env, `SELECT json_extract(params,'$.form_id') AS form_id, name, COUNT(*) AS n, COUNT(DISTINCT sid) AS sessions
      FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name IN (${FORM_NAMES}) GROUP BY form_id, name`, b),
    all(env, `SELECT form_id, SUM(v) AS f_view, SUM(s) AS f_start, SUM(a) AS f_attempt, SUM(ok) AS f_success,
        SUM(v AND s) AS n_start, SUM(v AND s AND a) AS n_attempt, SUM(v AND s AND a AND ok) AS n_success,
        SUM(v AND s AND ab) AS n_abandon, SUM(s AND NOT v) AS k_start, SUM(a AND NOT (v AND s)) AS k_attempt, SUM(ok AND NOT (v AND s AND a)) AS k_success
      FROM (
        SELECT json_extract(params,'$.form_id') AS form_id, sid,
          MAX(name = 'form_view') AS v, MAX(name = 'form_start') AS s, MAX(name = 'form_submit_attempt') AS a, MAX(name = 'form_submit_success') AS ok, MAX(name = 'form_abandon') AS ab
        FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name IN (${FORM_NAMES}) GROUP BY form_id, sid)
      GROUP BY form_id`, b),
    all(env, `SELECT json_extract(params,'$.form_id') AS form_id, json_extract(params,'$.field') AS field, COUNT(*) AS n
      FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name = 'form_abandon' GROUP BY form_id, field`, b),
    all(env, `SELECT name, json_extract(params,'$.page_path') AS page_path, COUNT(*) AS n
      FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name IN (${NL_NAMES}) GROUP BY name, page_path`, b),
    all(env, `SELECT name, COUNT(DISTINCT sid) AS sessions
      FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name IN (${NL_NAMES}) GROUP BY name`, b),
  ]);
  const nlFun = (await all(env, `SELECT COUNT(*) AS touched, SUM(v) AS view, SUM(v AND s) AS start, SUM(v AND s AND r) AS request, SUM(v AND s AND r AND c) AS confirmed,
        SUM(s AND NOT v) AS k_start, SUM(r AND NOT (v AND s)) AS k_request, SUM(c AND NOT (v AND s AND r)) AS k_confirmed
      FROM (SELECT sid, MAX(name = 'newsletter_view') AS v, MAX(name = 'newsletter_start') AS s, MAX(name = 'newsletter_request') AS r, MAX(name = 'newsletter_confirmed') AS c
        FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w} AND name IN (${NL_NAMES}) GROUP BY sid)`, b))[0] || {};

  const m = new Map();
  const get = (id) => {
    let f = m.get(id);
    if (!f) { f = { form_id: id, ...zero(FORM_STEPS), sessions: zero(FORM_STEPS), funnel: { view: 0, start: 0, attempt: 0, success: 0 }, skipped: { start: 0, attempt: 0, success: 0 }, abandoned_after_start: 0, abandon_fields: [] }; m.set(id, f); }
    return f;
  };
  for (const r of ev) {
    if (!r.form_id || !FORM_STEPS[r.name]) continue;
    const f = get(r.form_id); const k = FORM_STEPS[r.name];
    f[k] += r.n; f.sessions[k] = r.sessions;
  }
  for (const r of flags) {
    if (!r.form_id) continue;
    const f = get(r.form_id);
    f.funnel = { view: r.f_view || 0, start: r.n_start || 0, attempt: r.n_attempt || 0, success: r.n_success || 0 };
    f.skipped = { start: r.k_start || 0, attempt: r.k_attempt || 0, success: r.k_success || 0 };
    f.abandoned_after_start = r.n_abandon || 0;
  }
  for (const r of fields) if (r.form_id && r.field) get(r.form_id).abandon_fields.push({ field: r.field, n: r.n });

  const nl = { ...zero(NL_STEPS), sessions: zero(NL_STEPS), funnel: { view: nlFun.view || 0, start: nlFun.start || 0, request: nlFun.request || 0, confirmed: nlFun.confirmed || 0 },
    skipped: { start: nlFun.k_start || 0, request: nlFun.k_request || 0, confirmed: nlFun.k_confirmed || 0 }, by_page: [] };
  const pages = new Map();
  for (const r of nlEv) {
    const k = NL_STEPS[r.name]; if (!k) continue;
    nl[k] += r.n;
    const pk = r.page_path || '(none)';
    const p = pages.get(pk) || { page_path: pk, ...zero(NL_STEPS) };
    p[k] += r.n; pages.set(pk, p);
  }
  for (const r of nlFlags) { const k = NL_STEPS[r.name]; if (k) nl.sessions[k] = r.sessions; }
  nl.by_page = [...pages.values()].sort((a, b) => b.view - a.view || b.request - a.request);
  return reply(url, { forms: [...m.values()].sort((a, b) => b.view - a.view), newsletter: nl });
}
