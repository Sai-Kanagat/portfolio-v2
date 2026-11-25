// Coverage crawler and gate.
//   node tracking/scripts/coverage.mjs            crawl every page and rewrite tracking/coverage.json (the checklist)
//   node tracking/scripts/coverage.mjs --check    the gate: fail on any control with no data-track and no map entry,
//                                                 any listener with no map entry, a page missing its tracking head,
//                                                 or a malformed id. Writes nothing. Exit 1 on failure.
//   options: --scope=owned   skip the head check for pages other agents own (media, tools, 404)
//            --json=FILE     write the full result
//            --only=a.html,b.html   crawl only these pages (listeners are always scanned in full)
// Maps live in tracking/maps/*.json (pages.json, media.json, tools.json). A new page runs
// `node tracking/codemod.mjs` first, then this gate.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SCOPE = (args.find((a) => a.startsWith('--scope=')) || '--scope=all').slice(8);
const JSON_OUT = (args.find((a) => a.startsWith('--json=')) || '').slice(7);
const PW = process.env.PW_FROM || (fs.existsSync('/Users/saikanagat/saikanagat-analytics/tools/package.json') ? '/Users/saikanagat/saikanagat-analytics/tools/package.json' : import.meta.url);
const require = createRequire(PW);
const { chromium, devices } = require('playwright');
const codemod = await import(pathToFileURL(path.join(HERE, '..', 'codemod.mjs')).href);

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
// Served and scanned: tracked files plus new files that are not ignored (read-only git). Ignored files (.dev.vars,
// private folders) never resolve. In a plain copy without git, walk the tree and skip dependency and private folders.
function listServed() {
  try { return git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean); } catch { /* not a repo */ }
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => {
    const r = d ? d + '/' + e.name : e.name;
    if (e.isDirectory()) return /^(node_modules|\.git|dist|\.wrangler|syndication|social-kit)$/.test(e.name) ? [] : walk(r);
    return [r];
  });
  return walk('');
}
const served = new Set(listServed());
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  let rel;
  try { rel = decodeURIComponent(new URL(q.url, 'http://127.0.0.1').pathname).replace(/^\/+/, ''); } catch { s.writeHead(400); return s.end(); }
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(q.headers.host || '')) { s.writeHead(403); return s.end(); }
  const hit = [rel, rel.replace(/\/?$/, '/index.html').replace(/^\//, ''), rel + '.html'].find((x) => served.has(x));
  if (!hit) { s.writeHead(404); return s.end('404'); }
  const f = fs.realpathSync(path.join(root, hit));
  if (!f.startsWith(fs.realpathSync(root) + path.sep)) { s.writeHead(403); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// ---------- maps ----------
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'tracking/maps', f), 'utf8')); } catch { return {}; } };
const MAPS = { pages: readJson('pages.json'), media: readJson('media.json'), tools: readJson('tools.json'), elements: readJson('elements.json') };
const mp = MAPS.pages.pages || {};
const selectorsFor = (p) => [
  ...Object.keys((MAPS.pages.common || {}).controls || {}),
  ...Object.keys((mp[p] || {}).controls || {}),
  ...Object.keys((MAPS.media[p] || {}).controls || {}),
  ...Object.keys((MAPS.elements.pages || {})[p] || {}),
];
// Exact entries (media.json controls, elements.json): the selector must match at least one element on the page, and exactly n when n is set.
const exactFor = (p) => ({ ...((MAPS.media[p] || {}).controls || {}), ...((MAPS.elements.pages || {})[p] || {}) });
const statesFor = (p) => (mp[p] || {}).states || [];

