/* =========================================================
   CONSENT: owns sk_consent_v2 ('granted' | 'denied') in localStorage.
   Region comes from <html data-cr="eea|other"> (set at the edge), with a
   timezone fallback where unknown counts as eea.
     eea:    nothing leaves the browser until the visitor accepts.
     other:  on by default, a notice is shown and opting out is one click.
   Global Privacy Control counts as declined unless the visitor chooses.
   Dispatches window event 'sk:consent' {detail:{state}}.
   Any [data-consent-open] element reopens the choice.
   Clarity loads only after consent, only if window.SK_CLARITY_ID is set,
   and with all text masked.
   ========================================================= */
(function () {
  'use strict';
  if (window.SK_CONSENT) return;
  var KEY = 'sk_consent_v2', NKEY = 'sk_notice_v2';
  var doc = document, root = doc.documentElement;

  function gtag() { window.dataLayer = window.dataLayer || []; window.dataLayer.push(arguments); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* legacy key from the first banner */
  try { if (lsGet('sk_consent') === 'denied' && !lsGet(KEY)) lsSet(KEY, 'denied'); localStorage.removeItem('sk_consent'); } catch (e) {}

  function region() {
    var r = root.getAttribute('data-cr');
    if (r === 'eea' || r === 'other') return r;
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    return (!tz || /^Europe\//.test(tz) || /^Atlantic\/(Canary|Azores|Madeira|Reykjavik|Faroe)$/.test(tz)) ? 'eea' : 'other';
  }
  function stored() { var v = lsGet(KEY); return v === 'granted' || v === 'denied' ? v : null; }
  function gpc() { return navigator.globalPrivacyControl === true; }
  function state() { return stored() || (gpc() ? 'denied' : (region() === 'eea' ? 'pending' : 'granted')); }
  function it() { return (root.getAttribute('lang') || lsGet('sk_lang') || 'en') === 'it'; }
  function q(args) { (window.skq = window.skq || []).push(args); }

  function gConsent(on) {
    gtag('consent', 'update', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
      analytics_storage: on ? 'granted' : 'denied'
    });
  }

  /* ---------- Google Tag Manager: loaded here, only in state granted, once ---------- */
  var GTM_ID = 'GTM-MRGXD7ZC', gtmOn = false;
  function syncGtm() {
    if (gtmOn || state() !== 'granted') return;
    gtmOn = true;
    try {
      /* callers push gConsent(true) first. An old cached page may still carry the inline loader: never load twice */
      if (doc.querySelector('script[src*="googletagmanager.com/gtm.js"]')) return;
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var j = doc.createElement('script'), f = doc.getElementsByTagName('script')[0];
      j.async = true; j.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
      (f && f.parentNode ? f.parentNode : doc.head).insertBefore(j, f || null);
    } catch (e) {}
  }

  /* ---------- cookies and Clarity ---------- */
  function purgeCookies() {
    try {
      var h = location.hostname.split('.'), doms = [''];
      for (var i = 0; i < h.length - 1; i++) doms.push('.' + h.slice(i).join('.'));
      document.cookie.split(';').forEach(function (c) {
        var n = c.split('=')[0].trim();
        if (!/^(_ga|_gid|_gat|_gcl|_clck|_clsk|CLID|ANONCHK|MUID|SM$)/.test(n)) return;
        doms.forEach(function (dm) { document.cookie = n + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + (dm ? ';domain=' + dm : ''); });
      });
    } catch (e) {}
  }
  var clarityOn = false;
  function syncClarity() {
    var s = state();
    if (s === 'granted') {
      var id = window.SK_CLARITY_ID;
      if (clarityOn || !id || !/^[a-z0-9]{6,16}$/i.test(id)) return;
      clarityOn = true;
      try {
        (function (c, l, a, r, i, t, y) {
          c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
          t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
          y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
        })(window, doc, 'clarity', 'script', id);
        root.setAttribute('data-clarity-mask', 'True');
        if (doc.body) doc.body.setAttribute('data-clarity-mask', 'True');
        window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
        window.dispatchEvent(new CustomEvent('sk:clarity'));
      } catch (e) {}
    } else if (clarityOn && window.clarity) {
      try { window.clarity('consent', false); } catch (e) {}
    }
  }

  var last = state();
  function announce() {
    var s = state();
    if (s === last) return;
    last = s;
    gConsent(s === 'granted');
    if (s === 'denied') purgeCookies();
    syncGtm();
    syncClarity();
    window.dispatchEvent(new CustomEvent('sk:consent', { detail: { state: s } }));
  }
  function set(choice, from) {
    if (choice !== 'granted' && choice !== 'denied') return;
    lsSet(KEY, choice); lsSet(NKEY, '1');
    announce();
    if (choice === 'granted') q(['track', 'consent_choice', { choice: choice, region: region() }]);
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY) announce(); });

  /* a Global Privacy Control signal with no stored choice is a decline */
  if (!stored() && gpc()) { gConsent(false); purgeCookies(); }
  if (state() === 'granted') gConsent(true);
  syncGtm();
  syncClarity();

  /* ---------- the choice UI ---------- */
  var COPY = {
    title: ['How this site counts visits', 'Come questo sito conta le visite'],
    optin: [
      'With your OK, this site uses Google Analytics, Microsoft Clarity (session recordings with text masked) and my own small store to see which pages and demos get used. Clicks, scrolling and time on a page are counted. Typed text, files and camera or microphone data never are. Links I share carry a short code, so I can tell which CV or post a visit came from. No ads, no selling. Decline and none of this runs.',
      'Con il tuo consenso questo sito usa Google Analytics, Microsoft Clarity (registrazioni delle sessioni con il testo oscurato) e un piccolo archivio mio per capire quali pagine e demo vengono usate. Vengono contati clic, scorrimento e tempo sulla pagina. Testo digitato, file e dati di camera o microfono non vengono mai raccolti. I link che condivido contengono un breve codice, così so da quale CV o post arriva una visita. Niente pubblicità, niente vendita dei dati. Se rifiuti, niente di tutto questo parte.'
    ],
    notice: [
      'This site counts visits with Google Analytics, Microsoft Clarity (session recordings with text masked) and my own small store, to see which pages and demos get used. Clicks, scrolling and time on a page are counted. Typed text, files and camera or microphone data never are. Links I share carry a short code, so I can tell which CV or post a visit came from. No ads, no selling. You can opt out here at any time, or with a Global Privacy Control signal.',
      'Questo sito conta le visite con Google Analytics, Microsoft Clarity (registrazioni delle sessioni con il testo oscurato) e un piccolo archivio mio, per capire quali pagine e demo vengono usate. Vengono contati clic, scorrimento e tempo sulla pagina. Testo digitato, file e dati di camera o microfono non vengono mai raccolti. I link che condivido contengono un breve codice, così so da quale CV o post arriva una visita. Niente pubblicità, niente vendita dei dati. Puoi rifiutare in qualsiasi momento da qui, o con un segnale Global Privacy Control.'
    ],
    now: [['Analytics are on for this browser.', 'Analytics are off for this browser.'], ['Le statistiche sono attive su questo browser.', 'Le statistiche sono disattivate su questo browser.']],
    more: ['What is collected', 'Cosa viene raccolto'],
    list: [
      ['Google Analytics, through Google Tag Manager: pages seen, clicks, scroll depth, time on page.',
       'Microsoft Clarity: session recordings and heatmaps, with all text masked.',
       'My own store (Cloudflare): the same events and a random visitor ID kept in this browser. No IP address is stored. Events are deleted after 14 months.',
       'Tracked links: a short code in the address, such as sk_l or utm_source, says which link brought you here.',
       'Never collected: what you type, file names, camera or microphone data.'],
      ['Google Analytics, tramite Google Tag Manager: pagine viste, clic, profondità di scorrimento, tempo sulla pagina.',
       'Microsoft Clarity: registrazioni delle sessioni e mappe di calore, con tutto il testo oscurato.',
       'Il mio archivio (Cloudflare): gli stessi eventi e un ID visitatore casuale conservato in questo browser. Nessun indirizzo IP viene salvato. Gli eventi vengono cancellati dopo 14 mesi.',
       'Link tracciati: un breve codice nell\'indirizzo, come sk_l o utm_source, indica quale link ti ha portato qui.',
       'Mai raccolti: ciò che scrivi, nomi di file, dati di camera o microfono.']
    ],
    yes: ['Accept analytics', 'Accetta le statistiche'],
    no: ['Decline', 'Rifiuta'],
    ok: ['Got it', 'Ho capito'],
    out: ['Opt out', 'Non tracciare'],
    allow: ['Allow analytics', 'Consenti le statistiche'],
    link: ['Privacy choices', 'Scelte sulla privacy']
  };
  function t(pair) { return pair[it() ? 1 : 0]; }

  var CSS =
    '#sk-consent{position:fixed;left:16px;right:16px;bottom:16px;max-width:480px;margin-left:auto;z-index:99999;' +
    'background:#0f1218;background:oklch(0.16 0.012 260);color:#f6f6f8;color:oklch(0.975 0.004 260);border-radius:12px;padding:20px;' +
    'box-shadow:0 8px 24px rgba(8,12,28,.28);font:14px/1.5 "Bricolage Grotesque","Inter Tight",system-ui,sans-serif;max-height:calc(100vh - 32px);overflow:auto}' +
    '#sk-consent h2{font:italic 400 18px/1.3 "Newsreader",Georgia,serif;margin:0 0 8px;color:inherit}' +
    '#sk-consent p{margin:0 0 12px;color:#d9dbe2;color:oklch(0.88 0.008 260)}' +
    '#sk-consent .sk-c-now{color:#f6f6f8;color:oklch(0.975 0.004 260);font-weight:500}' +
    '#sk-consent details{margin:0 0 16px;color:#d9dbe2;color:oklch(0.88 0.008 260)}' +
    '#sk-consent summary{cursor:pointer;font-weight:500;padding:4px 0}' +
    '#sk-consent ul{margin:8px 0 0;padding-left:20px}#sk-consent li{margin:0 0 8px}' +
    '#sk-consent .sk-c-row{display:flex;gap:8px;flex-wrap:wrap}' +
    '#sk-consent button{font:500 14px/1 inherit;font-family:inherit;border-radius:999px;padding:12px 20px;min-height:44px;cursor:pointer}' +
    '#sk-consent .sk-c-p{background:#4a63d8;background:oklch(0.55 0.22 262);color:#fff;border:1px solid transparent}' +
    '#sk-consent .sk-c-s{background:transparent;color:#f6f6f8;color:oklch(0.975 0.004 260);border:1px solid #8b90a0;border-color:oklch(0.65 0.01 260)}' +
    '#sk-consent button:focus-visible,#sk-consent summary:focus-visible,.sk-privacy-link:focus-visible{outline:2px solid #8da0ff;outline-offset:2px}' +
    '.sk-privacy-link{background:none;border:0;padding:4px 0;margin:0 0 0 16px;font:inherit;font-size:12px;color:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;opacity:.8}' +
    '@media (prefers-reduced-motion:no-preference){#sk-consent{animation:skCin .25s ease-out}@keyframes skCin{from{opacity:0}to{opacity:1}}}';

  var box = null, mode = '';
  function close() { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }
  function render() {
    if (!box) return;
    shownLang = it() ? 'it' : 'en';
    var items = COPY.list[it() ? 1 : 0].map(function () { return '<li></li>'; }).join('');
    box.innerHTML =
      '<h2></h2>' + (mode === 'reopen' ? '<p class="sk-c-now"></p>' : '<p class="sk-c-body"></p>') +
      '<details><summary></summary><ul>' + items + '</ul></details>' +
      '<div class="sk-c-row"></div>';
    box.querySelector('h2').textContent = t(COPY.title);
    if (mode === 'reopen') box.querySelector('.sk-c-now').textContent = t(COPY.now)[state() === 'granted' ? 0 : 1];
    else box.querySelector('.sk-c-body').textContent = t(mode === 'optin' ? COPY.optin : COPY.notice);
    box.querySelector('summary').textContent = t(COPY.more);
    Array.prototype.forEach.call(box.querySelectorAll('li'), function (el, i) { el.textContent = COPY.list[it() ? 1 : 0][i]; });
    var row = box.querySelector('.sk-c-row');
    function btn(cls, label, fn) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label;
      b.setAttribute('data-no-track', ''); b.addEventListener('click', fn); row.appendChild(b);
    }
    if (mode === 'optin') {
      btn('sk-c-p', t(COPY.yes), function () { set('granted'); close(); });
      btn('sk-c-s', t(COPY.no), function () { set('denied'); close(); });
    } else if (mode === 'notice') {
      btn('sk-c-p', t(COPY.ok), function () { lsSet(NKEY, '1'); close(); });
      btn('sk-c-s', t(COPY.out), function () { set('denied'); close(); });
    } else {
      btn('sk-c-p', t(COPY.allow), function () { set('granted'); close(); });
      btn('sk-c-s', t(COPY.no), function () { set('denied'); close(); });
    }
  }
  function show(m) {
    mode = m;
    if (!doc.getElementById('sk-consent-css')) {
      var st = doc.createElement('style'); st.id = 'sk-consent-css'; st.textContent = CSS; doc.head.appendChild(st);
    }
    close();
    box = doc.createElement('div');
    box.id = 'sk-consent'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Privacy');
    box.setAttribute('data-no-track', ''); box.setAttribute('data-clarity-mask', 'True');
    doc.body.appendChild(box);
    render();
  }
  var shownLang = '';
  doc.addEventListener('sk:lang-change', function () { if (box && shownLang !== (it() ? 'it' : 'en')) render(); });

  function reopen(from) {
    q(['track', 'consent_reopened', { from: from || 'link' }]);
    show('reopen');
  }
  doc.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-consent-open]');
    if (!el) return;
    e.preventDefault();
    reopen(el.getAttribute('data-consent-open') || 'link');
  });

  function init() {
    /* a way back to the choice on every page: add one to the footer if the page has none */
    if (!doc.querySelector('[data-consent-open]')) {
      var f = doc.querySelector('footer');
      if (f) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'sk-privacy-link'; b.setAttribute('data-consent-open', 'footer');
        b.textContent = t(COPY.link);
        if (!doc.getElementById('sk-consent-css')) {
          var st = doc.createElement('style'); st.id = 'sk-consent-css'; st.textContent = CSS; doc.head.appendChild(st);
        }
        var host = f.querySelector('.footer-copy') || f;
        host.appendChild(b);
        doc.addEventListener('sk:lang-change', function () { var x = t(COPY.link); if (b.textContent !== x) b.textContent = x; });
      }
    }
    var r = region();
    if (stored() || gpc()) return;
    if (r === 'eea') { show('optin'); q(['track', 'consent_shown', { region: r }]); }
    else if (!lsGet(NKEY)) { show('notice'); q(['track', 'consent_shown', { region: r }]); }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();

  window.SK_CONSENT = { state: state, region: region, set: set, open: reopen };
})();
