// Dashboard UI tests. Playwright against a 127.0.0.1 static server, /api/ops mocked.
// Run from the worktree root:  node --test tracking/tests/ops-ui/ops-ui.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, startStatic, openPage, settled, act, hostOk, ROOT, SHOTS } from './harness.mjs';
import { SIDS, HOT_SLUG, HOSTILE } from './mock.mjs';

let srv, browser;
before(async () => { fs.mkdirSync(SHOTS, { recursive: true }); srv = await startStatic(); browser = await chromium.launch(); });
after(async () => { await browser.close(); await srv.close(); });

const VIEWS = [
  ['live', 'Live'], ['where', 'Where from'], ['links', 'Links'], ['pages', 'Pages and time'], ['buttons', 'Buttons'], ['heatmap', 'Heatmap'],
  ['visits', 'Visits'], ['visits/' + SIDS[0], 'One visit'], ['demos', 'Demos'], ['forms', 'Forms'], ['ghost', 'Auto cursor'],
  ['search', 'Search and AI assistants'], ['health', 'Data health'],
];
const EMPTY_TEXT = {
  live: 'No events yet', where: 'No visits in this period', links: 'No tracked links yet', pages: 'No page views in this period', buttons: 'No clicks recorded',
  heatmap: 'No page to map', visits: 'No visits in this period', ['visits/' + SIDS[0]]: 'No visit with this id', demos: 'No demo activity in this period',
  forms: 'No form activity in this period', ghost: 'The auto cursor has not run', search: 'No visits in this period', health: 'No event has ever been stored',
};

async function run(hash, o, fn) {
  const { ctx, page, log, store } = await openPage(browser, srv.base, { hash: '#/' + hash, ...o });
  try { return await fn({ page, log, ctx, store }); } finally { await ctx.close(); }
}
const body = (page) => page.evaluate(() => document.getElementById('view').textContent);
const noLeaks = async (page, log) => {
  assert.equal(await page.evaluate(() => window.__pwn), undefined, 'hostile script ran');
  assert.deepEqual(await page.evaluate(() => window.__csp), [], 'CSP violations');
  assert.deepEqual(log.errors, [], 'page errors');
  assert.deepEqual(hostOk(log, srv.base), [], 'requests to other hosts');
  assert.deepEqual(log.hits, [], 'tracking hits to /api/e');
  assert.deepEqual(log.external, [], 'blocked third party requests were attempted');
  const inj = await page.evaluate(() => ({
    imgs: document.querySelectorAll('img').length,
    inlineScripts: [...document.scripts].filter((s) => !s.src).length,
    scripts: document.scripts.length,
    handlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
    svgOnload: document.querySelectorAll('svg[onload]').length,
    badLinks: [...document.querySelectorAll('a[href]')].filter((a) => !/^(#\/|#main$|\/api\/ops\/|blob:)/.test(a.getAttribute('href'))).length,
  }));
  assert.equal(inj.imgs, 0, 'an img element was created from data');
  assert.equal(inj.inlineScripts, 0, 'an inline script exists');
  assert.equal(inj.scripts, 2, 'only qrcode.js and app.js');
  assert.equal(inj.handlers, 0, 'an on* attribute exists');
  assert.equal(inj.badLinks, 0, 'a link points outside the dashboard');
};
const noOverflow = async (page, label) => {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  assert.ok(m.sw <= m.cw + 0 && m.bw <= m.cw, `${label}: horizontal overflow ${JSON.stringify(m)}`);
};

// ------------------------------------------------------------------ source and served HTML
test('source: no innerHTML family, eval, dashes, emoji, tracking or third-party references', () => {
  const dir = path.join(ROOT, 'ops');
  const files = ['index.html', 'ops.css', 'lib.js', 'dom.js', 'views.js', 'app.js'];
  const bad = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /\u2014/, /\u2013/, /\p{Extended_Pictographic}/u, /googletagmanager/i, /track\.js/, /consent\.js/, /clarity/i, /https?:\/\/(?!saikanagat\.com|www\.w3\.org)/, /\bsetAttribute\(\s*['"]style/, /\.srcdoc/];
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of bad) assert.equal(re.test(t), false, `${f} matches ${re}`);
  }
  const v = fs.readFileSync(path.join(dir, 'vendor/qrcode.js'), 'utf8');
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /\beval\s*\(/, /document\.write/, /innerHTML/, /https?:\/\/(?!www\.d-project|www\.opensource|www\.denso|www\.w3\.org|stackoverflow\.com)/]) assert.equal(re.test(v), false, `vendor matches ${re}`);
  assert.ok(/MIT license/.test(v), 'vendored QR code keeps its licence header');
  assert.ok(!/Co-Authored|Generated with/i.test(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('')));
});

test('index.html: CSP meta comes first, noindex, no tracking scripts, no inline script or style', async () => {
  const html = await (await fetch(srv.base + '/ops/')).text();
  const iCsp = html.indexOf('Content-Security-Policy');
  assert.ok(iCsp > 0 && iCsp < html.indexOf('<script') && iCsp < html.indexOf('<link'), 'CSP precedes every script and stylesheet');
  assert.match(html, /default-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|https?:\/\/(?!www\.w3\.org)/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow/);
  assert.doesNotMatch(html, /gtm|googletagmanager|track\.js|consent\.js|clarity|analytics\.js/i);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline scripts');
  assert.doesNotMatch(html, /\sstyle=|<style/i, 'no inline style');
});

// ------------------------------------------------------------------ every view, every state
for (const [hash, h1] of VIEWS) {
  test(`${hash}: full data with hostile strings renders inert at 1280 and 390`, async () => {
    for (const width of [1280, 390]) {
      await run(hash, { hostile: true, width, height: 900 }, async ({ page, log }) => {
        await settled(page);
        assert.equal(await page.locator('h1').first().textContent(), h1);
        assert.equal(await page.locator('#state-err').count(), 0, 'no error state');
        assert.ok((await page.locator('table, .facts, canvas').count()) > 0, 'something rendered');
        await noLeaks(page, log);
        await noOverflow(page, `${hash} ${width}`);
      });
    }
  });

  test(`${hash}: empty state`, async () => {
    await run(hash, { mode: 'empty', width: 390 }, async ({ page, log }) => {
      await settled(page);
      assert.match(await body(page), new RegExp(EMPTY_TEXT[hash]), 'specific empty message');
      assert.equal(await page.locator('#state-err').count(), 0);
      await noLeaks(page, log);
      await noOverflow(page, `${hash} empty`);
    });
  });

  test(`${hash}: error, expired (403, redirect, login page), network, unreadable`, async () => {
    const cases = [['error', /server returned an error[\s\S]*500/i], ['expired403', /login has expired/i], ['expired302', /login has expired/i], ['html', /login has expired/i], ['network', /could not be reached/i], ['garbage', /(answer could not be read|could not be drawn)/i]];
    for (const [mode, re] of cases) {
      await run(hash, { mode, width: 390 }, async ({ page, log }) => {
        await settled(page);
        const t = await body(page);
        assert.match(t, re, `${hash} ${mode}`);
        assert.equal(await page.locator('#state-err[role="alert"]').count(), 1);
        assert.ok((await page.locator('#state-err button').count()) >= 1, 'a recovery button');
        assert.equal(await page.locator('table').count(), 0, 'no stale data beside an error');
        assert.deepEqual(await page.evaluate(() => window.__csp), []);
        await noOverflow(page, `${hash} ${mode}`);
      });
    }
  });

  test(`${hash}: loading state shows while the API is slow, then clears`, async () => {
    await run(hash, { mode: 'full', delay: 700 }, async ({ page, log }) => {
      assert.equal(await page.locator('#state-loading').count(), 1, 'loading box');
      assert.equal(await page.getAttribute('#view', 'aria-busy'), 'true');
      await settled(page);
      assert.equal(await page.locator('#state-loading').count(), 0);
      await noLeaks(page, log);
    });
  });
}

test('expired login: reload button reloads, error state offers no stale tables', async () => {
  await run('where', { mode: 'expired403' }, async ({ page }) => {
    await settled(page);
    const nav = page.waitForNavigation();
    await page.getByRole('button', { name: 'Reload and sign in' }).click();
    await nav;
  });
});

test('origin refusal on a POST is a different message from an expired login', async () => {
  await run('links', { modeFor: (n, m) => (m === 'POST' ? 'originerr' : 'full') }, async ({ page }) => {
    await settled(page);
    await page.fill('#lf-slug', 'li-new-post-01'); await page.fill('#lf-dest', '/work');
    await page.click('#link-form button[type=submit]');
    await page.waitForSelector('#lf-msg.err');
    assert.match(await page.textContent('#lf-msg'), /origin/i);
    assert.doesNotMatch(await page.textContent('#lf-msg'), /expired/i);
  });
});

// ------------------------------------------------------------------ period, scope, parameters
test('period and include controls send only parameters the API supports', async () => {
  await run('where', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(log.api.at(-1).params.get('days'), '7');
    assert.equal(log.api.at(-1).params.get('include'), null, 'owner and test are off by default');
    await act(page, log, () => page.selectOption('#period', '30'));
    assert.equal(log.api.at(-1).params.get('days'), '30');
    await act(page, log, () => page.check('#inc-owner'));
    assert.equal(log.api.at(-1).params.get('include'), 'owner');
    await act(page, log, () => page.check('#inc-test'));
    assert.equal(log.api.at(-1).params.get('include'), 'owner,test');
    assert.match(await body(page), /Owner visits: included/);
    assert.match(await body(page), /Test traffic: included/);
    await act(page, log, () => page.selectOption('#period', 'custom'));
    await act(page, log, () => page.fill('#period-from', '2026-11-01'));
    await act(page, log, () => page.fill('#period-to', '2026-11-03'));
    const p = log.api.at(-1).params;
    assert.equal(p.get('from'), String(Date.UTC(2026, 10, 1)));
    assert.equal(p.get('to'), String(Date.UTC(2026, 10, 4)));
    assert.equal(p.get('days'), null, 'custom dates replace days');
    for (const k of p.keys()) assert.ok(['days', 'from', 'to', 'include'].includes(k), 'unexpected parameter ' + k);
    assert.ok(page.url().includes('days=custom'), 'state is in the hash so a reload keeps it');
  });
});

