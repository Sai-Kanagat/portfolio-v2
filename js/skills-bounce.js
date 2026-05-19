/* =========================================================
   BOUNCING SKILLS LOGOS — SK Portfolio
   Lightweight 2D physics: circles collide, bounce off walls,
   repel from mouse cursor. No dependencies.
   ========================================================= */

(function() {
  var canvas = document.getElementById('skillsCanvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var container = canvas.parentElement;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Skill definitions: label + brand colour + logo svg (fallback to text if logo missing)
  var SKILLS = [
    // 3D / CAD / Industrial Design
    { label: 'Rhino 3D',   color: '#801010', r: 40, logo: 'rhino.svg' },
    { label: 'SolidWorks', color: '#D32E2E', r: 40, logo: 'solidworks.svg' },
    { label: 'Fusion 360', color: '#F36F21', r: 40, logo: 'fusion360.svg' },
    { label: 'AutoCAD',    color: '#E51F24', r: 38, logo: 'autocad.svg' },
    { label: 'KeyShot',    color: '#FFCC00', r: 38, logo: 'keyshot.svg' },
    { label: 'Blender',    color: '#F5792A', r: 38, logo: 'blender.svg' },
    { label: 'Cinema 4D',  color: '#011A6A', r: 38, logo: 'cinema4d.svg' },
    { label: 'SketchUp',   color: '#005F9E', r: 38, logo: 'sketchup.svg' },
    // 2D Design
    { label: 'Figma',      color: '#F24E1E', r: 42, logo: 'figma.svg' },
    { label: 'Photoshop',  color: '#31A8FF', r: 42, logo: 'photoshop.svg' },
    { label: 'Illustrator',color: '#FF9A00', r: 42, logo: 'illustrator.svg' },
    { label: 'InDesign',   color: '#FF3366', r: 40, logo: 'indesign.svg' },
    { label: 'Lightroom',  color: '#31A8FF', r: 38, logo: 'lightroom.svg' },
    { label: 'After FX',   color: '#9999FF', r: 38, logo: 'aftereffects.svg' },
    { label: 'Premiere',   color: '#9999FF', r: 40, logo: 'premiere.svg' },
    { label: 'Procreate',  color: '#1a1a1a', r: 38, logo: 'procreate.svg' },
    { label: 'Canva',      color: '#00C4CC', r: 38, logo: 'canva.svg' },
    // Marketing / Analytics
    { label: 'Meta Ads',   color: '#0866FF', r: 42, logo: 'meta.svg' },
    { label: 'Google Ads', color: '#4285F4', r: 42, logo: 'googleads.svg' },
    { label: 'GA4',        color: '#E37400', r: 38, logo: 'ga4.svg' },
    { label: 'GTM',        color: '#246FDB', r: 36, logo: 'gtm.svg' },
    { label: 'Search Console', color: '#34A853', r: 38, logo: 'searchconsole.svg' },
    { label: 'HubSpot',    color: '#FF7A59', r: 40, logo: 'hubspot.svg' },
    { label: 'Mailchimp',  color: '#FFE01B', r: 40, logo: 'mailchimp.svg' },
    { label: 'Klaviyo',    color: '#000000', r: 38, logo: 'klaviyo.svg' },
    { label: 'Hootsuite',  color: '#143059', r: 38, logo: 'hootsuite.svg' },
    { label: 'SEMrush',    color: '#FF642D', r: 38, logo: 'semrush.svg' },
    { label: 'Ahrefs',     color: '#0078E1', r: 38, logo: 'ahrefs.svg' },
    // Web / Dev
    { label: 'HTML/CSS',   color: '#E44D26', r: 38, logo: 'html5.svg' },
    { label: 'JavaScript', color: '#F7DF1E', r: 38, logo: 'javascript.svg' },
    { label: 'Webflow',    color: '#4353FF', r: 38, logo: 'webflow.svg' },
    { label: 'Framer',     color: '#0055FF', r: 38, logo: 'framer.svg' },
    { label: 'WordPress',  color: '#21759B', r: 38, logo: 'wordpress.svg' },
    { label: 'VS Code',    color: '#007ACC', r: 38, logo: 'vscode.svg' },
    { label: 'Claude Code',color: '#D97757', r: 40, logo: 'claude.svg' },
    { label: 'GitHub',     color: '#1a1a1a', r: 38, logo: 'github.svg' },
    { label: 'Netlify',    color: '#00C7B7', r: 36, logo: 'netlify.svg' },
    { label: 'Vercel',     color: '#1a1a1a', r: 36, logo: 'vercel.svg' },
    { label: 'Notion',     color: '#1a1a1a', r: 38, logo: 'notion.svg' },
    // AI
    { label: 'ChatGPT',    color: '#10A37F', r: 38, logo: 'chatgpt.svg' },
    { label: 'Claude',     color: '#D97757', r: 38, logo: 'claude.svg' },
    { label: 'Gemini',     color: '#4285F4', r: 36, logo: 'gemini.svg' },
    { label: 'Midjourney', color: '#1a1a1a', r: 38, logo: 'midjourney.svg' },
    { label: 'Runway',     color: '#1a1a1a', r: 36, logo: 'runway.svg' },
    // Fabrication (no logos — text only)
    { label: 'Welding',    color: '#FF6B35', r: 36, logo: '_none' },
    { label: '3D Print',   color: '#0a0a0a', r: 36, logo: '_none' },
    { label: 'Laser Cut',  color: '#E51F24', r: 36, logo: '_none' },
    { label: 'CNC Router', color: '#1a1a1a', r: 36, logo: '_none' },
    { label: 'Wood Shop',  color: '#8B5A2B', r: 36, logo: '_none' }
  ];

  // Preload logo images
  var LOGO_BASE = 'assets/logos/';
  SKILLS.forEach(function(s) {
    var img = new Image();
    img.src = LOGO_BASE + s.logo;
    s.img = img;
  });

  var W = 0, H = 0;
  var balls = [];
  var mouse = { x: -9999, y: -9999, active: false };
  var running = false;
  var observer;

  function resize() {
    var rect = container.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function spawn() {
    balls = [];
    var fontScale = W < 640 ? 0.72 : 1;
    SKILLS.forEach(function(s, i) {
      var r = s.r * fontScale;
      var angle = (i / SKILLS.length) * Math.PI * 2;
      var pad = r + 4;
      var x = pad + Math.random() * (W - pad * 2);
      var y = pad + Math.random() * (H - pad * 2);
      balls.push({
        label: s.label,
        color: s.color,
        img: s.img,
        r: r,
        x: x,
        y: y,
        vx: Math.cos(angle) * (0.6 + Math.random() * 0.8),
        vy: Math.sin(angle) * (0.6 + Math.random() * 0.8)
      });
    });
  }

  function step() {
    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];

      // Mouse repulsion
      if (mouse.active) {
        var dx = b.x - mouse.x;
        var dy = b.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        var range = 140;
        if (d2 < range * range && d2 > 0.001) {
          var d = Math.sqrt(d2);
          var force = (1 - d / range) * 0.9;
          b.vx += (dx / d) * force;
          b.vy += (dy / d) * force;
        }
      }

      // Slight damping so things don't explode
      b.vx *= 0.995;
      b.vy *= 0.995;

      // Cap velocity
      var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      var maxSpeed = 5;
      if (speed > maxSpeed) {
        b.vx = (b.vx / speed) * maxSpeed;
        b.vy = (b.vy / speed) * maxSpeed;
      }
      // Keep things moving
      if (speed < 0.25) {
        var a = Math.random() * Math.PI * 2;
        b.vx += Math.cos(a) * 0.1;
        b.vy += Math.sin(a) * 0.1;
      }

      b.x += b.vx;
      b.y += b.vy;

      // Walls
      if (b.x - b.r < 0)     { b.x = b.r;     b.vx = Math.abs(b.vx); }
      if (b.x + b.r > W)     { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y - b.r < 0)     { b.y = b.r;     b.vy = Math.abs(b.vy); }
      if (b.y + b.r > H)     { b.y = H - b.r; b.vy = -Math.abs(b.vy); }
    }

    // Ball-ball collisions
    for (var i = 0; i < balls.length; i++) {
      for (var j = i + 1; j < balls.length; j++) {
        var a = balls[i], c = balls[j];
        var dx = c.x - a.x, dy = c.y - a.y;
        var dist2 = dx * dx + dy * dy;
        var minDist = a.r + c.r;
        if (dist2 < minDist * minDist && dist2 > 0.001) {
          var dist = Math.sqrt(dist2);
          var nx = dx / dist, ny = dy / dist;
          var overlap = (minDist - dist) / 2;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          c.x += nx * overlap;
          c.y += ny * overlap;
          // Exchange velocity along normal
          var p = 2 * (a.vx * nx + a.vy * ny - c.vx * nx - c.vy * ny) / 2;
          a.vx -= p * nx;
          a.vy -= p * ny;
          c.vx += p * nx;
          c.vy += p * ny;
        }
      }
    }

    // Draw
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      // white circular background
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(10,10,10,0.12)';
      ctx.stroke();

      // logo image (inscribed square inside circle)
      if (b.img && b.img.complete && b.img.naturalWidth > 0) {
        var size = b.r * 1.25;
        ctx.drawImage(b.img, b.x - size / 2, b.y - size / 2, size, size);
      } else {
        // fallback while loading
        ctx.fillStyle = b.color;
        var fontSize = Math.max(10, Math.min(14, b.r * 0.3));
        ctx.font = '700 ' + fontSize + 'px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label.toUpperCase(), b.x, b.y);
      }
    }

    if (running) requestAnimationFrame(step);
  }

  function labelColor(bg) {
    // Quick perceived-brightness check
    var hex = bg.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
    var r = parseInt(hex.substr(0,2),16);
    var g = parseInt(hex.substr(2,2),16);
    var b = parseInt(hex.substr(4,2),16);
    var lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.6 ? '#1a1a1a' : '#f5f0e8';
  }

  function bindMouse() {
    container.addEventListener('mousemove', function(e) {
      var rect = container.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    });
    container.addEventListener('mouseleave', function() {
      mouse.active = false;
      mouse.x = -9999; mouse.y = -9999;
    });
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(step);
  }
  function stop() {
    running = false;
  }

  function init() {
    resize();
    spawn();
    bindMouse();
    // Only run when visible
    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) start(); else stop();
      });
    }, { threshold: 0.1 });
    observer.observe(container);
    window.addEventListener('resize', function() {
      resize();
      spawn();
    });
  }

  // Wait for loader if present, else init after DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
