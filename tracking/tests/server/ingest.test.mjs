import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postEvents, batch, hex16, goodHeaders, BROWSER_UA } from './harness.mjs';

let srv, db;
before(async () => {
  srv = await startServer({ label: 'ingest' });
  db = srv.db();
});
after(() => srv && srv.stop());

const count = (sql, ...a) => db.prepare(sql).get(...a).n;
const now = () => Date.now();

test('valid batch is stored with a session row', async () => {
  const b = batch({ ev: [{ n: 'page_view', t: now(), p: { title_id: 'work' } }, { n: 'ui_click', t: now(), p: { track_id: 'nav.work', zone: 'nav', x: 10, y: 20, nth: 1 } }, { n: 'page_leave', t: now(), p: { visible_s: 20, active_s: 7, max_scroll: 80 } }] });
  const r = await postEvents(srv, b);
  assert.equal(r.status, 204, r.text);
  const rows = db.prepare('select name, params, country, device, owner, test from events where sid = ? order by id').all(b.sid);
  assert.equal(rows.length, 3);
  assert.equal(JSON.parse(rows[1].params).track_id, 'nav.work');
  assert.equal(rows[0].owner, 0);
  assert.equal(rows[0].test, '');
  const s = db.prepare('select * from sessions where sid = ?').get(b.sid);
  assert.equal(s.events, 3);
  assert.equal(s.pages, 1);
  assert.equal(s.active_ms, 7000);
  assert.equal(s.landing, '/work');
  assert.equal(s.ref_host, 'www.linkedin.com');
});

test('session first-touch fields are not overwritten by later batches', async () => {
  const sid = hex16(), vid = hex16();
  await postEvents(srv, batch({ sid, vid, ctx: { path: '/first', link: 'li-thallo-01', ref_host: 'lnkd.in', utm: { source: 'li', medium: 'social', campaign: 'thallo-launch' } } }));
  await postEvents(srv, batch({ sid, vid, ctx: { path: '/second', link: null, ref_host: 'evil.example', utm: { source: 'other' } } }));
  const s = db.prepare('select * from sessions where sid = ?').get(sid);
  assert.equal(s.landing, '/first');
  assert.equal(s.link, 'li-thallo-01');
  assert.equal(s.ref_host, 'lnkd.in');
  assert.equal(s.utm_source, 'li');
  assert.equal(s.utm_campaign, 'thallo-launch');
  assert.equal(s.events, 2);
});

test('forged, missing and lookalike origins get 403 and store nothing', async () => {
  const before = count('select count(*) n from events');
  for (const origin of ['https://evil.example', 'https://saikanagat.com.evil.example', 'https://evilsaikanagat.com', 'http://saikanagat.com', 'null', 'https://saikanagat.com@evil.example']) {
    const r = await postEvents(srv, batch(), { origin });
    assert.equal(r.status, 403, origin);
  }
  const noOrigin = await srv.req('POST', '/api/e', { headers: { 'user-agent': BROWSER_UA }, body: batch() });
  assert.equal(noOrigin.status, 403);
  assert.equal(count('select count(*) n from events'), before);
  for (const origin of ['https://saikanagat.com', 'https://www.saikanagat.com', 'https://studio.saikanagat.com', 'https://abc12345.saikanagat-7yg.pages.dev']) {
    assert.equal((await postEvents(srv, batch(), { origin })).status, 204, origin);
  }
  const ref = await srv.req('POST', '/api/e', { headers: { 'user-agent': BROWSER_UA, referer: 'https://saikanagat.com/work?x=1' }, body: batch() });
  assert.equal(ref.status, 204);
});

test('oversized payload gets 413', async () => {
  const before = count('select count(*) n from events');
  const big = batch();
  big.ctx.padding = 'x'.repeat(40000);
  const r = await postEvents(srv, big);
  assert.equal(r.status, 413);
  assert.equal(count('select count(*) n from events'), before);
});

test('unknown event rejects the whole batch', async () => {
  const sid = hex16();
  const r = await postEvents(srv, batch({ sid, ev: [{ n: 'page_view', t: now(), p: {} }, { n: 'totally_made_up', t: now(), p: {} }] }));
  assert.equal(r.status, 400);
  assert.equal(count('select count(*) n from events where sid = ?', sid), 0);
  assert.equal(count("select count(*) n from sessions where sid = ?", sid), 0);
});

