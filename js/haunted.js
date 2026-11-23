/* Haunted: after a quiet minute the site starts browsing itself.
   The real custom cursor is driven by synthetic (untrusted) mouse events.
   Any real input hands control straight back. Paths stay in this browser only.
   Debug: add ?haunt=fast to trigger after 3 seconds. */
(function () {
  'use strict';
  var mm = window.matchMedia;
  if (mm && (mm('(hover: none), (pointer: coarse)').matches || mm('(prefers-reduced-motion: reduce)').matches)) return;

  var FAST = /[?&]haunt=fast/.test(location.search);
  var IDLE = FAST ? 3000 : 55000;
  var KEY = 'sk.haunt.path';
  var MAX = 260;

  /* ---------- record this visit, coarsely, locally ---------- */
  var rec = [], lastT = 0, t0 = performance.now();
  function sample(x, y) {
    var t = performance.now();
    if (t - lastT < 140 || rec.length >= MAX) return;
    lastT = t;
    var dh = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    rec.push([+(x / innerWidth).toFixed(3), +(y / innerHeight).toFixed(3), +(scrollY / dh).toFixed(3), Math.round(t - t0)]);
  }
  function save() { try { if (rec.length > 40) localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {} }
  addEventListener('pagehide', save);
  var past = null;
  try { past = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}

  /* ---------- caption ---------- */
  var st = document.createElement('style');
  st.textContent = '.haunt-cap{position:fixed;left:50%;bottom:24px;z-index:9998;transform:translate(-50%,20px);opacity:0;pointer-events:none;' +
    'font:500 12.5px/1 "IBM Plex Mono",ui-monospace,monospace;color:#f4f3ef;background:rgba(20,18,28,.86);padding:10px 16px;border-radius:999px;' +
    'transition:opacity .5s,transform .5s;letter-spacing:.02em}.haunt-cap.on{opacity:1;transform:translate(-50%,0)}' +
    'html.haunting body{filter:saturate(.75) contrast(1.03);transition:filter 1.2s}html body{transition:filter 1.2s}';
  document.head.appendChild(st);
  var cap = document.createElement('div'); cap.className = 'haunt-cap'; cap.setAttribute('aria-live', 'polite');
  document.body.appendChild(cap);

  /* ---------- ghost driver ---------- */
  var haunting = false, timer = 0, raf = 0, gx = innerWidth / 2, gy = innerHeight / 2, lastOver = null, run = 0;
  function fire(type, el, x, y) {
    try { (el || document).dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: type !== 'mouseenter' && type !== 'mouseleave', view: window })); } catch (e) {}
  }
  function moveTo(x, y) {
    gx = x; gy = y;
    var el = document.elementFromPoint(x, y);
    fire('mousemove', el || document, x, y);
    if (el !== lastOver) {
      if (lastOver) { fire('mouseout', lastOver, x, y); fire('mouseleave', lastOver, x, y); }
      if (el) { fire('mouseover', el, x, y); fire('mouseenter', el, x, y); }
      lastOver = el;
    }
  }
  function wait(ms, id) { return new Promise(function (res, rej) { setTimeout(function () { id === run ? res() : rej(); }, ms); }); }
  function glide(x, y, ms, id) {
    return new Promise(function (res, rej) {
      var sx = gx, sy = gy, s = performance.now();
      var cx = (sx + x) / 2 + (Math.random() - 0.5) * 220, cy = (sy + y) / 2 + (Math.random() - 0.5) * 160;
      (function step(now) {
        if (id !== run) return rej();
        var k = Math.min(1, (now - s) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        var px = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * x;
        var py = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * y;
        moveTo(px + Math.sin(now / 90) * 1.5, py + Math.cos(now / 110) * 1.5);
        if (k < 1) raf = requestAnimationFrame(step); else res();
      })(s);
    });
  }
  function scrollToY(y, id) { scrollTo({ top: y, behavior: 'smooth' }); return wait(900, id); }
  async function read(id) { var x = gx, y = gy; for (var i = 0; i < 3; i++) { await glide(x + 60 + Math.random() * 120, y + 14 * i, 700, id); await glide(x, y + 14 * i + 7, 260, id); } }

  async function tour(id) {
    var picks = Array.prototype.slice.call(document.querySelectorAll('.nav-links a, main a.work-card, main .work-card, main a[href*="demos"], main a[href*="melt"], main h2'))
      .filter(function (el) { var r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10; });
    var seen = {}, list = [];
    picks.forEach(function (el) { if (list.length < 8 && !seen[el.outerHTML.length + '_' + el.textContent.length]) { seen[el.outerHTML.length + '_' + el.textContent.length] = 1; list.push(el); } });
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 40) { await scrollToY(Math.max(0, scrollY + r.top - innerHeight * 0.35), id); r = el.getBoundingClientRect(); }
      await glide(r.left + r.width * (0.3 + Math.random() * 0.4), r.top + Math.min(r.height * 0.5, 120), 1100 + Math.random() * 700, id);
      await wait(900 + Math.random() * 900, id);
      if (el.tagName === 'H2' || Math.random() < 0.3) await read(id);
    }
    await scrollToY(0, id); await glide(innerWidth / 2, innerHeight / 2, 1400, id);
  }
  async function replay(path, id) {
    var dh = Math.max(1, document.documentElement.scrollHeight - innerHeight), prev = path[0][3];
    for (var i = 0; i < path.length; i++) {
      var p = path[i], dt = Math.min(1200, Math.max(60, (p[3] - prev) * 1.15)); prev = p[3];
      if (Math.abs(p[2] * dh - scrollY) > 40) scrollTo({ top: p[2] * dh, behavior: 'smooth' });
      await glide(p[0] * innerWidth, p[1] * innerHeight, dt, id);
    }
  }
  async function haunt() {
    if (haunting || document.hidden) return;
    haunting = true; var id = ++run;
    document.documentElement.classList.add('haunting');
    var mine = past && past.length > 40;
    cap.textContent = mine ? 'replaying your last visit. move the mouse to take over' : 'the site is browsing itself. move the mouse to take over';
    cap.classList.add('on');
    try { if (mine) await replay(past, id); await tour(id); } catch (e) { return; }
    if (id === run) { stopHaunt(); arm(); }
  }
  function stopHaunt() {
    if (!haunting) return;
    haunting = false; run++; cancelAnimationFrame(raf);
    cap.classList.remove('on'); document.documentElement.classList.remove('haunting');
    if (lastOver) { fire('mouseout', lastOver, gx, gy); fire('mouseleave', lastOver, gx, gy); lastOver = null; }
  }
  function arm() { clearTimeout(timer); timer = setTimeout(haunt, IDLE); }
  function real(e) {
    if (!e.isTrusted) return;
    if (e.type === 'mousemove') { gx = e.clientX; gy = e.clientY; sample(e.clientX, e.clientY); }
    if (haunting) stopHaunt();
    arm();
  }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { addEventListener(t, real, { passive: true, capture: true }); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopHaunt(); });
  arm();
  window.__haunt = { start: haunt, stop: stopHaunt, get on() { return haunting; } };
})();
