// /ops shell: hash router, API client, period and scope controls, and the loading, empty, error and expired states.
// Same-origin only. No analytics, no consent script, no third-party request. Nothing from the API is parsed as HTML.
import { PERIODS, apiQuery, parseHash, stateFromQuery, queryFromState, isSid } from './lib.js';
import { h, clear } from './dom.js';
import { VIEWS } from './views.js';

class ApiError extends Error {
  constructor(kind, status, detail, hint) { super(kind); this.kind = kind; this.status = status; this.detail = detail; this.hint = hint; }
}

// Access answers an expired login with a cross-origin redirect (opaque with redirect: manual) or an HTML login page.
// The function itself answers 403 {error:'forbidden'}. All three mean the same: sign in again.
async function request(name, query, opts = {}) {
  const url = '/api/ops/' + name + (query && String(query) ? '?' + query : '');
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: opts.signal,
      headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError('network', 0);
  }
  if (res.type === 'opaqueredirect' || res.status === 0) throw new ApiError('expired', res.status);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  let body = null;
  if (type.includes('json')) { try { body = await res.json(); } catch { body = null; } }
  if (res.status === 401) throw new ApiError('expired', 401);
  if (res.status === 403) {
    if (body && body.error === 'origin') throw new ApiError('origin', 403);
    throw new ApiError('expired', 403);
  }
  if (!res.ok) throw new ApiError('http', res.status, body && typeof body.error === 'string' ? body.error : '', body && typeof body.hint === 'string' ? body.hint : '');
  if (!type.includes('json')) throw new ApiError('expired', res.status);
  if (!body || typeof body !== 'object') throw new ApiError('bad', res.status);
  return body;
}

const $ = (id) => document.getElementById(id);
const nav = $('nav'), controls = $('controls'), viewHost = $('view'), menu = $('menu'), main = $('main');
const wide = window.matchMedia('(min-width: 960px)');
let seq = 0, ctrl = null, cleanup = [], state = stateFromQuery(new URLSearchParams()), lastKey = '', lastQuery = new URLSearchParams();

const EXTRA_KEYS = ['page', 'device', 'kind'];
function extraFrom(query) { const o = {}; for (const k of EXTRA_KEYS) if (query.get(k)) o[k] = query.get(k); return o; }
function hrefFor(view, arg = '', extra = {}) {
  const q = queryFromState(state, extra).toString();
  return '#/' + view + (arg ? '/' + encodeURIComponent(arg) : '') + (q ? '?' + q : '');
}
function go(view, arg = '', extra = {}) { location.hash = hrefFor(view, arg, extra); }

function buildNav(current) {
  clear(nav);
  nav.appendChild(h('ul', null, Object.entries(VIEWS).map(([id, v]) => h('li', null, h('a', { href: hrefFor(id), text: v.label, 'aria-current': id === current ? 'page' : null })))));
}

function renderControls(view, def, arg) {
  clear(controls);
  const single = view === 'visits' && arg;
  const periodOn = def.period && !single;
  const ownerOn = def.owner !== false && !single;
  const testOn = def.test !== false && !single;
  const extra = extraFrom(lastQuery);
  const sel = h('select', { id: 'period', disabled: periodOn ? null : true }, PERIODS.map((p) => h('option', { value: p.id, text: p.label, selected: p.id === state.days ? true : null })));
  sel.addEventListener('change', () => { state = { ...state, days: sel.value }; go(view, arg, extra); });
  const mk = (id, key, label, on) => {
    const cb = h('input', { type: 'checkbox', id, checked: state[key] && on ? true : null, disabled: on ? null : true });
    cb.addEventListener('change', () => { state = { ...state, [key]: cb.checked }; go(view, arg, extra); });
    return h('label', { class: 'check', for: id }, cb, h('span', { text: label }));
  };
  controls.appendChild(h('div', { class: 'field' }, h('label', { for: 'period', text: 'Period' }), sel));
  if (periodOn && state.days === 'custom') {
    const mkDate = (id, key, label) => {
      const i = h('input', { type: 'date', id, value: state[key] || null });
      i.addEventListener('change', () => { state = { ...state, [key]: i.value }; go(view, arg, extra); });
      return h('div', { class: 'field' }, h('label', { for: id, text: label }), i);
    };
    controls.appendChild(mkDate('period-from', 'from', 'From (UTC date)'));
    controls.appendChild(mkDate('period-to', 'to', 'To, inclusive (UTC date)'));
  }
  controls.appendChild(h('fieldset', { class: 'field' }, h('legend', { text: 'Include' }), h('div', { class: 'checks' }, mk('inc-test', 'test', 'Test traffic', testOn), mk('inc-owner', 'owner', 'Owner visits', ownerOn))));
  const why = [];
  if (single) why.push(VIEWS.visits.whyArg);
  else { if (!def.period && def.why) why.push(def.why); if (def.owner === false && def.whyOwner) why.push(def.whyOwner); }
  if (why.length) controls.appendChild(h('p', { class: 'ctl-note', id: 'ctl-note', text: why.join(' ') }));
  if (ownerOn && state.owner) controls.appendChild(h('p', { class: 'ctl-note', text: 'Owner visits are included, so these numbers are not only visitors.' }));
}

