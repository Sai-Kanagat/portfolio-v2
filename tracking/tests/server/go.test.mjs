import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer, ROOT, BROWSER_UA, MOBILE_UA } from './harness.mjs';

let srv, db;
const cli = (...args) => execFileSync('node', [path.join(ROOT, 'tools/link/index.mjs'), ...args, '--persist', srv.persist, '--out', path.join(srv.tmp, 'qr')], { encoding: 'utf8', cwd: ROOT });
const ins = (slug, dest, extra = {}) =>
  db.prepare('insert into links (slug,dest,channel,campaign,content_label,app_label,created,retired) values (?,?,?,?,?,?,?,?)').run(slug, dest, slug.split('-')[0], extra.campaign ?? null, extra.content ?? null, extra.app ?? null, Date.now(), extra.retired ?? 0);
const go = (slug, ua = BROWSER_UA, method = 'GET', headers = {}) => srv.req(method, '/go/' + slug, { headers: { 'user-agent': ua, ...headers } });
const clicks = (slug) => db.prepare('select * from link_clicks where slug = ? order by id').all(slug);
const settle = () => new Promise((r) => setTimeout(r, 300));

before(async () => {
  srv = await startServer({ label: 'go' });
  db = srv.db();
});
after(() => srv && srv.stop());

test('link made by the CLI redirects with UTMs and sk_l, and logs one human click', async () => {
  const out = cli('new', 'li-thallo-01', '--dest', 'https://saikanagat.com/thallo/?lang=it', '--campaign', 'thallo-launch', '--content', 'post-01');
  assert.match(out, /created/);
  const r = await go('li-thallo-01', MOBILE_UA, 'GET', { 'cf-ipcountry': 'IT' });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.location);
  assert.equal(u.origin + u.pathname, 'https://saikanagat.com/thallo/');
  assert.equal(u.searchParams.get('lang'), 'it');
  assert.equal(u.searchParams.get('utm_source'), 'li');
  assert.equal(u.searchParams.get('utm_medium'), 'social');
  assert.equal(u.searchParams.get('utm_campaign'), 'thallo-launch');
  assert.equal(u.searchParams.get('utm_content'), 'post-01');
  assert.equal(u.searchParams.get('sk_l'), 'li-thallo-01');
  assert.equal(r.headers['cache-control'], 'no-store');
  await settle();
  const c = clicks('li-thallo-01');
  assert.equal(c.length, 1);
  assert.equal(c[0].is_bot, 0);
  assert.equal(c[0].device, 'mobile');
  assert.equal(c[0].country, 'IT');
  assert.deepEqual(Object.keys(c[0]).sort(), ['country', 'device', 'id', 'is_bot', 'slug', 'ts']);
});

