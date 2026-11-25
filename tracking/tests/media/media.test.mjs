// Media demos tracking test. Run from the worktree root:
//   node tracking/tests/media/media.test.mjs
// Stub window.sk records every call. /js/*.js is fulfilled empty so other agents' edits cannot interfere.
// Camera and mic are Chromium fake devices (granted) or overridden getUserMedia (denied, dismissed, notfound, none).
// Hand tracking and the hand model CDN files are replaced by fakes, so recognition is injected, not real.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pwRequire as require } from '../pw.mjs';
const { chromium } = require('playwright');
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(root, p);
  if (f !== root && !f.startsWith(root + path.sep)) { s.writeHead(403); return s.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end('404'); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://localhost:${srv.address().port}`;
const REAL = process.env.REAL_CDN === '1';
let pass = 0, fail = 0; const out = [];
const ok = (c, m) => { if (c) pass++; else { fail++; out.push('FAIL ' + m); } };

const STUB = `(()=>{window.__c=[];const R=(k,a)=>{window.__c.push([k,...a])};
window.sk={consent:'granted',demo:(...a)=>R('demo',a),track:(...a)=>R('track',a),media:(...a)=>R('media',a),model:(...a)=>R('model',a)};})();`;
const GUM = m => `(()=>{const m='${m}';if(m==='granted')return;
if(m==='none'){Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true});return;}
const err=m==='denied'?['NotAllowedError','Permission denied']:m==='dismissed'?['NotAllowedError','Permission dismissed']:m==='busy'?['NotReadableError','busy']:['NotFoundError','none'];
navigator.mediaDevices.getUserMedia=()=>Promise.reject(Object.assign(new Error(err[1]),{name:err[0]}));})();`;

const FAKE_HANDS = `window.Hands=function(){this.setOptions=()=>{};this.onResults=f=>{this.cb=f};this.send=async()=>{if(window.__throwModel)throw new Error('x');const h=window.__hand;this.cb(h?{multiHandLandmarks:[Array.from({length:21},(_,i)=>i===8?{x:h.x,y:h.y,z:0}:i===4?{x:h.x+(h.pinch?0.01:0.2),y:h.y,z:0}:{x:0.5,y:0.5,z:0})]}:{multiHandLandmarks:[]})}};`;
const FAKE_CAM = `window.Camera=function(v,o){this.start=async()=>{v.srcObject=await navigator.mediaDevices.getUserMedia({video:true});setInterval(()=>o.onFrame(),40)}};`;
const FAKE_VISION = `export const FilesetResolver={forVisionTasks:async()=>({})};
export const HandLandmarker={createFromOptions:async(f,o)=>{if(window.__gpuFail&&o.baseOptions.delegate==='GPU')throw new Error('gpu');if(window.__modelFail)throw new Error('m');return{detectForVideo:()=>({landmarks:window.__lm||[]})}}};`;

const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--disable-audio-output', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
async function page(url, { gum = 'granted', stub = true, vp = { width: 1280, height: 800 }, fake = true, init = '' } = {}) {
  const ctx = await b.newContext({ viewport: vp, permissions: ['camera', 'microphone'] });
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms|formspree|sibforms/, r => r.abort());
  // no outside request in the default run: anything not served from this machine is refused (the fakes below are registered later and win)
  if (!REAL && process.env.SK_REAL_CDN !== '1') await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), r => r.abort());
  await ctx.route('**/api/e', r => r.fulfill({ status: 204 }));
  await ctx.route(/\/js\/(analytics|consent|track)\.js/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  if (fake && !REAL) {
    await ctx.route(/@mediapipe\/hands@/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_HANDS }));
    await ctx.route(/@mediapipe\/camera_utils/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_CAM }));
    await ctx.route(/tasks-vision.*vision_bundle/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_VISION }));
  }
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  if (stub) await pg.addInitScript(STUB);
  await pg.addInitScript(GUM(gum)); if (init) await pg.addInitScript(init);
  await pg.goto(base + url, { waitUntil: 'load' });
  pg.errs = errs; pg.calls = async () => pg.evaluate(() => window.__c || []);
  pg.has = async (kind, ...m) => (await pg.calls()).filter(c => c[0] === kind && m.every((v, i) => v === undefined || JSON.stringify(c[i + 1]) === JSON.stringify(v)));
  return pg;
}
const names = c => c.map(x => x[0] === 'demo' ? x[2] : x[0] === 'track' ? x[1] : x[0] === 'media' ? 'media:' + x[3] : 'model:' + x[2]);
const count = (cs, kind, a) => cs.filter(c => c[0] === kind && (kind === 'demo' ? c[2] === a : kind === 'track' ? c[1] === a : true)).length;
// every value sent must be an enum word, a bucket, a small integer or ms: never free text
function scanValues(cs, label) {
  const bad = [];
  const chk = v => typeof v === 'number' ? Number.isFinite(v) : v === undefined || (typeof v === 'string' && /^[A-Za-z0-9 _.+\-]{0,40}$/.test(v));
  cs.forEach(c => { const p = c[0] === 'demo' ? c[3] : c[0] === 'track' ? c[2] : c[0] === 'model' ? c[3] : {}; Object.entries(p || {}).forEach(([k, v]) => { if (!chk(v) || ['source', 'medium', 'campaign', 'content', 'term'].includes(k)) bad.push(k + '=' + v); }); });
  ok(!bad.length, label + ' values clean ' + bad.join(','));
}
async function steady(pg, label, ms = 2500) { const f = async () => (await pg.calls()).filter(c => !['fps', 'idle_tip'].includes(c[2])).length; const n = await f(); await pg.waitForTimeout(ms); const m = await f(); ok(n === m, `${label} quiet when nothing changes (${m - n} new)`); }

