/* =========================================================
   CONTACT FORM: submits in place via fetch to Formspree.
   Without JavaScript the form still posts normally to Formspree,
   which then sends the visitor back to /contact?sent=1.
   Success is shown only when Formspree answers with a 2xx.
   ========================================================= */
(function () {
  var form = document.getElementById('contactForm');
  if (!form) return;

  var ok = document.getElementById('formSuccess');
  var err = document.getElementById('formError');
  var btn = form.querySelector('button[type=submit]');
  var btnLabel = btn ? btn.querySelector('span') : null;
  var again = document.getElementById('formAgain');
  var MAIL = 'saikanagat1117@gmail.com';

  function it() { return document.documentElement.getAttribute('lang') === 'it'; }
  function t(en, itText) { return it() ? itText : en; }

  function showSuccess() {
    err.hidden = true;
    form.hidden = true;
    ok.hidden = false;
    ok.setAttribute('tabindex', '-1');
    try { ok.focus({ preventScroll: false }); } catch (e) {}
  }

  function showError(detail) {
    err.textContent = t(
      'Your message did not send. ' + (detail ? detail + ' ' : '') + 'Please try again, or email ' + MAIL + ' directly.',
      'Il messaggio non è stato inviato. ' + (detail ? detail + ' ' : '') + 'Riprova, oppure scrivi direttamente a ' + MAIL + '.'
    );
    err.hidden = false;
  }

  function busy(on) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (btnLabel) {
      if (on) { btnLabel.setAttribute('data-keep', btnLabel.textContent); btnLabel.textContent = t('Sending...', 'Invio in corso...'); }
      else if (btnLabel.getAttribute('data-keep')) { btnLabel.textContent = btnLabel.getAttribute('data-keep'); btnLabel.removeAttribute('data-keep'); }
    }
  }

  // Back from the no-JS fallback redirect.
  if (/(^|[?&])sent=1(&|$)/.test(location.search)) {
    showSuccess();
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  }

  if (again) again.addEventListener('click', function () {
    ok.hidden = true; form.hidden = false; form.reset();
    var first = form.querySelector('input[type=text]'); if (first) first.focus();
  });

  form.addEventListener('submit', function (e) {
    if (!window.fetch || !window.FormData) return;   // old browser: normal post
    e.preventDefault();
    if (form.reportValidity && !form.reportValidity()) return;
    err.hidden = true;
    busy(true);

    var ctl = null, timer = null;
    try { ctl = new AbortController(); timer = setTimeout(function () { ctl.abort(); }, 15000); } catch (x) {}

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' },
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (r.ok && !(r.data && (r.data.ok === false || r.data.errors))) {
        showSuccess();
      } else {
        var detail = '';
        if (r.data && r.data.errors && r.data.errors.length) {
          detail = t('Please check the details you entered.', 'Controlla i dati inseriti.');
        }
        showError(detail);
      }
    }).catch(function () {
      showError('');
    }).then(function () {
      if (timer) clearTimeout(timer);
      busy(false);
    });
  });
})();
