// Joined-up test: the real site (a fresh dist), the real Pages Functions and a real local D1 behind `wrangler pages dev`,
// driven by Playwright. Nothing here reaches a real Cloudflare resource (wrangler runs local only) or any third party:
// Google, Clarity, Formspree and Brevo requests are aborted and counted.
//
//   node tracking/tests/joined/run.mjs                      everything
//   node tracking/tests/joined/run.mjs --only=consent,gtm   comma list of groups
//   --pages=a.html,b.html  limits the controls group      --demo=name  limits the demos group
//   groups: consent gtm decline pages controls nav demos links ghost privacy flags refuse dashboard resilience auth
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pwRequire } from '../pw.mjs';
import { ROOT, DB_ID, BROWSER_UA, openDb, req, makeAccess } from '../server/harness.mjs';

const { chromium } = pwRequire('playwright');
const codemod = await import(pathToFileURL(path.join(ROOT, 'tracking/codemod.mjs')).href);
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean));
const want = (g) => !ONLY.length || ONLY.includes(g);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrangler = path.join(ROOT, 'node_modules/.bin/wrangler');

let pass = 0, fail = 0;
const failures = [];
const ok = (c, m, detail) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; failures.push(m); console.log('  FAIL ' + m + (detail !== undefined ? '  [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) + ']' : '')); } };
const group = (n) => console.log('\n' + n);

// ---------------------------------------------------------------- server
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-joined-'));
const DIST_REL = '.wrangler/joined-dist-' + process.pid;
const A = makeAccess();

async function startPages({ label, migrate = true, d1 = true, access = true, dist = DIST_REL }) {
  const persist = path.join(TMP, label);
  if (migrate && d1) {
    const m = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, encoding: 'utf8' });
    if (m.status !== 0) throw new Error('migrations failed: ' + m.stdout + m.stderr);
  }
  const port = await freePort(), inspector = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const vars = { ALLOW_LOCAL_ORIGINS: '1', RATE_LIMIT_PER_MIN: '100000', CANONICAL_ORIGIN: base, ...(access ? A.vars : {}) };
  const bindings = Object.entries(vars).flatMap(([k, v]) => ['--binding', `${k}=${v}`]);
  const args = ['pages', 'dev', dist, ...(d1 ? ['--d1', `DB=${DB_ID}`, '--persist-to', persist] : []), '--port', String(port), '--inspector-port', String(inspector), '--ip', '127.0.0.1', '--compatibility-date', '2025-09-01', ...bindings];
  const child = spawn(wrangler, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 120000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('wrangler exited early:\n' + log);
    try { const r = await req(base, 'GET', '/work'); if (r.status === 200) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} throw new Error('wrangler did not start:\n' + log); }
    await sleep(400);
  }
  return {
    base, persist, log: () => log,
    rows: (sql, ...a) => { const db = openDb(persist); try { return db.prepare(sql).all(...a); } finally { db.close(); } },
    exec: (sql, ...a) => { const db = openDb(persist); try { return db.prepare(sql).run(...a); } finally { db.close(); } },
    stop() { try { process.kill(-child.pid, 'SIGKILL'); } catch {} },
  };
}

// ---------------------------------------------------------------- browser helpers
const TRACKERS = /googletagmanager|google-analytics|googleadservices|doubleclick|clarity\.ms|formspree|sibforms|sendinblue|brevo/i;
const FONTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/i;
let browser, srv;
const FINDINGS = [];
const local = (u) => { try { const h = new URL(u).hostname; return h === '127.0.0.1' || h === 'localhost'; } catch { return true; } };

// region: ISO country sent as the edge header. stored: pre-set consent. test: test id (sessionStorage), owner: owner flag.
async function ctx({ region = 'US', gpc = false, stored = null, test = null, owner = false, ua = BROWSER_UA, viewport = { width: 1440, height: 900 }, media = true, keepDefaults = false, baseURL } = {}) {
  const c = await browser.newContext({ userAgent: ua, viewport, extraHTTPHeaders: { 'cf-ipcountry': region }, permissions: media ? ['camera', 'microphone'] : [], baseURL: baseURL || srv.base });
  const seen = { trackers: [], fonts: [], other: [], gtm: [], apiE: [], posts: [] };
  c.__seen = seen;
  await c.route((u) => !local(u.toString()), (r) => {
    const u = r.request().url();
    if (/googletagmanager\.com\/gtm\.js/.test(u)) seen.gtm.push(u);
    if (TRACKERS.test(u)) seen.trackers.push(u); else if (FONTS.test(u)) seen.fonts.push(u); else seen.other.push(u);
    r.abort();
  });
  c.on('request', (r) => { if (/\/api\/e(\?|$)/.test(r.url())) { seen.apiE.push(r.url()); try { seen.posts.push(JSON.parse(r.postData() || '{}')); } catch { seen.posts.push({ bad: 1 }); } } });
  await c.addInitScript(({ gpc, stored, test, owner, keep }) => {
    try {
      if (gpc) Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
      if (stored && !localStorage.getItem('sk_consent_v2')) localStorage.setItem('sk_consent_v2', stored);
      if (test && !sessionStorage.getItem('sk_test')) sessionStorage.setItem('sk_test', test);
      if (owner) localStorage.setItem('sk_owner', '1');
    } catch (e) { /* storage blocked */ }
    // every dataLayer push, kept for the privacy and consent checks (a poll, so it also sees pushes made before a page script ran)
    window.__dl = [];
    if (window.__SK_DBG) {}
    const seenDl = new Set();
    const snap = () => { try { (window.dataLayer || []).forEach((x) => { let s; try { s = JSON.stringify(x, (k, v) => (v === undefined ? '__undef' : v)); } catch (e) { s = String(x); } if (!seenDl.has(x)) { seenDl.add(x); window.__dl.push(s); } }); } catch (e) {} };
    setInterval(snap, 40); window.__dlSnap = snap;
  }, { gpc, stored, test, owner, keep: keepDefaults });
  return c;
}
const ready = async (page, ms = 900) => { await page.waitForFunction(() => window.sk && window.sk.v, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms); };
const flush = async (page, ms = 450) => { await page.evaluate(() => { try { window.sk && sk.flush(); } catch (e) {} }).catch(() => {}); await page.waitForTimeout(ms); };
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch {} await sleep(200); } return false; };
const ev = (where, ...a) => srv.rows(`SELECT * FROM events WHERE ${where} ORDER BY id`, ...a);
const count = (where, ...a) => srv.rows(`SELECT COUNT(*) AS n FROM events WHERE ${where}`, ...a)[0].n;
const total = () => srv.rows('SELECT COUNT(*) AS n FROM events')[0].n;
const names = (rows) => rows.map((r) => r.name);
const uniq = (a) => [...new Set(a)];
const pgPath = (u) => new URL(u).pathname;
let tid = 0;
const T = (p) => `${p}${++tid}-${Date.now().toString(36)}`;
const dlEvents = async (page) => page.evaluate(() => { window.__dlSnap && window.__dlSnap(); return window.__dl.map((s) => { try { return JSON.parse(s); } catch { return {}; } }); });

// ---------------------------------------------------------------- setup
console.log('joined-up test: building a fresh dist and starting wrangler pages dev (local D1)');
execFileSync('node', [path.join(ROOT, 'tracking/build-dist.mjs'), '--out', DIST_REL, '--quiet'], { cwd: ROOT });
srv = await startPages({ label: 'main' });
browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const finish = async () => {
  try { const st = srv.rows('SELECT kind, detail, n FROM ingest_stats ORDER BY n DESC'); console.log('ingest_stats: ' + JSON.stringify(st)); } catch (e) {}
  try { const bad = srv.log().split('\n').filter((l) => /ingest write failed|Uncaught|TypeError|ReferenceError|SQLITE_|Error:/.test(l)); ok(bad.length === 0, 'the Functions log of the main server shows no write failure or exception', bad.slice(0, 4)); } catch (e) {}
  if (FINDINGS.length) console.log('\nopen findings (not failures of this test):\n  - ' + FINDINGS.join('\n  - '));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('failed:\n  - ' + failures.join('\n  - '));
  try { await browser.close(); } catch {}
  srv && srv.stop();
  try { fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(path.join(ROOT, DIST_REL), { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
};
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e && e.stack || e); fail++; failures.push('uncaught: ' + (e && e.message)); finish(); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e && e.stack || e); fail++; failures.push('unhandled rejection'); finish(); });

const PAGES = codemod.listPages(ROOT, { all: true }).filter((p) => p !== '404.html');
const urlOf = (rel) => { const p = rel.replace(/index\.html$/, '').replace(/\.html$/, ''); return '/' + p; };