// ---------- static listener scan ----------
const SCAN_SKIP = /^(tracking|functions|workers|tools|ops|dist|node_modules|_gtm|migrations|assets|\.wrangler)\/|(^|\/)test-[^/]*$/;
const files = [...served].filter((f) => /\.(html|js)$/.test(f) && !SCAN_SKIP.test(f) && !/^(agency-os-|google[0-9a-f]+\.html)/.test(f)).sort();
const RE = /addEventListener\(\s*['"](\w+)|\.(on(?:click|input|change|submit|key\w+|pointer\w+|drop|paste))\s*=|\s(on(?:click|input|change|submit|key\w+|pointer\w+|drop|paste))\s*=\s*["']|getUserMedia|\.requestPointerLock|clipboard\.writeText/g;
const out = { pages: {}, listeners: {} };
const sites = {};
for (const f of files) {
  const l = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  l.forEach((s, i) => { for (const m of s.matchAll(RE)) (sites[f] ||= []).push({ line: i + 1, type: (m[1] || m[2] || m[3] || m[0]).toLowerCase(), text: s.trim().slice(0, 600) }); });
}
for (const [f, a] of Object.entries(sites)) out.listeners[f] = a.map((x) => `${x.line}:${x.type}`);

if (args.includes('--sites')) { console.log(JSON.stringify(sites, null, 1)); srv.close(); process.exit(0); }

// ---------- crawl ----------
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const allPages = codemod.listPages(root, { all: true }).concat(served.has('404.html') && !codemod.listPages(root, { all: true }).includes('404.html') ? ['404.html'] : []);
const pages = ONLY.length ? allPages.filter((p) => ONLY.includes(p)) : allPages;
const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,video,audio,canvas,[role=button],[role=tab],[role=link],[onclick],[data-project],[data-filter],[data-city],[tabindex]:not([tabindex="-1"])';
const collect = (S) => {
  const [sel, ign] = S;
  const out = [];
  for (const e of document.querySelectorAll(sel)) {
    if (e.__skSeen) continue;
    e.__skSeen = 1;
    let ig = -1;
    for (let i = 0; i < ign.length; i++) { try { if (e.matches(ign[i])) { ig = i; break; } } catch (x) { /* not a valid selector, a free-text key */ } }
    out.push({ t: e.tagName.toLowerCase(), id: e.id || '', n: e.getAttribute('name') || '', x: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), h: e.getAttribute('href') || '', tr: e.getAttribute('data-track') || '', nt: !!e.closest('[data-no-track]'), ig });
  }
  return out;
};
const b = await chromium.launch();
const results = {};
for (const [kind, opt] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
  const ctx = await b.newContext(opt);
  // Nothing leaves the machine: only the loopback server answers. Analytics and form hosts are aborted on purpose.
  await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), (r) => r.abort());
  await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
  for (const p of pages) {
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    const sel = selectorsFor(p);
    let controls = [], pt = '', states = [], selcount = {};
    try {
      await pg.goto(`http://127.0.0.1:${port}/${p}`, { waitUntil: 'load', timeout: 30000 });
      await pg.waitForTimeout(1500);
      pt = await pg.evaluate(() => document.documentElement.getAttribute('data-page-type') || '');
      const count = async () => { const c = await pg.evaluate((keys) => keys.map((k) => { try { return document.querySelectorAll(k).length; } catch (x) { return -1; } }), Object.keys(exactFor(p))); Object.keys(exactFor(p)).forEach((k, i) => { selcount[k] = Math.max(selcount[k] || 0, c[i]); }); };
      controls = (await pg.evaluate(collect, [SEL, sel])).map((c) => ({ ...c, st: 'load' }));
      await count();
      for (const s of statesFor(p)) {
        if (kind === 'mobile' && s.desktop_only) continue;
        try {
          for (const step of s.steps) {
            if (step.click) await pg.locator(step.click).first().click({ timeout: 3000 });
            else if (step.key) await pg.keyboard.press(step.key);
            else if (step.eval) await pg.evaluate(step.eval);
            await pg.waitForTimeout(step.wait || 400);
          }
          const more = (await pg.evaluate(collect, [SEL, sel])).map((c) => ({ ...c, st: s.name }));
          controls.push(...more); states.push(`${s.name}:${more.length}`);
          await count();
        } catch (e) { errs.push(`STATE ${s.name}: ${e.message.split('\n')[0].slice(0, 80)}`); }
      }
    } catch (e) { errs.push('LOAD ' + e.message.slice(0, 100)); }
    (results[p] ||= {})[kind] = { controls, errors: errs, pt, states, selcount };
    (out.pages[p] ||= {})[kind] = { controls: controls.map(({ ig, nt, st, ...c }) => ({ ...c, d: undefined, tr: c.tr })), errors: errs };
    await pg.close();
  }
  await ctx.close();
}
await b.close(); srv.close();

