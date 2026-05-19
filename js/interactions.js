/* =========================================================
   INTERACTIONS — magnetic buttons + 3D card tilt
   Inspiration: valentingassend.com/lab
   Pure JS, no deps. Respects prefers-reduced-motion.
   ========================================================= */
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Read interaction tokens from CSS (single source of truth)
  function readToken(name, fallback){
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }
  var MAG_RADIUS   = readToken('--magnetic-radius', 110);
  var MAG_STRENGTH = readToken('--magnetic-strength', 0.28);
  var TILT_MAX     = readToken('--tilt-max', 4);
  var TILT_PERSPECTIVE = readToken('--tilt-perspective', 1000);

  function bindMagnetic(){
    document.querySelectorAll('.btn, .nav-score-btn, .filter-pill, .btn-primary, .btn-outline, .btn-outline-yellow, .nav-back, .demo-back, .lb-close, .lb-prev, .lb-next, [data-magnetic]').forEach(function(el){
      if (el.dataset.magneticBound === 'true') return;
      el.dataset.magneticBound = 'true';
      el.style.transition = 'transform 0.45s cubic-bezier(0.2,0.8,0.2,1)';
      el.style.willChange = 'transform';

      el.addEventListener('mousemove', function(e){
        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var dist = Math.hypot(dx, dy);
        if (dist > MAG_RADIUS) return;
        var pull = (1 - dist / MAG_RADIUS) * MAG_STRENGTH;
        el.style.transform = 'translate(' + (dx * pull) + 'px, ' + (dy * pull) + 'px)';
      });
      el.addEventListener('mouseleave', function(){
        el.style.transform = 'translate(0, 0)';
      });
    });
  }

  // ---- 3D CARD TILT ----
  // Tilt cards toward cursor. TILT_MAX + TILT_PERSPECTIVE come from CSS tokens above.
  function bindTilt(){
    document.querySelectorAll('.work-card, .demo-tile, .blog-row, .principle, .swatch, .agent-card, [data-tilt]').forEach(function(el){
      if (el.dataset.tiltBound === 'true') return;
      el.dataset.tiltBound = 'true';
      el.style.transformStyle = 'preserve-3d';
      el.style.transition = 'transform 0.4s cubic-bezier(0.2,0.8,0.2,1)';
      el.style.willChange = 'transform';

      var raf = null;
      el.addEventListener('mousemove', function(e){
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function(){
          var r = el.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width;  // 0..1
          var py = (e.clientY - r.top) / r.height;  // 0..1
          var rx = (py - 0.5) * -TILT_MAX * 2;       // rotateX
          var ry = (px - 0.5) *  TILT_MAX * 2;       // rotateY
          el.style.transform =
            'perspective(' + TILT_PERSPECTIVE + 'px) ' +
            'rotateX(' + rx.toFixed(2) + 'deg) ' +
            'rotateY(' + ry.toFixed(2) + 'deg) ' +
            'translateZ(0)';
          el.style.transitionDuration = '0.08s';
        });
      });
      el.addEventListener('mouseleave', function(){
        el.style.transitionDuration = '0.4s';
        el.style.transform = 'perspective(' + TILT_PERSPECTIVE + 'px) rotateX(0deg) rotateY(0deg) translateZ(0)';
      });
    });
  }

  function init(){
    bindMagnetic();
    bindTilt();
    // Re-bind after DOM mutations (project panel renders, etc.)
    var obs = new MutationObserver(function(){ bindMagnetic(); bindTilt(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
