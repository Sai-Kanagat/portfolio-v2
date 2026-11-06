/* =========================================================
   CUSTOM CURSOR - Magnetic Friction (SK Portfolio)
   Two shapes with target-LERP physics.
   Shape A (lead): small disc, faster friction
   Shape B (trail): rotated square outline, slower friction
   Both shapes use a difference blend so they stay visible on
   any background (paper, ink, ultramarine, photography).
   Both pass through hover targets (pointer-events:none).

   Native cursor rule: the system cursor is hidden ONLY while the
   custom cursor is live (class html.has-mag-cursor). It comes back
   whenever the custom cursor is not active:
     - before the first mouse movement
     - touch / coarse pointers (script does not run at all)
     - pointer leaves the window or the tab loses focus
     - over iframes, embeds, objects and form fields
     - if anything in this script throws
   ========================================================= */

(function () {
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  var root = document.documentElement;
  var lead, trail, rafId = 0, dead = false;
  var live = false;          // custom cursor currently shown, native hidden
  var nativeZone = false;    // pointer is over something that should keep the native cursor
  var NATIVE_SEL = 'iframe, embed, object, video[controls], audio[controls], input, textarea, select, [contenteditable=""], [contenteditable="true"], .native-cursor';

  try {
    // Build DOM
    lead  = document.createElement('div');
    trail = document.createElement('div');
    lead.className  = 'mag-cursor mag-lead is-hide';
    trail.className = 'mag-cursor mag-trail is-hide';
    lead.setAttribute('aria-hidden', 'true');
    trail.setAttribute('aria-hidden', 'true');
    document.body.appendChild(lead);
    document.body.appendChild(trail);

    // Scoped CSS (self-contained so other stylesheets cannot break the cursor)
    if (!document.getElementById('mag-cursor-styles')) {
      var s = document.createElement('style');
      s.id = 'mag-cursor-styles';
      s.textContent = [
        '.mag-cursor{position:fixed;top:0;left:0;pointer-events:none;will-change:transform;z-index:2147483647;mix-blend-mode:difference;}',
        '.mag-lead{width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#ffffff;transition:width .25s cubic-bezier(.2,.8,.2,1),height .25s cubic-bezier(.2,.8,.2,1),margin .25s cubic-bezier(.2,.8,.2,1),opacity .2s ease;}',
        '.mag-trail{width:42px;height:42px;margin:-21px 0 0 -21px;border:1.5px solid #ffffff;transition:width .35s cubic-bezier(.2,.8,.2,1),height .35s cubic-bezier(.2,.8,.2,1),margin .35s cubic-bezier(.2,.8,.2,1),opacity .2s ease;}',
        '.mag-lead.is-grow{width:40px;height:40px;margin:-20px 0 0 -20px;}',
        '.mag-trail.is-grow{width:72px;height:72px;margin:-36px 0 0 -36px;}',
        '.mag-trail.is-grow-img{width:120px;height:120px;margin:-60px 0 0 -60px;background:rgba(255,255,255,0.04);}',
        '.mag-lead.is-hide,.mag-trail.is-hide{opacity:0;}',
        /* Native cursor is hidden only while the custom one is live */
        'html.has-mag-cursor, html.has-mag-cursor * { cursor: none !important; }',
        '@media (hover: none), (pointer: coarse) { .mag-cursor { display: none !important; } html.has-mag-cursor, html.has-mag-cursor * { cursor: auto !important; } }'
      ].join('\n');
      document.head.appendChild(s);
    }
  } catch (err) {
    teardown();
    return;
  }

  function activate() {
    if (live || dead) return;
    live = true;
    root.classList.add('has-mag-cursor');
    lead.classList.remove('is-hide');
    trail.classList.remove('is-hide');
  }
  function deactivate() {
    live = false;
    root.classList.remove('has-mag-cursor');
    if (lead)  lead.classList.add('is-hide');
    if (trail) trail.classList.add('is-hide');
  }
  function teardown() {
    dead = true;
    deactivate();
    if (rafId) cancelAnimationFrame(rafId);
    [lead, trail].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
  }

  // Pointer + interpolation state
  var mx = window.innerWidth / 2, my = window.innerHeight / 2;
  var lx = mx, ly = my;
  var tx = mx, ty = my, tr = 45; // trail rotation accumulates for organic feel
  var first = true;

  window.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    if (first) { lx = tx = mx; ly = ty = my; first = false; } // no fly-in from the screen centre
    if (!live && !nativeZone) activate();
  }, { passive: true });

  // Touch or pen input: give the native cursor and UI back
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') deactivate();
  }, { passive: true });

  function engine() {
    if (dead) return;
    try {
      // Lead: faster TLERP - feels attached, responsive
      lx += (mx - lx) * 0.22;
      ly += (my - ly) * 0.22;
      // Trail: slower TLERP - creates elasticity / separation
      tx += (mx - tx) * 0.10;
      ty += (my - ty) * 0.10;
      // Trail rotation drifts slowly with movement direction for organic motion
      var dx = mx - tx, dy = my - ty;
      var targetAng = Math.atan2(dy, dx) * 180 / Math.PI;
      tr += (targetAng - tr) * 0.04;

      lead.style.transform  = 'translate3d(' + lx + 'px,' + ly + 'px,0)';
      trail.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) rotate(' + tr + 'deg)';
      rafId = requestAnimationFrame(engine);
    } catch (err) {
      teardown(); // any failure: remove the custom cursor, native cursor returns
    }
  }
  engine();

  // Hover targets - grow
  var growSel = 'a, button, .btn, [role=button], .work-card, .filter-pill, .cert-card, .gallery-item, .blog-row, .we-row, .v3-btn, .v3-gallery-frame, .sw-card, .panel-close-btn, input, textarea, select';
  var imgSel = '.v3-gallery-frame img, .panel-gallery img, .gallery-item img, .work-card img, .card-img';

  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    // Native-cursor zones (iframes, embeds, form fields)
    if (t.closest(NATIVE_SEL)) {
      nativeZone = true;
      deactivate();
      return;
    }
    if (nativeZone) { nativeZone = false; activate(); }
    if (t.closest(imgSel)) {
      lead.classList.add('is-grow-img');
      trail.classList.add('is-grow-img');
    } else if (t.closest(growSel)) {
      lead.classList.add('is-grow');
      trail.classList.add('is-grow');
    }
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(imgSel)) {
      lead.classList.remove('is-grow-img');
      trail.classList.remove('is-grow-img');
    } else if (t.closest(growSel)) {
      lead.classList.remove('is-grow');
      trail.classList.remove('is-grow');
    }
    // Pointer left the document entirely
    if (!e.relatedTarget) deactivate();
  });

  // Window leave / blur / hidden tab: native cursor back, custom hidden
  root.addEventListener('mouseleave', deactivate);
  window.addEventListener('blur', deactivate);
  window.addEventListener('pagehide', deactivate);
  document.addEventListener('visibilitychange', function () { if (document.hidden) deactivate(); });
  // Re-entering the window: the next mousemove re-activates (see above)
})();
