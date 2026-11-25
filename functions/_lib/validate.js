// Strict validation of the /api/e wire format (tracking/CONTRACT.md).
// Structure errors reject the whole batch. Bad values inside a known event drop
// only that parameter. Unknown events reject the whole batch. Unknown fields are
// dropped silently and never stored.
import { eventSpec, paramType, storesInD1 } from './catalogue.js';

export const MAX_BYTES = 32768;
export const MAX_EVENTS = 50;
const HEX16 = /^[0-9a-f]{16}$/;
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.:\-\/+]{0,79}$/u;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;
const PAGE_TYPE_RE = /^[a-z0-9_-]{1,32}$/;
const LINK_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UTM_RE = /^[A-Za-z0-9._~ +\-\/:]{1,64}$/;
const TEST_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PATH_BAD = /[^A-Za-z0-9_.~%+\-\/]/g;
const WEEK = 7 * 864e5;
const DEVICES = ['desktop', 'mobile', 'tablet'];

class Reject extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Path only: strip query and hash, replace anything outside a safe set.
export function cleanPath(s, max = 200) {
  if (typeof s !== 'string' || s.length === 0 || s[0] !== '/') return null;
  let p = s.split('#')[0].split('?')[0];
  if (p.includes('@')) return null;
  p = p.replace(PATH_BAD, '_').slice(0, max);
  return p || null;
}

function cleanNum(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12 ? Math.round(v * 1000) / 1000 : undefined;
}

function cleanId(v) {
  return typeof v === 'string' && ID_RE.test(v) ? v : undefined;
}

// cells: array of [x,y], {x,y} or "x,y" tokens, or one string of tokens
// separated by ; | or spaces. Returns up to 16 integer pairs in 0..255.
export function parseCells(v) {
  let items = [];
  if (typeof v === 'string') items = v.trim().split(/[;|\s]+/);
  else if (Array.isArray(v)) items = v;
  else return [];
  const out = [];
  for (const it of items.slice(0, 16)) {
    let x, y;
    if (Array.isArray(it)) [x, y] = it;
    else if (isObj(it)) ({ x, y } = it);
    else if (typeof it === 'string') {
      const m = /^(\d{1,3})[,.:_](\d{1,3})$/.exec(it);
      if (m) [x, y] = [Number(m[1]), Number(m[2])];
    }
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x <= 255 && y <= 255) out.push([x, y]);
  }
  return out;
}

function cleanParam(type, v) {
  switch (type) {
    case 'num':
      return cleanNum(v);
    case 'numid': {
      const n = cleanNum(v);
      return n !== undefined ? n : cleanId(v);
    }
    case 'path':
      return cleanPath(v, 120) || undefined;
    case 'host':
      return typeof v === 'string' && HOST_RE.test(v.toLowerCase()) ? v.toLowerCase() : undefined;
    case 'ext':
      return typeof v === 'string' && EXT_RE.test(v.toLowerCase()) ? v.toLowerCase() : undefined;
    case 'cells': {
      const c = parseCells(v);
      return c.length ? c : undefined;
    }
    case 'str':
      return cleanId(v);
    default: {
      if (typeof v === 'boolean') return v;
      const n = cleanNum(v);
      return n !== undefined ? n : cleanId(v);
    }
  }
}

function cleanCtx(ctx) {
  if (!isObj(ctx)) throw new Reject('ctx');
  const path = cleanPath(ctx.path);
  if (!path) throw new Reject('path');
  const utm = {};
  if (isObj(ctx.utm)) {
    for (const k of ['source', 'medium', 'campaign', 'content']) {
      const val = ctx.utm[k] ?? ctx.utm['utm_' + k];
      if (typeof val === 'string' && UTM_RE.test(val)) utm[k] = val.slice(0, 64);
    }
  }
  const lang = typeof ctx.lang === 'string' ? ctx.lang.slice(0, 2).toLowerCase() : '';
  let test = '';
  if (typeof ctx.test === 'string' && TEST_RE.test(ctx.test)) test = ctx.test;
  else if (ctx.test === true || ctx.test === 1) test = 'test';
  let refHost = null;
  if (typeof ctx.ref_host === 'string' && HOST_RE.test(ctx.ref_host.toLowerCase())) refHost = ctx.ref_host.toLowerCase();
  return {
    path,
    page_type: typeof ctx.page_type === 'string' && PAGE_TYPE_RE.test(ctx.page_type) ? ctx.page_type : null,
    lang: /^[a-z]{2}$/.test(lang) ? lang : null,
    device: DEVICES.includes(ctx.device) ? ctx.device : null,
    ref_host: refHost,
    link: typeof ctx.link === 'string' && LINK_RE.test(ctx.link) ? ctx.link : null,
    utm,
    owner: ctx.owner === true || ctx.owner === 1 ? 1 : 0,
    test,
  };
}

// Returns { ctx, vid, sid, pid, events:[{n,t,params}] } or throws Reject.
export function validateBatch(body, now = Date.now()) {
  if (!isObj(body)) throw new Reject('body');
  if (body.v !== 1) throw new Reject('version');
  for (const k of ['vid', 'sid', 'pid']) if (typeof body[k] !== 'string' || !HEX16.test(body[k])) throw new Reject(k);
  const ctx = cleanCtx(body.ctx);
  if (!Array.isArray(body.ev) || body.ev.length === 0 || body.ev.length > MAX_EVENTS) throw new Reject('ev');
  const events = [];
  for (const e of body.ev) {
    if (!isObj(e) || typeof e.n !== 'string') throw new Reject('event');
    const spec = eventSpec(e.n);
    if (!spec) {
      const err = new Reject('unknown_event');
      err.detail = /^[a-z0-9_]{1,40}$/.test(e.n) ? e.n : 'invalid_name';
      throw err;
    }
    if (typeof e.t !== 'number' || !Number.isFinite(e.t)) throw new Reject('time');
    const t = e.t >= now - WEEK && e.t <= now + 5 * 60000 ? Math.floor(e.t) : now;
    const params = {};
    if (isObj(e.p)) {
      for (const name of spec.params) {
        if (!Object.prototype.hasOwnProperty.call(e.p, name)) continue;
        const v = cleanParam(paramType(name), e.p[name]);
        if (v !== undefined) params[name] = v;
      }
    }
    events.push({ n: e.n, t, params, store: storesInD1(spec) });
  }
  return { vid: body.vid, sid: body.sid, pid: body.pid, ctx, events };
}

export { Reject };