test('controls the API ignores are disabled and say why', async () => {
  await run('live', {}, async ({ page }) => {
    await settled(page);
    assert.equal(await page.isDisabled('#period'), true);
    assert.match(await page.textContent('#ctl-note'), /last 30 minutes/i);
    assert.doesNotMatch(await body(page), /Data from \d/, 'live does not claim a 7 day range');
  });
  await run('heatmap', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(await page.isDisabled('#inc-owner'), true);
    assert.equal(await page.isDisabled('#inc-test'), false);
    assert.match(await page.textContent('#ctl-note'), /never binned/i);
    await act(page, log, () => page.check('#inc-test'));
    const hm = log.api.filter((a) => a.name === 'heatmap').at(-1).params;
    assert.equal(hm.get('include'), 'test');
  });
  await run('health', {}, async ({ page }) => { await settled(page); assert.equal(await page.isDisabled('#period'), true); });
  await run('visits/' + SIDS[0], {}, async ({ page }) => { await settled(page); assert.equal(await page.isDisabled('#period'), true); assert.equal(await page.isDisabled('#inc-test'), true); });
});

test('period and scope survive moving between views', async () => {
  await run('where', {}, async ({ page, log }) => {
    await settled(page);
    await act(page, log, () => page.selectOption('#period', '90'));
    await act(page, log, () => page.check('#inc-test'));
    await act(page, log, () => page.click('#nav >> text=Pages and time'));
    const p = log.api.filter((a) => a.name === 'pages').at(-1).params;
    assert.equal(p.get('days'), '90'); assert.equal(p.get('include'), 'test');
    assert.equal(await page.isChecked('#inc-test'), true);
  });
});

// ------------------------------------------------------------------ rates and sample size
test('rates carry counts and sample size, and are marked under 20', async () => {
  await run('pages', {}, async ({ page }) => {
    await settled(page);
    const rows = await page.$$eval('#pages-table tbody tr', (trs) => trs.map((tr) => ({ path: tr.cells[0].textContent, leaves: tr.cells[3].textContent, vis: tr.cells[4].textContent })));
    const work = rows.find((r) => r.path.startsWith('/work'));
    assert.match(work.vis, /n=5/); assert.match(work.vis, /n under 20/);
    const home = rows.find((r) => r.path.startsWith('/ ') || r.path.startsWith('/c'));
    assert.match(home.vis, /n=120/); assert.doesNotMatch(home.vis, /n under 20/);
    const edge19 = rows.find((r) => r.leaves === '19'); assert.match(edge19.vis, /n under 20/, 'n=19 marked');
    const edge20 = rows.find((r) => r.leaves === '20'); assert.doesNotMatch(edge20.vis, /n under 20/, 'n=20 not marked');
    const none = rows.find((r) => r.leaves === '0'); assert.match(none.vis, /n\/a/); assert.match(none.vis, /no sample/);
  });
  await run('demos', {}, async ({ page }) => {
    await settled(page);
    const t = await page.textContent('#demos-table');
    assert.match(t, /75%\s*30 of 40/); assert.match(t, /n under 20/);
    assert.match(await body(page), /Every step counts visits \(sessions\), not events/);
    assert.match(await body(page), /10 seconds and 60 seconds of active time/);
  });
  await run('where', {}, async ({ page }) => {
    await settled(page);
    assert.match(await page.textContent('#where-channels'), /40 of 120/);
  });
});

