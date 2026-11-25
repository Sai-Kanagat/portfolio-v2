// Drives every control on Agora, Poster, ROAS, Cortex, Ad Autopsy, Positioning and Hire against a stub window.sk.
// Run: node tracking/tests/tools/tools.test.mjs   (from the repo root)
import fs from 'node:fs';
import { chromium, serve, root, STUB, FAKE_JSPDF, format, compare, CANARY, sleep } from './lib.mjs';
import { pages } from './spec.mjs';

const catalogue = JSON.parse(fs.readFileSync(root + '/tracking/catalogue.json', 'utf8'));
const only = process.argv[2] || '';
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, detail) { if (cond) pass++; else { fail++; fails.push(name + (detail ? ': ' + detail : '')); } console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); }
const notes = [];
const covered = {}; const discovered = {}; const allEvents = {}; const pageErrors = [];

const { srv, port } = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
// nothing leaves this machine: every outside host is refused (fonts, CDNs, analytics). Routes registered below are more specific and win.
await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), r => r.abort());
await ctx.route(/googletagmanager|google-analytics|clarity\.ms|formspree|sibforms/, r => r.abort());
await ctx.route('**/api/e', r => r.fulfill({ status: 204, body: '' }));
await ctx.route(/onrender\.com/, r => r.abort());
try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${port}` }); } catch (e) {}

const SEL = '[data-track],label,a[href],button,input:not([type=hidden]),select,textarea,summary,video,audio,canvas,[role=button],[onclick],[data-project],[data-filter],[tabindex]:not([tabindex="-1"])';

async function open(file, o = {}) {
  const page = await ctx.newPage();
  const T = { page, file, all: [], errors: [], pdfReal: null };
  page.on('pageerror', e => { T.errors.push(e.message); pageErrors.push(file + ': ' + e.message); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  page.on('download', d => d.cancel().catch(() => {}));
  await page.addInitScript(`window.__stubMode=${JSON.stringify(o.stubMode || 'record')};` + STUB);
  if (o.pre) await page.addInitScript(o.pre);
  await page.goto(`http://localhost:${port}/${file}${o.query || ''}`, { waitUntil: 'load' });
  await page.evaluate(() => document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); }, false));
  await sleep(o.settle ?? 400);
  if (o.pdf) {
    await page.waitForFunction(() => !!window.jspdf, null, { timeout: 8000 }).then(() => { T.pdfReal = true; }).catch(async () => { T.pdfReal = false; await page.evaluate(FAKE_JSPDF); });
  }
  (allEvents[file] ||= []);
  return T;
}
async function drain(T) { const evs = await T.page.evaluate(() => window.__ev.slice()); T.all.push(...evs); allEvents[T.file].push(...evs); return evs; }
async function reset(T) { await drain(T); await T.page.evaluate(() => { window.__ev.length = 0; }); }

// Run an action, flush debounces, compare semantic events with the spec for (id, scenario).
async function step(T, id, scenario, fn, o = {}) {
  await reset(T);
  await fn(T.page);
  await sleep(o.wait ?? 120);
  if (!o.noflush) await T.page.evaluate(() => window.TRK && TRK.flush());
  await sleep(o.after ?? 80);
  const evs = await T.page.evaluate(() => window.__ev.slice());
  T.all.push(...evs); allEvents[T.file].push(...evs);
  const f = evs.map(format), sem = f.filter(x => !x.life && !(!o.keepViews && /^(insight_view|white_space_view)$/.test(x.s))).map(x => x.s), life = f.filter(x => x.life).map(x => x.s);
  const spec = pages[T.file].controls[id];
  const exp = o.expect || (spec && spec.emits[scenario]);
  const label = `${T.file} ${id} [${scenario}]`;
  if (!exp) { ok(label, false, 'no expectation in spec'); return { sem, life }; }
  (covered[T.file] ||= new Set()).add(id);
  let msg = compare(exp, sem);
  if (!msg && spec && spec.reason && scenario === 'click' && spec.kind === 'link') {
    if (!life.some(s => s.startsWith('track:demo_end[reason=' + spec.reason))) msg = 'missing demo_end reason=' + spec.reason + ' got ' + life.join('|');
  }
  ok(label, !msg, msg);
  return { sem, life };
}
const click = sel => p => p.locator(sel).first().click();
const byId = id => `[data-track="${id}"]`;
const setRange = (sel, v, times = 3) => p => p.evaluate(([s, v, n]) => { const el = document.querySelector(s); for (let i = 0; i < n; i++) { el.value = String(v + i); el.dispatchEvent(new Event('input', { bubbles: true })); } }, [sel, v, times]);

