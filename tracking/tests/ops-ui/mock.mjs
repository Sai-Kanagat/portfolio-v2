// Mock /api/ops for the dashboard tests. Response shapes follow the header comment of each endpoint in functions/api/ops/*.js.
// Mock data lives only here. The dashboard never ships with any.
export const HOSTILE = {
  img: '<img src=x onerror="window.__pwn=1">',
  script: '"><script>window.__pwn=2</script>',
  formula: '=HYPERLINK("http://evil.example/","click me")',
  at: '@SUM(1+1)*cmd|\' /C calc\'!A0',
  long: 'A'.repeat(5000),
  js: 'javascript:window.__pwn=3',
  svg: '<svg onload="window.__pwn=4"></svg>',
};
export const SIDS = ['0123456789abcdef', 'fedcba9876543210', 'aaaaaaaaaaaaaaaa'];
export const HOT_SLUG = 'li-thallo-01';

const NOW = () => Date.now();

function hs(hostile, i, fallback) {
  if (!hostile) return fallback;
  const keys = Object.keys(HOSTILE);
  return HOSTILE[keys[i % keys.length]];
}

export function makeStore(hostile) {
  return {
    links: [
      { slug: HOT_SLUG, dest: 'https://saikanagat.com/thallo/', channel: 'li', campaign: 'launch', content_label: 'thallo-post-one', app_label: null, created: NOW() - 5 * 864e5, retired: 0, clicks_human: 42, clicks_bot: 9, sessions: 31, pages: 77, active_s: 1240, demos: 6, conversions: 2 },
      { slug: 'cv-acme-growth', dest: '/work', channel: 'cv', campaign: null, content_label: null, app_label: 'acme-growth', created: NOW() - 20 * 864e5, retired: 1, clicks_human: 3, clicks_bot: 0, sessions: 2, pages: 3, active_s: 50, demos: 0, conversions: 0 },
      { slug: 'qr-poster-one', dest: 'https://saikanagat.com/demos.html', channel: 'qr', campaign: null, content_label: 'poster', app_label: null, created: NOW() - 2 * 864e5, retired: 0, clicks_human: 0, clicks_bot: 0, sessions: 0, pages: 0, active_s: 0, demos: 0, conversions: 0 },
      ...(hostile ? [
        { slug: 'li-hostile-row', dest: HOSTILE.js, channel: 'li', campaign: HOSTILE.img, content_label: HOSTILE.formula, app_label: HOSTILE.long, created: NOW(), retired: 0, clicks_human: 1, clicks_bot: 1, sessions: 1, pages: 1, active_s: 1, demos: 0, conversions: 0 },
        { slug: HOSTILE.img, dest: HOSTILE.script, channel: HOSTILE.at, campaign: null, content_label: null, app_label: null, created: NOW() - 864e5, retired: 0, clicks_human: 0, clicks_bot: 0, sessions: 0, pages: 0, active_s: 0, demos: 0, conversions: 0 },
      ] : []),
    ],
    posts: [],
    retired: [],
  };
}

function range(days = 7) { return { from: NOW() - days * 864e5, to: NOW() + 1 }; }
function wrap(body, sp) {
  const inc = (sp.get('include') || '').split(',');
  const days = Number(sp.get('days')) || 7;
  const r = sp.get('from') ? { from: Number(sp.get('from')), to: Number(sp.get('to')) || NOW() } : range(days);
  const dv = sp.get('device');
  return { range: r, scope: { owner: inc.includes('owner'), test: inc.includes('test'), device: ['desktop', 'mobile', 'tablet'].includes(dv) ? dv : null }, ...body };
}

