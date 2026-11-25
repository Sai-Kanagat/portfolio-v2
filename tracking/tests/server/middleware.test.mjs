import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

let srv;
before(async () => { srv = await startServer({ label: 'mw' }); });
after(() => srv && srv.stop());

test('production pages.dev host 301s to the canonical origin, path and query kept', async () => {
  const r = await srv.req('GET', '/work?utm_source=cv', { host: 'saikanagat-7yg.pages.dev' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, 'https://saikanagat.com/work?utm_source=cv');
  const p = await srv.req('POST', '/api/e', { host: 'saikanagat-7yg.pages.dev', body: '{}' });
  assert.equal(p.status, 308);
});

test('hash-prefixed previews and branch aliases are never redirected', async () => {
  for (const host of ['abc12345.saikanagat-7yg.pages.dev', 'tracking.saikanagat-7yg.pages.dev', '2b5e5d71.saikanagat-7yg.pages.dev', 'saikanagat.pages.dev', 'evil-saikanagat-7yg.pages.dev']) {
    const r = await srv.req('GET', '/work', { host });
    assert.equal(r.status, 200, host);
  }
  const l = await srv.req('GET', '/work', { host: '127.0.0.1:1' });
  assert.equal(l.status, 200);
});

test('the hyphenated production host is production; lookalikes and previews are not', async () => {
  const prod = await srv.req('GET', '/', { host: 'saikanagat-7yg.pages.dev' });
  assert.equal(prod.status, 301);
  assert.equal(prod.headers.location, 'https://saikanagat.com/');
  const upper = await srv.req('GET', '/work', { host: 'SAIKANAGAT-7YG.PAGES.DEV' });
  assert.equal(upper.status, 301);
});

test('data-cr is eea for EEA, UK, CH and unknown; other elsewhere', async () => {
  const cr = async (country) => {
    const r = await srv.req('GET', '/work', { headers: country === undefined ? {} : { 'cf-ipcountry': country } });
    assert.equal(r.status, 200);
    return /<html[^>]*data-cr="(eea|other)"/.exec(r.text)?.[1];
  };
  for (const c of ['IT', 'DE', 'FR', 'GB', 'CH', 'NO', 'IS', 'T1', 'XX']) assert.equal(await cr(c), 'eea', c);
  for (const c of ['US', 'IN', 'AU', 'JP', 'BR', 'CA']) assert.equal(await cr(c), 'other', c);
  const r = await srv.req('GET', '/work', { headers: { 'cf-ipcountry': 'US' } });
  assert.equal(r.headers['cache-control'], 'private, no-cache');
});

test('the rewritten HTML is otherwise intact; static assets are untouched', async () => {
  const r = await srv.req('GET', '/work', { headers: { 'cf-ipcountry': 'US' } });
  assert.match(r.text, /<title>work<\/title>/);
  assert.match(r.text, /<body>work<\/body>/);
  const css = await srv.req('GET', '/style.css', { headers: { 'cf-ipcountry': 'US' } });
  assert.equal(css.text, 'body{}');
  assert.ok(!css.text.includes('data-cr'));
});

test('404 page keeps status 404 and gets data-cr', async () => {
  const r = await srv.req('GET', '/definitely/not/here', { headers: { 'cf-ipcountry': 'IT' } });
  assert.equal(r.status, 404);
  assert.match(r.text, /<html[^>]*data-cr="eea"/);
  assert.match(r.text, /page_not_found/);
});
