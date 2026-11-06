/* =========================================================
   PAGE TRANSITIONS - SK Portfolio
   Fade overlay on nav link clicks
   ========================================================= */

(function() {
  // Create overlay element
  const overlay = document.createElement('div');
  overlay.id = 'page-transition';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: #0a0a0a;
    opacity: 0; pointer-events: none;
    transition: opacity 0.35s ease;
  `;
  document.body.appendChild(overlay);

  // Fade in on load, then out
  window.addEventListener('load', () => {
    overlay.style.opacity = '0';
  });

  // Intercept plain left-clicks on internal page links only. Modified
  // clicks, new-tab links, downloads and non-page files go to the browser.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    // Only handle internal relative links (not mailto:, #anchors, or external)
    if (!href || /^(mailto:|tel:|https?:|\/\/|#|javascript:)/i.test(href)) return;
    if (/\.(pdf|zip|png|jpe?g|webp|svg|mp4|mp3|txt|xml)([?#]|$)/i.test(href)) return;
    e.preventDefault();
    overlay.style.pointerEvents = 'all';
    overlay.style.opacity = '1';
    setTimeout(() => {
      window.location.href = href;
    }, 350);
  });

  // Fade out after arriving at new page
  document.addEventListener('DOMContentLoaded', () => {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.pointerEvents = 'none'; }, 400);
  });

  // Back/forward cache restore or a navigation that never happened:
  // never leave the page covered.
  window.addEventListener('pageshow', () => {
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
  });
})();
