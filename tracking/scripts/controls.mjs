#!/usr/bin/env node
// Builds ops/controls.json: every known control (data-track id) and the page it lives on, so the Buttons view can show
// controls with zero clicks as 0 instead of leaving them out. Build time only, no network, no browser, read-only on its inputs.
//
//   node tracking/scripts/controls.mjs                     write ops/controls.json from tracking/coverage.json and tracking/maps/*.json
//   node tracking/scripts/controls.mjs --check             exit 1 if ops/controls.json is not what a fresh run would write (writes nothing)
//   options: --root=DIR   read DIR/tracking and write DIR/ops (default: the repository this script is in)
//            --out=FILE   write somewhere else
//
// Sources, all optional (a missing or unreadable file is skipped with a note on stderr, never an error):
//   tracking/coverage.json     crawler output: every control seen on every page, desktop and mobile, with its data-track id
//   tracking/maps/pages.json   hand maps for the site pages: controls[selector] and common.controls[selector]
//   tracking/maps/media.json   hand maps for the camera and mic demos
//   tracking/maps/tools.json   hand maps for the tools and the other demos: controls[id]
// A map entry marked "ignored" (display only, owned elsewhere) is left out, even if the crawler saw its id.
// common.controls of pages.json are not expanded to pages here: the crawler already lists them per page.
// The output has no timestamp, so running it twice on the same inputs writes the same bytes. Rerun it whenever the maps or coverage change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
// Only an exact [data-track=id] names a control. [data-track^=x], *=, ~= and the like are patterns, not controls, and are skipped.
// A map may write the last segment as alternatives, balls.swatch.green|red|blue: that is one id per alternative.
const TRACK_ATTR = /\[data-track\s*=\s*["']?([a-z0-9][a-z0-9._-]*(?:\|[a-z0-9][a-z0-9_-]*)*)["']?\s*\]/gi;

// File in the repository to the path a visitor's browser reports: index.html is /, dir/index.html is /dir/, x.html is /x (Pages drops .html).
export function pathOfPage(file) {
  const f = String(file).replace(/^\/+/, '');
  if (f === 'index.html') return '/';
  if (/(^|\/)index\.html$/.test(f)) return '/' + f.replace(/index\.html$/, '');
  return '/' + f.replace(/\.html$/, '');
}

function readJson(file, notes, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    notes.push(`${label}: ${e.code === 'ENOENT' ? 'not found' : 'unreadable (' + e.message.slice(0, 60) + ')'}, skipped`);
    return null;
  }
}

export function idsOfSelector(key) {
  const out = [];
  for (const m of String(key).matchAll(TRACK_ATTR)) {
    const [first, ...rest] = m[1].toLowerCase().split('|');
    out.push(first);
    const cut = first.lastIndexOf('.');
    for (const alt of rest) out.push((cut >= 0 ? first.slice(0, cut + 1) : '') + alt);
  }
  return out;
}
const isIgnored = (v) => !!(v && typeof v === 'object' && v.ignored);

export function buildControls(root) {
  const notes = [];
  const sources = { coverage: false, pages: false, media: false, tools: false };
  const map = new Map(); // path|id -> {id, zone, path, devices:Set, src:Set}
  const ignored = new Set(); // path|id
  let from = '';
  const add = (p, id, devices) => {
    if (!ID_RE.test(id)) { notes.push(`skipped an id that is not a valid data-track id: ${String(id).slice(0, 40)}`); return; }
    const k = p + '|' + id;
    const c = map.get(k) || { id, zone: id.split('.')[0], path: p, devices: new Set(), src: new Set() };
    c.src.add(from);
    for (const d of devices) c.devices.add(d);
    map.set(k, c);
  };
  const both = ['desktop', 'mobile'];

  const cov = readJson(path.join(root, 'tracking/coverage.json'), notes, 'tracking/coverage.json');
  const maps = {
    pages: readJson(path.join(root, 'tracking/maps/pages.json'), notes, 'tracking/maps/pages.json'),
    media: readJson(path.join(root, 'tracking/maps/media.json'), notes, 'tracking/maps/media.json'),
    tools: readJson(path.join(root, 'tracking/maps/tools.json'), notes, 'tracking/maps/tools.json'),
  };

  // Maps first, so ignored entries are known before coverage is read.
  from = 'pages';
  if (maps.pages && maps.pages.pages) {
    sources.pages = true;
    for (const [file, def] of Object.entries(maps.pages.pages)) {
      for (const [sel, v] of Object.entries((def && def.controls) || {})) {
        for (const id of idsOfSelector(sel)) { if (isIgnored(v)) ignored.add(pathOfPage(file) + '|' + id); else add(pathOfPage(file), id, both); }
      }
    }
    for (const [sel, v] of Object.entries((maps.pages.common && maps.pages.common.controls) || {})) {
      if (isIgnored(v)) for (const id of idsOfSelector(sel)) ignored.add('*|' + id);
    }
  }
  from = 'media';
  if (maps.media) {
    sources.media = true;
    for (const [file, def] of Object.entries(maps.media)) {
      if (file.startsWith('_') || !def || typeof def !== 'object') continue;
      for (const [sel, v] of Object.entries(def.controls || {})) {
        for (const id of idsOfSelector(sel)) { if (isIgnored(v)) ignored.add(pathOfPage(file) + '|' + id); else add(pathOfPage(file), id, both); }
      }
    }
  }
  from = 'tools';
  if (maps.tools && maps.tools.pages) {
    sources.tools = true;
    for (const [file, def] of Object.entries(maps.tools.pages)) {
      for (const [id, v] of Object.entries((def && def.controls) || {})) {
        const ids = idsOfSelector(id);
        for (const x of ids.length ? ids : [id]) { if (isIgnored(v)) ignored.add(pathOfPage(file) + '|' + x); else add(pathOfPage(file), x, both); }
      }
    }
  }
  from = 'coverage';
  if (cov && cov.pages) {
    sources.coverage = true;
    for (const [file, byDevice] of Object.entries(cov.pages)) {
      for (const [device, d] of Object.entries(byDevice || {})) {
        if (device !== 'desktop' && device !== 'mobile') continue;
        for (const c of (d && d.controls) || []) if (c && c.tr) add(pathOfPage(file), String(c.tr).toLowerCase(), [device]);
      }
    }
  }

  const controls = [...map.values()]
    .filter((c) => !ignored.has(c.path + '|' + c.id) && !ignored.has('*|' + c.id))
    .map((c) => ({ id: c.id, zone: c.zone, path: c.path, devices: [...c.devices].sort(), _src: c.src }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Per source: how many of the listed controls it knows about (a control in two sources counts in both). Read this to see which input is missing.
  const per = Object.fromEntries(Object.keys(sources).map((k) => [k, { found: sources[k], controls: controls.filter((c) => c._src.has(k)).length }]));
  for (const c of controls) delete c._src;
  const out = {
    version: 1,
    note: 'Every known control (data-track id) and its page. Built by tracking/scripts/controls.mjs from coverage.json and tracking/maps/*.json. A control added after the last build is missing until the script is rerun.',
    sources: per,
    counts: { controls: controls.length, pages: new Set(controls.map((c) => c.path)).size },
    controls,
  };
  return { out, notes };
}

export function render(out) { return JSON.stringify(out, null, 1) + '\n'; }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
  const root = path.resolve(opt('root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
  const dest = path.resolve(opt('out') || path.join(root, 'ops/controls.json'));
  const { out, notes } = buildControls(root);
  for (const n of notes) console.error('note: ' + n);
  const body = render(out);
  if (args.includes('--check')) {
    let cur = '';
    try { cur = fs.readFileSync(dest, 'utf8'); } catch { /* missing counts as stale */ }
    if (cur !== body) { console.error(`${path.relative(root, dest)} is stale: run node tracking/scripts/controls.mjs`); process.exit(1); }
    console.log(`${path.relative(root, dest)} is current: ${out.counts.controls} controls on ${out.counts.pages} pages`);
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  console.log(`wrote ${path.relative(root, dest)}: ${out.counts.controls} controls on ${out.counts.pages} pages (by source: ${Object.entries(out.sources).map(([k, v]) => `${k} ${v.found ? v.controls : 'missing'}`).join(', ')})`);
}
