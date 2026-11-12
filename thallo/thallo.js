(function () {
  /* Launch film: only mounts the player if the file really exists. */
  var slot = document.getElementById('film');
  if (slot && window.fetch) {
    var src = '/thallo/assets/thallo_launch.mp4';
    fetch(src, { method: 'HEAD' }).then(function (r) {
      var type = r.headers.get('content-type') || '';
      if (!r.ok || type.indexOf('video') !== 0) return;
      var v = document.createElement('video');
      v.controls = true; v.preload = 'metadata'; v.playsInline = true;
      v.poster = '/thallo/assets/launch-poster.svg';
      v.setAttribute('aria-label', 'Thallo launch film');
      v.src = src;
      slot.innerHTML = '';
      slot.appendChild(v);
    }).catch(function () {});
  }

  /* Waitlist form: posts to Formspree in place, same endpoint as the contact page. */
  var form = document.getElementById('waitlistForm');
  if (!form) return;
  var ok = document.getElementById('waitlistOk');
  var err = document.getElementById('waitlistErr');
  var btn = form.querySelector('button[type=submit]');
  var MAIL = 'saikanagat1117@gmail.com';

  function showOk() { err.hidden = true; form.hidden = true; ok.hidden = false; ok.setAttribute('tabindex', '-1'); try { ok.focus(); } catch (e) {} }
  function showErr() { err.textContent = 'That did not go through. Please try again, or email ' + MAIL + ' and say you want on the Thallo waitlist.'; err.hidden = false; }

  if (/(^|[?&])sent=1(&|$)/.test(location.search)) {
    showOk();
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  }

  form.addEventListener('submit', function (e) {
    if (!window.fetch || !window.FormData) return;
    e.preventDefault();
    if (form.reportValidity && !form.reportValidity()) return;
    err.hidden = true;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending';
    var ctl = null, timer = null;
    try { ctl = new AbortController(); timer = setTimeout(function () { ctl.abort(); }, 15000); } catch (x) {}
    fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) { if (r.ok && !(r.d && (r.d.ok === false || r.d.errors))) showOk(); else showErr(); })
      .catch(showErr)
      .then(function () { if (timer) clearTimeout(timer); btn.disabled = false; btn.textContent = label; });
  });
})();
