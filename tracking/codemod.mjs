#!/usr/bin/env node
// Idempotent page codemod for the tracking build. No dependencies, no build step.
//
//   node tracking/codemod.mjs --root /abs/tree            apply to every page this build owns (plus new pages)
//   ... --all     also head tags on pages other agents own (media, tools, 404)
//   ... --check   change nothing, exit 1 if any page would change
//   ... a.html b.html   limit to these pages (paths relative to the root)
// --root is required and must be absolute: the tool never guesses which tree to write to.
//
// What it does to each page, and running it twice gives no diff:
//   1. adds the standard head snippet (consent mode default, GTM) when a page has none
//   2. sets window.SK_CLARITY_ID before consent.js, and gives consent.js and analytics.js a
//      content-hash ?v= query (analytics.js passes its query on to track.js, so that hash covers both)
//   3. adds stable data-track ids to static controls and data-zone / data-section to containers
//   4. stamps data-page-type on <html>
// It never edits copy or look. It never touches markup that JavaScript builds at runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLARITY_ID = 'zir45wg6mm';

// Pages other agents own. They are only touched with --all.
export const OTHER_OWNERS = [
  /^404\.html$/,
  /^demos\/(hands|balls|audio|agora|poster|roas)\.html$/,
  /^(shadow-theatre|melt|cortex|ad-autopsy|positioning|hire)\/index\.html$/,
];
const NOT_PAGES = [/^agency-os-/, /^google[0-9a-f]+\.html$/, /^(node_modules|dist|tracking|functions|workers|tools|ops|_gtm|assets|syndication|social-kit|\.wrangler|\.git)\//];

// Repeated items that are viewed rather than clicked get data-section so js/track.js times them (section_view).
// cls: the class on the element; prefix: id prefix; from: 'href' names the item after its link, otherwise a counter.
export const ITEM_RULES = {
  'about.html': [{ cls: 'timeline-item', prefix: 'timeline' }, { cls: 'cert-card', prefix: 'cert' }],
  'process.html': [{ cls: 'process-step', prefix: 'step' }],
  'demos.html': [{ cls: 'demo-tile', prefix: 'tile', from: 'href' }],
};

const NAME_TOKENS = /(^|-)(sai|kanagat|prathyaksh|saikanagat)(-|$)|kanagat/;
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea', 'title']);

// ---------- page type: the same names js/track.js derives, hyphenated because track.js slugs the attribute ----------
export function pageType(rel) {
  rel = rel.replace(/\\/g, '/');
  if (rel === '404.html') return 'not-found';
  const p = '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '');
  if (p === '/') return 'home';
  const m = p.match(/^\/([^/]+)(\/.+)?$/), f = m ? m[1] : '', sub = m && m[2];
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
}

// ---------- listing pages ----------
export function listPages(root, { all = false } = {}) {
  let files = [];
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z', '--', '*.html'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => {
      const r = d ? d + '/' + e.name : e.name;
      if (e.isDirectory()) return /^(node_modules|\.git|dist)$/.test(e.name) ? [] : walk(r);
      return /\.html$/.test(e.name) ? [r] : [];
    });
    files = walk('');
  }
  return [...new Set(files)].filter((f) => !NOT_PAGES.some((r) => r.test(f)) && fs.existsSync(path.join(root, f)))
    .filter((f) => all || !OTHER_OWNERS.some((r) => r.test(f))).sort();
}

