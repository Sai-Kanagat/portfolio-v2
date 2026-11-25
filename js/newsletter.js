/* =========================================================
   NEWSLETTER SIGNUP: Brevo double opt-in, native styled form.
   Mounted above the footer on the blog index and every post.
   ========================================================= */
(function () {
  var ACTION = 'https://4495a9bb.sibforms.com/serve/MUIFABgx6BoYTDFdnBJKDw66k5nMUKvwUbaPp1NFGeSC2F1o_LQNEgbFvzn6Uu_kOZD-lFKx1CZ2y_Cic0NAHG8jyL1WuBnrL7DyWs27LHx3qgsXykn5RuZJaHuEujAHpMTn8a0e3ZR_6d5I8NV_yBQsm2zo2tlBTQ6EI6nnqzj1g0NQI-hVsr_b5U-SXDn6gKME5GVMSU5kDBOX7Q==?isAjax=1';
  var footer = document.querySelector('footer.footer');
  if (!footer) return;
  function T(n) { try { var a = [n, { page_path: location.pathname }]; window.sk ? sk.track.apply(sk, a) : (window.skq = window.skq || []).push(['track'].concat(a)); } catch (e) {} }

  var css = document.createElement('style');
  css.textContent =
    '#sk-news{background:#14161c!important;color:#f4f3ef!important;padding:clamp(48px,7vw,88px) clamp(24px,6vw,80px);position:relative;z-index:1}' +
    '.sk-news-in{max-width:760px;margin:0 auto}' +
    '.sk-news-k{font-family:var(--mono,monospace);font-size:11px;letter-spacing:.22em;text-transform:uppercase;opacity:.6;margin:0 0 14px}' +
    '#sk-news h2{font-family:var(--sans,sans-serif)!important;font-weight:500!important;font-size:clamp(28px,4vw,44px)!important;letter-spacing:-.02em!important;line-height:1.1!important;margin:0 0 12px!important;color:#f4f3ef!important;text-transform:none!important}' +
    '#sk-news p{color:#f4f3ef!important}.sk-news-d{font-size:16px;line-height:1.55;opacity:.75;margin:0 0 28px;max-width:560px}' +
    '.sk-news form{display:flex;gap:10px;flex-wrap:wrap}' +
    '#sk-news input[type=email]{flex:1 1 260px;min-width:0;font:inherit;font-size:16px;color:#f4f3ef;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:14px 20px}' +
    '.sk-news input[type=email]::placeholder{color:rgba(255,255,255,.5)}' +
    '#sk-news button{font-family:var(--mono,monospace);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#14161c!important;background:#f4f3ef!important;border:0;border-radius:999px;padding:14px 26px;cursor:pointer}' +
    '.sk-news button[disabled]{opacity:.5;cursor:default}' +
    '.sk-news-hp{position:absolute;left:-9999px}' +
    '.sk-news-s{font-size:14px;min-height:20px;margin:14px 0 0}' +
    '.sk-news-f{font-size:12px;opacity:.55;margin:10px 0 0}' +
    '#sk-news-fab{position:fixed;left:20px;bottom:20px;z-index:900;font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#f4f3ef!important;background:#14161c!important;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:12px 18px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .25s ease,transform .25s ease}' +
    '#sk-news-fab.is-on{opacity:1;transform:none;pointer-events:auto;animation:skNudge 7s ease-in-out 2s infinite}' +
    '#sk-news-fab::before{content:"";position:absolute;inset:-1px;border-radius:999px;border:2px solid #1F40C7;opacity:0;pointer-events:none}' +
    '#sk-news-fab.is-on::before{animation:skHalo 2.4s cubic-bezier(.2,.8,.2,1) infinite}' +
    '#sk-news-fab::after{content:"";position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:#ff3b30;box-shadow:0 0 0 2px #f4f3ef;animation:skPing 1.6s ease-in-out infinite}' +
    '#sk-news-fab:hover{background:#1F40C7!important;border-color:#1F40C7;animation:none}' +
    '@keyframes skHalo{0%{opacity:.75;transform:scale(1)}100%{opacity:0;transform:scale(1.35,1.9)}}' +
    '@keyframes skPing{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}' +
    '@keyframes skNudge{0%,86%,100%{transform:none}88%{transform:translateY(-6px) rotate(-3deg)}90%{transform:translateY(0) rotate(3deg)}92%{transform:translateY(-3px) rotate(-2deg)}94%{transform:none}}' +
    '@media (prefers-reduced-motion:reduce){#sk-news-fab,#sk-news-fab::before,#sk-news-fab::after{transition:none;animation:none!important}}';
  document.head.appendChild(css);

  var box = document.createElement('section');
  box.className = 'sk-news'; box.id = 'sk-news';
  box.setAttribute('aria-labelledby', 'sk-news-t');
  box.innerHTML =
    '<div class="sk-news-in">' +
    '<p class="sk-news-k" data-en="Newsletter" data-it="Newsletter">Newsletter</p>' +
    '<h2 id="sk-news-t" data-en="New posts, straight to your inbox." data-it="Nuovi articoli, direttamente nella tua casella.">New posts, straight to your inbox.</h2>' +
    '<p class="sk-news-d" data-en="Notes on design, marketing and AI, and what I am building. Only when there is something worth reading." data-it="Note su design, marketing e AI, e su ciò che sto costruendo. Solo quando c\'è qualcosa che vale la pena leggere.">Notes on design, marketing and AI, and what I am building. Only when there is something worth reading.</p>' +
    '<form novalidate>' +
    '<input type="email" name="EMAIL" required autocomplete="email" aria-label="Email" placeholder="you@email.com">' +
    '<input class="sk-news-hp" type="text" name="email_address_check" value="" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<input type="hidden" name="locale" value="en">' +
    '<button type="submit" data-en="Subscribe" data-it="Iscriviti">Subscribe</button>' +
    '</form>' +
    '<p class="sk-news-s" role="status" aria-live="polite"></p>' +
    '<p class="sk-news-f" data-en="You will get one email to confirm. Unsubscribe any time." data-it="Riceverai una email di conferma. Puoi disiscriverti quando vuoi.">You will get one email to confirm. Unsubscribe any time.</p>' +
    '</div>';
  footer.parentNode.insertBefore(box, footer);

  var fab = document.createElement('button');
  fab.id = 'sk-news-fab';
  fab.type = 'button';
  fab.setAttribute('data-en', 'Get new posts');
  fab.setAttribute('data-it', 'Ricevi i nuovi articoli');
  fab.textContent = 'Get new posts';
  document.body.appendChild(fab);

  var boxVisible = false;
  var fabSeen = false, viewSeen = false;
  function syncFab() {
    var on = window.scrollY > 300 && !boxVisible;
    fab.classList.toggle('is-on', on);
    if (on && !fabSeen) { fabSeen = true; T('newsletter_fab_shown'); }
  }
  window.addEventListener('scroll', syncFab, { passive: true });
  new IntersectionObserver(function (entries) {
    boxVisible = entries[0].isIntersecting;
    if (boxVisible && !viewSeen) { viewSeen = true; T('newsletter_view'); }
    syncFab();
  }).observe(box);
  fab.addEventListener('click', function () {
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    box.querySelector('input[type=email]').focus({ preventScroll: true });
    T('newsletter_fab_click');
  });

  var form = box.querySelector('form'), started = false;
  form.EMAIL.addEventListener('focus', function () { if (!started) { started = true; T('newsletter_start'); } });
  var status = box.querySelector('.sk-news-s');
  var btn = box.querySelector('button');
  function it() { return document.documentElement.getAttribute('lang') === 'it'; }
  function say(en, itText) { status.textContent = it() ? itText : en; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.EMAIL.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say('Please enter a valid email.', 'Inserisci una email valida.');
      T('newsletter_invalid');
      return;
    }
    form.locale.value = it() ? 'it' : 'en';
    btn.disabled = true;
    fetch(ACTION, { method: 'POST', mode: 'no-cors', body: new FormData(form) }).then(function () {
      say('Almost there. Check your inbox to confirm.', 'Ci siamo quasi. Controlla la posta per confermare.');
      form.reset();
      T('newsletter_request');
    }).catch(function () {
      say('Something went wrong. Please try again.', 'Qualcosa è andato storto. Riprova.');
      T('newsletter_failed');
    }).finally(function () { btn.disabled = false; });
  });
})();
