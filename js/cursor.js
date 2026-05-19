/* =========================================================
   CUSTOM CURSOR — SK Portfolio
   Dot (yellow, velocity-stretched) + trailing ring
   ========================================================= */

(function() {
  if (window.matchMedia('(hover: none)').matches) return;

  var dot  = document.createElement('div');
  var ring = document.createElement('div');
  dot.className  = 'cursor-dot';
  ring.className = 'cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  var mx = -100, my = -100;
  var rx = -100, ry = -100;
  var prevX = -100, prevY = -100;
  var velX = 0, velY = 0;
  var isGrown = false;

  document.addEventListener('mousemove', function(e) {
    velX = e.clientX - prevX;
    velY = e.clientY - prevY;
    prevX = mx; prevY = my;
    mx = e.clientX;
    my = e.clientY;

    if (!isGrown) {
      var speed = Math.sqrt(velX * velX + velY * velY);
      var scaleX = Math.min(1 + speed * 0.025, 2.2);
      var angle  = Math.atan2(velY, velX) * (180 / Math.PI);
      dot.style.transform =
        'translate(' + mx + 'px,' + my + 'px) rotate(' + angle + 'deg) scaleX(' + scaleX + ')';
    } else {
      dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
    }
  });

  // Ring follows with lerp
  function animateRing() {
    rx += (mx - rx) * 0.1;
    ry += (my - ry) * 0.1;
    ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  // Grow on interactive elements
  var selectors = 'a, button, .work-card, .filter-pill, .cert-card, .gallery-item, .blog-row, .score-option, input, textarea, select';
  document.addEventListener('mouseover', function(e) {
    if (e.target.closest(selectors)) {
      isGrown = true;
      dot.classList.add('cursor-grow');
      ring.classList.add('cursor-grow');
      dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
    }
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest(selectors)) {
      isGrown = false;
      dot.classList.remove('cursor-grow');
      ring.classList.remove('cursor-grow');
    }
  });

  // Hide default
  document.body.style.cursor = 'none';
  document.querySelectorAll('a, button, input, textarea, select').forEach(function(el) {
    el.style.cursor = 'none';
  });

  // Fade on window leave/enter
  document.addEventListener('mouseleave', function() {
    dot.style.opacity = '0'; ring.style.opacity = '0';
  });
  document.addEventListener('mouseenter', function() {
    dot.style.opacity = '1'; ring.style.opacity = '1';
  });
})();