async function collect(T) {
  const rows = await T.page.evaluate(S => [...document.querySelectorAll(S)].map(e => ({ t: e.tagName.toLowerCase(), tr: e.getAttribute('data-track') || '', id: e.id || '', ex: !!(e.closest('[id^="sk-"],#sk-consent,.sk-consent,.sk-privacy-link') || (e.id || '').startsWith('sk-consent')), nav: !!e.closest('nav.nav, .nav-links, .lang-toggle'), skip: e.getAttribute('href') === '#main', x: (e.textContent || '').trim().slice(0, 25), c: e.className })), SEL);
  (discovered[T.file] ||= []).push(...rows);
}

const png = async T => T.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#ff5a1f'; x.fillRect(0, 0, 320, 400); x.fillStyle = '#111'; x.fillRect(60, 120, 200, 120); x.fillStyle = '#fff'; x.font = '48px sans-serif'; x.fillText('HELLO', 80, 200); return c.toDataURL('image/png').split(',')[1]; });

// ---------------- AGORA ----------------
async function agora() {
  const F = 'demos/agora.html';
  let T = await open(F);
  await step(T, 'agora.go', 'empty', click(byId('agora.go')));
  for (const id of ['pricing', 'policy', 'brand', 'culture']) await step(T, 'agora.preset.' + id, 'click', click(byId('agora.preset.' + id)));
  await step(T, 'agora.seed', 'type', p => p.fill('#seedInput', CANARY(25)));
  await step(T, 'agora.population', 'type', p => p.fill('#popInput', '90'));
  await step(T, 'agora.ticks', 'type', p => p.fill('#ticksInput', '300'));
  await collect(T);
  await reset(T);
  await step(T, 'agora.go', 'custom', click(byId('agora.go')));
  await collect(T);
  await step(T, 'agora.simulate', 'click', click(byId('agora.simulate')), { wait: 30 });
  await step(T, 'agora.skip', 'click', click(byId('agora.skip')), { wait: 30 });
  await collect(T);
  await step(T, 'agora.new_scenario', 'click', click(byId('agora.new_scenario')));
  await step(T, 'agora.preset.pricing', 'click', click(byId('agora.preset.pricing')));
  await step(T, 'agora.go', 'preset', click(byId('agora.go')));
  await step(T, 'agora.back_to_seed', 'click', click(byId('agora.back_to_seed')));
  await step(T, 'agora.home', 'click', click(byId('agora.home')), { });
  await T.page.close();

  T = await open(F);
  await step(T, 'agora.back', 'click', click(byId('agora.back')));
  await T.page.close();

  // full automatic run: counts events to prove nothing is sent per frame
  T = await open(F);
  await T.page.fill('#ticksInput', '60'); await T.page.fill('#seedInput', CANARY(30)); await T.page.evaluate(() => TRK.flush());
  await reset(T);
  await T.page.click(byId('agora.go'));
  await reset(T);
  const t0 = Date.now();
  await T.page.click(byId('agora.simulate'));
  await T.page.waitForFunction(() => !document.getElementById('step4').classList.contains('hidden'), null, { timeout: 30000 }).catch(() => {});
  await sleep(300);
  const evs = await drain(T); await T.page.evaluate(() => { window.__ev.length = 0; });
  const f = evs.map(format), sem = f.filter(x => !x.life).map(x => x.s);
  const expAuto = ['simulate[item=mid]', 'step[item=step3]', ...pages[F].controls['agora.report'].emits.auto];
  const msg = compare(expAuto, sem);
  ok(`${F} agora.report [auto] full run in ${Math.round((Date.now() - t0) / 1000)}s`, !msg, msg);
  (covered[F] ||= new Set()).add('agora.report');
  ok(`${F} no per-frame events (total ${evs.length} for a full run)`, evs.length <= 9, String(evs.length));
  await collect(T);
  await T.page.close();
}

