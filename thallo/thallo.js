(function () {
  /* Waitlist forms (hero and closing band): post to Formspree in place. */
  var MAIL = 'saikanagat1117@gmail.com';
  var blocks = [].slice.call(document.querySelectorAll('.wl'));
  function done(b) { var f = b.querySelector('.wl-form'), ok = b.querySelector('.wl-ok'); if (f) f.hidden = true; if (ok) ok.hidden = false; }
  if (/(^|[?&])sent=1(&|$)/.test(location.search)) {
    blocks.forEach(done);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  }
  var nav = document.getElementById('navJoin'), hero = document.getElementById('heroEmail');
  if (nav && hero) nav.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { try { hero.focus({ preventScroll: true }); } catch (x) {} }, 350); });
  blocks.forEach(function (b) {
    var form = b.querySelector('.wl-form'); if (!form) return;
    var err = form.querySelector('.msg'), btn = form.querySelector('button[type=submit]');
    function showErr() { err.textContent = 'That did not go through. Please try again, or email ' + MAIL + ' and say you want on the Thallo waitlist.'; err.hidden = false; }
    form.addEventListener('submit', function (e) {
      if (!window.fetch || !window.FormData) return;
      e.preventDefault();
      if (form.reportValidity && !form.reportValidity()) return;
      err.hidden = true;
      var label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending';
      var ctl = null, timer = null;
      try { ctl = new AbortController(); timer = setTimeout(function () { ctl.abort(); }, 15000); } catch (x) {}
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' }, signal: ctl ? ctl.signal : undefined })
        .then(function (res) { return res.json().catch(function () { return null; }).then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) { if (r.ok && !(r.d && (r.d.ok === false || r.d.errors))) { blocks.forEach(done); } else showErr(); })
        .catch(showErr)
        .then(function () { if (timer) clearTimeout(timer); btn.disabled = false; btn.textContent = label; });
    });
  });
})();
