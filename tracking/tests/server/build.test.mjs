import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './harness.mjs';

test('build-dist publishes the site and nothing private', () => {
  const out = fs.mkdtempSync(path.join(process.env.SK_TEST_TMP || os.tmpdir(), 'sk-dist-'));
  try {
    const target = path.join(out, 'dist');
    execFileSync('node', [path.join(ROOT, 'tracking/build-dist.mjs'), '--out', target, '--quiet'], { cwd: ROOT });
    // out is outside the repo: the script must refuse that.
  } catch (e) {
    assert.match(String(e.stderr), /refusing/);
  }
  const target = path.join(ROOT, '.wrangler', 'test-dist');
  execFileSync('node', [path.join(ROOT, 'tracking/build-dist.mjs'), '--out', '.wrangler/test-dist', '--quiet'], { cwd: ROOT });
  const all = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; e.isDirectory() ? walk(path.join(d, e.name), r) : all.push(r); } })(target, '');
  for (const must of ['index.html', 'work.html', 'css/styles.css', '_routes.json', '_redirects', 'robots.txt']) assert.ok(all.includes(must), must);
  if (fs.existsSync(path.join(ROOT, '404.html'))) assert.ok(all.includes('404.html'));
  if (fs.existsSync(path.join(ROOT, 'js/track.js'))) assert.ok(all.includes('js/track.js'), 'untracked js/track.js must be included');
  const banned = all.filter((f) => /^(tracking|_gtm|functions|migrations|workers|tools|tests|node_modules|\.git|\.github|\.claude|syndication|social-kit)\//.test(f) || /(^|\/)(package(-lock)?\.json|wrangler\.toml|\.DS_Store|CLAUDE\.md|README\.md)$/.test(f) || /\.(md|log|map|sqlite|pem|key)$/.test(f));
  assert.deepEqual(banned, []);
  const routes = JSON.parse(fs.readFileSync(path.join(target, '_routes.json'), 'utf8'));
  assert.deepEqual(routes.include, ['/*']);
  assert.ok(routes.exclude.length > 0 && routes.exclude.length <= 99);
  assert.ok(routes.exclude.includes('/css/*') && routes.exclude.includes('/js/*'));
  assert.ok(!routes.exclude.some((r) => /html/.test(r)));
  fs.rmSync(target, { recursive: true, force: true });
});

test('no em or en dashes in anything the server brief owns', () => {
  const files = [];
  for (const dir of ['functions', 'migrations', 'workers', 'tools/link', 'tracking/tests/server']) {
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.wrangler') continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(path.join(ROOT, dir));
  }
  files.push(path.join(ROOT, '404.html'), path.join(ROOT, 'wrangler.toml'), path.join(ROOT, 'tracking/build-dist.mjs'));
  const hits = files.filter((f) => new RegExp('[\\u2013\\u2014]').test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