if (!CHECK) {
  fs.writeFileSync(path.join(root, 'tracking/coverage.json'), JSON.stringify(out, null, 1));
  let n = 0;
  for (const [p, v] of Object.entries(out.pages)) { n += v.desktop.controls.length; console.log(p, 'd', v.desktop.controls.length, 'm', v.mobile.controls.length, [...v.desktop.errors, ...v.mobile.errors].slice(0, 2).join(' | ')); }
  console.log('controls', n, 'listeners', Object.values(out.listeners).flat().length);
  process.exit(0);
}

// ---------- the gate ----------
const fails = [], warns = [];
const fail = (m) => fails.push(m);
const NAME = /(^|[^a-z])(sai|kanagat|prathyaksh)([^a-z]|$)|kanagat/i;
const rows = [];
for (const p of pages) {
  let total = 0, tracked = 0, ignored = 0, noTrack = 0, bad = 0, fb = 0;
  const seen = new Set(), unmapped = [], dup = new Set();
  const own = !codemod.OTHER_OWNERS.some((r) => r.test(p));
  for (const kind of ['desktop', 'mobile']) {
    const r = results[p][kind];
    for (const c of r.controls) {
      const key = `${c.t}|${c.id}|${c.x}|${c.h}|${c.tr}|${c.st}`;
      if (kind === 'mobile' && seen.has(key)) continue;
      if (kind === 'desktop') seen.add(key);
      total++;
      if (c.tr) {
        tracked++;
        if (!/^[a-z0-9][a-z0-9._-]{0,59}$/.test(c.tr) || NAME.test(c.tr) || /@|mailto|tel:/.test(c.tr)) { bad++; fail(`${p}: bad data-track id "${c.tr}" (allowed a-z 0-9 . _ -, max 60, no names or addresses)`); }
        if (kind === 'desktop' && c.st === 'load') { if (dup.has(c.tr)) warns.push(`${p}: duplicate data-track "${c.tr}"`); dup.add(c.tr); }
      } else if (c.nt) noTrack++;
      else if (c.ig >= 0) ignored++;
      else { unmapped.push(`${c.st}:${c.t}${c.id ? '#' + c.id : ''} "${c.x.slice(0, 24)}"${c.h ? ' ' + c.h.slice(0, 30) : ''}`); }
    }
  }
  const dsk = results[p].desktop;
  for (const [k, e] of Object.entries(exactFor(p))) {
    const c = Math.max(dsk.selcount[k] ?? 0, results[p].mobile.selcount[k] ?? 0);
    if (!e || (!e.events && !e.ignored)) fail(`${p}: map entry "${k}" needs events or an ignored reason`);
    else if (c < 0) fail(`${p}: map entry "${k}" is not a valid CSS selector`);
    else if (c === 0 && !e.optional) fail(`${p}: stale map entry "${k}" matches nothing on the page`);
    else if (typeof e.n === 'number' && c !== e.n && !(e.optional && c === 0)) fail(`${p}: map entry "${k}" says ${e.n} elements but the page has ${c}`);
  }
  const want = codemod.pageType(p);
  if (own || SCOPE === 'all') {
    if (dsk.pt !== want) fail(`${p}: data-page-type is "${dsk.pt}", expected "${want}"`);
  }
  for (const u of unmapped.slice(0, 8)) fail(`${p}: control with no data-track and no map entry: ${u}`);
  if (unmapped.length > 8) fail(`${p}: ... and ${unmapped.length - 8} more unmapped controls`);
  rows.push({ p, total, tracked, ignored, noTrack, unmapped: unmapped.length, states: dsk.states.join(' '), errs: [...new Set([...dsk.errors, ...results[p].mobile.errors])] });
}

// tracking head: SK_CLARITY_ID, consent.js and analytics.js with ?v, page type, ids on static controls
for (const p of pages) {
  const own = !codemod.OTHER_OWNERS.some((r) => r.test(p));
  if (!own && SCOPE === 'owned') continue;
  const src = fs.readFileSync(path.join(root, p), 'utf8');
  const res = codemod.transform(p, src, codemod.versions(root), { headOnly: false });
  if (res.out !== src) fail(`${p}: codemod would still change this page (run node tracking/codemod.mjs --root <abs> --all)`);
}

