/* =========================================================
   ANIMATIONS — SK Portfolio
   - Hero character split reveal
   - Staggered section reveals
   - Scroll reveal (IntersectionObserver)
   - Hero 3D tilt
   - Parallax on hero background
   - Stat counter
   - Active nav
   - Marquee velocity
   - Magnetic CTA buttons
   - Scroll progress bar
   ========================================================= */

// ─── Hero character split animation ─────────────────────────
(function() {
  var nameFirst = document.querySelector('.name-first');
  var nameLast  = document.querySelector('.name-last');
  if (!nameFirst && !nameLast) return;

  function splitChars(el, baseDelay) {
    var text = el.textContent.trim();
    var row = document.createElement('span');
    row.className = 'char-row';
    text.split('').forEach(function(ch, i) {
      var span = document.createElement('span');
      span.className = 'char';
      span.textContent = ch;
      span.style.transitionDelay = (baseDelay + i * 0.038) + 's';
      row.appendChild(span);
    });
    el.textContent = '';
    el.appendChild(row);
  }

  if (nameFirst) splitChars(nameFirst, 0.05);
  if (nameLast)  splitChars(nameLast,  0.12);

  // Trigger on next paint
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      document.querySelectorAll('.hero-name .char').forEach(function(c) {
        c.classList.add('in');
      });
    });
  });
})();

// ─── Hero 3D tilt ────────────────────────────────────────────
(function() {
  var hero     = document.querySelector('.hero');
  var heroName = document.querySelector('.hero-name');
  if (!hero || !heroName) return;
  if (window.matchMedia('(hover: none)').matches) return;

  heroName.style.transition = 'transform 0.18s ease-out';
  heroName.style.willChange = 'transform';

  hero.addEventListener('mousemove', function(e) {
    var rect = hero.getBoundingClientRect();
    var dx = (e.clientX - (rect.left + rect.width  / 2)) / (rect.width  / 2);
    var dy = (e.clientY - (rect.top  + rect.height / 2)) / (rect.height / 2);
    heroName.style.transform =
      'perspective(1400px) rotateX(' + (-dy * 4) + 'deg) rotateY(' + (dx * 4) + 'deg)';
  });
  hero.addEventListener('mouseleave', function() {
    heroName.style.transform = 'perspective(1400px) rotateX(0deg) rotateY(0deg)';
  });
})();

// ─── Parallax on hero background number ──────────────────────
(function() {
  var bg = document.querySelector('.hero-number');
  if (!bg) return;
  window.addEventListener('scroll', function() {
    bg.style.transform = 'translateY(calc(-50% + ' + (window.scrollY * 0.22) + 'px))';
  }, { passive: true });
})();

// ─── Scroll reveal ───────────────────────────────────────────
(function() {
  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.06 });
  reveals.forEach(function(el) { observer.observe(el); });
})();

// ─── Staggered children reveal ───────────────────────────────
(function() {
  var parents = document.querySelectorAll('[data-stagger]');
  if (!parents.length) return;

  parents.forEach(function(parent) {
    Array.from(parent.children).forEach(function(child, i) {
      child.style.transitionDelay = (i * 0.08) + 's';
    });
  });

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('staggered');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.05 });

  parents.forEach(function(p) { observer.observe(p); });
})();

// ─── Stat counter animation ───────────────────────────────────
(function() {
  var stats = document.querySelectorAll('.stat-num[data-target]');
  if (!stats.length) return;

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function animateStat(el) {
    var target   = parseFloat(el.dataset.target);
    var suffix   = el.dataset.suffix  || '';
    var prefix   = el.dataset.prefix  || '';
    var decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : 0;
    var duration = 1800;
    var start    = performance.now();
    function step(now) {
      var p = Math.min((now - start) / duration, 1);
      el.textContent = prefix + (target * easeOut(p)).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { animateStat(e.target); observer.unobserve(e.target); }
    });
  }, { threshold: 0.5 });

  stats.forEach(function(el) { observer.observe(el); });
})();

// ─── Active nav link ──────────────────────────────────────────
(function() {
  var path = window.location.pathname.split('/').pop() || 'index.html';
  // Handle blog post subdirectory
  if (window.location.pathname.includes('/blog/')) {
    document.querySelectorAll('.nav-links a[href="blog.html"]').forEach(function(a) {
      a.classList.add('active');
    });
    return;
  }
  document.querySelectorAll('.nav-links a').forEach(function(a) {
    var href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
})();

// ─── Marquee scroll velocity ──────────────────────────────────
(function() {
  var tracks = document.querySelectorAll('.marquee-track');
  if (!tracks.length) return;
  var lastY = 0, velocity = 0, ticking = false;

  window.addEventListener('scroll', function() {
    var y = window.scrollY;
    velocity = Math.abs(y - lastY);
    lastY = y;
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function() {
        var speed = Math.max(28 - velocity * 0.35, 7);
        tracks.forEach(function(t) { t.style.animationDuration = speed + 's'; });
        ticking = false;
      });
    }
  }, { passive: true });
})();

// ─── Mobile nav toggle ────────────────────────────────────────
(function() {
  var hamburger = document.getElementById('hamburger');
  var navLinks  = document.getElementById('navLinks');
  if (!hamburger || !navLinks) return;
  hamburger.addEventListener('click', function() { navLinks.classList.toggle('open'); });
  // Close on link click
  navLinks.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() { navLinks.classList.remove('open'); });
  });
})();

// ─── Magnetic CTA buttons ─────────────────────────────────────
(function() {
  if (window.matchMedia('(hover: none)').matches) return;
  var btns = document.querySelectorAll('.btn-primary, .btn-outline-yellow');
  btns.forEach(function(btn) {
    var leaving = false;

    btn.addEventListener('mousemove', function(e) {
      leaving = false;
      var rect = btn.getBoundingClientRect();
      var x = (e.clientX - rect.left - rect.width  / 2) * 0.22;
      var y = (e.clientY - rect.top  - rect.height / 2) * 0.28;
      btn.style.transition = 'transform 0.15s ease, color 0.35s cubic-bezier(0.76,0,0.24,1), border-color 0.35s cubic-bezier(0.76,0,0.24,1), background-position 0.45s cubic-bezier(0.76,0,0.24,1)';
      btn.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    });

    btn.addEventListener('mouseleave', function() {
      leaving = true;
      btn.style.transition = 'transform 0.55s cubic-bezier(0.16,1,0.3,1), color 0.35s cubic-bezier(0.76,0,0.24,1), border-color 0.35s cubic-bezier(0.76,0,0.24,1), background-position 0.45s cubic-bezier(0.76,0,0.24,1)';
      btn.style.transform = 'translate(0,0)';
    });
  });
})();

// ─── Scroll progress bar ─────────────────────────────────────
(function() {
  var bar = document.getElementById('scrollProgress');
  if (!bar) return;
  window.addEventListener('scroll', function() {
    var total = document.documentElement.scrollHeight - window.innerHeight;
    var pct = total > 0 ? (window.scrollY / total) * 100 : 0;
    bar.style.width = pct + '%';
  }, { passive: true });
})();
