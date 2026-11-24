/* Auto cursor: after a quiet minute the site shows itself being browsed.
   It is a separate green cursor labelled AUTO. It dispatches no mouse events and
   never scrolls, so it cannot trigger site handlers or analytics. It moves only
   within what is on screen. Any real input hands control back. Stop turns it off
   for the rest of the visit. Debug: add ?haunt=fast to start after 3 seconds. */
(function () {
  'use strict';
  var mm = window.matchMedia;
  if (mm && (mm('(hover: none), (pointer: coarse)').matches || mm('(prefers-reduced-motion: reduce)').matches)) return;

  var FAST = /[?&]haunt=fast/.test(location.search);
  var IDLE = FAST ? 3000 : 55000;
  var KEY = 'sk.haunt.path', OFFKEY = 'sk_haunt_off';
  var MAX = 260;
  function T(n, p) { try { window.sk && window.sk.track(n, p); } catch (e) {} }
  function H(on) { try { window.sk && window.sk.haunt(on); } catch (e) {} }
  function granted() { try { return window.sk && window.sk.consent === 'granted'; } catch (e) { return false; } }
  var disabled = false;
  try { disabled = sessionStorage.getItem(OFFKEY) === '1'; } catch (e) {}

  /* ---------- record this visit, coarsely, locally, only with consent ---------- */
  var rec = [], lastT = 0, t0 = performance.now();
  function sample(x, y) {
    var t = performance.now();
    if (!granted() || t - lastT < 140 || rec.length >= MAX) return;
    lastT = t;
    var dh = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    rec.push([+(x / innerWidth).toFixed(3), +(y / innerHeight).toFixed(3), +(scrollY / dh).toFixed(3), Math.round(t - t0)]);
  }
  function save() { try { if (granted() && rec.length > 40) localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {} }
  addEventListener('pagehide', save);
  window.addEventListener('sk:consent', function (e) {
    if (e.detail && e.detail.state === 'denied') { rec = []; try { localStorage.removeItem(KEY); } catch (x) {} }
  });
  var past = null;
  try { past = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}

  /* ---------- ghost cursor and caption ---------- */
  var st = document.createElement('style');
  st.textContent =
    '.sk-ghost{position:fixed;left:0;top:0;z-index:2147483600;pointer-events:none;opacity:0;transition:opacity .3s;will-change:transform}' +
    '.sk-ghost.on{opacity:1}' +
    '.sk-ghost svg{display:block;filter:drop-shadow(0 1px 2px rgba(8,12,28,.5))}' +
    '.sk-ghost span{position:absolute;left:16px;top:20px;font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;color:#fff;background:#1f6b3a;background:oklch(0.42 0.13 145);border:1px solid #f6f6f8;padding:4px 6px;border-radius:2px}' +
    '.haunt-cap{position:fixed;left:50%;bottom:24px;z-index:2147483601;transform:translate(-50%,12px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:12px;' +
    'font:500 14px/1.3 "Bricolage Grotesque",system-ui,sans-serif;color:#f6f6f8;background:#0f1218;background:oklch(0.16 0.012 260);padding:8px 8px 8px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(8,12,28,.28);max-width:calc(100vw - 32px)}' +
    '.haunt-cap.on{opacity:1;transform:translate(-50%,0);pointer-events:auto;transition:opacity .3s,transform .3s}' +
    '.haunt-cap button{font:500 14px/1 inherit;font-family:inherit;color:#0f1218;background:#f6f6f8;border:0;border-radius:999px;padding:8px 16px;min-height:32px;cursor:pointer}' +
    '.haunt-cap button:focus-visible{outline:2px solid #8da0ff;outline-offset:2px}' +
    '.haunt-cap,.haunt-cap *{cursor:pointer!important}' +
    '.ghost-hover{outline:2px solid #2e8b57!important;outline-offset:3px!important}' +
    'html.haunting .mag-cursor{opacity:0!important}' +
    '@media (prefers-reduced-motion:reduce){.sk-ghost,.haunt-cap.on{transition:none}}';
  document.head.appendChild(st);

  var ghost = document.createElement('div');
  ghost.className = 'sk-ghost';
  ghost.setAttribute('data-no-track', ''); ghost.setAttribute('data-clarity-mask', 'True'); ghost.setAttribute('aria-hidden', 'true');
  /* arrow: green fill, dark inner edge and light outer ring so it reads on light and dark sections */
  ghost.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M3 2v18l5-4.5 3.5 8 3.2-1.4-3.5-7.8H18z" fill="#2e8b57" stroke="#f6f6f8" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/><path d="M3 2v18l5-4.5 3.5 8 3.2-1.4-3.5-7.8H18z" fill="#2e8b57" stroke="#0f1218" stroke-width="1.2" stroke-linejoin="round"/></svg><span>AUTO</span>';
  document.body.appendChild(ghost);

  var cap = document.createElement('div');
  cap.className = 'haunt-cap'; cap.setAttribute('role', 'status'); cap.setAttribute('aria-live', 'polite');
  cap.setAttribute('data-no-track', ''); cap.setAttribute('data-clarity-mask', 'True');
  var capText = document.createElement('span');
  var stopBtn = document.createElement('button');
  stopBtn.type = 'button'; stopBtn.textContent = 'Stop auto cursor';
  cap.appendChild(capText); cap.appendChild(stopBtn);
  document.body.appendChild(cap);
  var capTimer = 0;
  function say(text, ms) {
    capText.textContent = text; cap.classList.add('on');
    clearTimeout(capTimer);
    if (ms) capTimer = setTimeout(function () { cap.classList.remove('on'); }, ms);
  }

  /* ---------- ghost driver: moves only the ghost element ---------- */
  var haunting = false, timer = 0, raf = 0, gx = innerWidth / 2, gy = innerHeight / 2, lastHover = null, run = 0, startedAt = 0, mode = '';
  function place(x, y) { gx = x; gy = y; ghost.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }
  function hoverAt(x, y) {
    var el = null;
    try { ghost.style.visibility = 'hidden'; el = document.elementFromPoint(x, y); ghost.style.visibility = ''; } catch (e) {}
    var tgt = el && el.closest ? el.closest('a,button,.work-card,h2') : null;
    if (tgt !== lastHover) {
      if (lastHover) lastHover.classList.remove('ghost-hover');
      if (tgt && !tgt.closest('.haunt-cap')) tgt.classList.add('ghost-hover'); else tgt = null;
      lastHover = tgt;
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
        px = Math.max(4, Math.min(innerWidth - 8, px)); py = Math.max(4, Math.min(innerHeight - 8, py));
        place(px, py);
        if (k < 1) raf = requestAnimationFrame(step); else { hoverAt(px, py); res(); }
      })(s);
    });
  }
  async function read(id) { var x = gx, y = gy; for (var i = 0; i < 3; i++) { await glide(x + 60 + Math.random() * 120, y + 14 * i, 700, id); await glide(x, y + 14 * i + 7, 260, id); } }
  function setMode(m) { mode = m; T('haunt_mode', { mode: m }); }

  async function tour(id) {
    setMode('tour');
    var picks = Array.prototype.slice.call(document.querySelectorAll('.nav-links a, main a.work-card, main .work-card, main a[href*="demos"], main a[href*="melt"], main h2'))
      .filter(function (el) { var r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10 && r.top >= 56 && r.bottom <= innerHeight - 40 && r.left >= 0 && r.right <= innerWidth; });
    var seen = {}, list = [];
    picks.forEach(function (el) { var k = el.outerHTML.length + '_' + el.textContent.length; if (list.length < 8 && !seen[k]) { seen[k] = 1; list.push(el); } });
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      await glide(r.left + r.width * (0.3 + Math.random() * 0.4), r.top + Math.min(r.height * 0.5, 120), 1100 + Math.random() * 700, id);
      await wait(900 + Math.random() * 900, id);
      if (list[i].tagName === 'H2' || Math.random() < 0.3) await read(id);
    }
    await glide(innerWidth / 2, innerHeight / 2, 1400, id);
  }
  /* replays only the part of the last visit recorded at about the current scroll position */
  async function replay(path, id) {
    var dh = Math.max(1, document.documentElement.scrollHeight - innerHeight), here = scrollY / dh;
    var part = path.filter(function (p) { return Math.abs(p[2] - here) < 0.12; });
    if (part.length < 12) return false;
    setMode('replay');
    var prev = part[0][3];
    for (var i = 0; i < part.length; i++) {
      var p = part[i], dt = Math.min(1200, Math.max(60, (p[3] - prev) * 1.15)); prev = p[3];
      await glide(p[0] * innerWidth, p[1] * innerHeight, dt, id);
    }
    return true;
  }
  async function haunt() {
    if (haunting || document.hidden || disabled) return;
    haunting = true; var id = ++run; startedAt = performance.now();
    H(true);
    document.documentElement.classList.add('haunting');
    place(gx, gy); ghost.classList.add('on');
    var mine = granted() && past && past.length > 40;
    say(mine ? 'Auto cursor replaying your last visit, not you. Move to take over.' : 'Auto cursor, not you. Move to take over.');
    T('haunt_start', { mode: mine ? 'replay' : 'tour' });
    var reason = 'done';
    try { if (mine) await replay(past, id); await tour(id); } catch (e) { return; }
    if (id === run) { stopHaunt(reason); arm(); }
  }
  function stopHaunt(reason) {
    if (!haunting) return;
    haunting = false; run++; cancelAnimationFrame(raf);
    ghost.classList.remove('on'); document.documentElement.classList.remove('haunting');
    if (lastHover) { lastHover.classList.remove('ghost-hover'); lastHover = null; }
    var ms = Math.round(performance.now() - startedAt);
    H(false);
    T('haunt_end', { ms: ms, reason: reason });
    if (reason === 'done') cap.classList.remove('on');
  }
  function arm() { clearTimeout(timer); if (!disabled) timer = setTimeout(haunt, IDLE); }
  function turnOff() {
    disabled = true; clearTimeout(timer);
    try { sessionStorage.setItem(OFFKEY, '1'); } catch (e) {}
    cap.classList.remove('on');
  }
  stopBtn.addEventListener('click', function () {
    T('haunt_stop_click', { ms: Math.round(performance.now() - startedAt) });
    if (haunting) stopHaunt('stop');
    turnOff();
  });

  var rx = -1, ry = -1;
  function real(e) {
    if (!e.isTrusted) return;
    if (e.target && e.target.closest && e.target.closest('.haunt-cap')) return;
    if (e.type === 'mousemove') {
      var moved = rx < 0 || Math.abs(e.clientX - rx) + Math.abs(e.clientY - ry) >= 4;
      rx = e.clientX; ry = e.clientY;
      if (!moved) return;
      sample(e.clientX, e.clientY);
    }
    if (haunting) {
      var ms = Math.round(performance.now() - startedAt);
      T('haunt_interrupted', { input: e.type, ms: ms });
      stopHaunt('interrupted');
      say('Auto cursor paused. You have control.', 6000);
    }
    arm();
  }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { addEventListener(t, real, { passive: true, capture: true }); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopHaunt('hidden'); });
  arm();
  window.__haunt = { start: haunt, stop: function () { stopHaunt('stop'); }, get on() { return haunting; } };
})();
