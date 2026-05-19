/* =========================================================
   PAGE LOADER — SK Portfolio
   First-visit intro: count 00 → 100, logo reveal, curtain lift
   ========================================================= */

(function() {
  // Only show full loader on landing page, once per session
  var isHome = /(^\/$|index\.html?$)/.test(window.location.pathname) || window.location.pathname === '/';
  var alreadyShown = sessionStorage.getItem('sk_loader_shown');

  // Build loader DOM immediately (before paint)
  var loader = document.createElement('div');
  loader.className = 'site-loader';
  loader.id = 'siteLoader';
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

  // Skip for secondary pages OR if already shown this session
  if (!isHome || alreadyShown) {
    // Quick fade loader for route changes
    loader.classList.add('site-loader-quick');
    document.documentElement.classList.add('loading');
    document.addEventListener('DOMContentLoaded', function() {
      document.body.prepend(loader);
      requestAnimationFrame(function() {
        loader.classList.add('done');
        setTimeout(function() {
          loader.remove();
          document.documentElement.classList.remove('loading');
          document.dispatchEvent(new CustomEvent('sk:loaded'));
        }, 650);
      });
    });
    return;
  }

  document.documentElement.classList.add('loading');

  document.addEventListener('DOMContentLoaded', function() {
    document.body.prepend(loader);
    var count = document.getElementById('loaderCount');
    var bar = document.getElementById('loaderBar');
    var phase = document.getElementById('loaderPhase');

    var phases = [
      [0, 'Initialising'],
      [25, 'Loading type'],
      [55, 'Preparing work'],
      [80, 'Calibrating grid'],
      [100, 'Ready']
    ];

    var duration = 1400;
    var start = performance.now();

    function step(now) {
      var t = Math.min((now - start) / duration, 1);
      var eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
      var pct = Math.round(eased * 100);
      count.textContent = (pct < 10 ? '0' : '') + pct;
      bar.style.width = pct + '%';
      for (var i = phases.length - 1; i >= 0; i--) {
        if (pct >= phases[i][0]) { phase.textContent = phases[i][1]; break; }
      }
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        sessionStorage.setItem('sk_loader_shown', '1');
        setTimeout(function() {
          loader.classList.add('done');
          setTimeout(function() {
            loader.remove();
            document.documentElement.classList.remove('loading');
            document.dispatchEvent(new CustomEvent('sk:loaded'));
          }, 950);
        }, 200);
      }
    }
    requestAnimationFrame(step);
  });
})();