test('bot previews still redirect but are flagged', async () => {
  ins('cv-acme-growth', 'https://saikanagat.com/hire', { app: 'acme-growth' });
  for (const ua of ['LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'Slackbot-LinkExpanding 1.0', 'WhatsApp/2.23', 'facebookexternalhit/1.1', 'Googlebot/2.1', '']) {
    const r = await go('cv-acme-growth', ua);
    assert.equal(r.status, 302, ua);
    assert.ok(r.headers.location.includes('sk_l=cv-acme-growth'));
  }
  assert.equal((await go('cv-acme-growth', BROWSER_UA, 'HEAD')).status, 302);
  await go('cv-acme-growth', BROWSER_UA, 'GET', { 'sec-purpose': 'prefetch;prerender' });
  await go('cv-acme-growth', BROWSER_UA);
  await settle();
  const c = clicks('cv-acme-growth');
  assert.equal(c.length, 9);
  assert.equal(c.filter((x) => x.is_bot === 0).length, 1);
  const loc = new URL((await go('cv-acme-growth')).headers.location);
  assert.equal(loc.searchParams.get('utm_content'), 'acme-growth');
  assert.equal(loc.searchParams.get('utm_source'), 'cv');
});

test('retired links still redirect and are still logged', async () => {
  ins('gh-readme', 'https://saikanagat.com/', { retired: 1 });
  const r = await go('gh-readme');
  assert.equal(r.status, 302);
  assert.ok(r.headers.location.startsWith('https://saikanagat.com/'));
  await settle();
  assert.equal(clicks('gh-readme').length, 1);
  cli('retire', 'li-thallo-01');
  assert.equal(db.prepare("select retired from links where slug = 'li-thallo-01'").get().retired, 1);
  assert.equal((await go('li-thallo-01')).status, 302);
});

test('bad, unknown and malicious slugs go to / and are not logged', async () => {
  const before = db.prepare('select count(*) n from link_clicks').get().n;
  for (const s of ['nope', 'li-does-not-exist', "li-x'%20OR%201=1--", 'li-x%27%3B%20DROP%20TABLE%20links%3B--', 'LI-', 'zz-abc', 'li-' + 'a'.repeat(80), '..%2F..%2Fadmin', 'li-thallo-01%0d%0aSet-Cookie:x=1']) {
    const r = await go(s);
    assert.equal(r.status, 302, s);
    assert.equal(r.headers.location, '/', s);
  }
  await settle();
  assert.equal(db.prepare('select count(*) n from link_clicks').get().n, before);
  assert.equal(db.prepare("select count(*) n from sqlite_master where name = 'links'").get().n, 1);
});

test('open redirect is impossible: tampered destinations fall back to /', async () => {
  const bad = ['https://evil.example/', '//evil.example/x', 'https://saikanagat.com.evil.example/', 'https://evilsaikanagat.com/', 'https://saikanagat.com@evil.example/', 'https://evil.example/?u=saikanagat.com', 'http://saikanagat.com/', 'javascript:alert(1)', 'https://saikanagat.com:8443/', '/\\evil.example', 'https://user:pw@saikanagat.com/'];
  let i = 0;
  for (const d of bad) {
    const slug = 'em-bad-' + i++;
    ins(slug, d);
    const r = await go(slug);
    assert.equal(r.status, 302, d);
    assert.equal(r.headers.location, '/', d);
  }
  ins('em-sub', 'https://studio.saikanagat.com/x');
  assert.ok((await go('em-sub')).headers.location.startsWith('https://studio.saikanagat.com/x?'));
  const r = await srv.req('GET', '/go/em-sub?next=https://evil.example&dest=https://evil.example', { headers: { 'user-agent': BROWSER_UA } });
  assert.ok(r.headers.location.startsWith('https://studio.saikanagat.com/x?'));
});

test('CLI refuses duplicates, foreign destinations, bad channels, person names, in-repo QR', () => {
  const fails = (...a) => assert.throws(() => cli(...a), /error|refusing/i);
  fails('new', 'li-thallo-01', '--dest', 'https://saikanagat.com/');
  fails('new', 'em-evil', '--dest', 'https://evil.example/');
  fails('new', 'zz-thing', '--dest', 'https://saikanagat.com/');
  fails('new', 'cv-john-smith', '--dest', 'https://saikanagat.com/');
  fails('new', 'cv-ok-label', '--dest', 'https://saikanagat.com/', '--app', 'Bad Label');
  assert.throws(() => execFileSync('node', [path.join(ROOT, 'tools/link/index.mjs'), 'new', 'cv-inrepo', '--dest', 'https://saikanagat.com/', '--persist', srv.persist, '--out', path.join(ROOT, 'qr-out')], { encoding: 'utf8', stdio: 'pipe' }), /inside the repo/);
  assert.equal(db.prepare("select count(*) n from links where slug in ('cv-inrepo','cv-john-smith','em-evil')").get().n, 0);
  assert.match(cli('new', 'cv-john-smith', '--dest', 'https://saikanagat.com/', '--allow-name'), /created/);
  const sqli = "li-x'; DROP TABLE links;--";
  fails('new', sqli, '--dest', 'https://saikanagat.com/');
  assert.equal(db.prepare("select count(*) n from sqlite_master where name = 'links'").get().n, 1);
});
