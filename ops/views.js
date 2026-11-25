// One function per view. Each takes ctx and returns a DOM node (or throws an ApiError for the shell to show).
// ctx: { get(name, extra), post(name, body), href(view, arg, extra), query, arg, state, every(fn, ms), signal, rerun() }
// Every value from the API is untrusted. It is placed with textContent (through h/table) and never parsed as HTML.
import {
  isSlug, isSid, isPath, linkUrl, destOk, SLUG_RE, LABEL_RE, rate, avg, num, fmtInt, fmtDec, fmtSecs, fmtMs, fmtTs, fmtDay, fmtAge, fmtPct,
  clip, classifyHost, channelLabel, paramPairs, MIN_N,
} from './lib.js';
import { h, clear, table, facts, bars, note, rateCell, avgCell, secsCell, toast, download, copyText } from './dom.js';

const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const s = (x) => (x === null || x === undefined ? '' : String(x));
const n0 = (x) => num(x) ?? 0;

function empty(title, text) {
  return h('div', { class: 'state' }, h('h2', { text: title }), h('p', { text }));
}
function scopeLine(res, extra, noRange) {
  const r = obj(res.range), sc = obj(res.scope);
  const parts = [];
  if (noRange) { /* fixed window, stated in extra */ }
  else if (num(r.from) !== null && num(r.to) !== null) parts.push(`Data from ${fmtDay(r.from)} to ${fmtDay(Math.min(r.to, Date.now()))}, shown in your local time.`);
  else parts.push('The server did not say which period it used.');
  parts.push(`Owner visits: ${sc.owner ? 'included' : 'excluded'}.`);
  parts.push(`Test traffic: ${sc.test ? 'included' : 'excluded'}.`);
  if (extra) parts.push(extra);
  return h('p', { class: 'lede', text: parts.join(' ') });
}
const pageLink = (ctx, view, path, label) => (isPath(path) ? h('a', { href: ctx.href(view, '', { page: path }), text: label }) : null);

// ======================================================================= Live
export async function live(ctx) {
  const host = h('div', { class: 'stack' });
  const status = h('p', { class: 'lede' });
  let lastOk = 0;
  const paint = (d) => {
    const recent = arr(d.recent), top = arr(d.top_pages);
    clear(host);
    if (!n0(d.active_sessions) && !n0(d.events_30m) && !recent.length) {
      host.appendChild(empty('No events yet', 'The store has no events in this scope. If the site has had visitors, open Data health and check the last event time and the ingest drops.'));
      return;
    }
    host.appendChild(facts([
      { label: 'Visits active in the last 5 minutes', value: fmtInt(d.active_sessions) },
      { label: 'Events in the last minute', value: fmtInt(d.events_1m) },
      { label: 'Events in the last 30 minutes', value: fmtInt(d.events_30m) },
    ]));
    host.appendChild(table({
      id: 'live-top', title: 'Pages viewed in the last 30 minutes', csvName: 'live-pages',
      cols: [
        { key: 'path', label: 'Page', get: (r) => s(r.path), wrap: true },
        { key: 'n', label: 'Page views', num: true, get: (r) => n0(r.n) },
      ],
      rows: top, sort: { key: 'n', dir: 'desc' }, empty: 'No page views in the last 30 minutes.',
    }));
    host.appendChild(table({
      id: 'live-recent', title: 'Latest events', csvName: 'live-events', limitNote: 'The newest 50 events. Details show recorded values only: ids, buckets and counts, never typed text.',
      cols: [
        { key: 'ts', label: 'Time', get: (r) => num(r.ts), cell: (r) => fmtTs(r.ts, { seconds: true }), csv: (r) => (num(r.ts) === null ? '' : new Date(r.ts).toISOString()) },
        { key: 'name', label: 'Event', get: (r) => s(r.name) },
        { key: 'path', label: 'Page', get: (r) => s(r.path), wrap: true },
        { key: 'device', label: 'Device', get: (r) => s(r.device) },
        { key: 'country', label: 'Country', get: (r) => s(r.country) },
        { key: 'link', label: 'Link', get: (r) => s(r.link) },
        { key: 'params', label: 'Details', get: (r) => s(r.params), wrap: true, cell: (r) => h('code', { text: clip(r.params, 200) }) },
      ],
      rows: recent, sort: { key: 'ts', dir: 'desc' },
    }));
  };
  const setStatus = (text) => { status.textContent = text; };
  const first = await ctx.get('live');
  paint(first);
  lastOk = Date.now();
  const refresh = async () => {
    try {
      const d = await ctx.get('live');
      paint(d);
      lastOk = Date.now();
      setStatus(`Updated ${fmtTs(lastOk, { seconds: true })}. Refreshes every 15 seconds while this tab is visible.`);
    } catch {
      setStatus(`Refresh failed. The data below is from ${fmtTs(lastOk, { seconds: true })} (${fmtAge(lastOk)}).`);
    }
  };
  setStatus(`Updated ${fmtTs(lastOk, { seconds: true })}. Refreshes every 15 seconds while this tab is visible.`);
  ctx.every(refresh, 15000);
  const bar = h('div', { class: 'actions' }, h('button', { type: 'button', text: 'Refresh now', onclick: refresh }));
  return h('div', null, scopeLine(first, 'This view always shows the last 30 minutes, so the period picker does not apply.', true), status, bar, host);
}

