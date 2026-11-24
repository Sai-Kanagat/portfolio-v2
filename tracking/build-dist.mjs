#!/usr/bin/env node
// Builds dist/ for Cloudflare Pages: copies only publishable site files.
// The repo is public, so tests, docs, the GTM export, analytics tooling and
// anything private never reach the served site. Walks the filesystem (not git)
// so untracked new pages such as 404.html and js/track.js are included.
//
// Usage: node tracking/build-dist.mjs [--out dist] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'dist');
const QUIET = args.includes('--quiet');

// Never published, matched against the first path segment (or any file name).
const DENY_TOP = new Set([
  '.git', '.github', '.claude', '.wrangler', '.netlify', '.gstack', '.vscode', '.idea',
  'node_modules', 'dist', 'functions', 'migrations', 'workers', 'tools', 'tracking', 'tests',
  '_gtm', 'syndication', 'social-kit',
  'package.json', 'package-lock.json', 'wrangler.toml', 'README.md', 'CLAUDE.md', 'DESIGN.md', '.gitignore',
]);
const DENY_NAME = /^(\.DS_Store|\.dev\.vars.*|\.env.*|.*\.log|.*\.map|.*\.md|.*\.sqlite3?|.*\.pem|.*\.key|.*\.sh|Thumbs\.db)$/i;
const DENY_SEGMENT = new Set(['node_modules', '.git', '.wrangler', '__tests__']);

const files = [];
const skipped = [];
(function walk(dir, rel) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isSymbolicLink()) {
      skipped.push(r + ' (symlink)');
      continue;
    }
    if (!rel && DENY_TOP.has(ent.name)) {
      skipped.push(r);
      continue;
    }
    if (ent.isDirectory()) {
      if (DENY_SEGMENT.has(ent.name)) {
        skipped.push(r);
        continue;
      }
      walk(path.join(dir, ent.name), r);
    } else if (ent.isFile()) {
      if (DENY_NAME.test(ent.name)) {
        skipped.push(r);
        continue;
      }
      files.push(r);
    }
  }
})(ROOT, '');

if (path.relative(ROOT, OUT).startsWith('..') || OUT === ROOT) {
  console.error('refusing to write outside the repo or onto it:', OUT);
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
const MAX = 25 * 1024 * 1024;
for (const f of files) {
  const dest = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), dest);
  const size = fs.statSync(dest).size;
  bytes += size;
  if (size > MAX) console.warn('WARNING over Pages 25 MiB file limit:', f, size);
}
if (files.length > 20000) console.warn('WARNING over Pages 20000 file limit:', files.length);

// _routes.json: run Functions only for pages and API, never for static assets.
const exclude = new Set();
const topDirs = new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
for (const d of topDirs) {
  const hasHtml = files.some((f) => f.startsWith(d + '/') && /\.html?$/i.test(f));
  if (!hasHtml) exclude.add(`/${d}/*`);
}
['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a', 'pdf', 'pptx', 'docx', 'glb', 'gltf', 'wasm', 'css', 'js', 'mjs', 'txt', 'xml', 'webmanifest'].forEach((e) => exclude.add(`/*.${e}`));
const routes = { version: 1, include: ['/*'], exclude: [...exclude].sort() };
if (routes.exclude.length > 99) {
  console.error('too many _routes.json exclude rules:', routes.exclude.length);
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, '_routes.json'), JSON.stringify(routes, null, 2) + '\n');

if (!QUIET) {
  console.log(`dist: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB -> ${path.relative(ROOT, OUT) || '.'}`);
  console.log(`skipped (not publishable): ${skipped.length}`);
  for (const s of skipped.sort()) console.log('  - ' + s);
  console.log(`_routes.json: exclude ${routes.exclude.length} patterns`);
}