/* ---------------- HANDS ---------------- */
{
  let pg = await page('/demos/hands.html', { init: 'window.__hand=null' });
  let cs = await pg.calls();
  ok(count(cs, 'track', 'demo_open') === 1, 'hands demo_open once');
  ok(cs.some(c => c[0] === 'track' && c[1] === 'demo_open' && c[2].demo_id === 'hands'), 'hands demo_id');
  await pg.click('#startBtn'); await pg.waitForTimeout(1500);
  cs = await pg.calls(); const n = names(cs);
  ok(n.includes('start_camera') && n.includes('media:prompt') && n.includes('media:granted') && n.includes('model:loaded'), 'hands start+prompt+granted+model ' + n.join());
  ok(count(cs, 'track', 'demo_start') === 1, 'hands demo_start once');
  ok(n.includes('first_interaction'), 'hands first_interaction');
  await steady(pg, 'hands idle');
  await pg.evaluate(() => { window.__hand = { x: 0.5, y: 0.5, pinch: false }; }); await pg.waitForTimeout(500);
  ok(count(await pg.calls(), 'demo', 'hand_found') === 1, 'hand_found once');
  // flicker shorter than 700 ms must not report a loss
  await pg.evaluate(() => { window.__hand = null; }); await pg.waitForTimeout(250); await pg.evaluate(() => { window.__hand = { x: 0.5, y: 0.5, pinch: false }; }); await pg.waitForTimeout(600);
  ok(count(await pg.calls(), 'demo', 'hand_lost') === 0 && count(await pg.calls(), 'demo', 'hand_found') === 1, 'hand flicker debounced');
  // pinch on empty space = miss
  await pg.evaluate(() => { window.__hand = { x: 0.001, y: 0.001, pinch: true }; }); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__hand = { x: 0.001, y: 0.001, pinch: false }; }); await pg.waitForTimeout(2200);
  cs = await pg.calls();
  ok(count(cs, 'demo', 'pinch_count') === 1 && count(cs, 'demo', 'misses') === 1, 'one pinch summary and one misses');
  // hit every target: put cursor on each target and pinch
  for (let i = 0; i < 5; i++) {
    const t = await pg.evaluate(i2 => { const e = document.querySelectorAll('.target:not(.hit)')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: parseFloat(e.style.left), y: parseFloat(e.style.top), w: innerWidth, h: innerHeight }; }, i);
    if (!t) break;
    await pg.evaluate(t2 => { window.__hand = { x: 1 - t2.x / t2.w, y: t2.y / t2.h, pinch: false }; }, t); await pg.waitForTimeout(700);
    await pg.evaluate(t2 => { window.__hand = { x: 1 - t2.x / t2.w, y: t2.y / t2.h, pinch: true }; }, t); await pg.waitForTimeout(250);
    await pg.evaluate(t2 => { window.__hand = { x: 1 - t2.x / t2.w, y: t2.y / t2.h, pinch: false }; }, t); await pg.waitForTimeout(250);
  }
  // a pinch before the next round appears (seen with a real hand) must not finish the round twice or count as a miss
  { const m0 = await pg.evaluate(() => document.querySelectorAll('.target:not(.hit)').length);
    await pg.evaluate(() => { window.__hand = Object.assign({}, window.__hand, { pinch: true }); }); await pg.waitForTimeout(80); await pg.evaluate(() => { window.__hand = Object.assign({}, window.__hand, { pinch: false }); });
    ok(m0 === 0, 'the extra pinch lands between rounds'); }
  await pg.waitForTimeout(2000); cs = await pg.calls();
  ok(count(cs, 'demo', 'target_hit') === 5, 'target_hit x5 got ' + count(cs, 'demo', 'target_hit'));
  ok(count(cs, 'demo', 'first_hit') === 1, 'first_hit once');
  ok(count(cs, 'demo', 'all_targets_done') === 1, 'all_targets_done once');
  await pg.evaluate(() => { window.__hand = null; }); await pg.waitForTimeout(1200);
  ok(count(await pg.calls(), 'demo', 'hand_lost') === 1, 'hand_lost once after 700ms');
  scanValues(await pg.calls(), 'hands');
  await pg.evaluate(() => document.querySelector('a[data-track="hands.back"]').addEventListener('click', e => e.preventDefault()));
  await pg.click('a[data-track="hands.back"]'); cs = await pg.calls();
  ok(count(cs, 'track', 'demo_end') === 1 && cs.some(c => c[1] === 'demo_end' && c[2].reason === 'back'), 'hands demo_end back once');
  ok(cs.some(c => c[0] === 'media' && c[3] === 'stopped'), 'hands media stopped');
  ok(pg.errs.length === 0, 'hands no page errors ' + pg.errs.join('|'));
  await pg.context().close();
  for (const g of ['denied', 'dismissed', 'notfound', 'none', 'busy']) {
    pg = await page('/demos/hands.html', { gum: g }); await pg.click('#startBtn'); await pg.waitForTimeout(800);
    const want = { denied: 'denied', dismissed: 'dismissed', notfound: 'unavailable', none: 'unavailable', busy: 'failed' }[g];
    cs = await pg.calls(); ok(cs.filter(c => c[0] === 'media' && c[3] === want).length === 1, `hands camera ${g} -> ${want} ` + names(cs).join());
    if (g !== 'none') ok(count(cs, 'track', 'demo_start') === 0, 'hands no demo_start on ' + g);
    await pg.context().close();
  }
  pg = await page('/demos/hands.html', { init: 'window.__throwModel=true' }); await pg.click('#startBtn'); await pg.waitForTimeout(800);
  ok((await pg.calls()).filter(c => c[0] === 'model' && c[2] === 'failed').length === 1, 'hands model failed once'); await pg.context().close();
}

