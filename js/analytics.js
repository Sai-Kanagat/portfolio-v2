/* =========================================================
   SK PORTFOLIO — ANALYTICS LAYER
   Comprehensive dataLayer event tracking for GTM → GA4.
   Consent Mode v2 default is set inline in <head> (see snippet).
   This file pushes semantic events GTM forwards to GA4.

   Events emitted:
     page_view_enhanced      every page (path, title, lang)
     scroll_depth            25 / 50 / 75 / 100 %
     project_open            work/gallery project panel opened
     project_close           panel closed
     cta_click               any .btn / primary CTA
     nav_click               top-nav link
     demo_launch             live demo opened
     outbound_click          external link (github, vercel, linkedin…)
     email_click             mailto:
     file_download           pdf / asset downloads
     lang_toggle             EN / IT switch
     brandbook_view          brandbook nav click
     form_start / form_submit  contact form
   ========================================================= */
(function () {
  window.dataLayer = window.dataLayer || [];
  function push(event, params) {
    var payload = Object.assign({ event: event }, params || {});
    window.dataLayer.push(payload);
  }
  window.skTrack = push; // expose for ad-hoc use

  function lang() {
    return document.documentElement.getAttribute('data-lang') || 'en';
  }

  // ---- Enhanced page_view (GA4 already auto-collects, this adds lang + clean path) ----
  push('page_view_enhanced', {
    page_path: location.pathname,
    page_title: document.title,
    site_lang: lang(),
    referrer: document.referrer || '(direct)'
  });

  // ---- Scroll depth (25/50/75/100) ----
  var marks = [25, 50, 75, 100];
  var fired = {};
  function onScroll() {
    var st = window.scrollY || document.documentElement.scrollTop;
    var docH = document.documentElement.scrollHeight - window.innerHeight;
    if (docH <= 0) return;
    var pct = Math.round((st / docH) * 100);
    marks.forEach(function (m) {
      if (pct >= m && !fired[m]) {
        fired[m] = true;
        push('scroll_depth', { percent: m, page_path: location.pathname });
      }
    });
  }
  var scrollRAF = null;
  window.addEventListener('scroll', function () {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(function () { onScroll(); scrollRAF = null; });
  }, { passive: true });

  // ---- Delegated click tracking ----
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a, button, .work-card, .we-row, .demo-tile, [data-project]');
    if (!a) return;

    // Project panel open (work + gallery cards / rows)
    var projId = a.getAttribute && (a.getAttribute('data-project') || (a.closest('[data-project]') && a.closest('[data-project]').getAttribute('data-project')));
    if (projId) {
      push('project_open', { project_id: projId, site_lang: lang() });
      return;
    }

    if (a.tagName === 'A') {
      var href = a.getAttribute('href') || '';
      // mailto
      if (href.indexOf('mailto:') === 0) {
        push('email_click', { email: href.replace('mailto:', '') });
        return;
      }
      // file download
      if (/\.(pdf|zip|png|jpe?g|mp4|mov)(\?|$)/i.test(href)) {
        push('file_download', { file: href.split('/').pop(), page_path: location.pathname });
        return;
      }
      // demo launch
      if (/\/demos?\//.test(href) || a.classList.contains('demo-tile')) {
        push('demo_launch', { demo: href.split('/').pop().replace('.html', ''), page_path: location.pathname });
        return;
      }
      // brandbook
      if (/brand-identity/.test(href)) {
        push('brandbook_view', { source: 'nav' });
      }
      // outbound
      var isExternal = /^https?:\/\//.test(href) && href.indexOf(location.hostname) === -1;
      if (isExternal) {
        var dest = href.replace(/^https?:\/\//, '').split('/')[0];
        push('outbound_click', { url: href, domain: dest });
        return;
      }
      // top-nav
      if (a.closest('.nav-links')) {
        push('nav_click', { label: (a.textContent || '').trim(), href: href });
      }
      // CTA buttons
      if (a.classList.contains('btn') || a.classList.contains('v3-btn') || a.classList.contains('sw-all-btn') || a.classList.contains('hero-cta')) {
        push('cta_click', { label: (a.textContent || '').trim().slice(0, 40), page_path: location.pathname });
      }
    }
  }, true);

  // ---- Language toggle ----
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.lang-toggle [data-l]');
    if (b) push('lang_toggle', { to: b.getAttribute('data-l') });
  });

  // ---- Project close ----
  var origClose = window.closePanel;
  if (typeof origClose === 'function') {
    window.closePanel = function () { push('project_close', {}); return origClose.apply(this, arguments); };
  }

  // ---- Contact form ----
  var form = document.querySelector('form');
  if (form) {
    var started = false;
    form.addEventListener('input', function () {
      if (!started) { started = true; push('form_start', { form: 'contact' }); }
    }, { once: false });
    form.addEventListener('submit', function () {
      push('form_submit', { form: 'contact' });
    });
  }
})();
