// Runs the real cron Worker in wrangler dev against the same local D1 file as Pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { startServer, ROOT, req, postEvents, batch, hex16 } from './harness.mjs';

let srv, db, child, base;
const free = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const DAY = 864e5;
const run = (q = '') => req(base, 'GET', '/run?' + q);

before(async () => {
  srv = await startServer({ label: 'cron' });
  db = srv.db();
  const port = await free(), insp = await free();
  child = spawn(path.join(ROOT, 'node_modules/.bin/wrangler'), ['dev', '--local', '--persist-to', srv.persist, '--port', String(port), '--inspector-port', String(insp), '--ip', '127.0.0.1', '--var', 'ALLOW_RUN:1'], { cwd: path.join(ROOT, 'workers/cron'), detached: true, stdio: 'ignore', env: { ...process.env, NO_COLOR: '1' } });
  base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 60000;
  for (;;) { try { if ((await req(base, 'GET', '/x')).status === 404) break; } catch {} if (Date.now() > end) throw new Error('cron worker did not start'); await new Promise((r) => setTimeout(r, 400)); }
});
after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} srv && srv.stop(); });

test('rollup is idempotent and excludes owner and test rows', async () => {
  const now = Date.now();
  const sid = hex16();
  await postEvents(srv, batch({ sid, ev: [{ n: 'page_view', t: now, p: {} }, { n: 'ui_click', t: now, p: { track_id: 'nav.work', x: 1, y: 1, nth: 1 } }, { n: 'ui_click', t: now, p: { track_id: 'nav.work', x: 1, y: 1, nth: 2 } }] }));
  await postEvents(srv, batch({ ctx: { owner: true }, ev: [{ n: 'ui_click', t: now, p: { track_id: 'nav.work', x: 1, y: 1, nth: 1 } }] }));
  await postEvents(srv, batch({ ctx: { test: 'x1' }, ev: [{ n: 'ui_click', t: now, p: { track_id: 'nav.work', x: 1, y: 1, nth: 1 } }] }));
  assert.equal((await run()).status, 200);
  const row = () => db.prepare("select n, visitors from daily_rollup where name = 'ui_click' and \"key\" = 'nav.work'").get();
  assert.deepEqual({ ...row() }, { n: 2, visitors: 1 });
  await run();
  assert.deepEqual({ ...row() }, { n: 2, visitors: 1 });
  assert.equal(db.prepare("select n from daily_rollup where name = 'page_view' and \"key\" = '/work'").get().n, 1);
});

test('purge removes raw rows past 14 months and cursor bins past 90 days, keeps the rest', async () => {
  const now = Date.now();
  const old = now - 440 * DAY, mid = now - 100 * DAY, fresh = now - 5 * DAY;
  const ins = db.prepare("insert into events (ts,vid,sid,pid,name,path,owner,test) values (?,?,?,?,?,?,0,'')");
  ins.run(old, 'v', 'sold', 'p', 'page_view', '/old'); ins.run(mid, 'v', 'smid', 'p', 'page_view', '/mid'); ins.run(fresh, 'v', 'sfresh', 'p', 'page_view', '/fresh');
  const s = db.prepare("insert into sessions (sid,vid,first_ts,last_ts) values (?,?,?,?)");
  s.run('sold', 'v', old, old); s.run('smid', 'v', mid, mid);
  const d = (ms) => new Date(ms).toISOString().slice(0, 10);
  const b = db.prepare("insert into cursor_bins (day,path,device,kind,x,y,n,test) values (?,?,?,?,?,?,?,'')");
  b.run(d(mid), '/mid', 'desktop', 'click', 1, 1, 1); b.run(d(fresh), '/fresh', 'desktop', 'click', 1, 1, 1);
  db.prepare("insert into link_clicks (ts,slug,is_bot) values (?,?,0)").run(old, 'li-old');
  const r = await run(`purge=1`);
  assert.equal(r.status, 200, r.text);
  const has = (sql) => db.prepare(sql).get().n;
  assert.equal(has("select count(*) n from events where path = '/old'"), 0);
  assert.equal(has("select count(*) n from events where path = '/mid'"), 1);
  assert.equal(has("select count(*) n from events where path = '/fresh'"), 1);
  assert.equal(has("select count(*) n from sessions where sid = 'sold'"), 0);
  assert.equal(has("select count(*) n from sessions where sid = 'smid'"), 1);
  assert.equal(has("select count(*) n from cursor_bins where path = '/mid'"), 0);
  assert.equal(has("select count(*) n from cursor_bins where path = '/fresh'"), 1);
  assert.equal(has("select count(*) n from link_clicks where slug = 'li-old'"), 0);
});

test('health flags unknown events and an event that went quiet', async () => {
  const now = Date.now();
  await postEvents(srv, batch({ ev: [{ n: 'surprise_event', t: now, p: {} }] }));
  await new Promise((r) => setTimeout(r, 400));
  const ins = db.prepare("insert into events (ts,vid,sid,pid,name,path,owner,test) values (?,?,?,?,?,?,0,'')");
  for (let i = 0; i < 6; i++) ins.run(now - 20 * DAY, 'v', 'sq', 'p', 'cv_download', '/q');
  const res = await run();
  const checks = Object.fromEntries(res.json.checks ? [] : []);
  const rows = db.prepare('select check_name, status, detail from health order by id desc limit 8').all();
  const by = Object.fromEntries(rows.map((r) => [r.check_name, r]));
  assert.equal(by.unknown_events_48h.status, 'fail');
  assert.match(by.unknown_events_48h.detail, /surprise_event/);
  assert.equal(by.events_gone_quiet_7d.status, 'warn');
  assert.match(by.events_gone_quiet_7d.detail, /cv_download/);
  assert.ok(by.last_event_age_h && by.rollup_fresh && by.js_errors_24h);
});
