// Unit tests for the pure helpers in ops/lib.js: sample size rule, CSV safety, validators, query building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, avg, csvCell, toCsv, classifyHost, channelLabel, isSlug, isSid, isPath, destOk, apiQuery, parseHash, stateFromQuery, queryFromState, linkUrl, paramPairs, fmtPct, fmtSecs, clip, MIN_N, normPath, parseControls, mergeControls } from '../../../ops/lib.js';

test('rate: zero denominator, 19, 20 and 1000 samples', () => {
  const z = rate(0, 0);
  assert.equal(z.none, true); assert.equal(z.pct, null); assert.equal(z.text, 'n/a'); assert.equal(z.low, true);
  const n19 = rate(10, 19);
  assert.equal(n19.low, true, 'n=19 is marked'); assert.equal(n19.den, 19);
  const n20 = rate(10, 20);
  assert.equal(n20.low, false, 'n=20 is not marked'); assert.equal(n20.text, '50%'); assert.equal(n20.of, '10 of 20');
  assert.equal(MIN_N, 20);
  assert.equal(rate(5, 1000).text, '0.5%');
  assert.equal(rate('x', 'y').none, true, 'garbage counts as no sample');
  assert.equal(rate(1, 3).of, '1 of 3');
});

test('avg: missing value, zero n, 19 and 20', () => {
  assert.equal(avg(null, 50).none, true);
  assert.equal(avg(12, 0).none, true);
  assert.equal(avg(12, 19).low, true);
  assert.equal(avg(12, 20).low, false);
  assert.equal(avg(0, 25).none, false, 'a real zero average is a value');
});

test('csv: formulas are neutralised, quotes and newlines are escaped', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.ok(csvCell('\tcmd').startsWith("'"));
  assert.equal(csvCell('\rcmd'), '"\'\rcmd"');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
  assert.equal(toCsv(['a', 'b'], [[1, '=x']]), "a,b\r\n1,'=x\r\n");
});

test('validators mirror the server patterns', () => {
  for (const s of ['li-thallo-01', 'cv-acme-growth', 'qr-a', 'pdf-x-y-z']) assert.ok(isSlug(s), s);
  for (const s of ['thallo', 'li-', 'LI-x', 'li-x_y', 'xx-abc', 'li--x', '<img>', 'li-' + 'a'.repeat(70), '', null]) assert.equal(isSlug(s), false, String(s));
  assert.ok(isSid('0123456789abcdef'));
  for (const s of ['0123456789ABCDEF', '0123', 'g123456789abcdef', '0123456789abcdef0', null]) assert.equal(isSid(s), false);
  assert.ok(isPath('/work')); assert.ok(isPath('/'));
  for (const s of ['work', '/a?b=1', '/a#b', '/<script>', '/' + 'a'.repeat(250)]) assert.equal(isPath(s), false, s);
  assert.equal(linkUrl('li-a-b'), 'https://saikanagat.com/go/li-a-b');
});

test('destination rule: own domain or root path only', () => {
  for (const d of ['/thallo/', '/', 'https://saikanagat.com/x', 'https://www.saikanagat.com/', 'https://a.b.saikanagat.com/x?y=1']) assert.ok(destOk(d), d);
  for (const d of ['//evil.example', 'http://saikanagat.com', 'https://saikanagat.com.evil.example', 'https://evil.example/', 'https://user:pw@saikanagat.com', 'https://saikanagat.com:8443/', 'javascript:alert(1)', '/\\evil', 'https://evilsaikanagat.com', '', 'x'.repeat(600)]) assert.equal(destOk(d), false, d);
});

test('classifyHost agrees with the server channel rules', () => {
  assert.equal(classifyHost('chatgpt.com'), 'ai');
  assert.equal(classifyHost('www.perplexity.ai'), 'ai');
  assert.equal(classifyHost('claude.ai'), 'ai');
  assert.equal(classifyHost('www.google.com'), 'search');
  assert.equal(classifyHost('duckduckgo.com'), 'search');
  assert.equal(classifyHost('news.example'), 'other');
  assert.equal(classifyHost(''), 'none');
  assert.equal(classifyHost('<img src=x>'), 'other');
});

test('channel labels', () => {
  assert.equal(channelLabel('link:li'), 'Tracked link: LinkedIn post');
  assert.equal(channelLabel('utm:news'), 'UTM source: news');
  assert.equal(channelLabel('direct'), 'Direct or unknown');
  assert.equal(channelLabel('weird'), 'weird');
});

test('apiQuery uses only parameters the API supports', () => {
  assert.equal(apiQuery({ days: '30' }).toString(), 'days=30');
  assert.equal(apiQuery({ days: '7', owner: true, test: true }).toString(), 'days=7&include=owner%2Ctest');
  assert.equal(apiQuery({ days: '7', test: true }).toString(), 'days=7&include=test');
  assert.equal(apiQuery({ days: '999' }).toString(), 'days=30', 'unknown preset falls back');
  const c = apiQuery({ days: 'custom', from: '2026-11-01', to: '2026-11-03' });
  assert.equal(c.get('from'), String(Date.UTC(2026, 10, 1)));
  assert.equal(c.get('to'), String(Date.UTC(2026, 10, 4)), 'to is inclusive: end of that day');
  assert.equal(apiQuery({ days: 'custom', from: '', to: '' }).get('days'), '30');
  assert.equal(apiQuery({ days: '7' }, { path: '/work', device: '' }).toString(), 'days=7&path=%2Fwork');
});

