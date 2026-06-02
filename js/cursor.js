/* =========================================================
   CUSTOM CURSOR — Magnetic Friction (SK Portfolio)
   Two shapes with target-LERP physics, branded colours.
   Shape A (lead): ink circle, faster friction (0.18)
   Shape B (trail): ultramarine square 45° rotated, slower (0.08)
   Both shapes pass through hover targets cleanly (pointer-events:none).
   Disabled on touch/coarse pointer.
   ========================================================= */

(function () {
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  // Build DOM
  var lead  = document.createElement('div');
  var trail = document.createElement('div');
  lead.className  = 'mag-cursor mag-lead';
  trail.className = 'mag-cursor mag-trail';
  document.body.appendChild(lead);
  document.body.appendChild(trail);

  // Scoped CSS (so deletion of brand-overlay rules doesn't kill the cursor)
  if (!document.getElementById('mag-cursor-styles')) {
    var s = document.createElement('style');
    s.id = 'mag-cursor-styles';
    s.textContent = [
      '.mag-cursor{position:fixed;top:0;left:0;pointer-events:none;will-change:transform;z-index:9999;mix-blend-mode:difference;}',
      '.mag-lead{width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#ffffff;transition:width .25s cubic-bezier(.2,.8,.2,1),height .25s cubic-bezier(.2,.8,.2,1),margin .25s cubic-bezier(.2,.8,.2,1),background .25s ease,opacity .2s ease;}',
      '.mag-trail{width:42px;height:42px;margin:-21px 0 0 -21px;border:1.5px solid #ffffff;transition:width .35s cubic-bezier(.2,.8,.2,1),height .35s cubic-bezier(.2,.8,.2,1),margin .35s cubic-bezier(.2,.8,.2,1),border-color .25s ease,opacity .2s ease;mix-blend-mode:exclusion;}',
      '.mag-lead.is-grow{width:46px;height:46px;margin:-23px 0 0 -23px;background:#1F40C7;mix-blend-mode:normal;}',
      '.mag-trail.is-grow{width:78px;height:78px;margin:-39px 0 0 -39px;border-color:#1F40C7;mix-blend-mode:normal;}',
      '.mag-trail.is-grow-img{width:120px;height:120px;margin:-60px 0 0 -60px;border-color:#ffffff;background:rgba(255,255,255,0.04);}',
      '.mag-lead.is-grow-img{background:#ffffff;}',
      '.mag-lead.is-hide,.mag-trail.is-hide{opacity:0;}',
      'html, body, a, button, .btn, [role=button], input, textarea, select { cursor: none !important; }',
      '@media (hover: none), (pointer: coarse) { .mag-cursor { display: none !important; } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  // Pointer + interpolation state
  var mx = window.innerWidth / 2, my = window.innerHeight / 2;
  var lx = mx, ly = my;
  var tx = mx, ty = my, tr = 45; // trail rotation accumulates for organic feel

  window.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
  }, { passive: true });

  function engine() {
    // Lead: faster TLERP — feels attached, responsive
    lx += (mx - lx) * 0.22;
    ly += (my - ly) * 0.22;
    // Trail: slower TLERP — creates elasticity / separation
    tx += (mx - tx) * 0.10;
    ty += (my - ty) * 0.10;
    // Trail rotation drifts slowly with movement direction for organic motion
    var dx = mx - tx, dy = my - ty;
    var targetAng = Math.atan2(dy, dx) * 180 / Math.PI;
    tr += (targetAng - tr) * 0.04;

    lead.style.transform  = 'translate3d(' + lx + 'px,' + ly + 'px,0)';
    trail.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) rotate(' + tr + 'deg)';
    requestAnimationFrame(engine);
  }
  engine();

  // Hover targets — grow + change colour to ultramarine
  var growSel = 'a, button, .btn, [role=button], .work-card, .filter-pill, .cert-card, .gallery-item, .blog-row, .we-row, .v3-btn, .v3-gallery-frame, .sw-card, .panel-close-btn, input, textarea, select';
  var imgSel = '.v3-gallery-frame img, .panel-gallery img, .gallery-item img, .work-card img, .card-img';

  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
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
  });

  // Hide on window leave
  document.addEventListener('mouseleave', function () {
    lead.classList.add('is-hide');
    trail.classList.add('is-hide');
  });
  document.addEventListener('mouseenter', function () {
    lead.classList.remove('is-hide');
    trail.classList.remove('is-hide');
  });
})();
