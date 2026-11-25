// Helpers for /api/ops/* endpoints. All SQL is a constant string with bound
// parameters. Only fixed fragments from this file are ever concatenated.
import { json } from './http.js';

export function rangeOf(url) {
  const now = Date.now();
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10) || 7, 1), 430);
  let from = now - days * 864e5;
  let to = now + 1;
  const f = Number(url.searchParams.get('from'));
  const t = Number(url.searchParams.get('to'));
  if (Number.isFinite(f) && f > 0) from = f;
  if (Number.isFinite(t) && t > 0) to = t;
  return { from, to, days };
}

// Owner and test rows are excluded unless include=owner,test is passed.
export function scopeOf(url) {
  const inc = (url.searchParams.get('include') || '').split(',');
  const owner = inc.includes('owner');
  const test = inc.includes('test');
  const where = (a = '') => [owner ? '' : `${a}owner = 0`, test ? '' : `${a}test = ''`].filter(Boolean).join(' AND ') || '1=1';
  return { owner, test, where };
}

// Device filter for tables that carry a device column (events, sessions). The value is validated against a fixed list and
// always travels as a bound parameter. idx is the number of the next free ?N placeholder. An unknown value is a 400, never ignored,
// so a typo cannot silently show unfiltered numbers as if they were filtered.
export const DEVICES = ['desktop', 'mobile', 'tablet'];
export function deviceFilter(url, idx, col = 'device') {
  const d = url.searchParams.get('device');
  if (d === null || d === '') return { ok: true, value: null, sql: '', binds: [] };
  if (!DEVICES.includes(d)) return { ok: false, value: null, sql: '', binds: [] };
  return { ok: true, value: d, sql: ` AND ${col} = ?${idx}`, binds: [d] };
}
export const badDevice = () => json({ error: 'device', hint: 'desktop, mobile or tablet' }, 400);

export async function all(env, sql, binds = []) {
  const r = await env.DB.prepare(sql).bind(...binds).all();
  return r.results || [];
}
export async function one(env, sql, binds = []) {
  return (await env.DB.prepare(sql).bind(...binds).first()) || {};
}

// device: the device filter this endpoint really applied (or null). It is echoed in scope so a view can say what it shows,
// and it is never echoed for an endpoint that ignores the parameter.
export function reply(url, data, device = null) {
  const { from, to } = rangeOf(url);
  const s = scopeOf(url);
  return json({ range: { from, to }, scope: { owner: s.owner, test: s.test, device: DEVICES.includes(device) ? device : null }, ...data });
}

export function pathParam(url) {
  const p = url.searchParams.get('path');
  return p && /^\/[A-Za-z0-9_.~%+\-\/]{0,199}$/.test(p) ? p : null;
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- channels ----------
// One list drives the JS classifier and the SQL one, so they cannot drift apart. Every entry matches anywhere in the host
// (a search entry must be followed by a dot, so google. matches google.it). This is the same substring rule the old regexes had:
// it means t.co also matches microsoft.com. That is a known limit, reported and not changed here.
// Order of decision: tracked link, then an assistant named in utm_source, then any other utm_source, then the referrer host.
const AI_KEYWORDS = ['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot', 'you.com', 'phind'];
const SEARCH_DOTS = ['google', 'bing', 'duckduckgo', 'ecosia', 'yahoo', 'brave', 'yandex', 'baidu', 'startpage'];
const SOCIAL_KEYWORDS = ['linkedin', 'lnkd.in', 'facebook', 'instagram', 'twitter', 'x.com', 't.co', 'reddit', 'threads', 'bsky', 'youtube'];

const lc = (v) => String(v == null ? '' : v).toLowerCase();
export const isAiHost = (v) => { const h = lc(v); return !!h && AI_KEYWORDS.some((k) => h.includes(k)); };
export const isSearchHost = (v) => { const h = lc(v); return !!h && SEARCH_DOTS.some((k) => h.includes(k + '.')); };
const isSocialHost = (h) => SOCIAL_KEYWORDS.some((k) => h.includes(k));

export function channelOf(s) {
  if (s.link) return 'link:' + s.link.split('-')[0];
  if (s.utm_source) return isAiHost(s.utm_source) ? 'ai' : 'utm:' + s.utm_source;
  const h = lc(s.ref_host);
  if (!h) return 'direct';
  if (isAiHost(h)) return 'ai';
  if (isSearchHost(h)) return 'search';
  if (isSocialHost(h)) return 'social';
  return 'referral';
}

// The same rules as SQL. Only fixed fragments built from the constant lists above, never request data.
const likeAny = (col, kws, tail = '') => '(' + kws.map((k) => `(LOWER(${col})${tail}) LIKE '%${k}%'`).join(' OR ') + ')';
export const AI_SQL = (col) => likeAny(col, AI_KEYWORDS);
// A bare tag such as utm_source=google names a search engine too, so tags are matched with a dot appended (the Search view does the same).
export const SEARCH_SQL = (col, tag = false) => likeAny(col, SEARCH_DOTS.map((k) => k + '.'), tag ? " || '.'" : '');
const SOCIAL_SQL = (col) => likeAny(col, SOCIAL_KEYWORDS);
export const CHANNEL_SQL = `CASE
  WHEN link IS NOT NULL AND link <> '' THEN 'link:' || CASE WHEN instr(link, '-') > 0 THEN substr(link, 1, instr(link, '-') - 1) ELSE link END
  WHEN utm_source IS NOT NULL AND utm_source <> '' THEN CASE WHEN ${AI_SQL('utm_source')} THEN 'ai' ELSE 'utm:' || utm_source END
  WHEN ref_host IS NULL OR ref_host = '' THEN 'direct'
  WHEN ${AI_SQL('ref_host')} THEN 'ai'
  WHEN ${SEARCH_SQL('ref_host')} THEN 'search'
  WHEN ${SOCIAL_SQL('ref_host')} THEN 'social'
  ELSE 'referral' END`;