// ---------------- POSTER ----------------
async function poster() {
  const F = 'demos/poster.html';
  let T = await open(F);
  for (const id of ['red-lecture', 'vigilante', 'amber-klein', 'night', 'bauhaus']) await step(T, 'poster.palette.' + id, 'click', click(byId('poster.palette.' + id)));
  await step(T, 'poster.headline', 'type', p => p.fill('#headline', CANARY(25)));
  await step(T, 'poster.kicker', 'type', p => p.fill('#kicker', CANARY(26)));
  await step(T, 'poster.regenerate', 'click', click(byId('poster.regenerate')));
  await step(T, 'poster.regenerate', 'click', click(byId('poster.regenerate')), { expect: ['regenerate[value=2]'] });
  await step(T, 'poster.png', 'click', click(byId('poster.png')));
  await collect(T);
  await step(T, 'poster.back', 'click', click(byId('poster.back')));
  await T.page.close();
}

// ---------------- ROAS ----------------
async function roas() {
  const F = 'demos/roas.html';
  const T = await open(F);
  // debounce proof: rapid input produces nothing before 600 ms and one slider event after
  await reset(T);
  await setRange(byId('roas.slider.spend'), 20000, 6)(T.page);
  await sleep(300);
  const early = (await T.page.evaluate(() => window.__ev.slice())).map(format).filter(x => !x.life);
  ok(`${F} slider debounce: no event inside 300 ms`, early.length === 0, early.map(x => x.s).join('|'));
  await sleep(700);
  await T.page.evaluate(() => { window.__ev.length = 0; });
  const vals = { spend: 25000, cpc: 2.5, cvr: 6, aov: 250, margin: 50 };
  for (const k of Object.keys(vals)) await step(T, 'roas.slider.' + k, 'input', setRange(byId('roas.slider.' + k), vals[k], 3), { noflush: true, wait: 1000 });
  await collect(T);
  await step(T, 'roas.back', 'click', click(byId('roas.back')), { expect: ['re:^tuning_time\\[ms\\]$'] });
  await T.page.close();
}

// ---------------- CORTEX ----------------
async function cortex() {
  const F = 'cortex/index.html';
  let T = await open(F, { settle: 600 });
  const loadEvs = (await T.page.evaluate(() => window.__ev.slice())).map(format).filter(x => !x.life).map(x => x.s);
  ok(`${F} passcode_shown on load`, compare(['passcode_shown'], loadEvs) === null, loadEvs.join('|'));
  await collect(T);
  await step(T, 'cortex.passcode', 'type', p => p.type('#gp', CANARY(4), { delay: 10 }));
  await step(T, 'cortex.passcode', 'enter_wrong', p => p.press('#gp', 'Enter'));
  await step(T, 'cortex.passcode.enter', 'wrong', click(byId('cortex.passcode.enter')));
  await step(T, 'cortex.passcode.enter', 'right', async p => { await p.fill('#gp', '0000'); await p.click(byId('cortex.passcode.enter')); });
  await collect(T);
  for (const k of ['how', 'demo', 'try']) await step(T, 'cortex.nav.' + k, 'click', click(byId('cortex.nav.' + k)));
  await step(T, 'cortex.hero.watch', 'click', click(byId('cortex.hero.watch')));
  for (const k of ['hero', 'litebar_text', 'litebar_cta', 'try_text', 'footer']) await step(T, 'cortex.github.' + k, 'click', p => p.evaluate(s => document.querySelector(s).click(), byId('cortex.github.' + k)));
  await step(T, 'cortex.play', 'click', click(byId('cortex.play')), { wait: 5200 });
  const pdf = Buffer.from('%PDF-1.4 canary', 'utf8');
  await step(T, 'cortex.file', 'change', p => p.setInputFiles('#file', { name: 'CANARY_brandbook.pdf', mimeType: 'application/pdf', buffer: pdf }));
  await step(T, 'cortex.brief', 'type', p => p.fill('#brief', CANARY(25)));
  await collect(T);
  await step(T, 'cortex.runlive', 'unreachable', click(byId('cortex.runlive')), { wait: 1500, expect: ['run_live[item=file]', 're:^backend_unreachable\\[ms\\]$'] });
  await step(T, 'cortex.back', 'click', click(byId('cortex.back')));
  await T.page.close();

  // Enter key path
  T = await open(F, { settle: 600 });
  await step(T, 'cortex.passcode.enter', 'right_enter', async p => { await p.fill('#gp', '0000'); await p.press('#gp', 'Enter'); });
  await T.page.close();

  // mocked backend: 429, 500, ok stream. The real backend is never contacted.
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  for (const mode of ['limit', 'error', 'ok']) {
    T = await open(F, { settle: 400, pre: 'try{sessionStorage.setItem("cortex_ok","1")}catch(e){}' });
    await T.page.route(/onrender\.com/, r => {
      const q = r.request();
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (/uploads/.test(q.url())) return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"upload_id":"u1"}' });
      if (mode === 'limit') return r.fulfill({ status: 429, headers: cors, body: '' });
      if (mode === 'error') return r.fulfill({ status: 500, headers: cors, body: '' });
      const body = 'data: ' + JSON.stringify({ type: 'agent_event', node: 'research_agent', message: 'x' }) + '\n\n' + 'data: ' + JSON.stringify({ type: 'run_finished', package: {}, trace: {} }) + '\n\n';
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
    });
    if (mode === 'ok') await T.page.setInputFiles('#file', { name: 'CANARY_b.pdf', mimeType: 'application/pdf', buffer: pdf });
    await step(T, 'cortex.runlive', mode, click(byId('cortex.runlive')), { wait: 1500 });
    await T.page.close();
  }
}

