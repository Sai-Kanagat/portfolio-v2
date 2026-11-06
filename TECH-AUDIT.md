# Technical audit, saikanagat.com (branch writing-cleanup)

Date: 2026-11-06. Method: local static server, headless Chromium 1248 via Playwright, every one of the 28 HTML files at 375, 768, 1024 and 1440 px, plus scripted checks for loader, consent, forms, newsletter, language, keyboard, cursor, contrast and links. Measure only for weight: no content cut, no assets compressed. Nothing pushed or deployed.

## 1. Fixed in this branch

| Area | Bug and evidence | Fix | Commit |
|---|---|---|---|
| Loader (top priority) | With requestAnimationFrame stalled (background tab, throttled webview, some test harnesses) the loader never cleared: page stayed covered and scroll locked for the full 21 s test window, on first and repeat visits and on every page carrying loader.js (10 pages). Quick path and intro both waited on rAF. Unguarded sessionStorage. Reduced motion was ignored. The intro only started at DOMContentLoaded. | Timer-based hard cap (3.5 s intro, 1.2 s quick wipe) started at script run, a CSS animation that hides the overlay and releases the scroll lock at 3.6 s even if the script dies, rAF used only for smoothness with a 50 ms timer backup, storage wrapped in try/catch, no overlay at all under prefers-reduced-motion, bfcache restore clears it, quick wipe shortened from about 1.5 s to 0.45 s. | 32e1f1d |
| Hero name | Letters stayed hidden until a double rAF fired, so the hero name could stay invisible. | Timer fallback at 120 ms. | 32e1f1d |
| Page transition | Every internal link click was hijacked, including ctrl/cmd-click, target blank, downloads and PDFs. Overlay stayed black after back button (bfcache). | Only plain left clicks on page links, pageshow resets overlay. | 32e1f1d |
| Project panel, reduced motion | The reduced-motion rule set transform none on the closed project panel, so it sat on top of the work page and blocked clicks, including the language toggle. Reproduced at 1280 px. | Closed panel stays off screen and inert. Verified open and close in both motion modes. | 95e74a9 |
| Nav Available tag | Tag wrapped to two lines and clipped (and pushed the language toggle off screen) between 769 and 1100 px, still wrapped at 1280. | Tag never wraps, shown from 1280 px, links tighten, nothing clips from 769 to 1440 px on all pages. | 95e74a9 |
| Language toggle | MutationObserver re-ran innerHTML translation on the whole page every frame forever (310 runs in 5 s, 431 at 7 s). Language toggle also threw if storage was blocked. | Translates only added nodes, ignores its own writes, storage-safe. Now 1 run. Italian and English both verified. | 95e74a9 |
| favicon.ico | Linked from 9 pages, file did not exist. The live host answers it with the homepage HTML. | Added real favicon.ico (16 and 32 px). | 95e74a9 |
| Dead link | Three posts linked the nav button to ../score.html, which does not exist. | Same button as sibling posts (Content Vigilante). | 95e74a9 |
| Agora tile (and three more) | Baked-in text of the Agora, ROAS, Poster and Cortex screenshot thumbnails overlapped the tile titles. | Thumbnails softened with a blur so they read as texture. Asset files untouched. | f9af4e6 |
| Sideways scroll at 375 px | About (495 px wide), Demos (392), Contact (518), brand book (839 px at 375, 768 at 768, 1312 at 1024). | About closing section stacks, Demos grid minmax fixed, brand book grid children can shrink, cover and cover footer collapse. Zero overflow on all pages at all four widths now. | b8488c3, 4fc4efa |
| Certificates (About) | Four in-progress cards had cream text on light grey, ratio 1.03:1, so names and icons were invisible. | Ink and accent text. | 24313eb |
| Small grey text | The grey token used for dates, labels and the nav tag measured 4.18 to 4.32:1 at 10 to 12 px. | Token darkened, now above 4.5:1. | 24313eb |
| Mobile menu | Button did not report expanded state, Escape did nothing. | aria-expanded, aria-controls, Escape closes. | 4fc4efa |
| Step A | Work list index column, contact info cards (left column and the three "What I am looking for" boxes), homepage stats boxes. | Hairline rows and plain type, every fact kept, brand book numbering untouched. Also fixed the availability dot overlapping its label. | d10785b, 4fc4efa |