function visitsFor(hostile, before) {
  const rows = [];
  const base = NOW() - 3600e3;
  const count = before ? 3 : 50;
  for (let i = 0; i < count; i++) {
    const idx = before ? 50 + i : i;
    rows.push({
      sid: idx < 3 ? SIDS[idx] : (idx.toString(16).padStart(16, '0')), first_ts: base - idx * 600e3, last_ts: base - idx * 600e3 + 120e3,
      landing: hs(hostile, idx, idx % 2 ? '/work' : '/'), link: idx % 5 === 0 ? HOT_SLUG : null, ref_host: hs(hostile, idx + 2, idx % 3 ? 'www.google.com' : null),
      country: idx % 4 ? 'IT' : 'US', device: idx % 2 ? 'mobile' : 'desktop', pages: 1 + (idx % 4), events: 5 + idx, active_s: 10 + idx,
    });
  }
  return rows;
}

// Returns {status, body, headers?}. mode picks the scenario for the data endpoints.
export function respond(name, sp, mode, store, hostile, method = 'GET', postBody = null) {
  const H = (i, f) => hs(hostile, i, f);
  const empty = mode === 'empty';
  if (method === 'POST') return respondPost(name, postBody, store);
  switch (name) {
    case 'live':
      if (empty) return ok(wrap({ now: NOW(), active_sessions: 0, events_1m: 0, events_30m: 0, top_pages: [], recent: [] }, sp));
      return ok(wrap({
        now: NOW(), active_sessions: 3, events_1m: 5, events_30m: 40,
        top_pages: [{ path: '/', n: 20 }, { path: H(1, '/work'), n: 9 }, { path: '/demos.html', n: 3 }],
        recent: Array.from({ length: 50 }, (_, i) => ({ ts: NOW() - i * 20e3, name: i % 3 ? 'ui_click' : H(i, 'page_view'), path: H(i + 1, '/work'), device: i % 2 ? 'mobile' : 'desktop', country: 'IT', link: i % 7 ? null : HOT_SLUG, params: i % 4 ? JSON.stringify({ track_id: H(i + 3, 'nav.demos'), zone: 'nav', x: 3, y: 4, nth: 1 }) : H(i, null) })),
      }, sp));
    case 'acquisition':
      if (empty) return ok(wrap({ sessions: 0, visitors: 0, channels: [], referrers: [], ai_referrers: [], search_referrers: [], utm: [], ai_utm: [], search_utm: [], countries: [] }, sp));
      return ok(wrap({
        sessions: 120, visitors: 90,
        channels: [
          { channel: 'link:li', sessions: 40, visitors: 30, active_s: 800 }, { channel: 'direct', sessions: 30, visitors: 25, active_s: 300 },
          { channel: 'search', sessions: 15, visitors: 14, active_s: 150 }, { channel: 'ai', sessions: 6, visitors: 6, active_s: 40 },
          { channel: 'utm:' + H(2, 'newsletter'), sessions: 4, visitors: 4, active_s: 90 }, { channel: 'link:' + H(3, 'cv'), sessions: 1, visitors: 1, active_s: 10 },
        ],
        referrers: [{ ref_host: 'www.google.com', sessions: 12 }, { ref_host: 'chatgpt.com', sessions: 5 }, { ref_host: 'www.bing.com', sessions: 3 }, { ref_host: 'perplexity.ai', sessions: 1 }, { ref_host: H(4, 'news.example'), sessions: 2 }],
        utm: [{ utm_source: 'chatgpt.com', utm_medium: 'referral', utm_campaign: null, sessions: 4 }, { utm_source: H(1, 'li'), utm_medium: H(2, 'social'), utm_campaign: H(3, 'launch'), sessions: 3 }],
        ai_referrers: [{ ref_host: 'chatgpt.com', sessions: 5 }, { ref_host: 'perplexity.ai', sessions: 1 }, ...Array.from({ length: 30 }, (_, i) => ({ ref_host: `c${i}.chatgpt.com`, sessions: 1 }))],
        search_referrers: [{ ref_host: 'www.google.com', sessions: 12 }, { ref_host: 'www.bing.com', sessions: 3 }],
        ai_utm: [{ utm_source: 'chatgpt.com', utm_medium: 'referral', utm_campaign: null, sessions: 4 }, { utm_source: 'gemini', utm_medium: null, utm_campaign: null, sessions: 1 }],
        search_utm: [{ utm_source: H(1, 'google'), utm_medium: 'organic', utm_campaign: null, sessions: 2 }],
        countries: [{ country: 'IT', sessions: 70 }, { country: 'US', sessions: 20 }, { country: null, sessions: 3 }],
      }, sp));
    case 'links':
      return ok(wrap({ links: empty ? [] : store.links.map((l) => ({ ...l })) }, sp));
    case 'pages':
      if (empty) return ok(wrap({ pages: [] }, sp));
      return ok(wrap({ pages: [
        { path: '/', views: 200, visitors: 150, leaves: 120, avg_visible_s: 45.3, avg_active_s: 21.1, avg_max_scroll: 62.4 },
        { path: '/work', views: 40, visitors: 30, leaves: 5, avg_visible_s: 80.5, avg_active_s: 40.2, avg_max_scroll: 90 },
        { path: '/demos.html', views: 12, visitors: 10, leaves: 0, avg_visible_s: null, avg_active_s: null, avg_max_scroll: null },
        { path: H(5, '/blog'), views: 3, visitors: 3, leaves: 19, avg_visible_s: 10, avg_active_s: 5, avg_max_scroll: 33 },
        { path: '/about.html', views: 2, visitors: 2, leaves: 20, avg_visible_s: 61, avg_active_s: 12, avg_max_scroll: 50 },
      ] }, sp));
    case 'buttons': {
      if (empty) return ok(wrap({ buttons: [], paths: [], truncated: false }, sp));
      const p = sp.get('path');
      const all = [
        { track_id: 'nav.demos', zone: 'nav', path: '/', clicks: 30, visitors: 20, sessions: 22, per_session: 1.36, last_ts: NOW() - 3600e3 },
        { track_id: H(1, 'hero.cta'), zone: H(2, 'hero'), path: '/', clicks: 12, visitors: 10, sessions: 10, per_session: 1.2, last_ts: NOW() - 7200e3 },
        { track_id: 'work.project_1', zone: 'work', path: '/work', clicks: 4, visitors: 3, sessions: 3, per_session: 1.33, last_ts: NOW() - 864e5 },
        { track_id: H(3, 'footer.email'), zone: 'footer', path: '/work', clicks: 1, visitors: 1, sessions: 1, per_session: 1, last_ts: NOW() - 2 * 864e5 },
      ];
      const den = { '/': 150, '/work': 40, '/about': 12 };
      const paths = Object.entries(den).filter(([k]) => !p || k === p).map(([path, sessions]) => ({ path, sessions }));
      const rows = (p ? all.filter((b) => b.path === p) : all).map((b) => ({ ...b, page_sessions: den[b.path], click_rate: Math.round((b.sessions / den[b.path]) * 10000) / 10000 }));
      return ok(wrap({ buttons: rows, paths, truncated: false }, sp));
    }
    case 'heatmap': {
      const path = sp.get('path');
      if (!path || !/^\/[A-Za-z0-9_.~%+\-\/]{0,199}$/.test(path)) return { status: 400, body: { error: 'path' } };
      if (empty) return ok(wrap({ path, device: sp.get('device') || 'desktop', kind: sp.get('kind') || 'click', cells: [], total: 0 }, sp));
      const cells = [];
      for (let x = 5; x < 20; x++) for (let y = 2; y < 9; y++) cells.push({ x, y, n: 1 + ((x * 7 + y * 3) % 25) });
      cells.push({ x: 40, y: 20, n: 60 });
      return ok(wrap({ path, device: sp.get('device') || 'desktop', kind: sp.get('kind') || 'click', cells, total: cells.reduce((a, c) => a + c.n, 0) }, sp));
    }
    case 'visits': {
      const sid = sp.get('sid');
      if (sid !== null) {
        if (!/^[0-9a-f]{16}$/.test(sid)) return { status: 400, body: { error: 'sid' } };
        if (empty || sid === 'bbbbbbbbbbbbbbbb') return ok(wrap({ session: {}, events: [] }, sp));
        const t = NOW() - 600e3;
        return ok(wrap({
          session: { sid, vid: 'v'.repeat(16), first_ts: t, last_ts: t + 90e3, landing: H(1, '/'), ref_host: H(2, 'www.google.com'), utm_source: H(3, null), utm_medium: null, utm_campaign: null, link: HOT_SLUG, country: 'IT', device: 'desktop', owner: 0, test: '', pages: 3, events: 12, active_ms: 45000 },
          events: Array.from({ length: 12 }, (_, i) => ({ ts: t + i * 7000, name: i === 0 ? 'page_view' : H(i, 'ui_click'), path: H(i + 1, '/work'), params: i % 2 ? JSON.stringify({ track_id: H(i + 2, 'nav.demos'), nth: i }) : null })),
        }, sp));
      }
      if (empty) return ok(wrap({ sessions: [] }, sp));
      const before = sp.get('before');
      return ok(wrap({ sessions: visitsFor(hostile, before) }, sp));
    }
    case 'demos':
      if (empty) return ok(wrap({ demos: [] }, sp));
      return ok(wrap({ page_actions: [{ page: 'home', action: 'hero_settled', n: 31, sessions: 27, visitors: 25 }, { page: 'home', action: 'shutter_progress', n: 12, sessions: 9, visitors: 9 }], demos: [
        { demo_id: 'pg.home', opens: 0, starts: 0, engaged_10: 0, engaged_60: 0, ends: 0, errors: 0, visitors: 0, avg_ms: null, sessions: { opened: 0, started: 0, engaged_10: 0, engaged_60: 0, ended: 0, errored: 0 }, funnel: { opened: 0, started: 0, engaged_10: 0, engaged_60: 0 }, skipped: { started: 0, engaged_10: 0, engaged_60: 0 }, camera: {}, camera_sessions: {}, mic: {}, mic_sessions: {}, model: { loaded: 0, failed: 0, loaded_sessions: 0, failed_sessions: 0, avg_ms: null, ms_n: 0, delegates: [] }, top_actions: [{ action: 'hero_settled', n: 31, sessions: 27 }] },
        { demo_id: 'hands', opens: 44, starts: 33, engaged_10: 18, engaged_60: 6, ends: 12, errors: 1, visitors: 25, avg_ms: 64000,
          sessions: { opened: 40, started: 31, engaged_10: 18, engaged_60: 6, ended: 12, errored: 1 }, funnel: { opened: 40, started: 30, engaged_10: 18, engaged_60: 6 }, skipped: { started: 1, engaged_10: 0, engaged_60: 0 },
          camera: { prompt: 33, granted: 24, denied: 5, dismissed: 2, unavailable: 1 }, camera_sessions: { prompt: 30, granted: 22, denied: 5, dismissed: 2, unavailable: 1 }, mic: {}, mic_sessions: {},
          model: { loaded: 20, failed: 3, loaded_sessions: 18, failed_sessions: 3, avg_ms: 2400, ms_n: 20, delegates: [{ delegate: 'gpu', loaded: 15, failed: 0 }, { delegate: H(4, 'cpu'), loaded: 5, failed: 3 }] },
          top_actions: [{ action: 'pinch', n: 90, sessions: 20 }, { action: H(1, 'retry'), n: 4, sessions: 3 }] },
        { demo_id: 'agora', opens: 8, starts: 3, engaged_10: 1, engaged_60: 0, ends: 0, errors: 0, visitors: 6, avg_ms: null,
          sessions: { opened: 7, started: 3, engaged_10: 1, engaged_60: 0, ended: 0, errored: 0 }, funnel: { opened: 7, started: 3, engaged_10: 1, engaged_60: 0 }, skipped: { started: 0, engaged_10: 0, engaged_60: 0 },
          camera: {}, camera_sessions: {}, mic: {}, mic_sessions: {}, model: { loaded: 0, failed: 0, loaded_sessions: 0, failed_sessions: 0, avg_ms: null, ms_n: 0, delegates: [] }, top_actions: [] },
        { demo_id: H(2, 'audio'), opens: 6, starts: 5, engaged_10: 5, engaged_60: 2, ends: 5, errors: 0, visitors: 4, avg_ms: 12000,
          sessions: { opened: 5, started: 5, engaged_10: 5, engaged_60: 2, ended: 5, errored: 0 }, funnel: { opened: 5, started: 4, engaged_10: 4, engaged_60: 2 }, skipped: { started: 1, engaged_10: 1, engaged_60: 0 },
          camera: {}, camera_sessions: {}, mic: { prompt: 4, granted: 3, denied: 1, [H(3, 'odd')]: 1 }, mic_sessions: { prompt: 4, granted: 3, denied: 1, [H(3, 'odd')]: 1 },
          model: { loaded: 4, failed: 0, loaded_sessions: 4, failed_sessions: 0, avg_ms: 800, ms_n: 4, delegates: [{ delegate: 'cpu', loaded: 4, failed: 0 }] }, top_actions: [{ action: 'use_mic', n: 3, sessions: 3 }] },
      ] }, sp));
    case 'forms': {
      const nlZero = { view: 0, fab_shown: 0, fab_click: 0, start: 0, invalid: 0, request: 0, failed: 0, confirmed: 0 };
      if (empty) return ok(wrap({ forms: [], newsletter: { ...nlZero, sessions: { ...nlZero }, funnel: { view: 0, start: 0, request: 0, confirmed: 0 }, skipped: { start: 0, request: 0, confirmed: 0 }, by_page: [] } }, sp));
      return ok(wrap({ forms: [
        { form_id: 'contact', view: 90, start: 28, field: 60, error: 3, attempt: 12, success: 8, failure: 1, abandon: 13,
          sessions: { view: 80, start: 24, field: 20, error: 3, attempt: 10, success: 8, failure: 1, abandon: 12 }, funnel: { view: 80, start: 24, attempt: 10, success: 8 }, skipped: { start: 0, attempt: 1, success: 0 }, abandoned_after_start: 12,
          abandon_fields: [{ field: 'message', n: 7 }, { field: H(1, 'email'), n: 5 }] },
        { form_id: H(2, 'sample'), view: 5, start: 2, field: 2, error: 0, attempt: 1, success: 1, failure: 0, abandon: 1,
          sessions: { view: 5, start: 2, field: 2, error: 0, attempt: 1, success: 1, failure: 0, abandon: 1 }, funnel: { view: 5, start: 2, attempt: 1, success: 1 }, skipped: { start: 0, attempt: 0, success: 0 }, abandoned_after_start: 1, abandon_fields: [] },
      ], newsletter: { view: 30, fab_shown: 40, fab_click: 6, start: 12, invalid: 3, request: 8, failed: 1, confirmed: 0,
        sessions: { view: 26, fab_shown: 35, fab_click: 6, start: 11, invalid: 3, request: 8, failed: 1, confirmed: 0 }, funnel: { view: 26, start: 11, request: 7, confirmed: 0 }, skipped: { start: 0, request: 1, confirmed: 0 },
        by_page: [{ page_path: '/blog', view: 20, fab_shown: 25, fab_click: 4, start: 8, invalid: 2, request: 6, failed: 0, confirmed: 0 }, { page_path: H(5, '/about'), view: 10, fab_shown: 15, fab_click: 2, start: 4, invalid: 1, request: 2, failed: 1, confirmed: 0 }] } }, sp));
    }
    case 'ghost':
      if (empty) return ok(wrap({ starts: 0, ends: 0, stop_clicks: 0, modes: [], end_reasons: [], interrupts: [] }, sp));
      return ok(wrap({ starts: 25, ends: 20, stop_clicks: 4, modes: [{ mode: 'tour', n: 15 }, { mode: H(1, 'replay'), n: 10 }], end_reasons: [{ reason: 'done', n: 15 }, { reason: H(2, 'user'), n: 5 }], interrupts: [{ input: 'mouse', n: 8, avg_ms: 6200 }, { input: H(3, 'key'), n: 2, avg_ms: null }] }, sp));
    case 'health':
      if (empty) return ok(wrap({ last_event_ts: null, events_24h: 0, sessions_24h: 0, ingest: [], checks: [], consent: { shown: 0, granted: 0, denied: 0 } }, sp));
      return ok(wrap({
        last_event_ts: NOW() - 120e3, events_24h: 840, sessions_24h: 61,
        ingest: [{ day: '2026-11-24', kind: 'rate_limited', detail: '', n: 4 }, { day: '2026-11-24', kind: H(1, 'bad_origin'), detail: H(2, 'x'), n: 1 }],
        checks: [{ ts: NOW() - 3600e3, check_name: 'rollup', status: 'ok', detail: '12 rows' }, { ts: NOW() - 7200e3, check_name: H(1, 'purge'), status: 'warn', detail: H(5, 'slow') }, { ts: NOW() - 9000e3, check_name: 'storage', status: 'fail', detail: 'over 70 percent' }],
        consent: { shown: 30, granted: 21, denied: 2 },
      }, sp));
    default:
      return { status: 404, body: { error: 'not_found' } };
  }
}

