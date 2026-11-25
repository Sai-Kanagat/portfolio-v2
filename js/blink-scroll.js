/* Blink to Scroll: double blink advances the article one block.
   Zero cost until the sticker is toggled. Camera is requested only on toggle.
   Video is processed locally by MediaPipe and never leaves the device. */
(function () {
  'use strict';
  var article = document.querySelector('.post-body');
  if (!article) return;

  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  var DID = 'blink-scroll', doubles = 0, onAt = 0;
  function S(m) { try { var a = Array.prototype.slice.call(arguments, 1); window.sk ? sk[m].apply(sk, a) : (window.skq = window.skq || []).push([m].concat(a)); } catch (e) {} }
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = document.createElement('style');
  css.textContent =
    '.bs-sticker{position:fixed;right:22px;bottom:22px;z-index:9000;display:flex;align-items:center;gap:10px;padding:12px 16px 12px 14px;' +
    'background:#ffd23f;color:#14121c;border:2.5px solid #14121c;border-radius:18px 24px 16px 22px;box-shadow:5px 5px 0 #14121c;' +
    'font:700 14px/1.15 "Bricolage Grotesque",system-ui,sans-serif;cursor:pointer;transform:rotate(-5deg);transition:transform .2s,box-shadow .2s,background .2s;max-width:260px;text-align:left}' +
    '.bs-sticker:hover{transform:rotate(-2deg) scale(1.04)}.bs-sticker:active{transform:rotate(-2deg) translate(3px,3px);box-shadow:2px 2px 0 #14121c}' +
    '.bs-sticker:focus-visible{outline:3px solid #2f4fe0;outline-offset:3px}' +
    '.bs-eye{flex:none;width:30px;height:30px;border-radius:50%;background:#fff;border:2.5px solid #14121c;position:relative;overflow:hidden;transition:height .08s}' +
    '.bs-eye::after{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#14121c}' +
    '.bs-sticker.blink .bs-eye{height:6px}' +
    '.bs-sub{display:block;font:500 11.5px/1.3 "IBM Plex Mono",ui-monospace,monospace;margin-top:3px;opacity:.85}' +
    '.bs-sticker.on{background:#3dffb0}.bs-sticker.err{background:#ff9bb0}' +
    '.bs-sticker.on .bs-eye{box-shadow:0 0 0 3px rgba(20,18,28,.15)}' +
    '.bs-current{background:rgba(255,210,63,.32);box-shadow:-14px 0 0 rgba(255,210,63,.32),14px 0 0 rgba(255,210,63,.32);border-radius:6px;transition:background .4s}' +
    '@media (max-width:640px){.bs-sticker{right:12px;bottom:12px;max-width:210px;font-size:13px}}';
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bs-sticker';
  btn.setAttribute('data-track', 'blink-scroll.toggle');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<span class="bs-eye" aria-hidden="true"></span><span><span class="bs-main">Read with your eyes</span><span class="bs-sub">tap, then double blink to scroll</span></span>';
  document.body.appendChild(btn);
  var mainEl = btn.querySelector('.bs-main'), subEl = btn.querySelector('.bs-sub');
  function say(main, sub, cls) { mainEl.textContent = main; subEl.textContent = sub; btn.classList.remove('on', 'err'); if (cls) btn.classList.add(cls); }

  /* ---------- reading cursor ---------- */
  var blocks = Array.prototype.slice.call(article.querySelectorAll(':scope > p, :scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > blockquote, :scope > figure'));
  var idx = -1;
  function firstVisible() {
    for (var i = 0; i < blocks.length; i++) { if (blocks[i].getBoundingClientRect().bottom > innerHeight * 0.25) return i - 1; }
    return blocks.length - 1;
  }
  function advance() {
    if (!blocks.length) return;
    if (idx < 0 || !blocks[idx] || Math.abs(blocks[idx].getBoundingClientRect().top - innerHeight * 0.35) > innerHeight) idx = firstVisible();
    idx = Math.min(idx + 1, blocks.length - 1);
    blocks.forEach(function (b) { b.classList.remove('bs-current'); });
    var el = blocks[idx]; el.classList.add('bs-current');
    var y = el.getBoundingClientRect().top + scrollY - innerHeight * 0.3;
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    if (idx === blocks.length - 1) say('You reached the end', 'double blink again to stay here', 'on');
  }

  /* ---------- double blink detector (pure, testable) ---------- */
  var det = { thr: 0.35, open: 0.25, closed: false, closedAt: 0, lastBlink: -1e9, cooldownUntil: 0, calib: [], calibUntil: 0 };
  function feed(score, t) {
    if (t < det.calibUntil) { det.calib.push(score); return 'calibrating'; }
    if (det.calib.length) {
      var s = det.calib.slice().sort(function (a, b) { return a - b; });
      var base = s[Math.floor(s.length * 0.5)];
      det.thr = Math.min(0.55, Math.max(0.24, base + 0.18)); det.open = Math.max(base + 0.06, det.thr * 0.7);
      det.calib = [];
    }
    var ev = null;
    if (det.closed && score > det.peak) det.peak = score;
    if (!det.closed && score > det.thr) { det.closed = true; det.closedAt = t; det.peak = score; flash(true); }
    else if (det.closed && (score < det.open || score < det.peak - 0.15)) {
      det.closed = false; flash(false);
      var dur = t - det.closedAt;
      if (dur <= 500 && t >= det.cooldownUntil) {
        if (t - det.lastBlink <= 900) { det.lastBlink = -1e9; det.cooldownUntil = t + 500; doubles++; advance(); ev = 'double'; }
        else { det.lastBlink = t; ev = 'single'; }
      }
    }
    return ev;
  }
  function flash(closed) { btn.classList.toggle('blink', closed); }

  /* ---------- camera + MediaPipe (lazy) ---------- */
  var state = 'off', stream = null, video = null, landmarker = null, raf = 0, lastVideoTime = -1;
  function stop() {
    if (state !== 'off') {
      S('demo', DID, 'toggle', { item: 'off', ms: onAt ? Math.round(performance.now() - onAt) : 0 });
      S('demo', DID, 'blinks', { bucket: window.sk ? sk.count(doubles) : '0' });
      if (stream) S('media', DID, 'camera', 'stopped');
    }
    state = 'off'; cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
    stream = null; if (video) { video.srcObject = null; }
    blocks.forEach(function (b) { b.classList.remove('bs-current'); });
    btn.setAttribute('aria-pressed', 'false'); flash(false);
    say('Read with your eyes', 'tap, then double blink to scroll');
  }
  function loop() {
    if (state !== 'live' && state !== 'calibrating') return;
    raf = requestAnimationFrame(loop);
    if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    var now = performance.now();
    var res = landmarker.detectForVideo(video, now);
    var cats = res && res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
    if (!cats) return;
    var l = 0, r = 0;
    for (var i = 0; i < cats.length; i++) { if (cats[i].categoryName === 'eyeBlinkLeft') l = cats[i].score; else if (cats[i].categoryName === 'eyeBlinkRight') r = cats[i].score; }
    var out = feed((l + r) / 2, now);
    if (state === 'calibrating' && out !== 'calibrating') { state = 'live'; say('Blink twice to scroll', 'live, video stays on your device', 'on'); }
  }
  async function start() {
    state = 'loading'; btn.setAttribute('aria-pressed', 'true'); doubles = 0; onAt = performance.now();
    S('demo', DID, 'toggle', { item: 'on' }); S('media', DID, 'camera', 'prompt');
    say('Waking the camera...', 'video stays on your device');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
      S('media', DID, 'camera', 'granted');
      if (state !== 'loading') { stream.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      video = video || Object.assign(document.createElement('video'), { muted: true, playsInline: true });
      video.setAttribute('playsinline', ''); video.srcObject = stream; await video.play();
      if (!landmarker) {
        var mt0 = performance.now();
        say('Loading the eye model...', 'about 4MB, once');
        var vision = await import(MP + '/vision_bundle.mjs');
        var files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
        landmarker = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true
        });
      }
      if (mt0) S('model', DID, 'loaded', { ms: Math.round(performance.now() - mt0), delegate: 'GPU' });
      if (state !== 'loading') return;
      state = 'calibrating'; det.calib = []; det.calibUntil = performance.now() + 1500; det.closed = false; det.lastBlink = -1e9;
      say('Keep your eyes open...', 'calibrating for 1.5 seconds', 'on');
      loop();
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      var missing = e && (e.message === 'nocam' || e.name === 'NotFoundError');
      if (!stream) S('media', DID, 'camera', denied ? 'denied' : missing ? 'unavailable' : 'failed');
      else S('model', DID, 'failed', {});
      if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
      stream = null; state = 'off'; btn.setAttribute('aria-pressed', 'false');
      say(denied ? 'Camera blocked' : 'No camera here', denied ? 'allow it in the address bar to try again' : 'scrolling works the usual way', 'err');
    }
  }
  btn.addEventListener('click', function () { if (state === 'off') start(); else stop(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && state !== 'off') stop(); });

  window.__blinkScroll = { feed: feed, det: det, advance: advance, get state() { return state; } };
})();
