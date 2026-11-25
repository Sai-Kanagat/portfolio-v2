import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';
import { startServer, makeAccess, postEvents, batch, hex16, BROWSER_UA } from './harness.mjs';

const A = makeAccess();
let srv, bare, db;
const ORIGIN = () => srv.base;
const get = (p, claims, opts) => srv.req('GET', p, { headers: { 'cf-access-jwt-assertion': A.sign(claims, opts) } });
const post = (p, body, opts = {}) => {
  const origin = 'origin' in opts ? opts.origin : ORIGIN();
  return srv.req('POST', p, { headers: { 'cf-access-jwt-assertion': A.sign(opts.claims), 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body });
};

before(async () => {
  srv = await startServer({ label: 'ops', vars: A.vars });
  bare = await startServer({ label: 'ops-bare' }); // no Access config at all
  db = srv.db();
  const now = Date.now();
  // real traffic
  const sid = hex16();
  await postEvents(srv, batch({ sid, ctx: { path: '/work', link: 'li-thallo-01' }, ev: [
    { n: 'page_view', t: now, p: { title_id: 'work' } },
    { n: 'ui_click', t: now, p: { track_id: 'nav.demos', zone: 'nav', x: 3, y: 4, nth: 1 } },
    { n: 'page_leave', t: now, p: { visible_s: 30, active_s: 12, max_scroll: 70 } },
    { n: 'demo_open', t: now, p: { demo_id: 'agora' } },
    { n: 'media_result', t: now, p: { demo_id: 'hands', kind: 'camera', state: 'granted' } },
    { n: 'form_view', t: now, p: { form_id: 'contact' } },
    { n: 'form_submit_success', t: now, p: { form_id: 'contact' } },
    { n: 'haunt_start', t: now, p: { mode: 'tour' } },
    { n: 'cv_download', t: now, p: { file_id: 'cv' } },
  ] }));
  // owner and test traffic that must be hidden by default
  await postEvents(srv, batch({ ctx: { path: '/work', owner: true }, ev: [{ n: 'ui_click', t: now, p: { track_id: 'OWNERBTN', x: 1, y: 1, nth: 1 } }] }));
  await postEvents(srv, batch({ ctx: { path: '/work', test: 't1' }, ev: [{ n: 'ui_click', t: now, p: { track_id: 'TESTBTN', x: 1, y: 1, nth: 1 } }] }));
  db.prepare("insert into links (slug,dest,channel,created,retired) values ('li-thallo-01','https://saikanagat.com/thallo/','li',?,0)").run(now);
  db.prepare("insert into link_clicks (ts,slug,country,device,is_bot) values (?,?,?,?,?)").run(now, 'li-thallo-01', 'IT', 'desktop', 0);
  db.prepare("insert into link_clicks (ts,slug,country,device,is_bot) values (?,?,?,?,?)").run(now, 'li-thallo-01', 'US', 'desktop', 1);
});
after(() => { srv && srv.stop(); bare && bare.stop(); });

const ENDPOINTS = ['live', 'acquisition', 'links', 'pages', 'buttons', 'heatmap?path=/work', 'visits', 'demos', 'forms', 'ghost', 'health', 'csv?table=events'];

test('no token, garbage and forged tokens are denied on pages and API', async () => {
  for (const p of ['/ops/', '/ops/app.js', '/api/ops/live', '/api/ops/csv?table=events', '/api/ops/links']) {
    assert.equal((await srv.req('GET', p)).status, 403, 'no token ' + p);
    assert.equal((await srv.req('GET', p, { headers: { 'cf-access-jwt-assertion': 'garbage' } })).status, 403, 'garbage ' + p);
    assert.equal((await srv.req('GET', p, { headers: { 'cf-access-jwt-assertion': A.sign({}, { key: A.forgedKey }) } })).status, 403, 'forged ' + p);
  }
  assert.equal((await srv.req('GET', '/ops')).status === 200, false);
});

test('claims are enforced: aud, iss, exp, nbf, email, alg, kid', async () => {
  const bad = [
    [{ aud: ['other-aud'] }, {}],
    [{ aud: 'other-aud' }, {}],
    [{ iss: 'https://evil.cloudflareaccess.com' }, {}],
    [{ exp: Math.floor(Date.now() / 1000) - 3600 }, {}],
    [{ nbf: Math.floor(Date.now() / 1000) + 3600 }, {}],
    [{ email: 'intruder@example.test' }, {}],
    [{ email: undefined }, {}],
    [{}, { header: { kid: 'unknown-kid' } }],
    [{}, { header: { alg: 'HS256' } }],
    [{}, { header: { alg: 'none' } }],
  ];
  for (const [claims, opts] of bad) assert.equal((await get('/api/ops/live', claims, opts)).status, 403, JSON.stringify([claims, opts]));
  const nonePayload = Buffer.from(JSON.stringify({ iss: `https://${A.team}`, aud: [A.aud], email: A.email, exp: 9999999999 })).toString('base64url');
  const none = `${Buffer.from('{"alg":"none","kid":"test-kid"}').toString('base64url')}.${nonePayload}.`;
  assert.equal((await srv.req('GET', '/api/ops/live', { headers: { 'cf-access-jwt-assertion': none } })).status, 403);
  const hs = crypto.createHmac('sha256', 'x').update('a.b').digest('base64url');
  assert.equal((await srv.req('GET', '/api/ops/live', { headers: { 'cf-access-jwt-assertion': `${Buffer.from('{"alg":"HS256","kid":"test-kid"}').toString('base64url')}.${nonePayload}.${hs}` } })).status, 403);
  assert.equal((await get('/api/ops/live', { email: 'SAI@Example.test' })).status, 200);
});

test('a valid token reaches the dashboard shell and its assets, with no-store and noindex', async () => {
  const r = await get('/ops/');
  assert.equal(r.status, 200);
  assert.match(r.text, /dashboard shell/);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal((await get('/ops/app.js')).status, 200);
  const viaCookie = await srv.req('GET', '/api/ops/live', { headers: { cookie: 'CF_Authorization=' + A.sign() } });
  assert.equal(viaCookie.status, 200);
});

test('fail closed: a server with no Access configuration denies even a well-formed token', async () => {
  for (const p of ['/ops/', '/api/ops/live', '/ops/app.js']) {
    const r = await bare.req('GET', p, { headers: { 'cf-access-jwt-assertion': A.sign() } });
    assert.equal(r.status, 403, p);
  }
  // and the test JWKS hook is dead unless ALLOW_TEST_JWKS=1 is bound
  const hookOnly = await startServer({ label: 'ops-hook', vars: { ...A.vars, ALLOW_TEST_JWKS: '0' } });
  try {
    assert.equal((await hookOnly.req('GET', '/api/ops/live', { headers: { 'cf-access-jwt-assertion': A.sign() } })).status, 403);
  } finally { hookOnly.stop(); }
});

test('every endpoint answers 200 with data and honours the owner and test exclusion', async () => {
  for (const p of ENDPOINTS) {
    const r = await get('/api/ops/' + p);
    assert.equal(r.status, 200, p + ' ' + r.text.slice(0, 200));
  }
  const buttons = (await get('/api/ops/buttons')).json.buttons.map((b) => b.track_id);
  assert.ok(buttons.includes('nav.demos'));
  assert.ok(!buttons.includes('OWNERBTN') && !buttons.includes('TESTBTN'));
  const withAll = (await get('/api/ops/buttons?include=owner,test')).json.buttons.map((b) => b.track_id);
  assert.ok(withAll.includes('OWNERBTN') && withAll.includes('TESTBTN'));
  const live = (await get('/api/ops/live')).json;
  assert.ok(live.recent.every((e) => !String(e.params).includes('OWNERBTN')));
});

test('endpoint contents match what was sent', async () => {
  const pages = (await get('/api/ops/pages')).json.pages.find((p) => p.path === '/work');
  assert.ok(pages.views >= 1);
  assert.equal(pages.avg_active_s, 12);
  const demos = (await get('/api/ops/demos')).json.demos;
  assert.equal(demos.find((d) => d.demo_id === 'agora').opens, 1);
  assert.equal(demos.find((d) => d.demo_id === 'hands').camera.granted, 1);
  const forms = (await get('/api/ops/forms')).json.forms.find((f) => f.form_id === 'contact');
  assert.equal(forms.view, 1);
  assert.equal(forms.success, 1);
  assert.equal((await get('/api/ops/ghost')).json.starts, 1);
  const links = (await get('/api/ops/links')).json.links.find((l) => l.slug === 'li-thallo-01');
  assert.equal(links.clicks_human, 1);
  assert.equal(links.clicks_bot, 1);
  assert.equal(links.sessions, 1);
  assert.equal(links.conversions, 2); // form_submit_success + cv_download are both key events
  assert.equal(links.demos, 1);
  assert.equal(links.active_s, 12);
  const acq = (await get('/api/ops/acquisition')).json;
  assert.ok(acq.channels.some((c) => c.channel === 'link:li'));
  const hm = (await get('/api/ops/heatmap?path=/work&kind=click&days=2')).json;
  assert.equal(hm.total, 1);
  const health = (await get('/api/ops/health')).json;
  assert.ok(health.events_24h >= 9);
  const sid = (await get('/api/ops/visits')).json.sessions[0].sid;
  const tl = (await get('/api/ops/visits?sid=' + sid)).json;
  assert.ok(Array.isArray(tl.events));
});

test('query parameters are parameterised: injection returns 400 or inert results, tables survive', async () => {
  const evil = "'; DROP TABLE events; --";
  assert.equal((await get('/api/ops/visits?sid=' + encodeURIComponent(evil))).status, 400);
  assert.equal((await get('/api/ops/heatmap?path=' + encodeURIComponent(evil))).status, 400);
  assert.equal((await get('/api/ops/csv?table=' + encodeURIComponent('events; DROP TABLE events'))).status, 400);
  for (const q of ['days=' + encodeURIComponent(evil), 'include=' + encodeURIComponent(evil), 'from=' + encodeURIComponent(evil)]) {
    assert.equal((await get('/api/ops/pages?' + q)).status, 200, q);
  }
  // device is a validated filter: anything outside desktop, mobile, tablet is refused rather than ignored
  assert.equal((await get('/api/ops/pages?device=' + encodeURIComponent(evil))).status, 400);
  assert.equal((await get('/api/ops/buttons?path=' + encodeURIComponent(evil))).status, 200);
  assert.equal(db.prepare("select count(*) n from sqlite_master where name = 'events'").get().n, 1);
});

test('links: clicks cannot be split by owner or test, and the response says so', async () => {
  const a = (await get('/api/ops/links')).json;
  const b = (await get('/api/ops/links?include=owner,test')).json;
  const pick = (d) => d.links.find((l) => l.slug === 'li-thallo-01');
  assert.deepEqual([pick(a).clicks_human, pick(a).clicks_bot], [pick(b).clicks_human, pick(b).clicks_bot], 'include= does not change click counts');
  assert.match(a.clicks_note, /cannot be split by owner or test/);
  assert.deepEqual(db.prepare("select name from pragma_table_info('link_clicks')").all().map((r) => r.name).filter((n) => /owner|test|vid|sid/.test(n)), [], 'the table has no owner or test column');
});

test('CSV export neutralises formulas', async () => {
  db.prepare("insert into links (slug,dest,channel,campaign,created,retired) values ('li-csv-test','https://saikanagat.com/','li','=HYPERLINK(1)',?,0)").run(Date.now());
  const r = await get('/api/ops/csv?table=links');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/csv/);
  assert.ok(r.text.includes("'=HYPERLINK(1)"));
  assert.ok(!/(^|,)=HYPERLINK/m.test(r.text));
});

