// Writes tracking/maps/tools.json from spec.mjs. Run: node tracking/tests/tools/build-map.mjs
import fs from 'node:fs';
import { pages } from './spec.mjs';
const out = { version: 1, owner: 'tools', note: 'Generated from tracking/tests/tools/spec.mjs. Event strings: action[item,bucket,value,ms] for demo_action, track:name for catalogue events, model:state for model_state. re: marks a pattern, opt: an optional event. Lifecycle events (demo_open, demo_start, demo_engaged, demo_end, first_interaction, return_visit) come from the shared helper on every page and are not repeated per control.', helper: { listeners: ['pointermove/scroll/wheel/touchmove: active-time clock only, no event', 'pointerdown/keydown/input/change (capture): first_interaction once', 'visibilitychange, pagehide: demo_end', 'click on a[data-track] ending .back or .home: demo_end', 'error, unhandledrejection: demo_error js or promise, three at most', 'sk:consent: return_visit check'], sites: [
  { type: 'visibilitychange', match: "document\\.addEventListener\\('visibilitychange',function\\(\\)\\{if\\(document\\.hidden\\)TRK\\.end\\('hidden'\\)", maps: 'helper: demo_end hidden' },
  { type: 'pagehide', match: "window\\.addEventListener\\('pagehide',function\\(\\)\\{TRK\\.end\\('leave'\\)", maps: 'helper: demo_end leave' },
  { type: 'click', match: "document\\.addEventListener\\('click',function\\(e\\)\\{var a=e\\.target&&e\\.target\\.closest&&e\\.target\\.closest\\('a\\[data-track\\]'\\)", maps: 'helper: demo_end back or home' },
  { type: 'error', match: "window\\.addEventListener\\('error',function\\(ev\\)\\{if\\(ev&&ev\\.filename", maps: 'helper: demo_error js' },
  { type: 'unhandledrejection', match: "window\\.addEventListener\\('unhandledrejection',function\\(\\)\\{TRK\\.err\\('promise'\\)", maps: 'helper: demo_error promise' },
  { type: 'sk', match: "window\\.addEventListener\\('sk:consent',function\\(\\)\\{setTimeout\\(rv,50\\)", maps: 'helper: return_visit check' }
], shared_events: ['demo_open', 'first_interaction', 'demo_start', 'demo_engaged (10 s and 60 s active)', 'demo_end', 'demo_error', 'return_visit (needs consent granted)', 'fps bucket (Agora only: the only demo with an animation loop)'] }, pages: {} };
for (const [file, p] of Object.entries(pages)) {
  out.pages[file] = {
    demo_id: p.demo_id,
    controls: Object.fromEntries(Object.entries(p.controls).map(([id, c]) => [id, { kind: c.kind, emits: c.emits, ...(c.life ? { lifecycle: c.life } : {}), ...(c.note ? { note: c.note } : {}) }])),
    views: p.views || {},
    listeners: p.listeners.map(([re, to]) => ({ match: re, maps: to }))
  };
}
// Inline attribute handlers (onclick="..." in markup) are not in the test's .onclick= scan, so the coverage gate maps them here.
const inline = {
  'cortex/index.html': [{ type: 'onclick', match: 'data-track="cortex\\.hero\\.watch" onclick="document\\.getElementById\\(.demo.\\)\\.scrollIntoView', maps: 'cortex.hero.watch' }],
  'hire/index.html': [{ type: 'onsubmit', match: '<form class="hs-form" id="hsForm" onsubmit="return false"', maps: 'ignore: stops a native submit; the form has no submit button, tracking sits on the chips and the role field' }]
};
for (const [f, a] of Object.entries(inline)) out.pages[f].listeners.push(...a);
fs.mkdirSync('tracking/maps', { recursive: true });
fs.writeFileSync('tracking/maps/tools.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote tracking/maps/tools.json', Object.keys(out.pages).length, 'pages');