// ---------------- AD AUTOPSY ----------------
async function adAutopsy() {
  const F = 'ad-autopsy/index.html';
  let T = await open(F, { pdf: true, settle: 800 });
  ok(`${F} jsPDF from cdnjs reachable: ${T.pdfReal}`, true);
  if (!T.pdfReal) notes.push('Ad Autopsy, Positioning, Hire: cdnjs jsPDF was not reachable, so the PDF tests ran against a stub that records the calls; real PDF output was not exercised.');
  // face model state arrives after load (CDN); wait for either result
  const model = await T.page.waitForFunction(() => window.__ev.some(e => e.m === 'model'), null, { timeout: 25000 }).then(() => true).catch(() => false);
  const mev = (await T.page.evaluate(() => window.__ev.filter(e => e.m === 'model'))).map(format).map(x => x.s);
  ok(`${F} model state sent on load (${mev.join(',') || 'none within 25 s'})`, model && /^model:(loaded|failed)\[ms,delegate=CPU\]$/.test(mev[0] || ''), mev.join('|'));
  await collect(T);
  for (const [l, v] of [['heat', 0], ['gaze', 0], ['text', 1], ['face', 0]]) await step(T, 'ad.layer.' + l, 'click', click(byId('ad.layer.' + l)));
  await step(T, 'ad.flick', 'click', click(byId('ad.flick')));
  for (const k of ['none', 'reels', 'stories', 'tiktok', 'linkedin']) await step(T, 'ad.zone.' + k, 'click', click(byId('ad.zone.' + k)));
  for (const k of ['li', 'tt', 'ig']) await step(T, 'ad.feed.' + k, 'click', click(byId('ad.feed.' + k)));
  await step(T, 'ad.brand', 'type', p => p.fill('#brand', CANARY(25)));
  await step(T, 'ad.headline', 'type', p => p.fill('#hl', CANARY(26)));
  await step(T, 'ad.copy', 'type', p => p.fill('#pt', CANARY(27)));
  for (const k of ['ferro', 'vella', 'lumo']) await step(T, 'ad.sample.' + k, 'click', click(byId('ad.sample.' + k)), { wait: 300 });
  const b64 = await png(T); const buf = Buffer.from(b64, 'base64');
  await step(T, 'ad.ab.slot_a', 'change', p => p.selectOption('#abSelA', '1'), { wait: 300 });
  await step(T, 'ad.ab.slot_b', 'change', p => p.selectOption('#abSelB', '2'), { wait: 300 });
  await step(T, 'ad.ab.file_a', 'change', p => p.setInputFiles('#abFileA', { name: 'CANARY_a.png', mimeType: 'image/png', buffer: buf }), { wait: 1200 });
  await step(T, 'ad.ab.file_b', 'change', p => p.setInputFiles('#abFileB', { name: 'CANARY_b.png', mimeType: 'image/png', buffer: buf }), { wait: 1200 });
  await step(T, 'ad.drop', 'chooser', async p => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]); await fc.setFiles({ name: 'CANARY_c.png', mimeType: 'image/png', buffer: buf }); }, { wait: 1500 });
  await step(T, 'ad.file', 'change', p => p.setInputFiles('#file', { name: 'CANARY_d.png', mimeType: 'image/png', buffer: buf }), { wait: 1500 });
  await step(T, 'ad.file', 'drop', p => p.evaluate(b => { const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'CANARY_e.png', { type: 'image/png' })); document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, b64), { wait: 1500 });
  await step(T, 'ad.file', 'paste', p => p.evaluate(b => { const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'CANARY_f.png', { type: 'image/png' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, b64), { wait: 1500 });
  await step(T, 'ad.file', 'notimage', p => p.setInputFiles('#file', { name: 'CANARY_notes.txt', mimeType: 'text/plain', buffer: Buffer.from('CANARY text') }), { expect: ['track:demo_error[code=not_image]'], wait: 400 });
  await step(T, 'ad.pdf', 'click', click(byId('ad.pdf')), { wait: 600 });
  await step(T, 'ad.pdf', 'nolib', async p => { await p.evaluate(() => { window.__j = window.jspdf; window.jspdf = undefined; }); await p.click(byId('ad.pdf')); await p.evaluate(() => { window.jspdf = window.__j; }); });
  await collect(T);
  await step(T, 'ad.back', 'click', click(byId('ad.back')));
  await T.page.close();
}

// ---------------- POSITIONING ----------------
async function positioning() {
  const F = 'positioning/index.html';
  let T = await open(F, { pdf: true, settle: 600 });
  const card = (id, i = 0) => p => p.locator(byId(id)).nth(i);
  await step(T, 'pos.card.us', 'change', p => p.locator(byId('pos.card.us')).nth(1).check());
  await step(T, 'pos.card.name', 'type', p => p.locator(byId('pos.card.name')).first().fill(CANARY(25)));
  await step(T, 'pos.card.price', 'type', p => p.locator(byId('pos.card.price')).first().fill(CANARY(25)));
  await step(T, 'pos.card.headline', 'type', p => p.locator(byId('pos.card.headline')).first().fill(CANARY(25)));
  await step(T, 'pos.card.tagline', 'type', p => p.locator(byId('pos.card.tagline')).first().fill(CANARY(25)));
  await step(T, 'pos.card.scores_toggle', 'click', p => p.locator(byId('pos.card.scores_toggle')).first().click());
  for (const k of ['prem', 'emo', 'spec', 'inno', 'play']) {
    await step(T, 'pos.card.score.' + k, 'input', p => p.evaluate(s => { const el = document.querySelector(s); el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); el.value = '41'; el.dispatchEvent(new Event('input', { bubbles: true })); }, `${byId('pos.card.score.' + k)}`), { wait: 100 });
    await step(T, 'pos.card.reset.' + k, 'click', p => p.evaluate(s => { const b = [...document.querySelectorAll(s)].find(x => !x.hidden); b.click(); }, byId('pos.card.reset.' + k)));
  }
  await step(T, 'pos.card.remove', 'click', p => p.locator(byId('pos.card.remove')).last().click());
  await step(T, 'pos.add', 'click', click(byId('pos.add')));
  await step(T, 'pos.axis_x', 'change', p => p.selectOption('#axx', 'spec'));
  await step(T, 'pos.axis_y', 'change', p => p.selectOption('#axy', 'play'));
  // drag: find a bubble by probing, then drag; nothing may be sent while moving
  await reset(T);
  const box = await T.page.locator('#map').boundingBox();
  let found = false;
  for (let y = box.y + 30; y < box.y + box.height - 40 && !found; y += 16) for (let x = box.x + 30; x < box.x + box.width - 30 && !found; x += 16) {
    await T.page.mouse.move(x, y); await T.page.mouse.down();
    found = await T.page.evaluate(() => document.getElementById('map').classList.contains('drag'));
    if (found) { await T.page.evaluate(() => { window.__ev.length = 0; }); for (let i = 1; i <= 8; i++) await T.page.mouse.move(x + i * 6, y + i * 3); const mid = await T.page.evaluate(() => window.__ev.filter(e => e.m !== 'demo' || e.a[1] !== 'first_interaction').length); ok(`${F} drag sends nothing while moving`, mid === 0, String(mid)); await T.page.mouse.up(); }
    else await T.page.mouse.up();
  }
  ok(`${F} found a bubble to drag`, found);
  await sleep(200);
  { const evs = await T.page.evaluate(() => window.__ev.slice()); T.all.push(...evs); allEvents[F].push(...evs); const sem = evs.map(format).filter(x => !x.life).map(x => x.s); const m = compare(pages[F].controls['pos.map'].emits.drag, sem); ok(`${F} pos.map [drag]`, !m, m); (covered[F] ||= new Set()).add('pos.map'); }
  await step(T, 'pos.png', 'click', click(byId('pos.png')), { wait: 800 });
  await step(T, 'pos.pdf', 'click', click(byId('pos.pdf')), { wait: 1500 });
  await step(T, 'pos.pdf', 'nolib', async p => { await p.evaluate(() => { window.__j = window.jspdf; window.jspdf = undefined; }); await p.click(byId('pos.pdf')); await p.evaluate(() => { window.jspdf = window.__j; }); });
  await step(T, 'pos.share', 'click', click(byId('pos.share')), { wait: 300 });
  (covered[F] ||= new Set()).add('pos.shareurl');
  await step(T, 'pos.copy_statement', 'click', click(byId('pos.copy_statement')));
  for (const k of ['t', 'n', 'c', 'b', 'a']) await step(T, 'pos.statement.' + k, 'type', p => p.fill('#st-' + k, CANARY(25)));
  await step(T, 'pos.statement.t', 'again', p => p.fill('#st-t', CANARY(30)), { expect: [] });
  await T.page.evaluate(() => window.scrollTo(0, 0)); await reset(T);
  for (const k of ['fintech', 'blank', 'coffee']) await step(T, 'pos.sample.' + k, 'click', click(byId('pos.sample.' + k)));
  await collect(T);
  await T.page.waitForFunction(() => location.hash.startsWith('#s='), null, { timeout: 3000 }).catch(() => {});
  const hash = await T.page.evaluate(() => location.hash);
  await step(T, 'pos.back', 'click', click(byId('pos.back')));
  await T.page.close();
  // views fire once each on a fresh page
  T = await open(F, { settle: 600 });
  await step(T, 'views', 'insight', p => p.evaluate(() => document.getElementById('insights').scrollIntoView({ block: 'center' })), { expect: ['insight_view'], wait: 700, keepViews: true });
  await step(T, 'views', 'white', p => p.evaluate(() => document.getElementById('g-none').scrollIntoView({ block: 'center' })), { expect: ['white_space_view'], wait: 700, keepViews: true });
  await step(T, 'views', 'once', p => p.evaluate(() => { document.getElementById('insights').scrollIntoView({ block: 'center' }); }), { expect: [], wait: 600, keepViews: true });
  await T.page.close();
  // opened from a share link: the hash carries the state and must not be sent
  T = await open(F, { query: hash, settle: 600 });
  const ev = (await T.page.evaluate(() => window.__ev.slice())).map(format).filter(x => !x.life).map(x => x.s);
  ok(`${F} share_open on load from a share link`, compare(['share_open'], ev) === null, ev.join('|'));
  await drain(T);
  await T.page.close();
}