// ======================================================================= Where from
export async function where(ctx) {
  const d = await ctx.get('acquisition');
  const total = n0(d.sessions);
  const out = h('div', { class: 'stack' });
  if (!total) { return h('div', null, scopeLine(d), empty('No visits in this period', 'Try a longer period, or include test traffic if you are checking a test run.')); }
  out.appendChild(facts([{ label: 'Visits', value: fmtInt(total) }, { label: 'Visitors', value: fmtInt(d.visitors), sub: 'distinct anonymous ids' }]));
  out.appendChild(table({
    id: 'where-channels', title: 'Channels', csvName: 'where-channels',
    limitNote: 'Visitors are added up per group inside a channel, so a person who came by two groups of the same channel counts twice.',
    cols: [
      { key: 'channel', label: 'Channel', get: (r) => channelLabel(r.channel), wrap: true },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => n0(r.sessions) },
      { key: 'share', label: 'Share of all visits', num: true, get: (r) => n0(r.sessions) / total, cell: (r) => rateCell(r.sessions, total), csv: (r) => rate(r.sessions, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
      { key: 'visitors', label: 'Visitors', num: true, get: (r) => n0(r.visitors) },
      { key: 'active', label: 'Active time per visit', num: true, get: (r) => (n0(r.sessions) ? n0(r.active_s) / n0(r.sessions) : null), cell: (r) => secsCell(n0(r.sessions) ? n0(r.active_s) / n0(r.sessions) : null, r.sessions), csvExtra: [{ label: 'active_sample_n', get: (r) => n0(r.sessions) }] },
    ],
    rows: arr(d.channels), sort: { key: 'sessions', dir: 'desc' },
  }));
  out.appendChild(table({
    id: 'where-referrers', title: 'Referring websites', csvName: 'where-referrers', limitNote: 'Top 25 hosts. Visits with no referrer are in Direct or unknown.',
    cols: [
      { key: 'ref_host', label: 'Host', get: (r) => s(r.ref_host), wrap: true },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => n0(r.sessions) },
      { key: 'share', label: 'Share of all visits', num: true, get: (r) => n0(r.sessions) / total, cell: (r) => rateCell(r.sessions, total), csv: (r) => rate(r.sessions, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
    ],
    rows: arr(d.referrers), sort: { key: 'sessions', dir: 'desc' }, empty: 'No visit in this period had a referrer.',
  }));
  out.appendChild(table({
    id: 'where-utm', title: 'Campaign tags on arrival', csvName: 'where-utm', limitNote: 'Top 25 combinations. Tracked links set these tags for you.',
    cols: [
      { key: 'utm_source', label: 'Source tag', get: (r) => s(r.utm_source), wrap: true },
      { key: 'utm_medium', label: 'Medium tag', get: (r) => s(r.utm_medium), wrap: true },
      { key: 'utm_campaign', label: 'Campaign tag', get: (r) => s(r.utm_campaign), wrap: true },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => n0(r.sessions) },
    ],
    rows: arr(d.utm), sort: { key: 'sessions', dir: 'desc' }, empty: 'No visit in this period arrived with campaign tags.',
  }));
  out.appendChild(table({
    id: 'where-countries', title: 'Countries', csvName: 'where-countries', limitNote: 'Top 25. Country comes from the edge, never from an address stored by this site.',
    cols: [
      { key: 'country', label: 'Country', get: (r) => s(r.country) || 'unknown' },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => n0(r.sessions) },
      { key: 'share', label: 'Share of all visits', num: true, get: (r) => n0(r.sessions) / total, cell: (r) => rateCell(r.sessions, total), csv: (r) => rate(r.sessions, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
    ],
    rows: arr(d.countries), sort: { key: 'sessions', dir: 'desc' },
  }));
  return h('div', null, scopeLine(d), out);
}

// ======================================================================= Links
function buildQr(url) {
  const gen = window.qrcode;
  if (typeof gen !== 'function') return null;
  const qr = gen(0, 'M');
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount(), scale = 8, margin = 4, size = (count + margin * 2) * scale;
  let d = '';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code for ' + url);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', '#000000');
  svg.appendChild(bg); svg.appendChild(p);
  return svg;
}

function linkForm(ctx, existing, onCreated) {
  const slug = h('input', { type: 'text', id: 'lf-slug', autocomplete: 'off', spellcheck: 'false', maxlength: '64', placeholder: 'li-thallo-01' });
  const dest = h('input', { type: 'text', id: 'lf-dest', autocomplete: 'off', spellcheck: 'false', maxlength: '500', placeholder: '/thallo/' });
  const campaign = h('input', { type: 'text', id: 'lf-campaign', autocomplete: 'off', spellcheck: 'false', maxlength: '48' });
  const content = h('input', { type: 'text', id: 'lf-content', autocomplete: 'off', spellcheck: 'false', maxlength: '48' });
  const app = h('input', { type: 'text', id: 'lf-app', autocomplete: 'off', spellcheck: 'false', maxlength: '48' });
  const preview = h('p', { class: 'urlbox', id: 'lf-preview', text: 'Short link appears here.' });
  const msg = h('p', { class: 'msg', id: 'lf-msg', role: 'status' });
  const warn = h('ul', { id: 'lf-warn' });
  const submit = h('button', { type: 'submit', class: 'primary', text: 'Create link' });
  slug.addEventListener('input', () => { const v = slug.value.trim().toLowerCase(); preview.textContent = isSlug(v) ? linkUrl(v) : 'Short link appears here once the slug is valid.'; });
  const fail = (t) => { msg.className = 'msg err'; msg.textContent = 'Could not create the link. ' + t; msg.setAttribute('role', 'alert'); clear(warn); };
  const labelOk = (v) => v === '' || (LABEL_RE.test(v) && v.length <= 48);
  const form = h('form', { class: 'form', id: 'link-form', novalidate: '', 'aria-label': 'Create a tracked link' },
    h('div', { class: 'field' }, h('label', { for: 'lf-slug', text: 'Slug' }), slug, h('p', { class: 'hint', text: 'Start with li-, cv-, qr-, em-, gh-, ig- or pdf-, then lowercase words joined by hyphens.' })),
    h('div', { class: 'field' }, h('label', { for: 'lf-dest', text: 'Destination' }), dest, h('p', { class: 'hint', text: 'A path such as /thallo/ or an https address on saikanagat.com.' })),
    h('div', { class: 'field' }, h('label', { for: 'lf-campaign', text: 'Campaign label (optional)' }), campaign),
    h('div', { class: 'field' }, h('label', { for: 'lf-content', text: 'Content label (optional)' }), content, h('p', { class: 'hint', text: 'Name the post or document, never a person.' })),
    h('div', { class: 'field wide' }, h('label', { for: 'lf-app', text: 'Application label (optional)' }), app, h('p', { class: 'hint', text: 'A company or role label. Never a person’s name.' })),
    h('div', { class: 'wide' }, h('p', { class: 'hint', text: 'Short link' }), preview),
    h('div', { class: 'wide actions' }, submit),
    h('div', { class: 'wide' }, msg, warn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sv = slug.value.trim().toLowerCase();
    const body = { slug: sv, dest: dest.value.trim() };
    const labs = { campaign: campaign.value.trim().toLowerCase(), content_label: content.value.trim().toLowerCase(), app_label: app.value.trim().toLowerCase() };
    if (!isSlug(sv)) return fail('The slug must start with li-, cv-, qr-, em-, gh-, ig- or pdf-, then lowercase words joined by hyphens, 64 characters at most.');
    if (existing().has(sv)) return fail(`The slug ${sv} already exists. Pick another one.`);
    if (!destOk(body.dest)) return fail('The destination must be a path starting with / or an https address on saikanagat.com.');
    for (const [k, v] of Object.entries(labs)) {
      if (!labelOk(v)) return fail(`The ${k.replace('_', ' ')} must be lowercase words joined by hyphens, 48 characters at most.`);
      if (v) body[k] = v;
    }
    submit.disabled = true;
    try {
      const res = await ctx.post('links', body);
      msg.className = 'msg ok'; msg.setAttribute('role', 'status');
      msg.textContent = `Created ${sv}. Short link: ${linkUrl(sv)}`;
      clear(warn);
      for (const w of arr(obj(res).warnings)) warn.appendChild(h('li', { text: 'Warning: ' + s(w) }));
      form.reset();
      preview.textContent = 'Short link appears here.';
      await onCreated(sv);
    } catch (err) {
      const k = err && err.detail;
      if (err && err.kind === 'expired') fail('Your login has expired. Reload the page to sign in again.');
      else if (err && err.status === 409) fail(`The slug ${sv} already exists. Pick another one.`);
      else if (err && err.kind === 'origin') fail('The server refused the request because of its origin. Reload the page and try again.');
      else if (err && err.status === 400) fail(`The server rejected the ${s(k).replace('_', ' ') || 'input'}${err.hint ? '. ' + err.hint : ''}.`);
      else fail('The server did not answer as expected. Nothing was saved that this page can confirm. Try again.');
    } finally { submit.disabled = false; }
  });
  return h('section', { class: 'section', 'aria-labelledby': 'lf-h' }, h('h2', { id: 'lf-h', text: 'Create a link' }), form);
}

export async function links(ctx) {
  let data = await ctx.get('links');
  const root = h('div', { class: 'stack' });
  const tableHost = h('div');
  const qrHost = h('div', { 'aria-live': 'polite' });
  const slugs = () => new Set(arr(data.links).map((l) => s(l.slug).toLowerCase()));

  const showQr = (slug) => {
    clear(qrHost);
    if (!isSlug(slug)) return;
    const url = linkUrl(slug);
    const svg = buildQr(url);
    if (!svg) { qrHost.appendChild(note('The QR code could not be made because the local generator did not load.')); return; }
    const urlEl = h('p', { class: 'urlbox', 'data-role': 'qr-url', tabindex: '-1', text: url });
    const panel = h('section', { class: 'panel', 'aria-labelledby': 'qr-h', id: 'qr-panel' },
      h('h2', { id: 'qr-h', text: 'QR code for ' + slug }),
      h('div', { class: 'qr' }, svg),
      urlEl,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'primary', id: 'qr-download', text: 'Download QR as SVG', onclick: () => { download(slug + '.svg', 'image/svg+xml', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg) + '\n'); toast('QR downloaded: ' + slug + '.svg'); } }),
        h('button', { type: 'button', text: 'Copy link', onclick: async () => toast((await copyText(url, urlEl)) ? 'Link copied' : 'Copy failed, link selected') }),
        h('button', { type: 'button', text: 'Close', onclick: () => clear(qrHost) })),
      h('p', { class: 'hint', text: 'The QR is made in this page. The link is the same one the Copy link button gives.' }));
    qrHost.appendChild(panel);
    panel.scrollIntoView({ block: 'nearest' });
  };

  const paint = () => {
    clear(tableHost);
    const rows = arr(data.links);
    tableHost.appendChild(table({
      id: 'links-table', title: 'Tracked links', csvName: 'links',
      limitNote: 'Clicks and visits count the period you picked. Bot clicks are listed apart and left out of the rates. Retired links still redirect.',
      empty: 'No tracked links yet. Create the first one above.',
      cols: [
        { key: 'slug', label: 'Link', get: (r) => s(r.slug), cell: (r) => (isSlug(r.slug) ? h('code', { text: r.slug }) : h('span', null, clip(r.slug, 80), h('span', { class: 'tag neg', text: 'invalid slug' }))), wrap: true },
        { key: 'dest', label: 'Destination', get: (r) => s(r.dest), wrap: true },
        { key: 'channel', label: 'Channel', get: (r) => s(r.channel) },
        { key: 'labels', label: 'Labels', get: (r) => [r.campaign, r.content_label, r.app_label].filter(Boolean).join(' / '), wrap: true },
        { key: 'created', label: 'Created', get: (r) => num(r.created), cell: (r) => fmtDay(r.created), csv: (r) => (num(r.created) === null ? '' : new Date(r.created).toISOString()) },
        { key: 'retired', label: 'Status', get: (r) => (n0(r.retired) ? 1 : 0), cell: (r) => h('span', { class: 'tag ' + (n0(r.retired) ? 'warn' : 'pos'), text: n0(r.retired) ? 'retired' : 'active' }), csv: (r) => (n0(r.retired) ? 'retired' : 'active') },
        { key: 'clicks_human', label: 'Human clicks', num: true, get: (r) => n0(r.clicks_human) },
        { key: 'clicks_bot', label: 'Bot clicks', num: true, get: (r) => n0(r.clicks_bot) },
        { key: 'sessions', label: 'Visits', num: true, get: (r) => n0(r.sessions) },
        { key: 'v_per_c', label: 'Visits per human click', num: true, get: (r) => (n0(r.clicks_human) ? n0(r.sessions) / n0(r.clicks_human) : null), cell: (r) => rateCell(r.sessions, r.clicks_human), csv: (r) => rate(r.sessions, r.clicks_human).pct, csvExtra: [{ label: 'rate_sample_n', get: (r) => n0(r.clicks_human) }] },
        { key: 'pages', label: 'Pages per visit', num: true, get: (r) => (n0(r.sessions) ? n0(r.pages) / n0(r.sessions) : null), cell: (r) => avgCell(n0(r.sessions) ? n0(r.pages) / n0(r.sessions) : null, r.sessions), csvExtra: [{ label: 'pages_sample_n', get: (r) => n0(r.sessions) }] },
        { key: 'active', label: 'Active time per visit', num: true, get: (r) => (n0(r.sessions) ? n0(r.active_s) / n0(r.sessions) : null), cell: (r) => secsCell(n0(r.sessions) ? n0(r.active_s) / n0(r.sessions) : null, r.sessions), csvExtra: [{ label: 'active_sample_n', get: (r) => n0(r.sessions) }] },
        { key: 'demos', label: 'Visits that opened a demo', num: true, get: (r) => n0(r.demos) },
        { key: 'conversions', label: 'Key events', num: true, get: (r) => n0(r.conversions) },
        { key: 'act', label: 'Actions', nocsv: true, get: () => '', cell: (r) => rowActions(r) },
      ],
      rows, sort: { key: 'created', dir: 'desc' },
    }));
  };

  const rowActions = (r) => {
    const td = h('td');
    if (!isSlug(r.slug)) { td.appendChild(h('span', { class: 'hint', text: 'No actions for an invalid slug.' })); return td; }
    const slug = r.slug;
    const box = h('div', { class: 'actions' });
    box.appendChild(h('button', { type: 'button', text: 'Copy link', 'aria-label': 'Copy link ' + slug, onclick: async () => toast((await copyText(linkUrl(slug))) ? 'Link copied' : 'Copy failed') }));
    box.appendChild(h('button', { type: 'button', text: 'QR code', 'aria-label': 'Show QR code for ' + slug, onclick: () => showQr(slug) }));
    if (!n0(r.retired)) {
      const retire = h('button', { type: 'button', class: 'danger', text: 'Retire', 'aria-label': 'Retire ' + slug });
      const confirmBtn = h('button', { type: 'button', class: 'danger', text: 'Confirm retire', 'aria-label': 'Confirm retiring ' + slug, hidden: true });
      const cancel = h('button', { type: 'button', text: 'Cancel', hidden: true });
      retire.addEventListener('click', () => { retire.hidden = true; confirmBtn.hidden = false; cancel.hidden = false; confirmBtn.focus(); });
      cancel.addEventListener('click', () => { retire.hidden = false; confirmBtn.hidden = true; cancel.hidden = true; retire.focus(); });
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try { await ctx.post('links/retire', { slug }); toast(slug + ' retired. It still redirects.'); await reload(); }
        catch (err) { confirmBtn.disabled = false; toast(err && err.kind === 'expired' ? 'Login expired. Reload to sign in.' : 'Could not retire ' + slug); }
      });
      box.append(retire, confirmBtn, cancel);
    }
    td.appendChild(box);
    return td;
  };

  const reload = async () => { data = await ctx.get('links'); paint(); };
  root.appendChild(linkForm(ctx, slugs, async (slug) => { await reload(); showQr(slug); }));
  root.appendChild(qrHost);
  root.appendChild(tableHost);
  paint();
  return h('div', null, scopeLine(data, 'Link clicks are counted for the period only, with no owner or test split.'), root);
}