/* ---------------- BALLS ---------------- */
{
  let pg = await page('/demos/balls.html');
  await pg.click('#startBtn'); await pg.waitForTimeout(1200);
  let cs = await pg.calls(), n = names(cs);
  ok(n.includes('start_camera') && n.includes('media:prompt') && n.includes('media:granted'), 'balls start media ' + n.join());
  ok(cs.some(c => c[2] === 'ball_count' && c[3].bucket === '21+'), 'balls ball_count 21+ after seed');
  ok(cs.some(c => c[0] === 'model') === false, 'balls has no model events');
  await pg.click('.swatch[data-color="red"]'); await pg.click('.swatch[data-color="red"]');
  ok(count(await pg.calls(), 'demo', 'color_picked') === 1, 'color_picked once for repeat click');
  await pg.click('#rainBtn'); await pg.click('#clearBtn'); await pg.waitForTimeout(300);
  cs = await pg.calls(); ok(count(cs, 'demo', 'rain_balls') === 1 && count(cs, 'demo', 'clear') === 1, 'rain and clear once');
  ok(cs.filter(c => c[2] === 'ball_count').length === 2, 'ball_count only on bucket change (seed, then clear to 0)');
  await pg.waitForTimeout(5000);  // the fake camera shows green, so catches and match changes are real transitions here
  { const ev = names(await pg.calls()); const allowed = new Set(['demo_open', 'first_interaction', 'start_camera', 'demo_start', 'ball_count', 'balls_caught_bucket', 'color_picked', 'rain_balls', 'clear', 'match_found', 'match_lost', 'fps', 'media:granted', 'media:prompt']);
    ok(ev.every(x => allowed.has(x)) && ev.length < 30, 'balls only transition events, bounded: ' + ev.length); }
  cs = await pg.calls(); ok(count(cs, 'demo', 'fps') === 1, 'balls fps once'); ok(cs.filter(c => c[2] === 'fps').every(c => ['lt20', '20-40', '40-55', '55+'].includes(c[3].bucket)), 'fps bucket enum');
  ok(count(cs, 'demo', 'match_found') <= 1, 'balls match not flapping');
  scanValues(cs, 'balls'); ok(pg.errs.length === 0, 'balls no page errors ' + pg.errs.join('|'));
  await pg.evaluate(() => document.querySelector('a[data-track="balls.home"]').addEventListener('click', e => e.preventDefault()));
  await pg.click('a[data-track="balls.home"]'); cs = await pg.calls();
  ok(cs.some(c => c[1] === 'demo_end' && c[2].reason === 'home') && cs.some(c => c[2] === 'balls_caught'), 'balls end with home and balls_caught');
  await pg.context().close();
  for (const g of ['denied', 'notfound', 'none']) {
    pg = await page('/demos/balls.html', { gum: g }); await pg.click('#startBtn'); await pg.waitForTimeout(500);
    const want = { denied: 'denied', notfound: 'unavailable', none: 'unavailable' }[g];
    ok((await pg.calls()).filter(c => c[0] === 'media' && c[3] === want).length === 1, 'balls ' + g + ' -> ' + want); await pg.context().close();
  }
}