function stateBox(kind, title, text, actions) {
  return h('div', { class: 'state' + (kind === 'err' ? ' err' : ''), role: kind === 'err' ? 'alert' : null, id: 'state-' + kind },
    h('h2', { text: title }), h('p', { text }), actions && actions.length ? h('div', { class: 'actions' }, actions) : null);
}
function errorState(e) {
  const retry = h('button', { type: 'button', text: 'Try again', onclick: () => route(true) });
  if (e instanceof ApiError) {
    if (e.kind === 'expired') return stateBox('err', 'Your login has expired', 'The server did not accept this session. Reload the page to sign in again. Nothing on this page was changed.', [h('button', { type: 'button', class: 'primary', text: 'Reload and sign in', onclick: () => location.reload() })]);
    if (e.kind === 'network') return stateBox('err', 'The server could not be reached', 'Check your connection, then try again. If you were signed out, reloading the page signs you in again.', [retry, h('button', { type: 'button', text: 'Reload the page', onclick: () => location.reload() })]);
    if (e.kind === 'http') return stateBox('err', 'The server returned an error', `The request failed with status ${e.status}${e.detail ? ' (' + e.detail.slice(0, 60) + ')' : ''}. Nothing is shown rather than guessing.`, [retry]);
    if (e.kind === 'origin') return stateBox('err', 'The server refused this request', 'It came from an unexpected origin. Reload the page and try again.', [retry]);
    return stateBox('err', 'The answer could not be read', 'The server replied with something that is not the expected data.', [retry]);
  }
  return stateBox('err', 'This view could not be drawn', 'The data was not in the shape this page expects. Nothing is shown rather than guessing.', [retry]);
}

function teardown() {
  for (const f of cleanup) { try { f(); } catch { /* best effort */ } }
  cleanup = [];
  if (ctrl) ctrl.abort();
}

async function route(force) {
  teardown();
  const my = ++seq;
  const { view, arg, query } = parseHash(location.hash);
  lastQuery = query;
  state = stateFromQuery(query);
  const def = VIEWS[view];
  menu.open = wide.matches;
  if (!def) {
    buildNav('');
    controls.hidden = true;
    clear(viewHost).appendChild(h('div', null, h('h1', { tabindex: '-1', text: 'Unknown view' }), stateBox('info', 'There is no view called ' + (view || 'that').slice(0, 40), 'Pick one from the list.', [h('a', { href: hrefFor('live'), text: 'Open Live' })])));
    viewHost.setAttribute('aria-busy', 'false');
    document.title = 'Unknown view - Site analytics';
    return;
  }
  const single = view === 'visits' && arg;
  if (single && !isSid(arg)) { /* the view shows its own message */ }
  controls.hidden = false;
  buildNav(view);
  renderControls(view, def, arg);
  document.title = def.label + ' - Site analytics';
  const title = h('h1', { tabindex: '-1', id: 'view-title', text: single ? 'One visit' : def.label });
  clear(viewHost).appendChild(h('div', null, title, stateBox('loading', 'Loading', 'Fetching ' + def.label.toLowerCase() + ' from the store.')));
  viewHost.setAttribute('aria-busy', 'true');
  ctrl = new AbortController();
  const signal = ctrl.signal;
  const mounts = [];
  const effective = { ...state, owner: def.owner === false ? false : state.owner, test: def.test === false ? false : state.test };
  const ctx = {
    state: effective, query, arg, signal,
    get: (name, extra) => request(name, apiQuery(effective, extra), { signal }),
    post: (name, body) => request(name, '', { method: 'POST', body }),
    href: hrefFor, go,
    every: (fn, ms) => { const t = setInterval(() => { if (!document.hidden && !signal.aborted) fn(); }, ms); cleanup.push(() => clearInterval(t)); },
    afterMount: (fn) => mounts.push(fn),
    onTeardown: (fn) => cleanup.push(fn),
  };
  let node;
  try {
    node = await def.fn(ctx);
  } catch (e) {
    if (my !== seq || (e && e.name === 'AbortError')) return;
    clear(viewHost).appendChild(h('div', null, title, errorState(e)));
    viewHost.setAttribute('aria-busy', 'false');
    return;
  }
  if (my !== seq) return;
  clear(viewHost).appendChild(h('div', null, title, node));
  viewHost.setAttribute('aria-busy', 'false');
  for (const m of mounts) { try { m(); } catch { /* drawing is best effort */ } }
  const key = view + '/' + arg;
  if (key !== lastKey || force === true) { const first = lastKey === ''; lastKey = key; if (!first) title.focus({ preventScroll: false }); }
}

window.addEventListener('hashchange', () => route());
wide.addEventListener('change', () => { menu.open = wide.matches; });
if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/live');
route();