// ======================================================================= Pages and time
export async function pages(ctx) {
  const d = await ctx.get('pages');
  const rows = arr(d.pages);
  if (!rows.length) return h('div', null, scopeLine(d), empty('No page views in this period', 'Try a longer period, or include test traffic.'));
  return h('div', null, scopeLine(d), table({
    id: 'pages-table', title: 'Pages', csvName: 'pages',
    limitNote: 'Time and scroll averages use only visits that sent a page_leave event. The sample size is the Leaves column. Top 200 pages by views.',
    cols: [
      { key: 'path', label: 'Page', get: (r) => s(r.path), wrap: true, cell: (r) => (isPath(r.path) ? h('span', null, clip(r.path, 120), ' ', h('a', { href: ctx.href('buttons', '', { page: r.path }), text: 'controls' }), ' ', h('a', { href: ctx.href('heatmap', '', { page: r.path }), text: 'heatmap' })) : clip(r.path, 120)) },
      { key: 'views', label: 'Page views', num: true, get: (r) => n0(r.views) },
      { key: 'visitors', label: 'Visitors', num: true, get: (r) => n0(r.visitors) },
      { key: 'leaves', label: 'Leaves (sample size)', num: true, get: (r) => n0(r.leaves) },
      { key: 'vis', label: 'Visible time', num: true, get: (r) => num(r.avg_visible_s), cell: (r) => secsCell(r.avg_visible_s, r.leaves), csvExtra: [{ label: 'time_sample_n', get: (r) => n0(r.leaves) }] },
      { key: 'act', label: 'Active time', num: true, get: (r) => num(r.avg_active_s), cell: (r) => secsCell(r.avg_active_s, r.leaves) },
      { key: 'scr', label: 'Furthest scroll', num: true, get: (r) => num(r.avg_max_scroll), cell: (r) => avgCell(r.avg_max_scroll, r.leaves, (v) => fmtDec(v, 0) + '%') },
    ],
    rows, sort: { key: 'views', dir: 'desc' },
  }));
}

