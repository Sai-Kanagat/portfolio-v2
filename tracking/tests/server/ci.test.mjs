import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
const job = (name) => { const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, 'm').exec(wf); assert.ok(m, 'job ' + name); return m[1]; };

test('workflow: keeps the push-to-main trigger and can be run by hand', () => {
  assert.match(wf, /^on:\n  push:\n    branches: \[main\]/m);
  assert.match(wf, /workflow_dispatch:/);
});

test('workflow: a test job with gate, server and client suites must pass before deploy', () => {
  const t = job('test'), d = job('deploy');
  assert.match(d, /needs: test/, 'deploy needs test');
  assert.doesNotMatch(d, /continue-on-error/);
  assert.doesNotMatch(t, /continue-on-error/);
  assert.match(t, /coverage\.mjs --check/, 'gate');
  assert.match(t, /codemod\.mjs --root "\$PWD" --all --check/, 'codemod check');
  assert.match(t, /gate\/negative\.test\.mjs/, 'gate negatives');
  assert.match(t, /npm run test:server/, 'server');
  assert.match(t, /tests\/client\/run\.mjs/, 'client');
  assert.match(t, /tests\/joined\/run\.mjs/, 'joined');
  assert.match(t, /tests\/pages\/run\.mjs/);
  assert.match(t, /tests\/tools\/tools\.test\.mjs/);
  assert.match(t, /tests\/media\/media\.test\.mjs/);
  assert.match(t, /ops-ui/);
});

test('workflow: deploys the built dist, never the repository root, and never runs remote D1', () => {
  const d = job('deploy');
  assert.match(d, /node tracking\/build-dist\.mjs/);
  assert.match(d, /pages deploy dist --project-name=saikanagat --branch=main/);
  assert.doesNotMatch(wf, /pages deploy \./);
  assert.doesNotMatch(wf, /d1 (execute|migrations apply)(?![^\n]*--local)/, 'no remote D1 from CI');
  assert.match(d, /if: github\.event_name != 'pull_request'/, 'pull requests only test');
});

test('workflow: secrets are referenced, never written, and the test job gets no deploy secret', () => {
  assert.doesNotMatch(wf, /CLOUDFLARE_API_TOKEN:\s*[A-Za-z0-9_-]{20,}/);
  assert.ok(!/secrets\./.test(job('test')), 'the test job reads no secret');
  assert.match(job('test'), /permissions:\n      contents: read/);
});