const ok = (body) => ({ status: 200, body });

function respondPost(name, b, store) {
  b = b || {};
  if (name === 'links') {
    const slug = String(b.slug || '').toLowerCase();
    if (!/^(li|cv|qr|em|gh|ig|pdf)-[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { status: 400, body: { error: 'slug', hint: 'prefix li cv qr em gh ig pdf, then lowercase words' } };
    if (slug === 'li-race-01' || store.links.some((l) => l.slug === slug)) return { status: 409, body: { error: 'duplicate' } };
    if (slug === 'li-boom-01') return { status: 500, body: { error: 'db' } };
    const row = { slug, dest: b.dest, channel: slug.split('-')[0], campaign: b.campaign || null, content_label: b.content_label || null, app_label: b.app_label || null, created: NOW(), retired: 0, clicks_human: 0, clicks_bot: 0, sessions: 0, pages: 0, active_s: 0, demos: 0, conversions: 0 };
    store.links.unshift(row);
    store.posts.push(b);
    const warnings = /maria|rossi/.test(slug + (b.app_label || '')) ? ['"maria-rossi" looks like a person\'s name; use a company or post label instead'] : [];
    return { status: 201, body: { link: row, warnings } };
  }
  if (name === 'links/retire') {
    const l = store.links.find((x) => x.slug === b.slug);
    if (!l) return { status: 404, body: { error: 'not_found' } };
    l.retired = 1;
    store.retired.push(b.slug);
    return { status: 200, body: { slug: b.slug, retired: 1 } };
  }
  return { status: 404, body: { error: 'not_found' } };
}

// The build-time list of every known control (ops/controls.json). Four of these are clicked in the mock API data, the rest have zero clicks.
export function controlsFixture(hostile) {
  const c = (id, path, devices = ['desktop', 'mobile']) => ({ id, zone: id.split('.')[0], path, devices });
  return {
    version: 1,
    controls: [
      c('nav.demos', '/'), c('hero.cta', '/'), c('hero.secondary', '/'), c('nav.menu', '/', ['mobile']), c('hover.preview', '/', ['desktop']),
      c('work.project_1', '/work'), c('work.project_2', '/work'), c('footer.email', '/work'), c('about.cv', '/about'),
      ...(hostile ? [{ id: 'bad id <img src=x onerror=window.__pwn=9>', zone: 'x', path: '/work', devices: [] }, { id: 'ok.id', zone: 'ok', path: '/evil path', devices: [] }] : []),
    ],
  };
}