Final regression: 28 pages by 4 widths, zero console or page errors, zero failed local requests, zero horizontal overflow, zero clipped nav items.

## 2. Loader measurements (375 px)

| Condition | First visit | Repeat visit |
|---|---|---|
| Before fix, normal | covered about 2.8 s | covered about 0.7 s |
| Before fix, rAF stalled | never cleared (stopped at 21 s) | never cleared |
| After fix, normal | covered about 2.7 s | about 0.5 s |
| After fix, rAF stalled | 2.7 s | 0.5 s |
| After fix, reduced motion | no overlay | no overlay |
| After fix, sessionStorage throws | 2.7 s | not applicable |
| After fix, all timers and rAF dead (CSS failsafe only) | overlay hidden and scroll released at about 3.7 s | |
| Slow 4G (1.6 Mbps, 150 ms) with 4x CPU, home | FCP 2.37 s, covered until 5.0 s | covered 0.09 s to 0.60 s |
| Same profile, About and Work (quick wipe) | gone at 2.8 s and 3.1 s | |

The 9 second cover seen in the earlier test matches the stalled-rAF case. Remaining decision for Sai: the first-visit intro still takes a fixed 2.7 s of black screen on the home page. My recommendation is to cut it to about 1 s or drop the count-up and keep only the quick wipe. That is a design call, so I left it as is.

## 3. Open items, ranked

### High
1. About page weighs 6.8 MB because of one 6.0 MB PNG (assets/images/portraits/portrait-outdoor.png). Another unused 5.6 MB PNG sits beside it. On slow 4G with 4x CPU the About load event took 34.5 s. Measured only, not compressed, as instructed.
2. Aperol microsite weighs 8.6 MB (largest image 1.6 MB, 15 images). Gallery 4.3 MB over 43 requests (LCP 9.7 s on slow 4G). Home 2.7 MB over 50 requests.
3. No 404 page. Any unknown URL on the live host, such as /score, /zzz or /favicon.ico, returns 200 with the homepage HTML (checked with curl, 29,045 bytes). Search engines treat that as soft 404 and duplicate content. Needs a 404.html at deploy.
4. Facts needing Sai: the paper is described as 21 pages in three places (blog.html line 139, papers/monocular-biomechanics.html lines 92 and 103) but assets/papers/Monocular_Biomechanics_Sai_Kanagat.pdf has 10 pages (pdfinfo and PDF page tree agree). "33 references" not verified against the PDF. I did not change either.
5. Consent and tracking (not changed): (a) the banner only shows when the browser timezone or language looks European, so visitors elsewhere get analytics_storage granted by default with no notice. (b) There is no way to change the choice after clicking. (c) A cookieless GA collect ping fires before any choice in Europe (expected under Consent Mode, the banner copy says so). (d) Home JSON-LD lists "Meta Pixel" in knowsAbout while the banner says "no tracking pixels". Worth a wording check. (e) GTM plus gtag add about 304 KB of script on every page.

### Medium
6. Contact form posts straight to Formspree and leaves the site. No on-site success or error state, no `_next` redirect. Not submitted in testing.
7. Newsletter (Brevo) uses a no-cors fetch, so every response counts as success, including rejections. Not submitted in testing (endpoint mocked).
8. Italian toggle is partial. With Italian selected, long paragraphs stay English: About 16 blocks, Process 12, Blog 10, Contact 7, Demos 7, Home 4, Work 1. hreflang tags for en and it both point at the same URL, which is invalid pairing.
9. Nav button differs by page: "View Brandbook" on 9 pages, "Content Vigilante" on Aperol and four posts, previously "Score My Brand" on three posts.
10. Contrast still below AA: Aperol case study eyebrow and labels on orange (2.85 to 3.1:1) and orange headings on cream (3.1:1), Aperol microsite (3.83:1), Cortex "ready" badge (3.5:1), small grey on black in the hands, balls and poster demos (4.09:1). Brand colour decisions, so not changed.
11. Hamburger target is 32 by 24 px and mobile menu links are 34 px high (below the 44 px comfortable target, above the 24 px WCAG minimum).
12. Remaining numbered eyebrow labels on the Demos tiles ("01 · Lite Version" and so on) and in hidden work cards. Same pattern family as Phase 1.
13. Availability facts to reconcile in Phase 4: contact page says "Available From: Immediately" and targets "Milan, Rome, Florence, Turin" while the Opportunity block adds Bologna, and the nav tag says "EU & Remote". Marquee omits Turin.