// ---------------- HIRE ----------------
async function hire() {
  const F = 'hire/index.html';
  let T = await open(F, { pdf: true, settle: 600 });
  const chip = (g, k) => byId(`hire.chip.${g}.${k}`);
  await step(T, 'hire.chip.role.brand', 'click', click(chip('role', 'brand')));
  await step(T, 'hire.chip.role.brand', 'again', click(chip('role', 'brand')));
  await step(T, 'hire.chip.role.growth', 'click', click(chip('role', 'growth')), { expect: ['chip[item=role:growth,value=1]', 'sheet_built[item=growth:noco,value=0]'] });
  for (const k of ['pmm', 'content', 'creative', 'other']) await step(T, 'hire.chip.role.' + k, 'click', click(chip('role', k)));
  await step(T, 'hire.chip.role.brand', 'switch', click(chip('role', 'brand')), { expect: ['chip[item=role:brand,value=1]'] });
  for (const k of ['startup', 'scaleup', 'agency', 'corporate', 'luxury']) await step(T, 'hire.chip.company.' + k, 'click', click(chip('company', k)));
  for (const k of ['brand', 'acq', 'conv']) await step(T, 'hire.chip.goal.' + k, 'click', click(chip('goal', k)));
  for (const k of ['organic', 'launch', 'pos', 'meas', 'sys', 'eu']) await step(T, 'hire.chip.goal.' + k, 'click', p => p.evaluate(s => document.querySelector(s).click(), chip('goal', k)));
  await collect(T);
  await step(T, 'hire.pdf', 'click', click(byId('hire.pdf')), { wait: 1500 });
  await step(T, 'hire.pdf', 'nolib', async p => { await p.evaluate(() => { window.__j = window.jspdf; window.jspdf = undefined; }); await p.click(byId('hire.pdf')); await p.evaluate(() => { window.jspdf = window.__j; }); });
  await step(T, 'hire.copy_link', 'click', click(byId('hire.copy_link')), { wait: 300 });
  (covered[F] ||= new Set()).add('hire.share_url');
  for (const k of ['work', 'email', 'contact', 'linkedin']) await step(T, 'hire.sheet.' + k, 'click', click(byId('hire.sheet.' + k)));
  for (const k of ['all_work', 'about', 'linkedin', 'github', 'email']) await step(T, 'hire.foot.' + k, 'click', p => p.evaluate(s => document.querySelector(s).click(), byId('hire.foot.' + k)));
  await step(T, 'hire.reset', 'click', click(byId('hire.reset')));
  await collect(T);
  await T.page.close();

  T = await open(F, { settle: 600 });
  await step(T, 'hire.role_text', 'type', p => p.fill('#roleText', CANARY(25)));
  await T.page.close();

  T = await open(F, { query: '?r=brand&c=startup&g=brand,acq', settle: 600 });
  const ev = (await T.page.evaluate(() => window.__ev.slice())).map(format).filter(x => !x.life).map(x => x.s);
  { const mine = ev.filter(x => x !== 'track:cursor_enabled'); ok(`${F} share_open on load from a share link`, compare(['share_open[item=brand]'], mine) === null, ev.join('|')); }
  await drain(T);
  await T.page.close();
}