/* ---------------- AUDIO ---------------- */
{
  let pg = await page('/demos/audio.html');
  await pg.click('#useMic'); await pg.waitForTimeout(2500);
  // 16 loud frames are needed: wait for them, frame rate varies by machine
  for (let i = 0; i < 30 && !(await pg.calls()).some(c => c[2] === 'sound_detected'); i++) await pg.waitForTimeout(500);
  let cs = await pg.calls(), n = names(cs);
  ok(n.includes('use_mic') && n.includes('media:prompt') && n.includes('media:granted'), 'audio mic flow ' + n.join());
  ok(count(cs, 'track', 'demo_start') === 1 && cs.some(c => c[1] === 'demo_start' && c[2].mode === 'mic'), 'audio demo_start mic');
  ok(cs.filter(c => c[2] === 'sound_detected' && c[3].item === 'yes').length === 1, 'sound_detected yes once (fake device beeps)');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  cs = await pg.calls(); ok(count(cs, 'demo', 'tab_hidden') === 1 && count(cs, 'demo', 'tab_resumed') === 1, 'tab hidden and resumed once each');
  await pg.evaluate(() => window.dispatchEvent(new Event('pagehide'))); cs = await pg.calls();
  ok(cs.some(c => c[2] === 'seconds_running') && cs.filter(c => c[1] === 'demo_end').length === 1, 'audio seconds_running and one demo_end');
  scanValues(cs, 'audio'); ok(pg.errs.length === 0, 'audio no page errors ' + pg.errs.join('|')); await pg.context().close();
  pg = await page('/demos/audio.html'); await pg.click('#useDemo'); await pg.waitForTimeout(500); cs = await pg.calls(); n = names(cs);
  ok(n.includes('demo_tone') && !n.some(x => x.startsWith('media:')), 'tone has no media events'); ok(cs.some(c => c[1] === 'demo_start' && c[2].mode === 'tone'), 'tone demo_start');
  await pg.context().close();
  for (const g of ['denied', 'dismissed', 'notfound']) {
    pg = await page('/demos/audio.html', { gum: g }); await pg.click('#useMic'); await pg.waitForTimeout(500);
    const want = { denied: 'denied', dismissed: 'dismissed', notfound: 'unavailable' }[g];
    ok((await pg.calls()).filter(c => c[0] === 'media' && c[3] === want).length === 1, 'audio ' + g + ' -> ' + want); await pg.context().close();
  }
  pg = await page('/demos/audio.html', { gum: 'none' }); await pg.click('#useMic'); await pg.waitForTimeout(500);
  ok((await pg.calls()).filter(c => c[0] === 'media' && c[3] === 'unavailable').length === 1, 'audio no mediaDevices -> unavailable'); await pg.context().close();
}

