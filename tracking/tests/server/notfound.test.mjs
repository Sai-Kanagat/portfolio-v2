// 404 page in a real browser. Mandated aborts apply; /api/e is mocked; track.js is stubbed
// with a tiny skq drain because the real client is another agent's file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from './harness.mjs';

const require = createRequire('/Users/saikanagat/saikanagat-analytics/tools/package.json');
const { chromium } = require('playwright');
let srv, browser;
before(async () => { srv = await startServer({ label: '404' }); browser = await chromium.launch(); });
after(async () => { browser && (await browser.close()); srv && srv.stop(); });

async function open(width, path = '/no/such/page?x=1#h') {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  for (const pat of ['**/*googletagmanager*/**', '**/*google-analytics*/**', '**/*clarity.ms*/**', '**/*formspree*/**', '**/*sibforms*/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**']) await page.route(pat, (r) => r.abort());
  await page.route('**/api/e', (r) => r.fulfill({ status: 204 }));
  await page.route('**/js/consent.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/js/analytics.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.__tracked=[];window.sk={track:function(n,p){window.__tracked.push([n,p])}};(window.skq||[]).forEach(function(i){try{typeof i[0]==='function'?i[0].apply(null,i.slice(1)):window.sk[i[0]].apply(window.sk,i.slice(1))}catch(e){}});" }));
  const res = await page.goto(srv.base + path);
  return { ctx, page, res };
}

test('404 status, missing path shown, one page_not_found with path only', async () => {
  const { ctx, page, res } = await open(1280);
  assert.equal(res.status(), 404);
  assert.equal(await page.locator('#missing').textContent(), '/no/such/page');
  await page.waitForFunction(() => window.__tracked && window.__tracked.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__tracked), [['page_not_found', { missing_path: '/no/such/page' }]]);
  assert.equal(await page.locator('html').getAttribute('data-cr') !== null, true);
  assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex');
  for (const l of ['notfound.home', 'notfound.work', 'notfound.demos', 'notfound.process', 'notfound.contact']) assert.equal(await page.locator(`[data-track="${l}"]`).count(), 1, l);
  await ctx.close();
});

test('markup injection in the path is shown as text, not executed', async () => {
  const { ctx, page } = await open(1280, '/%3Cimg%20src=x%20onerror=window.__pwned=1%3E');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.match(await page.locator("#missing").textContent(), /%3Cimg/);
  await ctx.close();
});

test('no horizontal scroll at 375 and 1280; no em or en dashes in visible text', async () => {
  for (const w of [375, 1280]) {
    const { ctx, page } = await open(w);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'width ' + w);
    assert.ok(!new RegExp('[\\u2013\\u2014]').test(await page.evaluate(() => document.body.innerText)));
    await ctx.close();
  }
});
