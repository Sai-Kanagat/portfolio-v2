// Pure helpers for the /ops dashboard. No DOM, no network, so they can be unit tested in node.
// Everything that comes from the API is untrusted text: callers put it in with textContent only.

export const PUBLIC_ORIGIN = 'https://saikanagat.com';
export const MIN_N = 20;

// Same patterns the server enforces (functions/_lib/links.js, functions/_lib/ops.js, functions/api/ops/visits.js).
export const SLUG_RE = /^(li|cv|qr|em|gh|ig|pdf)-[a-z0-9]+(-[a-z0-9]+)*$/;
export const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SID_RE = /^[0-9a-f]{16}$/;
export const PATH_RE = /^\/[A-Za-z0-9_.~%+\-\/]{0,199}$/;

export const CHANNEL_NAMES = {
  li: 'LinkedIn post', cv: 'CV', qr: 'QR code', em: 'Email', gh: 'GitHub', ig: 'Instagram', pdf: 'PDF',
};

export const isSlug = (s) => typeof s === 'string' && s.length <= 64 && SLUG_RE.test(s);
export const isSid = (s) => typeof s === 'string' && SID_RE.test(s);
export const isPath = (s) => typeof s === 'string' && PATH_RE.test(s);
export const linkUrl = (slug) => PUBLIC_ORIGIN + '/go/' + slug;
export const DEVICES = ['desktop', 'mobile', 'tablet'];
export const DEVICE_LABELS = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
export const CONTROL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/;

