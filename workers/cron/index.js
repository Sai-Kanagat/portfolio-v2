// Scheduled Worker: hourly rollup + health, daily purge (03:xx UTC).
// Raw events and sessions: 14 months. Cursor bins, ingest counters, health: 90 days.
// Exported functions take (db, now) so they can be tested directly.

const DAY = 864e5;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Rolls up yesterday and today (idempotent: totals are recomputed and replaced).
// key = most specific id for the event, '' when none. Owner and test rows excluded.
export async function rollup(db, now = Date.now()) {
  const from = Date.parse(day(now - DAY) + 'T00:00:00Z');
  const sql = `
INSERT INTO daily_rollup (day, name, "key", n, visitors)
SELECT date(ts / 1000, 'unixepoch') AS d, name,
  COALESCE(json_extract(params,'$.demo_id'), json_extract(params,'$.form_id'), json_extract(params,'$.track_id'), json_extract(params,'$.project_id'), CASE WHEN name = 'page_view' THEN path END, ''),
  COUNT(*), COUNT(DISTINCT vid)
FROM events WHERE ts >= ?1 AND owner = 0 AND test = '' GROUP BY 1, 2, 3
ON CONFLICT(day, name, "key") DO UPDATE SET n = excluded.n, visitors = excluded.visitors`;
  const r = await db.prepare(sql).bind(from).run();
  return r.meta.changes;
}

async function chunkDelete(db, sql, cutoff) {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const r = await db.prepare(sql).bind(cutoff).run();
    total += r.meta.changes;
    if (r.meta.changes < 5000) break;
  }
  return total;
}

export async function purge(db, now = Date.now()) {
  const months14 = now - 427 * DAY;
  const days90 = now - 90 * DAY;
  const out = {};
  out.events = await chunkDelete(db, 'DELETE FROM events WHERE id IN (SELECT id FROM events WHERE ts < ?1 LIMIT 5000)', months14);
  out.sessions = await chunkDelete(db, 'DELETE FROM sessions WHERE sid IN (SELECT sid FROM sessions WHERE last_ts < ?1 LIMIT 5000)', months14);
  out.link_clicks = await chunkDelete(db, 'DELETE FROM link_clicks WHERE id IN (SELECT id FROM link_clicks WHERE ts < ?1 LIMIT 5000)', months14);
  out.cursor_bins = await chunkDelete(db, 'DELETE FROM cursor_bins WHERE rowid IN (SELECT rowid FROM cursor_bins WHERE day < ?1 LIMIT 5000)', day(days90));
  out.ingest_stats = await chunkDelete(db, 'DELETE FROM ingest_stats WHERE rowid IN (SELECT rowid FROM ingest_stats WHERE day < ?1 LIMIT 5000)', day(days90));
  out.health = await chunkDelete(db, 'DELETE FROM health WHERE id IN (SELECT id FROM health WHERE ts < ?1 LIMIT 5000)', days90);
  return out;
}

// Health checks. Volume is low, so silence alone is not a failure: checks compare
// against what this site has actually sent before.
export async function health(db, now = Date.now()) {
  const checks = [];
  const add = (check_name, status, detail) => checks.push({ check_name, status, detail });
  const last = await db.prepare('SELECT MAX(ts) AS ts FROM events WHERE test = \'\' AND owner = 0').first();
  const ageH = last && last.ts ? (now - last.ts) / 36e5 : null;
  add('last_event_age_h', ageH === null ? 'warn' : ageH > 72 ? 'fail' : ageH > 24 ? 'warn' : 'ok', ageH === null ? 'no events yet' : ageH.toFixed(1));

  const t = day(now), y = day(now - DAY);
  const st = await db.prepare('SELECT kind, detail, SUM(n) AS n FROM ingest_stats WHERE day IN (?1, ?2) GROUP BY kind, detail').bind(t, y).all();
  const sum = (k) => st.results.filter((r) => r.kind === k).reduce((s, r) => s + r.n, 0);
  const unknown = st.results.filter((r) => r.kind === 'unknown_event').map((r) => `${r.detail}:${r.n}`);
  add('unknown_events_48h', unknown.length ? 'fail' : 'ok', unknown.join(' ') || '0');
  const invalid = sum('invalid'), batches = sum('batches');
  add('invalid_batches_48h', invalid > 0 && invalid > batches * 0.05 ? 'warn' : 'ok', `${invalid} invalid of ${batches + invalid} (sample size)`);
  add('origin_rejects_48h', sum('origin') > 50 ? 'warn' : 'ok', String(sum('origin')));

  // Events seen in days 8..37 but absent in the last 7 days: an event that went quiet.
  const quiet = await db
    .prepare(`SELECT name, COUNT(*) AS n FROM events WHERE ts >= ?1 AND ts < ?2 AND owner = 0 AND test = '' AND name NOT IN (SELECT DISTINCT name FROM events WHERE ts >= ?2) GROUP BY name HAVING n >= 5 ORDER BY n DESC LIMIT 10`)
    .bind(now - 37 * DAY, now - 7 * DAY).all();
  add('events_gone_quiet_7d', quiet.results.length ? 'warn' : 'ok', quiet.results.map((r) => `${r.name}:${r.n}`).join(' ') || 'none');

  const errs = await db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'js_error' AND ts > ?1 AND owner = 0 AND test = ''").bind(now - DAY).first();
  add('js_errors_24h', errs.n > 20 ? 'warn' : 'ok', String(errs.n));

  const ro = await db.prepare('SELECT MAX(day) AS d FROM daily_rollup').first();
  add('rollup_fresh', ro && ro.d && ro.d >= y ? 'ok' : (last && last.ts ? 'warn' : 'ok'), ro && ro.d ? ro.d : 'none');

  const stmt = db.prepare('INSERT INTO health (ts, check_name, status, detail) VALUES (?1, ?2, ?3, ?4)');
  await db.batch(checks.map((c) => stmt.bind(now, c.check_name, c.status, c.detail)));
  return checks;
}

export async function run(env, now = Date.now()) {
  const out = { rolled: await rollup(env.DB, now) };
  if (new Date(now).getUTCHours() === 3) out.purged = await purge(env.DB, now);
  out.checks = (await health(env.DB, now)).length;
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).then((o) => console.log('cron', JSON.stringify(o))));
  },
  // Local test hook only: workers are not routed publicly unless deployed.
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/run' && env.ALLOW_RUN === '1') {
      const now = Number(u.searchParams.get('now')) || Date.now();
      const force = u.searchParams.get('purge') === '1';
      const o = await run(env, now);
      if (force) o.purged = await purge(env.DB, now);
      return Response.json(o);
    }
    return new Response('not found', { status: 404 });
  },
};