/* ---------------- SHADOW THEATRE ---------------- */
{
  let pg = await page('/shadow-theatre/index.html');
  let cs = await pg.calls(); ok(count(cs, 'track', 'demo_open') === 1, 'shadow demo_open');
  await pg.click('#startBtn'); await pg.waitForTimeout(2000);
  cs = await pg.calls(); let n = names(cs);
  ok(n.includes('start_show') && n.includes('media:prompt') && n.includes('media:granted') && n.includes('model:loaded'), 'shadow start flow ' + n.join());
  ok(cs.some(c => c[0] === 'model' && c[2] === 'loaded' && c[3].delegate === 'GPU'), 'model delegate GPU');
  ok(count(cs, 'track', 'demo_start') === 1, 'shadow demo_start once');
  await pg.click('#guideBtn'); await pg.waitForTimeout(1500);
  cs = await pg.calls(); ok(cs.some(c => c[2] === 'guide_toggle' && c[3].item === 'open'), 'guide opened');
  const gs = cs.filter(c => c[2] === 'guide_shape'); ok(gs.length >= 1 && gs.length <= 8 && new Set(gs.map(c => c[3].item)).size === gs.length, 'guide_shape unique, only visible cards ' + gs.length);
  await pg.click('#guideBtn');
  await steady(pg, 'shadow waiting', 1000);
  await pg.waitForTimeout(2500); cs = await pg.calls(); ok(count(cs, 'demo', 'idle_tip') === 1, 'idle_tip once after 3s without hands');
  // inject a lion pose (normalised video coordinates)
  await pg.evaluate(() => { const hs = window.ShadowShapes.POSES.lion(0.5, 0.5, 0.18); window.__lm = hs; });
  await pg.waitForTimeout(2600); cs = await pg.calls();
  ok(count(cs, 'demo', 'hand_detected') === 1, 'hand_detected once');
  const rec = cs.filter(c => c[2] === 'shape_recognised'); ok(rec.length === 1 && rec[0][3].item === 'lion' && rec[0][3].ms >= 1000, 'shape_recognised lion once with hold ms ' + JSON.stringify(rec.map(c => c[3])));
  ok(count(cs, 'demo', 'creature_spawned') === 1 && count(cs, 'demo', 'shape_new') === 1, 'creature_spawned and shape_new once');
  ok(cs.filter(c => c[2] === 'hands').length === 1, 'hands count reported once');
  // unmatched shape
  await pg.evaluate(() => { window.__lm = window.ShadowShapes.POSES.mystery(0.5, 0.5, 0.18); }); await pg.waitForTimeout(2300);
  cs = await pg.calls(); ok(count(cs, 'demo', 'no_match') === 1, 'no_match once per attempt');
  await steady(pg, 'shadow mystery hold', 2500);
  await pg.evaluate(() => { window.__lm = []; }); await pg.waitForTimeout(500);
  scanValues(await pg.calls(), 'shadow');
  await pg.evaluate(() => document.getElementById('back').addEventListener('click', e => e.preventDefault()));
  await pg.click('#back'); cs = await pg.calls();
  ok(count(cs, 'demo', 'back_to_demos') === 1 && cs.filter(c => c[1] === 'demo_end').length === 1, 'back_to_demos and one demo_end');
  ok(cs.some(c => c[2] === 'creatures_total') && cs.some(c => c[2] === 'shapes_found'), 'creature and shape totals at end');
  ok(pg.errs.length === 0, 'shadow no page errors ' + pg.errs.join('|')); await pg.context().close();
  // no camera rehearsal: no recognition events
  pg = await page('/shadow-theatre/index.html'); await pg.click('#demoBtn'); await pg.waitForTimeout(7000); cs = await pg.calls(); n = names(cs);
  ok(n.includes('demo_without_camera') && cs.some(c => c[1] === 'demo_start' && c[2].mode === 'nocamera'), 'rehearsal start');
  ok(!n.includes('shape_recognised') && !n.includes('creature_spawned') && !n.includes('no_match'), 'rehearsal sends no recognition events'); ok(count(cs, 'demo', 'fps') === 1, 'shadow fps once'); await pg.context().close();
  // failures
  for (const g of ['denied', 'dismissed', 'notfound', 'none']) {
    pg = await page('/shadow-theatre/index.html', { gum: g }); await pg.click('#startBtn'); await pg.waitForTimeout(600);
    const want = { denied: 'denied', dismissed: 'dismissed', notfound: 'unavailable', none: 'unavailable' }[g];
    cs = await pg.calls(); ok(cs.filter(c => c[0] === 'media' && c[3] === want).length === 1, 'shadow ' + g + ' -> ' + want + ' ' + names(cs).join()); await pg.context().close();
  }
  pg = await page('/shadow-theatre/index.html', { init: 'window.__modelFail=true' }); await pg.click('#startBtn'); await pg.waitForTimeout(1200);
  cs = await pg.calls(); ok(cs.some(c => c[0] === 'media' && c[3] === 'granted') && cs.filter(c => c[0] === 'model' && c[2] === 'failed').length === 1 && !cs.some(c => c[0] === 'media' && c[3] === 'failed'), 'model failure is not a camera failure'); await pg.context().close();
  pg = await page('/shadow-theatre/index.html', { init: 'window.__gpuFail=true' }); await pg.click('#startBtn'); await pg.waitForTimeout(1200);
  ok((await pg.calls()).some(c => c[0] === 'model' && c[2] === 'loaded' && c[3].delegate === 'CPU'), 'GPU fallback reports CPU'); await pg.context().close();
}

