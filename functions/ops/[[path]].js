// Serves the dashboard from the Function bundle, after functions/ops/_middleware.js has checked the login.
import assets from '../_lib/ops-assets.js';

export function onRequestGet({ request }) {
  const { pathname } = new URL(request.url);
  if (pathname === '/ops') return new Response(null, { status: 302, headers: { Location: '/ops/' } });
  const name = pathname.slice('/ops/'.length) || 'index.html';
  const a = Object.prototype.hasOwnProperty.call(assets, name) ? assets[name] : null;
  if (!a) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(a[1], { headers: { 'Content-Type': a[0] } });
}
