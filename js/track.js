/* =========================================================
   track.js: the client event bus (window.sk). Contract: tracking/CONTRACT.md
   Ids, buckets, counts and ms only. Never typed text, file names, emails,
   camera or mic data, or share-link state. Fails silently and never changes
   behaviour or frame rate: passive listeners, no per-frame work.
   Sinks: g to dataLayer once consent allows, d to /api/e only when granted.
   ========================================================= */
(function (w, d) {
  'use strict';
  if (w.sk && w.sk.v) return;
  var EP = '/api/e', NOW = Date.now;

  /* ---------- catalogue: names routed to GA4 and D1 (3) or D1 only (2) ---------- */
  var K = {};
  ('page_leave scroll_milestone page_not_found consent_choice nav_click menu_toggle lang_toggle outbound_click email_click phone_click ' +
   'file_download cv_download brandbook_click project_open project_close filter_apply form_start form_error form_submit_attempt ' +
   'form_submit_success form_submit_failure form_abandon newsletter_request media_result demo_open demo_start demo_engaged demo_end ' +
   'demo_action article_progress article_complete video_progress haunt_start haunt_end js_error hire_pdf').split(' ').forEach(function (n) { K[n] = 3; });
  ('page_view section_view ui_click ui_hover input_change rage_click dead_click cursor_sample cursor_idle tap text_select copy web_vital ' +
   'consent_shown consent_reopened footer_click form_view form_field newsletter_view newsletter_fab_shown newsletter_fab_click ' +
   'newsletter_start newsletter_invalid newsletter_failed newsletter_confirmed project_prev project_next project_preview lightbox_open ' +
   'lightbox_nav lightbox_close haunt_mode haunt_interrupted haunt_stop_click intro_shown intro_completed intro_skipped cursor_enabled ' +
   'video_state model_state demo_error tour_start tour_step tour_exit').split(' ').forEach(function (n) { K[n] = 2; });
  var KEYEV = { form_submit_success: 1, email_click: 1, cv_download: 1, newsletter_confirmed: 1, hire_pdf: 1 };
  var BAN = { source: 1, medium: 1, campaign: 1, content: 1, term: 1 };
  var ALIAS = { newsletter_signup: 'newsletter_request' };

  /* ---------- storage and small helpers ---------- */
  function lg(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function ls(k, v) { try { v == null ? w.localStorage.removeItem(k) : w.localStorage.setItem(k, v); } catch (e) {} }
  function sg(k) { try { return w.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ss(k, v) { try { v == null ? w.sessionStorage.removeItem(k) : w.sessionStorage.setItem(k, v); } catch (e) {} }
  function mm(q) { try { return w.matchMedia(q).matches; } catch (e) { return false; } }
  function safe(f) { return function () { try { return f.apply(this, arguments); } catch (e) {} }; }
  function slug(s, n) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 24); }
  function hex(n) {
    var a = new Uint8Array(n / 2);
    try { w.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.random() * 256; }
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function bucketLen(n) { return n <= 0 ? '0' : n <= 20 ? '1-20' : n <= 80 ? '21-80' : n <= 300 ? '81-300' : '300+'; }
  function bucketCount(n) { return n <= 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : '21+'; }

  /* ---------- kill switch ---------- */
  if (/[?&]sk_off=1/.test(location.search)) ls('sk_off', '1');
  if (/[?&]sk_off=0/.test(location.search)) ls('sk_off', null);
  var off = lg('sk_off');
  var OFF = w.SK_OFF === true || off === '1' || +off > NOW();

  /* ---------- consent ---------- */
  var ST = 'pending';
  function readState() {
    var C = w.SK_CONSENT;
    if (C) return C.state();
    var v = lg('sk_consent_v2');
    return v === 'granted' || v === 'denied' ? v : 'pending';
  }
  ST = readState();

  /* ---------- context ---------- */
  var PID = hex(16), HTML = d.documentElement;
  var PT = (function () {
    var a = HTML.getAttribute('data-page-type');
    if (a) return slug(a, 24);
    var p = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '');
    if (!p) return 'home';
    var m = p.match(/^\/([^/]+)(\/.+)?$/), f = m ? m[1] : '', sub = m && m[2];
    if (f === 'blog') return sub ? 'post' : 'blog';
    if (f === 'demos') return sub ? 'demo' : 'demos';
    if (/^(shadow-theatre|melt|cortex)$/.test(f)) return 'demo';
    if (/^(ad-autopsy|positioning|hire)$/.test(f)) return 'tool';
    if (f === 'brand-identity') return 'brand';
    if (/^aperol/.test(f)) return 'aperol';
    if (f === 'papers') return 'paper';
    if (f === 'build-log') return 'build-log';
    if (/^(work|gallery|about|process|contact|thallo)$/.test(f)) return f;
    return 'other';
  })();
  function lang() { return (HTML.getAttribute('data-lang') || HTML.getAttribute('lang') || 'en').slice(0, 2); }
  function own() { return lg('sk_owner') === '1'; }
  function cpath() { return location.pathname.replace(/index\.html$/, '') || '/'; }
  var QOK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'sk_l', 'lang', 'haunt'];
  function cleanUrl() {
    var out = [];
    try {
      var qs = new URLSearchParams(location.search);
      QOK.forEach(function (k) { var v = qs.get(k); if (v && /^[\w.~ %+\-]{1,60}$/.test(v)) out.push(k + '=' + encodeURIComponent(v)); });
    } catch (e) {}
    return location.origin + cpath() + (out.length ? '?' + out.join('&') : '');
  }
  /* owner and test flags */
  (function () {
    var qs = location.search, m;
    if ((m = qs.match(/[?&]sk_owner=([01])/))) ls('sk_owner', m[1] === '1' ? '1' : null);
    if ((m = qs.match(/[?&]sk_test=([\w-]{1,40})/))) ss('sk_test', m[1]);
  })();

  /* attribution: entry link, utm and the external referrer, kept for the visit once consent allows */
  var A = { l: '', u: {}, r: '' };
  (function () {
    var s = null;
    try { s = JSON.parse(sg('sk_a') || 'null'); } catch (e) {}
    if (s && typeof s === 'object') A = { l: s.l || '', u: s.u || {}, r: s.r || '' };
    var qs;
    try { qs = new URLSearchParams(location.search); } catch (e) { return; }
    var l = qs.get('sk_l'), u = {}, any = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
      var v = qs.get(k);
      if (v && /^[\w.~ %+\-]{1,60}$/.test(v)) { u[k] = v; any = true; }
    });
    if (l && /^[a-z0-9][a-z0-9-]{1,40}$/i.test(l)) A.l = l.toLowerCase();
    if (any) A.u = u;
    if (!A.r && !s) {
      try {
        var h = new URL(d.referrer).hostname;
        if (h && h !== location.hostname && !/(^|\.)saikanagat\.com$/.test(h)) A.r = h.slice(0, 60);
      } catch (e) {}
    }
  })();
  function persist() { ss('sk_a', JSON.stringify(A)); }
  function ids() {
    var v = lg('sk_vid'), s = sg('sk_sid'), t = +sg('sk_st') || 0, n = NOW();
    if (!/^[0-9a-f]{16}$/.test(v || '')) { v = hex(16); ls('sk_vid', v); }
    if (!/^[0-9a-f]{16}$/.test(s || '') || n - t > 1800000) { s = hex(16); ss('sk_sid', s); }
    ss('sk_st', String(n));
    return { vid: v, sid: s };
  }
  function device() {
    var vw = w.innerWidth, coarse = mm('(pointer: coarse)');
    return vw < 768 && coarse ? 'mobile' : coarse && vw < 1100 ? 'tablet' : 'desktop';
  }
  function ctx() {
    return { path: cpath(), page_type: PT, lang: lang(), device: device(), vw: w.innerWidth, vh: w.innerHeight,
      ref_host: A.r || '', link: A.l || '', utm: A.u || {}, owner: own() ? 1 : 0, test: sg('sk_test') || '' };
  }

  /* ---------- clarity tags and events ---------- */
  function ctag(k, v) { try { if (w.clarity) w.clarity('set', k, String(v)); } catch (e) {} }
  function clarityTags() {
    ctag('page_type', PT); ctag('device', device()); ctag('entry_link', A.l || 'none');
    try { ctag('consent_region', w.SK_CONSENT ? w.SK_CONSENT.region() : 'unknown'); } catch (e) {}
  }

  /* ---------- the bus ---------- */
  var G = false;                 // the ghost flag: behavioural collectors ignore everything
  var Q = [], GQ = [], cnt = 0, DD = {}, TM = 0, fails = 0, LAPI = 0, LEFT = false;
  var GOK = /^(haunt_|consent_)|^(js_error|web_vital|page_view|page_leave|page_not_found)$/;
  function clean(p) {
    var o = {}, k, v;
    if (p) for (k in p) {
      v = p[k];
      if (BAN[k] || !/^[a-z_][a-z0-9_]*$/i.test(k)) continue;
      if (typeof v === 'number') { if (isFinite(v)) o[k] = Math.round(v * 1000) / 1000; }
      else if (typeof v === 'boolean') o[k] = v ? 1 : 0;
      else if (typeof v === 'string') {
        v = v.slice(0, k === 'cells' ? 900 : 60);
        if (v && v.indexOf('@') < 0 && !/^https?:/i.test(v)) o[k] = v;
      }
    }
    return o;
  }
  var GK = {};  /* every key an earlier push used: GTM merges pushes, so absent keys must be reset */
  function gpush(n, p) {
    if (ST !== 'granted') return;  /* never to the data layer unless consent is granted, drained queues included */
    var o = { event: n }, k;
    for (k in p) o[k] = p[k];
    o.page_type = PT; o.entry_link = A.l || 'none'; o.consent_state = 'granted'; o.device_class = device();
    o.is_owner = own() ? '1' : '0'; o.site_lang = lang(); o.page_location_clean = cleanUrl();
    for (k in GK) if (!(k in o)) o[k] = undefined;
    for (k in o) GK[k] = 1;
    (w.dataLayer = w.dataLayer || []).push(o);
  }
  function drainG() { var q = GQ; GQ = []; q.forEach(function (x) { gpush(x[0], x[1]); }); }
  function ev(n, p) {
    if (OFF || !K[n] || ST === 'denied') return;
    if (G && !GOK.test(n)) return;
    if (++cnt > 1500) return;
    p = clean(p);
    var key = JSON.stringify(p), t = NOW(), last = DD[n];
    if (last && last[0] === key && t - last[1] < 250) return;
    DD[n] = [key, t];
    if (K[n] === 3) { if (ST === 'granted') gpush(n, p); else if (GQ.length < 100) GQ.push([n, p]); }
    if (KEYEV[n]) { try { if (w.clarity) w.clarity('event', n); } catch (e) {} }
    if (Q.length < 400) Q.push({ n: n, t: t, p: p });
    if (ST === 'granted') {
      if (LEFT) flush(true);  /* hidden: send now, the page may be gone before a timer fires */
      else if (Q.length >= 20) flush(); else if (!TM) TM = setTimeout(flush, 5000);
    }
  }
  function post(body, beacon) {
    var json = JSON.stringify(body);
    if (json.length > 28000 && body.ev.length > 1) {
      var h = body.ev.length >> 1;
      post({ v: 1, vid: body.vid, sid: body.sid, pid: body.pid, ctx: body.ctx, ev: body.ev.slice(0, h) }, beacon);
      post({ v: 1, vid: body.vid, sid: body.sid, pid: body.pid, ctx: body.ctx, ev: body.ev.slice(h) }, beacon);
      return;
    }
    try {
      if (beacon && w.navigator.sendBeacon && w.navigator.sendBeacon(EP, new Blob([json], { type: 'application/json' }))) return;
    } catch (e) {}
    try {
      w.fetch(EP, { method: 'POST', body: json, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } })
        .then(function (r) {
          if (r.status === 410) { ls('sk_off', String(NOW() + 86400000)); OFF = true; }
          else if (r.status >= 400 && r.status !== 429) fails++;
          else fails = 0;
        }, function () { fails++; });
    } catch (e) { fails++; }
  }
  function flush(beacon) {
    clearTimeout(TM); TM = 0;
    if (OFF || ST !== 'granted' || !Q.length || fails >= 5) return;
    var i = ids();
    persist();
    var batch = Q.splice(0, Q.length);
    post({ v: 1, vid: i.vid, sid: i.sid, pid: PID, ctx: ctx(), ev: batch }, beacon);
  }

  w.addEventListener('sk:consent', safe(function () {
    ST = readState();
    if (ST === 'denied') {
      Q.length = 0; GQ.length = 0; clearTimeout(TM); TM = 0;
      ls('sk_vid', null); ss('sk_sid', null); ss('sk_st', null); ss('sk_a', null);
    } else if (ST === 'granted') { persist(); drainG(); flush(); clarityTags(); }
  }));
  w.addEventListener('sk:clarity', safe(clarityTags));

  /* ---------- active clock: stops 30 s after the last trusted input ---------- */
  var vis = 0, act = 0, lastIn = NOW(), lv = 0, la = 0, maxScroll = 0;
  setInterval(function () {
    if (d.hidden) return;
    vis++;
    if (!G && NOW() - lastIn < 30000) act++;
  }, 1000);

  /* ---------- geometry ---------- */
  function cell(cx, cy) {
    var vw = w.innerWidth || 1;
    return [Math.max(0, Math.min(49, Math.floor(cx / vw * 50))), Math.max(0, Math.min(255, Math.floor((cy + (w.scrollY || 0)) / 40)))];
  }
  function elCell(el) { var r = el.getBoundingClientRect(); return cell(r.left + r.width / 2, r.top + r.height / 2); }

  /* ---------- element ids ---------- */
  var CTL = 'a[href],button,[role=button],[role=tab],[role=link],[role=menuitem],[role=switch],[role=checkbox],summary,label,input,select,textarea,[data-track],[data-project],.work-card,.filter-pill';
  function ctl(t) { var c = t.closest ? t.closest(CTL) : null; return c && !c.closest('[data-no-track]') ? c : null; }
  function zone(el) {
    var z = el.closest('[data-zone]');
    if (z) return slug(z.getAttribute('data-zone'), 24) || 'page';
    if (el.closest('nav,.nav,header')) return 'nav';
    if (el.closest('footer')) return 'footer';
    if (el.closest('.project-panel,[role=dialog]')) return 'panel';
    if (el.closest('.lb-overlay')) return 'lightbox';
    var s = el.closest('section[id]');
    return s ? slug(s.id, 24) || 'page' : 'page';
  }
  function label(el) {
    var tn = el.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tn)) return slug(el.name || el.id || el.type, 20);
    if (el.closest('[contenteditable]')) return '';
    return slug(el.getAttribute('aria-label') || el.getAttribute('title') || (tn === 'IMG' ? el.alt : '') || el.textContent, 24);
  }
  function tid(el) {
    var t = el.closest('[data-track]');
    if (t) return String(t.getAttribute('data-track')).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
    var l = label(el);
    return (zone(el) + '.' + el.tagName.toLowerCase() + (l ? '.' + l : '')).slice(0, 60);
  }

  /* ---------- clicks ---------- */
  var NC = 0, RC = [], RB = { n: 0, id: '', k: 0 }, DC = 0;
  function sameSite(h) { return h === location.hostname || /(^|\.)saikanagat\.com$/.test(h); }
  function sem(t, id, zn) {
    var el;
    if ((el = t.closest('.lang-toggle [data-l]'))) { ev('lang_toggle', { to: slug(el.getAttribute('data-l'), 5) }); return; }
    if ((el = t.closest('#hamburger,.nav-hamburger,[data-menu-toggle]'))) {
      setTimeout(safe(function () {
        var o = el.getAttribute('aria-expanded');
        if (o == null) o = d.querySelector('.nav-links.open,.nav-open,.menu-open') ? 'true' : 'false';
        ev('menu_toggle', { state: o === 'true' ? 'open' : 'closed' });
      }), 60);
      return;
    }
    var a = t.closest('a[href]'), u;
    if (!a) return;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
    if (u.protocol === 'mailto:') { ev('email_click', { track_id: id }); return; }
    if (u.protocol === 'tel:') { ev('phone_click', { track_id: id }); return; }
    if (!/^https?:$/.test(u.protocol)) return;
    var m = u.pathname.match(/([^/]+?)\.([a-z0-9]{2,4})$/i), ext = m ? m[2].toLowerCase() : '';
    if (a.hasAttribute('download') || /^(pdf|pptx?|docx?|xlsx?|zip|png|jpe?g|webp|svg|mp4|mov|csv|ics|vcf)$/.test(ext)) {
      var fid = slug(m ? m[1] : id, 40);
      if (/(^|-)(cv|resume|curriculum)(-|$)/.test(fid) || /^cv\./.test(id)) ev('cv_download', { file_id: fid });
      else ev('file_download', { file_id: fid, ext: ext || 'file' });
      return;
    }
    if (/brand-identity/.test(u.pathname)) { ev('brandbook_click', { link_location: zn }); return; }
    if (!sameSite(u.hostname)) { ev('outbound_click', { domain: u.hostname.replace(/^www\./, '').slice(0, 60), track_id: id }); return; }
    if (a.closest('nav,.nav,.nav-links,header')) ev('nav_click', { track_id: id, zone: zn });
    else if (a.closest('footer')) ev('footer_click', { track_id: id });
  }
  function rage(e, id) {
    if (!e.detail) return;
    var n = NOW(), x = e.clientX, y = e.clientY;
    RC = RC.filter(function (c) { return n - c.t < 700 && Math.abs(c.x - x) <= 40 && Math.abs(c.y - y) <= 40; });
    RC.push({ t: n, x: x, y: y });
    if (RC.length >= 3) {
      RB.n = RC.length; RB.id = id; clearTimeout(RB.k);
      RB.k = setTimeout(function () { ev('rage_click', { track_id: RB.id, n: Math.min(RB.n, 20) }); RC = []; RB.n = 0; }, 900);
    }
  }
  var DCAND = 'button:not([type=submit]):not([type=reset]),[role=button],[role=tab],summary,[data-track]:not(a):not(input):not(select):not(textarea):not(label):not(form):not(canvas)';
  function dead(c, id) {
    if (DC || !c || !c.matches(DCAND) || c.disabled || !w.MutationObserver) return;
    DC = 1;
    var mut = 0, sc = 0, t0 = NOW();
    var mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var n = recs[i].target, el = n && (n.nodeType === 1 ? n : n.parentElement);
        if (el && !(el.closest && el.closest('.mag-cursor,[data-no-track]'))) { mut = 1; return; }
      }
    });
    mo.observe(HTML, { subtree: true, childList: true, attributes: true, characterData: true });
    function onS() { sc = 1; }
    w.addEventListener('scroll', onS, { capture: true, passive: true });
    setTimeout(function () {
      mo.disconnect(); w.removeEventListener('scroll', onS, true); DC = 0;
      if (!mut && !sc && !LEFT && LAPI < t0 && !G && !d.hidden) ev('dead_click', { track_id: id });
    }, 700);
  }
  d.addEventListener('click', safe(function (e) {
    if (OFF || G || ST === 'denied' || !e.isTrusted) return;
    var t = e.target;
    if (!t || !t.closest || t.closest('[data-no-track]')) return;
    var c = ctl(t), zn = zone(c || t), id = c ? tid(c) : zn + '.area';
    var cl = e.detail ? cell(e.clientX, e.clientY) : elCell(c || t);
    sem(t, id, zn);
    ev('ui_click', { track_id: id, zone: zn, x: cl[0], y: cl[1], nth: Math.min(++NC, 99) });
    if (e.pointerType === 'touch') ev('tap', { x: cl[0], y: cl[1], track_id: c ? id : '' });
    rage(e, id);
    dead(c, id);
  }), true);

  /* ---------- hover dwell, cursor grid, selection, copy ---------- */
  var HV = { el: null, t: 0, n: {} };
  function endHover() {
    if (!HV.el) return;
    var ms = NOW() - HV.t, el = HV.el; HV.el = null;
    if (ms < 600) return;
    var id = tid(el);
    if ((HV.n[id] = (HV.n[id] || 0) + 1) <= 3) ev('ui_hover', { track_id: id, ms: Math.round(ms / 100) * 100 });
  }
  var NOHOVER = mm('(hover: none)');
  if (!NOHOVER) {
    d.addEventListener('mouseover', safe(function (e) {
      if (OFF || G || ST === 'denied' || !e.isTrusted || !e.target || !e.target.closest) return;
      var c = ctl(e.target);
      if (c === HV.el) return;
      endHover();
      if (c) { HV.el = c; HV.t = NOW(); }
    }), true);
    d.addEventListener('mouseout', safe(function (e) { if (!e.relatedTarget) endHover(); }), true);
  }
  var CM = {}, CT = 0, CN = 0, lastMv = 0, lastSample = 0;
  function flushCursor() {
    CT = 0;
    if (!CN) return;
    var ks = Object.keys(CM).sort(function (a, b) { return CM[b] - CM[a]; }).slice(0, 16);
    ev('cursor_sample', { cells: ks.join(';') });
    CM = {}; CN = 0;
  }
  function onMove(e) {
    if (!e.isTrusted) return;
    var n = NOW();
    if (!G) lastIn = n;
    if (OFF || G || ST === 'denied' || NOHOVER) return;
    if (lastMv && n - lastMv >= 3000) ev('cursor_idle', { ms: Math.min(60000, Math.round((n - lastMv) / 100) * 100) });
    lastMv = n;
    if (n - lastSample < 250) return;
    lastSample = n;
    var c = cell(e.clientX, e.clientY), k = c[0] + '.' + c[1];
    CM[k] = (CM[k] || 0) + 1; CN++;
    if (!CT) CT = setTimeout(flushCursor, 5000);
  }
  w.addEventListener('mousemove', safe(onMove), { capture: true, passive: true });
  ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown'].forEach(function (t) {
    w.addEventListener(t, safe(function (e) { if (e.isTrusted && !G) lastIn = NOW(); }), { capture: true, passive: true });
  });
  function selId(el) { var c = ctl(el); return c ? tid(c) : zone(el) + '.text'; }
  var lastSel = 0, selT = 0;
  d.addEventListener('selectionchange', function () {
    clearTimeout(selT);
    selT = setTimeout(safe(function () {
      if (OFF || G || ST === 'denied') return;
      var s = w.getSelection && w.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return;
      var a = d.activeElement;
      if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      var n = s.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement);
      if (!el || el.closest('[data-no-track]') || NOW() - lastSel < 3000) return;
      lastSel = NOW();
      ev('text_select', { track_id: selId(el) });
    }), 500);
  });
  d.addEventListener('copy', safe(function (e) {
    if (OFF || G || !e.isTrusted) return;
    var a = d.activeElement, el = e.target && e.target.nodeType === 1 ? e.target : (a || d.body);
    if (!el || (el.closest && el.closest('[data-no-track]'))) return;
    ev('copy', { track_id: el.closest ? selId(el) : 'page.text' });
  }), true);

  /* ---------- input_change: field id only, once per field ---------- */
  var IC = {};
  d.addEventListener('input', safe(function (e) {
    var t = e.target;
    if (OFF || G || !e.isTrusted || !t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[data-no-track]')) return;
    var f = slug(t.name || t.id, 32);
    if (!f || IC[f]) return;
    IC[f] = 1;
    ev('input_change', { field: f });
  }), true);

  /* ---------- scroll milestones, article progress, max scroll ---------- */
  var SM = {}, AM = {}, AR = null, scrollQ = 0;
  function onScroll() {
    scrollQ = 0;
    if (OFF || G || ST === 'denied') return;
    var de = d.documentElement, vh = w.innerHeight, dh = de.scrollHeight - vh;
    if (dh > 0) {
      var pct = Math.min(100, Math.round((w.scrollY || de.scrollTop) / dh * 100));
      if (pct > maxScroll) maxScroll = pct;
      [25, 50, 75, 100].forEach(function (m) { if (pct >= m && !SM[m]) { SM[m] = 1; ev('scroll_milestone', { percent: m }); } });
    }
    if (AR) {
      var r = AR.getBoundingClientRect(), seen = Math.max(0, Math.min(100, (vh - r.top) / Math.max(1, r.height) * 100));
      [25, 50, 75].forEach(function (m) { if (seen >= m && !AM[m]) { AM[m] = 1; ev('article_progress', { percent: m }); } });
      if (r.bottom <= vh + 2 && r.top < vh && !AM[100]) { AM[100] = 1; ev('article_progress', { percent: 100 }); ev('article_complete', { read_s: act }); }
    }
  }
  w.addEventListener('scroll', function () { if (!scrollQ) scrollQ = w.requestAnimationFrame(safe(onScroll)); }, { passive: true });

  /* ---------- section time in view ---------- */
  var SV = {}, svIO = null;
  function svEnd(o) {
    if (!o.t0) return;
    var ms = NOW() - o.t0; o.t0 = 0;
    if (ms >= 800 && o.n < 6) { o.n++; ev('section_view', { section_id: o.id, ms: Math.round(ms / 100) * 100 }); }
  }
  function svAll(on) { Object.keys(SV).forEach(function (k) { var o = SV[k]; if (on) { if (o.in && !o.t0) o.t0 = NOW(); } else svEnd(o); }); }
  function scan() {
    if (!w.IntersectionObserver) return;
    if (!svIO) svIO = new IntersectionObserver(safe(function (es) {
      es.forEach(function (en) {
        var o = SV[en.target.__sk]; if (!o) return;
        o.in = en.isIntersecting;
        if (o.in) { if (!G && !d.hidden) o.t0 = NOW(); } else svEnd(o);
      });
    }), { rootMargin: '-30% 0px -30% 0px', threshold: 0 });
    var els = d.querySelectorAll('main section[id],section[data-section],[data-section]');
    Array.prototype.forEach.call(els, function (el, i) {
      if (el.__sk || el.closest('[data-no-track]')) return;
      var id = slug(el.getAttribute('data-section') || el.id, 32) || 's' + i;
      el.__sk = id;
      if (!SV[id]) SV[id] = { id: id, t0: 0, n: 0, in: false };
      svIO.observe(el);
    });
    Array.prototype.forEach.call(d.querySelectorAll('form[data-form]'), watchForm);
  }

  /* ---------- forms: ids only, success only when the page confirms it ---------- */
  var F = {};
  function fstate(id) { return F[id] || (F[id] = { seen: {} }); }
  function api_form(id, st, p) {
    LAPI = NOW();
    if (!/^[a-z0-9_.-]{1,40}$/i.test(id || '')) return;
    var s = fstate(id), f = p && p.field ? slug(p.field, 32) : '';
    switch (st) {
      case 'view': if (s.v) return; s.v = 1; ev('form_view', { form_id: id }); break;
      case 'start': if (s.s) return; s.s = 1; ev('form_start', { form_id: id }); break;
      case 'field': if (!f || s.seen[f]) return; s.seen[f] = 1; s.last = f; ev('form_field', { form_id: id, field: f }); break;
      case 'error': ev('form_error', { form_id: id, field: f }); break;
      case 'attempt': s.a = 1; ev('form_submit_attempt', { form_id: id }); break;
      case 'success': if (s.ok) return; s.ok = 1; ev('form_submit_success', { form_id: id }); break;
      case 'failure': s.fail = 1; ev('form_submit_failure', { form_id: id }); break;
      case 'abandon': if (!s.s || s.ab || s.ok || s.a) return; s.ab = 1; ev('form_abandon', { form_id: id, field: s.last || f }); break;
    }
  }
  function watchForm(f) {
    if (f.__skf) return;
    f.__skf = 1;
    var id = f.getAttribute('data-form');
    if (w.IntersectionObserver) {
      var io = new IntersectionObserver(safe(function (es) { if (es[0].isIntersecting) { api_form(id, 'view'); io.disconnect(); } }), { threshold: 0.4 });
      io.observe(f);
    }
  }
  function formOf(t) { var f = t && t.closest && t.closest('form[data-form]'); return f && !f.closest('[data-no-track]') ? f : null; }
  d.addEventListener('focusin', safe(function (e) {
    var f = formOf(e.target); if (!f || !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var id = f.getAttribute('data-form'); api_form(id, 'start'); api_form(id, 'field', { field: e.target.name || e.target.id });
  }), true);
  d.addEventListener('invalid', safe(function (e) {
    var f = formOf(e.target); if (f) api_form(f.getAttribute('data-form'), 'error', { field: e.target.name || e.target.id });
  }), true);
  d.addEventListener('submit', safe(function (e) { var f = formOf(e.target); if (f) api_form(f.getAttribute('data-form'), 'attempt'); }), true);

  /* ---------- video ---------- */
  var VS = typeof WeakMap === 'function' ? new WeakMap() : null;
  function vget(v) {
    if (!VS || v.tagName !== 'VIDEO' || v.srcObject || v.closest('[data-no-track]') || !(v.controls || v.hasAttribute('data-track'))) return null;
    var s = VS.get(v);
    if (!s) {
      var src = (v.currentSrc || v.getAttribute('src') || '').split('?')[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      s = { id: slug(v.getAttribute('data-track') || v.id || src, 32) || 'video', p: {}, ended: 0, m: v.muted };
      VS.set(v, s);
    }
    return s;
  }
  function vstate(s, st) { ev('video_state', { video_id: s.id, state: st }); }
  ['play', 'pause', 'ended', 'volumechange', 'timeupdate'].forEach(function (n) {
    d.addEventListener(n, safe(function (e) {
      if (OFF || G) return;
      var v = e.target, s = vget(v); if (!s) return;
      if (n === 'play') { vstate(s, s.ended ? 'rewatch' : 'play'); s.ended = 0; s.p = {}; }
      else if (n === 'pause') { if (!v.ended && v.currentTime > 0) vstate(s, 'pause'); }
      else if (n === 'ended') { s.ended = 1; vstate(s, 'ended'); if (!s.p[100]) { s.p[100] = 1; ev('video_progress', { video_id: s.id, percent: 100 }); } }
      else if (n === 'volumechange') { if (v.muted !== s.m) { s.m = v.muted; vstate(s, v.muted ? 'mute' : 'unmute'); } }
      else if (v.duration > 0) {
        var pc = v.currentTime / v.duration * 100;
        [25, 50, 75].forEach(function (m) { if (pc >= m && !s.p[m]) { s.p[m] = 1; ev('video_progress', { video_id: s.id, percent: m }); } });
      }
    }), true);
  });
  d.addEventListener('fullscreenchange', safe(function () {
    var f = d.fullscreenElement; if (!f) return;
    var v = f.tagName === 'VIDEO' ? f : f.querySelector && f.querySelector('video'), s = v && vget(v);
    if (s) vstate(s, 'fullscreen');
  }));

  /* ---------- js errors ---------- */
  var JE = 0;
  w.addEventListener('error', safe(function (e) {
    if (JE >= 5) return;
    var res = e.target && e.target !== w && e.target.tagName;
    if (res) {  /* blocked third-party scripts (ad blockers, GTM) are not our errors */
      try { if (new URL(e.target.src || e.target.href || '', location.href).origin !== location.origin) return; } catch (x) { return; }
    }
    JE++;
    ev('js_error', { kind: res ? 'resource' : 'script' });
  }), true);
  w.addEventListener('unhandledrejection', safe(function () { if (JE < 5) { JE++; ev('js_error', { kind: 'promise' }); } }));

  /* ---------- web vitals ---------- */
  var V = {}, cls = 0, clsS = 0, clsLast = 0, clsFirst = 0, vitalsSent = false;
  function po(type, fn, extra) {
    try {
      var o = new PerformanceObserver(safe(function (l) { l.getEntries().forEach(fn); }));
      var cfg = { type: type, buffered: true }; for (var k in extra) cfg[k] = extra[k];
      o.observe(cfg);
    } catch (e) {}
  }
  if (w.PerformanceObserver) {
    po('largest-contentful-paint', function (e) { V.LCP = e.startTime; });
    po('paint', function (e) { if (e.name === 'first-contentful-paint') V.FCP = e.startTime; });
    po('layout-shift', function (e) {
      if (e.hadRecentInput) return;
      if (clsS && e.startTime - clsLast < 1000 && e.startTime - clsFirst < 5000) clsS += e.value;
      else { clsS = e.value; clsFirst = e.startTime; }
      clsLast = e.startTime;
      if (clsS > cls) cls = clsS;
      V.CLS = cls;
    });
    po('event', function (e) { if (e.interactionId && (!V.INP || e.duration > V.INP)) V.INP = e.duration; }, { durationThreshold: 40 });
  }
  function sendVitals() {
    if (vitalsSent) return;
    vitalsSent = true;
    try { var n = w.performance.getEntriesByType('navigation')[0]; if (n && n.responseStart) V.TTFB = n.responseStart; } catch (e) {}
    var T = { LCP: [2500, 4000], FCP: [1800, 3000], CLS: [0.1, 0.25], INP: [200, 500], TTFB: [800, 1800] };
    Object.keys(V).forEach(function (m) {
      var v = V[m], r = v <= T[m][0] ? 'good' : v <= T[m][1] ? 'needs-improvement' : 'poor';
      ev('web_vital', { metric: m, value: m === 'CLS' ? v : Math.round(v), rating: r });
    });
  }

  /* ---------- leave, hide, show ---------- */
  function onHide() {
    if (LEFT) { if (Q.length) flush(true); return; }  /* a page handler that runs after visibilitychange still gets its events out */
    LEFT = true;
    svAll(false); endHover(); flushCursor(); sendVitals();
    Object.keys(F).forEach(function (id) { api_form(id, 'abandon'); });
    var dv = vis - lv, da = act - la;
    if (dv > 0 || !lv) ev('page_leave', { visible_s: dv, active_s: da, max_scroll: maxScroll });
    lv = vis; la = act;
    flush(true);
  }
  d.addEventListener('visibilitychange', safe(function () {
    if (d.hidden) onHide();
    else { LEFT = false; if (!G) svAll(true); }
  }));
  w.addEventListener('pagehide', safe(onHide));
  w.addEventListener('pageshow', safe(function (e) { if (e.persisted) LEFT = false; }));

  /* ---------- public API ---------- */
  var bad = /^[a-z0-9_.-]{1,40}$/i;
  var MSTATE = /^(prompt|granted|denied|dismissed|unavailable|failed|stopped)$/;
  var sk = {
    v: 1,
    track: function (n, p) { LAPI = NOW(); ev(ALIAS[n] || n, p); },
    demo: function (id, action, p) {
      LAPI = NOW();
      if (!bad.test(id || '') || !action) return;
      p = p || {};
      ev('demo_action', { demo_id: id, action: String(action).slice(0, 40), value: p.value, ms: p.ms, bucket: p.bucket, item: p.item });
    },
    media: function (id, kind, state, p) {
      LAPI = NOW();
      if (!bad.test(id || '') || (kind !== 'camera' && kind !== 'mic') || !MSTATE.test(state || '')) return;
      ev('media_result', { demo_id: id, kind: kind, state: state });
    },
    model: function (id, state, p) {
      LAPI = NOW();
      if (!bad.test(id || '') || (state !== 'loaded' && state !== 'failed')) return;
      p = p || {};
      ev('model_state', { demo_id: id, state: state, ms: p.ms, delegate: p.delegate });
    },
    form: api_form,
    len: function (t) { return bucketLen(typeof t === 'number' ? t : t == null ? 0 : String(t).length); },
    count: function (n) { return bucketCount(+n || 0); },
    haunt: function (on) {
      on = !!on;
      if (on === G) return;
      if (on) { svAll(false); endHover(); flushCursor(); G = true; ctag('haunt', '1'); }
      else { G = false; svAll(true); }
    },
    scan: scan,
    flush: function () { flush(false); }
  };
  Object.defineProperty(sk, 'consent', { get: function () { return ST; }, enumerable: true });
  w.sk = sk;
  w.skTrack = function (n, p) { sk.track(n, p); };

  /* ---------- start ---------- */
  function title() { var s = 5381, t = d.title || '', i; for (i = 0; i < t.length; i++) s = ((s << 5) + s + t.charCodeAt(i)) | 0; return (s >>> 0).toString(36); }
  function start() {
    if (OFF) return;
    if (ST === 'granted') persist();
    ev('page_view', { title_id: title() });
    if (PT === 'post') AR = d.querySelector('.post-body') || d.querySelector('article');
    scan();
    setTimeout(scan, 1500);
    clarityTags();
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', safe(start)); else safe(start)();

  /* drain what pages queued before this file loaded, then take over the queue */
  function run(a) {
    try {
      if (!a) return;
      var f = a[0], rest = Array.prototype.slice.call(a, 1);
      if (typeof f === 'string') { if (typeof sk[f] === 'function') sk[f].apply(sk, rest); }
      else if (typeof f === 'function') f.apply(sk, rest);
    } catch (e) {}
  }
  var q = w.skq;
  w.skq = { push: run };
  if (q && q.length) q.forEach(run);
})(window, document);