// ---------------- failure modes: tracking must never change behaviour ----------------
async function silent() {
  for (const mode of ['throw', 'none']) {
    let T = await open('demos/agora.html', { stubMode: mode });
    await T.page.click('[data-pid="pricing"]');
    const v = await T.page.inputValue('#seedInput');
    await T.page.click(byId('agora.go'));
    const s2 = await T.page.evaluate(() => !document.getElementById('step2').classList.contains('hidden'));
    ok(`agora behaves the same with stub mode ${mode}`, v.length > 20 && s2 && T.errors.length === 0, T.errors.join('|'));
    await T.page.close();
    T = await open('hire/index.html', { stubMode: mode });
    await T.page.click(byId('hire.chip.role.brand'));
    const txt = await T.page.textContent('#sheet');
    ok(`hire behaves the same with stub mode ${mode}`, /Sai Kanagat for/.test(txt) && T.errors.length === 0, T.errors.join('|'));
    await T.page.close();
  }
}

const runners = { agora, poster, roas, cortex, adAutopsy, positioning, hire, silent };
for (const [name, fn] of Object.entries(runners)) {
  if (only && only !== name) continue;
  try { await fn(); } catch (e) { ok('runner ' + name, false, e.stack.split('\n').slice(0, 3).join(' / ')); }
}