// ================================================================ consent
if (want('consent')) {
  group('consent: accept, decline, EU and non-EU, GPC, withdrawal');
  { // EU, undecided then accept
    const t = T('eu-accept-');
    const c = await ctx({ region: 'IT', test: t }); const p = await c.newPage();
    const n0 = total();
    await p.goto('/work.html'); await ready(p, 1500);
    ok(await p.evaluate(() => document.documentElement.getAttribute('data-cr')) === 'eea', 'EU visitor: server stamps data-cr=eea from the edge country');
    ok(await p.evaluate(() => sk.consent) === 'pending' && await p.locator('#sk-consent').count() === 1, 'EU undecided: consent pending, opt-in choice shown');
    await p.mouse.click(300, 300); await p.mouse.wheel(0, 600); await flush(p);
    ok(total() === n0 && c.__seen.apiE.length === 0, 'EU undecided: zero D1 rows and zero /api/e requests', { rows: total() - n0, posts: c.__seen.apiE.length });
    ok(c.__seen.trackers.length === 0 && c.__seen.gtm.length === 0, 'EU undecided: zero Google, Clarity or form-host requests', c.__seen.trackers);
    ok(await p.evaluate(() => !localStorage.getItem('sk_vid') && !sessionStorage.getItem('sk_sid')), 'EU undecided: no visitor id and no session id stored');
    await p.locator('#sk-consent .sk-c-p').click(); await p.waitForTimeout(900); await flush(p);
    await until(() => count("test = ? AND name = 'consent_choice'", t) >= 1, 5000);
    const r = ev('test = ?', t);
    ok(names(r).includes('page_view') && names(r).includes('consent_choice'), 'EU accept: page_view and consent_choice reach D1', names(r));
    ok(r.every((x) => x.country === 'IT'), 'EU accept: rows carry country IT from the edge header', uniq(r.map((x) => x.country)));
    ok(c.__seen.gtm.length === 1, 'EU accept: GTM requested exactly once after the choice', c.__seen.gtm.length);
    await c.close();
  }
  { // EU decline
    const t = T('eu-decline-');
    const c = await ctx({ region: 'DE', test: t }); const p = await c.newPage();
    const n0 = total();
    await p.goto('/work.html'); await ready(p, 1200);
    await p.locator('#sk-consent .sk-c-s').click(); await p.waitForTimeout(500);
    await p.mouse.click(400, 300); await p.mouse.wheel(0, 800); await p.mouse.move(500, 250); await p.mouse.move(520, 270); await p.waitForTimeout(800); await flush(p);
    await p.goto('/about.html'); await ready(p, 1000); await p.mouse.click(300, 300); await flush(p);
    ok(total() === n0 && c.__seen.apiE.length === 0, 'EU decline: zero D1 rows, zero /api/e requests across two pages', { rows: total() - n0, posts: c.__seen.apiE.length });
    ok(c.__seen.trackers.length === 0 && c.__seen.gtm.length === 0, 'EU decline: zero Google, Clarity or form-host requests', c.__seen.trackers);
    ok(await p.evaluate(() => !localStorage.getItem('sk_vid') && !sessionStorage.getItem('sk_sid') && localStorage.getItem('sk_consent_v2') === 'denied'), 'EU decline: choice remembered as denied, no visitor or session id');
    ok(!(await dlEvents(p)).some((x) => x && x.event && !/^gtm\./.test(x.event)), 'EU decline: nothing but consent commands in the data layer');
    ok(await p.locator('#sk-consent').count() === 0, 'EU decline: no banner on the next page');
    await c.close();
  }
  { // non-EU default granted with notice, then opt out
    const t = T('us-');
    const c = await ctx({ region: 'US', test: t }); const p = await c.newPage();
    await p.goto('/work.html'); await ready(p, 1500); await flush(p);
    ok(await p.evaluate(() => document.documentElement.getAttribute('data-cr')) === 'other' && await p.evaluate(() => sk.consent) === 'granted' && await p.locator('#sk-consent').count() === 1, 'non-EU visitor: data-cr=other, granted by default, notice shown');
    const r = ev('test = ?', t);
    ok(names(r).includes('page_view') && r.every((x) => x.country === 'US'), 'non-EU: rows stored with country US', uniq(r.map((x) => x.country)));
    ok(c.__seen.gtm.length === 1, 'non-EU: GTM requested once', c.__seen.gtm.length);
    await p.locator('#sk-consent .sk-c-s').click(); await p.waitForTimeout(500);
    const n1 = total(), g1 = c.__seen.gtm.length, tr1 = c.__seen.trackers.length, apiN = c.__seen.apiE.length, dl1 = (await dlEvents(p)).length;
    await p.mouse.click(300, 300); await p.mouse.wheel(0, 700); await p.waitForTimeout(800); await flush(p);
    await p.evaluate(() => { sk.demo('x', 'a', { item: 'late' }); sk.track('ui_click', { track_id: 'late.click' }); });
    await p.goto('/process.html'); await ready(p, 800); await p.mouse.click(300, 300); await flush(p);
    ok(total() === n1 && c.__seen.apiE.length === apiN, 'opt out: no further D1 rows or /api/e requests', { rows: total() - n1, posts: c.__seen.apiE.length - apiN });
    ok(c.__seen.gtm.length === g1 && c.__seen.trackers.length === tr1, 'opt out: no further Google or Clarity requests after the choice', c.__seen.trackers.slice(tr1));
    const after = (await dlEvents(p)).slice(dl1).filter((x) => x && x.event && !/^gtm\./.test(x.event));
    ok(after.length === 0, 'opt out: the data layer receives no event after withdrawal', after.map((x) => x.event));
    await c.close();
  }
  { // GPC outside the EU
    const c = await ctx({ region: 'US', gpc: true, test: T('gpc-') }); const p = await c.newPage(); const n0 = total();
    await p.goto('/work.html'); await ready(p, 1200); await p.mouse.click(300, 300); await flush(p);
    ok(total() === n0 && c.__seen.apiE.length === 0 && c.__seen.trackers.length === 0, 'GPC outside the EU: counted as declined, zero rows, zero requests', { rows: total() - n0, trackers: c.__seen.trackers });
    ok(await p.evaluate(() => sk.consent) === 'denied', 'GPC: sk.consent is denied');
    await c.close();
  }
  { // returning visitor
    const t = T('ret-');
    const c = await ctx({ region: 'FR', stored: 'granted', test: t }); const p = await c.newPage();
    await p.goto('/work.html'); await ready(p, 1200); await flush(p);
    ok(count('test = ?', t) > 0 && await p.locator('#sk-consent').count() === 0 && c.__seen.gtm.length === 1, 'returning EU visitor who accepted: sends, no banner, GTM once');
    await c.close();
  }
}

// ================================================================ gtm
if (want('gtm')) {
  group('gtm: loaded only after consent, key union, no drained leaks');
  { // pending EU: queue is built but never reaches the data layer; accepting drains it
    const t = T('gtm-');
    const c = await ctx({ region: 'IT', test: t }); const p = await c.newPage();
    await p.goto('/work.html'); await ready(p, 1000);
    await p.evaluate(() => { sk.demo('d1', 'pick', { item: 'one', value: 3 }); sk.demo('d1', 'clear', {}); });
    await p.waitForTimeout(300);
    ok(!(await dlEvents(p)).some((x) => x && x.event === 'demo_action'), 'pending: demo_action is queued, not in the data layer');
    ok(c.__seen.gtm.length === 0, 'pending: no GTM request');
    await p.locator('#sk-consent .sk-c-p').click(); await p.waitForTimeout(900);
    const dl = await dlEvents(p);
    const iu = dl.findIndex((x) => x && x[0] === 'consent' && x[1] === 'update' && x[2] && x[2].analytics_storage === 'granted' || (x && x['0'] === 'consent' && x['1'] === 'update' && x['2'] && x['2'].analytics_storage === 'granted'));
    const gs = dl.findIndex((x) => x && x.event === 'gtm.js');
    ok(c.__seen.gtm.length === 1 && iu >= 0 && gs > iu, 'accept: consent update granted is pushed before gtm.start, GTM requested once', { iu, gs, gtm: c.__seen.gtm.length });
    // a GTM-like merged model: later pushes overwrite earlier keys, undefined deletes them
    const model = {}; const seq = [];
    for (const x of dl) { if (!x || !x.event || /^gtm\./.test(x.event)) continue; for (const k of Object.keys(x)) { if (x[k] === '__undef') delete model[k]; else model[k] = x[k]; } if (x.event === 'demo_action') seq.push({ action: model.action, item: model.item, value: model.value }); }
    ok(seq.length === 2 && seq[0].item === 'one' && seq[0].value === 3, 'accept: the queued first demo_action is drained with item and value', seq);
    ok(seq.length === 2 && seq[1].action === 'clear' && seq[1].item === undefined && seq[1].value === undefined, 'merged model: the second demo_action does not inherit item or value', seq);
    await c.close();
  }
  { // storage event: accept in a second tab, the first tab loads GTM once and starts sending
    const t = T('gtm3-');
    const c = await ctx({ region: 'IT', test: t }); const p = await c.newPage();
    await p.goto('/work.html', { waitUntil: 'load' }); await ready(p, 600);
    const p2 = await c.newPage(); await p2.goto('/about.html', { waitUntil: 'load' }); await ready(p2, 600);
    ok(c.__seen.gtm.length === 0, 'two undecided tabs: no GTM request');
    await p2.locator('#sk-consent .sk-c-p').click(); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => sk.consent) === 'granted' && c.__seen.gtm.length === 2, 'accept in tab 2 reaches tab 1 through the storage event, each tab loads GTM once', c.__seen.gtm.length);
    await p.evaluate(() => sk.demo('x', 'after_storage', {})); await flush(p);
    ok(await until(() => count("test = ? AND path = '/work'", t) > 0, 5000), 'tab 1 sends after the storage event');
    await c.close();
  }
  { // an old cached page still carries the inline loader: GTM must not load twice
    const c = await ctx({ region: 'US', test: T('gtm4-') }); const p = await c.newPage();
    await c.route(srv.base + '/old-cached.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><script>window.dataLayer=window.dataLayer||[];(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":1,event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","GTM-MRGXD7ZC");</script></head><body><script src="/js/consent.js" defer></script><script src="/js/analytics.js" defer></script></body></html>' }));
    await p.goto('/old-cached.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
    ok(c.__seen.gtm.length === 1, 'an old cached page with the inline loader: GTM requested once, not twice', c.__seen.gtm.length);
    await c.close();
  }
  { // real page, granted: item then no item, merged model
    const c = await ctx({ region: 'US', test: T('gtm2-') }); const p = await c.newPage();
    await p.goto('/work.html'); await ready(p, 1000);
    await p.evaluate(() => { sk.demo('d2', 'a', { item: 'x', bucket: '2-5' }); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { sk.demo('d2', 'b', {}); });
    await p.waitForTimeout(300);
    const dl = (await dlEvents(p)).filter((x) => x && x.event === 'demo_action');
    ok(dl.length === 2 && dl[0].item === 'x' && dl[1].item === '__undef' && dl[1].bucket === '__undef', 'granted: second demo_action carries item and bucket as explicit undefined', dl);
    await c.close();
  }
}