/* ---------------- MELT ---------------- */
// Melt imports three.js from jsdelivr, which is a real network fetch. It runs only with SK_REAL_CDN=1 (the owner's machine);
// the default run, CI included, makes no outside request and says so.
if (process.env.SK_REAL_CDN !== '1') console.log('  skip melt: needs three.js from the real CDN. Run with SK_REAL_CDN=1 to include it.');
else {
  let pg = await page('/melt/index.html', { fake: false });
  await pg.waitForFunction(() => window.__melt && window.__melt.state === 'title', null, { timeout: 20000 }).catch(() => {});
  const st = await pg.evaluate(() => window.__melt && window.__melt.state);
  ok(st === 'title', 'melt reached title (WebGL + three CDN) state=' + st);
  if (st === 'title') {
    await pg.evaluate(() => { const e = document.getElementById('sens'); e.value = 2.5; e.dispatchEvent(new Event('input')); e.value = 2.6; e.dispatchEvent(new Event('input')); });
    await pg.waitForTimeout(900);
    await pg.evaluate(() => document.querySelector('#fx').click()); await pg.evaluate(() => document.querySelector('#snd').click()); await pg.waitForTimeout(100);
    let cs = await pg.calls();
    ok(count(cs, 'demo', 'sensitivity') === 1 && cs.find(c => c[2] === 'sensitivity')[3].bucket === 'q5', 'sensitivity debounced to one q5');
    ok(cs.some(c => c[2] === 'fx_toggle' && c[3].item === 'off') && cs.some(c => c[2] === 'sound_toggle' && c[3].item === 'off'), 'fx and sound toggles');
    await pg.evaluate(() => document.querySelector('#playBtn').click()); await pg.waitForTimeout(500);
    cs = await pg.calls(); ok(count(cs, 'demo', 'play') === 1 && count(cs, 'demo', 'run_start') === 1 && count(cs, 'track', 'demo_start') === 1, 'play, run_start, demo_start once');
    await pg.evaluate(() => { const m = window.__melt; m.trick('WALL', 35); m.trick('WALL', 35); m.trick('MACH', 90); });
    await pg.keyboard.press('KeyR'); await pg.evaluate(() => { window.__melt.P.pos.y = -100; window.__melt.step(1); });
    await pg.waitForTimeout(300); cs = await pg.calls();
    ok(count(cs, 'demo', 'respawn') === 1, 'R key is respawn'); ok(count(cs, 'demo', 'fall') === 1, 'fall is fall, once');
    await pg.evaluate(() => document.getElementById('bPause') && 0);
    await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await pg.waitForTimeout(200); cs = await pg.calls(); ok(cs.some(c => c[2] === 'pause' && c[3].item === 'hidden'), 'pause cause hidden');
    await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
    await pg.evaluate(() => document.querySelector('#resumeBtn').click()); await pg.waitForTimeout(200); ok(count(await pg.calls(), 'demo', 'resume') === 1, 'resume once');
    await pg.evaluate(() => { window.__melt.endRun(); }); await pg.waitForTimeout(300); cs = await pg.calls();
    const re = cs.filter(c => c[2] === 'run_end'); ok(re.length === 1 && re[0][3].item === 'completed', 'run_end completed once');
    const tc = cs.filter(c => c[2] === 'trick_count'); ok(tc.length === 2 && tc.find(c => c[3].item === 'WALL')[3].value === 2, 'trick_count aggregated per name');
    ok(cs.some(c => c[2] === 'run_score') && cs.some(c => c[2] === 'run_best_combo' && /^[0-9+\-]+$/.test(c[3].bucket)), 'score and combo buckets');
    await pg.evaluate(() => document.querySelector('#againBtn').click()); await pg.waitForTimeout(300); cs = await pg.calls();
    ok(count(cs, 'demo', 'run_again') === 1 && count(cs, 'demo', 'run_start') === 2 && count(cs, 'track', 'demo_start') === 1, 'run_again, second run_start, no second demo_start');
    await pg.evaluate(() => window.dispatchEvent(new Event('pagehide'))); cs = await pg.calls();
    const abn = cs.filter(c => c[2] === 'run_end' && c[3].item === 'abandoned'); ok(abn.length === 1, 'pagehide mid-run is abandoned once'); ok(cs.filter(c => c[1] === 'demo_end').length === 1, 'melt one demo_end');
    scanValues(cs, 'melt');
  }
  ok(pg.errs.length === 0, 'melt no page errors ' + pg.errs.join('|')); await pg.context().close();
}

