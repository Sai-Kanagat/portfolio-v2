import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { shouldCount } from '../../../functions/_lib/ratelimit.js';
const hits = (rule, url) => new RegExp('^' + rule.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url);
test('built _routes.json never excludes a gated path', () => {
  execFileSync('node', ['tracking/build-dist.mjs'], { stdio: 'ignore' });
  const { exclude, include } = JSON.parse(fs.readFileSync('dist/_routes.json', 'utf8'));
  assert.deepEqual(include, ['/*']);
  assert.ok(exclude.length > 0 && exclude.length <= 99, String(exclude.length));
  for (const u of ['/ops', '/ops/', '/ops/app.js', '/ops/a/b.css', '/ops/data.txt', '/api/ops/live', '/api/ops/x.js', '/api/e', '/go/li-a.js'])
    for (const r of exclude) assert.ok(!hits(r, u), r + ' matches ' + u);
  assert.ok(exclude.some((r) => hits(r, '/js/track.js')), 'public scripts still bypass Functions');
});
test('drop throttle cannot be dodged by changing the detail', () => {
  let n = 0; for (let i = 0; i < 500; i++) if (shouldCount('flood_kind', 1e12)) n++;
  assert.equal(n, 1);
  const src = fs.readFileSync('functions/api/e.js', 'utf8');
  assert.match(src, /shouldCount\(kind\)/);
  assert.doesNotMatch(src, /e\.detail/);
  for (let i = 0; i < 300; i++) shouldCount('k' + i, 1e12);
  assert.equal(shouldCount('flood_kind', 1e12), false);
});

test('encoded spellings of the private paths are recognised before static files', async () => {
  const { privatePath } = await import('../../../functions/_middleware.js');
  for (const p of ['/ops', '/ops/', '/ops/app.js', '/%6fps/app.js', '/%6Fps/', '/ops%2fapp.js', '/%2fops/app.js', '/%256fps/app.js', '/OPS/app.js', '/js/%2e%2e/ops/app.js', '//ops//app.js', '/ops%5capp.js', '/api/ops/live', '/api%2fops/live', '/%61pi/%6fps/live', '/%6fps/%zz']) assert.equal(privatePath(p), true, p);
  for (const p of ['/', '/work', '/opsec', '/blog/ops', '/api/e', '/go/li-x', '/blog/100%25-off']) assert.equal(privatePath(p), false, p);
});
