/* =========================================================
   LIGHTBOX — click any image to open fullscreen
   Intercepts clicks on .panel-gallery img, .about-portrait img,
   .work-card .card-img, gallery imgs. Esc closes. Arrow keys
   navigate within the same gallery cluster.
   ========================================================= */
(function(){
  var STYLES = '\
.lb-overlay {\
  position: fixed; inset: 0; z-index: 1000;\
  background: rgba(10,10,10,0.95);\
  display: flex; align-items: center; justify-content: center;\
  opacity: 0; pointer-events: none;\
  transition: opacity .25s ease;\
}\
.lb-overlay.is-on { opacity: 1; pointer-events: auto; }\
.lb-img-wrap { max-width: 92vw; max-height: 88vh; display: flex; align-items: center; justify-content: center; }\
.lb-img { max-width: 92vw; max-height: 88vh; width: auto; height: auto; object-fit: contain; box-shadow: 0 24px 64px rgba(0,0,0,0.6); }\
.lb-close, .lb-prev, .lb-next {\
  position: fixed; z-index: 1001;\
  background: rgba(10,10,10,0.6); border: 1px solid rgba(245,240,232,0.2); color: #f5f0e8;\
  font-family: var(--font-mono, monospace); font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase;\
  padding: 10px 14px; border-radius: 2px; cursor: pointer; backdrop-filter: blur(8px);\
  transition: background .15s ease, color .15s ease, border-color .15s ease;\
}\
.lb-close:hover, .lb-prev:hover, .lb-next:hover { background: #ccff00; color: #0a0a0a; border-color: #ccff00; }\
.lb-close { top: 18px; right: 18px; }\
.lb-prev { left: 18px; top: 50%; transform: translateY(-50%); }\
.lb-next { right: 18px; top: 50%; transform: translateY(-50%); }\
.lb-caption {\
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 1001;\
  font-family: var(--font-mono, monospace); font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase;\
  color: rgba(245,240,232,0.7); background: rgba(10,10,10,0.6); padding: 8px 14px; border-radius: 2px; backdrop-filter: blur(8px);\
}\
@media (max-width: 640px){ .lb-prev, .lb-next { padding: 8px 10px; font-size: 0.65rem; } .lb-prev { left: 8px; } .lb-next { right: 8px; } }\
';

  function injectStyles(){
    if (document.getElementById('lbStyles')) return;
    var s = document.createElement('style'); s.id = 'lbStyles'; s.textContent = STYLES;
    document.head.appendChild(s);
  }

  var state = { images: [], index: 0, overlay: null, imgEl: null, captionEl: null };

  function ensureOverlay(){
    if (state.overlay) return;
    var o = document.createElement('div');
    o.className = 'lb-overlay'; o.id = 'lbOverlay';
    o.innerHTML = '<button class="lb-close" id="lbClose">Close ✕</button>\
<button class="lb-prev" id="lbPrev">← Prev</button>\
<button class="lb-next" id="lbNext">Next →</button>\
<div class="lb-img-wrap"><img class="lb-img" id="lbImg" alt=""></div>\
<div class="lb-caption" id="lbCap"></div>';
    document.body.appendChild(o);
    state.overlay = o;
    state.imgEl = document.getElementById('lbImg');
    state.captionEl = document.getElementById('lbCap');
    document.getElementById('lbClose').addEventListener('click', close);
    document.getElementById('lbPrev').addEventListener('click', function(){ nav(-1); });
    document.getElementById('lbNext').addEventListener('click', function(){ nav(1); });
    o.addEventListener('click', function(e){ if (e.target === o) close(); });
    document.addEventListener('keydown', function(e){
      if (!o.classList.contains('is-on')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    });
  }

  function show(index){
    var img = state.images[index];
    if (!img) return;
    state.index = index;
    state.imgEl.src = img.src;
    state.imgEl.alt = img.alt || '';
    var total = state.images.length;
    state.captionEl.textContent = (img.alt || 'Image') + ' · ' + (index + 1) + ' / ' + total;
    document.getElementById('lbPrev').style.display = total > 1 ? '' : 'none';
    document.getElementById('lbNext').style.display = total > 1 ? '' : 'none';
    state.overlay.classList.add('is-on');
    document.body.style.overflow = 'hidden';
  }
  function close(){
    state.overlay.classList.remove('is-on');
    document.body.style.overflow = '';
  }
  function nav(dir){
    var n = state.images.length;
    show((state.index + dir + n) % n);
  }

  function openFromCluster(clickedEl){
    // Find sibling images in the same logical cluster
    var cluster = clickedEl.closest('.panel-gallery, .about-portraits, .work-grid, .full-grid, .gallery-grid, .gallery-masonry, article, body');
    var imgs;
    if (cluster && cluster !== document.body){
      imgs = Array.from(cluster.querySelectorAll('img[src]')).filter(function(im){
        return im.dataset.lbIgnore !== 'true' && im.offsetWidth > 40;
      });
    }
    if (!imgs || imgs.length === 0) imgs = [clickedEl];
    state.images = imgs.map(function(im){ return { src: im.currentSrc || im.src, alt: im.alt }; });
    var idx = imgs.indexOf(clickedEl);
    show(idx === -1 ? 0 : idx);
  }

  function shouldBind(img){
    if (img.dataset.lbBound === 'true') return false;
    if (img.dataset.lbIgnore === 'true') return false;
    if (img.closest('.nav, .lb-overlay, .hand-scroll-stage, #personaGate, .skills-bounce')) return false;
    // small icons / svgs
    if (img.naturalWidth && img.naturalWidth < 80) return false;
    if (img.src && img.src.indexOf('/logos/') !== -1) return false;
    return true;
  }

  function bindAll(){
    document.querySelectorAll('img').forEach(function(img){
      if (!shouldBind(img)) return;
      img.dataset.lbBound = 'true';
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', function(e){
        // don't hijack if image is inside a link
        var parentLink = img.closest('a[href]');
        if (parentLink && !parentLink.classList.contains('lb-allow')) return;
        e.preventDefault();
        e.stopPropagation();
        openFromCluster(img);
      });
    });
  }

  function init(){
    injectStyles();
    ensureOverlay();
    bindAll();
    // Re-bind when DOM changes (project panel renders new images)
    var obs = new MutationObserver(function(){ bindAll(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