// ------------------------------------------------------------------ CSV
test('CSV per table: formulas neutralised, sample size columns present, full strings kept', async () => {
  await run('buttons', { hostile: true }, async ({ page }) => {
    await settled(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV: Controls/ }).click()]);
    assert.match(dl.suggestedFilename(), /^buttons-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split('\r\n');
    assert.match(lines[0], /^Control,Zone,Page,Clicks,Visitors,Visits that clicked,Page visits,Click rate,click_rate_sample_n,Clicks per visit,per_visit_sample_n,Last click$/);
    assert.ok(csv.includes("'=HYPERLINK"), 'formula neutralised');
    assert.ok(!/(^|,)=HYPERLINK/.test(csv), 'no raw formula cell');
    assert.ok(!/(^|,)@SUM/.test(csv));
  });
  await run('links', { hostile: true }, async ({ page }) => {
    await settled(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV: Tracked links/ }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(csv.includes('A'.repeat(5000)), 'long values are exported whole');
    assert.ok(csv.includes('rate_sample_n'));
    assert.ok(!/(^|,)=HYPERLINK/.test(csv));
  });
  await run('demos', {}, async ({ page }) => {
    await settled(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV: Every demo and tool, by visits' }).click()]);
    const head = fs.readFileSync(await dl.path(), 'utf8').split('\r\n')[0];
    for (const c of ['started_per_open_pct', 'started_sample_n', 'engaged_10_sample_n', 'engaged_60_sample_n', 'camera_prompts_n', 'dropoff_sample_n']) assert.ok(head.includes(c), c);
  });
});

test('every table with rows has its own CSV button', async () => {
  for (const [hash] of VIEWS) {
    await run(hash, {}, async ({ page }) => {
      await settled(page);
      const tables = await page.locator('table').count();
      const csv = await page.locator('button[aria-label^="Download CSV:"]').count();
      assert.equal(csv, tables, `${hash}: ${tables} tables, ${csv} CSV buttons`);
    });
  }
});

// ------------------------------------------------------------------ sorting, keyboard, focus
test('keyboard: skip link, nav, sortable headers and visible focus', async () => {
  await run('pages', {}, async ({ page }) => {
    await settled(page);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).top), '8px', 'skip link appears on focus');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, w: s.outlineWidth, style: s.outlineStyle }; });
    assert.ok(parseFloat(f.w) >= 2 && f.style !== 'none', 'focus ring visible: ' + JSON.stringify(f));
    const th = page.locator('#pages-table th[data-key="path"] button');
    await th.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('#pages-table th[data-key="path"]', 'aria-sort'), 'ascending');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('#pages-table th[data-key="path"]', 'aria-sort'), 'descending');
    assert.equal(await page.getAttribute('#pages-table', 'tabindex'), null);
    assert.equal(await page.getAttribute('section.section .tw', 'tabindex'), '0', 'scrollable table region is focusable');
    const first = await page.$eval('#pages-table tbody tr td', (td) => td.textContent);
    assert.ok(first.startsWith('/work') || first.startsWith('/about') || first.startsWith('/c') || first.length > 0);
  });
});

test('route change moves focus to the heading; filters do not', async () => {
  await run('where', {}, async ({ page, log }) => {
    await settled(page);
    await act(page, log, () => page.click('#nav >> text=Forms'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'view-title');
    await act(page, log, () => page.selectOption('#period', '30'));
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'view-title');
  });
});

test('unknown view and bad visit ids are handled', async () => {
  await run('nope', {}, async ({ page, log }) => {
    await settled(page);
    assert.match(await body(page), /There is no view called nope/);
    assert.equal(log.api.length, 0, 'no API call for an unknown view');
  });
  await run('visits/zzz', {}, async ({ page, log }) => {
    await settled(page);
    assert.match(await body(page), /Not a visit id/);
    assert.equal(log.api.length, 0, 'bad sid never reaches the API');
  });
  await run('visits/bbbbbbbbbbbbbbbb', {}, async ({ page }) => {
    await settled(page);
    assert.match(await body(page), /No visit with this id/);
  });
});

