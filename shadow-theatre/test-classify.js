// Run: node shadow-theatre/test-classify.js
const S = require('./classify.js');
let fail = 0;
function check(name, got, want) { const ok = got === want; if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + got + (ok ? '' : ' (want ' + want + ')')); }
const jitter = (hands, amt, seed) => { let r = seed; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280 - 0.5) * amt; return hands.map(h => h.map(p => ({ x: p.x + rnd(), y: p.y + rnd() }))); };
for (const [pose, want] of [['dog','dog'],['rabbit','rabbit'],['duck','duck'],['bird','bird'],['open',null],['fist',null]]) {
  for (const [scale, rot] of [[100,0],[40,0],[160,0]]) {
    check(`${pose} s${scale}`, S.classify(S.POSES[pose](300, 300, scale)).shape, want);
    check(`${pose} s${scale} jitter`, S.classify(jitter(S.POSES[pose](300, 300, scale), scale * 0.04, scale)).shape, want);
  }
}
// rotation tolerance for single-hand shapes
for (const deg of [-20, 20]) {
  const rot = (h) => h.map(p => { const a = deg*Math.PI/180, x = p.x-300, y = p.y-300; return { x: 300 + x*Math.cos(a)-y*Math.sin(a), y: 300 + x*Math.sin(a)+y*Math.cos(a) }; });
  for (const pose of ['dog','rabbit','duck']) check(`${pose} rot${deg}`, S.classify(S.POSES[pose](300,300,100).map(rot)).shape, pose);
}
// two open hands far apart are not a bird
check('two open hands apart', S.classify([S.POSES.open(100,300,80)[0], S.POSES.open(600,300,80)[0]]).shape, null);
// mirrored (selfie view) inputs still classify
const mir = h => h.map(p => ({ x: 1000 - p.x, y: p.y }));
for (const pose of ['dog','rabbit','duck']) check(`${pose} mirrored`, S.classify(S.POSES[pose](300,300,100).map(mir)).shape, pose);
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
