// Test harness: real local D1 through `wrangler pages dev`. Nothing here touches
// a remote Cloudflare resource. Each server gets its own persist directory and
// is killed (whole process group) on stop().
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DB_ID = 'ffa0e060-cee7-4d8b-916d-62ebc6a23963';
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wrangler = path.join(ROOT, 'node_modules/.bin/wrangler');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

// Small fixture site so tests start fast. The real build is checked separately.
function makeFixtureSite(dir) {
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="en"><head><title>fixture</title></head><body>home</body></html>');
  fs.writeFileSync(path.join(dir, 'work.html'), '<!doctype html><html lang="en"><head><title>work</title></head><body>work</body></html>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
  const real404 = path.join(ROOT, '404.html');
  if (fs.existsSync(real404)) fs.copyFileSync(real404, path.join(dir, '404.html'));
}

export async function startServer({ vars = {}, label = 'srv' } = {}) {
  const tmp = fs.mkdtempSync(path.join(process.env.SK_TEST_TMP || os.tmpdir(), `sk-${label}-`));
  const site = path.join(tmp, 'site');
  const persist = path.join(tmp, 'state');
  fs.mkdirSync(site);
  makeFixtureSite(site);
  const mig = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error('migrations failed: ' + mig.stdout + mig.stderr);
  const port = await freePort();
  const inspector = await freePort();
  const bindings = Object.entries({ ALLOW_LOCAL_ORIGINS: '1', RATE_LIMIT_PER_MIN: '100000', ...vars }).flatMap(([k, v]) => ['--binding', `${k}=${v}`]);
  const child = spawn(
    wrangler,
    ['pages', 'dev', site, '--d1', `DB=${DB_ID}`, '--persist-to', persist, '--port', String(port), '--inspector-port', String(inspector), '--ip', '127.0.0.1', '--compatibility-date', '2025-09-01', ...bindings],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' } }
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('wrangler exited early:\n' + log);
    try {
      const r = await req(base, 'GET', '/work');
      if (r.status === 200) break;
    } catch {}
    if (Date.now() > deadline) {
      process.kill(-child.pid, 'SIGKILL');
      throw new Error('wrangler did not start:\n' + log);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const server = {
    base, port, tmp, persist, log: () => log,
    req: (method, p, opts) => req(base, method, p, opts),
    db: () => openDb(persist),
    stop() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return server;
}

export function openDb(persist) {
  const dir = path.join(persist, 'v3/d1/miniflare-D1DatabaseObject');
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.sqlite'));
  return new DatabaseSync(path.join(dir, file));
}

// Node http, so Host and other forbidden fetch headers can be set.
export function req(base, method, p, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const h = { ...headers };
    if (host) h.host = host;
    let payload = body;
    if (payload !== undefined && typeof payload !== 'string' && !Buffer.isBuffer(payload)) payload = JSON.stringify(payload);
    if (payload !== undefined) h['content-length'] = Buffer.byteLength(payload);
    const r = http.request({ host: u.hostname, port: u.port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let j;
        try {
          j = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json: j });
      });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

export const hex16 = () => crypto.randomBytes(8).toString('hex');

// A valid batch. Override pieces as needed.
export function batch(over = {}) {
  const now = Date.now();
  return {
    v: 1,
    vid: hex16(),
    sid: hex16(),
    pid: hex16(),
    ctx: { path: '/work', page_type: 'work', lang: 'en', device: 'desktop', vw: 1440, vh: 900, ref_host: 'www.linkedin.com', link: null, utm: {}, owner: false, test: false, ...(over.ctx || {}) },
    ev: over.ev || [{ n: 'page_view', t: now, p: { title_id: 'work' } }],
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !['ctx', 'ev'].includes(k))),
  };
}

export const goodHeaders = (extra = {}) => ({ origin: 'http://localhost:5173', 'user-agent': BROWSER_UA, 'content-type': 'text/plain', ...extra });

export async function postEvents(srv, body, headers = {}) {
  return srv.req('POST', '/api/e', { headers: goodHeaders(headers), body });
}

// Access JWT helpers: an RSA key pair, a JWKS, and a signer.
export function makeAccess() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const team = 'testteam.cloudflareaccess.com';
  const aud = 'test-aud-tag-0123456789';
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  function sign(claims = {}, { key = privateKey, header = {} } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const h = b64({ alg: 'RS256', kid: 'test-kid', typ: 'JWT', ...header });
    const p = b64({ iss: `https://${team}`, aud: [aud], email: 'sai@example.test', iat: now, nbf: now - 5, exp: now + 600, type: 'app', ...claims });
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
    return `${h}.${p}.${sig}`;
  }
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    team, aud, email: 'sai@example.test', sign,
    forgedKey: other.privateKey,
    vars: { ALLOW_TEST_JWKS: '1', TEST_JWKS_JSON: JSON.stringify({ keys: [jwk] }), CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud, OPS_ALLOWED_EMAILS: 'sai@example.test' },
    headers: (claims, opts) => ({ 'cf-access-jwt-assertion': sign(claims, opts), origin: undefined }),
  };
}