### Low
14. Titles over 60 characters on 7 pages. Descriptions over 160 on 14 (About 326, Work 308, Home 272).
15. Heading order: Aperol case study skips h2 to h4, brand book has 2 h1 and several skips, Agora demo has 4 h1.
16. Form fields without labels: demo controls (Agora, ROAS, Poster), Aperol microsite email, brand book mock forms, Cortex demo inputs.
17. Missing social tags: Cortex (og:title, description, url, card), demos (og:url).
18. Sitemap: lastmod 2026-05-24 on most URLs although pages changed, includes the PDF. Canonicals are extensionless while internal links use .html (host redirects, harmless).
19. GTM noscript iframe has no title (standard snippet).
20. Zenodo and DOI links return 403 to curl (bot block), could not confirm they open in a browser.

## 4. Checked and fine
Skip link and visible 2 px focus outline on all 14 first tab stops of the home page. Custom cursor tracks on home, contact and work and native cursor returns over form fields and iframes. Consent banner appears in Europe, buttons 137 by 32 and 83 by 32 px at 375, choice persists across reload, consent update events reach dataLayer. GTM and GA4 load. Newsletter validation and floating button work. Language choice persists. Mobile menu opens. All internal links and anchors resolve except two work.html#dropballs and #handcursor anchors, which are opened by script from the hash. External links return 200 (carlosmota.com, juicychemistry.com, vercel app, GitHub, LinkedIn, BBS, jsdelivr MediaPipe). Structured data parses on all pages (Person, WebSite, ItemList, BlogPosting, ScholarlyArticle, ContactPage). Every image has alt. robots.txt and sitemap valid. agency-os page is noindex.

## 5. Could not test
Real iOS Safari and Android (Chromium emulation only, no touch hardware), screen readers, camera and microphone demos (hands, balls, audio) beyond load, the Cortex demo backend, real Formspree and Brevo delivery, GA4 receiving data in the property (only the outgoing requests were seen), Zenodo links, text compression and caching headers on the live host (local server sends uncompressed, so text weights below are upper bounds), the live site itself (a fresh deploy of this branch).

## 6. Page weight and load (bytes as transferred by the local server, uncompressed text, third parties live)

Load means everything requested by the load event plus 4 s. Scrolling to the bottom added under 0.01 MB on every page. Load ms is the load event at 1440 px on localhost, no throttling. Ext is third-party requests (fonts, GTM, GA, jsdelivr).