/* ---------------- ROBUSTNESS ---------------- */
{
  // late sk: stub installed after load, queued events must still arrive
  let pg = await page('/demos/audio.html', { stub: false }); await pg.click('#useDemo'); await pg.waitForTimeout(300);
  await pg.evaluate(STUB); await pg.waitForTimeout(1200); let cs = await pg.calls();
  ok(cs.some(c => c[1] === 'demo_open') && cs.some(c => c[2] === 'demo_tone'), 'late sk receives queued demo_open and demo_tone'); await pg.context().close();
  // no sk at all and a throwing sk: page keeps working
  pg = await page('/demos/audio.html', { stub: false }); await pg.click('#useDemo'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => document.getElementById('gate').style.display === 'none'), 'works with no sk'); ok(pg.errs.length === 0, 'no sk, no errors'); await pg.context().close();
  pg = await page('/demos/audio.html', { stub: false, init: `window.sk={consent:'granted',demo(){throw new Error('boom')},track(){throw new Error('boom')},media(){throw new Error('boom')},model(){throw new Error('boom')}}` });
  await pg.click('#useDemo'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => document.getElementById('gate').style.display === 'none'), 'works with a throwing sk'); ok(pg.errs.length === 0, 'throwing sk, no page errors ' + pg.errs.join('|')); await pg.context().close();
  // consent not granted: no localStorage flag written
  pg = await page('/demos/audio.html', { init: `window.__x=1` }); await pg.evaluate(() => { window.sk.consent = 'denied'; }); await pg.click('#useDemo'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => localStorage.getItem('sk_seen_audio') === null), 'no return-visit flag without consent'); await pg.context().close();
  // head consent snippet and scripts present on melt and shadow theatre
  for (const f of ['melt/index.html', 'shadow-theatre/index.html']) { const t = fs.readFileSync(f, 'utf8'); ok(/Consent Mode v2/.test(t) && !/googletagmanager\.com\/(gtm|ns)/.test(t) && /\/js\/consent\.js/.test(t) && /\/js\/analytics\.js/.test(t), f + ' has the consent default, no inline GTM loader, and the scripts'); }
  for (const f of ['melt/index.html', 'shadow-theatre/index.html', 'demos/hands.html', 'demos/balls.html', 'demos/audio.html']) { const t = fs.readFileSync(f, 'utf8'); const d = (t.match(/[–—]/g) || []).length; if (f.startsWith('melt') || f.startsWith('shadow')) ok(d === 0, f + ' has no dashes in file ' + d); }
}
await b.close(); srv.close();
console.log(out.join('\n')); console.log(`media tests: ${pass} passed, ${fail} failed${REAL ? ' (REAL CDN)' : ''}`);
process.exit(fail ? 1 : 0);
