// Content pages tests. Run from anywhere: node tracking/tests/pages/run.mjs
// Works on a COPY of the worktree in a temp folder (the real tree is never written), applies the codemod there,
// serves the copy on loopback and drives it with Playwright. Every host except loopback is aborted, so nothing
// reaches GA4, GTM, Clarity, Formspree or Brevo. /api/e is mocked and its bodies are the thing under test.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { pwRequire as require } from '../pw.mjs';
const { chromium } = require('playwright');
const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-pages-'));
const PRE = path.join(TMP, 'pre'), POST = path.join(TMP, 'post');
const SKIP = /^(node_modules|\.git|dist|\.wrangler|ops|syndication|social-kit)$/;
const copy = (to) => fs.cpSync(REAL, to, { recursive: true, filter: (s) => !SKIP.test(path.basename(s)) || s === REAL });
copy(PRE); copy(POST);
const PRE_STAMPED = path.join(TMP, 'pre-stamped'); copy(PRE_STAMPED);
// PRE is the unstamped baseline: the same pages with every codemod stamp removed (owned pages carried none before).
const STRIP = (t) => t.replace(/ data-(track|zone|section|page-type)="[^"]*"/g, '').replace(/[ \t]*<script>window\.SK_CLARITY_ID='[^']*';<\/script>\n/g, '').replace(/((?:consent|analytics)\.js)\?v=[0-9a-f]+/g, '$1');
const CM = path.join(REAL, 'tracking/codemod.mjs');
const cm = (root, ...a) => { try { return { code: 0, out: execFileSync('node', [CM, '--root', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
let failStatus = false;
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f = path.join(POST, p);
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(POST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    // like Cloudflare Pages: unknown paths answer with 404.html and status 404
    r.statusCode = 404; r.setHeader('Content-Type', 'text/html');
    return r.end(fs.existsSync(path.join(POST, '404.html')) ? fs.readFileSync(path.join(POST, '404.html')) : 'nf');
  }
  r.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const BASE = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch();

async function mk({ viewport = { width: 1440, height: 900 }, reduced = false, tz = 'America/New_York', abort = [] } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const posts = [], external = [];
  await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), (r) => { external.push(r.request().url()); r.abort(); });
  await ctx.route('**/api/e', (r) => { try { posts.push(JSON.parse(r.request().postData())); } catch (e) { posts.push({ bad: 1 }); } r.fulfill({ status: 204, body: '' }); });
  for (const a of abort) await ctx.route(a, (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/favicon/.test(r.url())) errs.push('http ' + r.status() + ' ' + r.url().replace(BASE, '')); });
  return { ctx, page, posts, errs, external };
}
const evs = (posts) => posts.flatMap((p) => p.ev.map((e) => ({ ...e, ctx: p.ctx })));
const named = (posts, n) => evs(posts).filter((e) => e.n === n);
const demoActs = (posts, id) => evs(posts).filter((e) => e.n === 'demo_action' && e.p.demo_id === id).map((e) => e.p);
const go = async (page, url, opt) => { await page.goto(BASE + url, { waitUntil: 'load', ...opt }); await page.waitForFunction(() => window.sk && sk.v, null, { timeout: 8000 }); await page.waitForTimeout(400); };
const flush = async (page) => { await page.evaluate(() => sk.flush()); await page.waitForTimeout(300); };
const hide = async (page) => { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(400); };

const CMOD = await import(path.join(REAL, 'tracking/codemod.mjs'));
const pages = CMOD.listPages(REAL);
const PAGEFILES = CMOD.listPages(REAL, { all: true }).concat(['404.html']);
for (const f of pages) for (const root of [PRE, PRE_STAMPED]) { const q = path.join(root, f); fs.writeFileSync(q, STRIP(fs.readFileSync(q, 'utf8'))); }

// =============== codemod ===============
console.log('codemod');
{
  const noRoot = (() => { try { execFileSync('node', [CM, '--check'], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } })();
  ok(noRoot === 2, 'refuses to run without an explicit absolute --root (exit 2)');
  const rel = (() => { try { execFileSync('node', [CM, '--root', 'relative/dir'], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } })();
  ok(rel === 2, 'refuses a relative root (exit 2)');
  const a = cm(PRE_STAMPED);
  ok(a.code === 0 && /24 pages, 24 changed/.test(a.out), 'first run stamps the unstamped baseline: ' + a.out.trim().split('\n').pop());
  const snap = (root) => Object.fromEntries(PAGEFILES.filter((f) => fs.existsSync(path.join(root, f))).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const s1 = snap(POST);
  const b = cm(POST);
  const s2 = snap(POST);
  ok(b.code === 0 && /, 0 changed/.test(b.out), 'second run changes nothing: ' + b.out.trim().split('\n').pop());
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'files are byte identical after the second run');
  ok(cm(POST, '--check').code === 0, '--check exits 0 on a stamped tree');
  ok(cm(PRE, '--check').code === 1, '--check exits 1 on the unstamped baseline');
  { const t = fs.mkdtempSync(path.join(TMP, 'rt-')); fs.cpSync(PRE, t, { recursive: true }); cm(t); const same = pages.every((f) => fs.readFileSync(path.join(t, f), 'utf8') === s1[f]); ok(same, 'stripping every stamp and running the codemod again reproduces the stamped pages byte for byte'); }
  // The pages other agents own (media, tools, 404). Their baseline is the committed version, read with `git show` (read-only).
  // Once the closing commit makes HEAD already stamped there is no baseline left, and the checks say so instead of passing.
  const OTHER = PAGEFILES.filter((f) => CMOD.OTHER_OWNERS.some((r) => r.test(f)));
  const old = {};
  for (const f of OTHER) { try { old[f] = execFileSync('git', ['-C', REAL, 'show', 'HEAD:' + f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (e) { /* not in git */ } }
  const usable = OTHER.filter((f) => old[f] && !/data-page-type=/.test(old[f]));
  if (usable.length < OTHER.length) console.log(`  note: ${OTHER.length - usable.length} of ${OTHER.length} other-owner pages are already stamped at HEAD, so there is no unstamped baseline for them`);
  const dry = fs.mkdtempSync(path.join(TMP, 'all-')); fs.cpSync(POST, dry, { recursive: true });
  for (const f of usable) fs.writeFileSync(path.join(dry, f), old[f]);
  const oldDir = fs.mkdtempSync(path.join(TMP, 'others-old-')); for (const f of usable) { fs.mkdirSync(path.dirname(path.join(oldDir, f)), { recursive: true }); fs.writeFileSync(path.join(oldDir, f), old[f]); }
  globalThis.__OTHERS = { oldDir, dry, usable };
  const before = snap(dry);
  const all = cm(dry, '--all', '--check');
  if (usable.length) ok(usable.length > 0 && all.code === 1 && /404\.html/.test(all.out) && /demos\/hands\.html/.test(all.out), `--all would stamp the unstamped media, tools and 404 pages (${usable.length} baselines): ` + all.out.trim().split('\n').pop());
  cm(dry, '--all'); const after = snap(dry);
  if (usable.length) ok(usable.includes('404.html') && /googletagmanager/.test(before['404.html']) && !/googletagmanager/.test(after['404.html']) && /data-page-type="not-found"/.test(after['404.html']) && /SK_CLARITY_ID/.test(after['404.html']), '404.html: --all removes the GTM loader and noscript and adds the page type and Clarity id');
  const STRIPALL = (x) => x
    .replace(/[ \t]*<!-- Google Tag Manager( \(noscript\))? -->\s*<(script|noscript)>[\s\S]*?<\/\2>\s*<!-- End Google Tag Manager( \(noscript\))? -->[ \t]*\n?/g, '')
    .replace(/ data-(track|zone|section|page-type)="[^"]*"/g, '').replace(/<script>window\.SK_CLARITY_ID='[^']*';<\/script>\n?\s*/, '').replace(/(consent|analytics)\.js\?v=[0-9a-f]+/g, '$1.js').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').replace(/> </g, '><');
  const changedOnly = usable.filter((f) => STRIPALL(after[f]) !== STRIPALL(before[f]));
  if (usable.length) ok(usable.length > 0 && changedOnly.length === 0, `--all on ${usable.length} media, tools and 404 pages changes only stamps: data-track, zone, section, page type, Clarity id, ?v= and the inline GTM loader` + (changedOnly.length ? ' [' + changedOnly.join(',') + ']' : ''));
  const idem = cm(dry, '--all'); ok(/, 0 changed/.test(idem.out), '--all is idempotent');
  // ids: no addresses, names, bad characters
  const ids = [];
  for (const f of pages) for (const m of s2[f].matchAll(/data-track="([^"]*)"/g)) ids.push([f, m[1]]);
  ok(ids.length > 400, `${ids.length} data-track ids on owned pages`);
  const bad = ids.filter(([, i]) => !/^[a-z0-9][a-z0-9._-]{0,59}$/.test(i) || /@|mailto|tel:|sai|kanagat|prathyaksh/i.test(i));
  ok(bad.length === 0, 'ids are clean (no @, mailto, names, odd characters): ' + JSON.stringify(bad.slice(0, 3)));
  const dupe = pages.filter((f) => { const a = [...s2[f].matchAll(/data-track="([^"]*)"/g)].map((m) => m[1]); return a.length !== new Set(a).size; });
  ok(dupe.length === 0, 'no duplicate ids on a page: ' + dupe.join(','));
  for (const f of pages) {
    const t = s2[f];
    if (!(/data-page-type="[a-z-]+"/.test(t) && /SK_CLARITY_ID='zir45wg6mm'/.test(t) && /consent\.js\?v=[0-9a-f]{8}/.test(t) && /analytics\.js\?v=[0-9a-f]{8}/.test(t) && t.indexOf('SK_CLARITY_ID') < t.search(/consent\.js/))) { ok(false, 'head tags complete and ordered: ' + f); }
  }
  ok(true, 'every owned page has page type, Clarity id before consent.js, and hashed consent.js and analytics.js');
  // lang.js rewrites innerHTML from data-en/data-it: no markup with ids may sit inside those attributes
  const inLang = pages.filter((f) => /data-(en|it)="[^"]*(<a\b|<button|data-track)/.test(s2[f]));
  ok(inLang.length === 0, 'no links, buttons or ids inside data-en / data-it strings (lang.js would wipe them)');
  // the hand wiring survived the re-stamp
  ok(/filter_apply/.test(s2['demos.html']) && /furthest_step/.test(s2['process.html']) && /status_fetch_failed/.test(s2['build-log/index.html']) && /data-form="aperol_mock"/.test(s2['aperol-microsite/index.html']), 'hand wiring in demos, process, build-log and aperol-microsite is intact after stamping');
  ok(!/js\/main\.js/.test(s2['papers/monocular-biomechanics.html']), 'papers page no longer loads the missing js/main.js');
  ok(!fs.existsSync(path.join(REAL, 'js/main.js')), 'js/main.js does not exist in the repo');
  // DOM safety: with JavaScript off, the stamped page equals the original once our attributes and scripts are removed
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.protocol !== 'file:', (r) => r.abort());
  let diffs = [];
  const dom = async (root, f) => {
    const pg = await ctx.newPage();
    await pg.goto('file://' + path.join(root, f), { waitUntil: 'domcontentloaded' });
    const h = await pg.evaluate(() => {
      document.querySelectorAll('script,noscript').forEach((n) => n.remove());
      document.querySelectorAll('[data-track],[data-zone],[data-section],[data-page-type]').forEach((n) => { ['data-track', 'data-zone', 'data-section', 'data-page-type'].forEach((a) => n.removeAttribute(a)); });
      return document.documentElement.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').replace(/> </g, '><');
    });
    await pg.close(); return h;
  };
  for (const f of pages) {
    // the unstamped copy has only the hand wiring (inline scripts are removed above), so equal markup is the pass condition
    const x = await dom(PRE, f), y = await dom(POST, f);
    if (x !== y) diffs.push(f);
  }
  { // the media, tools and 404 pages too: committed version against the stamped one, with JavaScript off
    const { oldDir, dry, usable } = globalThis.__OTHERS;
    const d2 = [];
    for (const f of usable) { const x = await dom(oldDir, f), y = await dom(dry, f); if (x !== y) d2.push(f); }
    if (usable.length) ok(d2.length === 0, `visible markup of ${usable.length} media, tools and 404 pages is unchanged once our attributes and scripts are removed` + (d2.length ? ' [' + d2.join(',') + ']' : ''));
  }
  await ctx.close();
  ok(diffs.length === 0, `DOM identical before and after stamping on ${pages.length} pages (JavaScript off, our attributes and script tags removed)` + (diffs.length ? ': ' + diffs.join(',') : ''));
}

// =============== every page loads ===============
console.log('page loads');
{
  const bad = [];
  for (const kind of [{ viewport: { width: 1440, height: 900 } }, { viewport: { width: 390, height: 844 } }]) {
    const t = await mk(kind);
    for (const f of pages) {
      t.errs.length = 0;
      await t.page.goto(BASE + '/' + f, { waitUntil: 'load' });
      await t.page.waitForTimeout(700);
      // blocked third party hosts show up as failed requests, not as our errors
      const mine = t.errs.filter((e) => /^http 404/.test(e) || (!/net::ERR_(FAILED|BLOCKED)/.test(e) && !/sunset fetch fail/.test(e)));
      if (mine.length) bad.push(`${kind.viewport.width} ${f}: ${mine[0].slice(0, 110)}`);
    }
    await t.ctx.close();
  }
  ok(bad.length === 0, `${pages.length} pages load with no page error, console error or 404, desktop and mobile` + (bad.length ? '\n        ' + bad.join('\n        ') : ''));
}

// =============== one event per control ===============
console.log('one ui_click per control');
{
  const SAMPLE = ['index.html', 'about.html', 'process.html', 'demos.html', 'blog.html', 'blog/building-nishta.html', 'brand-identity.html', 'aperol-golden-hour.html', 'aperol-microsite/index.html', 'build-log/index.html', 'papers/monocular-biomechanics.html', 'thallo/index.html', 'work.html', 'gallery.html', 'contact.html'];
  for (const f of SAMPLE) {
    const probe = await mk();
    await go(probe.page, '/' + f);
    const all = await probe.page.evaluate(() => [...document.querySelectorAll('[data-track]')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[data-no-track]') && !/^(INPUT|SELECT|TEXTAREA|VIDEO|CANVAS)$/.test(e.tagName); }).map((e) => e.getAttribute('data-track')));
    const cands = [];
    for (const id of all) { if (cands.length >= 3) break; try { await probe.page.locator(`[data-track="${id}"]`).first().click({ timeout: 1200, trial: true }); cands.push(id); } catch (e) { /* covered or hidden */ } }
    await probe.ctx.close();
    let good = 0;
    for (const id of cands) {
      const t = await mk();
      await go(t.page, '/' + f);
      await t.page.evaluate(() => document.addEventListener('click', (e) => { try { sk.flush(); } catch (x) {} if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); }, true));
      await t.page.locator(`[data-track="${id}"]`).first().click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
      await t.page.waitForTimeout(700);
      try { await flush(t.page); } catch (e) { /* the click navigated away: the pagehide beacon carries the batch */ }
      await t.page.waitForTimeout(300);
      const n1 = named(t.posts, 'ui_click').filter((e) => e.p.track_id === id).length;
      if (n1 === 1) good++; else console.log(`        ${f} ${id}: ${n1} ui_click, page now ${t.page.url().replace(BASE, '')}, posts ${t.posts.length}`);
      await t.ctx.close();
    }
    ok(cands.length > 0 && good === cands.length, `${f}: ${good}/${cands.length} sampled controls each produced exactly one ui_click with its id (${cands.join(', ')})`);
  }
}

// =============== wiring ===============
console.log('home');
{
  const t = await mk({ reduced: true });
  await go(t.page, '/index.html'); await flush(t.page);
  const a = demoActs(t.posts, 'pg.home').map((p) => p.action);
  ok(a.filter((x) => x === 'hero_view').length === 1 && a.filter((x) => x === 'hero_settled').length === 1, 'hero_view and hero_settled once each (reduced motion)');
  await t.ctx.close();
  const u = await mk();
  await go(u.page, '/index.html');
  await u.page.waitForTimeout(8300); await flush(u.page);
  const st = demoActs(u.posts, 'pg.home').filter((p) => p.action === 'hero_settled');
  ok(st.length === 1 && st[0].ms >= 7000 && st[0].ms < 9500, 'hero_settled fires once after the 7.6 s timeline, ms=' + (st[0] && st[0].ms));
  const hv = named(u.posts, 'demo_action').filter((e) => e.p.demo_id === 'pg.home' && e.p.action === 'hero_view');
  ok(hv.length === 1, 'hero_view exactly once');
  // louvre shutter progress, scrolled in steps
  const H = await u.page.evaluate(() => { const e = document.getElementById('heroExperience'); return e.offsetHeight - innerHeight; });
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 0.2, 0.9]) { await u.page.evaluate((y) => window.scrollTo(0, y), Math.round(H * f)); await u.page.waitForTimeout(250); }
  await flush(u.page);
  const sp = demoActs(u.posts, 'pg.home').filter((p) => p.action === 'shutter_progress').map((p) => p.value);
  ok(JSON.stringify(sp) === '[25,50,75,100]', 'shutter_progress 25, 50, 75, 100 once each, in order, none on scroll back: ' + JSON.stringify(sp));
  // marquee hover
  await u.page.evaluate(() => window.scrollTo(0, 0));
  await u.page.evaluate(() => { const e = document.querySelector('.marquee-wrap'); window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 400, behavior: 'instant' }); });
  await u.page.waitForTimeout(600);
  const mq = await u.page.evaluate(() => { const r = document.querySelector('.marquee-wrap').getBoundingClientRect(); return [r.left + 200, r.top + r.height / 2]; });
  await u.page.mouse.move(mq[0], mq[1]); await u.page.waitForTimeout(900); await u.page.mouse.move(mq[0], 20); await u.page.waitForTimeout(300); await flush(u.page);
  const mh = demoActs(u.posts, 'pg.home').filter((p) => p.action === 'marquee_hover');
  ok(mh.length === 1 && mh[0].ms >= 800 && mh[0].ms <= 1500, 'marquee_hover once with ms rounded to 100: ' + JSON.stringify(mh));
  // icon field pushed by the cursor, summary on hide
  await u.page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 90; i++) { await u.page.mouse.move(300 + (i % 30) * 20, 300 + (i % 9) * 20); await u.page.waitForTimeout(25); }
  await hide(u.page); await flush(u.page);
  const ip = demoActs(u.posts, 'pg.home').map((p) => p.action).filter((x) => /^icons_/.test(x));
  ok(ip.filter((x) => x === 'icons_pushed').length <= 1 && ip.every((x) => x === 'icons_pushed' || x === 'icons_pushed_seconds'), 'icon field events are only icons_pushed (once) and icons_pushed_seconds: ' + JSON.stringify(ip));
  const per = named(u.posts, 'demo_action').filter((e) => e.p.demo_id === 'pg.home').length;
  ok(per < 20, 'home demo_action volume stays small (' + per + ' events), nothing per frame');
  const ue = u.errs.filter((e) => !/net::ERR_(FAILED|BLOCKED)/.test(e)); ok(ue.length === 0, 'home: no errors while interacting ' + ue.slice(0, 2));
  await u.ctx.close();
}
console.log('project_preview');
{
  const t = await mk();
  await go(t.page, '/index.html');
  await t.page.waitForFunction(() => !document.querySelector('.site-loader:not(.done)') || document.querySelector('.site-loader.done'), null, { timeout: 15000 }).catch(() => {});
  await t.page.waitForTimeout(1500);
  const cards = [];
  for (const k of [0, 1]) {
    const pt = await t.page.evaluate((i) => { const im = [...document.querySelectorAll('.work-grid .work-card img.card-img')][i]; if (!im) return null; im.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = im.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, k);
    if (!pt) continue;
    await t.page.waitForTimeout(500);
    await t.page.mouse.move(5, pt[1]); await t.page.mouse.move(pt[0], pt[1], { steps: 8 }); await t.page.waitForTimeout(400);
    await t.page.mouse.move(5, pt[1]); await t.page.waitForTimeout(200); cards.push(k);
  }
  await flush(t.page);
  const pp = named(t.posts, 'project_preview');
  ok(cards.length === 2 && pp.length === 2, `home cards: one project_preview per shown preview (${pp.length} for ${cards.length} hovers): ` + JSON.stringify(pp.map((e) => e.p)));
  ok(pp.every((e) => /^[a-z0-9_-]+$/.test(e.p.project_id) && Object.keys(e.p).join() === 'project_id'), 'project_preview carries only project_id');
  ok(pp.every((e) => !/\.(jpe?g|png|webp)|\s/.test(JSON.stringify(e.p))), 'no image path or alt text in project_preview');
  await t.ctx.close();
  const g = await mk();
  await go(g.page, '/gallery.html');
  await g.page.evaluate(() => openPanel('casamota')); await g.page.waitForTimeout(600);
  const pi = await g.page.evaluate(() => { const im = document.querySelector('.panel-gallery img'); if (!im) return null; im.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = im.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await g.page.waitForTimeout(400); await g.page.mouse.move(pi[0] - 30, pi[1]); await g.page.mouse.move(pi[0], pi[1], { steps: 6 }); await g.page.waitForTimeout(400); await flush(g.page);
  const last = named(g.posts, 'project_preview');
  ok(last.length === 1 && last[0].p.project_id === 'casamota', 'image inside the open case study panel reports the open project id: ' + JSON.stringify(last.map((e) => e.p)));
  await g.ctx.close();
  const w = await mk();
  await go(w.page, '/work.html');
  const pt = await w.page.evaluate(() => { const r0 = [...document.querySelectorAll('.we-row')].filter((r) => r.offsetParent && r.getAttribute('data-cover'))[1]; r0.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = r0.getBoundingClientRect(); return [r.left + 100, r.top + r.height / 2]; });
  await w.page.waitForTimeout(500); await w.page.mouse.move(5, pt[1]); await w.page.mouse.move(pt[0], pt[1], { steps: 5 }); await w.page.waitForTimeout(300); await flush(w.page);
  const wp = named(w.posts, 'project_preview');
  ok(wp.length === 1, 'work list row hover: one project_preview ' + JSON.stringify(wp.map((e) => e.p)));
  await w.ctx.close();
  const m = await mk({ viewport: { width: 390, height: 844 } });
  await go(m.page, '/index.html'); await m.page.mouse.move(100, 300); await flush(m.page);
  ok(named(m.posts, 'project_preview').length === 0, 'no project_preview on a touch viewport (preview is disabled there)');
  await m.ctx.close();
}
console.log('demos, process, build log');
{
  const t = await mk();
  await go(t.page, '/demos.html');
  const n0 = await t.page.locator('.demo-filter').count();
  await t.page.locator('.demo-filter').nth(1).click(); await t.page.locator('.demo-filter').nth(1).click(); await flush(t.page);
  const fa = named(t.posts, 'filter_apply');
  ok(n0 > 1 && fa.length === 1 && fa[0].p.list_id === 'demos' && /^[a-z]+$/.test(fa[0].p.filter_id), 'demos filter: one filter_apply per change, list_id=demos: ' + JSON.stringify(fa.map((e) => e.p)));
  await t.ctx.close();
  const r = await mk();
  await r.page.goto(BASE + '/demos.html', { waitUntil: 'load', referer: BASE + '/demos/agora.html' });
  await r.page.waitForFunction(() => window.sk && sk.v); await r.page.waitForTimeout(300); await flush(r.page);
  const ra = demoActs(r.posts, 'pg.demos').filter((p) => p.action === 'return_from_demo');
  ok(ra.length === 1 && ra[0].item === 'agora', 'return_from_demo with the demo slug only: ' + JSON.stringify(ra));
  await r.ctx.close();
  const q = await mk();
  await q.page.goto(BASE + '/demos.html', { waitUntil: 'load', referer: 'https://example.com/demos/agora.html' });
  await q.page.waitForFunction(() => window.sk && sk.v); await flush(q.page);
  ok(demoActs(q.posts, 'pg.demos').length === 0, 'a foreign referrer produces nothing');
  await q.ctx.close();
  const p = await mk();
  await go(p.page, '/process.html');
  const total = await p.page.locator('.process-step').count();
  for (let y = 0; y < 6; y++) { await p.page.mouse.wheel(0, 900); await p.page.waitForTimeout(250); }
  await p.page.evaluate(() => window.scrollTo(0, 0)); await p.page.waitForTimeout(250);
  await hide(p.page); await flush(p.page);
  const fs2 = demoActs(p.posts, 'pg.process').filter((x) => x.action === 'furthest_step');
  ok(fs2.length === 1 && fs2[0].value >= 1 && fs2[0].value <= total, `process furthest_step sent once on hide, value ${fs2[0] && fs2[0].value} of ${total}, even after scrolling back up`);
  const p2 = await mk(); await go(p2.page, '/process.html');
  await p2.page.evaluate(() => { const e = document.querySelector('.process-step'); window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - innerHeight / 2 + 100, behavior: 'instant' }); });
  await p2.page.waitForTimeout(1500); await p2.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p2.page.waitForTimeout(500); await flush(p2.page);
  const sv = named(p2.posts, 'section_view').filter((e) => /^step-/.test(e.p.section_id));
  ok(sv.length >= 1 && sv.every((e) => e.p.ms >= 800), 'a step in view for over a second sends section_view step-N with ms: ' + JSON.stringify(sv.map((e) => e.p)));
  await p2.ctx.close();
  await p.ctx.close();
  const b = await mk({ abort: ['**/build-log/status.json'] });
  await go(b.page, '/build-log/index.html'); await b.page.waitForTimeout(500); await flush(b.page);
  ok(demoActs(b.posts, 'pg.build-log').some((x) => x.action === 'status_fetch_failed'), 'build log: status_fetch_failed when status.json cannot load');
  await b.ctx.close();
}
console.log('about, brand, aperol, thallo, paper: sections and downloads');
{
  const t = await mk();
  for (const [f, ids] of [['about.html', ['about-portraits', 'about-bio', 'timeline-1', 'cert-1']], ['process.html', ['step-1']], ['brand-identity.html', ['cover', 'principles', 'logo', 'color']], ['thallo/index.html', []]]) {
    await go(t.page, '/' + f);
    const have = await t.page.evaluate(() => [...document.querySelectorAll('[data-section],main section[id]')].map((e) => e.dataset.section || e.id));
    ok(ids.every((i) => have.includes(i)), `${f}: ${have.length} viewable sections, includes ${ids.join(', ') || 'none required'}`);
  }
  const brand = await t.page.evaluate(() => 0);
  await go(t.page, '/brand-identity.html');
  const n = await t.page.evaluate(() => document.querySelectorAll('[data-section]').length);
  ok(n >= 14, `brand book: ${n} sections carry a section id for dwell (plan said 14)`);
  await go(t.page, '/aperol-golden-hour.html');
  await t.page.evaluate(() => document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); }));
  for (const sel of ['a[href$=".pptx"]', 'a[href$=".docx"]']) {
    const l = t.page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.click(); }
  await flush(t.page);
  const fd = named(t.posts, 'file_download').map((e) => e.p);
  ok(fd.length === 2 && fd.every((p) => /^[a-z0-9-]+$/.test(p.file_id) && /^(pptx|docx)$/.test(p.ext)), 'aperol deck and memo downloads: file_id and ext only: ' + JSON.stringify(fd));
  await go(t.page, '/papers/monocular-biomechanics.html');
  await t.page.evaluate(() => document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); }));
  await t.page.locator('a[download]').first().click(); await flush(t.page);
  ok(named(t.posts, 'file_download').some((e) => e.p.ext === 'pdf'), 'paper PDF download is a file_download');
  const te = t.errs.filter((e) => !/net::ERR_(FAILED|BLOCKED)/.test(e) && !/sunset fetch fail/.test(e)); ok(te.length === 0, 'no errors on these pages ' + te.slice(0, 2));
  await t.ctx.close();
}
console.log('aperol mock signup, canary privacy');
{
  const MARK = 'CANARY7f3a9';
  const t = await mk();
  await t.page.addInitScript(() => { window.__dl = []; const iv = setInterval(() => { try { (window.dataLayer || []).forEach((x) => { const s = JSON.stringify(x); if (!window.__dl.includes(s)) window.__dl.push(s); }); } catch (e) {} }, 50); });
  await go(t.page, `/aperol-microsite/index.html?utm_source=cv&sk_l=li-test&secret=${MARK}q&x=${MARK}p#${MARK}hash`);
  await t.page.locator('#email-form input').fill(`${MARK}@example.com`);
  await t.page.locator('#email-form button').click(); await t.page.waitForTimeout(200);
  await flush(t.page);
  const fm = named(t.posts, 'form_submit_attempt').concat(named(t.posts, 'form_start'));
  ok(named(t.posts, 'form_submit_attempt').some((e) => e.p.form_id === 'aperol_mock'), 'aperol mock signup attempt carries form_id aperol_mock');
  ok(!named(t.posts, 'form_submit_success').length, 'a mock signup is never counted as form_submit_success (that is a key event)');
  await t.page.waitForTimeout(100);
  const dl = await t.page.evaluate(() => window.__dl.join('\n'));
  const wire = JSON.stringify(t.posts);
  ok(!wire.includes(MARK) && !dl.includes(MARK), 'canary: typed text, query values and hash never reach /api/e or dataLayer');
  ok(t.posts.every((p) => !/[?#]/.test(p.ctx.path)), 'ctx.path has no query or hash');
  ok(t.posts.length > 0 && t.posts[0].ctx.link === 'li-test' && t.posts[0].ctx.utm.utm_source === 'cv', 'allowlisted attribution (sk_l, utm_source) is carried');
  await t.ctx.close();
  for (const [f, setup] of [['/contact.html', async (p) => { for (const e of await p.locator('input:not([type=hidden]):not([type=submit]),textarea').all()) { try { await e.fill(MARK + ' typed'); } catch (x) {} } }], ['/thallo/index.html', async (p) => { for (const e of await p.locator('input[type=email]').all()) { try { await e.fill(MARK + '@example.com'); } catch (x) {} } }]]) {
    const u = await mk();
    await u.page.addInitScript(() => { window.__dl = []; setInterval(() => { try { (window.dataLayer || []).forEach((x) => { const s = JSON.stringify(x); if (!window.__dl.includes(s)) window.__dl.push(s); }); } catch (e) {} }, 50); });
    await go(u.page, f + `?q=${MARK}#${MARK}`);
    await setup(u.page);
    await u.page.evaluate(() => document.querySelectorAll('form').forEach((fm) => fm.addEventListener('submit', (e) => e.preventDefault(), true)));
    const sub = u.page.locator('form button[type=submit], form input[type=submit]').first();
    try { await sub.click({ timeout: 2000 }); } catch (e) {}
    await u.page.waitForTimeout(300); await flush(u.page);
    const dl2 = await u.page.evaluate(() => window.__dl.join('\n'));
    ok(!JSON.stringify(u.posts).includes(MARK) && !dl2.includes(MARK), `canary: ${f} typed marker, query and hash absent from /api/e and dataLayer (${u.posts.length} batches checked)`);
    await u.ctx.close();
  }
}
console.log('404 page through the real shim');
{
  const t = await mk();
  const missing = '/no-such-page-' + Date.now();
  await t.page.goto(BASE + missing + '?q=CANARYx', { waitUntil: 'load' });
  await t.page.waitForFunction(() => window.sk && sk.v, null, { timeout: 8000 });
  await t.page.waitForTimeout(500); await flush(t.page);
  const nf = named(t.posts, 'page_not_found');
  console.log('        posted page_not_found: ' + JSON.stringify(nf.map((e) => ({ n: e.n, p: e.p, path: e.ctx.path, page_type: e.ctx.page_type }))));
  ok(nf.length === 1 && typeof nf[0].p.missing_path === 'string' && nf[0].p.missing_path.length > 0, 'skq.push([function]) form accepted: exactly one page_not_found with missing_path');
  ok(!JSON.stringify(t.posts).includes('CANARYx'), 'the query string of the missing URL is not sent');
  const src = fs.readFileSync(path.join(REAL, '404.html'), 'utf8');
  ok(/skq[^;\n]*push\(\[function/.test(src.replace(/\s+/g, ' ')) || /skq\.push\(\s*\[\s*function/.test(src), '404.html uses the skq.push([function]) form');
  await t.ctx.close();
}

await browser.close(); srv.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
