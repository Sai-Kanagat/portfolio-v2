// Root middleware. 1) The production pages.dev host 301s to the canonical
// origin (hash-prefixed previews and branch aliases never do). 2) HTML pages
// get data-cr="eea|other" on <html> from the visitor's country, used by
// js/consent.js. Unknown country counts as eea. Any failure falls back to the
// untouched response.
import { countryOf } from './_lib/http.js';
import { guard } from './_lib/access.js';

// Pages decodes %6f and %2f when it picks a static file, but routes Functions on
// the raw path, so /%6fps/app.js would skip functions/ops/_middleware.js. The
// decoded path is checked here, for every request.
export function privatePath(pathname) {
  let p = pathname;
  // Byte by byte, so a malformed escape elsewhere in the path cannot make this throw.
  for (let i = 0; i < 4; i++) {
    const d = p.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (d === p) break;
    p = d;
  }
  const out = [];
  for (const seg of p.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out[0] === 'ops' || (out[0] === 'api' && out[1] === 'ops');
}

// Same list as the consent default in each page head.
export const EEA = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(' '));

export function regionOf(country) {
  return country && !EEA.has(country) ? 'other' : 'eea';
}

export async function onRequest(context) {
  const { request, env, next } = context;
  try {
    const url = new URL(request.url);
    const prodHost = (env.PRODUCTION_PAGES_HOST || 'saikanagat-7yg.pages.dev').toLowerCase();
    if (url.hostname.toLowerCase() === prodHost) {
      const origin = (env.CANONICAL_ORIGIN || 'https://saikanagat.com').replace(/\/+$/, '');
      const safe = request.method === 'GET' || request.method === 'HEAD';
      return new Response(null, {
        status: safe ? 301 : 308,
        headers: { Location: origin + url.pathname + url.search, 'Cache-Control': 'public, max-age=3600' },
      });
    }
  } catch {
    /* fall through */
  }
  // Fails closed, unlike the rest of this file: a thrown error here must not serve /ops.
  const pathname = new URL(request.url).pathname;
  if (privatePath(pathname)) return guard(context, { api: /^\/api\//i.test(pathname) });
  const res = await next();
  try {
    const type = res.headers.get('content-type') || '';
    if (!type.toLowerCase().startsWith('text/html') || !res.body) return res;
    const region = regionOf(countryOf(request));
    const out = new HTMLRewriter()
      .on('html', { element(el) { el.setAttribute('data-cr', region); } })
      .transform(res);
    // Output depends on the visitor's country, so shared caches must not reuse it.
    if (!/no-store/i.test(res.headers.get('cache-control') || '')) out.headers.set('Cache-Control', 'private, no-cache');
    out.headers.delete('ETag');
    return out;
  } catch {
    return res;
  }
}
