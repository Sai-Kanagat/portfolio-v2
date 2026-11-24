// Client tests: consent matrix, ghost, form outcomes, URL stripping, double fire.
// Run: node tracking/tests/client/run.mjs   (from the worktree root)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire('/Users/saikanagat/saikanagat-analytics/tools/package.json');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
});
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const BASE = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function mk({ tz = 'America/New_York', gpc = false, stored = null, formspree = null, viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ timezoneId: tz, viewport });
  const posts = [];
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|sibforms|fonts\.g/, r => r.abort());
  await ctx.route(/formspree/, r => formspree === 'abort' ? r.abort() : formspree === 'error'
    ? r.fulfill({ status: 422, contentType: 'application/json', body: '{"errors":[{"message":"bad"}]}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await ctx.route('**/api/e', r => { try { posts.push(JSON.parse(r.request().postData())); } catch (e) { posts.push({ bad: 1 }); } r.fulfill({ status: 204, body: '' }); });
  if (gpc) await ctx.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  if (stored) await ctx.addInitScript(v => { try { localStorage.setItem('sk_consent_v2', v); } catch (e) {} }, stored);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  return { ctx, page, posts, errs };
}
const names = posts => posts.flatMap(p => p.ev.map(e => e.n));
async function go(page, url) {
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.sk && sk.v, null, { timeout: 8000 });
  await page.waitForTimeout(400);
}
const flush = async page => { await page.evaluate(() => sk.flush()); await page.waitForTimeout(250); };

// ---------- consent matrix ----------
console.log('consent matrix');
{ // eea, pending: nothing sent
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/work.html');
  await t.page.mouse.click(200, 200); await flush(t.page);
  ok(t.posts.length === 0, 'eea pending: no /api/e calls');
  ok(await t.page.evaluate(() => sk.consent) === 'pending', 'eea pending: sk.consent is pending');
  ok(await t.page.locator('#sk-consent').count() === 1, 'eea: opt-in banner shown');
  ok(await t.page.evaluate(() => !localStorage.getItem('sk_vid') && !sessionStorage.getItem('sk_sid')), 'eea pending: no visitor or session id');
  const dl = await t.page.evaluate(() => (dataLayer || []).filter(x => x && x.event && /^(page_leave|ui_click|nav_click|project_open)$/.test(x.event)).length);
  ok(dl === 0, 'eea pending: nothing pushed to dataLayer as events');
  await t.page.locator('#sk-consent .sk-c-p').click(); await flush(t.page);
  ok(await t.page.evaluate(() => sk.consent) === 'granted', 'eea accept: granted');
  ok(t.posts.length >= 1 && names(t.posts).includes('page_view'), 'eea accept: queued page_view flushed');
  ok(names(t.posts).includes('consent_choice'), 'eea accept: consent_choice sent');
  ok(/^[0-9a-f]{16}$/.test(t.posts[0].vid) && /^[0-9a-f]{16}$/.test(t.posts[0].sid) && /^[0-9a-f]{16}$/.test(t.posts[0].pid), 'ids are 16 hex');
  // reopen and decline
  await t.page.locator('[data-consent-open]').first().click();
  ok(await t.page.locator('#sk-consent').count() === 1, 'reopen: choice shown');
  const before = t.posts.length;
  await t.page.locator('#sk-consent .sk-c-s').click();
  await t.page.mouse.click(300, 300); await flush(t.page);
  ok(await t.page.evaluate(() => sk.consent) === 'denied', 'reopen decline: denied');
  ok(t.posts.length === before, 'decline: no more /api/e calls');
  ok(await t.page.evaluate(() => !localStorage.getItem('sk_vid') && !sessionStorage.getItem('sk_sid')), 'decline: ids removed');
  await t.ctx.close();
}
{ // eea decline from start
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/contact.html');
  await t.page.locator('#sk-consent .sk-c-s').click(); await t.page.mouse.click(100, 100); await flush(t.page);
  ok(t.posts.length === 0, 'eea decline: zero calls'); await t.ctx.close();
}
{ // other: on by default with notice
  const t = await mk({}); await go(t.page, '/work.html'); await t.page.mouse.click(200, 300); await flush(t.page);
  ok(await t.page.evaluate(() => sk.consent) === 'granted', 'other: granted by default');
  ok(names(t.posts).includes('page_view') && names(t.posts).includes('ui_click'), 'other: events sent without a click on the notice');
  ok(names(t.posts).includes('consent_shown'), 'other: consent_shown recorded');
  ok(await t.page.locator('#sk-consent').count() === 1, 'other: notice shown');
  const before = t.posts.length;
  await t.page.locator('#sk-consent .sk-c-s').click(); await t.page.mouse.click(400, 300); await flush(t.page);
  ok(await t.page.evaluate(() => sk.consent) === 'denied' && t.posts.length === before, 'other: opt out stops sending');
  await t.page.reload(); await t.page.waitForTimeout(800);
  ok(await t.page.evaluate(() => sk.consent) === 'denied' && await t.page.locator('#sk-consent').count() === 0, 'returning: opt-out remembered, no banner');
  await t.ctx.close();
}
{ // GPC
  const t = await mk({ gpc: true }); await go(t.page, '/work.html'); await t.page.mouse.click(200, 300); await flush(t.page);
  ok(await t.page.evaluate(() => sk.consent) === 'denied' && t.posts.length === 0, 'GPC: counted as declined, zero calls'); await t.ctx.close();
}
{ // returning granted in eea
  const t = await mk({ tz: 'Europe/Rome', stored: 'granted' }); await go(t.page, '/work.html'); await flush(t.page);
  ok(t.posts.length >= 1 && await t.page.locator('#sk-consent').count() === 0, 'returning granted (eea): sends, no banner'); await t.ctx.close();
}
{ // Italian copy
  const t = await mk({ tz: 'Europe/Rome' });
  await t.page.addInitScript(() => localStorage.setItem('sk_lang', 'it'));
  await go(t.page, '/work.html');
  const txt = await t.page.locator('#sk-consent').innerText();
  ok(/Google Analytics/.test(txt) && /Clarity/.test(txt) && /Rifiuta/.test(txt) && /link/.test(txt), 'IT copy names Google Analytics, Clarity and links'); await t.ctx.close();
}

// ---------- URL stripping ----------
console.log('url stripping');
{
  const t = await mk({});
  await go(t.page, '/work.html?utm_source=cv&utm_medium=pdf&sk_l=cv-test&secret=SHOULDNOTLEAK&name=Jane#positioning-share-state-XYZ');
  await t.page.mouse.click(200, 300); await flush(t.page);
  const body = JSON.stringify(t.posts);
  ok(!/SHOULDNOTLEAK|Jane|XYZ|positioning-share/.test(body), 'no query junk or hash in payload');
  ok(t.posts[0].ctx.path === '/work.html' && t.posts[0].ctx.link === 'cv-test' && t.posts[0].ctx.utm.utm_source === 'cv', 'ctx has path only, link and allowed utm');
  await t.page.evaluate(() => sk.track('menu_toggle', { state: 'open' }));
  const dl = await t.page.evaluate(() => JSON.stringify(dataLayer));
  ok(!/SHOULDNOTLEAK|Jane|XYZ/.test(dl), 'no query junk in dataLayer');
  const pl = await t.page.evaluate(() => (dataLayer.find(x => x && x.page_location_clean) || {}).page_location_clean);
  ok(pl && !pl.includes('#') && !/secret|name=/.test(pl) && /utm_source=cv/.test(pl), 'page_location_clean keeps allowlist only');
  await t.page.goto(BASE + '/work.html'); await t.page.waitForTimeout(600);
  const link2 = await t.page.evaluate(() => JSON.parse(sessionStorage.getItem('sk_a') || '{}').l);
  ok(link2 === 'cv-test', 'entry link kept for the visit'); await t.ctx.close();
}

// ---------- double fire ----------
console.log('double fire');
{
  const t = await mk({}); await go(t.page, '/work.html'); t.posts.length = 0;
  const count = (n, f) => names(t.posts).filter(x => x === n).length;
  const evs = (n) => t.posts.flatMap(p => p.ev).filter(e => e.n === n);
  await t.page.evaluate(() => openPanel('cyrano')); await t.page.waitForTimeout(300);
  await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(300);
  await flush(t.page);
  ok(count('project_open') === 1 && count('project_close') === 1, 'open + Escape: one open, one close');
  ok(evs('project_close')[0].p.method === 'escape' && evs('project_open')[0].p.project_id === 'cyrano', 'close method escape, project id');
  t.posts.length = 0;
  await t.page.evaluate(() => openPanel('agora')); await t.page.waitForTimeout(200);
  await t.page.locator('#nextProject').click(); await t.page.waitForTimeout(200);
  await t.page.locator('#prevProject').click(); await t.page.waitForTimeout(200);
  await t.page.locator('#panelClose').click(); await t.page.waitForTimeout(200);
  await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(200);
  await flush(t.page);
  ok(count('project_open') === 1 && count('project_next') === 1 && count('project_prev') === 1 && count('project_close') === 1, 'next, prev, button close, stray Escape: each once');
  ok(evs('project_close')[0].p.method === 'button', 'close method button');
  t.posts.length = 0;
  await t.page.evaluate(() => openPanel('agora')); await t.page.waitForTimeout(200);
  await t.page.locator('#backdrop').click({ position: { x: 10, y: 300 }, force: true }); await t.page.waitForTimeout(200); await flush(t.page);
  ok(count('project_close') === 1 && evs('project_close')[0].p.method === 'backdrop', 'backdrop close once');
  t.posts.length = 0;
  await t.page.locator('.filter-pill[data-filter="design"]').first().click(); await t.page.waitForTimeout(200); await flush(t.page);
  ok(count('filter_apply') === 1 && count('ui_click') === 1, 'filter: one filter_apply, one ui_click');
  t.posts.length = 0;
  await t.page.locator('.lang-toggle [data-l="it"]').first().click(); await t.page.waitForTimeout(200); await flush(t.page);
  ok(count('lang_toggle') === 1 && evs('lang_toggle')[0].p.to === 'it', 'lang toggle once');
  ok(t.errs.length === 0, 'no page errors (' + t.errs.join('|') + ')');
  await t.ctx.close();
}

// ---------- forms ----------
console.log('form outcomes');
for (const [mode, want] of [['ok', 'form_submit_success'], ['error', 'form_submit_failure'], ['abort', 'form_submit_failure']]) {
  const t = await mk({ formspree: mode });
  await go(t.page, '/contact.html');
  await t.page.fill('#fname', 'CANARYFIRST'); await t.page.fill('#lname', 'CANARYLAST'); await t.page.fill('#email', 'canary@example.com');
  await t.page.selectOption('#subject', 'job'); await t.page.fill('#message', 'CANARYMESSAGE hello');
  await t.page.locator('#contactForm button[type=submit]').click(); await t.page.waitForTimeout(800); await flush(t.page);
  const n = names(t.posts);
  ok(n.filter(x => x === want).length === 1, mode + ': exactly one ' + want);
  const other = want === 'form_submit_success' ? 'form_submit_failure' : 'form_submit_success';
  ok(!n.includes(other), mode + ': no ' + other);
  ok(n.filter(x => x === 'form_submit_attempt').length === 1 && n.includes('form_start') && n.includes('form_view'), mode + ': view, start, one attempt');
  ok(!/CANARY|canary@/i.test(JSON.stringify(t.posts)) && !/CANARY/.test(await t.page.evaluate(() => JSON.stringify(dataLayer))), mode + ': typed text never in payload');
  await t.ctx.close();
}
{ // abandon
  const t = await mk({}); await go(t.page, '/contact.html');
  await t.page.fill('#fname', 'x'); await t.page.fill('#email', 'a@b.co');
  await t.page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await t.page.waitForTimeout(500);
  const ab = t.posts.flatMap(p => p.ev).filter(e => e.n === 'form_abandon');
  ok(ab.length === 1 && ab[0].p.form_id === 'contact' && ab[0].p.field === 'email', 'abandon: once, field id only (' + JSON.stringify(ab.map(a => a.p)) + ')');
  await t.ctx.close();
}
{ // invalid -> form_error, no attempt
  const t = await mk({}); await go(t.page, '/contact.html'); t.posts.length = 0;
  await t.page.locator('#contactForm button[type=submit]').click(); await t.page.waitForTimeout(300); await flush(t.page);
  const n = names(t.posts);
  ok(n.includes('form_error') && !n.includes('form_submit_attempt') && !n.includes('form_submit_success'), 'empty submit: form_error, no attempt, no success');
  await t.ctx.close();
}

// ---------- ghost ----------
console.log('ghost');
const allEv = posts => posts.flatMap(p => p.ev);
for (const w of [1440, 1024]) {
  const t = await mk({ viewport: { width: w, height: 800 } });
  await t.page.goto(BASE + '/index.html?haunt=fast', { waitUntil: 'load' });
  await t.page.waitForFunction(() => window.sk && sk.v && window.__haunt, null, { timeout: 8000 });
  await flush(t.page);
  const y0 = await t.page.evaluate(() => scrollY);
  await t.page.waitForFunction(() => window.__haunt.on, null, { timeout: 15000 });
  await t.page.waitForTimeout(700);
  const vis = await t.page.evaluate(() => { const g = document.querySelector('.sk-ghost'); return { on: g.classList.contains('on'), op: getComputedStyle(g).opacity, cap: document.querySelector('.haunt-cap').innerText, mag: getComputedStyle(document.querySelector('.mag-lead') || document.body).opacity, ghostFill: document.querySelector('.sk-ghost path').getAttribute('fill') }; });
  ok(vis.on && +vis.op > 0.9 && /Auto cursor, not you/.test(vis.cap) && /Stop/.test(vis.cap), w + ': green AUTO cursor visible, caption with Stop');
  ok(vis.mag === '0', w + ': visitor cursor hidden while it runs');
  await t.page.screenshot({ path: path.join(ROOT, 'tracking/tests/client/ghost-' + w + '.png') });
  await t.page.waitForFunction(() => !window.__haunt.on, null, { timeout: 60000 });
  const y1 = await t.page.evaluate(() => scrollY);
  ok(y0 === y1, w + ': scrollY unchanged by ghost (' + y0 + ' to ' + y1 + ')');
  await flush(t.page);
  const E = allEv(t.posts), hs = E.find(e => e.n === 'haunt_start'), he = E.find(e => e.n === 'haunt_end');
  ok(!!hs && !!he && he.p.reason === 'done', w + ': haunt_start and haunt_end(done) sent');
  const inside = E.filter(e => hs && he && e.t > hs.t && e.t < he.t && !/^(haunt_|consent_)/.test(e.n) && !/^(page_leave|web_vital|js_error|page_view)$/.test(e.n));
  ok(inside.length === 0, w + ': zero non-haunt events between start and end (' + [...new Set(inside.map(e => e.n))].join(',') + ')');
  ok(E.some(e => e.n === 'haunt_mode'), w + ': haunt_mode sent');
  // takeover by real input
  await t.page.evaluate(() => window.__haunt.start());
  await t.page.waitForFunction(() => window.__haunt.on); await t.page.waitForTimeout(400);
  await t.page.mouse.move(300, 300); await t.page.mouse.move(380, 340);
  await t.page.waitForTimeout(400); await flush(t.page);
  ok(await t.page.evaluate(() => !window.__haunt.on && !document.querySelector('.sk-ghost').classList.contains('on')), w + ': real mouse move hands control back');
  const E2 = allEv(t.posts);
  ok(E2.some(e => e.n === 'haunt_interrupted' && e.p.input === 'mousemove') && E2.some(e => e.n === 'haunt_end' && e.p.reason === 'interrupted'), w + ': haunt_interrupted and haunt_end(interrupted)');
  // stop
  await t.page.evaluate(() => window.__haunt.start());
  await t.page.waitForFunction(() => window.__haunt.on);
  await t.page.locator('.haunt-cap button').click({ force: true }); await t.page.waitForTimeout(400); await flush(t.page);
  ok(allEv(t.posts).some(e => e.n === 'haunt_stop_click') && await t.page.evaluate(() => !__haunt.on), w + ': Stop ends it and logs haunt_stop_click');
  await t.page.waitForTimeout(5000);
  ok(await t.page.evaluate(() => !__haunt.on), w + ': stays off for the rest of the visit');
  ok(!allEv(t.posts).some(e => e.n === 'ui_click' && /haunt|ghost/.test(e.p.track_id || '')), w + ': Stop click not counted as ui_click');
  await t.ctx.close();
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