// ================================================================ decline across every page
if (want('decline')) {
  group('decline: no row and no analytics request on any page (undecided EU, declined EU, GPC)');
  const rels = [...PAGES, '404.html'];
  for (const v of [{ label: 'EU undecided', o: { region: 'IT' } }, { label: 'EU declined', o: { region: 'FR', stored: 'denied' } }, { label: 'GPC outside the EU', o: { region: 'US', gpc: true } }]) {
    const c = await ctx(v.o); const p = await c.newPage(); const n0 = total(); const ses0 = srv.rows('SELECT COUNT(*) AS n FROM sessions')[0].n;
    for (const rel of rels) {
      await p.goto(rel === '404.html' ? '/no/such/page-decline' : urlOf(rel), { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      await ready(p, 500); await p.mouse.click(300, 300); await p.mouse.wheel(0, 500); await p.waitForTimeout(120);
    }
    await flush(p);
    ok(total() === n0 && srv.rows('SELECT COUNT(*) AS n FROM sessions')[0].n === ses0 && c.__seen.apiE.length === 0, `${v.label}: ${rels.length} pages, zero event rows, zero session rows, zero /api/e requests`, { rows: total() - n0, posts: c.__seen.apiE.length });
    ok(c.__seen.trackers.length === 0 && c.__seen.gtm.length === 0, `${v.label}: zero Google tag, Analytics, Clarity, Formspree or Brevo requests on ${rels.length} pages`, c.__seen.trackers.slice(0, 3));
    ok(await p.evaluate(() => !localStorage.getItem('sk_vid') && !sessionStorage.getItem('sk_sid')), `${v.label}: no visitor id and no session id stored`);
    const hosts = uniq([...c.__seen.fonts, ...c.__seen.other].map((u) => new URL(u).hostname));
    console.log(`  finding ${v.label}: these third-party hosts are still contacted before any choice: ${hosts.join(', ') || 'none'}`);
    FINDINGS.push(`${v.label}: ${hosts.join(', ') || 'none'}`);
    ok(!hosts.some((h) => /google-analytics|googletagmanager|clarity|doubleclick|formspree|sibforms|brevo|sendinblue/.test(h)), `${v.label}: no analytics or form host is among them`, hosts);
    await c.close();
  }
}

// ================================================================ pages: one page_view each
const PV = {};
if (want('pages')) {
  group('pages: exactly one page_view per page');
  const c = await ctx({ region: 'US', stored: 'granted' });
  let i = 0;
  const list = [...PAGES.map((rel) => ({ rel, url: urlOf(rel) })), { rel: '404.html', url: '/no/such/page-' + Date.now(), nf: true }];
  for (const pg of list) {
    const t = `pv${++i}-${Date.now().toString(36)}`; PV[pg.rel] = t;
    const p = await c.newPage();
    await p.addInitScript((id) => { try { sessionStorage.setItem('sk_test', id); } catch (e) {} }, t);
    let res; const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    try { res = await p.goto(pg.url, { waitUntil: 'load', timeout: 30000 }); } catch (e) { errs.push('goto ' + e.message); }
    await ready(p, 1300); await flush(p);
    const finalPath = pgPath(p.url());
    await p.close();
    await until(() => count("test = ? AND name = 'page_view'", t) >= 1, 4000); await sleep(200);
    const rows = ev('test = ?', t);
    const pv = rows.filter((r) => r.name === 'page_view');
    ok(pv.length === 1 && pv[0].path === (finalPath.replace(/\/index\.html$/, '/') || '/'), `${pg.rel}: exactly one page_view, path ${finalPath}`, { n: pv.length, paths: pv.map((r) => r.path), status: res && res.status(), errs: errs.slice(0, 2) });
    ok(pv.length === 1 && pv[0].page_type === codemod.pageType(pg.rel), `${pg.rel}: stored page_type is ${codemod.pageType(pg.rel)}`, pv.map((r) => r.page_type));
    if (pg.nf) ok(res && res.status() === 404 && rows.filter((r) => r.name === 'page_not_found').length === 1, '404 page: status 404 and exactly one page_not_found', { status: res && res.status(), n: rows.filter((r) => r.name === 'page_not_found').length });
  }
  await c.close();
}

// ================================================================ controls: every data-track control, clicked
const CONTROLS = { clicked: 0, skipped: [], pages: 0 };
if (want('controls')) {
  group('controls: every data-track control, clicked once, gives one ui_click row');
  const maps = JSON.parse(fs.readFileSync(path.join(ROOT, 'tracking/maps/pages.json'), 'utf8'));
  const only = (process.argv.find((a) => a.startsWith('--pages=')) || '').slice(8).split(',').filter(Boolean);
  const mkc = async (mobile) => { const c = await ctx(mobile ? { region: 'US', stored: 'granted', viewport: { width: 390, height: 844 } } : { region: 'US', stored: 'granted' });
  // every click is stopped from doing its default (links never navigate, forms never submit), the page's own handlers still run
  await c.addInitScript(() => {
    try { sessionStorage.setItem('sk_loader_shown', '1'); } catch (e) {}
    window.addEventListener('click', (e) => { try { e.preventDefault(); } catch (x) {} }, true);
    window.addEventListener('submit', (e) => { try { e.preventDefault(); } catch (x) {} }, true);
    // pages that navigate from script (the fade transition) are held in place: the beforeunload prompt is dismissed by the test
    window.addEventListener('beforeunload', (e) => { try { e.preventDefault(); e.returnValue = ''; } catch (x) {} });
  });
  return c; };
  let i = 0; const doneAll = {};
  for (const mobile of [false, true]) {
  const c = await mkc(mobile);
  const list = [...PAGES.map((rel) => ({ rel, url: urlOf(rel) })), { rel: '404.html', url: '/no/such/page-controls' }].filter((p) => !only.length || only.includes(p.rel));
  // tools keep their panels inline (no modal to dismiss), and Escape would collapse what the last click opened
  const INLINE_UI = /^(positioning|hire|ad-autopsy|cortex)\/|^demos\/(agora|poster|roas)\.html$/;
  const NEEDS_CDN = { 'melt/index.html': 'three.js comes from a CDN and no real network is allowed here, so the title screen never builds. tracking/tests/media covers melt with the real CDN.' };
  for (const pg of list) {
    const t = `ck${++i}${mobile ? 'm' : 'd'}-${Date.now().toString(36)}`;
    const p = await c.newPage();
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.addInitScript((id) => { try { sessionStorage.setItem('sk_test', id); } catch (e) {} }, t);
    await p.goto(pg.url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await ready(p, 1000);
    const base = p.url();
    const expected = {}; const done = new Set(); const skipped = [];
    const dall = (doneAll[pg.rel] ||= new Set());
    const list0 = () => p.evaluate(() => { const seen = {}; return [...document.querySelectorAll('[data-track]')].map((e) => { const id = e.getAttribute('data-track'); seen[id] = (seen[id] || 0) + 1; return { id, occ: seen[id] - 1 }; }); });
    const attempt = async (cc) => {
      const key = cc.id + '#' + cc.occ; if (done.has(key) || dall.has(key)) return 'done';
      let info;
      try { await p.evaluate(({ id, occ }) => { const el = [...document.querySelectorAll('[data-track]')].filter((e) => e.getAttribute('data-track') === id)[occ]; if (el) { try { const dt = el.closest('details'); if (dt && !dt.open && el.tagName !== 'SUMMARY') dt.open = true; /* a closed disclosure whose summary was already clicked, re-rendered closed by the page */ el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {} } return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, cc);
        info = await p.evaluate(async ({ id, occ }) => {
        const el = [...document.querySelectorAll('[data-track]')].filter((e) => e.getAttribute('data-track') === id)[occ];
        if (!el) return { skip: 'gone' };
        if (el.closest('[data-no-track]')) return { skip: 'ignored subtree (data-no-track)' };
        if (el.disabled) return { skip: 'disabled' };
        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {}
        // a sliding panel: measure only once the control has stopped moving, or the click lands where it used to be
        for (let k = 0, same = 0, last = ''; k < 40 && same < 4; k++) {
          const q = el.getBoundingClientRect(), now = Math.round(q.left) + ',' + Math.round(q.top);
          same = now === last ? same + 1 : 0; last = now;
          await new Promise((ok2) => setTimeout(ok2, 30));
        }
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') return { skip: 'not visible' };
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { skip: 'off screen' };
        const top = document.elementFromPoint(x, y);
        if (!top) return { skip: 'nothing at point' };
        if (top.closest('[data-no-track]')) return { skip: 'ignored subtree on top' };
        const hit = top.closest('[data-track]');
        if (hit !== el) return { skip: 'covered by ' + (hit ? 'control ' + hit.getAttribute('data-track') : top.tagName.toLowerCase() + (top.id ? '#' + top.id : '')) };
        return { x, y };
      }, cc); } catch (e) { await p.waitForLoadState('load').catch(() => {}); if (p.url() !== base) { await p.goto(base, { waitUntil: 'load' }).catch(() => {}); await ready(p, 600); } return 'page changed under us'; }
      if (info.skip) { return info.skip; }
      await p.mouse.click(info.x, info.y);
      await p.evaluate(() => { const o = document.getElementById('page-transition'); if (o) { o.style.pointerEvents = 'none'; o.style.opacity = '0'; } }).catch(() => {});
      done.add(key); dall.add(key); expected[cc.id] = (expected[cc.id] || 0) + 1; CONTROLS.clicked++;
      await p.waitForTimeout(480);
      if (!INLINE_UI.test(pg.rel)) await p.keyboard.press('Escape').catch(() => {});
      await p.waitForLoadState('load').catch(() => {});
      if (p.url() !== base) { await p.goto(base, { waitUntil: 'load' }).catch(() => {}); await ready(p, 600); return 'navigated'; }
      return 'clicked';
    };
    const pass1 = async (label) => {
      const cs = await list0(); const retry = [];
      for (const cc of cs) { const r = await attempt(cc); if (!['clicked', 'done', 'navigated'].includes(r)) retry.push([cc, r]);
        else if (r === 'navigated') await ready(p, 200); }
      return retry;
    };
    // the passcode gate needs its code typed before its button does anything
    if (pg.rel === 'cortex/index.html') await p.fill('#gp', '0000').catch(() => {});
    let retry = await pass1('load');
    // clicking a control often reveals more of them (the guide, a score panel, a sample): go round again until nothing new can be clicked
    for (let k = 0; k < 4; k++) { const before = CONTROLS.clicked; retry.push(...await pass1('again')); if (CONTROLS.clicked === before) break; }
    // panels and states from the coverage map reveal more controls
    for (const s of ((maps.pages || {})[pg.rel] || {}).states || []) {
      try { for (const step of s.steps) { if (step.click) await p.locator(step.click).first().click({ timeout: 3000 }); else if (step.key) await p.keyboard.press(step.key); else if (step.eval) await p.evaluate(step.eval); await p.waitForTimeout(step.wait || 400); } retry.push(...await pass1(s.name)); } catch (e) { skipped.push('state ' + s.name + ': ' + e.message.split('\n')[0].slice(0, 60)); }
    }
    // off screen or covered: a keyboard user can still activate the control (focus, then Enter or Space), which is a real trusted click
    const kb = async (cc) => {
      const key = cc.id + '#' + cc.occ; if (done.has(key) || dall.has(key)) return false;
      const how = await p.evaluate(({ id, occ }) => {
        const el = [...document.querySelectorAll('[data-track]')].filter((e) => e.getAttribute('data-track') === id)[occ];
        if (!el || el.closest('[data-no-track]') || el.disabled) return null;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null;
        const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
        if (!(tag === 'a' && el.hasAttribute('href')) && tag !== 'button' && !(tag === 'input' && /^(checkbox|radio|button|submit)$/.test(type)) && !/^(button|link|tab)$/.test(el.getAttribute('role') || '')) return null;
        try { el.focus({ preventScroll: true }); } catch (e) {}
        return document.activeElement === el ? (tag === 'input' && /^(checkbox|radio)$/.test(type) ? 'Space' : 'Enter') : null;
      }, cc).catch(() => null);
      if (!how) return false;
      await p.keyboard.press(how); await p.waitForTimeout(480);
      if (!INLINE_UI.test(pg.rel)) await p.keyboard.press('Escape').catch(() => {});
      done.add(key); dall.add(key); expected[cc.id] = (expected[cc.id] || 0) + 1; CONTROLS.clicked++; CONTROLS.byKeyboard = (CONTROLS.byKeyboard || 0) + 1;
      await p.waitForLoadState('load').catch(() => {});
      if (p.url() !== base) { await p.goto(base, { waitUntil: 'load' }).catch(() => {}); await ready(p, 600); }
      return true;
    };
    // controls that were covered or off screen: fresh page, first in line
    const need = retry.filter(([, r]) => /covered|off screen|nothing/.test(r)).map(([cc]) => cc).filter((cc) => !done.has(cc.id + '#' + cc.occ) && !dall.has(cc.id + '#' + cc.occ));
    for (const cc of need) { await p.goto(base, { waitUntil: 'load' }).catch(() => {}); await ready(p, 500); const r = await attempt(cc); if (!['clicked', 'done', 'navigated'].includes(r)) await kb(cc); }
    for (const [cc, r] of retry) if (!done.has(cc.id + '#' + cc.occ) && !dall.has(cc.id + '#' + cc.occ)) skipped.push(`${cc.id}: ${r}`);
    await flush(p, 600); await p.close();
    const nExp = Object.values(expected).reduce((a, b) => a + b, 0);
    await until(() => count("test = ? AND name = 'ui_click'", t) >= nExp, 8000); await sleep(300);
    const rows = ev("test = ? AND name = 'ui_click'", t);
    const got = {}; for (const r of rows) { let id = ''; try { id = JSON.parse(r.params).track_id; } catch {} got[id] = (got[id] || 0) + 1; }
    const bad = [];
    for (const id of uniq([...Object.keys(expected), ...Object.keys(got)])) if ((expected[id] || 0) !== (got[id] || 0)) bad.push(`${id}: clicked ${expected[id] || 0}, rows ${got[id] || 0}`);
    const n = Object.values(expected).reduce((a, b) => a + b, 0);
    if (!mobile) CONTROLS.pages++; if (mobile) CONTROLS.skipped.push(...skipped.map((s) => pg.rel + ' ' + s));
    if (NEEDS_CDN[pg.rel] && n === 0) { console.log(`  note ${pg.rel}: controls not exercised. ${NEEDS_CDN[pg.rel]}`); continue; }
    if (mobile && n === 0) continue;
    const posted = {}; for (const b of c.__seen.posts) if (b.ctx && b.ctx.test === t) for (const e of b.ev || []) if (e.n === 'ui_click') posted[e.p.track_id] = (posted[e.p.track_id] || 0) + 1;
    ok(bad.length === 0 && n > 0, `${pg.rel}${mobile ? ' (phone)' : ''}: ${n} data-track clicks, ${rows.length} ui_click rows, one per click${skipped.length ? ` (${skipped.length} not clickable)` : ''}`, bad.length ? { bad: bad.slice(0, 6), postedByBrowser: bad.slice(0, 6).map((x) => x.split(':')[0]).map((id) => id + '=' + (posted[id] || 0)), keyboard: CONTROLS.byKeyboard } : undefined);
  }
  await c.close();
  }
  // Whatever could not be clicked must be on this list with a reason. Anything else is a failure.
  const ALLOWED = [
    [/^melt\//, /./, 'three.js comes from a CDN and there is no real network here, so the title screen never builds (tracking/tests/media covers melt with the real CDN)'],
    [/^work\.html$/, /^page\.project-/, 'the old card grid, hidden by js/work-editorial.js, which replaces it with the numbered list'],
    [/./, /\.gotcha$/, 'honeypot field, hidden on purpose'],
    [/^ad-autopsy\//, /^ad\.file$/, 'hidden file input, opened by its button. The upload itself is covered by the privacy group with setInputFiles'],
    [/^cortex\//, /^cortex\.file$/, 'hidden file input, covered by the privacy group with setInputFiles'],
    [/^demos\/hands\.html$/, /^hands\.(overlay|cam)$/, 'canvas and video under the setup overlay, display only (ignored in tracking/maps/media.json)'],
    [/^demos\/balls\.html$/, /^balls\.stage$/, 'canvas under a caption, display only (ignored in tracking/maps/media.json)'],
    [/^shadow-theatre\//, /^shadow\.cam$/, 'camera preview, display only (ignored in tracking/maps/media.json)'],
    [/^positioning\//, /^pos\.card\.reset\./, 'the manual reset button is hidden until a score slider is moved by hand. It is clicked and checked by the tools suite (tracking/tests/tools, pos.card.reset.*)'],
    [/^hire\//, /^hire\.share_url$/, 'shown only once the sheet is built, which needs a role and goals chosen together'],
    [/^demos\/agora\.html$/, /^agora\.(back_to_seed|report)$/, 'appear or enable only after a finished run, which the tools suite drives'],
    [/^brand-identity\.html$/, /^components\.(disabled|checkbox-3)$/, 'a demonstration of a disabled or hidden component in the brand book'],
  ];
  const unexplained = [], explained = {};
  for (const sk of CONTROLS.skipped) {
    const m = /^(\S+) (\S+?): (.*)$/.exec(sk) || [];
    const rule = ALLOWED.find(([pr, ir]) => pr.test(m[1] || '') && ir.test(m[2] || ''));
    if (rule) explained[rule[2].slice(0, 60)] = (explained[rule[2].slice(0, 60)] || 0) + 1; else unexplained.push(sk);
  }
  ok(unexplained.length === 0, `every control that was not clicked is explained (${CONTROLS.skipped.length - unexplained.length} explained, ${unexplained.length} not)`, unexplained.slice(0, 12));
  for (const [r, n] of Object.entries(explained)) console.log(`    ${n} not clicked: ${r}`);
  const reasons = {}; for (const s of CONTROLS.skipped) { const r = s.replace(/^.*?: /, '').replace(/ [\w.#-]+$/, ''); reasons[r] = (reasons[r] || 0) + 1; }
  console.log(`  controls clicked ${CONTROLS.clicked} (${CONTROLS.byKeyboard || 0} by keyboard), not clickable ${CONTROLS.skipped.length}`, JSON.stringify(reasons));
  fs.writeFileSync(path.join(TMP, 'unclicked.txt'), CONTROLS.skipped.join('\n'));
  if (process.env.SK_JOINED_LIST) fs.writeFileSync(process.env.SK_JOINED_LIST, CONTROLS.skipped.join('\n'));
}

// ================================================================ demos and tools: open, start, end into D1
if (want('demos')) {
  group('demos and tools: each one opens, starts (fake camera and mic) and ends into D1');
  const DEMOS = [
    { rel: 'demos/hands.html', id: 'hands', act: (p) => p.click('#startBtn'), media: 'camera' },
    { rel: 'demos/balls.html', id: 'balls', act: (p) => p.click('#startBtn'), media: 'camera' },
    { rel: 'demos/audio.html', id: 'audio', act: (p) => p.click('#useMic'), media: 'mic' },
    { rel: 'demos/audio.html', id: 'audio', act: (p) => p.click('#useDemo'), label: 'tone only' },
    { rel: 'shadow-theatre/index.html', id: 'shadow-theatre', act: (p) => p.click('#startBtn'), media: 'camera' },
    { rel: 'shadow-theatre/index.html', id: 'shadow-theatre', act: (p) => p.click('#demoBtn'), label: 'without camera' },
    { rel: 'melt/index.html', id: 'melt', act: null, noStart: 'melt needs three.js from a CDN and no real network is allowed here: it is covered by tracking/tests/media with the real CDN' },
    { rel: 'demos/agora.html', id: 'agora', act: async (p) => { await p.click('[data-track="agora.preset.pricing"]'); await p.click('#goBtn'); } },
    { rel: 'demos/poster.html', id: 'poster', act: (p) => p.click('#regen') },
    { rel: 'demos/roas.html', id: 'roas', act: async (p) => { const r = p.locator('input[type=range]').first(); await r.focus(); await p.keyboard.press('ArrowRight'); } },
    { rel: 'cortex/index.html', id: 'cortex', act: async (p) => { await p.fill('#gp', '0000'); await p.click('#gbtn'); await p.waitForTimeout(500); await p.click('#play'); } },
    { rel: 'ad-autopsy/index.html', id: 'ad-autopsy', act: (p) => p.click('[data-track="ad.sample.ferro"]') },
    { rel: 'positioning/index.html', id: 'positioning', act: (p) => p.locator('[data-track^="pos.sample."]').first().click() },
    { rel: 'hire/index.html', id: 'hire', act: (p) => p.locator('[data-track^="hire.chip."]').first().click() },
  ];
  const FAKE_HANDS = "window.Hands=function(){this.setOptions=()=>{};this.onResults=f=>{this.cb=f};this.send=async()=>{this.cb({multiHandLandmarks:[]})}};";
  const FAKE_CAM = "window.Camera=function(v,o){this.start=async()=>{v.srcObject=await navigator.mediaDevices.getUserMedia({video:true});setInterval(()=>o.onFrame(),40)}};";
  const FAKE_VISION = "export const FilesetResolver={forVisionTasks:async()=>({})};export const HandLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:[]})})};";
  const onlyDemo = (process.argv.find((a) => a.startsWith('--demo=')) || '').slice(7);
  for (const d of DEMOS.filter((x) => !onlyDemo || x.rel.includes(onlyDemo))) {
    const t = T('demo-' + d.id + '-');
    const c = await ctx({ region: 'US', stored: 'granted', test: t }); const p = await c.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    // hand-tracking models are stubbed (a real model needs the CDN); the camera itself is Chromium's fake device
    await c.route(/@mediapipe\/hands@/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_HANDS }));
    await c.route(/@mediapipe\/camera_utils/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_CAM }));
    await c.route(/tasks-vision.*vision_bundle/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_VISION }));
    await p.goto(urlOf(d.rel), { waitUntil: 'load' }); await ready(p, 1200);
    let acted = true;
    try { if (d.act) await d.act(p); } catch (e) { acted = false; errs.push('act: ' + e.message.split('\n')[0]); }
    await p.waitForTimeout(2500);
    await flush(p);
    await p.goto('/about.html', { waitUntil: 'load' });
    for (let k = 0; k < 20 && ev('test = ?', t).filter((r) => r.name === 'demo_end').length < 1; k++) await p.waitForTimeout(300);
    await p.waitForTimeout(300);
    const rows = ev('test = ?', t).filter((r) => { try { return JSON.parse(r.params || '{}').demo_id === d.id; } catch { return false; } });
    const n = (name) => rows.filter((r) => r.name === name).length;
    const label = `${d.rel}${d.label ? ' (' + d.label + ')' : ''}`;
    if (d.noStart) { console.log('  note ' + label + ': demo_start not exercised. ' + d.noStart); ok(n('demo_open') === 1 && n('demo_end') === 1, `${label}: demo_open and demo_end once each`, names(rows)); await c.close(); continue; }
    ok(acted && n('demo_open') === 1 && n('demo_start') === 1 && n('demo_end') === 1, `${label}: demo_open, demo_start and demo_end once each`, { acted, posted: c.__seen.posts.flatMap((b) => (b.ev || []).map((e) => e.n)), rows: rows.map((r) => r.name + (/demo_(error|end)|media_result|model_state/.test(r.name) ? ' ' + r.params : '')), errs: errs.slice(0, 2) });
    ok(rows.every((r) => r.page_type), `${label}: rows carry page_type`);
    ok(!rows.some((r) => r.name === 'demo_error' && /"code":"(js|load)"/.test(r.params)), `${label}: blocked analytics and font requests are not counted as demo errors`, rows.filter((r) => r.name === 'demo_error').map((r) => r.params));
    if (d.media) {
      const m = rows.filter((r) => r.name === 'media_result').map((r) => JSON.parse(r.params));
      ok(m.some((x) => x.kind === d.media && x.state === 'granted'), `${label}: ${d.media} permission flow reaches D1 as granted`, m);
    }
    await c.close();
  }
}

// ================================================================ links carry through
if (want('links')) {
  group('links: /go to session, demo and conversion');
  srv.exec("INSERT OR REPLACE INTO links (slug,dest,channel,campaign,content_label,app_label,created,retired) VALUES ('cv-joined-demo','/hire','cv','joined-camp',NULL,'joined-app',?,0)", Date.now());
  srv.exec("INSERT OR REPLACE INTO links (slug,dest,channel,campaign,content_label,app_label,created,retired) VALUES ('li-joined-old','/work','li','old-camp','post-01',NULL,?,1)", Date.now());
  const t = T('link-');
  const c = await ctx({ region: 'US', test: t, stored: 'granted' }); const p = await c.newPage();
  const clicks0 = srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE slug = 'cv-joined-demo' AND is_bot = 0")[0].n;
  const res = await p.goto('/go/cv-joined-demo', { waitUntil: 'load' }); await ready(p, 1200);
  const u = new URL(p.url());
  ok(/^\/hire\/?$/.test(u.pathname) && u.searchParams.get('utm_source') === 'cv' && u.searchParams.get('utm_medium') === 'document' && u.searchParams.get('utm_campaign') === 'joined-camp' && u.searchParams.get('sk_l') === 'cv-joined-demo', '/go redirects to the destination with UTMs and sk_l', p.url());
  ok(srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE slug = 'cv-joined-demo' AND is_bot = 0")[0].n === clicks0 + 1, '/go logs one human click');
  await p.mouse.click(300, 300);
  await p.goto('/demos/hands', { waitUntil: 'load' }); await ready(p, 1000);
  await p.click('#startBtn').catch(() => {});
  await p.waitForTimeout(1500);
  await p.goto('/contact', { waitUntil: 'load' }); await ready(p, 1000);
  const mail = p.locator('a[href^="mailto:"]').first();
  await p.evaluate(() => window.addEventListener('click', (e) => e.preventDefault(), true));
  await mail.scrollIntoViewIfNeeded(); await mail.click({ force: true }).catch(() => {}); await p.waitForTimeout(500);
  await flush(p);
  await until(() => count("test = ? AND name = 'email_click'", t) >= 1 && count("test = ? AND name = 'demo_open'", t) >= 1, 6000);
  const rows = ev('test = ?', t);
  const ses = srv.rows('SELECT * FROM sessions WHERE test = ?', t);
  ok(ses.length === 1 && ses[0].link === 'cv-joined-demo' && ses[0].utm_source === 'cv' && ses[0].utm_campaign === 'joined-camp', 'session row carries the link and its UTMs', ses.map((x) => [x.link, x.utm_source, x.utm_campaign]));
  const first = rows.find((r) => r.name === 'page_view');
  ok(first && first.link === 'cv-joined-demo', 'first page_view carries the link');
  ok(rows.length > 0 && rows.every((r) => r.link === 'cv-joined-demo'), 'every event of the visit, across three pages, keeps the link', uniq(rows.map((r) => r.link)));
  ok(rows.some((r) => r.name === 'demo_open' && r.path === '/demos/hands'), 'the demo opened from the link is recorded under it', rows.map((r) => r.name + '@' + r.path).filter((x) => /demo|page_view/.test(x)));
  const conv = rows.filter((r) => r.name === 'email_click');
  ok(conv.length === 1 && conv[0].link === 'cv-joined-demo', 'the conversion (email_click) is attributed to the link', names(rows).filter((n) => /email|cv_/.test(n)));
  await c.close();
  // bot preview, retired and unknown slugs
  const b0 = srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE is_bot = 1")[0].n;
  const bot = await req(srv.base, 'GET', '/go/cv-joined-demo', { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
  await sleep(300);
  ok(bot.status === 302 && srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE is_bot = 1")[0].n === b0 + 1, 'a link-preview bot is redirected and logged as a bot, not a visit');
  const old = await req(srv.base, 'GET', '/go/li-joined-old', { headers: { 'user-agent': BROWSER_UA } });
  ok(old.status === 302 && /\/work\?.*utm_source=li/.test(old.headers.location), 'a retired link still redirects');
  const bad = await req(srv.base, 'GET', '/go/nope-nothing', { headers: { 'user-agent': BROWSER_UA } });
  ok(bad.status === 302 && bad.headers.location === '/', 'an unknown slug goes home');
}

// ================================================================ auto cursor removed
if (want('ghost')) {
  group('ghost: the auto cursor is gone and an idle home visit stores no synthetic activity');
  const t = T('ghost-');
  const c = await ctx({ region: 'US', stored: 'granted', test: t, viewport: { width: 1440, height: 900 } }); const p = await c.newPage();
  await p.goto('/?haunt=fast', { waitUntil: 'load' }); await ready(p, 800);
  await p.waitForTimeout(8000); await flush(p, 700);
  ok(await p.evaluate(() => !window.__haunt && !document.querySelector('.sk-ghost')), 'no auto cursor on the page');
  const rows = ev('test = ?', t);
  ok(rows.length > 0 && !rows.some((r) => /^haunt_/.test(r.name)), 'no haunt rows', names(rows));
  ok(!rows.some((r) => /^(scroll_milestone|cursor_sample|ui_hover|ui_click|tap)$/.test(r.name)), 'no click, hover, scroll or cursor rows from an idle visit', names(rows));
  ok(srv.rows('SELECT COUNT(*) AS n FROM cursor_bins WHERE test = ?', t)[0].n === 0, 'zero cursor_bins rows from an idle visit');
  for (let k = 0; k < 8; k++) { await p.mouse.move(200 + k * 90, 250 + (k % 3) * 70); await p.waitForTimeout(320); }
  await p.goto('/about.html', { waitUntil: 'load' });
  await until(() => srv.rows('SELECT COUNT(*) AS n FROM cursor_bins WHERE test = ?', t)[0].n > 0, 8000);
  ok(srv.rows("SELECT COUNT(*) AS n FROM cursor_bins WHERE test = ? AND path = '/'", t)[0].n > 0, 'positive control: a real mouse does produce cursor rows');
  await c.close();
}

// ================================================================ privacy canaries
if (want('privacy')) {
  group('privacy: typed text, file names and share state never reach a row or the data layer');
  const CAN = 'ZQCANARY8841';
  const t = T('priv-');
  const c = await ctx({ region: 'US', stored: 'granted', test: t }); const p = await c.newPage();
  const dls = [];
  const grab = async () => { dls.push(...(await dlEvents(p)).map((x) => JSON.stringify(x))); };
  const did = [], didnt = [];
  const step = async (label, fn) => { try { await fn(); did.push(label); } catch (e) { didnt.push(label + ': ' + e.message.split('\n')[0].slice(0, 80)); } };
  // contact form: name, email, message, then an attempt (the form host is aborted, so it fails)
  await p.goto('/contact', { waitUntil: 'load' }); await ready(p, 1000);
  await step('contact name', () => p.fill('#fname', CAN + ' first', { timeout: 4000 }).then(() => p.fill('#lname', CAN + ' last', { timeout: 4000 })).then(() => p.fill('#company', CAN + ' Studio', { timeout: 4000 })));
  await step('contact email', () => p.locator('input[type=email]').first().fill('zqcanary8841@example.com', { timeout: 4000 }));
  await step('contact message', () => p.locator('textarea').first().fill(CAN + ' message about a role', { timeout: 4000 }));
  await p.waitForTimeout(800);
  await step('contact submit', () => p.locator('form button[type=submit], form input[type=submit]').first().click({ timeout: 4000 })); await p.waitForTimeout(1200); await flush(p); await grab();
  // tools: role text, brief text, statement text, an uploaded file with a revealing name, URL query and hash state
  await p.goto('/hire?r=other&t=' + CAN + '&c=other#' + CAN, { waitUntil: 'load' }); await ready(p, 1000);
  await step('hire opened from a share link with the role text in it', async () => { const v = await p.inputValue('#roleText'); if (!v.includes(CAN)) throw new Error('state not loaded: ' + v); });
  await step('hire role chip', () => p.locator('[data-track^="hire.chip."]').first().click({ timeout: 4000 }));
  await step('hire role text', () => p.fill('#roleText', CAN + ' growth role at ' + CAN + ' Corp', { timeout: 4000 })); await p.waitForTimeout(1000);
  await step('hire copy link', () => p.click('#btnCopy', { timeout: 4000 })); await p.waitForTimeout(500); await flush(p); await grab();
  await p.goto('/positioning/?s=' + CAN + '#' + CAN, { waitUntil: 'load' }); await ready(p, 1000);
  for (let i = 0; i < 3; i++) await step('positioning field ' + i, () => p.locator('input[data-f], textarea[data-f]').nth(i).fill(CAN + ' field ' + i, { timeout: 4000 }));
  await p.waitForTimeout(1100);
  let shared = '';
  await step('positioning wrote its own share state into the address', async () => { shared = await p.evaluate(() => location.hash); if (!/^#s=.{20,}/.test(shared)) throw new Error('no state hash: ' + shared); });
  await flush(p); await grab();
  await p.goto('/positioning/' + shared, { waitUntil: 'load' }); await ready(p, 1000); await flush(p); await grab();
  await p.goto('/ad-autopsy/', { waitUntil: 'load' }); await ready(p, 1000);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await step('ad-autopsy upload', () => p.setInputFiles('#file', { name: CAN + '-secret-ad.png', mimeType: 'image/png', buffer: png }, { timeout: 4000 }));
  await p.waitForTimeout(2500); await flush(p); await grab();
  await p.goto('/cortex/', { waitUntil: 'load' }); await ready(p, 1000);
  await step('cortex passcode', async () => { await p.fill('#gp', '0000', { timeout: 4000 }); await p.click('#gbtn', { timeout: 4000 }); }); await p.waitForTimeout(600);
  await step('cortex brief', () => p.fill('#brief', CAN + ' brief text', { timeout: 4000 })); await p.waitForTimeout(1000);
  await step('cortex file', () => p.setInputFiles('#file', { name: CAN + '-brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + CAN) }, { timeout: 4000 }));
  await p.waitForTimeout(800); await flush(p); await grab();
  await p.goto('/work?q=' + CAN + '#' + CAN, { waitUntil: 'load' }); await ready(p, 800); await flush(p); await grab();
  ok(didnt.length === 0, `every canary was really typed or attached (${did.length} steps)`, didnt);
  await p.close();
  const rows = ev('test = ?', t);
  ok(rows.length > 30, 'canary run produced real traffic to check', rows.length);
  const dump = JSON.stringify(['events', 'sessions', 'link_clicks', 'cursor_bins', 'daily_rollup', 'ingest_stats', 'health'].map((tb) => { try { return srv.rows(`SELECT * FROM ${tb}`); } catch { return []; } }));
  ok(!/zqcanary/i.test(dump), 'no canary text, file name or share state in any D1 table');
  ok(!/zqcanary/i.test(dls.join('\n')), 'no canary in any dataLayer entry', dls.filter((x) => /zqcanary/i.test(x)).slice(0, 2));
  ok(!/zqcanary/i.test(JSON.stringify(c.__seen.posts)), 'no canary in any /api/e request body');
  ok(srv.rows("SELECT COUNT(*) AS n FROM events WHERE path LIKE '%?%' OR path LIKE '%#%' OR path LIKE '%zqcanary%'")[0].n === 0, 'every stored path is a bare path: no query, no hash');
  const acts = rows.filter((r) => r.name === 'demo_action').map((r) => JSON.parse(r.params));
  ok(acts.some((a) => a.demo_id === 'ad-autopsy' && a.action === 'upload') && acts.some((a) => a.demo_id === 'cortex' && a.action === 'file_attach'), 'the file uploads were really seen by the pages and recorded as type-only actions', acts.filter((a) => /upload|file/.test(a.action)));
  const forms = rows.filter((r) => /^form_/.test(r.name));
  ok(forms.length > 0, 'the contact form outcome events are recorded (ids and states only)', names(forms));
  await c.close();
}

// ================================================================ owner and test flags
if (want('flags')) {
  group('flags: owner and test traffic is marked and hidden by default');
  const t = T('flag-');
  const c = await ctx({ region: 'US', stored: 'granted' }); const p = await c.newPage();
  await p.goto('/work?sk_owner=1&sk_test=' + t, { waitUntil: 'load' }); await ready(p, 1200);
  await p.goto('/about', { waitUntil: 'load' }); await ready(p, 1000); await flush(p);
  const rows = ev('test = ?', t);
  ok(rows.length > 0 && rows.every((r) => r.owner === 1 && r.test === t), 'ctx flags: every row from the flagged visit has owner=1 and the test id, on both pages', uniq(rows.map((r) => r.owner + '/' + r.test)));
  const ses = srv.rows('SELECT owner, test FROM sessions WHERE test = ?', t);
  ok(ses.length === 1 && ses[0].owner === 1, 'the session row is flagged too');
  const stored = await p.evaluate(() => [localStorage.getItem('sk_owner'), sessionStorage.getItem('sk_test')]);
  ok(stored[0] === '1' && stored[1] === t, 'owner persists in localStorage, test in sessionStorage');
  ok(!/sk_owner|sk_test/.test(JSON.stringify(rows.map((r) => r.path + r.params))), 'the flag parameters themselves are not stored');
  await p.close();
  const p2 = await c.newPage(); await p2.goto('/work', { waitUntil: 'load' }); await ready(p2, 1000); await flush(p2);
  const o = srv.rows("SELECT COUNT(*) AS n FROM events WHERE owner = 1 AND test = ''")[0].n;
  ok(o > 0, 'a later visit from the same browser stays flagged as the owner (no test id)', o);
  await c.close();
}

// ================================================================ bots and foreign origins
if (want('refuse')) {
  group('refuse: bots, foreign origins, junk');
  const good = (extra = {}) => ({ origin: srv.base, 'user-agent': BROWSER_UA, 'content-type': 'text/plain', ...extra });
  const body = (o = {}) => JSON.stringify({ v: 1, vid: 'a'.repeat(16), sid: 'b'.repeat(16), pid: 'c'.repeat(16), ctx: { path: '/work', page_type: 'work', lang: 'en', device: 'desktop', vw: 1440, vh: 900, ref_host: '', link: null, utm: {}, owner: false, test: 'refuse-t' }, ev: [{ n: 'page_view', t: Date.now(), p: { title_id: 'work' } }], ...o });
  const n0 = total();
  const cases = [
    ['Googlebot', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, 204, 'bot'],
    ['link preview bot', { 'user-agent': 'facebookexternalhit/1.1' }, 204, 'bot'],
    ['headless Chrome with no test flag', { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36' }, 204, 'bot', { ctx: { path: '/work', page_type: 'work', lang: 'en', device: 'desktop', vw: 1, vh: 1, ref_host: '', link: null, utm: {}, owner: false, test: '' } }],
    ['foreign origin', { origin: 'https://evil.example' }, 403],
    ['subdomain lookalike', { origin: 'https://saikanagat.com.evil.example' }, 403],
    ['null origin', { origin: 'null' }, 403],
  ];
  for (const [label, h, status, dropped, over] of cases) {
    const r = await req(srv.base, 'POST', '/api/e', { headers: good(h), body: body(over) });
    ok(r.status === status && (!dropped || r.headers['x-sk-dropped'] === dropped), `${label}: ${status}${dropped ? ' and dropped as ' + dropped : ''}`, [r.status, r.headers['x-sk-dropped']]);
  }
  const noOrigin = await req(srv.base, 'POST', '/api/e', { headers: { 'user-agent': BROWSER_UA, 'content-type': 'text/plain' }, body: body() });
  ok(noOrigin.status === 403, 'no Origin and no Referer: 403', noOrigin.status);
  const big = await req(srv.base, 'POST', '/api/e', { headers: good(), body: body({ ev: Array.from({ length: 2000 }, () => ({ n: 'page_view', t: Date.now(), p: { title_id: 'x'.repeat(20) } })) }) });
  ok(big.status === 413, 'oversized body (over 32 KB): 413', big.status);
  const unk = await req(srv.base, 'POST', '/api/e', { headers: good(), body: body({ ev: [{ n: 'not_a_real_event', t: Date.now(), p: {} }] }) });
  ok(unk.status === 400, 'unknown event name: 400', unk.status);
  const junk = await req(srv.base, 'POST', '/api/e', { headers: good(), body: '{not json' });
  ok(junk.status === 400, 'malformed JSON: 400', junk.status);
  const get = await req(srv.base, 'GET', '/api/e', { headers: good() });
  ok(get.status === 405, 'GET /api/e: 405', get.status);
  ok(total() === n0, 'none of the refused requests stored a row', total() - n0);
  // a headless browser with no test flag is dropped at the door, with the flag it is stored (so these tests can see themselves)
  const HL = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36';
  { const c = await ctx({ region: 'US', stored: 'granted', ua: HL }); const p = await c.newPage(); const m = total();
    await p.goto('/work', { waitUntil: 'load' }); await ready(p, 1200); await flush(p);
    ok(total() === m && c.__seen.apiE.length > 0, 'a headless browser without a test flag sends but nothing is stored', { stored: total() - m, sent: c.__seen.apiE.length }); await c.close(); }
  { const t = T('hl-'); const c = await ctx({ region: 'US', stored: 'granted', ua: HL, test: t }); const p = await c.newPage();
    await p.goto('/work', { waitUntil: 'load' }); await ready(p, 1200); await flush(p);
    ok(count('test = ?', t) > 0, 'a headless browser with a test flag is stored (flagged test traffic)'); await c.close(); }
}

// ================================================================ dashboard agrees with D1
if (want('dashboard')) {
  group('dashboard: the endpoints agree with the D1 rows');
  const tok = A.sign({});
  const api = async (p2, opts = {}) => req(srv.base, 'GET', p2, { headers: { 'cf-access-jwt-assertion': opts.token === undefined ? tok : opts.token } });
  const INC = 'include=owner,test&days=3650';
  const H = await api('/api/ops/health?' + INC);
  ok(H.status === 200 && H.json && H.json.events_24h === srv.rows('SELECT COUNT(*) AS n FROM events WHERE ts > ?', Date.now() - 864e5)[0].n, 'health: events_24h equals the D1 count', [H.status, H.json && H.json.events_24h]);
  const P = await api('/api/ops/pages?' + INC);
  const sqlPv = Object.fromEntries(srv.rows("SELECT path, COUNT(*) AS n FROM events WHERE name = 'page_view' GROUP BY path").map((r) => [r.path, r.n]));
  const apiPv = Object.fromEntries(((P.json || {}).pages || []).map((r) => [r.path, r.views]));
  const diffP = Object.keys(sqlPv).filter((k) => apiPv[k] !== sqlPv[k]);
  ok(P.status === 200 && diffP.length === 0 && Object.keys(sqlPv).length > 20, `pages: page views per path match D1 for all ${Object.keys(sqlPv).length} paths`, diffP.slice(0, 4).map((k) => [k, sqlPv[k], apiPv[k]]));
  const B = await api('/api/ops/buttons?' + INC);
  const sqlB = {}; for (const r of srv.rows("SELECT path, json_extract(params,'$.track_id') AS tid, COUNT(*) AS n FROM events WHERE name = 'ui_click' GROUP BY path, tid")) sqlB[r.path + '|' + r.tid] = r.n;
  const apiB = {}; for (const r of (B.json || {}).buttons || []) apiB[r.path + '|' + r.track_id] = r.clicks;
  const diffB = Object.keys(sqlB).filter((k) => apiB[k] !== sqlB[k]);
  ok(B.status === 200 && !B.json.truncated && diffB.length === 0 && Object.keys(sqlB).length > 0, `buttons: clicks per control match D1 for ${Object.keys(sqlB).length} path and control pairs`, diffB.slice(0, 4).map((k) => [k, sqlB[k], apiB[k]]));
  const D = await api('/api/ops/demos?' + INC);
  const sqlD = {}; for (const r of srv.rows("SELECT json_extract(params,'$.demo_id') AS did, COUNT(*) AS n FROM events WHERE name = 'demo_open' GROUP BY did")) if (!/^pg\./.test(r.did)) sqlD[r.did] = r.n;
  const apiD = Object.fromEntries(((D.json || {}).demos || []).map((r) => [r.demo_id, r.opens]));
  const diffD = Object.keys(sqlD).filter((k) => apiD[k] !== sqlD[k]);
  ok(D.status === 200 && diffD.length === 0 && Object.keys(sqlD).length >= 8, `demos: opens per demo match D1 for ${Object.keys(sqlD).length} demos and tools`, diffD.map((k) => [k, sqlD[k], apiD[k]]));
  ok(!((D.json || {}).demos || []).some((r) => /^pg\./.test(r.demo_id)), 'demos: no pg.* page action is listed as a demo');
  const L = await api('/api/ops/links?' + INC);
  const lk = ((L.json || {}).links || []).find((x) => x.slug === 'cv-joined-demo');
  const humans = srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE slug = 'cv-joined-demo' AND is_bot = 0")[0].n, bots = srv.rows("SELECT COUNT(*) AS n FROM link_clicks WHERE slug = 'cv-joined-demo' AND is_bot = 1")[0].n;
  ok(!!lk && lk.clicks_human === humans && lk.clicks_bot === bots, 'links: human and bot clicks match link_clicks', lk && [lk.clicks_human, lk.clicks_bot, humans, bots]);
  ok(!!lk && lk.sessions === srv.rows("SELECT COUNT(*) AS n FROM sessions WHERE link = 'cv-joined-demo'")[0].n && lk.conversions >= 1, 'links: visits and conversions for the link match the session and event rows', lk && [lk.sessions, lk.conversions]);
  const AQ = await api('/api/ops/acquisition?' + INC);
  const ch = ((AQ.json || {}).channels || []).find((x) => x.channel === 'link:cv');
  ok(!!ch && ch.sessions === srv.rows("SELECT COUNT(*) AS n FROM sessions WHERE link LIKE 'cv-%'")[0].n, 'where from: the cv link channel counts the link sessions', ch);
  const dflt = await api('/api/ops/pages?days=3650');
  ok(dflt.status === 200 && ((dflt.json || {}).pages || []).reduce((a, r) => a + r.views, 0) === 0, 'default scope: owner and test traffic is hidden (all of it is flagged)', ((dflt.json || {}).pages || []).length);
  const csv = await api('/api/ops/csv?table=events&' + INC);
  ok(csv.status === 200 && csv.text.split('\n').length - 2 >= total() - 5, 'csv export carries the event rows', [csv.text.split('\n').length, total()]);
}

// ================================================================ pages survive a broken backend
if (want('resilience')) {
  group('resilience: pages still load when Functions or D1 fail');
  for (const v of [{ label: 'nod1', d1: false, access: false, what: 'no D1 binding' }, { label: 'nomig', migrate: false, access: false, what: 'D1 with no tables' }]) {
    const s2 = await startPages(v);
    const e = await req(s2.base, 'POST', '/api/e', { headers: { origin: s2.base, 'user-agent': BROWSER_UA, 'content-type': 'text/plain' }, body: JSON.stringify({ v: 1, vid: 'a'.repeat(16), sid: 'b'.repeat(16), pid: 'c'.repeat(16), ctx: { path: '/work', page_type: 'work', lang: 'en', device: 'desktop', vw: 1, vh: 1, ref_host: '', link: null, utm: {}, owner: false, test: 'res' }, ev: [{ n: 'page_view', t: Date.now(), p: { title_id: 'work' } }] }) });
    ok(e.status === 503, `${v.what}: /api/e answers 503, not a crash`, e.status);
    const g = await req(s2.base, 'GET', '/go/cv-anything', { headers: { 'user-agent': BROWSER_UA } });
    ok(g.status === 302 && g.headers.location === '/', `${v.what}: /go sends the visitor home`, [g.status, g.headers.location]);
    const c = await ctx({ region: 'US', stored: 'granted', test: 'res-' + v.label, baseURL: s2.base }); const p = await c.newPage(); const errs = [];
    p.on('pageerror', (er) => errs.push(er.message));
    for (const pg of ['/', '/work', '/demos/hands', '/contact']) {
      const r = await p.goto(s2.base + pg, { waitUntil: 'load' }); await ready(p, 1200); await p.mouse.click(300, 300); await p.mouse.wheel(0, 500); await flush(p);
      ok(r.status() === 200 && await p.evaluate(() => document.body.innerText.length > 200), `${v.what}: ${pg} loads (200) with its content`, r.status());
    }
    ok(errs.length === 0, `${v.what}: no page error from tracking while the backend fails`, errs.slice(0, 2));
    ok(await p.evaluate(() => typeof sk === 'object' && sk.v) , `${v.what}: the client is alive and silent`);
    await c.close(); s2.stop();
  }
  { // the endpoint failing at the network layer: reset, 500, never answering
    for (const mode of ['500', 'abort']) {
      const c = await ctx({ region: 'US', stored: 'granted', test: 'res-net' }); const p = await c.newPage(); const errs = [];
      p.on('pageerror', (er) => errs.push(er.message));
      await p.route('**/api/e', (r) => (mode === '500' ? r.fulfill({ status: 500, body: 'x' }) : r.abort()));
      await p.goto('/work', { waitUntil: 'load' }); await ready(p, 1000); await p.mouse.click(300, 300); await p.mouse.wheel(0, 900); await flush(p, 800);
      const t0 = await p.evaluate(() => { const a = performance.now(); let n = 0; while (performance.now() - a < 50) n++; return n > 0; });
      ok(errs.length === 0 && t0 && await p.evaluate(() => document.body.innerText.length > 200), `/api/e ${mode}: page keeps working, no error, main thread free`, errs.slice(0, 2));
      await c.close();
    }
  }
}

// ================================================================ /ops never opens without auth
if (want('auth')) {
  group('auth: /ops and /api/ops never open without a valid Access token');
  const no = ['/ops', '/ops/', '/ops/index.html', '/ops/app.js', '/ops/views.js', '/ops/dom.js', '/ops/lib.js', '/ops/ops.css', '/ops/controls.json', '/ops/vendor/qrcode.js', '/OPS/app.js', '/ops//app.js', '/ops/./app.js', '/ops/%2e/app.js', '/ops/../ops/app.js', '/ops/app.js?x=1', '/ops/app.js/', '/api/ops/live', '/api/ops/pages', '/api/ops/csv?table=events', '/api/ops/links', '/api/ops/health'];
  for (const p of no) {
    const a = await req(srv.base, 'GET', p, { headers: {} });
    const b = await req(srv.base, 'GET', p, { headers: { 'cf-access-jwt-assertion': 'garbage.token.value' } });
    const f = await req(srv.base, 'GET', p, { headers: { 'cf-access-jwt-assertion': A.sign({}, { key: A.forgedKey }) } });
    const x = await req(srv.base, 'GET', p, { headers: { 'cf-access-jwt-assertion': A.sign({ exp: Math.floor(Date.now() / 1000) - 60 }) } });
    ok([a, b, f, x].every((r) => r.status !== 200 && !/dashboard shell|function\s*\(|export (async )?function|"controls"/.test(r.text.slice(0, 4000))), `${p}: no token, garbage, forged and expired tokens are all refused`, [a.status, b.status, f.status, x.status]);
  }
  const posts = await req(srv.base, 'POST', '/api/ops/links', { headers: { origin: srv.base, 'content-type': 'application/json' }, body: { slug: 'cv-sneak-in', dest: '/work' } });
  ok(posts.status === 403 && srv.rows("SELECT COUNT(*) AS n FROM links WHERE slug = 'cv-sneak-in'")[0].n === 0, 'creating a link without a token is refused and writes nothing', posts.status);
  const yes = [];
  for (const p of ['/ops/', '/ops/app.js', '/ops/controls.json', '/api/ops/live']) { const r = await req(srv.base, 'GET', p, { headers: { 'cf-access-jwt-assertion': A.sign({}) } }); yes.push([p, r.status, r.headers['cache-control']]); }
  ok(yes.every(([, s2, cc]) => s2 === 200 && /no-store/.test(cc || '')), 'with a valid token the shell, its script, the control list and the API open, never cached', yes);
  { const s2 = await startPages({ label: 'noaccess', access: false });
    const r = [];
    for (const p of ['/ops/', '/ops/app.js', '/api/ops/live']) r.push((await req(s2.base, 'GET', p, { headers: { 'cf-access-jwt-assertion': A.sign({}) } })).status);
    ok(r.every((s3) => s3 === 403), 'an unconfigured Access setting fails closed even with a well-formed token', r);
    s2.stop(); }
  { const c = await ctx({ region: 'US' }); const p = await c.newPage();
    const r = await p.goto('/ops/app.js'); const t = await p.content();
    ok(r.status() === 403 && !/function/.test(t), 'a browser opening /ops/app.js with no login gets 403 and no script');
    const r2 = await p.goto('/ops/'); ok(r2.status() === 403, 'a browser opening /ops/ with no login gets 403');
    await c.close(); }
  const dist = path.join(ROOT, DIST_REL);
  ok(!fs.existsSync(path.join(dist, 'ops')), 'no dashboard file exists as a static file, so a Functions outage or limit cannot expose it');
  const routes = JSON.parse(fs.readFileSync(path.join(dist, '_routes.json'), 'utf8'));
  ok(routes.include.includes('/*') && !routes.exclude.some((r) => /^\/ops/.test(r)), '_routes.json never excludes /ops from the Functions gate');
}

// ================================================================ a click that navigates is not lost
if (want('nav')) {
  group('nav: a click that leaves the page still reaches D1 (the fade transition navigates after 350 ms)');
  const t = T('nav-');
  const c = await ctx({ region: 'US', stored: 'granted', test: t }); const p = await c.newPage();
  const hops = [['/about', 'nav.work', '/work'], ['/work', 'nav.process', '/process'], ['/process', 'nav.demos', '/demos'], ['/demos', 'nav.contact', '/contact'], ['/contact', 'nav.blog', '/blog'], ['/blog', 'nav.about', '/about']];
  for (const [from, id, to] of hops) {
    await p.goto(from, { waitUntil: 'load' }); await ready(p, 900);
    const el = p.locator(`a[data-track="${id}"]`).first();
    await el.click({ timeout: 8000 }).catch(() => {});
    await p.waitForURL((u) => u.pathname === to || u.pathname === to + '/', { timeout: 8000 }).catch(() => {});
    await ready(p, 500);
    const got = await until(() => ev("test = ? AND name = 'ui_click'", t).some((r) => { try { return JSON.parse(r.params).track_id === id && r.path === from; } catch { return false; } }), 7000);
    ok(got && pgPath(p.url()).startsWith(to), `${from} to ${to}: the ${id} click is stored with the page it was made on`, { url: pgPath(p.url()), rows: ev('test = ?', t).filter((r) => r.path === from).map((r) => r.name + ' ' + (r.name === 'ui_click' ? JSON.parse(r.params).track_id : '')).slice(-8) });
  }
  await c.close();
}

await finish();
