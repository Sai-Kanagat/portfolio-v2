import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  for (const q of ['days=' + encodeURIComponent(evil), 'device=' + encodeURIComponent(evil), 'include=' + encodeURIComponent(evil), 'from=' + encodeURIComponent(evil)]) {
    assert.equal((await get('/api/ops/pages?' + q)).status, 200, q);
  }
  assert.equal((await get('/api/ops/buttons?path=' + encodeURIComponent(evil))).status, 200);
  assert.equal(db.prepare("select count(*) n from sqlite_master where name = 'events'").get().n, 1);
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