if (!only) {
  // ---- coverage: every control found in the DOM is tagged, mapped, and was exercised ----
  for (const F of Object.keys(pages)) {
    const rows = discovered[F] || [];
    const spec = pages[F].controls;
    const untagged = rows.filter(r => !r.tr && !r.ex && !r.nav && !r.skip && !(r.t === 'canvas') && !(r.t === 'input' && false));
    const uniq = [...new Set(untagged.filter(r => !(r.t === 'label' && !r.tr)).map(r => `${r.t}#${r.id}(${r.x}|${r.c})`))];
    ok(`${F} every control has data-track (untagged: ${uniq.join(', ') || 'none'})`, uniq.length === 0);
    const tags = new Set(rows.filter(r => r.tr).map(r => r.tr));
    // site chrome (nav, skip link, footer) carries codemod ids nav.*, page.* and footer.*: generic ui_click and nav_click from track.js, not a tool event
    const unmapped = [...tags].filter(t => !spec[t] && !/^(nav|page|footer)\.[a-z0-9._-]+$/.test(t));
    ok(`${F} every data-track id is in the map (${unmapped.join(', ') || 'all mapped'})`, unmapped.length === 0);
    const unexercised = Object.keys(spec).filter(id => !(covered[F] && covered[F].has(id)));
    ok(`${F} every mapped control was driven (${unexercised.join(', ') || 'all driven'})`, unexercised.length === 0);
    const stale = Object.keys(spec).filter(id => !tags.has(id));
    ok(`${F} every mapped control exists in the DOM (${stale.join(', ') || 'all present'})`, stale.length === 0);
  }
  // ---- static listener scan: every listener maps to a rule ----
  for (const F of Object.keys(pages)) {
    const src = fs.readFileSync(root + '/' + F, 'utf8');
    const noHelper = src.replace(/<script>\s*\/\* Tracking helper[\s\S]*?<\/script>/, '');
    const lines = noHelper.split('\n');
    const hits = [];
    lines.forEach((s, i) => { if (/addEventListener\(\s*['"]|\.on(?:click|input|change|submit|key\w+|pointer\w+|drop|paste)\s*=|getUserMedia|\.requestPointerLock|clipboard\.writeText/.test(s)) hits.push([i + 1, s]); });
    const rules = pages[F].listeners.map(([re, to]) => ({ re: new RegExp(re), to, n: 0 }));
    const orphan = [];
    for (const [ln, s] of hits) { const r = rules.find(x => x.re.test(s)); if (r) r.n++; else orphan.push(ln + ':' + s.trim().slice(0, 70)); }
    ok(`${F} every listener is mapped (${hits.length} found; unmapped: ${orphan.join(' || ') || 'none'})`, orphan.length === 0);
    const dead = rules.filter(r => r.n === 0).map(r => r.re.source.slice(0, 50));
    ok(`${F} no stale listener rules (${dead.join(' || ') || 'none'})`, dead.length === 0);
  }
  // ---- privacy and schema over every event of every run ----
  const catEv = catalogue.events;
  for (const F of Object.keys(allEvents)) {
    const json = JSON.stringify(allEvents[F]);
    ok(`${F} canary strings never reach an event (${allEvents[F].length} events scanned)`, !/CANARY/i.test(json), (json.match(/.{20}CANARY.{20}/i) || [''])[0]);
    const bad = [];
    for (const e of allEvents[F]) {
      if (e.m === 'demo') { const [id, a, p] = e.a; if (id !== pages[F].demo_id) bad.push('demo_id ' + id); if (!/^[a-z0-9_]+$/.test(a)) bad.push('action ' + a); for (const [k, v] of Object.entries(p || {})) { if (!['item', 'bucket', 'value', 'ms'].includes(k)) bad.push('param ' + k); if (typeof v === 'string' && !/^[A-Za-z0-9_:.+\-]{1,40}$/.test(v)) bad.push('value ' + v); if (typeof v !== 'string' && typeof v !== 'number') bad.push('type ' + k); } }
      else if (e.m === 'track') { const [n, p] = e.a; const def = catEv[n]; if (!def) { bad.push('not in catalogue ' + n); continue; } for (const [k, v] of Object.entries(p || {})) { if (!def.params.includes(k) && k !== 'demo_id') bad.push(`${n}.${k}`); if (/^(source|medium|campaign|content|term)$/.test(k)) bad.push('banned ' + k); if (typeof v === 'string' && !/^[A-Za-z0-9_:.+\-]{1,40}$/.test(v)) bad.push('value ' + v); } }
      else if (e.m === 'model') { const [id, st, p] = e.a; if (!['loaded', 'failed'].includes(st)) bad.push('model ' + st); for (const k of Object.keys(p || {})) if (!['ms', 'delegate'].includes(k)) bad.push('model.' + k); }
    }
    ok(`${F} every event fits the catalogue and the value rules (${[...new Set(bad)].join(', ') || 'clean'})`, bad.length === 0);
  }
  ok(`no page errors (${pageErrors.length})`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
}

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
for (const n of notes) console.log('NOTE ' + n);
if (fail) { console.log('FAILURES:\n' + fails.join('\n')); process.exit(1); }
