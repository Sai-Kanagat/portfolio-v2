// POST /api/ops/links/retire {slug} -> {slug, retired:1}. Retired links still redirect.
import { json } from '../../../_lib/http.js';
import { SLUG_RE } from '../../../_lib/links.js';

export async function onRequestPost({ env, request }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const slug = String(b.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: 'slug' }, 400);
  const r = await env.DB.prepare('UPDATE links SET retired = 1 WHERE slug = ?1').bind(slug).run();
  return r.meta.changes ? json({ slug, retired: 1 }) : json({ error: 'not_found' }, 404);
}
