// Client tests: consent matrix, ghost, form outcomes, URL stripping, double fire.
// Run: node tracking/tests/client/run.mjs   (from the worktree root)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pwRequire as require } from '../pw.mjs';
const { chromium } = require('playwright');
import os from 'os';
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-client-shots-'));  // screenshots go to a temp dir, never into tracked files
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
  const gtm = [], third = [];
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|sibforms|fonts\.g/, r => { const u = r.request().url(); if (!/fonts\.g/.test(u)) third.push(u); if (/googletagmanager/.test(u)) gtm.push(u); r.abort(); });
  await ctx.route(/formspree/, r => formspree === 'abort' ? r.abort() : formspree === 'error'
    ? r.fulfill({ status: 422, contentType: 'application/json', body: '{"errors":[{"message":"bad"}]}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await ctx.route('**/api/e', r => { try { posts.push(JSON.parse(r.request().postData())); } catch (e) { posts.push({ bad: 1 }); } r.fulfill({ status: 204, body: '' }); });
  if (gpc) await ctx.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  if (stored) await ctx.addInitScript(v => { try { localStorage.setItem('sk_consent_v2', v); } catch (e) {} }, stored);
  // SK_TRACK_JS=<file> serves that file as js/track.js, to prove a test goes red against an older version
  if (process.env.SK_TRACK_JS) await ctx.route(/\/js\/track\.js/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.SK_TRACK_JS, 'utf8') }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  return { ctx, page, posts, errs, gtm, third };
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
  // the privacy notice can sit over the button in a short window: dismiss it first, as a visitor would
  const ack = t.page.locator('#sk-consent .sk-c-p'); if (await ack.count()) { await ack.first().click(); await t.page.waitForTimeout(400); }
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

// ---------- auto cursor removed ----------
console.log('auto cursor removed');
const allEv = posts => posts.flatMap(p => p.ev);
{
  const t = await mk({ viewport: { width: 1440, height: 800 } });
  await t.page.goto(BASE + '/index.html?haunt=fast', { waitUntil: 'load' });
  await t.page.waitForFunction(() => window.sk && sk.v, null, { timeout: 8000 });
  await t.page.waitForTimeout(6000); await flush(t.page);
  ok(await t.page.evaluate(() => !window.__haunt && !document.querySelector('.sk-ghost')) && !/haunted\.js/.test(await t.page.content()), 'no auto cursor script or element on the home page');
  ok(allEv(t.posts).length > 0 && !allEv(t.posts).some(e => /^haunt_/.test(e.n)), 'an idle visitor produces no haunt events');
  await t.ctx.close();
}
// ---------- GTM loads only when consent is granted ----------
console.log('GTM consent gating');
{ // eea pending and decline: zero Google requests, no gtm script tag
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/work.html'); await t.page.waitForTimeout(800);
  ok(t.gtm.length === 0 && t.third.length === 0, 'eea pending: no googletagmanager or other third-party request ' + t.third.join(' '));
  ok(await t.page.evaluate(() => !document.querySelector('script[src*="googletagmanager"], iframe[src*="googletagmanager"]')), 'eea pending: no gtm script or noscript iframe in the DOM');
  await t.page.locator('#sk-consent .sk-c-s').click(); await t.page.waitForTimeout(600);
  ok(t.gtm.length === 0 && t.third.length === 0, 'eea decline: still zero third-party requests');
  await t.ctx.close();
}
{ // GPC outside the EU
  const t = await mk({ gpc: true }); await go(t.page, '/work.html'); await t.page.waitForTimeout(800);
  ok(t.gtm.length === 0 && t.third.length === 0, 'GPC outside the EU: zero third-party requests');
  await t.ctx.close();
}
{ // eea accept: loads once, after consent update, on a later grant in the same tab
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/work.html');
  await t.page.locator('#sk-consent .sk-c-p').click(); await t.page.waitForTimeout(800);
  ok(t.gtm.length === 1 && /id=GTM-MRGXD7ZC/.test(t.gtm[0]), 'eea accept: GTM-MRGXD7ZC requested exactly once (' + t.gtm.length + ')');
  const order = await t.page.evaluate(() => { const a = [...dataLayer]; const iu = a.findIndex(x => x && x[0] === 'consent' && x[1] === 'update' && x[2] && x[2].analytics_storage === 'granted'); const gs = a.findIndex(x => x && x.event === 'gtm.js'); return [iu, gs]; });
  ok(order[0] >= 0 && order[1] > order[0], 'consent update granted is pushed before gtm.start (' + order + ')');
  await t.page.locator('[data-consent-open]').first().click(); await t.page.locator('#sk-consent .sk-c-p').click().catch(() => {}); await t.page.waitForTimeout(500);
  ok(t.gtm.length === 1, 'accepting again does not load GTM twice');
  await t.ctx.close();
}
{ // returning granted and other region: loads once on page load
  for (const o of [{ tz: 'Europe/Rome', stored: 'granted' }, { tz: 'America/New_York' }]) {
    const t = await mk(o); await go(t.page, '/work.html'); await t.page.waitForTimeout(800);
    ok(t.gtm.length === 1, `${o.stored ? 'returning granted' : 'other region'}: GTM requested once (${t.gtm.length})`);
    await t.ctx.close();
  }
}
{ // storage event: grant in another tab
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/work.html'); await t.page.waitForTimeout(300);
  const p2 = await t.ctx.newPage(); await p2.goto(BASE + '/about.html', { waitUntil: 'load' }); await p2.waitForFunction(() => window.sk && sk.v);
  ok(t.gtm.length === 0, 'two tabs undecided: nothing loaded');
  await p2.locator('#sk-consent .sk-c-p').click(); await t.page.waitForTimeout(1000);
  ok(await t.page.evaluate(() => sk.consent) === 'granted' && t.gtm.length === 2, 'grant in tab 2 reaches tab 1 through the storage event; each tab loads GTM once (' + t.gtm.length + ' requests)');
  await t.ctx.close();
}
{ // old cached page with the inline loader: no second load
  const t = await mk({ tz: 'America/New_York' });
  await t.ctx.route(BASE + '/old.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><script>window.dataLayer=window.dataLayer||[];(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":1,event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","GTM-MRGXD7ZC");</script></head><body><script src="/js/consent.js" defer></script><script src="/js/analytics.js" defer></script></body></html>' }));
  await t.page.goto(BASE + '/old.html', { waitUntil: 'load' }); await t.page.waitForTimeout(1200);
  ok(t.gtm.length === 1, 'old cached page with the inline loader: GTM requested once, not twice (' + t.gtm.length + ')');
  await t.ctx.close();
}
{ // withdrawal: after denied the data layer gets no more events, queue included
  const t = await mk({ tz: 'America/New_York' }); await go(t.page, '/work.html');
  await t.page.evaluate(() => sk.track('ui_click', { track_id: 'x.y' }));
  await t.page.waitForTimeout(300);
  const n0 = await t.page.evaluate(() => dataLayer.length);
  await t.page.locator('[data-consent-open]').first().click(); await t.page.locator('#sk-consent .sk-c-s').click(); await t.page.waitForTimeout(400);
  const n1 = await t.page.evaluate(() => dataLayer.length);
  await t.page.evaluate(() => { sk.demo('d1', 'a', { item: 'x' }); sk.demo('d1', 'b', {}); sk.track('page_leave', {}); }); await t.page.mouse.click(300, 300); await t.page.waitForTimeout(400);
  const post = await t.page.evaluate((n) => dataLayer.slice(n).filter(x => x && x.event && !/^gtm\./.test(x.event)), n1);
  ok(n1 > n0, 'withdrawal: consent update denied is pushed');
  ok(await t.page.evaluate(() => window['ga-disable-G-JX9GMLCE9Z'] === true), 'withdrawal: the Google tag is switched off, so no cookieless ping on close');
  ok(post.length === 0, 'withdrawal: no event reaches the data layer after denied (' + post.map(x => x.event).join(',') + ')');
  const upd = await t.page.evaluate(() => dataLayer.filter(x => x && x[0] === 'consent' && x[1] === 'update').pop()[2].analytics_storage);
  ok(upd === 'denied', 'last consent update is denied');
  await t.ctx.close();
}
{ // queued events from pending are not drained into the data layer unless granted; drain on grant is allowed
  const t = await mk({ tz: 'Europe/Rome' }); await go(t.page, '/work.html');
  await t.page.evaluate(() => { sk.demo('d1', 'a', { item: 'one' }); });
  ok(await t.page.evaluate(() => dataLayer.filter(x => x && x.event === 'demo_action').length) === 0, 'pending: demo_action queued, not in the data layer');
  await t.page.evaluate(() => { window.__lv = true; });
  // drainG is internal: force the consent event with state still pending and check nothing leaks
  await t.page.evaluate(() => window.dispatchEvent(new CustomEvent('sk:consent', { detail: { state: 'pending' } })));
  ok(await t.page.evaluate(() => dataLayer.filter(x => x && x.event === 'demo_action').length) === 0, 'sk:consent while pending drains nothing');
  await t.page.locator('#sk-consent .sk-c-s').click(); await t.page.waitForTimeout(300);
  ok(await t.page.evaluate(() => dataLayer.filter(x => x && x.event === 'demo_action').length) === 0, 'queue dropped on decline');
  await t.ctx.close();
}
{ // key union: a param from one push never leaks into the next in a GTM-like merged model
  const t = await mk({ tz: 'America/New_York' }); await go(t.page, '/work.html');
  await t.page.evaluate(() => { sk.demo('d1', 'pick', { item: 'swatch3', value: 7 }); });
  await t.page.waitForTimeout(300);
  await t.page.evaluate(() => { sk.demo('d1', 'clear', {}); });
  await t.page.waitForTimeout(300);
  const r = await t.page.evaluate(() => {
    const model = {}, seen = [];
    for (const x of dataLayer) { if (!x || typeof x !== 'object' || Array.isArray(x) || 'length' in x && x[0]) continue; Object.assign(model, x); if (x.event === 'demo_action') seen.push({ action: model.action, item: model.item, value: model.value, hasKeyItem: 'item' in x }); }
    return seen;
  });
  ok(r.length === 2 && r[0].item === 'swatch3' && r[0].value === 7, 'first demo_action carries item and value in the merged model');
  ok(r.length === 2 && r[1].item === undefined && r[1].value === undefined && r[1].hasKeyItem === true, 'second demo_action without item: item and value are explicitly undefined (merged model: ' + JSON.stringify(r[1]) + ')');
  await t.ctx.close();
}

// ---------- events emitted after the page is hidden ----------
console.log('events emitted while hidden');
{
  const t = await mk({ tz: 'America/New_York' }); await go(t.page, '/work.html'); await flush(t.page);
  // visibilitychange to hidden first (track.js flushes and marks the page left), then a page handler emits from its own pagehide listener
  await t.page.evaluate(() => {
    window.addEventListener('pagehide', () => sk.demo('late', 'from_pagehide', { item: 'x' }), { once: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await t.page.waitForTimeout(600);
  ok(t.posts.some(p => (p.ev || []).some(e => e.n === 'demo_action' && e.p.action === 'from_pagehide')), 'an event emitted by a pagehide handler after visibilitychange is sent, not stranded in the queue');
  const before = t.posts.length;
  await t.page.evaluate(() => { for (let i = 0; i < 5; i++) sk.demo('late', 'burst' + i, {}); });
  await t.page.waitForTimeout(600);
  const got = t.posts.slice(before).flatMap(p => p.ev || []).filter(e => /^burst/.test(e.p.action || '')).length;
  ok(got === 5, 'five events emitted while hidden all go out at once, none wait for the 5 s timer', { events: got, requests: t.posts.length - before });
  await t.ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
