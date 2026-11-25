/* analytics.js: shim kept so pages and other sessions that paste the old snippet keep working.
   It loads js/track.js (the real client) next to itself. window.skTrack works at once:
   calls made before track.js arrives are queued on window.skq. */
(function () {
  if (window.sk && window.sk.v) return;
  window.skq = window.skq || [];
  if (!window.skTrack) window.skTrack = function (n, p) { window.skq.push(['track', n, p]); };
  var me = document.currentScript, src = '/js/track.js';
  if (me && me.src) src = me.src.replace(/analytics\.js(\?.*)?$/, 'track.js$1');
  if (document.querySelector('script[data-sk-track]')) return;
  var s = document.createElement('script');
  s.src = src; s.async = true; s.setAttribute('data-sk-track', '');
  (document.head || document.documentElement).appendChild(s);
})();
