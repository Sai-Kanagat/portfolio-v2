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

export function deviceFilter(url, col = 'device') {
  const d = url.searchParams.get('device');
  return ['desktop', 'mobile', 'tablet'].includes(d) ? { sql: ` AND ${col} = ?`, binds: [d] } : { sql: '', binds: [] };
}

export async function all(env, sql, binds = []) {
  const r = await env.DB.prepare(sql).bind(...binds).all();
  return r.results || [];
}
export async function one(env, sql, binds = []) {
  return (await env.DB.prepare(sql).bind(...binds).first()) || {};
}

export function reply(url, data) {
  const { from, to } = rangeOf(url);
  const s = scopeOf(url);
  return json({ range: { from, to }, scope: { owner: s.owner, test: s.test }, ...data });
}

export function pathParam(url) {
  const p = url.searchParams.get('path');
  return p && /^\/[A-Za-z0-9_.~%+\-\/]{0,199}$/.test(p) ? p : null;
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Channel grouping for sessions: link prefix, then UTM source, then referrer class.
export function channelOf(s) {
  if (s.link) return 'link:' + s.link.split('-')[0];
  if (s.utm_source) return 'utm:' + s.utm_source;
  const h = (s.ref_host || '').toLowerCase();
  if (!h) return 'direct';
  if (/(chatgpt|openai|perplexity|claude|gemini|copilot|you\.com|phind)/.test(h)) return 'ai';
  if (/(google|bing|duckduckgo|ecosia|yahoo|brave|yandex|baidu|startpage)\./.test(h)) return 'search';
  if (/(linkedin|lnkd\.in|facebook|instagram|twitter|x\.com|t\.co|reddit|threads|bsky|youtube)/.test(h)) return 'social';
  return 'referral';
}
