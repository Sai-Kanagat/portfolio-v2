/* =========================================================
   PAGE TRANSITIONS — SK Portfolio
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

  // Intercept nav clicks
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    // Only handle internal relative links (not mailto:, #anchors, or external)
    if (!href || href.startsWith('mailto:') || href.startsWith('http') || href.startsWith('#')) return;
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
})();