// ======================================================================= Buttons
export async function buttons(ctx) {
  const page = isPath(ctx.query.get('page')) ? ctx.query.get('page') : '';
  const [d, pg] = await Promise.all([ctx.get('buttons', page ? { path: page } : {}), ctx.get('pages').catch(() => ({ pages: [] }))]);
  const rows = arr(d.buttons);
  const paths = arr(pg.pages).map((p) => s(p.path)).filter(isPath);
  if (page && !paths.includes(page)) paths.unshift(page);
  const sel = h('select', { id: 'btn-page' }, h('option', { value: '', text: 'All pages' }), paths.map((p) => h('option', { value: p, text: clip(p, 80), selected: p === page ? true : null })));
  sel.addEventListener('change', () => ctx.go('buttons', '', { page: sel.value }));
  const q = h('input', { type: 'search', id: 'btn-q', autocomplete: 'off', placeholder: 'control id contains' });
  const tableHost = h('div');
  const paint = () => {
    clear(tableHost);
    const needle = q.value.trim().toLowerCase();
    const shown = needle ? rows.filter((r) => s(r.track_id).toLowerCase().includes(needle)) : rows;
    tableHost.appendChild(table({
      id: 'buttons-table', title: page ? 'Controls on ' + clip(page, 80) : 'Controls on all pages', csvName: 'buttons',
      limitNote: 'Only controls clicked at least once appear. Per visit is clicks divided by the visits that clicked the control, not by all visits. The API returns at most 500 rows.',
      empty: needle ? 'No control matches that text.' : 'No clicks recorded for this page in this period.',
      cols: [
        { key: 'track_id', label: 'Control', get: (r) => s(r.track_id), cell: (r) => h('code', { text: clip(r.track_id, 120) }), wrap: true },
        { key: 'zone', label: 'Zone', get: (r) => s(r.zone) },
        { key: 'path', label: 'Page', get: (r) => s(r.path), wrap: true },
        { key: 'clicks', label: 'Clicks', num: true, get: (r) => n0(r.clicks) },
        { key: 'visitors', label: 'Visitors', num: true, get: (r) => n0(r.visitors) },
        { key: 'sessions', label: 'Visits that clicked', num: true, get: (r) => n0(r.sessions) },
        { key: 'per', label: 'Clicks per visit', num: true, get: (r) => num(r.per_session), cell: (r) => avgCell(r.per_session, r.sessions, (v) => fmtDec(v, 2)), csvExtra: [{ label: 'per_visit_sample_n', get: (r) => n0(r.sessions) }] },
        { key: 'last', label: 'Last click', num: true, get: (r) => num(r.last_ts), cell: (r) => fmtTs(r.last_ts), csv: (r) => (num(r.last_ts) === null ? '' : new Date(r.last_ts).toISOString()) },
      ],
      rows: shown, sort: { key: 'clicks', dir: 'desc' },
    }));
  };
  q.addEventListener('input', paint);
  paint();
  const bar = h('div', { class: 'controls' },
    h('div', { class: 'field' }, h('label', { for: 'btn-page', text: 'Page' }), sel),
    h('div', { class: 'field' }, h('label', { for: 'btn-q', text: 'Find a control' }), q));
  return h('div', null, scopeLine(d), bar, tableHost);
}

