// GET /api/ops/forms?days=30 -> { forms:[{form_id,view,start,field,error,attempt,success,failure,abandon,abandon_fields:[{field,n}]}] }
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url); const { from, to } = rangeOf(url); const w = scopeOf(url).where();
  const rows = await all(env,
    `SELECT json_extract(params,'$.form_id') AS form_id, name, json_extract(params,'$.field') AS field, COUNT(*) AS n
     FROM events WHERE ts >= ?1 AND ts < ?2 AND ${w}
       AND name IN ('form_view','form_start','form_field','form_error','form_submit_attempt','form_submit_success','form_submit_failure','form_abandon')
     GROUP BY form_id, name, field`, [from, to]);
  const m = new Map();
  for (const r of rows) {
    if (!r.form_id) continue;
    const f = m.get(r.form_id) || { form_id: r.form_id, view: 0, start: 0, field: 0, error: 0, attempt: 0, success: 0, failure: 0, abandon: 0, abandon_fields: [] };
    const k = r.name.replace('form_submit_', '').replace('form_', '');
    f[k] = (f[k] || 0) + r.n;
    if (r.name === 'form_abandon' && r.field) f.abandon_fields.push({ field: r.field, n: r.n });
    m.set(r.form_id, f);
  }
  return reply(url, { forms: [...m.values()] });
}
