// Static server for ops/ on 127.0.0.1 and a Playwright page factory with /api/ops mocked.
// Third-party hosts are aborted. Any request to another host is recorded and fails the test.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { respond, makeStore } from './mock.mjs';

const require = createRequire('/Users/saikanagat/saikanagat-analytics/tools/package.json');
export const { chromium } = require('playwright');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SHOTS = path.join(os.homedir(), 'saikanagat-analytics', 'shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

export async function startStatic() {
  const served = [];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    served.push(p);
    if (p === '/ops' || p === '/ops/') p = '/ops/index.html';
    const ok = p.startsWith('/ops/') || p === '/favicon.svg';
    const f = path.join(ROOT, p);
    if (!ok || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('nf'); }
    r.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    r.setHeader('Cache-Control', 'no-store');
    r.end(fs.readFileSync(f));
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return { base, served, close: () => new Promise((res) => srv.close(res)) };
}

// mode: full | empty | error | expired403 | expired302 | html | network | slow
// per-endpoint override: modeFor(name) => mode
export async function openPage(browser, base, o = {}) {
  const { hash = '#/live', mode = 'full', hostile = false, width = 1280, height = 900, scheme = 'light', delay = 0, modeFor = null, store = makeStore(hostile) } = o;
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, timezoneId: 'UTC', locale: 'en-GB', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const log = { api: [], external: [], hits: [], posts: [], csp: [], errors: [], consoleErrors: [] };
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|formspree|sibforms/, (r) => { log.external.push(r.request().url()); r.abort(); });
  await ctx.route('**/api/e', (r) => { log.hits.push(r.request().url()); r.fulfill({ status: 204, body: '' }); });
  await ctx.route('**/api/ops/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const name = u.pathname.replace(/^\/api\/ops\//, '');
    const m = modeFor ? modeFor(name, req.method()) : mode;
    log.api.push({ name, method: req.method(), search: u.search, params: u.searchParams, headers: req.headers(), body: req.postData() });
    if (req.method() === 'POST') log.posts.push({ name, body: JSON.parse(req.postData() || '{}'), origin: req.headers().origin });
    if (delay || m === 'slow') await new Promise((res) => setTimeout(res, delay || 800));
    if (m === 'network') return r.abort('failed');
    if (m === 'error') return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'db_unavailable' }) });
    if (m === 'expired403') return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
    if (m === 'originerr') return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'origin' }) });
    if (m === 'expired302') return r.fulfill({ status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' }, body: '' });
    if (m === 'html') return r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Sign in</body></html>' });
    if (m === 'garbage') return r.fulfill({ status: 200, contentType: 'application/json', body: '"just a string"' });
    const out = respond(name, u.searchParams, m === 'slow' ? 'full' : m, store, hostile, req.method(), req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null);
    return r.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  const page = await ctx.newPage();
  ctx.on('request', (rq) => { const u = new URL(rq.url()); if (u.origin !== base && !/^(data|blob):/.test(rq.url())) log.requestsOutside = (log.requestsOutside || []).concat(rq.url()); });
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  await page.goto(base + '/ops/' + hash, { waitUntil: 'load' });
  return { ctx, page, log, store };
}

export async function settled(page, timeout = 8000) {
  await page.waitForFunction(() => document.getElementById('view') && document.getElementById('view').getAttribute('aria-busy') === 'false', null, { timeout });
}

export function hostOk(log, base) {
  return (log.requestsOutside || []).filter((u) => !u.startsWith(base));
}

// Run an action that changes the route, then wait until the new request was made and the view is idle again.
export async function act(page, log, fn, { expectApi = true } = {}) {
  const before = log.api.length;
  await fn();
  if (expectApi) await page.waitForFunction(() => true).then(() => waitCount(log, before));
  await page.waitForTimeout(30);
  await settled(page);
  await page.waitForTimeout(30);
}
async function waitCount(log, before, timeout = 5000) {
  const t0 = Date.now();
  while (log.api.length <= before) {
    if (Date.now() - t0 > timeout) throw new Error('no API request after the action');
    await new Promise((r) => setTimeout(r, 20));
  }
}
