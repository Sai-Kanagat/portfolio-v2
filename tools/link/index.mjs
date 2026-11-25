#!/usr/bin/env node
// Link CLI for /go/<slug>. Talks to D1 (binding DB, remote name sk-events per wrangler.toml) through `wrangler d1 execute`. Local only by default.
//   node tools/link/index.mjs new <slug> --dest <url> [--campaign x] [--content x] [--app x] [--out dir] [--allow-name]
//   node tools/link/index.mjs list
//   node tools/link/index.mjs retire <slug>
//   node tools/link/index.mjs qr <slug> [--out dir]
// Flags: --persist <dir> local D1 state (default .wrangler/state); --remote needs --confirm-remote.
// SQL note: wrangler d1 execute has no bind parameters. Every value is validated against a
// strict allow list (slugs, labels) or parsed as an own-domain URL, then quoted with doubled
// single quotes, and wrangler is started with execFile and no shell. This is the one place
// SQL is not parameterised; everything under functions/ is.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import { SLUG_RE, LABEL_RE, CHANNELS, safeDest, personNameWarnings } from '../../functions/_lib/links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');
const PUBLIC_ORIGIN = 'https://saikanagat.com';

function parse(argv) {
  const pos = [], f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['allow-name', 'confirm-remote', 'remote', 'json'].includes(k)) f[k] = true;
      else f[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, f };
}
const die = (m) => { console.error('error: ' + m); process.exit(1); };
const lit = (s) => {
  if (s === null || s === undefined) return 'NULL';
  const v = String(s);
  if (/[\u0000-\u001f\u007f\\]/.test(v)) die('control or backslash characters are not allowed');
  return `'${v.replace(/'/g, "''")}'`;
};

function d1(sql, f) {
  const args = ['d1', 'execute', 'DB', '--json', '--command', sql];
  if (f.remote) {
    if (!f['confirm-remote']) die('--remote needs --confirm-remote');
    args.push('--remote');
  } else args.push('--local', '--persist-to', path.resolve(ROOT, f.persist || '.wrangler/state'));
  const out = execFileSync(WRANGLER, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return j[0] && j[0].results ? j[0].results : [];
}

export function qrSvg(url, scale = 8, margin = 4) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), size = (n + margin * 2) * scale;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>\n`;
}

export function qrPng(url, scale = 10, margin = 4) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), size = (n + margin * 2) * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const r = Math.floor(y / scale) - margin, c = Math.floor(x / scale) - margin;
      if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) raw[y * (size + 1) + 1 + x] = 0;
    }
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function qrDir(f) {
  // The registry is private: QR files go outside the repo by default.
  const dir = path.resolve(f.out || path.join(os.homedir(), 'saikanagat-analytics', 'qr'));
  if (!path.relative(ROOT, dir).startsWith('..')) die('refusing to write QR files inside the repo (public): ' + dir);
  return dir;
}

function writeQr(slug, f) {
  const dir = qrDir(f);
  fs.mkdirSync(dir, { recursive: true });
  const url = `${PUBLIC_ORIGIN}/go/${slug}`;
  fs.writeFileSync(path.join(dir, slug + '.svg'), qrSvg(url));
  fs.writeFileSync(path.join(dir, slug + '.png'), qrPng(url));
  return [path.join(dir, slug + '.svg'), path.join(dir, slug + '.png')];
}

function needSlug(s) {
  const slug = String(s || '').toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 64) die(`slug must start with ${CHANNELS.join(', ')} then lowercase words joined by "-", e.g. li-thallo-01`);
  return slug;
}

export function main(argv) {
  const { pos, f } = parse(argv);
  const [cmd, a] = pos;
  if (cmd === 'new') {
    const slug = needSlug(a);
    const dest = safeDest(f.dest);
    if (!dest) die('--dest must be https on saikanagat.com (or a subdomain) or a path starting with /');
    const labels = { campaign: f.campaign, content_label: f.content, app_label: f.app };
    for (const [k, v] of Object.entries(labels)) {
      if (v !== undefined && (!LABEL_RE.test(v) || v.length > 48)) die(`--${k === 'content_label' ? 'content' : k === 'app_label' ? 'app' : k} must be lowercase words joined by "-"`);
    }
    qrDir(f);
    const warn = personNameWarnings(labels.campaign, labels.content_label, labels.app_label, slug.split('-').slice(1).join(' '));
    if (warn.length && !f['allow-name']) { warn.forEach((w) => console.error('warning: ' + w)); die('refusing: pass --allow-name only if this is not a person'); }
    if (d1(`SELECT slug FROM links WHERE slug = ${lit(slug)}`, f).length) die('duplicate: ' + slug + ' already exists');
    d1(`INSERT INTO links (slug, dest, channel, campaign, content_label, app_label, created, retired) VALUES (${lit(slug)}, ${lit(dest)}, ${lit(slug.split('-')[0])}, ${lit(labels.campaign ?? null)}, ${lit(labels.content_label ?? null)}, ${lit(labels.app_label ?? null)}, ${Date.now()}, 0)`, f);
    const files = writeQr(slug, f);
    console.log(`created ${PUBLIC_ORIGIN}/go/${slug} -> ${dest}`);
    files.forEach((p) => console.log('qr: ' + p));
  } else if (cmd === 'list') {
    const rows = d1('SELECT l.slug, l.dest, l.retired, (SELECT COUNT(*) FROM link_clicks c WHERE c.slug = l.slug AND c.is_bot = 0) AS clicks FROM links l ORDER BY l.created DESC', f);
    if (f.json) console.log(JSON.stringify(rows, null, 2));
    else rows.forEach((r) => console.log(`${r.retired ? 'retired ' : 'active  '} ${String(r.clicks).padStart(4)}  ${r.slug}  ${r.dest}`));
    if (!rows.length) console.log('no links');
  } else if (cmd === 'retire') {
    const slug = needSlug(a);
    if (!d1(`SELECT slug FROM links WHERE slug = ${lit(slug)}`, f).length) die('not found: ' + slug);
    d1(`UPDATE links SET retired = 1 WHERE slug = ${lit(slug)}`, f);
    console.log(`retired ${slug} (it still redirects)`);
  } else if (cmd === 'qr') {
    const slug = needSlug(a);
    if (!d1(`SELECT slug FROM links WHERE slug = ${lit(slug)}`, f).length) die('not found: ' + slug);
    writeQr(slug, f).forEach((p) => console.log('qr: ' + p));
  } else {
    console.log('usage: link new <slug> --dest <url> [--campaign x --content x --app x --out dir --allow-name] | list | retire <slug> | qr <slug> [--out dir]');
    process.exit(cmd ? 1 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
