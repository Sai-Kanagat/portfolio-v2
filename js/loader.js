/* =========================================================
   CANONICAL REDIRECT - force saikanagat.com
   Sends any .pages.dev / preview-deploy traffic to the
   canonical domain so Google indexes only one URL.
   Runs synchronously before page paint.
   ========================================================= */
(function(){
  try {
    var h = window.location.hostname;
    if (/\.pages\.dev$/i.test(h)) {
      window.location.replace('https://saikanagat.com' + window.location.pathname + window.location.search + window.location.hash);
    }
  } catch(e) {}
})();

/* =========================================================
   PAGE LOADER - SK Portfolio
   First visit in a session on the home page: count 00 to 100,
   logo reveal, curtain lift. Every other page: short curtain wipe.

   Rules this file must keep:
   - It can never block content. A hard timer (setTimeout, not
     requestAnimationFrame) removes the overlay and the scroll lock
     whatever else happens. A CSS animation on .site-loader hides it
     even if this script stops running.
   - requestAnimationFrame is only used for smoothness, never to
     decide when to finish. sessionStorage is optional.
   - prefers-reduced-motion: no overlay at all.
   ========================================================= */

(function() {
  var doc = document.documentElement;
  var INTRO_CAP = 3500;   // ms, hard limit for the first-visit intro
  var QUICK_CAP = 1200;   // ms, hard limit for the quick wipe

  var reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  var path = window.location.pathname;
  var isHome = path === '/' || /(^|\/)index(\.html?)?$/.test(path);
  var alreadyShown = false;
  try { alreadyShown = !!sessionStorage.getItem('sk_loader_shown'); } catch (e) {}
  var intro = isHome && !alreadyShown;

  var finished = false;
  var loader = null;
  var timers = [];

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }

  // Calls fn on the next frame, or after 50 ms if frames are not running
  // (background tab, throttled webview). Whichever comes first, once.
  function nextTick(fn) {
    var fired = false;
    function go() { if (fired) return; fired = true; fn(); }
    try { requestAnimationFrame(go); } catch (e) {}
    later(go, 50);
  }

  function finish() {
    if (finished) return;
    finished = true;
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
    doc.classList.remove('loading');
    try { document.dispatchEvent(new CustomEvent('sk:loaded')); } catch (e) {}
  }

  // Reduced motion: never cover the page.
  if (reduced) {
    if (intro) { try { sessionStorage.setItem('sk_loader_shown', '1'); } catch (e) {} }
    finish();
    return;
  }

  // Back/forward cache restore: never come back to a covered page.
  window.addEventListener('pageshow', function(e) { if (e.persisted) finish(); });

  loader = document.createElement('div');
  loader.className = 'site-loader' + (intro ? '' : ' site-loader-quick');
  loader.id = 'siteLoader';
  loader.setAttribute('aria-hidden', 'true');
  if (intro) {
    loader.innerHTML =
      '<div class="site-loader-inner">' +
        '<div class="site-loader-logo">SK<span>.</span></div>' +
        '<div class="site-loader-count" id="loaderCount">00</div>' +
        '<div class="site-loader-bar"><div class="site-loader-bar-fill" id="loaderBar"></div></div>' +
        '<div class="site-loader-meta">' +
          '<span>Portfolio · 2026</span>' +
          '<span id="loaderPhase">Initialising</span>' +
        '</div>' +
      '</div>' +
      '<div class="site-loader-curtain"></div>';
  } else {
    loader.innerHTML = '<div class="site-loader-curtain"></div>';
  }

  // Hard stop, started now, independent of load events and frames.
  later(finish, intro ? INTRO_CAP : QUICK_CAP);

  function mount() {
    if (finished || loader.parentNode) return;
    if (!document.body) { later(mount, 10); return; }
    document.body.insertBefore(loader, document.body.firstChild);
    doc.classList.add('loading');
    if (intro) runIntro(); else runQuick();
  }

  function exit(removeAfter) {
    if (finished) return;
    loader.classList.add('done');
    later(finish, removeAfter);
  }

  function runQuick() {
    var ready = document.readyState !== 'loading';
    function go() { later(function() { exit(450); }, 0); }
    if (ready) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  function runIntro() {
    var count = document.getElementById('loaderCount');
    var bar = document.getElementById('loaderBar');
    var phase = document.getElementById('loaderPhase');
    var phases = [[0, 'Initialising'], [25, 'Loading type'], [55, 'Preparing work'], [80, 'Calibrating grid'], [100, 'Ready']];
    var duration = 1400;
    var start = Date.now();

    function step() {
      if (finished) return;
      var t = Math.min((Date.now() - start) / duration, 1);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var pct = Math.round(eased * 100);
      count.textContent = (pct < 10 ? '0' : '') + pct;
      bar.style.width = pct + '%';
      for (var i = phases.length - 1; i >= 0; i--) {
        if (pct >= phases[i][0]) { phase.textContent = phases[i][1]; break; }
      }
      if (t < 1) {
        later(function() { nextTick(step); }, 16);
      } else {
        try { sessionStorage.setItem('sk_loader_shown', '1'); } catch (e) {}
        later(function() { exit(950); }, 200);
      }
    }
    step();
  }

  mount();
})();
