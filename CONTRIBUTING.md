# Tracking rules for any session in this repo

The site is static, no build step for pages. `dist/` is built by `node tracking/build-dist.mjs` and is the only thing deployed. This file never ships (the build skips it).

## Before you finish any change to a page or script
1. `node tracking/codemod.mjs --root "$PWD" --all` stamps every page: `data-page-type`, `data-track` ids on static controls, `data-zone`, `data-section`, the Clarity id, and the `?v=` hash on `consent.js` and `analytics.js`. Run it again after any edit to `js/consent.js`, `js/analytics.js` or `js/track.js`, because the hash covers them. A second run must change nothing.
2. `node tracking/scripts/coverage.mjs --check` is the gate. It fails on a control with no `data-track` and no exact map entry, a listener with no map entry, a stale map entry, or a page the codemod would still change. Fix the cause. Do not add a catch-all ignore.
3. If the gate passed and controls changed, regenerate: `node tracking/scripts/coverage.mjs` then `node tracking/scripts/controls.mjs` (writes `ops/controls.json`).
4. Run the suites: `npm run test:server`, `node tracking/tests/client/run.mjs`, `node tracking/tests/pages/run.mjs`, `node tracking/tests/tools/tools.test.mjs`, `node tracking/tests/media/media.test.mjs`, `node --test tracking/tests/ops-ui/*.test.mjs`, `node tracking/tests/joined/run.mjs`, and `node --test tracking/tests/gate/negative.test.mjs` (proves the gate still fails when it should).

## Maps
- `tracking/maps/pages.json`: site pages. `media.json`: camera and mic demos. `tools.json`: generated from `tracking/tests/tools/spec.mjs` by `build-map.mjs`. `elements.json`: exact selectors for non-clickable elements such as canvases.
- A map key is a real CSS selector. Listener entries carry a regex over the source line and a count, so a new listener of the same type fails the gate.

## GTM and consent
- Pages carry only the Consent Mode default block. There is no inline `gtm.js` loader and no GTM noscript iframe on any page. `js/consent.js` loads GTM-MRGXD7ZC once, only in state `granted`, after the consent update is pushed, and again nothing in `pending` or `denied`.
- `js/track.js` never pushes to the data layer unless consent is granted, and resets keys used by earlier pushes (GTM merges pushes).

## The 404 page
`404.html` is served for every unknown path with status 404 (Pages). It has no GTM, no inline tracking, `data-page-type="not-found"`, the standard consent and analytics scripts, and sends one `page_not_found` with the path only. Keep it that way: the codemod stamps it with `--all`, and `tracking/tests/server/notfound.test.mjs` checks it.

## Held pages
Funnel Pinball, Landing Page Grader and Content Repurposer are wired and tested in a scratch worktree from the local commits and are not deployed. Do not copy a held page into this tree until the owner says so. When one is released: add it, run the codemod with `--all`, add its map entries (tools.json via spec.mjs), run the gate, and add its row to the joined test.

## House rules
No em or en dashes, no emoji, no AI attribution in code, commits or docs. Never collect typed text, file names, emails, camera or mic data, or share-link state. Tracking fails silently and never changes behaviour or frame rate. Zero cost: free tiers only, drop data at limits, never a paid product. Tests never touch the real Cloudflare account: wrangler with `--local` only.
