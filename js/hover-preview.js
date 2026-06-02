/* =========================================================
   HOVER PREVIEW — show the full uncropped image when hovering
   any cropped thumbnail in the project panel, work grid, or
   gallery. Magnetic positioning (follows cursor, clamped to
   viewport). Disabled on touch.
   ========================================================= */
(function () {
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  // Inject styles
  if (!document.getElementById('hp-styles')) {
    var s = document.createElement('style'); s.id = 'hp-styles';
    s.textContent = [
      '.hp-preview{position:fixed;top:0;left:0;z-index:9000;pointer-events:none;opacity:0;will-change:transform,opacity;',
      '  transition:opacity .25s cubic-bezier(.32,.72,0,1);',
      '  filter:drop-shadow(0 24px 60px rgba(10,10,10,0.45));}',
      '.hp-preview.is-on{opacity:1;}',
      '.hp-preview img{display:block;max-width:42vw;max-height:62vh;width:auto;height:auto;border-radius:14px;',
      '  background:#f4f3ef;box-shadow:0 0 0 1px rgba(10,10,10,0.12), 0 1px 0 rgba(255,255,255,0.6);}',
      '.hp-preview .hp-cap{margin-top:8px;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:0.22em;',
      '  text-transform:uppercase;color:rgba(244,243,239,0.85);background:rgba(10,10,10,0.78);',
      '  backdrop-filter:blur(10px);padding:5px 10px;border-radius:999px;display:inline-block;',
      '  max-width:42vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '@media (max-width:768px){.hp-preview{display:none !important;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  var preview = document.createElement('div');
  preview.className = 'hp-preview';
  preview.innerHTML = '<img alt=""/><div class="hp-cap"></div>';
  document.body.appendChild(preview);
  var pImg = preview.querySelector('img');
  var pCap = preview.querySelector('.hp-cap');

  var mx = 0, my = 0;
  var raf = null;
  var current = null;

  function positionPreview() {
    var pad = 16;
    var rect = preview.getBoundingClientRect();
    // Default: above and right of cursor
    var x = mx + 28;
    var y = my - rect.height / 2;
    // Clamp
    if (x + rect.width + pad > window.innerWidth) x = mx - rect.width - 28;
    if (y < pad) y = pad;
    if (y + rect.height + pad > window.innerHeight) y = window.innerHeight - rect.height - pad;
    preview.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    raf = null;
  }

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    if (current && !raf) raf = requestAnimationFrame(positionPreview);
  }, { passive: true });

  // Which images get hover preview
  var TARGETS = '.v3-gallery-frame img, .panel-gallery img, .work-grid .work-card img, .full-grid .work-card img, .work-card .card-img, .gallery-grid img, .gallery-masonry img, .we-preview img';

  function showFor(img) {
    var src = img.currentSrc || img.src;
    if (!src) return;
    current = img;
    pImg.src = src;
    pImg.alt = img.alt || '';
    var cap = img.alt || '';
    if (cap) { pCap.textContent = cap; pCap.style.display = ''; }
    else pCap.style.display = 'none';
    // Wait for image to load before showing (so dimensions are right)
    if (pImg.complete && pImg.naturalWidth) {
      requestAnimationFrame(function () { positionPreview(); preview.classList.add('is-on'); });
    } else {
      pImg.onload = function () {
        if (current !== img) return;
        positionPreview();
        preview.classList.add('is-on');
      };
    }
  }
  function hide() {
    current = null;
    preview.classList.remove('is-on');
  }

  // Event delegation — works for dynamically added gallery frames
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches(TARGETS)) {
      showFor(t);
    }
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches(TARGETS)) hide();
  });
  // Failsafe: hide if cursor leaves window
  document.addEventListener('mouseleave', hide);
  // Hide while scrolling so it doesn't lag visually
  var scrollHide;
  document.addEventListener('scroll', function () {
    if (!current) return;
    preview.classList.remove('is-on');
    clearTimeout(scrollHide);
    scrollHide = setTimeout(function () {
      if (current) preview.classList.add('is-on');
    }, 120);
  }, { passive: true, capture: true });
})();
