/* Simple EN / IT toggle.
   Any element with data-en and data-it attributes gets its innerHTML swapped.
   Persists via localStorage.
   Exposes window.SK_lang { get, set, apply } so dynamic content can re-translate
   after injection (e.g. project panel, editorial list rows). */
(function () {
  var KEY = 'sk_lang';
  function getLang() { return localStorage.getItem(KEY) || 'en'; }
  function applyLang(l, scope) {
    if (!l) l = getLang();
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('data-lang', l);
    var root = scope || document;
    var nodes = root.querySelectorAll('[data-en][data-it]');
    nodes.forEach(function (n) {
      var t = n.getAttribute('data-' + l);
      if (t != null) n.innerHTML = t;
    });
    document.querySelectorAll('.lang-toggle [data-l]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-l') === l);
    });
    document.dispatchEvent(new CustomEvent('sk:lang-change', { detail: { lang: l }}));
  }
  function setLang(l) { localStorage.setItem(KEY, l); applyLang(l); }
  function init() {
    document.querySelectorAll('.lang-toggle [data-l]').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-l')); });
    });
    applyLang(getLang());
    // Re-apply on dynamic DOM injections — observe additions, debounce, re-translate
    var pending = null;
    var observer = new MutationObserver(function(mutations){
      var hasAdds = mutations.some(function(m){ return m.addedNodes && m.addedNodes.length; });
      if (!hasAdds) return;
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(function(){
        applyLang(getLang());
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
  window.SK_lang = { get: getLang, set: setLang, apply: applyLang };
})();