// listeners
const entry = (f) => (MAPS.pages.listeners || {})[f] || [];
const helperSites = ((MAPS.tools.helper || {}).sites) || [];
const tl = (f) => (((MAPS.tools.pages || {})[f] || {}).listeners || []).concat(((MAPS.tools.pages || {})[f] ? helperSites : []));
const ml = (f) => (MAPS.media[f] || {}).listeners || [];
let nSites = 0, nMapped = 0;
const by = {};
const mediaHits = {};
for (const [f, a] of Object.entries(sites)) {
  const groups = {};
  for (const s of a) {
    nSites++;
    const mine = entry(f).find((e) => e.type === s.type && (!e.match || new RegExp(e.match).test(s.text)));
    const tools = tl(f).find((e) => new RegExp(e.match).test(s.text));
    const mi = ml(f).findIndex((e) => e.type === s.type && new RegExp(e.match).test(s.text));
    if (mine) { (groups[`${s.type}|${entry(f).indexOf(mine)}`] ||= []).push(s); nMapped++; by.pages = (by.pages || 0) + 1; }
    else if (tools) { nMapped++; by.tools = (by.tools || 0) + 1; }
    else if (mi >= 0) { nMapped++; by.media = (by.media || 0) + 1; (mediaHits[f] ||= {})[mi] = (mediaHits[f][mi] || 0) + 1; }
    else fail(`${f}:${s.line}: listener "${s.type}" has no map entry: ${s.text.slice(0, 80)}`);
  }
  for (const [k, g] of Object.entries(groups)) {
    const e = entry(f)[+k.split('|')[1]];
    if (typeof e.n === 'number' && g.length > e.n) fail(`${f}: ${g.length} "${e.type}" listeners but ${e.n} mapped (new one at line ${g[g.length - 1].line})`);
  }
}
// media.json listeners are exact: each entry names a type and a regex over the source line, and says how many sites it covers.
for (const [f, m] of Object.entries(MAPS.media)) {
  if (f === '_schema') continue;
  if (!served.has(f)) { fail(`media.json lists a page that no longer exists: ${f}`); continue; }
  if (!Array.isArray(m.listeners)) { fail(`media.json ${f}: listeners must be an array of {type, match, n, events|ignored}`); continue; }
  m.listeners.forEach((e, i) => {
    if (!e.type || !e.match || typeof e.n !== 'number' || (!e.events && !e.ignored)) fail(`media.json ${f} listener ${i}: needs type, match, n and events or ignored`);
    const got = (mediaHits[f] || {})[i] || 0;
    if (got !== e.n) fail(`media.json ${f}: entry ${e.type} /${(e.match || '').slice(0, 40)}/ says ${e.n} sites, source has ${got}`);
  });
}
for (const [f, es] of Object.entries(MAPS.pages.listeners || {})) {
  if (!served.has(f)) warns.push(`pages.json lists a listener file that no longer exists: ${f}`);
  for (const e of es) if (!e.events && !e.ignored) fail(`pages.json ${f} ${e.type}: entry needs events or an ignored reason`);
}

// report
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('page', 52) + 'controls tracked ignored no-track UNMAPPED');
let T = [0, 0, 0, 0, 0];
for (const r of rows) {
  console.log(pad(r.p, 52) + [r.total, r.tracked, r.ignored, r.noTrack, r.unmapped].map((n) => String(n).padStart(8)).join(' ') + (r.states ? '  states ' + r.states : ''));
  [r.total, r.tracked, r.ignored, r.noTrack, r.unmapped].forEach((n, i) => (T[i] += n));
  for (const e of r.errs) warns.push(`${r.p}: ${e}`);
}
console.log(pad('TOTAL (' + rows.length + ' pages, desktop plus new-on-mobile)', 52) + T.map((n) => String(n).padStart(8)).join(' '));
console.log(`listeners: ${nSites} sites, ${nMapped} mapped (pages.json ${by.pages || 0}, tools.json ${by.tools || 0}, media.json ${by.media || 0}, matched by type and source text)`);
if (warns.length) { console.log(`\nwarnings (${warns.length}):`); for (const w of warns.slice(0, 40)) console.log('  ' + w); if (warns.length > 40) console.log(`  ... ${warns.length - 40} more`); }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ rows, fails, warns }, null, 1));
if (fails.length) { console.log(`\nGATE FAILED (${fails.length}):`); for (const f of fails.slice(0, 120)) console.log('  ' + f); if (fails.length > 120) console.log(`  ... ${fails.length - 120} more`); process.exit(1); }
console.log('\nGATE PASSED');
