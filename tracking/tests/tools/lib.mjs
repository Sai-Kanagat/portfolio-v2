// Shared helpers for the tools tests: static server, stub window.sk, event formatting and matching.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pwRequire as require } from '../pw.mjs';
export const { chromium } = require('playwright');
export const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

export async function serve() {
  const srv = http.createServer((q, s) => {
    let p = path.normalize(decodeURIComponent(q.url.split('?')[0]));
    let f = path.join(root, p);
    if (f !== root && !f.startsWith(root + path.sep)) { s.writeHead(403); return s.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) { s.writeHead(404); return s.end('404'); }
    s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(s);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

// Records every call. window.sk is defined with a getter so a real track.js cannot replace the stub.
export const STUB = `(() => {
  window.__ev = [];
  const rec = (m, a) => { try { window.__ev.push({ m, a: JSON.parse(JSON.stringify(a)) }); } catch (e) {} };
  const mode = window.__stubMode || 'record';
  const sk = {
    consent: 'granted',
    demo: (...a) => { rec('demo', a); if (mode === 'throw') throw new Error('stub'); },
    track: (...a) => { rec('track', a); if (mode === 'throw') throw new Error('stub'); },
    model: (...a) => { rec('model', a); if (mode === 'throw') throw new Error('stub'); },
    media: (...a) => rec('media', a), form: (...a) => rec('form', a),
    len: n => (n <= 0 ? '0' : n <= 20 ? '1-20' : n <= 80 ? '21-80' : n <= 300 ? '81-300' : '300+'),
    count: n => (n <= 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : '21+'),
    haunt() {}
  };
  if (mode !== 'none') Object.defineProperty(window, 'sk', { get: () => sk, set: () => {}, configurable: true });
})();`;

export const FAKE_JSPDF = `window.jspdf={jsPDF:function(){return new Proxy({}, {get:(t,k)=>k==='splitTextToSize'?(s)=>[String(s)]:k==='getNumberOfPages'?()=>1:()=>({})});}};`;

const LIFE_TRACK = new Set(['demo_open', 'demo_start', 'demo_engaged', 'demo_end']);
const LIFE_DEMO = new Set(['first_interaction', 'return_visit']);
const fmtP = p => {
  const parts = [];
  for (const k of ['item', 'bucket', 'value']) if (p && p[k] !== undefined) parts.push(`${k}=${p[k]}`);
  if (p && typeof p.ms === 'number') parts.push('ms');
  return parts.length ? `[${parts.join(',')}]` : '';
};
export function format(e) {
  if (e.m === 'demo') { const [, action, p] = e.a; return { life: LIFE_DEMO.has(action), s: action + fmtP(p), raw: e }; }
  if (e.m === 'track') {
    const [name, p] = e.a; const q = { ...(p || {}) }; delete q.demo_id;
    const parts = Object.keys(q).filter(k => k !== 'ms').map(k => `${k}=${q[k]}`);
    if (typeof q.ms === 'number') parts.push('ms');
    return { life: LIFE_TRACK.has(name), s: `track:${name}${parts.length ? '[' + parts.join(',') + ']' : ''}`, raw: e };
  }
  if (e.m === 'model') { const [, state, p] = e.a; return { life: false, s: `model:${state}` + (p && typeof p.ms === 'number' ? '[ms,delegate=' + p.delegate + ']' : ''), raw: e }; }
  return { life: false, s: `${e.m}:?`, raw: e };
}

// Returns null when expected and actual agree, else a message.
export function compare(expected, actual) {
  const pool = [...actual];
  const miss = [];
  for (const ex of expected) {
    let optional = false, pat = ex;
    if (pat.startsWith('opt:')) { optional = true; pat = pat.slice(4); }
    const test = pat.startsWith('re:') ? (s => new RegExp(pat.slice(3)).test(s)) : (s => s === pat);
    const i = pool.findIndex(test);
    if (i >= 0) pool.splice(i, 1); else if (!optional) miss.push(ex);
  }
  if (!miss.length && !pool.length) return null;
  return `missing [${miss.join(' | ')}] extra [${pool.join(' | ')}] got [${actual.join(' | ')}]`;
}

export const CANARY = n => ('CANARY' + 'abcdefghijklmnopqrstuvwxyz0123456789').slice(0, n);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
