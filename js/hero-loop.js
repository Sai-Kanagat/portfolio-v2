/* =========================================================
   HERO LOOP — Direction B · WIPE (faithful port)
   Source: /Users/saikanagat/Downloads/sai-kanagat/project/scenes/direction-b.jsx
           + scenes/shared.jsx (Mark = square with triangle clip-paths)
   Plays once · settles · holds (no time loop).
   ========================================================= */
(function(){
  var host = document.getElementById('heroLoop');
  if (!host) return;

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Brand tokens (from shared.jsx)
  var INK    = 'oklch(0.16 0.012 260)';
  var PAPER  = 'oklch(0.975 0.004 260)';
  var ACCENT = 'oklch(0.42 0.21 265)';
  var ACCENT_UP = 'oklch(0.55 0.22 262)';

  // Canvas geometry (matches direction-b.jsx world)
  var W = 1280, H = 720;
  var GIANT = 1600;      // mark fills the canvas
  var FINAL = 240;       // contracted lockup size
  var WM_SIZE = 60;
  var GAP = 36;
  var CX = W / 2;
  var CY = H / 2 - 36;
  var SEAM = 0.9;        // seam % (paper diagonal gap)

  // ---------- easing helpers ----------
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function easeOutQuart(t){ return 1 - Math.pow(1 - t, 4); }
  function easeOutBack(t){ var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeInOutQuart(t){ return t < 0.5 ? 8*t*t*t*t : 1 - Math.pow(-2*t + 2, 4)/2; }
  function interp(range, values, ease){
    return function(t){
      if (t <= range[0]) return values[0];
      if (t >= range[1]) return values[1];
      var p = (t - range[0]) / (range[1] - range[0]);
      return lerp(values[0], values[1], ease ? ease(p) : p);
    };
  }
  function beatHit(t, at, width, gain){
    var d = t - at;
    if (d < 0 || d > width) return 0;
    var x = d / width;
    return gain * Math.exp(-Math.pow(x * 3 - 0.4, 2) * 4);
  }

  // ---------- mount ----------
  // Frame container is the visible rectangle. Mark + wordmark + beat ring sit inside, scaled to fit.
  host.innerHTML =
    '<div class="hl-frame" aria-label="Sai Kanagat brand mark">' +
      '<div class="hl-stage">' +
        '<div class="hl-mark" id="hlMark">' +
          '<div class="hl-mark-bg"></div>' +
          '<div class="hl-mark-ink" id="hlInk"></div>' +
          '<div class="hl-mark-accent" id="hlAccent"></div>' +
        '</div>' +
        '<div class="hl-beatring" id="hlBeatRing"></div>' +
        '<div class="hl-wordmark" id="hlWordmark"><span>SAI KANAGAT</span></div>' +
      '</div>' +
    '</div>';

  // Inject scoped styles once
  if (!document.getElementById('hlStyles')){
    var st = document.createElement('style');
    st.id = 'hlStyles';
    st.textContent =
      '#heroLoop{width:100%;display:flex;justify-content:center;align-items:center;}' +
      '.hl-frame{position:relative;width:100%;max-width:1180px;aspect-ratio:16/9;background:'+PAPER+';border-radius:18px;overflow:hidden;box-shadow:0 1px 0 oklch(0.85 0.008 260),0 24px 60px oklch(0.16 0.012 260 / 0.10);}' +
      '.hl-stage{position:absolute;inset:0;}' +
      '.hl-mark{position:absolute;left:50%;top:50%;width:'+GIANT+'px;height:'+GIANT+'px;margin-left:-'+(GIANT/2)+'px;margin-top:-'+(GIANT/2)+'px;transform-origin:center;will-change:transform,opacity;}' +
      '.hl-mark-bg{position:absolute;inset:0;background:'+PAPER+';}' +
      '.hl-mark-ink{position:absolute;inset:0;background:'+INK+';clip-path:polygon(0% 0%, '+(100-SEAM)+'% 0%, 0% '+(100-SEAM)+'%);will-change:transform,opacity;opacity:0;}' +
      '.hl-mark-accent{position:absolute;inset:0;background:'+ACCENT+';clip-path:polygon(100% '+SEAM+'%, 100% 100%, '+SEAM+'% 100%);will-change:transform,opacity;opacity:0;}' +
      '.hl-beatring{position:absolute;left:50%;top:50%;width:0;height:0;border:1.5px solid '+ACCENT+';opacity:0;pointer-events:none;transform:translate(-50%,-50%);}' +
      '.hl-wordmark{position:absolute;left:0;right:0;display:flex;justify-content:center;opacity:0;will-change:transform,opacity,clip-path;font-family:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:'+WM_SIZE+'px;line-height:1;letter-spacing:-0.04em;color:'+INK+';text-transform:uppercase;white-space:nowrap;clip-path:inset(0 100% 0 0);}' +
      '@media (max-width: 900px){.hl-frame{aspect-ratio:4/3;border-radius:14px;}.hl-wordmark{font-size:34px;}}' +
      '@media (max-width: 560px){.hl-frame{aspect-ratio:1/1;border-radius:12px;}.hl-wordmark{font-size:26px;}}';
    document.head.appendChild(st);
  }

  var mark      = host.querySelector('#hlMark');
  var inkHalf   = host.querySelector('#hlInk');
  var accent    = host.querySelector('#hlAccent');
  var beatRing  = host.querySelector('#hlBeatRing');
  var wordmark  = host.querySelector('#hlWordmark');

  function paintFinal(){
    // Settle the composition at "intro complete" state
    var scale = FINAL / GIANT;
    mark.style.transform = 'translate(0,0) scale(' + scale + ')';
    mark.style.opacity = 1;
    inkHalf.style.transform = 'translate(0%, 0%) scale(1)';
    inkHalf.style.opacity = 1;
    accent.style.transform = 'translate(0%, 0%) scale(1)';
    accent.style.opacity = 1;
    accent.style.background = ACCENT;
    // Wordmark anchored just below the contracted mark
    var wmTop = (CY + (FINAL/2) + GAP);
    wordmark.style.top = ((wmTop / H) * 100) + '%';
    wordmark.style.opacity = 1;
    wordmark.style.clipPath = 'inset(0 0% 0 0)';
  }

  if (prefersReduced){ paintFinal(); return; }

  // ---------- Direction B animation timeline ----------
  // 0.40–1.40 ink half sweeps in (upper-left diagonal)
  // 1.70–2.35 accent half sweeps in (lower-right diagonal) — BEAT at 2.25
  // 2.80–3.85 mark CONTRACTS to lockup
  // 3.85–4.55 wordmark wipes in from left
  // 4.55–7.00 hold + subtle accent pulse beat at 6.95
  // After 7.5  fully settled — animation ends, holds forever
  var TOTAL = 7.6;

  function frame(t){
    // halves
    var inkOff  = interp([0.40, 1.40], [-65, -65], easeOutQuart);
    var inkOffT = interp([0.40, 1.40], [-65, 0], easeOutQuart)(t);
    var inkOp   = interp([0.35, 0.55], [0, 1])(t);

    var accOff  = interp([1.70, 2.35], [65, 0], easeOutBack)(t);
    var accOp   = interp([1.68, 1.85], [0, 1])(t);

    var scale   = interp([2.80, 3.85], [1.0, FINAL/GIANT], easeInOutQuart)(t);
    var wmReveal= interp([3.85, 4.55], [0, 1], easeOutQuart)(t);
    var wmOp    = interp([3.80, 4.10], [0, 1])(t);

    var beatLock  = beatHit(t, 2.25, 0.55, 1.0);
    var beatPulse = beatHit(t, 6.95, 0.50, 0.7);

    // Apply halves
    inkHalf.style.transform = 'translate(' + inkOffT + '%, ' + inkOffT + '%) scale(1)';
    inkHalf.style.opacity = inkOp;
    accent.style.transform = 'translate(' + accOff + '%, ' + accOff + '%) scale(1)';
    accent.style.opacity = accOp;
    accent.style.background = (beatLock + beatPulse) > 0.15 ? ACCENT_UP : ACCENT;

    // Apply mark contraction
    mark.style.transform = 'translate(0,0) scale(' + scale + ')';

    // Beat ring (around the contracted mark — sized in canvas px relative to FINAL)
    if (beatPulse > 0.02){
      // Convert FINAL world size to frame % so it sits around the contracted mark
      var ringSize = FINAL + 20;
      beatRing.style.width = ringSize + 'px';
      beatRing.style.height = ringSize + 'px';
      beatRing.style.opacity = beatPulse * 0.5;
      beatRing.style.transform = 'translate(-50%,-50%) scale(' + (1 + beatPulse * 0.16) + ')';
    } else {
      beatRing.style.opacity = 0;
    }

    // Wordmark
    var wmTop = (CY + (FINAL/2) + GAP);
    wordmark.style.top = ((wmTop / H) * 100) + '%';
    wordmark.style.opacity = wmOp;
    wordmark.style.clipPath = 'inset(0 ' + ((1 - wmReveal) * 100) + '% 0 0)';
  }

  var start = performance.now();
  function tick(now){
    var t = (now - start) / 1000;
    if (t >= TOTAL){
      paintFinal();
      return; // Animation ends — holds the final composition forever
    }
    frame(t);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
