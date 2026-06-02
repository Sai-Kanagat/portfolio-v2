/* =========================================================
   HERO EXPERIENCE — scroll-driven 3-layer choreography.
   One sticky viewport, three layered stages.
   Scroll progress through .hero-experience (0..1):
     0.00 – 0.18 : Layer 1 fully visible, shutter at 0°
     0.18 – 0.78 : Shutter slats flip 0° → 180° (staggered)
     0.78 – 0.95 : Layer 3 fades in
     0.95 +      : Layer 3 fully visible, exits as user scrolls past
   ========================================================= */
(function(){
  var experience = document.getElementById('heroExperience');
  var field = document.getElementById('shutterField');
  var layer1 = document.getElementById('heroLayer1');
  var layer3 = document.getElementById('heroLayer3');
  if (!experience || !field || !layer1 || !layer3) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var SLATS = 6;
  for (var i = 0; i < SLATS; i++) {
    var lv = document.createElement('div');
    lv.className = 'louver';
    lv.innerHTML = '<div class="side side-front"></div><div class="side side-back"></div>';
    field.appendChild(lv);
  }
  var louvers = field.querySelectorAll('.louver');

  function easeInOutCubic(x){
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
  function mapRange(value, a, b){
    return clamp((value - a) / (b - a), 0, 1);
  }

  var ticking = false;
  function update(){
    var rect = experience.getBoundingClientRect();
    var sectionHeight = experience.offsetHeight;
    var viewportH = window.innerHeight;
    var travel = sectionHeight - viewportH;
    var scrolled = -rect.top;
    var progress = clamp(scrolled / travel, 0, 1);

    // Layer 1 stays fully opaque — the shutter's ink back side covers it as the blinds flip.
    // (Previously faded 0.18→0.45 which started before the blinds visibly closed, causing a
    //  ghosty pre-fade on the logo. Removed.)
    layer1.style.opacity = '1';

    // Shutter slat rotations (0..1 maps to 0..180 with stagger)
    var shutterStart = 0.12, shutterEnd = 0.62;
    var shutterT = mapRange(progress, shutterStart, shutterEnd);
    for (var i = 0; i < louvers.length; i++) {
      var stagger = i * 0.07;
      var local = clamp((shutterT - stagger) / (1 - stagger * 0.5), 0, 1);
      var eased = easeInOutCubic(local);
      var rot = eased * 180;
      louvers[i].style.transform = 'rotateX(' + rot + 'deg)';
    }

    // Layer 3 fade in — completes well before the pin releases so no dead scroll
    var l3 = mapRange(progress, 0.55, 0.74);
    layer3.style.opacity = l3.toFixed(3);
    layer3.style.pointerEvents = l3 > 0.9 ? 'all' : 'none';

    ticking = false;
  }
  function onScroll(){
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
