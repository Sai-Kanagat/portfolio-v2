/* =========================================================
   AMBIENT FLOATING ICONS — global background drift
   Subtle, calm motion behind page content.
   Replaces the legacy bouncing skills canvas.
   ========================================================= */

(function() {
  var canvas = document.getElementById('ambientFloat') || document.getElementById('skillsCanvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Curated subset of tools — fewer icons for calmer composition
  var SKILLS = [
    { label: 'Figma',       color: '#F24E1E', logo: 'figma.svg' },
    { label: 'Photoshop',   color: '#31A8FF', logo: 'photoshop.svg' },
    { label: 'Illustrator', color: '#FF9A00', logo: 'illustrator.svg' },
    { label: 'Rhino',       color: '#801010', logo: 'rhino.svg' },
    { label: 'Fusion 360',  color: '#F36F21', logo: 'fusion360.svg' },
    { label: 'Blender',     color: '#F5792A', logo: 'blender.svg' },
    { label: 'KeyShot',     color: '#FFCC00', logo: 'keyshot.svg' },
    { label: 'After FX',    color: '#9999FF', logo: 'aftereffects.svg' },
    { label: 'Premiere',    color: '#9999FF', logo: 'premiere.svg' },
    { label: 'Meta Ads',    color: '#0866FF', logo: 'meta.svg' },
    { label: 'Google Ads',  color: '#4285F4', logo: 'googleads.svg' },
    { label: 'GA4',         color: '#E37400', logo: 'ga4.svg' },
    { label: 'Webflow',     color: '#4353FF', logo: 'webflow.svg' },
    { label: 'Framer',      color: '#0055FF', logo: 'framer.svg' },
    { label: 'Claude',      color: '#D97757', logo: 'claude.svg' },
    { label: 'ChatGPT',     color: '#10A37F', logo: 'chatgpt.svg' },
    { label: 'Notion',      color: '#1a1a1a', logo: 'notion.svg' },
    { label: 'GitHub',      color: '#1a1a1a', logo: 'github.svg' }
  ];

  var LOGO_BASE = 'assets/logos/';
  SKILLS.forEach(function(s) {
    var img = new Image();
    img.src = LOGO_BASE + s.logo;
    s.img = img;
  });

  var W = 0, H = 0;
  var icons = [];
  var mouse = { x: -9999, y: -9999, active: false };
  var scrollY = 0;
  var lastScrollY = 0;
  var scrollDelta = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener('mousemove', function(e){
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }, { passive: true });
  window.addEventListener('mouseleave', function(){ mouse.active = false; });
  window.addEventListener('scroll', function(){
    scrollY = window.scrollY || window.pageYOffset;
  }, { passive: true });

  function spawn() {
    icons = [];
    var density = Math.min(SKILLS.length, Math.max(8, Math.floor(W * H / 100000)));
    var pick = SKILLS.slice().sort(function(){ return Math.random() - 0.5; }).slice(0, density);
    pick.forEach(function(s) {
      var depth = Math.random();
      var r = 18 + depth * 26;
      // Each icon gets a wandering heading angle for smooth curved drift
      icons.push({
        label: s.label,
        color: s.color,
        img: s.img,
        r: r,
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.0015,
        phase: Math.random() * Math.PI * 2,
        // Slow-changing heading angle — gives icons natural curved paths instead of jitter
        heading: Math.random() * Math.PI * 2,
        headingDrift: (Math.random() - 0.5) * 0.015,
        // Noise phases for organic Perlin-like flow
        noiseSeed: Math.random() * 1000,
        parallax: 0.3 + depth * 0.7,
        alpha: 0.30 + depth * 0.45
      });
    });
  }

  var t = 0;
  function step() {
    t += 0.008;
    // Scroll parallax — measure delta and use it to gently push icons
    scrollDelta = (scrollY - lastScrollY) * 0.04;
    lastScrollY = scrollY;
    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < icons.length; i++) {
      var b = icons[i];

      // Cursor reactivity — bigger push, wider radius
      if (mouse.active) {
        var dx = b.x - mouse.x;
        var dy = b.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        var range = 200;
        if (d2 < range * range && d2 > 0.001) {
          var d = Math.sqrt(d2);
          // Quadratic falloff — strongest at center, fades out gently
          var falloff = 1 - d / range;
          var force = falloff * falloff * 2.6;
          b.vx += (dx / d) * force;
          b.vy += (dy / d) * force;
        }
      }

      // Scroll parallax — different icons get different parallax weights for depth
      b.vy -= scrollDelta * b.parallax * 1.5;

      // Natural drift — wandering heading angle gives smooth curved paths (not jittery)
      b.heading += b.headingDrift;
      // Slow drift of the drift-rate itself — heading occasionally changes direction
      b.headingDrift += (Math.random() - 0.5) * 0.0008;
      // Clamp the drift rate
      if (b.headingDrift > 0.025) b.headingDrift = 0.025;
      if (b.headingDrift < -0.025) b.headingDrift = -0.025;
      // Push along the current heading at a small constant rate
      var driftSpeed = 0.06;
      b.vx += Math.cos(b.heading) * driftSpeed;
      b.vy += Math.sin(b.heading) * driftSpeed;

      // Layered Gaussian-ish micro-jitter (sum of 3 uniforms ≈ normal distribution)
      var jx = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 0.04;
      var jy = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 0.04;
      b.vx += jx;
      b.vy += jy;

      // Damping
      b.vx *= 0.97;
      b.vy *= 0.97;
      // Cap velocity
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      var max = 2.6;
      if (sp > max) { b.vx = b.vx / sp * max; b.vy = b.vy / sp * max; }

      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vrot;

      // Bounce off screen edges with damping (instead of wrap)
      var pad = b.r;
      if (b.x < pad) {
        b.x = pad;
        b.vx = Math.abs(b.vx) * 0.6;
        b.heading = Math.PI - b.heading; // turn around
      } else if (b.x > W - pad) {
        b.x = W - pad;
        b.vx = -Math.abs(b.vx) * 0.6;
        b.heading = Math.PI - b.heading;
      }
      if (b.y < pad) {
        b.y = pad;
        b.vy = Math.abs(b.vy) * 0.6;
        b.heading = -b.heading;
      } else if (b.y > H - pad) {
        b.y = H - pad;
        b.vy = -Math.abs(b.vy) * 0.6;
        b.heading = -b.heading;
      }

      // Subtle vertical bob
      var bob = Math.sin(t + b.phase) * 0.4;

      ctx.save();
      ctx.translate(b.x, b.y + bob);
      ctx.rotate(b.rot);
      ctx.globalAlpha = b.alpha;
      if (b.img && b.img.complete && b.img.naturalWidth > 0) {
        try {
          ctx.drawImage(b.img, -b.r, -b.r, b.r * 2, b.r * 2);
        } catch(e) {}
      }
      ctx.restore();
    }

    requestAnimationFrame(step);
  }

  function init() {
    resize();
    spawn();
    window.addEventListener('resize', function(){ resize(); spawn(); });
    // Respect reduced motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.display = 'none';
      return;
    }
    requestAnimationFrame(step);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
