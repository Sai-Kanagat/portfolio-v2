// Writes tracking/maps/tools.json from spec.mjs. Run: node tracking/tests/tools/build-map.mjs
import fs from 'node:fs';
import { pages } from './spec.mjs';
const out = { version: 1, owner: 'tools', note: 'Generated from tracking/tests/tools/spec.mjs. Event strings: action[item,bucket,value,ms] for demo_action, track:name for catalogue events, model:state for model_state. re: marks a pattern, opt: an optional event. Lifecycle events (demo_open, demo_start, demo_engaged, demo_end, first_interaction, return_visit) come from the shared helper on every page and are not repeated per control.', helper: { listeners: ['pointermove/scroll/wheel/touchmove: active-time clock only, no event', 'pointerdown/keydown/input/change (capture): first_interaction once', 'visibilitychange, pagehide: demo_end', 'click on a[data-track] ending .back or .home: demo_end', 'error, unhandledrejection: demo_error js or promise, three at most', 'sk:consent: return_visit check'], shared_events: ['demo_open', 'first_interaction', 'demo_start', 'demo_engaged (10 s and 60 s active)', 'demo_end', 'demo_error', 'return_visit (needs consent granted)', 'fps bucket (Agora only: the only demo with an animation loop)'] }, pages: {} };
for (const [file, p] of Object.entries(pages)) {
  out.pages[file] = {
    demo_id: p.demo_id,
    controls: Object.fromEntries(Object.entries(p.controls).map(([id, c]) => [id, { kind: c.kind, emits: c.emits, ...(c.life ? { lifecycle: c.life } : {}), ...(c.note ? { note: c.note } : {}) }])),
    views: p.views || {},
    listeners: p.listeners.map(([re, to]) => ({ match: re, maps: to }))
  };
}
fs.mkdirSync('tracking/maps', { recursive: true });
fs.writeFileSync('tracking/maps/tools.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote tracking/maps/tools.json', Object.keys(out.pages).length, 'pages');
