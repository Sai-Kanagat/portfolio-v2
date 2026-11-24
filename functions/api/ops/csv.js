// GET /api/ops/csv?table=events|sessions|link_clicks|links|daily_rollup|cursor_bins&days=30 -> text/csv (max 50000 rows)
// Cells starting with = + - @ are prefixed with a quote so spreadsheets never run them as formulas.
import { all, scopeOf, rangeOf } from '../../_lib/ops.js';
import { json } from '../../_lib/http.js';

const SQL = {
  events: ['SELECT id, ts, vid, sid, pid, name, path, page_type, device, lang, country, link, owner, test, params FROM events WHERE ts >= ?1 AND ts < ?2 AND {w} ORDER BY id LIMIT 50000', true],
  sessions: ['SELECT * FROM sessions WHERE first_ts >= ?1 AND first_ts < ?2 AND {w} ORDER BY first_ts LIMIT 50000', true],
  link_clicks: ['SELECT * FROM link_clicks WHERE ts >= ?1 AND ts < ?2 ORDER BY id LIMIT 50000', true],
  links: ['SELECT * FROM links ORDER BY created LIMIT 50000', false],
  daily_rollup: ['SELECT * FROM daily_rollup ORDER BY day, name LIMIT 50000', false],
  cursor_bins: ["SELECT * FROM cursor_bins WHERE test = '' ORDER BY day LIMIT 50000", false],
};
const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const t = url.searchParams.get('table');
  if (!Object.prototype.hasOwnProperty.call(SQL, t)) return json({ error: 'table' }, 400);
  const [sql, ranged] = SQL[t];
  const { from, to } = rangeOf(url);
  const rows = await all(env, sql.replace('{w}', scopeOf(url).where()), ranged ? [from, to] : []);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${t}.csv"`, 'Cache-Control': 'no-store' } });
}
