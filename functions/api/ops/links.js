// GET  /api/ops/links?days=30 -> { links:[{slug,dest,channel,campaign,content_label,app_label,created,retired,clicks_human,clicks_bot,sessions,pages,active_s,demos,conversions}] }
// POST /api/ops/links {slug,dest,campaign?,content_label?,app_label?} -> 201 {link, warnings:[...]}; 409 duplicate; 400 invalid
import { all, reply, scopeOf, rangeOf } from '../../_lib/ops.js';
import { json } from '../../_lib/http.js';
import { SLUG_RE, LABEL_RE, safeDest, personNameWarnings } from '../../_lib/links.js';
import { KEY_EVENTS } from '../../_lib/catalogue.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const { from, to } = rangeOf(url);
  const w = scopeOf(url).where();
  const keyList = KEY_EVENTS.map((_, i) => `?${i + 3}`).join(',');
  const [links, clicks, sess, demos, conv] = await Promise.all([
    all(env, 'SELECT slug, dest, channel, campaign, content_label, app_label, created, retired FROM links ORDER BY created DESC LIMIT 500'),
    all(env, 'SELECT slug, SUM(is_bot = 0) AS human, SUM(is_bot = 1) AS bot FROM link_clicks WHERE ts >= ?1 AND ts < ?2 GROUP BY slug', [from, to]),
    all(env, `SELECT link AS slug, COUNT(*) AS sessions, SUM(pages) AS pages, SUM(active_ms) AS active_ms FROM sessions WHERE link IS NOT NULL AND first_ts >= ?1 AND first_ts < ?2 AND ${w} GROUP BY link`, [from, to]),
    all(env, `SELECT link AS slug, COUNT(DISTINCT sid) AS n FROM events WHERE link IS NOT NULL AND name = 'demo_open' AND ts >= ?1 AND ts < ?2 AND ${w} GROUP BY link`, [from, to]),
    all(env, `SELECT link AS slug, COUNT(*) AS n FROM events WHERE link IS NOT NULL AND ts >= ?1 AND ts < ?2 AND name IN (${keyList}) AND ${w} GROUP BY link`, [from, to, ...KEY_EVENTS]),
  ]);
  const idx = (rows) => new Map(rows.map((r) => [r.slug, r]));
  const c = idx(clicks), s = idx(sess), d = idx(demos), v = idx(conv);
  return reply(url, {
    links: links.map((l) => ({
      ...l,
      clicks_human: c.get(l.slug)?.human || 0, clicks_bot: c.get(l.slug)?.bot || 0,
      sessions: s.get(l.slug)?.sessions || 0, pages: s.get(l.slug)?.pages || 0,
      active_s: Math.round((s.get(l.slug)?.active_ms || 0) / 1000),
      demos: d.get(l.slug)?.n || 0, conversions: v.get(l.slug)?.n || 0,
    })),
  });
}

export async function onRequestPost({ env, request }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const slug = String(b.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 64) return json({ error: 'slug', hint: 'prefix li cv qr em gh ig pdf, then lowercase words' }, 400);
  const dest = safeDest(b.dest);
  if (!dest) return json({ error: 'dest', hint: 'own domain only (saikanagat.com)' }, 400);
  const labels = {};
  for (const k of ['campaign', 'content_label', 'app_label']) {
    const v = b[k] == null || b[k] === '' ? null : String(b[k]).toLowerCase();
    if (v !== null && (!LABEL_RE.test(v) || v.length > 48)) return json({ error: k }, 400);
    labels[k] = v;
  }
  const warnings = personNameWarnings(labels.campaign, labels.content_label, labels.app_label, slug.split('-').slice(1).join(' '));
  const row = { slug, dest, channel: slug.split('-')[0], ...labels, created: Date.now(), retired: 0 };
  const r = await env.DB.prepare('INSERT OR IGNORE INTO links (slug, dest, channel, campaign, content_label, app_label, created, retired) VALUES (?1,?2,?3,?4,?5,?6,?7,0)')
    .bind(row.slug, row.dest, row.channel, row.campaign, row.content_label, row.app_label, row.created).run();
  if (!r.meta.changes) return json({ error: 'duplicate' }, 409);
  return json({ link: row, warnings }, 201);
}