test('hash routing and state round trip', () => {
  const p = parseHash('#/buttons?days=30&owner=1&page=%2Fwork');
  assert.equal(p.view, 'buttons'); assert.equal(p.query.get('page'), '/work');
  const st = stateFromQuery(p.query);
  assert.deepEqual(st, { days: '30', from: '', to: '', owner: true, test: false });
  assert.equal(queryFromState(st, { page: '/work' }).toString(), 'days=30&owner=1&page=%2Fwork');
  assert.equal(parseHash('').view, 'live');
  assert.equal(parseHash('#/visits/0123456789abcdef').arg, '0123456789abcdef');
  assert.equal(parseHash('#/visits/%E0%A4%A').arg, '', 'bad escapes do not throw');
  assert.equal(stateFromQuery(new URLSearchParams('days=bogus&from=x')).days, '7');
});

test('paramPairs and formatting helpers never throw', () => {
  assert.deepEqual(paramPairs('{"a":1,"b":"x"}'), [['a', '1'], ['b', 'x']]);
  assert.equal(paramPairs('not json'), null);
  assert.deepEqual(paramPairs(null), []);
  assert.equal(paramPairs('[1,2]'), null);
  assert.equal(fmtPct(0), '0%'); assert.equal(fmtPct(4.34), '4.3%'); assert.equal(fmtPct(42.4), '42%');
  assert.equal(fmtSecs(75), '1 min 15 s'); assert.equal(fmtSecs(null), '');
  assert.equal(clip('a'.repeat(300), 10).length, 10);
});

test('normPath: one page under /work, /work/, /work.html and index.html spellings', () => {
  assert.equal(normPath('/work'), '/work'); assert.equal(normPath('/work.html'), '/work'); assert.equal(normPath('/work/'), '/work');
  assert.equal(normPath('/thallo/'), '/thallo'); assert.equal(normPath('/thallo/index.html'), '/thallo'); assert.equal(normPath('/'), '/'); assert.equal(normPath('/index.html'), '/');
  assert.equal(normPath('/demos/hands.html?x=1#y'), '/demos/hands'); assert.equal(normPath(null), '/');
});

test('parseControls: drops anything that is not a valid id and path, and refuses a file that is not a list', () => {
  assert.equal(parseControls(null), null); assert.equal(parseControls({ controls: 'x' }), null); assert.equal(parseControls([1]), null);
  const k = parseControls({ controls: [
    { id: 'nav.work', path: '/', devices: ['desktop', 'phone'] }, { id: 'Bad Id', path: '/' }, { id: 'a.b', path: 'no-slash' }, { id: '<img>', path: '/x' }, null, { id: 'ok.two', path: '/w', zone: 'z'.repeat(99) },
  ] });
  assert.deepEqual(k.controls.map((c) => c.id), ['nav.work', 'ok.two']);
  assert.deepEqual(k.controls[0].devices, ['desktop'], 'unknown device names are dropped');
  assert.equal(k.controls[1].zone.length, 40); assert.equal(k.dropped, 4); assert.equal(k.pages, 2);
});

test('mergeControls: a known control with no click row is 0, the denominator comes from the page, filters and truncation are honoured', () => {
  const known = parseControls({ controls: [
    { id: 'a.one', path: '/work', devices: ['desktop', 'mobile'] }, { id: 'a.two', path: '/work.html', devices: ['desktop'] }, { id: 'b.three', path: '/about', devices: ['mobile'] }, { id: 'c.four', path: '/', devices: [] },
  ] });
  const rows = [{ track_id: 'a.one', path: '/work', clicks: 4, sessions: 3, page_sessions: 10 }, { track_id: 'dyn.x', path: '/work', clicks: 1, sessions: 1 }];
  const paths = [{ path: '/work', sessions: 10 }, { path: '/about', sessions: 6 }];
  const m = mergeControls(known, rows, { paths });
  const by = Object.fromEntries(m.rows.map((r) => [r.track_id, r]));
  assert.equal(m.rows.length, 5); assert.equal(m.zero, 3); assert.equal(m.unlisted, 1);
  assert.deepEqual([by['a.two'].clicks, by['a.two'].sessions, by['a.two'].visitors, by['a.two'].page_sessions], [0, 0, 0, 10], '/work.html is the same page as /work');
  assert.equal(by['b.three'].page_sessions, 6); assert.equal(by['c.four'].page_sessions, 0, 'a page nobody viewed has denominator 0');
  assert.equal(by['dyn.x'].listed, false); assert.equal(by['dyn.x'].page_sessions, 10, 'a clicked row without a denominator takes the page denominator');
  assert.equal(by['a.one'].zero, false);
  assert.deepEqual(mergeControls(known, rows, { paths, page: '/work' }).rows.map((r) => r.track_id).sort(), ['a.one', 'a.two', 'dyn.x']);
  assert.deepEqual(mergeControls(known, [], { paths, device: 'mobile' }).rows.map((r) => r.track_id).sort(), ['a.one', 'b.three', 'c.four'], 'a desktop-only control is not a zero on mobile');
  assert.equal(mergeControls(known, [], { paths, device: 'tablet' }).rows.length, 4, 'tablet is not filtered');
  assert.equal(mergeControls(known, rows, { paths, truncated: true }).zero, 0, 'a cut list proves nothing about zero clicks');
  const none = mergeControls(null, rows, { paths });
  assert.equal(none.rows.length, 2); assert.equal(none.rows.every((r) => r.listed), true, 'with no list nothing is marked');
});