// ------------------------------------------------------------------ links
test('links: create, warn on a person name, duplicate, invalid, server race, server failure', async () => {
  await run('links', {}, async ({ page, log, store }) => {
    await settled(page);
    const msg = () => page.textContent('#lf-msg');
    const submit = () => page.click('#link-form button[type=submit]');
    // preview follows the slug
    await page.fill('#lf-slug', 'li-demo-two');
    assert.equal(await page.textContent('#lf-preview'), 'https://saikanagat.com/go/li-demo-two');
    // invalid slug, dest, labels never reach the server
    await page.fill('#lf-slug', 'bob'); await page.fill('#lf-dest', '/work'); await submit();
    assert.match(await msg(), /slug must start with/i);
    await page.fill('#lf-slug', 'li-ok-one'); await page.fill('#lf-dest', 'https://evil.example/x'); await submit();
    assert.match(await msg(), /destination must be/i);
    await page.fill('#lf-dest', '//evil.example'); await submit(); assert.match(await msg(), /destination must be/i);
    await page.fill('#lf-dest', '/work'); await page.fill('#lf-campaign', 'Bad Label'); await submit();
    assert.match(await msg(), /campaign must be lowercase/i);
    await page.fill('#lf-campaign', '');
    // duplicate caught in the page
    await page.fill('#lf-slug', HOT_SLUG); await submit();
    assert.match(await msg(), /already exists/i);
    assert.equal(log.posts.length, 0, 'nothing was posted for invalid input or a visible duplicate');
    // server side duplicate (a race): the slug is not in the list but the server says 409
    await page.fill('#lf-slug', 'li-race-01'); await submit();
    await page.waitForFunction(() => /already exists/.test(document.getElementById('lf-msg').textContent) && document.querySelector('#link-form button[type=submit]').disabled === false);
    assert.equal(log.posts.length, 1);
    // server failure
    await page.fill('#lf-slug', 'li-boom-01'); await submit();
    await page.waitForFunction(() => /did not answer as expected/.test(document.getElementById('lf-msg').textContent));
    // success with warnings
    await page.fill('#lf-slug', 'cv-maria-rossi'); await page.fill('#lf-dest', 'https://saikanagat.com/work/'); await page.fill('#lf-campaign', 'spring'); await page.fill('#lf-app', 'acme-growth'); await submit();
    await page.waitForSelector('#lf-msg.ok');
    assert.match(await msg(), /Created cv-maria-rossi\. Short link: https:\/\/saikanagat\.com\/go\/cv-maria-rossi/);
    assert.match(await page.textContent('#lf-warn'), /looks like a person's name/);
    const post = log.posts.at(-1);
    assert.equal(post.name, 'links');
    assert.deepEqual(post.body, { slug: 'cv-maria-rossi', dest: 'https://saikanagat.com/work/', campaign: 'spring', app_label: 'acme-growth' });
    assert.equal(post.origin, srv.base, 'POST carries the same origin the server checks');
    assert.equal(await page.inputValue('#lf-slug'), '', 'form reset');
    // new row listed and its QR opened
    await page.waitForSelector('#links-table tbody tr:has-text("cv-maria-rossi")');
    assert.match(await page.textContent('#qr-panel'), /QR code for cv-maria-rossi/);
    assert.equal(store.links[0].slug, 'cv-maria-rossi');
    // slug is lowercased and trimmed
    await page.fill('#lf-slug', '  LI-Upper-Case  '); await page.fill('#lf-dest', '/'); await submit();
    await page.waitForSelector('#links-table tbody tr:has-text("li-upper-case")');
    assert.equal(log.posts.at(-1).body.slug, 'li-upper-case');
  });
});

test('links: retire needs a second click, cancel backs out, retired link stays listed', async () => {
  await run('links', {}, async ({ page, log }) => {
    await settled(page);
    const row = page.locator('#links-table tbody tr', { hasText: 'qr-poster-one' });
    await row.getByRole('button', { name: 'Retire qr-poster-one' }).click();
    assert.equal(log.posts.length, 0, 'first click does not post');
    await row.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await row.getByRole('button', { name: 'Retire qr-poster-one' }).isVisible(), true);
    await row.getByRole('button', { name: 'Retire qr-poster-one' }).click();
    await row.getByRole('button', { name: 'Confirm retiring qr-poster-one' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('#links-table tbody tr')].some((tr) => /qr-poster-one/.test(tr.textContent) && /retired/.test(tr.cells[5].textContent)));
    assert.deepEqual(log.posts.map((p) => [p.name, p.body.slug]), [['links/retire', 'qr-poster-one']]);
    assert.equal(log.posts[0].origin, srv.base);
    assert.equal(await page.locator('#links-table tbody tr', { hasText: 'qr-poster-one' }).getByRole('button', { name: /Retire qr-poster-one/ }).count(), 0, 'no retire button on a retired link');
    assert.match(await page.textContent('#toast'), /still redirects/);
  });
});

test('links: hostile slug gets no actions, hostile text stays text', async () => {
  await run('links', { hostile: true }, async ({ page, log }) => {
    await settled(page);
    const rows = await page.$$eval('#links-table tbody tr', (trs) => trs.map((tr) => ({ t: tr.cells[0].textContent, actions: tr.querySelectorAll('button').length })));
    const bad = rows.find((r) => r.t.includes('<img'));
    assert.equal(bad.actions, 0, 'invalid slug has no copy, QR or retire');
    assert.match(await body(page), /invalid slug/);
    assert.ok((await body(page)).includes('<img src=x onerror='), 'shown as literal text');
    await noLeaks(page, log);
  });
});

test('links: copy link puts the exact link on the clipboard', async () => {
  await run('links', {}, async ({ page }) => {
    await settled(page);
    await page.getByRole('button', { name: 'Copy link ' + HOT_SLUG }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://saikanagat.com/go/' + HOT_SLUG);
    assert.match(await page.textContent('#toast'), /copied/i);
  });
});

test('links: QR downloaded as SVG is made locally and decodes to the exact link', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await run('links', {}, async ({ page, log, ctx }) => {
    await settled(page);
    await page.getByRole('button', { name: 'Show QR code for ' + HOT_SLUG }).click();
    await page.waitForSelector('#qr-panel svg');
    assert.equal(await page.textContent('[data-role=qr-url]'), 'https://saikanagat.com/go/' + HOT_SLUG);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#qr-download')]);
    assert.equal(dl.suggestedFilename(), HOT_SLUG + '.svg');
    const file = await dl.path();
    const svg = fs.readFileSync(file, 'utf8');
    assert.match(svg, /^<\?xml/); assert.match(svg, /<svg [^>]*viewBox=/); assert.doesNotMatch(svg, /<script|onload|href=/i);
    // rasterise the downloaded file and decode it with zbar
    const rp = await ctx.newPage();
    await rp.setContent('<body style="margin:0;background:#fff">' + svg.replace(/^<\?xml[^>]*>\s*/, '') + '</body>');
    const png = path.join(SHOTS, `qr-${HOT_SLUG}.png`);
    await (await rp.$('svg')).screenshot({ path: png });
    const out = execFileSync('zbarimg', ['--quiet', '--raw', png], { encoding: 'utf8' });
    assert.equal(out.trim(), 'https://saikanagat.com/go/' + HOT_SLUG, 'QR decodes to the exact link');
    // a dark scheme must not change the exported colours
    assert.match(svg, /fill="#ffffff"/); assert.match(svg, /fill="#000000"/);
    assert.deepEqual(hostOk(log, srv.base), []);
  });
  // a longer slug makes a bigger symbol and must also decode
  await run('links', {}, async ({ page, log, ctx, store }) => {
    const slug = 'cv-' + 'verylongcompanyname-'.repeat(2) + 'growth-lead';
    store.links.unshift({ slug, dest: '/work', channel: 'cv', campaign: null, content_label: null, app_label: null, created: Date.now(), retired: 0 });
    await page.reload(); await settled(page);
    await page.getByRole('button', { name: 'Show QR code for ' + slug }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#qr-download')]);
    const svg = fs.readFileSync(await dl.path(), 'utf8');
    const rp = await ctx.newPage();
    await rp.setContent('<body style="margin:0;background:#fff">' + svg.replace(/^<\?xml[^>]*>\s*/, '') + '</body>');
    const png = path.join(SHOTS, 'qr-long.png');
    await (await rp.$('svg')).screenshot({ path: png });
    assert.equal(execFileSync('zbarimg', ['--quiet', '--raw', png], { encoding: 'utf8' }).trim(), 'https://saikanagat.com/go/' + slug);
  });
});

// ------------------------------------------------------------------ visits
test('visits: older visits load, timeline opens from a row, ids come from the hash only when valid', async () => {
  await run('visits', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(await page.locator('#visits-table tbody tr').count(), 50);
    await page.click('#visits-older');
    await page.waitForFunction(() => document.querySelectorAll('#visits-table tbody tr').length === 53);
    assert.equal(await page.isDisabled('#visits-older'), true);
    assert.match(await page.textContent('#visits-older'), /No older visits/);
    const q = log.api.filter((a) => a.name === 'visits').at(-1).params;
    assert.ok(Number(q.get('before')) > 0); assert.equal(q.get('limit'), '50');
    await act(page, log, () => page.locator('#visits-table tbody tr a').first().click());
    assert.equal(await page.locator('h1').textContent(), 'One visit');
    assert.ok((await page.locator('#visit-timeline tbody tr').count()) === 12);
    assert.equal(log.api.at(-1).params.get('sid').length, 16);
    assert.doesNotMatch(await body(page), /vvvvvvvv/, 'the visitor id is not shown');
  });
});

