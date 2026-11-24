// Run: node shadow-theatre/test-classify.js
const S = require('./classify.js');
let fail = 0;
function check(name, got, want) { const ok = got === want; if (!ok) fail++; if (!ok || process.argv[2]) console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + got + (ok ? '' : ' (want ' + want + ')')); }
const jitter = (hands, amt, seed) => { let r = seed; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280 - 0.5) * amt; return hands.map(h => h.map(p => ({ x: p.x + rnd(), y: p.y + rnd() }))); };
const rotAll = (hands, deg) => hands.map(h => h.map(p => { const a = deg * Math.PI / 180, x = p.x - 300, y = p.y - 300; return { x: 300 + x * Math.cos(a) - y * Math.sin(a), y: 300 + x * Math.sin(a) + y * Math.cos(a) }; }));
const mir = hands => hands.map(h => h.map(p => ({ x: 1000 - p.x, y: p.y })));
const ids = S.CATALOG.map(c => c.id);
check('catalog size', ids.length, 30);
for (const id of ids) {
  check(`${id} has a pose`, typeof S.POSES[id], 'function');
  for (const scale of [40, 100, 160]) {
    const h = S.POSES[id](300, 300, scale);
    check(`${id} s${scale}`, S.classify(h).shape, id);
    for (let seed = 1; seed <= 3; seed++) check(`${id} s${scale} jitter${seed}`, S.classify(jitter(h, scale * 0.04, scale * seed)).shape, id);
  }
  for (const deg of [-20, 20]) check(`${id} rot${deg}`, S.classify(rotAll(S.POSES[id](300, 300, 100), deg)).shape, id);
  check(`${id} mirrored`, S.classify(mir(S.POSES[id](300, 300, 100))).shape, id);
}
// unknown shapes stay mysteries (they still cast and sparkle)
check('flat hand up (fingers together)', S.classify([S.makeHand({ x: 300, y: 300, scale: 100, spread: 1 })]).shape, null);
check('two lotus hands apart are two lotuses, not a pair', S.classify([S.POSES.lotus(100, 300, 80)[0], S.POSES.lotus(600, 300, 80)[0]]).shape, 'lotus');
check('mystery pose', S.classify(S.POSES.mystery(300, 300, 100)).shape, null);
check('middle finger alone', S.classify([S.makeHand({ x: 300, y: 300, scale: 100, fingers: { thumb: 'curl', index: 'curl', ring: 'curl', pinky: 'curl' } })]).shape, null);
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