// ======================================================================= Heatmap
const GRID_COLS = 50, ROW_PX = 40;
export async function heatmap(ctx) {
  // The page list is needed to choose a page. If it cannot be fetched and no page was asked for, show the real error, not "no data".
  const pg = await ctx.get('pages').catch((e) => { if (ctx.query.get('page')) return { pages: [] }; throw e; });
  const paths = arr(pg.pages).map((p) => s(p.path)).filter(isPath);
  let page = isPath(ctx.query.get('page')) ? ctx.query.get('page') : (paths[0] || '');
  if (page && !paths.includes(page)) paths.unshift(page);
  const device = ['desktop', 'mobile', 'tablet'].includes(ctx.query.get('device')) ? ctx.query.get('device') : 'desktop';
  const kind = ['click', 'tap', 'move'].includes(ctx.query.get('kind')) ? ctx.query.get('kind') : 'click';
  const change = (extra) => ctx.go('heatmap', '', { page, device, kind, ...extra });
  const sel = h('select', { id: 'hm-page' }, paths.map((p) => h('option', { value: p, text: clip(p, 80), selected: p === page ? true : null })));
  sel.addEventListener('change', () => change({ page: sel.value }));
  const custom = h('input', { type: 'text', id: 'hm-path', autocomplete: 'off', spellcheck: 'false', placeholder: '/work' });
  custom.addEventListener('change', () => { const v = custom.value.trim(); if (isPath(v)) change({ page: v }); else toast('Not a valid page path'); });
  const dev = h('select', { id: 'hm-device' }, ['desktop', 'mobile', 'tablet'].map((v) => h('option', { value: v, text: v, selected: v === device ? true : null })));
  dev.addEventListener('change', () => change({ device: dev.value }));
  const kd = h('select', { id: 'hm-kind' }, [['click', 'Clicks'], ['tap', 'Taps'], ['move', 'Cursor movement']].map(([v, t]) => h('option', { value: v, text: t, selected: v === kind ? true : null })));
  kd.addEventListener('change', () => change({ kind: kd.value }));
  const bar = h('div', { class: 'controls' },
    h('div', { class: 'field' }, h('label', { for: 'hm-page', text: 'Page' }), sel),
    h('div', { class: 'field' }, h('label', { for: 'hm-path', text: 'Or type a page path' }), custom),
    h('div', { class: 'field' }, h('label', { for: 'hm-device', text: 'Device' }), dev),
    h('div', { class: 'field' }, h('label', { for: 'hm-kind', text: 'Kind' }), kd));
  if (!page) return h('div', null, bar, empty('No page to map', 'No page had views in this period. Pick a longer period or type a page path.'));
  const d = await ctx.get('heatmap', { path: page, device, kind });
  const cells = arr(d.cells).map((c) => ({ x: Math.round(n0(c.x)), y: Math.round(n0(c.y)), n: n0(c.n) })).filter((c) => c.x >= 0 && c.x < GRID_COLS && c.y >= 0 && c.y < 256 && c.n > 0);
  const total = n0(d.total) || cells.reduce((a, c) => a + c.n, 0);
  const intro = scopeLine(d, 'Owner traffic is never binned, so the owner switch has no effect on this view.');
  if (!cells.length) return h('div', null, intro, bar, empty('Nothing recorded here', `No ${kind} points for ${clip(page, 80)} on ${device} in this period. Tracked points exist only for visitors who accepted analytics.`));
  const maxY = Math.max(...cells.map((c) => c.y)) + 1;
  const max = Math.max(...cells.map((c) => c.n));
  const canvas = h('canvas', { id: 'hm-canvas', role: 'img', 'aria-label': `Heatmap of ${kind} points on ${clip(page, 80)}, ${device}. ${fmtInt(total)} points in ${cells.length} cells. A table of the busiest cells follows.` });
  const read = h('p', { class: 'heat-read', id: 'hm-read', 'aria-live': 'off', text: `Top of the page is at the top of the map, which covers ${fmtInt(maxY * ROW_PX)} px of page height. Move over the map to read a cell.` });
  const draw = () => {
    const css = Math.max(240, Math.min(640, canvas.parentElement ? canvas.parentElement.clientWidth || 640 : 640));
    const cw = css / GRID_COLS, ch = Math.max(4, Math.round(cw * 0.6));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(maxY * ch * dpr);
    canvas.style.height = maxY * ch + 'px';
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const root = getComputedStyle(document.documentElement);
    g.fillStyle = root.getPropertyValue('--surface').trim() || '#fff';
    g.fillRect(0, 0, css, maxY * ch);
    g.strokeStyle = root.getPropertyValue('--rule').trim() || '#ddd';
    g.lineWidth = 1;
    for (let x = 0; x <= GRID_COLS; x += 10) { g.beginPath(); g.moveTo(Math.round(x * cw) + 0.5, 0); g.lineTo(Math.round(x * cw) + 0.5, maxY * ch); g.stroke(); }
    g.fillStyle = root.getPropertyValue('--fill').trim() || '#00f';
    for (const c of cells) {
      g.globalAlpha = 0.12 + 0.88 * Math.sqrt(c.n / max);
      g.fillRect(c.x * cw, c.y * ch, Math.ceil(cw), Math.ceil(ch));
    }
    g.globalAlpha = 1;
  };
  const byKey = new Map(cells.map((c) => [c.x + ',' + c.y, c]));
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * GRID_COLS);
    const y = Math.floor(((e.clientY - r.top) / r.height) * maxY);
    const c = byKey.get(x + ',' + y);
    read.textContent = c ? `Column ${x + 1} of ${GRID_COLS}, page height ${y * ROW_PX} to ${(y + 1) * ROW_PX} px: ${fmtInt(c.n)} points` : `Column ${x + 1} of ${GRID_COLS}, page height ${y * ROW_PX} to ${(y + 1) * ROW_PX} px: no points`;
  });
  const wrap = h('div', { class: 'heat' }, canvas, read);
  const low = total < MIN_N ? note(`Only ${fmtInt(total)} points in this view. With fewer than ${MIN_N} points the pattern is noise.`) : null;
  const top = cells.slice().sort((a, b) => b.n - a.n).slice(0, 25);
  const tbl = table({
    id: 'hm-table', title: 'Busiest cells', csvName: 'heatmap-cells',
    limitNote: 'Columns split the viewport width into 50 equal parts. Rows are 40 pixels of page height. The export holds every cell, not only these 25.',
    cols: [
      { key: 'x', label: 'Column (1 to 50)', num: true, get: (r) => r.x + 1 },
      { key: 'y', label: 'Page height from (px)', num: true, get: (r) => r.y * ROW_PX },
      { key: 'n', label: 'Points', num: true, get: (r) => r.n },
      { key: 'p', label: 'Share of points', num: true, get: (r) => r.n / total, cell: (r) => rateCell(r.n, total), csv: (r) => rate(r.n, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
    ],
    rows: top, sort: { key: 'n', dir: 'desc' },
  });
  const tmp = h('div', null, intro, bar, facts([{ label: 'Points', value: fmtInt(total), sub: 'in ' + fmtInt(cells.length) + ' cells' }]), low, wrap, tbl);
  // Full export: wire a second button for all cells.
  tmp.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', id: 'hm-csv-all', text: 'Download CSV of every cell', onclick: () => {
    const lines = ['column,page_height_px,points', ...cells.map((c) => `${c.x + 1},${c.y * ROW_PX},${c.n}`)];
    download(`heatmap-all-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', lines.join('\r\n') + '\r\n');
  } })));
  ctx.afterMount(() => { draw(); const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null; if (ro) { ro.observe(wrap); ctx.onTeardown(() => ro.disconnect()); } });
  return tmp;
}

// ======================================================================= Visits
export async function visits(ctx) {
  if (ctx.arg) return visit(ctx);
  const LIMIT = 50;
  const first = await ctx.get('visits', { limit: LIMIT });
  let rows = arr(first.sessions);
  let more = rows.length >= LIMIT;
  if (!rows.length) return h('div', null, scopeLine(first), empty('No visits in this period', 'Try a longer period, or include test traffic.'));
  const host = h('div');
  const loadBtn = h('button', { type: 'button', id: 'visits-older', text: 'Load older visits' });
  const paint = () => {
    clear(host);
    host.appendChild(table({
      id: 'visits-table', title: 'Visits, newest first', csvName: 'visits', limitNote: 'Each visit is anonymous. Open one to see its timeline of events.',
      cols: [
        { key: 'first_ts', label: 'Started', get: (r) => num(r.first_ts), cell: (r) => (isSid(r.sid) ? h('a', { href: ctx.href('visits', r.sid), text: fmtTs(r.first_ts, { seconds: true }) || r.sid }) : fmtTs(r.first_ts)), csv: (r) => (num(r.first_ts) === null ? '' : new Date(r.first_ts).toISOString()) },
        { key: 'sid', label: 'Visit id', get: (r) => s(r.sid), cell: (r) => h('code', { text: clip(r.sid, 24) }) },
        { key: 'landing', label: 'Landed on', get: (r) => s(r.landing), wrap: true },
        { key: 'link', label: 'Link', get: (r) => s(r.link) },
        { key: 'ref_host', label: 'Referrer', get: (r) => s(r.ref_host), wrap: true },
        { key: 'country', label: 'Country', get: (r) => s(r.country) },
        { key: 'device', label: 'Device', get: (r) => s(r.device) },
        { key: 'pages', label: 'Pages', num: true, get: (r) => n0(r.pages) },
        { key: 'events', label: 'Events', num: true, get: (r) => n0(r.events) },
        { key: 'active_s', label: 'Active time', num: true, get: (r) => num(r.active_s), cell: (r) => fmtSecs(r.active_s) },
      ],
      rows, sort: { key: 'first_ts', dir: 'desc' },
    }));
    clear(loadBtn);
    loadBtn.textContent = more ? 'Load older visits' : 'No older visits in this period';
    loadBtn.disabled = !more;
  };
  loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
    try {
      const before = Math.min(...rows.map((r) => n0(r.first_ts)).filter(Boolean));
      const res = await ctx.get('visits', { limit: LIMIT, before });
      const add = arr(res.sessions);
      const seen = new Set(rows.map((r) => r.sid));
      rows = rows.concat(add.filter((r) => !seen.has(r.sid)));
      more = add.length >= LIMIT;
      paint();
    } catch { toast('Could not load older visits'); loadBtn.disabled = false; }
  });
  paint();
  return h('div', null, scopeLine(first), host, h('div', { class: 'actions' }, loadBtn));
}

async function visit(ctx) {
  if (!isSid(ctx.arg)) return h('div', null, h('p', null, h('a', { href: ctx.href('visits'), text: 'Back to visits' })), empty('Not a visit id', 'A visit id is 16 lowercase hexadecimal characters.'));
  const d = await ctx.get('visits', { sid: ctx.arg });
  const ses = obj(d.session);
  const back = h('p', null, h('a', { href: ctx.href('visits'), text: 'Back to visits' }));
  if (!ses.sid) return h('div', null, back, empty('No visit with this id', 'The store has no visit with this id. It may be older than the retention window, or the id is wrong.'));
  const events = arr(d.events);
  const t0 = events.length ? n0(events[0].ts) : n0(ses.first_ts);
  const out = h('div', { class: 'stack' });
  out.appendChild(facts([
    { label: 'Started', value: fmtTs(ses.first_ts, { seconds: true }) },
    { label: 'Pages', value: fmtInt(ses.pages) },
    { label: 'Events', value: fmtInt(ses.events) },
    { label: 'Active time', value: fmtSecs(n0(ses.active_ms) / 1000) },
  ]));
  out.appendChild(h('dl', { class: 'facts' }, [
    ['Landed on', clip(ses.landing, 200)], ['Link', clip(ses.link, 100) || 'none'], ['Referrer', clip(ses.ref_host, 100) || 'none'],
    ['UTM source', clip(ses.utm_source, 100) || 'none'], ['Country', clip(ses.country, 20) || 'unknown'], ['Device', clip(ses.device, 20) || 'unknown'],
  ].map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: v, class: 'mono' })))));
  out.appendChild(table({
    id: 'visit-timeline', title: 'Timeline', csvName: 'visit-' + ctx.arg,
    limitNote: events.length >= 1000 ? 'The API returns at most 1000 events for a visit; later events are not shown.' : 'Recorded values only: ids, buckets and counts. Typed text is never collected.',
    empty: 'No events stored for this visit.',
    cols: [
      { key: 'off', label: 'After first event', num: true, get: (r) => (n0(r.ts) - t0) / 1000, cell: (r) => '+' + fmtDec((n0(r.ts) - t0) / 1000, 1) + ' s' },
      { key: 'name', label: 'Event', get: (r) => s(r.name) },
      { key: 'path', label: 'Page', get: (r) => s(r.path), wrap: true },
      { key: 'params', label: 'Details', get: (r) => s(r.params), wrap: true, cell: (r) => { const p = paramPairs(r.params); return h('code', { text: clip(p ? p.map(([k, v]) => `${k}=${v}`).join(' ') : s(r.params), 240) }); } },
      { key: 'ts', label: 'Time', get: (r) => num(r.ts), cell: (r) => fmtTs(r.ts, { seconds: true }), csv: (r) => (num(r.ts) === null ? '' : new Date(r.ts).toISOString()) },
    ],
    rows: events, sort: { key: 'off', dir: 'asc' },
  }));
  return h('div', null, back, out);
}

// ======================================================================= Demos
const MEDIA_ORDER = ['prompt', 'granted', 'denied', 'dismissed', 'unavailable', 'failed', 'stopped'];
export async function demos(ctx) {
  const d = await ctx.get('demos');
  const rows = arr(d.demos).filter((x) => x && x.demo_id !== null && x.demo_id !== undefined);
  if (!rows.length) return h('div', null, scopeLine(d), empty('No demo activity in this period', 'Nothing was recorded for any demo or tool. Try a longer period.'));
  const mediaRate = (r, kind) => { const m = obj(r[kind]); return [n0(m.granted), n0(m.prompt)]; };
  const out = h('div', { class: 'stack' });
  out.appendChild(table({
    id: 'demos-table', title: 'Every demo and tool', csvName: 'demos',
    limitNote: 'Counts are events, not unique visits, so a step can exceed the one before it. Engaged merges the 10 second and 60 second milestones. Model load times are recorded but this API does not return them yet.',
    cols: [
      { key: 'demo_id', label: 'Demo', get: (r) => s(r.demo_id), wrap: true },
      { key: 'opens', label: 'Opens', num: true, get: (r) => n0(r.opens) },
      { key: 'visitors', label: 'Visitors who opened', num: true, get: (r) => n0(r.visitors) },
      { key: 'starts', label: 'Starts', num: true, get: (r) => (n0(r.opens) ? n0(r.starts) / n0(r.opens) : null), cell: (r) => rateCell(r.starts, r.opens), csv: (r) => n0(r.starts), csvExtra: [{ label: 'starts_per_open_pct', get: (r) => rate(r.starts, r.opens).pct }, { label: 'starts_sample_n', get: (r) => n0(r.opens) }] },
      { key: 'engaged', label: 'Engaged', num: true, get: (r) => (n0(r.starts) ? n0(r.engaged) / n0(r.starts) : null), cell: (r) => rateCell(r.engaged, r.starts), csv: (r) => n0(r.engaged), csvExtra: [{ label: 'engaged_per_start_pct', get: (r) => rate(r.engaged, r.starts).pct }, { label: 'engaged_sample_n', get: (r) => n0(r.starts) }] },
      { key: 'ends', label: 'Ended', num: true, get: (r) => (n0(r.starts) ? n0(r.ends) / n0(r.starts) : null), cell: (r) => rateCell(r.ends, r.starts), csv: (r) => n0(r.ends), csvExtra: [{ label: 'ended_per_start_pct', get: (r) => rate(r.ends, r.starts).pct }, { label: 'ended_sample_n', get: (r) => n0(r.starts) }] },
      { key: 'dropoff', label: 'Opened but never started', num: true, get: (r) => (n0(r.opens) ? Math.max(0, n0(r.opens) - n0(r.starts)) / n0(r.opens) : null), cell: (r) => rateCell(Math.max(0, n0(r.opens) - n0(r.starts)), r.opens), csv: (r) => Math.max(0, n0(r.opens) - n0(r.starts)), csvExtra: [{ label: 'dropoff_sample_n', get: (r) => n0(r.opens) }] },
      { key: 'avg_ms', label: 'Average length', num: true, get: (r) => num(r.avg_ms), cell: (r) => avgCell(num(r.avg_ms) === null ? null : n0(r.avg_ms) / 1000, r.ends, fmtSecs), csvExtra: [{ label: 'length_sample_n', get: (r) => n0(r.ends) }] },
      { key: 'errors', label: 'Errors', num: true, get: (r) => n0(r.errors) },
      { key: 'cam', label: 'Camera allowed', num: true, get: (r) => { const [g, p] = mediaRate(r, 'camera'); return p ? g / p : null; }, cell: (r) => { const [g, p] = mediaRate(r, 'camera'); return rateCell(g, p); }, csv: (r) => mediaRate(r, 'camera')[0], csvExtra: [{ label: 'camera_prompts_n', get: (r) => mediaRate(r, 'camera')[1] }] },
      { key: 'mic', label: 'Microphone allowed', num: true, get: (r) => { const [g, p] = mediaRate(r, 'mic'); return p ? g / p : null; }, cell: (r) => { const [g, p] = mediaRate(r, 'mic'); return rateCell(g, p); }, csv: (r) => mediaRate(r, 'mic')[0], csvExtra: [{ label: 'mic_prompts_n', get: (r) => mediaRate(r, 'mic')[1] }] },
    ],
    rows, sort: { key: 'opens', dir: 'desc' },
  }));
  const details = h('div', { class: 'stack' });
  rows.forEach((r, i) => {
    const sec = h('section', { class: 'section', 'aria-labelledby': 'demo-h-' + i });
    sec.appendChild(h('h2', { id: 'demo-h-' + i, text: clip(r.demo_id, 80) }));
    let any = false;
    for (const kind of ['camera', 'mic']) {
      const m = obj(r[kind]);
      const keys = [...MEDIA_ORDER.filter((k) => k in m), ...Object.keys(m).filter((k) => !MEDIA_ORDER.includes(k))];
      if (!keys.length) continue;
      any = true;
      const prompts = n0(m.prompt);
      sec.appendChild(table({
        id: `demo-${i}-${kind}`, title: kind === 'camera' ? 'Camera permission funnel' : 'Microphone permission funnel', csvName: `demo-${s(r.demo_id)}-${kind}`,
        limitNote: prompts ? null : 'No prompt events were recorded, so shares of prompts cannot be worked out.',
        cols: [
          { key: 'state', label: 'Result', get: (x) => x.k, wrap: true },
          { key: 'n', label: 'Events', num: true, get: (x) => x.n },
          { key: 'share', label: 'Share of prompts', num: true, get: (x) => (prompts ? x.n / prompts : null), cell: (x) => (x.k === 'prompt' ? 'base' : rateCell(x.n, prompts)), csv: (x) => rate(x.n, prompts).pct, csvExtra: [{ label: 'prompt_sample_n', get: () => prompts }] },
        ],
        rows: keys.map((k) => ({ k, n: n0(m[k]) })), sort: null,
      }));
    }
    const acts = arr(r.top_actions);
    if (acts.length) {
      any = true;
      sec.appendChild(table({
        id: `demo-${i}-actions`, title: 'Most used actions', csvName: `demo-${s(r.demo_id)}-actions`, limitNote: 'Top 10 actions by count.',
        cols: [{ key: 'action', label: 'Action', get: (x) => s(x.action), wrap: true }, { key: 'n', label: 'Times', num: true, get: (x) => n0(x.n) }],
        rows: acts, sort: { key: 'n', dir: 'desc' },
      }));
    }
    if (!any) sec.appendChild(note('No permission results or named actions were recorded for this demo.'));
    details.appendChild(sec);
  });
  out.appendChild(details);
  return h('div', null, scopeLine(d), out);
}

// ======================================================================= Forms
export async function forms(ctx) {
  const d = await ctx.get('forms');
  const rows = arr(d.forms);
  if (!rows.length) return h('div', null, scopeLine(d), empty('No form activity in this period', 'No form was viewed or started. Try a longer period.'));
  const out = h('div', { class: 'stack' });
  out.appendChild(table({
    id: 'forms-table', title: 'Forms', csvName: 'forms',
    limitNote: 'Counts are events. Only the form id and the field id are stored, never what was typed. Success rate divides by attempts.',
    cols: [
      { key: 'form_id', label: 'Form', get: (r) => s(r.form_id), wrap: true },
      { key: 'view', label: 'Views', num: true, get: (r) => n0(r.view) },
      { key: 'start', label: 'Started', num: true, get: (r) => (n0(r.view) ? n0(r.start) / n0(r.view) : null), cell: (r) => rateCell(r.start, r.view), csv: (r) => n0(r.start), csvExtra: [{ label: 'start_per_view_pct', get: (r) => rate(r.start, r.view).pct }, { label: 'start_sample_n', get: (r) => n0(r.view) }] },
      { key: 'error', label: 'Field errors', num: true, get: (r) => n0(r.error) },
      { key: 'attempt', label: 'Send attempts', num: true, get: (r) => (n0(r.start) ? n0(r.attempt) / n0(r.start) : null), cell: (r) => rateCell(r.attempt, r.start), csv: (r) => n0(r.attempt), csvExtra: [{ label: 'attempt_per_start_pct', get: (r) => rate(r.attempt, r.start).pct }, { label: 'attempt_sample_n', get: (r) => n0(r.start) }] },
      { key: 'success', label: 'Succeeded', num: true, get: (r) => (n0(r.attempt) ? n0(r.success) / n0(r.attempt) : null), cell: (r) => rateCell(r.success, r.attempt), csv: (r) => n0(r.success), csvExtra: [{ label: 'success_per_attempt_pct', get: (r) => rate(r.success, r.attempt).pct }, { label: 'success_sample_n', get: (r) => n0(r.attempt) }] },
      { key: 'failure', label: 'Failed', num: true, get: (r) => n0(r.failure) },
      { key: 'abandon', label: 'Abandoned', num: true, get: (r) => (n0(r.start) ? n0(r.abandon) / n0(r.start) : null), cell: (r) => rateCell(r.abandon, r.start), csv: (r) => n0(r.abandon), csvExtra: [{ label: 'abandon_per_start_pct', get: (r) => rate(r.abandon, r.start).pct }, { label: 'abandon_sample_n', get: (r) => n0(r.start) }] },
    ],
    rows, sort: { key: 'view', dir: 'desc' },
  }));
  const ab = [];
  for (const f of rows) for (const a of arr(f.abandon_fields)) ab.push({ form_id: f.form_id, field: a.field, n: n0(a.n), started: n0(f.start) });
  out.appendChild(table({
    id: 'forms-abandon', title: 'Where people stopped', csvName: 'forms-abandon', limitNote: 'The field that was last active when a form was abandoned.',
    empty: 'No abandoned forms in this period.',
    cols: [
      { key: 'form_id', label: 'Form', get: (r) => s(r.form_id), wrap: true },
      { key: 'field', label: 'Field', get: (r) => s(r.field), wrap: true },
      { key: 'n', label: 'Abandons', num: true, get: (r) => r.n },
      { key: 'share', label: 'Share of starts', num: true, get: (r) => (r.started ? r.n / r.started : null), cell: (r) => rateCell(r.n, r.started), csv: (r) => rate(r.n, r.started).pct, csvExtra: [{ label: 'sample_n', get: (r) => r.started }] },
    ],
    rows: ab, sort: { key: 'n', dir: 'desc' },
  }));
  return h('div', null, scopeLine(d), out);
}

// ======================================================================= Auto cursor
export async function ghost(ctx) {
  const d = await ctx.get('ghost');
  const starts = n0(d.starts);
  if (!starts && !n0(d.ends) && !arr(d.modes).length && !arr(d.interrupts).length) {
    return h('div', null, scopeLine(d), empty('The auto cursor has not run', 'No haunt events in this period. The auto cursor only runs on the home page, and only for visitors who accepted analytics.'));
  }
  const out = h('div', { class: 'stack' });
  out.appendChild(h('dl', { class: 'facts' },
    h('div', null, h('dt', { text: 'Starts' }), h('dd', { text: fmtInt(starts) })),
    h('div', null, h('dt', { text: 'Ended' }), h('dd', null, rate(d.ends, starts).text, h('small', { text: `${rate(d.ends, starts).of}${rate(d.ends, starts).low ? ', n under 20' : ''}` }))),
    h('div', null, h('dt', { text: 'Stop button used' }), h('dd', null, rate(d.stop_clicks, starts).text, h('small', { text: `${rate(d.stop_clicks, starts).of}${rate(d.stop_clicks, starts).low ? ', n under 20' : ''}` })))));
  out.appendChild(note('Auto cursor events are kept apart from visitor behaviour. They never count as clicks, scrolls, hovers or active time.'));
  out.appendChild(table({
    id: 'ghost-modes', title: 'Modes', csvName: 'ghost-modes', empty: 'No mode recorded.',
    cols: [{ key: 'mode', label: 'Mode', get: (r) => s(r.mode) }, { key: 'n', label: 'Runs', num: true, get: (r) => n0(r.n) }, { key: 'share', label: 'Share of starts', num: true, get: (r) => (starts ? n0(r.n) / starts : null), cell: (r) => rateCell(r.n, starts), csv: (r) => rate(r.n, starts).pct, csvExtra: [{ label: 'sample_n', get: () => starts }] }],
    rows: arr(d.modes), sort: { key: 'n', dir: 'desc' },
  }));
  out.appendChild(table({
    id: 'ghost-ends', title: 'How runs ended', csvName: 'ghost-end-reasons', empty: 'No end reason recorded.',
    cols: [{ key: 'reason', label: 'Reason', get: (r) => s(r.reason) }, { key: 'n', label: 'Runs', num: true, get: (r) => n0(r.n) }, { key: 'share', label: 'Share of starts', num: true, get: (r) => (starts ? n0(r.n) / starts : null), cell: (r) => rateCell(r.n, starts), csv: (r) => rate(r.n, starts).pct, csvExtra: [{ label: 'sample_n', get: () => starts }] }],
    rows: arr(d.end_reasons), sort: { key: 'n', dir: 'desc' },
  }));
  out.appendChild(table({
    id: 'ghost-interrupts', title: 'What took control back', csvName: 'ghost-interrupts', empty: 'No interruption recorded.',
    cols: [{ key: 'input', label: 'Input', get: (r) => s(r.input) }, { key: 'n', label: 'Times', num: true, get: (r) => n0(r.n) }, { key: 'avg', label: 'Average time into the run', num: true, get: (r) => num(r.avg_ms), cell: (r) => avgCell(num(r.avg_ms) === null ? null : n0(r.avg_ms) / 1000, r.n, fmtSecs), csvExtra: [{ label: 'sample_n', get: (r) => n0(r.n) }] }],
    rows: arr(d.interrupts), sort: { key: 'n', dir: 'desc' },
  }));
  return h('div', null, scopeLine(d), out);
}

// ======================================================================= Search and AI assistants
export async function search(ctx) {
  const d = await ctx.get('acquisition');
  const total = n0(d.sessions);
  const channels = arr(d.channels);
  const byCh = (c) => channels.find((x) => x.channel === c);
  const refs = arr(d.referrers).map((r) => ({ host: s(r.ref_host), sessions: n0(r.sessions), cls: classifyHost(r.ref_host) }));
  const utms = arr(d.utm).map((r) => ({ src: s(r.utm_source), medium: s(r.utm_medium), campaign: s(r.utm_campaign), sessions: n0(r.sessions), cls: classifyHost(r.utm_source) }));
  const out = h('div', { class: 'stack' });
  out.appendChild(h('div', { class: 'state' },
    h('h2', { text: 'What is connected, and what is not' }),
    h('p', { text: 'Connected: the referrer host of each visit, as recorded by this site. Not connected yet: Google Search Console (queries, impressions, clicks, average position) and Bing Webmaster Tools. No query terms are shown here because search engines do not pass them in the referrer, and nothing below is filled in from elsewhere.' }),
    h('p', { text: 'AI assistants appear here only when the assistant sends a referrer or a campaign tag. Visits from assistants that send neither are counted under Direct or unknown in Where from.' })));
  if (!total) { out.appendChild(empty('No visits in this period', 'Try a longer period.')); return h('div', null, scopeLine(d), out); }
  const searchCh = byCh('search'), aiCh = byCh('ai');
  out.appendChild(table({
    id: 'search-summary', title: 'Visits by search engines and AI assistants', csvName: 'search-ai-summary',
    cols: [
      { key: 'k', label: 'Group', get: (r) => r.label },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => r.sessions },
      { key: 'share', label: 'Share of all visits', num: true, get: (r) => r.sessions / total, cell: (r) => rateCell(r.sessions, total), csv: (r) => rate(r.sessions, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
    ],
    rows: [
      { label: 'Search engines (referrer)', sessions: n0(searchCh && searchCh.sessions) },
      { label: 'AI assistants (referrer)', sessions: n0(aiCh && aiCh.sessions) },
    ], sort: null,
  }));
  const refCols = (id) => [
    { key: 'host', label: 'Host', get: (r) => r.host, wrap: true },
    { key: 'sessions', label: 'Visits', num: true, get: (r) => r.sessions },
    { key: 'share', label: 'Share of all visits', num: true, get: (r) => r.sessions / total, cell: (r) => rateCell(r.sessions, total), csv: (r) => rate(r.sessions, total).pct, csvExtra: [{ label: 'share_sample_n', get: () => total }] },
  ];
  out.appendChild(table({ id: 'search-engines', title: 'Search engine referrers', csvName: 'search-engines', limitNote: 'From the top 25 referrer hosts only.', empty: 'No search engine referrer among the top 25 hosts.', cols: refCols(), rows: refs.filter((r) => r.cls === 'search'), sort: { key: 'sessions', dir: 'desc' } }));
  out.appendChild(table({ id: 'search-ai', title: 'AI assistant referrers', csvName: 'ai-assistants', limitNote: 'From the top 25 referrer hosts only.', empty: 'No AI assistant referrer among the top 25 hosts.', cols: refCols(), rows: refs.filter((r) => r.cls === 'ai'), sort: { key: 'sessions', dir: 'desc' } }));
  out.appendChild(table({
    id: 'search-utm', title: 'Visits tagged by an assistant or search engine', csvName: 'search-ai-utm', limitNote: 'From campaign tags on arrival, which Where from files under UTM source rather than AI.',
    empty: 'No tagged visit names an assistant or a search engine.',
    cols: [
      { key: 'src', label: 'Source tag', get: (r) => r.src, wrap: true }, { key: 'kind', label: 'Group', get: (r) => (r.cls === 'ai' ? 'AI assistant' : 'Search engine') },
      { key: 'medium', label: 'Medium tag', get: (r) => r.medium }, { key: 'campaign', label: 'Campaign tag', get: (r) => r.campaign },
      { key: 'sessions', label: 'Visits', num: true, get: (r) => r.sessions },
    ],
    rows: utms.filter((r) => r.cls === 'ai' || r.cls === 'search'), sort: { key: 'sessions', dir: 'desc' },
  }));
  return h('div', null, scopeLine(d), out);
}

// ======================================================================= Data health
export async function health(ctx) {
  const d = await ctx.get('health');
  const last = num(d.last_event_ts);
  const stale = last === null || Date.now() - last > 864e5;
  const out = h('div', { class: 'stack' });
  out.appendChild(h('div', null,
    facts([
      { label: 'Last event stored', value: last === null ? 'none' : fmtAge(last), sub: last === null ? 'the store has no events' : fmtTs(last, { seconds: true, year: true }) },
      { label: 'Events in 24 hours', value: fmtInt(d.events_24h) },
      { label: 'Visits in 24 hours', value: fmtInt(d.sessions_24h) },
    ]),
    stale ? note(last === null ? 'No event has ever been stored. Check that the site is sending events and that the ingest endpoint is deployed.' : 'No event in the last 24 hours. If the site had visitors, collection may have stopped: look at the ingest drops and the checks below.') : null));
  const cs = obj(d.consent);
  out.appendChild(h('section', { class: 'section', 'aria-labelledby': 'consent-h' },
    h('h2', { id: 'consent-h', text: 'Consent, last 30 days' }),
    facts([{ label: 'Notice shown', value: fmtInt(cs.shown) }, { label: 'Accepted', value: fmtInt(cs.granted) }, { label: 'Declined', value: fmtInt(cs.denied) }]),
    note('The consent rate is not measurable. Visitors who decline send nothing, and in the EEA nothing is sent before a choice, so these counts only show visitors who got far enough to be recorded. No rate is worked out from them.')));
  out.appendChild(table({
    id: 'health-checks', title: 'Scheduled checks', csvName: 'health-checks', limitNote: 'The latest 40 results from the scheduled worker.', empty: 'No checks have run yet. The scheduled worker writes them.',
    cols: [
      { key: 'ts', label: 'When', get: (r) => num(r.ts), cell: (r) => fmtTs(r.ts, { seconds: true }), csv: (r) => (num(r.ts) === null ? '' : new Date(r.ts).toISOString()) },
      { key: 'check', label: 'Check', get: (r) => s(r.check_name), wrap: true },
      { key: 'status', label: 'Status', get: (r) => s(r.status), cell: (r) => { const st = s(r.status).toLowerCase(); return h('span', { class: 'tag ' + (st === 'ok' || st === 'pass' ? 'pos' : st === 'warn' || st === 'warning' ? 'warn' : st ? 'neg' : ''), text: clip(r.status, 24) || 'unknown' }); } },
      { key: 'detail', label: 'Detail', get: (r) => s(r.detail), wrap: true },
    ],
    rows: arr(d.checks), sort: { key: 'ts', dir: 'desc' },
  }));
  out.appendChild(table({
    id: 'health-ingest', title: 'Ingest drops and counters', csvName: 'health-ingest', limitNote: 'Aggregate counts of rejected or dropped batches. No visitor data.', empty: 'No ingest counters recorded.',
    cols: [
      { key: 'day', label: 'Day', get: (r) => s(r.day) }, { key: 'kind', label: 'Kind', get: (r) => s(r.kind), wrap: true },
      { key: 'detail', label: 'Detail', get: (r) => s(r.detail), wrap: true }, { key: 'n', label: 'Count', num: true, get: (r) => n0(r.n) },
    ],
    rows: arr(d.ingest), sort: { key: 'day', dir: 'desc' },
  }));
  const q = new URLSearchParams({ days: ctx.state.days === 'custom' ? '30' : ctx.state.days });
  if (ctx.state.owner || ctx.state.test) q.set('include', [ctx.state.owner ? 'owner' : '', ctx.state.test ? 'test' : ''].filter(Boolean).join(','));
  out.appendChild(h('section', { class: 'section', 'aria-labelledby': 'raw-h' },
    h('h2', { id: 'raw-h', text: 'Raw tables' }),
    h('p', { class: 'hint', text: 'Full exports straight from the store, up to 50,000 rows each. Opening one downloads a CSV file.' }),
    h('ul', { id: 'raw-list' }, ['events', 'sessions', 'link_clicks', 'links', 'daily_rollup', 'cursor_bins'].map((t) => h('li', null, h('a', { href: `/api/ops/csv?table=${t}&${q}`, download: t + '.csv', text: t + '.csv' }))))));
  return h('div', null, scopeLine(d, 'Health figures use fixed windows (24 hours and 30 days), so the period picker does not apply.', true), out);
}

export const VIEWS = {
  live: { label: 'Live', fn: live, period: false, owner: true, test: true, why: 'Live always shows the last 30 minutes.' },
  where: { label: 'Where from', fn: where, period: true, owner: true, test: true },
  links: { label: 'Links', fn: links, period: true, owner: true, test: true },
  pages: { label: 'Pages and time', fn: pages, period: true, owner: true, test: true },
  buttons: { label: 'Buttons', fn: buttons, period: true, owner: true, test: true },
  heatmap: { label: 'Heatmap', fn: heatmap, period: true, owner: false, test: true, whyOwner: 'Owner traffic is never binned for the heatmap.' },
  visits: { label: 'Visits', fn: visits, period: true, owner: true, test: true, whyArg: 'A single visit is shown whatever the scope.' },
  demos: { label: 'Demos', fn: demos, period: true, owner: true, test: true },
  forms: { label: 'Forms', fn: forms, period: true, owner: true, test: true },
  ghost: { label: 'Auto cursor', fn: ghost, period: true, owner: true, test: true },
  search: { label: 'Search and AI assistants', fn: search, period: true, owner: true, test: true },
  health: { label: 'Data health', fn: health, period: false, owner: true, test: true, why: 'Health figures cover fixed windows.' },
};
