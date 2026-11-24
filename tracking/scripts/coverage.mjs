// Crawl every page as rendered and list every interactive control, plus a static listener scan.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const root = process.cwd();
const require = createRequire(process.env.PW_FROM || import.meta.url);
const { chromium, devices } = require('playwright');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
// Loopback only, and only git-tracked files resolve.
const tracked = new Set(execSync('git ls-files -z', { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\0').filter(Boolean));
const srv = http.createServer((q, s) => {
  let rel;
  try { rel = decodeURIComponent(new URL(q.url, 'http://127.0.0.1').pathname).replace(/^\/+/, ''); } catch { s.writeHead(400); return s.end(); }
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(q.headers.host || '')) { s.writeHead(403); return s.end(); }
  const hit = [rel, rel.replace(/\/?$/, '/index.html').replace(/^\//, ''), rel + '.html'].find(x => tracked.has(x));
  if (!hit) { s.writeHead(404); return s.end('404'); }
  const f = fs.realpathSync(path.join(root, hit));
  if (!f.startsWith(fs.realpathSync(root) + path.sep)) { s.writeHead(403); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const skip = /^(googled|agency-os)/;
const pages = execSync("git ls-files '*.html'", { encoding: 'utf8' }).trim().split('\n').filter(p => !skip.test(p));
const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,video,audio,canvas,[role=button],[onclick],[data-project],[data-filter],[tabindex]:not([tabindex="-1"])';
const b = await chromium.launch();
const out = { pages: {}, listeners: {} };
for (const [kind, opt] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
  const ctx = await b.newContext(opt);
  // Never reach analytics or any third party that counts visits.
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|formspree|sibforms/, r => r.abort());
  for (const p of pages) {
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    try {
      await pg.goto(`http://127.0.0.1:${port}/${p}`, { waitUntil: 'load', timeout: 30000 });
      await pg.waitForTimeout(1500);
      const c = await pg.evaluate(S => [...document.querySelectorAll(S)].map(e => ({ t: e.tagName.toLowerCase(), id: e.id || '', n: e.getAttribute('name') || '', d: Object.keys(e.dataset).join(','), x: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), h: e.getAttribute('href') || '', tr: e.dataset.track || '' })), SEL);
      (out.pages[p] ||= {})[kind] = { controls: c, errors: errs };
    } catch (e) { (out.pages[p] ||= {})[kind] = { controls: [], errors: ['LOAD ' + e.message.slice(0, 100)] }; }
    await pg.close();
  }
  await ctx.close();
}
await b.close(); srv.close();
const files = execSync("git ls-files '*.html' '*.js'", { encoding: 'utf8' }).trim().split('\n').filter(f => !/^tracking\//.test(f));
for (const f of files) {
  const l = fs.readFileSync(f, 'utf8').split('\n');
  l.forEach((s, i) => { for (const m of s.matchAll(/addEventListener\(\s*['"](\w+)|\.(on(?:click|input|change|submit|key\w+|pointer\w+|drop|paste))\s*=|getUserMedia|\.requestPointerLock|clipboard\.writeText/g)) (out.listeners[f] ||= []).push(`${i + 1}:${m[1] || m[2] || m[0]}`); });
}
fs.writeFileSync('tracking/coverage.json', JSON.stringify(out, null, 1));
let n = 0; for (const [p, v] of Object.entries(out.pages)) { n += v.desktop.controls.length; console.log(p, 'd', v.desktop.controls.length, 'm', v.mobile.controls.length, [...v.desktop.errors, ...v.mobile.errors].slice(0, 2).join(' | ')); }
console.log('controls', n, 'listeners', Object.values(out.listeners).flat().length);