// ------------------------------------------------------------------ heatmap, search, health, ghost specifics
test('heatmap: canvas is drawn, device and kind reach the API, readout works', async () => {
  await run('heatmap', {}, async ({ page, log }) => {
    await settled(page);
    await page.waitForFunction(() => { const c = document.getElementById('hm-canvas'); return c && c.width > 0; });
    const painted = await page.evaluate(() => { const c = document.getElementById('hm-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return seen.size; });
    assert.ok(painted > 4, 'canvas has more than a flat colour: ' + painted);
    const box = await page.locator('#hm-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + 30);
    assert.match(await page.textContent('#hm-read'), /Column \d+ of 50, page height \d+ to \d+ px: /);
    await act(page, log, () => page.selectOption('#hm-device', 'mobile'));
    await act(page, log, () => page.selectOption('#hm-kind', 'tap'));
    const p = log.api.filter((a) => a.name === 'heatmap').at(-1).params;
    assert.equal(p.get('device'), 'mobile'); assert.equal(p.get('kind'), 'tap'); assert.equal(p.get('path'), '/');
    assert.match(await page.getAttribute('#hm-canvas', 'aria-label'), /Heatmap of tap points on \/, mobile/);
    await act(page, log, async () => { await page.fill('#hm-path', '/work'); await page.press('#hm-path', 'Enter'); });
    assert.equal(log.api.filter((a) => a.name === 'heatmap').at(-1).params.get('path'), '/work');
    await page.fill('#hm-path', '/<bad>'); await page.press('#hm-path', 'Enter');
    assert.match(await page.textContent('#toast'), /Not a valid page path/);
  });
  await run('heatmap', { hostile: true }, async ({ page, log }) => {
    await settled(page); await noLeaks(page, log);
  });
});

test('heatmap with fewer than 20 points says so', async () => {
  await run('heatmap', { modeFor: (n) => 'full' }, async ({ page, ctx }) => {
    await ctx.route('**/api/ops/heatmap**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ range: { from: 1, to: 2 }, scope: { owner: false, test: false }, path: '/', device: 'desktop', kind: 'click', cells: [{ x: 3, y: 1, n: 4 }], total: 4 }) }));
    await page.reload(); await settled(page);
    assert.match(await body(page), /Only 4 points/);
  });
});

test('search: says what is not connected, invents nothing, classifies AI and search hosts', async () => {
  await run('search', {}, async ({ page }) => {
    await settled(page);
    const t = await body(page);
    assert.match(t, /Not connected yet: Google Search Console/);
    assert.match(t, /Bing Webmaster Tools/);
    assert.match(t, /No query terms are shown here/);
    assert.match(await page.textContent('#search-ai'), /chatgpt\.com/);
    assert.match(await page.textContent('#search-ai'), /perplexity\.ai/);
    assert.doesNotMatch(await page.textContent('#search-ai'), /google/);
    assert.equal(await page.locator('#search-ai tbody tr').count(), 32, 'every AI referrer is listed, no 25 row cap');
    assert.match(await page.textContent('#search-engines'), /www\.google\.com/);
    assert.match(await page.textContent('#search-engines'), /www\.bing\.com/);
    assert.doesNotMatch(await page.textContent('#search-engines'), /chatgpt/);
    assert.match(await page.textContent('#search-utm'), /chatgpt\.com/);
    assert.match(await page.textContent('#search-utm'), /gemini/);
    assert.match(await page.textContent('#search-summary'), /15/); assert.match(await page.textContent('#search-summary'), /15 of 120/);
    assert.doesNotMatch(await body(page), /top 25 referrer hosts only/i, 'the old 25 row limit text is gone');
    assert.equal(await page.locator('text=/impressions|average position/').count() > 0, true, 'only named as not connected');
    assert.equal(await page.locator('table:has-text("impressions")').count(), 0, 'no table of impressions');
  });
});

test('data health: consent rate is declared not measurable and no rate is shown', async () => {
  await run('health', {}, async ({ page }) => {
    await settled(page);
    const consent = await page.textContent('section[aria-labelledby=consent-h]');
    assert.match(consent, /consent rate is not measurable/i);
    assert.match(consent, /decline send nothing/i);
    assert.doesNotMatch(consent, /\d\s?%/, 'no percentage in the consent block');
    assert.match(await page.textContent('#health-checks'), /warn/); assert.match(await page.textContent('#health-checks'), /fail/);
    const links = await page.$$eval('#raw-list a', (as) => as.map((a) => a.getAttribute('href')));
    assert.equal(links.length, 6); assert.ok(links.every((h) => h.startsWith('/api/ops/csv?table=')));
  });
  await run('health', { modeFor: () => 'empty' }, async ({ page }) => {
    await settled(page);
    assert.match(await body(page), /No event has ever been stored/);
  });
});

test('live: refreshes on its own, keeps old data when a refresh fails', async () => {
  await run('live', {}, async ({ page, log, ctx }) => {
    await settled(page);
    const first = log.api.filter((a) => a.name === 'live').length;
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.waitForFunction((n) => true, first);
    await page.waitForTimeout(300);
    assert.ok(log.api.filter((a) => a.name === 'live').length > first, 'manual refresh calls the API');
    await ctx.route('**/api/ops/live**', (r) => r.abort('failed'));
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.waitForFunction(() => /Refresh failed/.test(document.getElementById('view').textContent));
    assert.ok((await page.locator('table').count()) >= 1, 'previous data still shown');
  });
});

test('buttons: page filter and text filter', async () => {
  await run('buttons', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(await page.locator('#buttons-table tbody tr').count(), 9, '4 clicked controls and 5 known controls with no clicks');
    await act(page, log, () => page.selectOption('#btn-page', '/work'));
    assert.equal(log.api.filter((a) => a.name === 'buttons').at(-1).params.get('path'), '/work');
    assert.equal(await page.locator('#buttons-table tbody tr').count(), 3, 'two clicked and work.project_2 at 0');
    await page.fill('#btn-q', 'project'); assert.equal(await page.locator('#buttons-table tbody tr').count(), 2);
    await page.fill('#btn-q', 'zzz'); assert.match(await body(page), /No control matches that text/);
    assert.match(await body(page), /Every control in the build-time list is shown/);
    assert.doesNotMatch(await body(page), /Only controls clicked at least once appear/);
  });
});

const cellsOf = (page, id, ctl) => page.$$eval(`#${id} tbody tr`, (trs, c) => trs.find((tr) => tr.cells[0].textContent.startsWith(c)).cells.length && [...trs.find((tr) => tr.cells[0].textContent.startsWith(c)).cells].map((x) => x.textContent), ctl);

test('buttons: controls with zero clicks are listed as 0, with the page visits as denominator and the click rate beside it', async () => {
  await run('buttons', {}, async ({ page }) => {
    await settled(page);
    const head = await page.$$eval('#buttons-table thead th', (ths) => ths.map((t) => t.textContent));
    assert.deepEqual(head, ['Control', 'Zone', 'Page', 'Clicks', 'Visitors', 'Visits that clicked', 'Page visits', 'Click rate', 'Clicks per visit', 'Last click']);
    const clicked = await cellsOf(page, 'buttons-table', 'work.project_1');
    assert.deepEqual([clicked[3], clicked[5], clicked[6]], ['4', '3', '40']);
    assert.match(clicked[7], /7\.5%/); assert.match(clicked[7], /3 of 40/); assert.doesNotMatch(clicked[7], /n under 20/, 'denominator 40 is a real sample');
    const zero = await cellsOf(page, 'buttons-table', 'work.project_2');
    assert.deepEqual([zero[3], zero[4], zero[5], zero[6]], ['0', '0', '0', '40'], 'zero clicks shown as 0, not left out');
    assert.match(zero[7], /0%/); assert.match(zero[7], /0 of 40/);
    const about = await cellsOf(page, 'buttons-table', 'about.cv');
    assert.match(about[7], /0 of 12/); assert.match(about[7], /n under 20/, 'a small denominator is marked');
    assert.match(await body(page), /9 controls on 4 pages|holds 9 controls/);
  });
});

test('buttons: device filter reaches buttons and pages, drops controls the crawler never saw on that device, and says so in the scope line', async () => {
  await run('buttons', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(log.api.filter((a) => a.name === 'buttons').at(-1).params.get('device'), null, 'no device sent for all devices');
    assert.ok((await page.locator('#buttons-table tbody tr').allTextContents()).some((t) => t.startsWith('hover.preview')));
    await act(page, log, () => page.selectOption('#btn-device', 'mobile'));
    for (const n of ['buttons', 'pages']) assert.equal(log.api.filter((a) => a.name === n).at(-1).params.get('device'), 'mobile', n);
    const text = await page.locator('#buttons-table tbody tr').allTextContents();
    assert.ok(!text.some((t) => t.startsWith('hover.preview')), 'a desktop-only control is not a zero on mobile');
    assert.ok(text.some((t) => t.startsWith('nav.menu')), 'a mobile control is listed');
    assert.match(await body(page), /Device: mobile only/);
    assert.ok(page.url().includes('device=mobile'), 'the filter is in the address');
    await act(page, log, () => page.click('#nav >> text=Pages and time'));
    assert.equal(log.api.filter((a) => a.name === 'pages').at(-1).params.get('device'), null, 'the filter does not leak into other views');
  });
  await run('buttons?device=phone', {}, async ({ page, log }) => {
    await settled(page);
    assert.equal(log.api.filter((a) => a.name === 'buttons').at(-1).params.get('device'), null, 'an unknown device in the address is never sent');
  });
});

test('device filter on pages, demos and visits: sent when chosen, kept when loading older visits', async () => {
  await run('pages', {}, async ({ page, log }) => {
    await settled(page);
    await act(page, log, () => page.selectOption('#pages-device', 'tablet'));
    assert.equal(log.api.filter((a) => a.name === 'pages').at(-1).params.get('device'), 'tablet');
    assert.match(await body(page), /Device: tablet only/);
  });
  await run('demos', {}, async ({ page, log }) => {
    await settled(page);
    await act(page, log, () => page.selectOption('#demos-device', 'desktop'));
    assert.equal(log.api.filter((a) => a.name === 'demos').at(-1).params.get('device'), 'desktop');
  });
  await run('visits', {}, async ({ page, log }) => {
    await settled(page);
    await act(page, log, () => page.selectOption('#visits-device', 'mobile'));
    assert.equal(log.api.filter((a) => a.name === 'visits').at(-1).params.get('device'), 'mobile');
    await page.click('#visits-older'); await page.waitForFunction(() => document.querySelectorAll('#visits-table tbody tr').length > 50);
    assert.equal(log.api.filter((a) => a.name === 'visits').at(-1).params.get('device'), 'mobile', 'older visits keep the filter');
  });
});

test('buttons: a missing, unreadable or hostile controls list falls back to clicked controls and says so, never an error page', async () => {
  for (const controls of ['missing', 'garbage', 'html']) {
    await run('buttons', { controls }, async ({ page, log }) => {
      await settled(page);
      assert.equal(await page.locator('#state-err').count(), 0, controls);
      assert.equal(await page.locator('#buttons-table tbody tr').count(), 4, controls + ': only clicked controls');
      assert.match(await body(page), /list of known controls could not be read/);
      assert.equal(log.controls, 1);
    });
  }
  await run('buttons', { controls: 'fixture', hostile: true }, async ({ page, log }) => {
    await settled(page);
    const ids = await page.$$eval('#buttons-table tbody tr', (trs) => trs.map((t) => t.cells[0].textContent));
    assert.ok(!ids.some((t) => t.includes('<img') || t.startsWith('bad id')), 'invalid ids in the file are dropped');
    assert.ok(!ids.some((t) => t.startsWith('ok.id')), 'a control on an invalid path is dropped');
    assert.equal(await page.evaluate(() => window.__pwn), undefined);
  });
});

test('buttons: the shipped ops/controls.json loads through the same static route and is merged', async () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops/controls.json'), 'utf8'));
  await run('buttons', { controls: 'real' }, async ({ page, log }) => {
    await settled(page);
    assert.equal(await page.locator('#state-err').count(), 0);
    const rows = await page.locator('#buttons-table tbody tr').count();
    assert.ok(rows >= real.controls.length, `${rows} rows for ${real.controls.length} known controls`);
    assert.match(await body(page), new RegExp(`holds ${real.controls.length.toLocaleString('en-GB')} controls`));
    await noLeaks(page, log);
  });
});

test('demos: the funnel is in visits, never above the step before, with events, model loads and skipped steps beside it', async () => {
  await run('demos', {}, async ({ page, log }) => {
    await settled(page);
    const head = await page.$$eval('#demos-table thead th', (t) => t.map((x) => x.textContent));
    for (const c of ['Visits that opened', 'Started', 'Engaged 10 s', 'Engaged 60 s', 'Skipped steps']) assert.ok(head.includes(c), c);
    assert.ok(!head.includes('Engaged'), 'the merged Engaged column is gone');
    const hands = await cellsOf(page, 'demos-table', 'hands');
    assert.match(hands[3], /75%\s*30 of 40/); assert.match(hands[4], /60%\s*18 of 30/); assert.match(hands[5], /33%\s*6 of 18/);
    for (const tr of await page.$$eval('#demos-table tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent)))) {
      for (const i of [3, 4, 5]) { const m = /(\d+)%/.exec(tr[i]); assert.ok(!m || +m[1] <= 100, 'funnel step above 100%: ' + tr[i]); }
    }
    assert.equal(hands[8], '1', 'skipped steps shown');
    const ev = await page.$$eval('#demos-events tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.replace(/n=.*/, ''))));
    const opened = ev.find((r) => r[0] === 'hands' && r[1] === 'Opened');
    assert.deepEqual([opened[2], opened[3]], ['44', '40'], 'events and visits side by side');
    assert.ok(ev.find((r) => r[0] === 'hands' && r[1] === 'Engaged 60 s'));
    assert.match(await page.textContent('#demos-model'), /gpu 15 loaded/); assert.match(await page.textContent('#demos-model'), /3 of 23|13%/);
    assert.match(await page.textContent('#demo-0-camera'), /Visits/); assert.match(await page.textContent('#demo-0-camera'), /73%\s*22 of 30/);
    const text = await body(page);
    for (const gone of ['not unique visits', 'this API does not return them yet', 'merges the 10 second']) assert.doesNotMatch(text, new RegExp(gone));
  });
});

test('forms: the funnel is in visits, events and skipped steps are separate, and the newsletter box is aggregated', async () => {
  await run('forms', {}, async ({ page }) => {
    await settled(page);
    const contact = await cellsOf(page, 'forms-table', 'contact');
    assert.match(contact[2], /30%\s*24 of 80/); assert.match(contact[3], /42%\s*10 of 24/); assert.match(contact[4], /80%\s*8 of 10/);
    const f = await page.$$eval('#forms-events tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.replace(/n=.*/, ''))));
    const sent = f.find((r) => r[0] === 'contact' && r[1] === 'Tried to send');
    assert.deepEqual([sent[2], sent[3]], ['12', '10'], 'events and visits');
    const nl = await page.$$eval('#newsletter-steps tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent)));
    assert.deepEqual(nl.map((r) => r[0]), ['Floating button shown', 'Floating button clicked', 'Box seen', 'Started typing', 'Invalid address', 'Request sent', 'Request failed', 'Confirmed']);
    const seen = nl.find((r) => r[0] === 'Box seen'); assert.deepEqual([seen[1], seen[2], seen[3]], ['30', '26', '26']);
    const start = nl.find((r) => r[0] === 'Started typing'); assert.match(start[4], /42%\s*11 of 26/);
    assert.match(nl.find((r) => r[0] === 'Invalid address')[4], /not a funnel step/);
    assert.match(await body(page), /Brevo confirmation webhook/);
    assert.ok((await page.locator('#newsletter-pages tbody tr').count()) === 2);
    assert.doesNotMatch(await body(page), /Counts are events\./);
  });
  await run('forms', { mode: 'empty' }, async ({ page }) => { await settled(page); assert.match(await body(page), /No form activity in this period/); });
});

test('where from: visitors note says distinct per channel, and the old summed-per-group text is gone', async () => {
  await run('where', {}, async ({ page }) => {
    await settled(page);
    const t = await body(page);
    assert.match(t, /Visitors are distinct people per channel/); assert.match(t, /counts as AI assistants/);
    assert.doesNotMatch(t, /added up per group/);
  });
});

test('links: says clicks cannot be split by owner or test', async () => {
  await run('links', {}, async ({ page }) => {
    await settled(page);
    assert.match(await body(page), /cannot be split by owner or test and ignore those two switches/);
  });
});

test('live polling: at most once a minute, paused while the tab is hidden, one catch-up when it comes back', async () => {
  await run('live', { clock: true }, async ({ page, log }) => {
    await settled(page);
    const calls = () => log.api.filter((a) => a.name === 'live').length;
    const n0 = calls();
    assert.match(await body(page), /Refreshes every 60 seconds/); assert.doesNotMatch(await body(page), /15 seconds/);
    await page.clock.runFor(15000); await page.waitForTimeout(100); assert.equal(calls(), n0, 'nothing at 15 s');
    await page.clock.runFor(44000); await page.waitForTimeout(100); assert.equal(calls(), n0, 'nothing at 59 s');
    await page.clock.runFor(1500); await page.waitForFunction((n) => true, n0); await page.waitForTimeout(150);
    assert.equal(calls(), n0 + 1, 'one refresh at 60 s');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(10 * 60000); await page.waitForTimeout(150);
    assert.equal(calls(), n0 + 1, 'nothing for ten minutes while hidden');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(250);
    assert.equal(calls(), n0 + 2, 'one catch-up when the tab is shown again');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(250);
    assert.equal(calls(), n0 + 2, 'showing it again at once does not refresh again');
  });
});

test('source: the dashboard has one timer and it cannot run faster than 60 seconds', () => {
  const app = fs.readFileSync(path.join(ROOT, 'ops/app.js'), 'utf8');
  assert.match(app, /MIN_POLL_MS = 60000/); assert.match(app, /Math\.max\(ms, MIN_POLL_MS\)/);
  const timers = ['app.js', 'views.js', 'dom.js', 'lib.js'].flatMap((f) => (fs.readFileSync(path.join(ROOT, 'ops', f), 'utf8').match(/setInterval\(/g) || []).map(() => f));
  assert.deepEqual(timers, ['app.js'], 'setInterval appears once, in ctx.every');
  const views = fs.readFileSync(path.join(ROOT, 'ops/views.js'), 'utf8');
  assert.match(views, /ctx\.every\(refresh, 60000\)/);
  for (const old of ['Only controls clicked at least once appear', 'not unique visits', 'does not return them yet', 'added up per group', 'top 25 referrer hosts only', 'every 15 seconds', 'Counts are events.']) assert.ok(!views.includes(old), 'old limit text still in views.js: ' + old);
});

// ------------------------------------------------------------------ look and contrast
test('contrast: text pairs meet 4.5:1 in light and dark', async () => {
  for (const scheme of ['light', 'dark']) {
    await run('pages', { scheme }, async ({ page }) => {
      await settled(page);
      await page.click('#nav a >> nth=0');
      const res = await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const g = cv.getContext('2d', { willReadFrequently: true });
        const px = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
        const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
        const ratio = (a, b) => { const x = lum(px(a)), y = lum(px(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const cs = (el) => getComputedStyle(el);
        const bg = cs(document.body).backgroundColor;
        const mk = (html, cls) => { const e = document.createElement('div'); e.className = cls; e.textContent = html; document.getElementById('view').appendChild(e); return e; };
        const out = {};
        out.body = ratio(cs(document.body).color, bg);
        out.lede = ratio(cs(document.querySelector('.lede')).color, bg);
        out.link = ratio(cs(document.querySelector('#nav a')).color, bg);
        out.navCurrent = ratio(cs(document.querySelector('#nav a[aria-current]')).color, cs(document.querySelector('#nav a[aria-current]')).backgroundColor);
        out.th = ratio(cs(document.querySelector('th button')).color, cs(document.querySelector('th')).backgroundColor);
        out.hint = ratio(cs(document.querySelector('.hint')).color, bg);
        out.low = ratio(cs(document.querySelector('.low')).color, bg);
        out.tag = ratio(cs(mk('x', 'tag')).color, bg);
        const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = 'x'; document.getElementById('view').appendChild(btn);
        out.primary = ratio(cs(btn).color, cs(btn).backgroundColor);
        const linkInBody = document.createElement('a'); linkInBody.href = '#/live'; linkInBody.textContent = 'x'; document.getElementById('view').appendChild(linkInBody);
        out.inlineLink = ratio(cs(linkInBody).color, bg);
        const panel = document.createElement('div'); panel.className = 'panel'; panel.textContent = 'x'; document.getElementById('view').appendChild(panel);
        out.panel = ratio(cs(panel).color, cs(panel).backgroundColor);
        const toast = document.getElementById('toast'); toast.textContent = 'x';
        out.toast = ratio(cs(toast).color, cs(toast).backgroundColor);
        return out;
      });
      for (const [k, v] of Object.entries(res)) assert.ok(v >= 4.5, `${scheme} ${k} contrast ${v.toFixed(2)} is under 4.5`);
    });
  }
});

test('tokens: only brand colours, no gradient, no backdrop blur, no pill badges above headings', () => {
  const css = fs.readFileSync(path.join(ROOT, 'ops/ops.css'), 'utf8');
  assert.doesNotMatch(css, /gradient|backdrop-filter|#[0-9a-f]{3,8}\b/i, 'only oklch tokens, no gradients or blur');
  assert.doesNotMatch(css, /text-transform:\s*uppercase|letter-spacing/, 'no tracked uppercase labels');
  for (const f of ['Bricolage Grotesque', 'IBM Plex Mono']) assert.ok(css.includes(f));
  assert.doesNotMatch(css, /Inter\b|Geist|Space Grotesk|Instrument Serif/);
  assert.doesNotMatch(css, /border-(top|left):\s*\d+px solid var\(--(accent|pos|neg|warn)/, 'no coloured top or left borders');
  assert.doesNotMatch(css, /(transition|animation):(?!\s*none)/, 'no decorative motion beyond the reduced-motion reset');
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /prefers-color-scheme: dark/);
});

// ------------------------------------------------------------------ screenshots for review
test('screenshots: every view, 390 and 1280, light and dark', async () => {
  const tag = (h) => h.replace(/\//g, '-').replace(new RegExp(SIDS[0]), 'one');
  for (const [hash] of VIEWS) {
    for (const [width, scheme] of [[1280, 'light'], [390, 'light'], [390, 'dark'], [1280, 'dark']]) {
      await run(hash, { width, scheme, height: 900 }, async ({ page, log }) => {
        await settled(page);
        await page.waitForTimeout(150);
        await noOverflow(page, `${hash} ${width} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `ops-${tag(hash)}-${width}-${scheme}.png`), fullPage: true });
        assert.deepEqual(await page.evaluate(() => window.__csp), []);
      });
    }
  }
  for (const mode of ['empty', 'error', 'expired403']) {
    await run('where', { mode, width: 390 }, async ({ page }) => { await settled(page); await page.screenshot({ path: path.join(SHOTS, `ops-where-390-${mode}.png`), fullPage: true }); });
  }
  await run('links', { hostile: true, width: 390 }, async ({ page }) => { await settled(page); await page.screenshot({ path: path.join(SHOTS, 'ops-links-390-hostile.png'), fullPage: true }); });
});

test('no request ever left 127.0.0.1 and nothing was served outside ops, favicon and the API mock', () => {
  const odd = srv.served.filter((p) => !(p.startsWith('/ops/') || p === '/ops' || p === '/favicon.svg'));
  assert.deepEqual(odd, []);
  const files = new Set(srv.served.filter((p) => p.startsWith('/ops/')));
  for (const f of files) assert.ok(['/ops/', '/ops/ops.css', '/ops/app.js', '/ops/lib.js', '/ops/dom.js', '/ops/views.js', '/ops/vendor/qrcode.js', '/ops/controls.json'].includes(f), 'unexpected asset ' + f);
});