// Page paths are compared without a trailing slash, a trailing index.html or .html, so /work, /work/ and /work.html are one page.
export function normPath(p) {
  let s = String(p === null || p === undefined ? '' : p).split(/[?#]/)[0];
  s = s.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

// ops/controls.json comes from a build script, so it is checked like any other input. Anything that does not fit is dropped.
// Returns null when the file is unusable as a whole.
export function parseControls(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.controls)) return null;
  const controls = [];
  for (const c of raw.controls) {
    if (!c || typeof c.id !== 'string' || !CONTROL_ID_RE.test(c.id) || !isPath(c.path)) continue;
    const devices = Array.isArray(c.devices) ? c.devices.filter((d) => d === 'desktop' || d === 'mobile') : [];
    controls.push({ id: c.id, zone: typeof c.zone === 'string' ? c.zone.slice(0, 40) : c.id.split('.')[0], path: c.path, devices });
  }
  const pages = new Set(controls.map((c) => normPath(c.path)));
  return { controls, pages: pages.size, dropped: raw.controls.length - controls.length };
}

// Joins the clicked controls from the API with the list of every known control. A known control with no row is a control with 0 clicks.
// known: parseControls() result or null. rows: API buttons. paths: API paths (visits that viewed each page). The device filter only applies
// to the list (the crawler saw desktop and mobile; tablet shows both). When the API cut its list (truncated) a missing row is not proof of zero clicks,
// so no zero rows are made.
export function mergeControls(known, rows, { page = '', device = '', paths = [], truncated = false } = {}) {
  const den = new Map();
  for (const p of paths || []) den.set(normPath(p.path), (den.get(normPath(p.path)) || 0) + (num(p.sessions) ?? 0));
  const keyOf = (path, id) => normPath(path) + '|' + id;
  const listed = new Set(known ? known.controls.map((c) => keyOf(c.path, c.id)) : []);
  const out = [];
  const have = new Set();
  let unlisted = 0;
  for (const r of rows || []) {
    const k = keyOf(r.path, r.track_id);
    have.add(k);
    const isListed = !known || listed.has(k);
    if (!isListed) unlisted++;
    out.push({ ...r, page_sessions: num(r.page_sessions) ?? den.get(normPath(r.path)) ?? 0, listed: isListed, zero: false });
  }
  let zero = 0;
  if (known && !truncated) {
    const want = page ? normPath(page) : '';
    for (const c of known.controls) {
      if (want && normPath(c.path) !== want) continue;
      if ((device === 'desktop' || device === 'mobile') && c.devices.length && !c.devices.includes(device)) continue;
      const k = keyOf(c.path, c.id);
      if (have.has(k)) continue;
      have.add(k);
      zero++;
      out.push({ track_id: c.id, zone: c.zone, path: c.path, clicks: 0, visitors: 0, sessions: 0, per_session: null, last_ts: null, page_sessions: den.get(normPath(c.path)) ?? 0, click_rate: null, listed: true, zero: true });
    }
  }
  return { rows: out, zero, unlisted, known: known ? known.controls.length : 0 };
}

// Destination rules mirror safeDest in functions/_lib/links.js: own domain or a root-relative path.
export function destOk(dest) {
  if (typeof dest !== 'string' || !dest || dest.length > 500 || /[\u0000-\u001f\u007f\\]/.test(dest)) return false;
  if (dest.startsWith('/')) return !dest.startsWith('//');
  let u;
  try { u = new URL(dest); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return h === 'saikanagat.com' || h.endsWith('.saikanagat.com');
}

export const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};

// ---------- sample size ----------
// One helper for every rate. den is the sample size. Below MIN_N the rate is marked, never hidden silently.
export function rate(numer, den) {
  const n = num(numer) ?? 0;
  const d = num(den) ?? 0;
  if (d <= 0) return { pct: null, text: 'n/a', of: `${n} of 0`, den: 0, low: true, none: true };
  const pct = (n / d) * 100;
  return { pct, text: fmtPct(pct), of: `${fmtInt(n)} of ${fmtInt(d)}`, den: d, low: d < MIN_N, none: false };
}

// Averages carry their own sample size. avg null or n 0 means nothing to average.
export function avg(value, n) {
  const v = num(value);
  const c = num(n) ?? 0;
  if (v === null || c <= 0) return { value: null, n: c, low: true, none: true };
  return { value: v, n: c, low: c < MIN_N, none: false };
}

// ---------- formatting ----------
const intFmt = new Intl.NumberFormat('en-GB');
export const fmtInt = (v) => { const n = num(v); return n === null ? '' : intFmt.format(Math.round(n)); };
export const fmtDec = (v, d = 1) => { const n = num(v); return n === null ? '' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n); };
export function fmtPct(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'n/a';
  return (p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
}
export function fmtSecs(s) {
  const n = num(s);
  if (n === null) return '';
  if (n < 60) return fmtDec(n, 1) + ' s';
  const m = Math.floor(n / 60);
  const r = Math.round(n - m * 60);
  return `${m} min ${r} s`;
}
export const fmtMs = (ms) => { const n = num(ms); return n === null ? '' : fmtSecs(n / 1000); };

export function fmtTs(ts, opts = {}) {
  const n = num(ts);
  if (n === null || n <= 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: opts.year ? 'numeric' : undefined, hour: '2-digit', minute: '2-digit', second: opts.seconds ? '2-digit' : undefined, hour12: false });
}
export function fmtDay(ts) {
  const n = num(ts);
  if (n === null) return '';
  return new Date(n).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtAge(ts, now = Date.now()) {
  const n = num(ts);
  if (n === null) return '';
  const s = Math.max(0, Math.round((now - n) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// Long or hostile strings are clipped for display. The full value stays in the CSV and the title attribute.
export function clip(v, max = 160) {
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ---------- CSV ----------
// Cells that start with = + - @ tab or CR get a leading quote so spreadsheets never run them as formulas.
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

// ---------- referrers ----------
// Mirrors channelOf in functions/_lib/ops.js so the Search view agrees with Where from.
const AI_RE = /(chatgpt|openai|perplexity|claude|gemini|copilot|you\.com|phind)/;
const SEARCH_RE = /(google|bing|duckduckgo|ecosia|yahoo|brave|yandex|baidu|startpage)\./;
export function classifyHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return 'none';
  if (AI_RE.test(h)) return 'ai';
  if (SEARCH_RE.test(h + '.')) return 'search';
  return 'other';
}

export function channelLabel(ch) {
  const c = String(ch || '');
  if (c.startsWith('link:')) {
    const p = c.slice(5);
    return 'Tracked link: ' + (CHANNEL_NAMES[p] || p);
  }
  if (c.startsWith('utm:')) return 'UTM source: ' + c.slice(4);
  return { direct: 'Direct or unknown', ai: 'AI assistants (referrer)', search: 'Search engines (referrer)', social: 'Social (referrer)', referral: 'Other websites (referrer)' }[c] || c;
}

// Params arrive as a JSON string. Returns [[key, value]] with scalar values only, or null if not an object.
export function paramPairs(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  let o = raw;
  if (typeof raw === 'string') {
    try { o = JSON.parse(raw); } catch { return null; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  return Object.entries(o).slice(0, 30).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]);
}

// ---------- period and scope ----------
export const PERIODS = [
  { id: '1', label: 'Last 24 hours' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '365', label: 'Last 365 days' },
  { id: 'custom', label: 'Custom dates' },
];

// state: {days, from, to, owner, test}. Returns the query the API really supports: days | from,to and include.
export function apiQuery(state, extra = {}) {
  const q = new URLSearchParams();
  if (state.days === 'custom') {
    const f = dateStartMs(state.from);
    const t = dateEndMs(state.to);
    if (f !== null) q.set('from', String(f));
    if (t !== null) q.set('to', String(t));
    if (f === null && t === null) q.set('days', '30');
  } else {
    q.set('days', ['1', '7', '30', '90', '365'].includes(state.days) ? state.days : '30');
  }
  const inc = [];
  if (state.owner) inc.push('owner');
  if (state.test) inc.push('test');
  if (inc.length) q.set('include', inc.join(','));
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  return q;
}
export function dateStartMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
export function dateEndMs(s) {
  const f = dateStartMs(s);
  return f === null ? null : f + 864e5;
}

// ---------- hash routing ----------
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return ''; } });
  return { view: segs[0] || 'live', arg: segs[1] || '', query: new URLSearchParams(queryPart) };
}
export function stateFromQuery(query) {
  const days = query.get('days');
  return {
    days: ['1', '7', '30', '90', '365', 'custom'].includes(days) ? days : '7',
    from: /^\d{4}-\d{2}-\d{2}$/.test(query.get('from') || '') ? query.get('from') : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(query.get('to') || '') ? query.get('to') : '',
    owner: query.get('owner') === '1',
    test: query.get('test') === '1',
  };
}
export function queryFromState(state, extra = {}) {
  const q = new URLSearchParams();
  if (state.days && state.days !== '7') q.set('days', state.days);
  if (state.days === 'custom') {
    if (state.from) q.set('from', state.from);
    if (state.to) q.set('to', state.to);
  }
  if (state.owner) q.set('owner', '1');
  if (state.test) q.set('test', '1');
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, String(v));
  return q;
}
