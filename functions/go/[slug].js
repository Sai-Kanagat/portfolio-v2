// GET /go/<slug>: aggregate click log, 302 to the registered destination with
// UTMs and sk_l. Only own-domain destinations are followed; anything else, an
// unknown slug or a malformed slug goes to "/". Retired links still redirect.
// Nothing about the visitor is stored except country, device class and a bot
// flag. The redirect never waits for, or fails because of, the log write.
import { countryOf } from '../_lib/http.js';
import { isBotUA, deviceOf } from '../_lib/ua.js';
import { SLUG_RE, buildTarget } from '../_lib/links.js';

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'origin' },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const slug = String(Array.isArray(params.slug) ? params.slug[0] : params.slug || '').toLowerCase();
  if (slug.length > 64 || !SLUG_RE.test(slug)) return redirect('/');
  const base = (env.CANONICAL_ORIGIN || 'https://saikanagat.com').replace(/\/+$/, '');
  let row = null;
  try {
    row = await env.DB.prepare('SELECT slug, dest, channel, campaign, content_label, app_label, retired FROM links WHERE slug = ?1').bind(slug).first();
  } catch {
    return redirect('/');
  }
  if (!row) return redirect('/');
  const target = buildTarget(row, base);
  if (!target) return redirect('/');

  const ua = request.headers.get('user-agent') || '';
  const purpose = (request.headers.get('sec-purpose') || request.headers.get('purpose') || request.headers.get('x-moz') || '').toLowerCase();
  const bot = request.method === 'HEAD' || isBotUA(ua) || purpose.includes('prefetch') || purpose.includes('preview');
  context.waitUntil(
    env.DB.prepare('INSERT INTO link_clicks (ts, slug, country, device, is_bot) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(Date.now(), slug, countryOf(request), deviceOf(ua), bot ? 1 : 0)
      .run()
      .catch(() => {})
  );
  return redirect(target);
}
