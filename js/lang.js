/* Simple EN / IT toggle.
   Any element with data-en and data-it attributes gets its textContent swapped.
   Persists via localStorage. */
(function () {
  var KEY = 'sk_lang';
  function getLang() { return localStorage.getItem(KEY) || 'en'; }
  function applyLang(l) {
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('data-lang', l);
    var nodes = document.querySelectorAll('[data-en][data-it]');
    nodes.forEach(function (n) {
      var t = n.getAttribute('data-' + l);
      if (t != null) n.innerHTML = t;
    });
    document.querySelectorAll('.lang-toggle [data-l]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-l') === l);
    });
  }
  function setLang(l) { localStorage.setItem(KEY, l); applyLang(l); }
  function init() {
    document.querySelectorAll('.lang-toggle [data-l]').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-l')); });
    });
    applyLang(getLang());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
