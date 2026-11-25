// The coverage gate must fail when it should. Each case breaks a scratch copy of the tree in one way and expects
// `coverage.mjs --check` to exit 1 and name the problem. The untouched copy must pass. Nothing here edits the real tree.
//   node --test tracking/tests/gate/negative.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let TMP;
const SKIP_DIR = /^(node_modules|\.git|\.wrangler|dist|assets|functions|migrations|workers|tools|ops|_gtm|syndication|social-kit|tests|\.github)$/;
const KEEP = /\.(html|js|mjs|json|css)$/;

function copyTree(dest) {
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!rel && SKIP_DIR.test(e.name) && e.name !== 'tracking') continue;
        if (rel && SKIP_DIR.test(e.name)) continue;
        walk(r);
      } else if (KEEP.test(e.name) && !/^package(-lock)?\.json$/.test(e.name)) {
        fs.mkdirSync(path.dirname(path.join(dest, r)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, r), path.join(dest, r));
      }
    }
  })('');
}
const copy = (name) => { const d = path.join(TMP, name); copyTree(d); return d; };
const gate = (dir, only) => {
  const r = spawnSync('node', [path.join(dir, 'tracking/scripts/coverage.mjs'), '--check', `--only=${only}`], { cwd: dir, encoding: 'utf8', timeout: 170000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const edit = (dir, f, fn) => { const p = path.join(dir, f); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };

before(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-gate-neg-')); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

test('the untouched tree passes the gate', () => {
  const d = copy('clean');
  const r = gate(d, 'demos/roas.html,hire/index.html');
  assert.equal(r.code, 0, r.out.slice(-800));
  assert.match(r.out, /GATE PASSED/);
});

test('a new control with no data-track and no map entry fails', () => {
  const d = copy('newbtn');
  edit(d, 'demos/roas.html', (s) => s.replace('</body>', '<button id="sneaky" type="button">Sneak</button></body>'));
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /demos\/roas\.html: (control with no data-track and no map entry|codemod would still change)/);
});

test('removing a data-track id from a control fails', () => {
  const d = copy('rmid');
  edit(d, 'hire/index.html', (s) => s.replace(/ data-track="nav\.work"/, ''));
  const r = gate(d, 'hire/index.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /hire\/index\.html/);
});

test('a malformed or personal id fails', () => {
  const d = copy('badid');
  edit(d, 'hire/index.html', (s) => s.replace(/data-track="nav\.work"/, 'data-track="Sai.Kanagat@x"'));
  const r = gate(d, 'hire/index.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad data-track id/);
});

test('a new canvas with no map entry fails (a canvas is a control)', () => {
  const d = copy('canvas');
  edit(d, 'demos/agora.html', (s) => s.replace('</body>', '<canvas id="extraCanvas"></canvas></body>'));
  const r = gate(d, 'demos/agora.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /demos\/agora\.html/);
});

test('a new listener in a media demo fails: the map counts sites per entry', () => {
  const d = copy('listener');
  edit(d, 'demos/balls.html', (s) => s.replace('</body>', "<script>document.addEventListener('keydown', function () {});</script></body>"));
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /demos\/balls\.html:\d+: listener "keydown" has no map entry/);
});

test('a listener removed from a media demo fails: the entry now says more sites than the source has', () => {
  const d = copy('listener-gone');
  edit(d, 'demos/balls.html', (s) => s.replace("document.getElementById('clearBtn').onclick = ", "document.getElementById('clearBtn').ONCLICK_GONE = "));
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /media\.json demos\/balls\.html: entry onclick .* says 1 sites, source has 0/);
});

test('a stale element entry that matches nothing fails', () => {
  const d = copy('stale');
  edit(d, 'tracking/maps/elements.json', (s) => { const j = JSON.parse(s); j.pages['demos/roas.html']['canvas#doesNotExist'] = { ignored: 'x', n: 1 }; return JSON.stringify(j); });
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /stale map entry "canvas#doesNotExist"/);
});

test('an element entry with the wrong count fails', () => {
  const d = copy('count');
  edit(d, 'tracking/maps/elements.json', (s) => { const j = JSON.parse(s); j.pages['demos/roas.html']['canvas#chart'].n = 3; return JSON.stringify(j); });
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /says 3 elements but the page has 1/);
});

test('a page whose tracking head is stale fails', () => {
  const d = copy('head');
  edit(d, 'demos/roas.html', (s) => s.replace(/<script>window\.SK_CLARITY_ID='[^']*';<\/script>\n?/, ''));
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /codemod would still change this page/);
});

test('an inline GTM loader put back on a page fails', () => {
  const d = copy('gtm');
  edit(d, 'demos/roas.html', (s) => s.replace('</head>', "<script>(function(w,d,s,l,i){var j=d.createElement(s);j.src='https://www.googletagmanager.com/gtm.js?id='+i;d.head.appendChild(j);})(window,document,'script','dataLayer','GTM-MRGXD7ZC');</script></head>"));
  const r = gate(d, 'demos/roas.html');
  assert.equal(r.code, 1);
  assert.match(r.out, /codemod would still change this page/);
});
