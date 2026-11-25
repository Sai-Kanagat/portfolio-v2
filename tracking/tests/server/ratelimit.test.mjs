import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postEvents, batch } from './harness.mjs';

let srv;
before(async () => { srv = await startServer({ label: 'rate', vars: { RATE_LIMIT_PER_MIN: '12' } }); });
after(() => srv && srv.stop());

test('requests over the per-minute limit get 429 whatever sid or vid they use', async () => {
  const codes = [];
  for (let i = 0; i < 20; i++) codes.push((await postEvents(srv, batch())).status);
  assert.equal(codes.filter((c) => c === 204).length, 12, codes.join());
  assert.equal(codes.filter((c) => c === 429).length, 8, codes.join());
  const r = await postEvents(srv, batch());
  assert.equal(r.status, 429);
  assert.equal(r.headers['retry-after'], '60');
});

test('the limiter stores nothing about the client', () => {
  const db = srv.db();
  const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations'").all().map((r) => r.name).sort();
  assert.deepEqual(tables, ['cursor_bins', 'daily_rollup', 'events', 'health', 'ingest_stats', 'link_clicks', 'links', 'sessions']);
  const dump = JSON.stringify([db.prepare('select * from ingest_stats').all(), db.prepare('select * from events').all(), db.prepare('select * from sessions').all()]);
  assert.ok(!dump.includes('127.0.0.1'));
});
