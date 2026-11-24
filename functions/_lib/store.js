// D1 writes for the ingest endpoint. Every statement is a constant string.
// User data travels only as bound parameters: one JSON text per statement,
// expanded in SQL with json_each. That keeps a request at four queries and far
// under D1's bound-parameter and queries-per-invocation limits.
import { utcDay } from './http.js';

const SESSION_EVENT_CAP = 20000;
const MAX_ACTIVE_MS_PER_LEAVE = 6 * 3600 * 1000;

const SQL_EVENTS = `
INSERT INTO events (ts, vid, sid, pid, name, path, page_type, device, lang, country, link, owner, test, params)
SELECT json_extract(value,'$.ts'), ?2, ?3, ?4, json_extract(value,'$.name'), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, json_extract(value,'$.params')
FROM json_each(?1)
WHERE (SELECT COALESCE(MAX(events),0) FROM sessions WHERE sid = ?3) < ${SESSION_EVENT_CAP}`;

const SQL_SESSION = `
INSERT INTO sessions (sid, vid, first_ts, last_ts, landing, ref_host, utm_source, utm_medium, utm_campaign, link, country, device, owner, test, pages, events, active_ms)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
ON CONFLICT(sid) DO UPDATE SET
  first_ts = MIN(sessions.first_ts, excluded.first_ts),
  last_ts = MAX(sessions.last_ts, excluded.last_ts),
  ref_host = COALESCE(sessions.ref_host, excluded.ref_host),
  utm_source = COALESCE(sessions.utm_source, excluded.utm_source),
  utm_medium = COALESCE(sessions.utm_medium, excluded.utm_medium),
  utm_campaign = COALESCE(sessions.utm_campaign, excluded.utm_campaign),
  link = COALESCE(sessions.link, excluded.link),
  country = COALESCE(sessions.country, excluded.country),
  device = COALESCE(sessions.device, excluded.device),
  owner = MAX(sessions.owner, excluded.owner),
  test = CASE WHEN sessions.test = '' THEN excluded.test ELSE sessions.test END,
  pages = sessions.pages + excluded.pages,
  events = sessions.events + excluded.events,
  active_ms = sessions.active_ms + excluded.active_ms`;

const SQL_BINS = `
INSERT INTO cursor_bins (day, path, device, kind, x, y, n, test)
SELECT json_extract(value,'$.d'), ?2, ?3, json_extract(value,'$.k'), json_extract(value,'$.x'), json_extract(value,'$.y'), json_extract(value,'$.n'), ?4
FROM json_each(?1) WHERE true
ON CONFLICT(day, path, device, kind, x, y, test) DO UPDATE SET n = cursor_bins.n + excluded.n`;

const SQL_STATS = `
INSERT INTO ingest_stats (day, kind, detail, n)
SELECT ?1, json_extract(value,'$.k'), '', json_extract(value,'$.n') FROM json_each(?2) WHERE true
ON CONFLICT(day, kind, detail) DO UPDATE SET n = ingest_stats.n + excluded.n`;

const SQL_DROP = `
INSERT INTO ingest_stats (day, kind, detail, n) VALUES (?1, ?2, ?3, 1)
ON CONFLICT(day, kind, detail) DO UPDATE SET n = ingest_stats.n + 1`;

function binsFrom(events, ctx) {
  const m = new Map();
  const add = (day, k, x, y) => {
    const key = `${day}|${k}|${x}|${y}`;
    const cur = m.get(key);
    if (cur) cur.n += 1;
    else m.set(key, { d: day, k, x, y, n: 1 });
  };
  for (const e of events) {
    const day = utcDay(e.t);
    if (e.n === 'ui_click' && Number.isInteger(e.params.x) && Number.isInteger(e.params.y)) add(day, 'click', e.params.x, e.params.y);
    else if (e.n === 'tap' && Number.isInteger(e.params.x) && Number.isInteger(e.params.y)) add(day, 'tap', e.params.x, e.params.y);
    else if (e.n === 'cursor_sample' && e.params.cells) for (const [x, y] of e.params.cells) add(day, 'move', x, y);
  }
  return [...m.values()];
}

export async function writeBatch(env, batch, meta) {
  const { vid, sid, pid, ctx, events } = batch;
  const country = meta.country ?? null;
  const device = ctx.device || meta.device || 'unknown';
  const rows = events
    .filter((e) => e.store && e.n !== 'cursor_sample')
    .map((e) => ({ ts: e.t, name: e.n, params: Object.keys(e.params).length ? JSON.stringify(e.params) : null }));
  const now = Date.now();
  const first = Math.min(...events.map((e) => e.t));
  const last = Math.max(...events.map((e) => e.t));
  const pages = events.filter((e) => e.n === 'page_view').length;
  const active = events.reduce(
    (s, e) => (e.n === 'page_leave' && typeof e.params.active_s === 'number' ? s + Math.min(Math.max(0, e.params.active_s) * 1000, MAX_ACTIVE_MS_PER_LEAVE) : s),
    0
  );
  const db = env.DB;
  const stmts = [];
  if (rows.length) {
    stmts.push(
      db.prepare(SQL_EVENTS).bind(JSON.stringify(rows), vid, sid, pid, ctx.path, ctx.page_type, device, ctx.lang, country, ctx.link, ctx.owner, ctx.test)
    );
  }
  stmts.push(
    db
      .prepare(SQL_SESSION)
      .bind(
        sid, vid, first, last, ctx.path, ctx.ref_host,
        ctx.utm.source || null, ctx.utm.medium || null, ctx.utm.campaign || null,
        ctx.link, country, device, ctx.owner, ctx.test, pages, events.length, Math.round(active)
      )
  );
  const bins = ctx.owner ? [] : binsFrom(events, ctx);
  if (bins.length) stmts.push(db.prepare(SQL_BINS).bind(JSON.stringify(bins), ctx.path, device, ctx.test));
  stmts.push(
    db.prepare(SQL_STATS).bind(utcDay(now), JSON.stringify([{ k: 'batches', n: 1 }, { k: 'events', n: events.length }]))
  );
  await db.batch(stmts);
}

export async function countDrop(env, kind, detail = '') {
  try {
    await env.DB.prepare(SQL_DROP).bind(utcDay(Date.now()), kind, String(detail).slice(0, 40)).run();
  } catch {
    /* counters are best effort */
  }
}
