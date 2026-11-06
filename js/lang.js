/* Simple EN / IT toggle.
   Any element with data-en and data-it attributes gets its innerHTML swapped.
   Persists via localStorage.
   Exposes window.SK_lang { get, set, apply } so dynamic content can re-translate
   after injection (e.g. project panel, editorial list rows). */
(function () {
  var KEY = 'sk_lang';
  function getLang() { try { return localStorage.getItem(KEY) || 'en'; } catch (e) { return 'en'; } }
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
  function setLang(l) { try { localStorage.setItem(KEY, l); } catch (e) {} applyLang(l); }
  function init() {
    document.querySelectorAll('.lang-toggle [data-l]').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-l')); });
    });
    applyLang(getLang());
    // Re-translate content injected later (project panel, list rows, newsletter).
    // Only the added nodes are touched, English needs nothing (it is the markup),
    // and the observer's own writes are discarded so it cannot re-trigger itself.
    var pending = null;
    var queue = [];
    function translateAdded() {
      pending = null;
      var l = getLang();
      var nodes = queue; queue = [];
      if (l === 'en') return;
      nodes.forEach(function (root) {
        if (!root.isConnected) return;
        if (root.matches && root.matches('[data-en][data-it]')) {
          var t0 = root.getAttribute('data-' + l);
          if (t0 != null) root.innerHTML = t0;
        }
        root.querySelectorAll('[data-en][data-it]').forEach(function (n) {
          var t = n.getAttribute('data-' + l);
          if (t != null) n.innerHTML = t;
        });
      });
      observer.takeRecords();
    }
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue.push(n); });
      });
      if (!queue.length || pending) return;
      pending = setTimeout(translateAdded, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
  window.SK_lang = { get: getLang, set: setLang, apply: applyLang };
})();