// ---------- the standard head snippet (kept as it is on the existing pages, minus dashes in comments) ----------
const GTM_ID = 'GTM-MRGXD7ZC';
const HEAD_SNIPPET = `  <!-- Consent Mode v2 default: denied inside EEA, UK and Switzerland, granted elsewhere -->
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
// Default: granted everywhere outside the regions below
gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'granted','functionality_storage':'granted','security_storage':'granted','wait_for_update':500});
// Override: denied for EEA, UK and Switzerland until the visitor accepts
gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied','region':['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB','CH'],'wait_for_update':500});
try{if(localStorage.getItem('sk_consent')==='denied'&&!localStorage.getItem('sk_consent_v2')){localStorage.setItem('sk_consent_v2','denied');}localStorage.removeItem('sk_consent');var c=localStorage.getItem('sk_consent_v2');if(c==='granted'){gtag('consent','update',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'granted'});}else if(c==='denied'){gtag('consent','update',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'});}}catch(e){}</script>
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- End Google Tag Manager -->
`;
const BODY_SNIPPET = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
`;

// ---------- tokenizer ----------
const START = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(s) {
  const a = {};
  for (const m of s.matchAll(ATTR)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}
function* tokens(src) {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { yield { t: 'text', s: i, e: n }; return; }
    if (lt > i) yield { t: 'text', s: i, e: lt };
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; yield { t: 'comment', s: lt, e: i }; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; yield { t: 'decl', s: lt, e: i }; continue; }
    if (src[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(lt, lt + 80));
      if (m) { i = lt + m[0].length; yield { t: 'end', name: m[1].toLowerCase(), s: lt, e: i }; continue; }
      yield { t: 'text', s: lt, e: lt + 2 }; i = lt + 2; continue;
    }
    START.lastIndex = lt;
    const m = START.exec(src);
    if (!m) { yield { t: 'text', s: lt, e: lt + 1 }; i = lt + 1; continue; }
    const name = m[1].toLowerCase();
    const tok = { t: 'start', name, s: lt, e: lt + m[0].length, insertAt: lt + 1 + m[1].length + m[2].length, attrs: parseAttrs(m[2]), self: m[3] === '/' };
    yield tok;
    i = tok.e;
    if (RAW.has(name) && !tok.self) {
      const close = new RegExp('</' + name + '\\b', 'i'); close.lastIndex = 0;
      const rest = src.slice(i), c = rest.search(close);
      const e = c < 0 ? n : i + c;
      if (e > i) yield { t: 'raw', name, s: i, e };
      i = e;
    }
  }
}

// ---------- naming ----------
const kebab = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function slug(s, max = 28) {
  let o = norm(s).toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (o.length > max) { o = o.slice(0, max); const k = o.lastIndexOf('-'); if (k > 8) o = o.slice(0, k); o = o.replace(/-+$/, ''); }
  return o;
}
// A usable label: no addresses, no personal names, something to read.
const clean = (s, max) => { s = String(s || ''); if (/@|https?:/i.test(s)) return ''; const o = slug(s, max); return !o || NAME_TOKENS.test(o) || /^\d+$/.test(o) ? '' : o; };
function hrefName(h) {
  h = String(h || '').trim();
  if (!h) return '';
  if (/^mailto:/i.test(h)) return 'email';
  if (/^tel:/i.test(h)) return 'phone';
  if (h[0] === '#') return h.length > 1 ? 'jump-' + clean(h.slice(1), 20) : '';
  if (/^javascript:/i.test(h)) return '';
  let host = '', p = h;
  const m = /^(?:https?:)?\/\/([^/?#]+)([^?#]*)/i.exec(h);
  if (m) { host = m[1].toLowerCase().replace(/^www\./, ''); p = m[2]; if (/(^|\.)saikanagat\.com$/.test(host)) host = ''; }
  p = p.split(/[?#]/)[0].replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\/+$/, '');
  let seg = p.split('/').filter(Boolean).pop() || '';
  if (seg === 'index') seg = '';
  if (host) return clean(host.split('.').slice(0, -1).pop() || host, 20) || 'external';
  const hash = /#(.+)$/.exec(h);
  const base = clean(seg, 24) || (h.split(/[?#]/)[0].replace(/\/+$/, '') === '' || /^(\.\.?\/)*(index(\.html)?)?$/.test(h.split(/[?#]/)[0]) ? 'home' : '');
  return (base + (hash ? '-' + clean(hash[1], 16) : '')).replace(/^-+|-+$/g, '') || base;
}
const isControl = (name, a) => {
  if (name === 'a') return 'href' in a;
  if (name === 'button' || name === 'select' || name === 'textarea' || name === 'summary') return true;
  if (name === 'input') return (a.type || 'text').toLowerCase() !== 'hidden';
  if (/^(button|tab|link|menuitem|switch|checkbox)$/i.test(a.role || '')) return true;
  return 'onclick' in a || 'data-project' in a || 'data-filter' in a || 'data-city' in a;
};

// ---------- the element pass ----------
const HEADING = /^h[1-6]$/;
function elementPass(src, stats, rel) {
  const cands = [];                 // controls waiting for a name
  const conts = [];                 // containers that get data-zone and/or data-section
  const used = new Set();           // data-track ids already on the page
  const secUsed = new Set();
  const stack = [];                 // open elements
  const ROOT = { z: 'page' };
  const rules = ITEM_RULES[rel] || [], counts = {}, itemEdits = [];
  const top = () => stack[stack.length - 1];
  const inside = (names) => stack.some((r) => names.includes(r.name));
  function closeRec(r) {
    if (r.cand) { r.cand.text = r.text; r.cand.alt = r.alt; }
    if (r.headOf && !r.headOf.sec.name) r.headOf.sec.name = slug(kebab(r.text), 28);
  }
  function popTo(i) { while (stack.length > i) closeRec(stack.pop()); }
  for (const tk of tokens(src)) {
    if (tk.t === 'text') {
      for (const r of stack) if (r.want) r.text += src.slice(tk.s, tk.e).replace(/\s+/g, ' ');
      continue;
    }
    if (tk.t === 'end') {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === tk.name) { popTo(i); break; }
      continue;
    }
    if (tk.t !== 'start') continue;
    const a = tk.attrs, name = tk.name;
    if ('data-track' in a) used.add(a['data-track']);
    const parent = top();
    const noTrack = (parent && parent.noTrack) || 'data-no-track' in a;
    const rec = { name, noTrack, zrec: parent ? parent.zrec : ROOT, text: '', alt: '', want: false };
    if (!noTrack) {
      let z = null, cont = null;
      if ('data-zone' in a) { rec.zrec = { z: slug(a['data-zone'], 24) || 'page' }; }
      else if (name === 'nav') z = inside(['main', 'article']) ? 'subnav' : 'nav';
      else if (name === 'header' && !inside(['main', 'article', 'section'])) z = 'nav';
      else if (name === 'footer' && !inside(['article'])) z = 'footer';
      else if (name === 'article') z = 'article';
      else if (name === 'form' && a['data-form']) z = slug(a['data-form'], 24);
      else if (/^(aside|div|dialog)$/.test(name) && (a.role === 'dialog' || /(^|\s)project-panel(\s|$)/.test(a.class || '') || /(panel|modal|lightbox|drawer)$/i.test(a.id || ''))) z = /project-panel/.test(a.class || '') || /panel/i.test(a.id || '') ? 'panel' : slug(kebab(a.id || 'dialog'), 24);
      if (z) { cont = { pos: tk.insertAt, zone: z }; rec.zrec = { z }; conts.push(cont); }
      if (name === 'section') {
        const named = slug(kebab(a['data-section'] || a.id || (a.class || '').split(/\s+/)[0] || ''), 32);
        const hasZone = 'data-zone' in a;
        const sec = { name: named, needData: !('data-section' in a) && (!a.id || !inside(['main'])) };
        const zr = hasZone ? rec.zrec : { z: null };
        rec.zrec = zr; rec.sec = sec;
        conts.push({ pos: tk.insertAt, sec, zrec: zr, addZone: !hasZone });
      }
      for (const rl of rules) {
        if (!(' ' + (a.class || '') + ' ').includes(' ' + rl.cls + ' ') || 'data-section' in a) continue;
        const k = rl.from === 'href' ? (hrefName(a.href) || 'item') : String((counts[rl.cls] = (counts[rl.cls] || 0) + 1));
        let id = `${rl.prefix}-${k}`, u = id, n = 2;
        while (secUsed.has(u)) u = id + '-' + n++;
        secUsed.add(u); itemEdits.push({ pos: tk.insertAt, text: ` data-section="${u}"` }); stats.sections++;
      }
      if (HEADING.test(name)) {
        const owner = stack.slice().reverse().find((r) => r.sec && !r.sec.name);
        if (owner && !owner.headDone) { owner.headDone = true; rec.headOf = { sec: owner.sec }; rec.want = true; }
      }
      if (!('data-track' in a) && isControl(name, a)) {
        const c = { pos: tk.insertAt, name, a, zrec: rec.zrec, text: '', alt: '' };
        cands.push(c); rec.cand = c; rec.want = true;
      }
      if (name === 'img') for (const r of stack) if (r.want) r.alt += ' ' + (a.alt || '');
    }
    if (!VOID.has(name) && !tk.self) stack.push(rec);
    else closeRec(rec);
  }
  popTo(0);
  // sections: names, unique, then zone and section attributes
  let nsec = 0;
  const edits = new Map();
  const put = (pos, text) => edits.set(pos, (edits.get(pos) || '') + text);
  for (const c of conts) {
    if (c.sec) {
      const base = c.sec.name || 'section-' + ++nsec;
      let k = base, n = 2;
      while (secUsed.has(k)) k = base + '-' + n++;
      secUsed.add(k); c.sec.name = k;
      if (c.zrec.z === null) c.zrec.z = slug(k, 24);
      if (c.sec.needData) { put(c.pos, ` data-section="${k}"`); stats.sections++; }
      if (c.addZone) { put(c.pos, ` data-zone="${c.zrec.z}"`); stats.zones++; }
    } else { put(c.pos, ` data-zone="${c.zone}"`); stats.zones++; }
  }
  for (const e of itemEdits) put(e.pos, e.text);
  // names, in document order
  for (const c of cands) {
    const a = c.a, zone = c.zrec.z || 'page';
    let base = '';
    if ('data-project' in a) base = 'project-' + (clean(a['data-project'], 24) || 'item');
    else if ('data-filter' in a) base = 'filter-' + (clean(a['data-filter'], 24) || 'all');
    else if ('data-city' in a) base = 'city-' + (clean(a['data-city'], 24) || 'item');
    else if (c.name === 'input' && /^(submit|button|reset)$/i.test(a.type || '')) base = clean(a.value, 24) || clean(a.name || a.id, 24) || 'submit';
    else if (/^(input|select|textarea)$/.test(c.name)) base = clean(a.name || a.id, 24) || clean(a['aria-label'], 24) || (c.name === 'input' ? clean(a.type || 'text', 12) : c.name) || c.name;
    else if (c.name === 'a' && /^(mailto|tel):/i.test(a.href || '')) base = hrefName(a.href);
    else if (c.name === 'a' && a.href && !/^(#|javascript:)/i.test(a.href)) base = hrefName(a.href) || clean(a['aria-label'], 28) || clean(c.text, 28) || 'link';
    else base = clean(a['aria-label'], 28) || clean(c.text, 28) || clean(a.title, 28) || clean(c.alt, 28) || (c.name === 'a' ? hrefName(a.href) : '') || clean(a.id, 24) || c.name;
    let id = `${zone}.${base}`.slice(0, 60).replace(/[-.]+$/, '');
    let k = id, n = 2;
    while (used.has(k)) { const suf = '-' + n++; k = id.slice(0, 60 - suf.length) + suf; }
    used.add(k);
    put(c.pos, ` data-track="${k}"`);
    stats.tracked++;
  }
  let out = src;
  for (const pos of [...edits.keys()].sort((p, q) => q - p)) out = out.slice(0, pos) + edits.get(pos) + out.slice(pos);
  return out;
}

// ---------- head, scripts, page type ----------
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
export function versions(root) {
  const rd = (f) => { try { return fs.readFileSync(path.join(root, f)); } catch { return Buffer.alloc(0); } };
  return { consent: sha(rd('js/consent.js')), analytics: sha(Buffer.concat([rd('js/analytics.js'), rd('js/track.js')])) };
}
function headPass(src, rel, v, stats) {
  let out = src;
  // 1. page type on <html>
  const pt = pageType(rel);
  out = out.replace(/<html\b([^>]*)>/i, (m, at) => {
    if (/\sdata-page-type=/.test(at)) return m.replace(/(\sdata-page-type=)(["'])[^"']*\2/, `$1"${pt}"`);
    stats.pageType++;
    return `<html${at} data-page-type="${pt}">`;
  });
  // 2. standard head snippet and noscript
  if (!/googletagmanager\.com\/gtm\.js/.test(out)) { out = out.replace(/<head\b[^>]*>\n?/i, (m) => m + HEAD_SNIPPET); stats.head++; }
  if (!/googletagmanager\.com\/ns\.html/.test(out)) { out = out.replace(/<body\b[^>]*>\n?/i, (m) => m + BODY_SNIPPET); stats.head++; }
  // 3. consent.js and analytics.js tags with a content hash, SK_CLARITY_ID before consent.js
  const tag = (f) => new RegExp(`<script\\b[^>]*\\bsrc=["']([^"']*/)?${f}\\.js(?:\\?[^"']*)?["'][^>]*>\\s*</script>`, 'i');
  const prefix = (/<script\b[^>]*\bsrc=["']((?:\.\.\/|\/)?)js\//i.exec(out) || [0, '/'])[1];
  for (const [f, h] of [['consent', v.consent], ['analytics', v.analytics]]) {
    const re = tag(f);
    if (re.test(out)) out = out.replace(re, (m) => m.replace(new RegExp(`(\\b${f}\\.js)(\\?[^"']*)?(["'])`), `$1?v=${h}$3`));
    else { out = out.replace(/<\/body>/i, `<script src="${prefix || '/'}js/${f}.js?v=${h}" defer></script>\n</body>`); stats.scripts++; }
  }
  const idLine = `<script>window.SK_CLARITY_ID='${CLARITY_ID}';</script>`;
  if (/SK_CLARITY_ID/.test(out)) {
    out = out.replace(/(window\.SK_CLARITY_ID\s*=\s*)(['"])[^'"]*\2/, `$1'${CLARITY_ID}'`);
  } else {
    out = out.replace(/([ \t]*)(<script\b[^>]*\bsrc=["'][^"']*consent\.js[^>]*>)/i, (m, ws, t) => `${ws}${idLine}\n${ws}${t}`);
    stats.clarity++;
  }
  return out;
}

export function transform(rel, src, v, { headOnly = false } = {}) {
  const stats = { tracked: 0, zones: 0, sections: 0, pageType: 0, head: 0, scripts: 0, clarity: 0 };
  let out = headOnly ? src : elementPass(src, stats, rel);
  out = headPass(out, rel, v, stats);
  return { out, stats };
}

// ---------- CLI ----------
function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const ri = argv.indexOf('--root');
  if (ri < 0 || !argv[ri + 1] || !path.isAbsolute(argv[ri + 1])) {
    console.error('refusing to run: pass an explicit absolute tree, e.g. --root /Users/me/Code/portfolio-tracking');
    process.exit(2);
  }
  const root = path.resolve(argv[ri + 1]);
  const only = argv.filter((a, i) => !a.startsWith('--') && !(ri >= 0 && i === ri + 1));
  const pages = only.length ? only : listPages(root, { all: flag('--all') });
  const headOnly = (rel) => OTHER_OWNERS.some((r) => r.test(rel));
  const v = versions(root);
  let changed = 0;
  const tot = { tracked: 0, zones: 0, sections: 0, pageType: 0, head: 0, scripts: 0, clarity: 0 };
  for (const rel of pages) {
    const f = path.join(root, rel);
    const src = fs.readFileSync(f, 'utf8');
    const { out, stats } = transform(rel, src, v, { headOnly: headOnly(rel) });
    if (out === src) continue;
    changed++;
    for (const k in tot) tot[k] += stats[k];
    console.log(`${flag('--check') ? 'would change' : 'changed'} ${rel}: track +${stats.tracked}, zone +${stats.zones}, section +${stats.sections}${stats.pageType ? ', page-type' : ''}${stats.clarity ? ', clarity id' : ''}${stats.scripts ? ', script tags' : ''}${stats.head ? ', head snippet' : ''}`);
    if (!flag('--check')) fs.writeFileSync(f, out);
  }
  console.log(`${pages.length} pages, ${changed} ${flag('--check') ? 'would change' : 'changed'}; ` + Object.entries(tot).map(([k, n]) => `${k} ${n}`).join(', '));
  if (flag('--check') && changed) process.exit(1);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