test('structure errors are 400', async () => {
  const bad = [
    { ...batch(), v: 2 },
    { ...batch(), vid: 'nothex' },
    { ...batch(), sid: 'ABCDEF0123456789' },
    { ...batch(), ev: [] },
    { ...batch(), ctx: null },
    { ...batch(), ctx: { page_type: 'x' } },
    batch({ ev: [{ n: 'page_view', t: 'now', p: {} }] }),
    batch({ ev: [{ t: now() }] }),
    batch({ ev: Array.from({ length: 51 }, () => ({ n: 'page_view', t: now(), p: {} })) }),
  ];
  for (const b of bad) assert.equal((await postEvents(srv, b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await postEvents(srv, '{not json')).status, 400);
  assert.equal((await srv.req('GET', '/api/e', { headers: goodHeaders() })).status, 405);
});

test('PII and unknown fields are never stored', async () => {
  const sid = hex16();
  const canary = 'CANARY_jane.doe@example.com';
  const b = batch({
    sid,
    ev: [
      { n: 'ui_click', t: now(), p: { track_id: 'contact.send', zone: 'contact', email: canary, text: 'my typed text CANARY', name: 'Jane Doe CANARY', x: 3, y: 4, nth: 1 } },
      { n: 'input_change', t: now(), p: { field: canary } },
      { n: 'form_error', t: now(), p: { form_id: 'contact', field: 'typed words with spaces CANARY' } },
      { n: 'demo_action', t: now(), p: { demo_id: 'agora', action: 'seed', item: 'a@b.co', value: 'free text CANARY', bucket: '21-80' } },
      { n: 'page_not_found', t: now(), p: { missing_path: '/contact?email=' + canary } },
    ],
  });
  b.email = canary;
  b.ctx.email = canary;
  b.ctx.title = canary;
  b.ctx.utm = { source: canary, medium: 'social' };
  b.ctx.ref_host = canary;
  assert.equal((await postEvents(srv, b)).status, 204);
  const dump = JSON.stringify([db.prepare('select * from events where sid = ?').all(sid), db.prepare('select * from sessions where sid = ?').all(sid)]);
  assert.ok(!dump.includes('CANARY'), dump);
  assert.ok(!dump.includes('@'), dump);
  const ev = db.prepare('select name, params from events where sid = ? order by id').all(sid);
  assert.deepEqual(JSON.parse(ev[0].params), { track_id: 'contact.send', zone: 'contact', x: 3, y: 4, nth: 1 });
  assert.equal(ev[1].params, null);
  assert.equal(JSON.parse(ev[3].params).bucket, '21-80');
  assert.equal(JSON.parse(ev[4].params).missing_path, '/contact');
});

test('query and hash never reach the store (path only)', async () => {
  const sid = hex16();
  await postEvents(srv, batch({ sid, ctx: { path: '/positioning?s=ENCODEDSTATE#frag' }, ev: [{ n: 'page_not_found', t: now(), p: { missing_path: '/nope/deep?x=1#y' } }] }));
  const r = db.prepare('select path, params from events where sid = ?').get(sid);
  assert.equal(r.path, '/positioning');
  assert.equal(JSON.parse(r.params).missing_path, '/nope/deep');
});

test('SQL injection stays inert and tables survive', async () => {
  const sid = hex16();
  const evil = "x'); DROP TABLE events;--";
  const b = batch({ sid, ctx: { path: '/' + evil, page_type: evil, link: evil }, ev: [{ n: 'ui_click', t: now(), p: { track_id: evil, zone: "' OR 1=1 --" } }, { n: 'page_not_found', t: now(), p: { missing_path: '/' + evil } }] });
  assert.equal((await postEvents(srv, b)).status, 204);
  assert.equal((await postEvents(srv, batch({ vid: evil }))).status, 400);
  assert.equal((await postEvents(srv, batch({ sid: evil }))).status, 400);
  assert.ok(count("select count(*) n from sqlite_master where name in ('events','sessions','links','cursor_bins')") === 4);
  const r = db.prepare('select path, page_type, link, params from events where sid = ? order by id').all(sid);
  assert.ok(!r[0].path.includes("'") && !r[0].path.includes(';'), r[0].path);
  assert.equal(r[0].page_type, null);
  assert.equal(r[0].link, null);
  assert.equal(r[0].params, null);
  assert.ok(count('select count(*) n from events') > 0);
});

test('bots and previewers are dropped with 204', async () => {
  const sid = hex16();
  for (const ua of ['Googlebot/2.1', 'LinkedInBot/1.0', 'Slackbot-LinkExpanding 1.0', 'curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/139.0.0.0 Safari/537.36', 'GPTBot/1.0', '']) {
    const r = await postEvents(srv, batch({ sid }), { 'user-agent': ua });
    assert.equal(r.status, 204, ua);
    assert.equal(r.headers['x-sk-dropped'], 'bot', ua);
  }
  assert.equal(count('select count(*) n from events where sid = ?', sid), 0);
  const t = hex16();
  const r = await postEvents(srv, batch({ sid: t, ctx: { test: 'rt-123' } }), { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/139.0.0.0 Safari/537.36' });
  assert.equal(r.status, 204);
  assert.equal(r.headers['x-sk-dropped'], undefined);
  assert.equal(db.prepare('select test from events where sid = ?').get(t).test, 'rt-123');
  assert.equal((await postEvents(srv, batch({ sid: hex16(), ctx: { test: 'rt-1' } }), { 'user-agent': 'Googlebot/2.1' })).headers['x-sk-dropped'], 'bot');
});

test('owner and test flags are stored; owner never feeds heatmap bins', async () => {
  const o = hex16(), t = hex16();
  await postEvents(srv, batch({ sid: o, ctx: { owner: true, path: '/ownerpage' }, ev: [{ n: 'ui_click', t: now(), p: { track_id: 'a.b', x: 1, y: 1, nth: 1 } }] }));
  await postEvents(srv, batch({ sid: t, ctx: { test: 'abc', path: '/testpage' }, ev: [{ n: 'ui_click', t: now(), p: { track_id: 'a.b', x: 1, y: 1, nth: 1 } }] }));
  assert.equal(db.prepare('select owner from events where sid = ?').get(o).owner, 1);
  assert.equal(db.prepare('select owner from sessions where sid = ?').get(o).owner, 1);
  assert.equal(db.prepare('select test from sessions where sid = ?').get(t).test, 'abc');
  assert.equal(count("select count(*) n from cursor_bins where path = '/ownerpage'"), 0);
  assert.equal(db.prepare("select test from cursor_bins where path = '/testpage'").get().test, 'abc');
});

test('cursor and click cells go to cursor_bins, cursor_sample is not an events row', async () => {
  const sid = hex16();
  const p = '/binpage';
  const ev = [
    { n: 'ui_click', t: now(), p: { track_id: 'x.y', x: 5, y: 6, nth: 1 } },
    { n: 'ui_click', t: now(), p: { track_id: 'x.y', x: 5, y: 6, nth: 2 } },
    { n: 'tap', t: now(), p: { x: 9, y: 9, track_id: 'x.y' } },
    { n: 'cursor_sample', t: now(), p: { cells: [[1, 2], [1, 2], '3,4', { x: 5, y: 6 }, [999, 1], 'bad'] } },
    { n: 'cursor_sample', t: now(), p: { cells: '7.8;7.8|7.8' } },
  ];
  assert.equal((await postEvents(srv, batch({ sid, ctx: { path: p, device: 'mobile' }, ev }))).status, 204);
  const bins = Object.fromEntries(db.prepare('select kind, x, y, n from cursor_bins where path = ?').all(p).map((r) => [`${r.kind}:${r.x}:${r.y}`, r.n]));
  assert.deepEqual(bins, { 'click:5:6': 2, 'tap:9:9': 1, 'move:1:2': 2, 'move:3:4': 1, 'move:5:6': 1, 'move:7:8': 3 });
  assert.equal(count("select count(*) n from events where sid = ? and name = 'cursor_sample'", sid), 0);
  assert.equal(count('select count(*) n from events where sid = ?', sid), 3);
  await postEvents(srv, batch({ sid: hex16(), ctx: { path: p, device: 'mobile' }, ev: [{ n: 'ui_click', t: now(), p: { track_id: 'x.y', x: 5, y: 6, nth: 1 } }] }));
  assert.equal(db.prepare("select n from cursor_bins where path = ? and kind = 'click' and x = 5").get(p).n, 3);
});

test('every catalogue event is accepted with its own params and nothing else', async () => {
  const cat = JSON.parse((await import('node:fs')).readFileSync(new URL('../../catalogue.json', import.meta.url)));
  const sid = hex16();
  const ev = Object.entries(cat.events).map(([n, spec]) => ({ n, t: now(), p: Object.fromEntries(spec.params.map((k) => [k, ['visible_s', 'active_s', 'max_scroll', 'percent', 'dwell_s', 'seconds', 'ms', 'read_s', 'x', 'y', 'nth', 'n', 'value'].includes(k) ? 3 : k.endsWith('path') ? '/p' : k === 'domain' ? 'example.com' : k === 'ext' ? 'pdf' : k === 'cells' ? [[1, 1]] : 'v1'])) }));
  for (let i = 0; i < ev.length; i += 40) assert.equal((await postEvents(srv, batch({ sid, ev: ev.slice(i, i + 40) }))).status, 204);
  const stored = new Set(db.prepare('select distinct name from events where sid = ?').all(sid).map((r) => r.name));
  for (const [n] of Object.entries(cat.events)) if (n !== 'cursor_sample') assert.ok(stored.has(n), n);
  const row = db.prepare("select params from events where sid = ? and name = 'ui_click'").get(sid);
  assert.deepEqual(Object.keys(JSON.parse(row.params)).sort(), ['nth', 'track_id', 'x', 'y', 'zone']);
});

test('drop counters record unknown events without storing payloads', async () => {
  await postEvents(srv, batch({ ev: [{ n: 'mystery_event', t: now(), p: {} }] }));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(count("select count(*) n from ingest_stats where kind = 'unknown_event' and detail = 'unknown'") >= 1);
  assert.equal(count("select count(*) n from ingest_stats where detail = 'mystery_event'"), 0);
  assert.ok(count("select count(*) n from ingest_stats where kind = 'batches'") >= 1);
});

test('future and ancient timestamps are clamped to server time', async () => {
  const sid = hex16();
  await postEvents(srv, batch({ sid, ev: [{ n: 'page_view', t: now() + 9e9, p: {} }, { n: 'page_view', t: 1000, p: {} }] }));
  const rows = db.prepare('select ts from events where sid = ?').all(sid);
  for (const r of rows) assert.ok(Math.abs(r.ts - now()) < 60000);
});
