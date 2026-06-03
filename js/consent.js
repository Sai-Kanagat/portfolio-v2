/* =========================================================
   CONSENT MODE v2 — minimal GDPR cookie banner
   Shows once. Stores choice in localStorage.
   Updates Google Consent Mode on accept/decline.
   ========================================================= */
(function () {
  var KEY = 'sk_consent';
  function gtag(){ window.dataLayer = window.dataLayer || []; window.dataLayer.push(arguments); }
  function setConsent(granted){
    try { localStorage.setItem(KEY, granted ? 'granted' : 'denied'); } catch(e){}
    gtag('consent','update', granted ? {
      'ad_storage':'granted','ad_user_data':'granted','ad_personalization':'granted','analytics_storage':'granted'
    } : {
      'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'
    });
    gtag('event','consent_update',{ 'consent_state': granted ? 'granted' : 'denied' });
  }
  var existing = null;
  try { existing = localStorage.getItem(KEY); } catch(e){}
  if (existing === 'granted' || existing === 'denied') return; // already chose

  // EEA/UK/CH only — non-EEA traffic gets granted by default (handled by gtag region config in <head>).
  // Detect locale as a soft proxy; the gtag region defaults are the legal source of truth.
  var EEA = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB','CH'];
  var lang = (navigator.language || 'en').toUpperCase();
  var region = lang.split('-')[1] || '';
  var likelyEEA = EEA.indexOf(region) !== -1 ||
                  ['IT','EN-GB','EN-IE','FR','DE','ES','NL','PL','SV','FI','DA','NO','CS','HU','EL','PT','RO','SK','SL','LT','LV','ET'].some(function(p){ return lang.indexOf(p) === 0; });
  if (!likelyEEA) {
    // Outside EEA: silently grant + skip banner
    try { localStorage.setItem(KEY, 'granted'); } catch(e){}
    return;
  }

  var bar = document.createElement('div');
  bar.id = 'sk-consent';
  bar.setAttribute('role','dialog');
  bar.setAttribute('aria-label','Cookies & analytics');
  bar.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;max-width:520px;margin-left:auto;background:#0E1116;color:#f4f3ef;border-radius:14px;padding:18px 20px;box-shadow:0 16px 48px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.08);font-family:"Bricolage Grotesque","Inter Tight",system-ui,sans-serif;font-size:13px;line-height:1.5;z-index:99999;opacity:0;transform:translateY(8px);transition:opacity 400ms ease,transform 400ms ease;';
  bar.innerHTML = '<div style="font-family:\'Newsreader\',serif;font-style:italic;font-size:15px;margin-bottom:6px;">A short note on privacy.</div>'+
    '<div style="color:rgba(244,243,239,0.75);margin-bottom:14px;">This site uses Google Analytics to understand what people read. No ads, no tracking pixels, no selling. Accept to help me see what works, or decline and nothing is recorded.</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
      '<button id="sk-consent-yes" style="background:#1F40C7;color:#fff;border:none;border-radius:999px;padding:8px 18px;font-family:inherit;font-size:12px;letter-spacing:0.04em;cursor:pointer;">Accept analytics</button>'+
      '<button id="sk-consent-no" style="background:transparent;color:rgba(244,243,239,0.7);border:1px solid rgba(244,243,239,0.18);border-radius:999px;padding:8px 18px;font-family:inherit;font-size:12px;letter-spacing:0.04em;cursor:pointer;">Decline</button>'+
    '</div>';
  function mount(){
    document.body.appendChild(bar);
    requestAnimationFrame(function(){ bar.style.opacity = '1'; bar.style.transform = 'translateY(0)'; });
    bar.querySelector('#sk-consent-yes').addEventListener('click', function(){ setConsent(true); dismiss(); });
    bar.querySelector('#sk-consent-no').addEventListener('click', function(){ setConsent(false); dismiss(); });
  }
  function dismiss(){
    bar.style.opacity = '0'; bar.style.transform = 'translateY(8px)';
    setTimeout(function(){ if (bar.parentNode) bar.parentNode.removeChild(bar); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
