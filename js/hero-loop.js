/* =========================================================
   HERO LOOP — Direction B · WIPE
   Pure SVG + RAF port of /scenes/direction-b.jsx
   10s seamless loop · ink background · no closing tagline
   Falls back to static lockup if prefers-reduced-motion.
   ========================================================= */
(function(){
  var host = document.getElementById('heroLoop');
  if (!host) return;

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var INK    = 'oklch(0.16 0.012 260)';
  var PAPER  = 'oklch(0.975 0.004 260)';
  var ACCENT = 'oklch(0.42 0.21 265)';
  var ACCENT_UP = 'oklch(0.55 0.22 262)';

  var W = 1280, H = 720;
  var GIANT = 1600;       // mark fills the canvas
  var FINAL = 220;        // contracted lockup size
  var WM_SIZE = 60;
  var GAP = 28;
  var CX = W / 2;
  var CY = H / 2 - 28;
  var LOOP = 10;          // seconds

  // ---------- helpers ----------
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function easeOutQuart(t){ return 1 - Math.pow(1 - t, 4); }
  function easeOutBack(t){ var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeInCubic(t){ return t*t*t; }
  function easeInOutQuart(t){ return t < 0.5 ? 8*t*t*t*t : 1 - Math.pow(-2*t + 2, 4)/2; }
  function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }

  function interp(range, values, ease){
    return function(t){
      if (t <= range[0]) return values[0];
      if (t >= range[1]) return values[1];
      var p = (t - range[0]) / (range[1] - range[0]);
      return lerp(values[0], values[1], ease ? ease(p) : p);
    };
  }
  function beatHit(t, at, dur, peak){
    if (t < at || t > at + dur) return 0;
    var p = (t - at) / dur;
    return peak * Math.sin(p * Math.PI);
  }

  // ---------- SVG scaffold ----------
  host.innerHTML = '\
<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-label="sai kanagat. hero loop">\
  <defs>\
    <clipPath id="leftHalf"><rect x="-1000" y="-1000" width="1800" height="2400"></rect></clipPath>\
    <clipPath id="rightHalf"><rect x="800" y="-1000" width="1800" height="2400"></rect></clipPath>\
  </defs>\
  <g id="markGroup" transform="translate(' + CX + ',' + CY + ') scale(1)">\
    <g id="inkHalf" opacity="0">\
      <circle cx="0" cy="0" r="' + (GIANT/2) + '" fill="' + INK + '" clip-path="url(#leftHalf)" />\
    </g>\
    <g id="accentHalf" opacity="0">\
      <circle id="accentCircle" cx="0" cy="0" r="' + (GIANT/2) + '" fill="' + ACCENT + '" clip-path="url(#rightHalf)" />\
    </g>\
    <line x1="-' + (GIANT/2 - 4) + '" y1="0" x2="' + (GIANT/2 - 4) + '" y2="0" stroke="' + PAPER + '" stroke-width="0.4" opacity="0" />\
  </g>\
  <circle id="beatRing" cx="' + CX + '" cy="' + CY + '" r="' + (FINAL/2 + 10) + '" fill="none" stroke="' + ACCENT + '" stroke-width="1.5" opacity="0" />\
  <g id="wordmark" transform="translate(' + CX + ',' + (CY + FINAL/2 + GAP + WM_SIZE/2 - 6) + ')" opacity="0">\
    <g id="wordmarkClip">\
      <text x="0" y="0" font-family="\'Bricolage Grotesque\', system-ui, sans-serif" font-weight="500" font-size="' + (WM_SIZE * 0.6) + '" fill="' + INK + '" text-anchor="middle" dominant-baseline="middle" letter-spacing="-0.012em">sai kanagat<tspan fill="' + ACCENT + '">.</tspan></text>\
    </g>\
  </g>\
</svg>';

  var markGroup = host.querySelector('#markGroup');
  var inkHalf   = host.querySelector('#inkHalf');
  var accentHalf= host.querySelector('#accentHalf');
  var accentCircle = host.querySelector('#accentCircle');
  var beatRing  = host.querySelector('#beatRing');
  var wordmark  = host.querySelector('#wordmark');

  // If reduced motion: paint final frame and bail
  if (prefersReduced){
    markGroup.setAttribute('transform', 'translate(' + CX + ',' + CY + ') scale(' + (FINAL/GIANT) + ')');
    inkHalf.setAttribute('opacity', '1');
    accentHalf.setAttribute('opacity', '1');
    wordmark.setAttribute('opacity', '1');
    return;
  }

  function frame(t){
    // Timing curves (from direction-b.jsx)
    var inkOff  = interp([0.40, 1.40], [-65, 0], easeOutQuart)(t);
    var inkOp   = interp([0.35, 0.55], [0, 1])(t);
    var accOff  = interp([1.70, 2.35], [65, 0], easeOutBack)(t);
    var accOp   = interp([1.68, 1.85], [0, 1])(t);
    var scale   = interp([2.80, 3.85], [1.0, FINAL/GIANT], easeInOutQuart)(t);
    var wmReveal= interp([3.85, 4.55], [0, 1], easeOutQuart)(t);
    var wmOp    = interp([3.80, 4.10], [0, 1])(t);

    var beatLock  = beatHit(t, 2.25, 0.55, 1.0);
    var beatPulse = beatHit(t, 6.95, 0.50, 0.7);

    var breathGain = clamp((t - 4.6) / 1.2, 0, 1);
    var breath = 1 + Math.sin((t - 4.6) * 1.0) * 0.0035 * breathGain;

    var exitOp = interp([7.25, 8.80], [1, 0], easeInOutCubic)(t);
    var exitDy = interp([7.25, 8.80], [0, -6], easeInCubic)(t);

    // Apply
    inkHalf.setAttribute('transform', 'translate(' + inkOff + ',' + inkOff + ')');
    inkHalf.setAttribute('opacity', inkOp);
    accentHalf.setAttribute('transform', 'translate(' + accOff + ',' + accOff + ')');
    accentHalf.setAttribute('opacity', accOp);

    accentCircle.setAttribute('fill', (beatLock + beatPulse) > 0.15 ? ACCENT_UP : ACCENT);

    markGroup.setAttribute('transform',
      'translate(' + CX + ',' + (CY + exitDy) + ') scale(' + (scale * breath) + ')');
    markGroup.setAttribute('opacity', exitOp);

    // Beat ring
    if (beatPulse > 0.02){
      beatRing.setAttribute('opacity', beatPulse * 0.5);
      beatRing.setAttribute('transform', 'translate(' + CX + ',' + CY + ') scale(' + (1 + beatPulse * 0.16) + ') translate(' + (-CX) + ',' + (-CY) + ')');
    } else {
      beatRing.setAttribute('opacity', 0);
    }

    // Wordmark — clip from left
    wordmark.setAttribute('opacity', exitOp * wmOp);
    wordmark.setAttribute('transform',
      'translate(' + CX + ',' + (CY + FINAL/2 + GAP + WM_SIZE/2 - 6 + exitDy) + ') ' +
      'scale(' + (1) + ')');
    var clipText = host.querySelector('#wordmarkClip');
    clipText.style.clipPath = 'inset(0 ' + ((1 - wmReveal) * 100) + '% 0 0)';
  }

  var start = performance.now();
  function tick(now){
    var elapsed = ((now - start) / 1000) % LOOP;
    frame(elapsed);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