| Page | 375 MB | 375 req | 1440 MB | 1440 req | load ms | ext | largest local assets |
|---|---|---|---|---|---|---|---|
| /about.html | 6.78 | 24 | 6.79 | 25 | 340 | 12 | /assets/images/portraits/portrait-outdoor.png 6022K |
| /agency-os-ff9cbcc6/index.html | 0.09 | 5 | 0.09 | 5 | 79 | 4 | /agency-os-ff9cbcc6/index.html 6K |
| /aperol-golden-hour.html | 2.06 | 16 | 2.06 | 16 | 262 | 9 | /assets/images/APEROL/hero.jpg 805K, /assets/images/APEROL/img_mumbai_02.jpg 792K |
| /aperol-microsite/index.html | 8.56 | 27 | 8.56 | 28 | 275 | 18 | /aperol-microsite/aperol-01.jpg 1604K, /aperol-microsite/goa-sunset-02.jpg 1149K |
| /blog.html | 0.90 | 24 | 0.91 | 25 | 261 | 12 | none over 66K |
| /blog/agora-and-the-rehearsal-of-public-opinion.html | 0.74 | 19 | 0.75 | 20 | 354 | 10 | /css/brand-overlay.css 103K |
| /blog/bologna-business-school-marketing-reality.html | 0.74 | 20 | 0.74 | 20 | 345 | 9 | /css/brand-overlay.css 103K |
| /blog/building-nishta.html | 0.74 | 20 | 0.74 | 20 | 695 | 9 | /css/brand-overlay.css 103K |
| /blog/carlos-mota-studio-lesson.html | 0.74 | 20 | 0.74 | 20 | 333 | 9 | /css/brand-overlay.css 103K |
| /blog/portfolios-are-products.html | 0.87 | 20 | 0.88 | 21 | 400 | 11 | none over 66K |
| /blog/the-brief-as-a-design-object.html | 0.78 | 22 | 0.78 | 22 | 461 | 11 | /css/brand-overlay.css 103K |
| /blog/what-15k-meta-ads-taught-me.html | 0.76 | 21 | 0.76 | 21 | 345 | 10 | /css/brand-overlay.css 103K |
| /blog/why-industrial-designers-make-better-marketers.html | 0.76 | 21 | 0.76 | 21 | 302 | 10 | /css/brand-overlay.css 103K |
| /blog/why-italy-and-why-now.html | 0.74 | 19 | 0.75 | 20 | 337 | 10 | /css/brand-overlay.css 103K |
| /brand-identity.html | 0.72 | 14 | 0.72 | 14 | 311 | 13 | /brand-identity.html 116K |
| /contact.html | 0.77 | 23 | 0.77 | 23 | 345 | 11 | /css/brand-overlay.css?v=1780012796 103K |
| /cortex/index.html | 0.42 | 10 | 0.42 | 10 | 343 | 9 | /cortex/index.html 33K |
| /demos.html | 1.26 | 26 | 1.27 | 27 | 292 | 11 | /assets/images/DEMOS/agora.jpg 104K |
| /demos/agora.html | 0.47 | 11 | 0.47 | 12 | 256 | 9 | /css/styles.css 66K |
| /demos/audio.html | 0.44 | 11 | 0.44 | 12 | 259 | 9 | /css/styles.css 66K |
| /demos/balls.html | 0.45 | 12 | 0.45 | 12 | 305 | 9 | /css/styles.css 66K |
| /demos/hands.html | 0.47 | 14 | 0.47 | 14 | 1271 | 11 | /css/styles.css 66K |
| /demos/poster.html | 0.44 | 10 | 0.44 | 11 | 279 | 8 | /css/styles.css 66K |
| /demos/roas.html | 0.44 | 10 | 0.44 | 10 | 347 | 7 | /css/styles.css 66K |
| /gallery.html | 4.34 | 43 | 4.34 | 43 | 383 | 11 | /assets/images/FLOWER/img_p10_1.jpeg 667K, /assets/images/FLOWER/img_p11_1.jpeg 450K |
| /index.html | 2.66 | 50 | 2.67 | 51 | 534 | 14 | /assets/images/APEROL/hero.jpg 805K, /assets/images/ARABELLA/hero.jpg 595K |
| /papers/monocular-biomechanics.html | 0.85 | 17 | 0.85 | 17 | 312 | 10 | none over 66K |
| /process.html | 0.76 | 22 | 0.77 | 23 | 258 | 11 | /css/brand-overlay.css?v=1780012796 103K |
| /work.html | 2.62 | 31 | 2.30 | 30 | 384 | 13 | /assets/images/APEROL/hero.jpg 805K, /assets/images/VIGILANTE/cv-landing.png 409K |

Throttled (slow 4G, 4x CPU, 375 px): Home load event 10.1 s, About 34.5 s, Work 9.0 s, Gallery 21.6 s (LCP 9.7 s), Contact 4.6 s, Blog 5.2 s. FCP between 2.2 and 2.7 s on all of them, held back by the render-blocking Google Fonts and CSS, not by the loader.