test('link create and retire: same-origin only, duplicates and bad input refused', async () => {
  const body = JSON.stringify({ slug: 'cv-acme-growth', dest: 'https://saikanagat.com/hire', app_label: 'acme-growth' });
  assert.equal((await post('/api/ops/links', body, { origin: undefined })).status, 403);
  assert.equal((await post('/api/ops/links', body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await srv.req('POST', '/api/ops/links', { headers: { 'content-type': 'application/json', origin: ORIGIN() }, body })).status, 403, 'no token');
  const ok = await post('/api/ops/links', body);
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual(ok.json.warnings, []);
  assert.equal((await post('/api/ops/links', body)).status, 409);
  assert.equal((await post('/api/ops/links', JSON.stringify({ slug: 'cv-x', dest: 'https://evil.example/' }))).status, 400);
  assert.equal((await post('/api/ops/links', JSON.stringify({ slug: 'zz-x', dest: 'https://saikanagat.com/' }))).status, 400);
  assert.equal((await post('/api/ops/links', JSON.stringify({ slug: 'cv-x', dest: 'https://saikanagat.com/', app_label: 'Bad Label' }))).status, 400);
  const named = await post('/api/ops/links', JSON.stringify({ slug: 'cv-maria-rossi', dest: 'https://saikanagat.com/' }));
  assert.equal(named.status, 201);
  assert.ok(named.json.warnings.length >= 1);
  const ret = await post('/api/ops/links/retire', JSON.stringify({ slug: 'cv-acme-growth' }));
  assert.equal(ret.status, 200);
  assert.equal(db.prepare("select retired from links where slug = 'cv-acme-growth'").get().retired, 1);
  assert.equal((await post('/api/ops/links/retire', JSON.stringify({ slug: 'cv-nothing' }))).status, 404);
  assert.equal((await post('/api/ops/links/retire', '{bad')).status, 400);
});

// =====================================================================================================
// Measurement gaps. A second server with its own real local D1, seeded through the real ingest endpoint,
// so every number below is what a visitor's events produce. Each assertion fails on the old behaviour.
// =====================================================================================================
let M, mdb;
const mget = (p) => M.req('GET', p, { headers: { 'cf-access-jwt-assertion': A.sign() } });
const vids = {};
async function send(ctx, ev, extra = {}) {
  const now = Date.now();
  const r = await postEvents(M, batch({ ctx, ev: ev.map((e) => ({ n: e[0], t: now, p: e[1] || {} })), ...extra }));
  assert.equal(r.status, 204, `${ev.map((e) => e[0]).join(',')} -> ${r.status} ${r.text}`);
}
const sess = (ctx, ev, extra) => send(ctx, ev, { sid: hex16(), ...extra });

before(async () => {
  M = await startServer({ label: 'ops-metrics', vars: A.vars });
  mdb = M.db();
  // ---- buttons: /work has 4 visits (3 desktop, 1 mobile). work.a is clicked by 3 of them, work.b by 1, work.c by none.
  const W = { path: '/work', device: 'desktop' };
  await sess(W, [['page_view', { title_id: 'work' }], ['ui_click', { track_id: 'work.a', zone: 'work', x: 1, y: 1, nth: 1 }], ['ui_click', { track_id: 'work.a', zone: 'work', x: 1, y: 1, nth: 2 }], ['ui_click', { track_id: 'work.b', zone: 'work', x: 2, y: 1, nth: 3 }]]);
  await sess(W, [['page_view', { title_id: 'work' }]]);
  await sess({ ...W, device: 'mobile' }, [['page_view', { title_id: 'work' }], ['ui_click', { track_id: 'work.a', zone: 'work', x: 1, y: 1, nth: 1 }]]);
  await sess(W, [['page_view', { title_id: 'work' }], ['ui_click', { track_id: 'work.a', zone: 'work', x: 1, y: 1, nth: 1 }]]);
  await sess({ path: '/about', device: 'mobile' }, [['page_view', { title_id: 'about' }]]); // a page nobody clicked on
  // ---- demos: agora. A opened twice, started, engaged 10 and 60, ended, model loaded. B opened, started, engaged 10.
  const D = { path: '/demos/agora' };
  await sess(D, [['demo_open', { demo_id: 'agora' }], ['demo_open', { demo_id: 'agora' }], ['demo_start', { demo_id: 'agora', mode: 'x' }], ['demo_engaged', { demo_id: 'agora', seconds: 10 }], ['demo_engaged', { demo_id: 'agora', seconds: 60 }], ['demo_end', { demo_id: 'agora', ms: 70000, reason: 'back' }], ['model_state', { demo_id: 'agora', state: 'loaded', ms: 1200, delegate: 'gpu' }], ['media_result', { demo_id: 'agora', kind: 'camera', state: 'prompt' }], ['media_result', { demo_id: 'agora', kind: 'camera', state: 'prompt' }], ['media_result', { demo_id: 'agora', kind: 'camera', state: 'granted' }]]);
  await sess(D, [['demo_open', { demo_id: 'agora' }], ['demo_start', { demo_id: 'agora', mode: 'x' }], ['demo_engaged', { demo_id: 'agora', seconds: 10 }], ['model_state', { demo_id: 'agora', state: 'loaded', ms: 800, delegate: 'cpu' }], ['media_result', { demo_id: 'agora', kind: 'camera', state: 'prompt' }], ['media_result', { demo_id: 'agora', kind: 'camera', state: 'denied' }]]);
  await sess(D, [['demo_open', { demo_id: 'agora' }]]); // opened, never started
  await sess(D, [['demo_start', { demo_id: 'agora', mode: 'x' }]]); // started with no open event (skipped step)
  await sess({ ...D, device: 'mobile' }, [['demo_open', { demo_id: 'agora' }], ['demo_start', { demo_id: 'agora', mode: 'x' }], ['model_state', { demo_id: 'agora', state: 'failed', delegate: 'cpu' }]]);
  await sess({ path: '/' }, [['demo_action', { demo_id: 'pg.home', action: 'hero_settled' }], ['demo_action', { demo_id: 'pg.home', action: 'shutter_progress', value: 50 }]]); // a page action, not a demo
  // ---- forms: contact
  const F = { path: '/contact' };
  await sess(F, [['form_view', { form_id: 'contact' }], ['form_start', { form_id: 'contact' }], ['form_field', { form_id: 'contact', field: 'name' }], ['form_field', { form_id: 'contact', field: 'email' }], ['form_submit_attempt', { form_id: 'contact' }], ['form_submit_attempt', { form_id: 'contact' }], ['form_submit_success', { form_id: 'contact' }]]);
  await sess(F, [['form_view', { form_id: 'contact' }], ['form_start', { form_id: 'contact' }], ['form_abandon', { form_id: 'contact', field: 'email' }]]);
  await sess(F, [['form_start', { form_id: 'contact' }], ['form_submit_attempt', { form_id: 'contact' }]]); // never saw a view event
  await sess(F, [['form_view', { form_id: 'contact' }]]);
  // ---- newsletter
  const N = { path: '/blog' };
  await sess(N, [['newsletter_fab_shown', { page_path: '/blog' }], ['newsletter_view', { page_path: '/blog' }], ['newsletter_start', { page_path: '/blog' }], ['newsletter_request', { page_path: '/blog' }], ['newsletter_confirmed', { page_path: '/blog' }]]);
  await sess(N, [['newsletter_view', { page_path: '/blog' }], ['newsletter_start', { page_path: '/blog' }], ['newsletter_invalid', { page_path: '/blog' }], ['newsletter_invalid', { page_path: '/blog' }]]);
  await sess({ path: '/about' }, [['newsletter_view', { page_path: '/about' }], ['newsletter_start', { page_path: '/about' }], ['newsletter_request', { page_path: '/about' }], ['newsletter_failed', { page_path: '/about' }]]);
  // ---- channels: inserted into sessions directly (the ingest path is covered above). Same visitor, several groups.
  const T = Date.now();
  let k = 0;
  const addSession = (o) => mdb.prepare('insert into sessions (sid,vid,first_ts,last_ts,landing,ref_host,utm_source,utm_medium,utm_campaign,link,country,device,owner,test,pages,events,active_ms) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(++k).padStart(16, '0'), o.vid, T - 1000, T, '/', o.ref ?? null, o.utm ?? null, null, null, o.link ?? null, 'IT', o.device ?? 'desktop', o.owner ?? 0, '', 1, 1, o.active ?? 1000);
  vids.ai = 'a'.repeat(16); vids.b = 'b'.repeat(16); vids.c = 'c'.repeat(16);
  addSession({ vid: vids.ai, ref: 'chatgpt.com' }); addSession({ vid: vids.ai, ref: 'www.perplexity.ai' }); addSession({ vid: vids.ai, utm: 'Gemini' });
  addSession({ vid: vids.b, utm: 'claude.ai' }); addSession({ vid: vids.b, utm: 'copilot' }); addSession({ vid: vids.c, utm: 'newsletter' });
  addSession({ vid: vids.c, ref: 'news.example' }); addSession({ vid: vids.c, link: 'li-thallo-01', ref: 'chatgpt.com' }); addSession({ vid: vids.c });
  addSession({ vid: vids.b, ref: 'www.google.com', device: 'mobile' });
  for (let i = 0; i < 30; i++) { addSession({ vid: String(i).padStart(16, 'd'), ref: `www.google.c${String(i).padStart(2, '0')}` }); addSession({ vid: String(i).padStart(16, 'e'), ref: `c${String(i).padStart(2, '0')}.chatgpt.com` }); }
});
after(() => { M && M.stop(); });

test('buttons: denominator is every visit that viewed the path, returned as its own field with the count', async () => {
  const d = (await mget('/api/ops/buttons?path=/work')).json;
  const a = d.buttons.find((b) => b.track_id === 'work.a');
  assert.equal(a.clicks, 4);
  assert.equal(a.sessions, 3, 'visits that clicked');
  assert.equal(a.page_sessions, 4, 'visits that viewed /work, clicked or not');
  assert.equal(a.click_rate, 0.75);
  assert.equal(d.buttons.find((b) => b.track_id === 'work.b').page_sessions, 4);
  assert.deepEqual(d.paths, [{ path: '/work', sessions: 4 }]);
  const all = (await mget('/api/ops/buttons')).json;
  assert.deepEqual(all.paths.map((p) => [p.path, p.sessions]).sort(), [['/about', 1], ['/work', 4]], 'paths nobody clicked on still carry a denominator');
  assert.equal(all.truncated, false);
});

test('buttons: device filter changes numerator and denominator together, and is validated', async () => {
  const dsk = (await mget('/api/ops/buttons?path=/work&device=desktop')).json;
  const a = dsk.buttons.find((b) => b.track_id === 'work.a');
  assert.deepEqual([a.clicks, a.sessions, a.page_sessions], [3, 2, 3]);
  const mob = (await mget('/api/ops/buttons?path=/work&device=mobile')).json;
  assert.deepEqual([mob.buttons.length, mob.buttons[0].sessions, mob.buttons[0].page_sessions], [1, 1, 1]);
  assert.equal(mob.scope.device, 'mobile');
  assert.equal((await mget('/api/ops/buttons')).json.scope.device, null);
  assert.equal((await mget('/api/ops/acquisition?device=mobile')).json.scope.device, null, 'an endpoint that ignores device does not claim it');
  for (const ep of ['buttons', 'pages', 'demos', 'visits']) {
    assert.equal((await mget(`/api/ops/${ep}?device=phone`)).status, 400, ep + ' rejects an unknown device');
    assert.equal((await mget(`/api/ops/${ep}?device=${encodeURIComponent("mobile' OR '1'='1")}`)).status, 400, ep + ' rejects injection');
    assert.equal((await mget(`/api/ops/${ep}?device=tablet`)).status, 200, ep + ' accepts tablet');
  }
});

test('pages and visits honour the device filter', async () => {
  const all = (await mget('/api/ops/pages')).json.pages.find((p) => p.path === '/work');
  const mob = (await mget('/api/ops/pages?device=mobile')).json.pages.find((p) => p.path === '/work');
  const dsk = (await mget('/api/ops/pages?device=desktop')).json.pages.find((p) => p.path === '/work');
  assert.deepEqual([all.views, dsk.views, mob.views], [4, 3, 1]);
  const v = (await mget('/api/ops/visits?device=mobile&limit=200')).json.sessions;
  assert.ok(v.length >= 3 && v.every((s) => s.device === 'mobile'));
  assert.ok((await mget('/api/ops/visits?limit=200')).json.sessions.some((s) => s.device === 'desktop'));
});

test('demos: distinct visits per step beside event counts, 10 s and 60 s apart, funnel never exceeds its predecessor', async () => {
  const g = (await mget('/api/ops/demos')).json.demos.find((x) => x.demo_id === 'agora');
  assert.equal(g.opens, 5, 'open events');
  assert.deepEqual([g.sessions.opened, g.sessions.started, g.sessions.engaged_10, g.sessions.engaged_60, g.sessions.ended], [4, 4, 2, 1, 1]);
  assert.deepEqual([g.engaged_10, g.engaged_60], [2, 1], 'engaged events by milestone');
  assert.equal(g.engaged, undefined, 'the merged engaged count is gone');
  assert.deepEqual(g.funnel, { opened: 4, started: 3, engaged_10: 2, engaged_60: 1 });
  const f = g.funnel;
  assert.ok(f.opened >= f.started && f.started >= f.engaged_10 && f.engaged_10 >= f.engaged_60);
  assert.deepEqual(g.skipped, { started: 1, engaged_10: 0, engaged_60: 0 }, 'the visit that started without an open event is explained, not hidden');
  assert.deepEqual([g.camera.prompt, g.camera_sessions.prompt, g.camera.granted, g.camera_sessions.granted], [3, 2, 1, 1]);
  const mob = (await mget('/api/ops/demos?device=mobile')).json.demos.find((x) => x.demo_id === 'agora');
  assert.deepEqual([mob.sessions.opened, mob.sessions.started, mob.funnel.started], [1, 1, 1]);
});

test('demos: pg.* ids are page actions, never listed as demos', async () => {
  const j = (await mget('/api/ops/demos')).json;
  assert.ok(!j.demos.some((x) => /^pg\./.test(x.demo_id)), 'no pg.* row in demos');
  assert.deepEqual(j.page_actions.map((x) => [x.page, x.action, x.n]).sort(), [['home', 'hero_settled', 1], ['home', 'shutter_progress', 1]]);
  assert.ok(j.page_actions.every((x) => x.sessions === 1 && x.visitors === 1));
  const m = (await mget('/api/ops/demos?device=mobile')).json;
  assert.ok(!m.demos.some((x) => /^pg\./.test(x.demo_id)));
});

test('demos: model_state is aggregated per demo', async () => {
  const g = (await mget('/api/ops/demos')).json.demos.find((x) => x.demo_id === 'agora');
  assert.deepEqual([g.model.loaded, g.model.failed, g.model.loaded_sessions, g.model.failed_sessions], [2, 1, 2, 1]);
  assert.equal(g.model.avg_ms, 1000);
  assert.equal(g.model.ms_n, 2);
  assert.deepEqual(g.model.delegates.map((d) => [d.delegate, d.loaded, d.failed]).sort(), [['cpu', 1, 1], ['gpu', 1, 0]]);
  assert.equal(g.errors, 0);
});

test('forms: distinct visits per step beside events, funnel nests, skipped steps are counted', async () => {
  const c = (await mget('/api/ops/forms')).json.forms.find((f) => f.form_id === 'contact');
  assert.deepEqual([c.view, c.start, c.field, c.attempt, c.success, c.abandon], [3, 3, 2, 3, 1, 1], 'events');
  assert.deepEqual([c.sessions.view, c.sessions.start, c.sessions.attempt, c.sessions.success, c.sessions.abandon], [3, 3, 2, 1, 1], 'visits');
  assert.deepEqual(c.funnel, { view: 3, start: 2, attempt: 1, success: 1 });
  assert.deepEqual(c.skipped, { start: 1, attempt: 1, success: 0 });
  assert.equal(c.abandoned_after_start, 1, 'F2 viewed, started and left');
  assert.ok(c.abandoned_after_start <= c.funnel.start, 'abandoned is counted inside the started visits');
  assert.deepEqual(c.abandon_fields, [{ field: 'email', n: 1 }]);
});

test('forms: newsletter events are aggregated with visits per step, by page, and the funnel nests', async () => {
  const n = (await mget('/api/ops/forms')).json.newsletter;
  assert.deepEqual([n.view, n.fab_shown, n.start, n.invalid, n.request, n.failed, n.confirmed], [3, 1, 3, 2, 2, 1, 1], 'events');
  assert.deepEqual([n.sessions.view, n.sessions.start, n.sessions.invalid, n.sessions.request, n.sessions.confirmed], [3, 3, 1, 2, 1], 'visits');
  assert.deepEqual(n.funnel, { view: 3, start: 3, request: 2, confirmed: 1 });
  const by = Object.fromEntries(n.by_page.map((p) => [p.page_path, p]));
  assert.deepEqual([by['/blog'].view, by['/blog'].request, by['/about'].view, by['/about'].request], [2, 1, 1, 1]);
});

test('where from: visitors are distinct per channel, and assistant utm_source counts as channel ai', async () => {
  const a = (await mget('/api/ops/acquisition')).json;
  const ch = Object.fromEntries(a.channels.map((c) => [c.channel, c]));
  // visitor aaaa arrived by chatgpt.com, perplexity and a Gemini tag: three groups, one person. bbbb by claude and copilot tags.
  assert.deepEqual([ch.ai.sessions, ch.ai.visitors], [3 + 2 + 30, 1 + 1 + 30], 'ai: referrer hosts and utm_source together, visitors distinct');
  assert.deepEqual([ch.search.sessions, ch.search.visitors], [31, 31]);
  assert.deepEqual([ch['link:li'].sessions, ch['link:li'].visitors], [1, 1], 'a tracked link wins over the referrer');
  assert.equal(ch['utm:newsletter'].sessions, 1);
  assert.ok(!Object.keys(ch).some((k) => /^utm:(gemini|claude|copilot)/i.test(k)), 'assistant tags are not left under utm');
  // vid cccc has a direct, a referral, a link and a tag session: its visitor count is one per channel, never summed across groups
  assert.equal(ch.direct.visitors, 1);
  assert.equal(ch.referral.visitors, 1);
});

test('where from: AI and search referrers are not cut at 25 rows', async () => {
  const a = (await mget('/api/ops/acquisition')).json;
  assert.equal(a.referrers.length, 25, 'the general list stays a top 25');
  assert.equal(a.ai_referrers.length, 32, 'chatgpt.com, perplexity and 30 more');
  assert.equal(a.search_referrers.length, 31);
  assert.equal(a.ai_referrers.find((r) => r.ref_host === 'chatgpt.com').sessions, 2);
  assert.deepEqual(a.ai_utm.map((r) => r.utm_source.toLowerCase()).sort(), ['claude.ai', 'copilot', 'gemini']);
  assert.deepEqual(a.search_utm, []);
  assert.ok(a.ai_referrers.every((r) => /chatgpt|perplexity/.test(r.ref_host)) && a.search_referrers.every((r) => /google\./.test(r.ref_host)));
});

test('channel classification in SQL matches channelOf for edge cases (case, empty strings, link without a hyphen)', async () => {
  const { channelOf } = await import('../../../functions/_lib/ops.js');
  const T0 = Date.UTC(2019, 0, 1);
  const cases = [
    { link: '', utm: '', ref: 'WWW.GOOGLE.COM' }, { link: '', utm: 'ChatGPT.com', ref: '' }, { link: 'cvonly', utm: '', ref: '' }, { link: 'LI-ABC', utm: 'x', ref: 'bing.com' },
    { link: null, utm: 'Perplexity', ref: 'www.google.com' }, { link: null, utm: null, ref: 'Claude.AI' }, { link: null, utm: null, ref: 'gemini.google.com' },
    { link: null, utm: null, ref: 'copilot.microsoft.com' }, { link: null, utm: null, ref: 'www.linkedin.com' }, { link: null, utm: null, ref: 'lnkd.in' },
    { link: null, utm: null, ref: 'you.com' }, { link: null, utm: null, ref: 'phind.com' }, { link: null, utm: 'newsletter', ref: 'www.google.com' }, { link: null, utm: null, ref: 'example.org' },
    { link: null, utm: null, ref: null }, { link: null, utm: null, ref: 'duckduckgo.com' }, { link: null, utm: 'openai', ref: null },
    { link: null, utm: null, ref: 't.co' }, { link: null, utm: null, ref: 'www.microsoft.com' }, { link: null, utm: null, ref: 'x.com' }, { link: null, utm: null, ref: 'www.box.com' }, { link: null, utm: null, ref: 'l.t.co' },
  ];
  cases.forEach((c, i) => mdb.prepare('insert into sessions (sid,vid,first_ts,last_ts,landing,ref_host,utm_source,link,country,device,owner,test,pages,events,active_ms) values (?,?,?,?,?,?,?,?,?,?,0,?,1,1,0)')
    .run('9'.repeat(8) + String(i).padStart(8, '0'), '9'.repeat(8) + String(i).padStart(8, '0'), T0 + i, T0 + i, '/', c.ref, c.utm, c.link, 'IT', 'desktop', ''));
  const a = (await mget(`/api/ops/acquisition?from=${T0 - 10}&to=${T0 + 100}`)).json;
  const want = {};
  for (const c of cases) { const k = channelOf({ link: c.link, utm_source: c.utm, ref_host: c.ref }); want[k] = (want[k] || 0) + 1; }
  const got = Object.fromEntries(a.channels.map((c) => [c.channel, c.sessions]));
  assert.deepEqual(got, want);
  assert.equal(channelOf({ utm_source: 'gemini' }), 'ai');
  assert.deepEqual(['t.co', 'x.com', 'l.t.co', 'lnkd.in'].map((h) => channelOf({ ref_host: h })), ['social', 'social', 'social', 'social']);
  assert.deepEqual(['www.microsoft.com', 'www.box.com', 'fedex.com'].map((h) => channelOf({ ref_host: h })), ['referral', 'referral', 'referral'], 't.co and x.com must not match inside other hosts');
});

test('buttons: a link click is counted once, because track.js sends ui_click beside nav_click, email_click and outbound_click', async () => {
  // js/track.js runs sem() (the semantic event) and then always ui_click with the same track_id, so link controls are not left at 0.
  const L = { path: '/linkpage', device: 'desktop' };
  await sess(L, [['page_view', { title_id: 'lp' }], ['nav_click', { track_id: 'nav.about', zone: 'nav' }], ['ui_click', { track_id: 'nav.about', zone: 'nav', x: 1, y: 1, nth: 1 }],
    ['email_click', { track_id: 'contact.mail' }], ['ui_click', { track_id: 'contact.mail', zone: 'contact', x: 2, y: 1, nth: 2 }]]);
  const d = (await mget('/api/ops/buttons?path=/linkpage')).json;
  assert.deepEqual(d.buttons.map((b) => [b.track_id, b.clicks, b.sessions, b.page_sessions]).sort(), [['contact.mail', 1, 1, 1], ['nav.about', 1, 1, 1]]);
});

// =====================================================================================================
// Read cost. D1 free tier is 5M rows read per day, and a scan reads every row it passes. Every query the
// endpoints really issue is captured by running the real handlers against the real local D1 file, then
// EXPLAIN QUERY PLAN is run on exactly that SQL with exactly those binds.
// =====================================================================================================
async function captureQueries(urls) {
  const { registerHooks } = await import('node:module');
  // links.js imports catalogue.json without an import attribute, which node refuses. Add it in a resolve hook (test only).
  registerHooks({ resolve(spec, context, next) { const r = next(spec, context); return spec.endsWith('.json') ? { ...r, importAttributes: { type: 'json' } } : r; } });
  const out = [];
  let current = '';
  const run = (sql, b) => { out.push({ url: current, sql, binds: b }); return mdb.prepare(sql); };
  const env = { DB: { prepare: (sql) => ({ bind: (...b) => ({
    all: async () => ({ results: run(sql, b).all(...b) }),
    first: async () => run(sql, b).get(...b) ?? null,
    run: async () => ({ meta: { changes: 0 } }),
  }) }) } };
  for (const u of urls) {
    current = u;
    const name = u.split('?')[0];
    const mod = await import(`../../../functions/api/ops/${name}.js`);
    const res = await mod.onRequestGet({ env, request: new Request('http://x/api/ops/' + u) });
    assert.equal(res.status, 200, u);
  }
  return out;
}
const planOf = (q) => mdb.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.binds).map((r) => r.detail);

const PLAN_URLS = [
  'live', 'acquisition', 'pages', 'pages?device=mobile', 'buttons', 'buttons?path=/work&device=mobile', 'heatmap?path=/work', 'visits', 'visits?device=mobile', 'visits?sid=aaaaaaaaaaaaaaaa',
  'demos', 'demos?device=mobile', 'forms', 'ghost', 'health', 'links', 'csv?table=events', 'csv?table=sessions', 'csv?table=link_clicks', 'csv?table=links', 'csv?table=daily_rollup', 'csv?table=cursor_bins',
];

test('read cost: no query scans events, sessions or link_clicks without an index, and each uses the index it should', async () => {
  const qs = await captureQueries(PLAN_URLS);
  assert.ok(qs.length > 40, 'queries captured: ' + qs.length);
  const rules = [
    [/FROM events[\s\S]*\bname (=|IN) /, /idx_events_name_ts \(name=\? AND ts>\?/], // every events query that filters by event name
    [/FROM events WHERE sid = \?1/, /idx_events_sid/],
    [/FROM sessions WHERE first_ts >= \?1/, /idx_sessions_first/],
    [/FROM sessions WHERE last_ts > \?1/, /idx_sessions_last/],
    [/FROM link_clicks WHERE ts >= \?1/, /idx_clicks_ts/],
    [/FROM cursor_bins WHERE path = \?1/, /idx_bins_path/],
  ];
  // Left over on purpose, each reported to the owner: a newest-first read stopped by LIMIT 50, small config tables, whole-table exports.
  const ALLOWED_SCAN = [
    [/ORDER BY id DESC LIMIT 50/, /SCAN events/], // live "latest events": walks back from the newest row and stops after 50 matches
    [/FROM health ORDER BY id DESC/, /SCAN health/], // 40 newest checks
    [/FROM links ORDER BY/, /SCAN links/], // a few hundred link definitions
    [/FROM daily_rollup/, /SCAN daily_rollup/], [/FROM cursor_bins WHERE test/, /SCAN cursor_bins/], // whole-table CSV exports, 50000 rows at most
  ];
  const bad = [];
  for (const q of qs) {
    const plan = planOf(q).join(' | ');
    for (const m of plan.matchAll(/SCAN (events|sessions|link_clicks|cursor_bins|daily_rollup|links|health|ingest_stats)\b/g)) {
      if (!ALLOWED_SCAN.some(([sqlRe, planRe]) => sqlRe.test(q.sql) && planRe.test(plan))) bad.push(`SCAN ${m[1]} :: ${q.url} :: ${q.sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    for (const [sqlRe, planRe] of rules) if (sqlRe.test(q.sql) && !planRe.test(plan)) bad.push(`wanted ${planRe} :: ${q.url} :: ${q.sql.replace(/\s+/g, ' ').slice(0, 90)} :: ${plan}`);
  }
  assert.deepEqual(bad, [], 'queries without the expected index:\n' + bad.join('\n'));
});

test('read cost: the auto cursor view reads haunt events through the name index, not every event in the period', async () => {
  const [q] = (await captureQueries(['ghost'])).filter((x) => /haunt_start/.test(x.sql));
  assert.match(planOf(q).join(' | '), /idx_events_name_ts \(name=\? AND ts>\? AND ts<\?\)/);
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracking/catalogue.json'), 'utf8')).events;
  const src = fs.readFileSync(path.join(ROOT, 'functions/api/ops/ghost.js'), 'utf8');
  for (const n of Object.keys(cat).filter((k) => k.startsWith('haunt_'))) assert.ok(src.includes(`'${n}'`), `ghost.js lists ${n}`);
});

test('every ops query is parameterised: no request value appears in the SQL text', async () => {
  const marker = 'zzmark';
  const qs = await captureQueries(['pages?device=mobile', 'buttons?path=/work&device=desktop', 'visits?device=tablet', 'demos?device=mobile']);
  for (const q of qs) {
    assert.ok(!q.sql.includes('/work') && !/'(mobile|desktop|tablet)'/.test(q.sql), 'literal request value in SQL: ' + q.sql.slice(0, 80));
    assert.ok(!q.sql.includes(marker));
  }
  assert.ok(qs.some((q) => q.binds.includes('mobile')) && qs.some((q) => q.binds.includes('/work')), 'values travel as binds');
});

// =====================================================================================================
// ops/controls.json generator: every known control, rerunnable, tolerant of files that are not there yet.
// =====================================================================================================
import { spawnSync } from 'node:child_process';
import os from 'node:os';
const CONTROLS = path.join(ROOT, 'tracking/scripts/controls.mjs');
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-controls-'));
  for (const [f, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), typeof v === 'string' ? v : JSON.stringify(v)); }
  return root;
}
const runControls = (root, ...extra) => spawnSync(process.execPath, [CONTROLS, `--root=${root}`, ...extra], { encoding: 'utf8' });
const cc = (tr) => ({ t: 'a', id: '', n: '', x: 'x', h: '', tr });

test('controls.mjs: merges coverage and maps, maps pages to the paths browsers report, drops ignored entries, no duplicates', () => {
  const root = fixture({
    'tracking/coverage.json': { pages: {
      'index.html': { desktop: { controls: [cc('nav.work'), cc('hero.cta'), cc('')] }, mobile: { controls: [cc('nav.work'), cc('nav.menu')] } },
      'thallo/index.html': { desktop: { controls: [cc('th.join')] }, mobile: { controls: [] } },
      'work.html': { desktop: { controls: [cc('work.a'), cc('work.a')] } },
      'demos/hands.html': { desktop: { controls: [cc('hands.cam'), cc('hands.start')] } },
    }, listeners: {} },
    'tracking/maps/media.json': { _schema: 'x', 'demos/hands.html': { controls: { '#startBtn[data-track=hands.start]': { events: ['x'] }, 'video#cam[data-track=hands.cam]': { ignored: 'display only' }, 'a[data-track="hands.home"]': { events: [] },
      '.swatch[data-track=hands.swatch.green|red|blue]': { events: [] }, '[data-track^=hands.row]': { events: [] }, '[data-track*=hands.any]': { events: [] }, '.shape[data-track=hands.guide.<id>] (30, runtime)': { events: [] } } } },
    'tracking/maps/tools.json': { version: 1, pages: { 'demos/agora.html': { controls: { 'agora.go': { kind: 'button' }, 'agora.pad': { ignored: 'display' } } } } },
    'tracking/maps/pages.json': { pages: { 'about.html': { controls: { 'a[data-track=about.cv]': { events: [] }, '.decor': { ignored: 'x' } } } }, common: { controls: { 'a[data-track=nav.work]': { events: [] } } } },
  });
  const r = runControls(root);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(fs.readFileSync(path.join(root, 'ops/controls.json'), 'utf8'));
  const key = (c) => `${c.path} ${c.id}`;
  assert.deepEqual(d.controls.map(key), [
    '/ hero.cta', '/ nav.menu', '/ nav.work', '/about about.cv', '/demos/agora agora.go', '/demos/hands hands.home', '/demos/hands hands.start', '/demos/hands hands.swatch.blue', '/demos/hands hands.swatch.green', '/demos/hands hands.swatch.red', '/thallo/ th.join', '/work work.a',
  ]);
  assert.deepEqual(d.controls.find((c) => c.id === 'nav.menu').devices, ['mobile'], 'seen only on mobile');
  assert.deepEqual(d.controls.find((c) => c.id === 'nav.work').devices, ['desktop', 'mobile']);
  assert.equal(d.controls.find((c) => c.id === 'hero.cta').zone, 'hero');
  assert.ok(!d.controls.some((c) => c.id === 'hands.cam' || c.id === 'agora.pad'), 'ignored map entries are left out even when the crawler saw the id');
  assert.ok(!d.controls.some((c) => /row|any|<id>/.test(c.id)), 'prefix and substring selectors and runtime placeholders are patterns, not controls');
  assert.deepEqual(d.counts, { controls: 12, pages: 6 });
  assert.deepEqual(d.sources, { coverage: { found: true, controls: 6 }, pages: { found: true, controls: 1 }, media: { found: true, controls: 5 }, tools: { found: true, controls: 1 } }, 'a control in two sources counts in both');
});

test('controls.mjs: rerunnable (same bytes), --check flags a stale file, and a missing pages.json is tolerated', () => {
  const root = fixture({ 'tracking/coverage.json': { pages: { 'index.html': { desktop: { controls: [cc('a.b')] } } } }, 'tracking/maps/media.json': {}, 'tracking/maps/tools.json': { pages: {} } });
  const out = path.join(root, 'ops/controls.json');
  const first = runControls(root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /pages\.json: not found, skipped/);
  const a = fs.readFileSync(out, 'utf8');
  assert.equal(runControls(root).status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), a, 'rerun writes the same bytes');
  assert.equal(runControls(root, '--check').status, 0);
  assert.equal(JSON.parse(a).sources.pages.found, false);
  fs.writeFileSync(path.join(root, 'tracking/coverage.json'), JSON.stringify({ pages: { 'index.html': { desktop: { controls: [cc('a.b'), cc('a.c')] } } } }));
  assert.equal(runControls(root, '--check').status, 1, 'stale after the coverage changed');
  assert.equal(runControls(root).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).counts.controls, 2);
});

test('controls.mjs: with no inputs at all, or unreadable ones, it still writes an empty valid list and exits 0', () => {
  const none = fixture({});
  assert.equal(runControls(none).status, 0);
  const e = JSON.parse(fs.readFileSync(path.join(none, 'ops/controls.json'), 'utf8'));
  assert.deepEqual([e.controls, e.counts.controls], [[], 0]);
  const bad = fixture({ 'tracking/coverage.json': '{not json', 'tracking/maps/pages.json': '[1,2' });
  const r = runControls(bad);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /unreadable/);
});

test('the shipped ops/controls.json is what the generator writes now, holds only valid ids, and is served only behind Access', async () => {
  const r = spawnSync(process.execPath, [CONTROLS, '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, 'run node tracking/scripts/controls.mjs: ' + r.stderr + r.stdout);
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops/controls.json'), 'utf8'));
  assert.ok(d.controls.every((c) => /^[a-z0-9][a-z0-9._-]{0,59}$/.test(c.id) && c.path.startsWith('/')));
  // served from the same place as the dashboard: no token, no file
  fs.writeFileSync(path.join(srv.tmp, 'site/ops/controls.json'), JSON.stringify(d));
  assert.equal((await srv.req('GET', '/ops/controls.json')).status, 403);
  assert.equal((await get('/ops/controls.json')).status, 200);
});
