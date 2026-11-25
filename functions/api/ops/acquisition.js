// GET /api/ops/acquisition?days=7 -> { sessions, visitors,
//   channels:[{channel,sessions,visitors,active_s}],   visitors are DISTINCT per channel (counted in SQL, not summed over groups)
//   referrers:[{ref_host,sessions}],                   general list, top 25
//   ai_referrers:[{ref_host,sessions}], search_referrers:[{ref_host,sessions}],   every host of that class, no 25 row cap
//   utm:[{utm_source,utm_medium,utm_campaign,sessions}],                          top 25
//   ai_utm:[...], search_utm:[...],                                               every tag combination whose source names an assistant or a search engine
//   countries:[{country,sessions}] }
// Channel rules live in functions/_lib/ops.js (channelOf and CHANNEL_SQL are built from the same list). A tracked link wins over everything;
// then a utm_source that names an AI assistant (chatgpt.com, perplexity, gemini, copilot, claude, ...) counts as channel ai; then other tags; then the referrer.
import { all, one, reply, scopeOf, rangeOf, CHANNEL_SQL, AI_SQL, SEARCH_SQL } from '../../_lib/ops.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const { from, to } = rangeOf(url);
  const w = scopeOf(url).where();
  const base = `FROM sessions WHERE first_ts >= ?1 AND first_ts < ?2 AND ${w}`;
  const [total, channels, referrers, aiRef, searchRef, utm, aiUtm, searchUtm, countries] = await Promise.all([
    one(env, `SELECT COUNT(*) AS n, COUNT(DISTINCT vid) AS v ${base}`, [from, to]),
    all(env, `SELECT ${CHANNEL_SQL} AS channel, COUNT(*) AS sessions, COUNT(DISTINCT vid) AS visitors, SUM(active_ms) AS active_ms ${base} GROUP BY channel`, [from, to]),
    all(env, `SELECT ref_host, COUNT(*) AS sessions ${base} AND ref_host IS NOT NULL GROUP BY ref_host ORDER BY sessions DESC LIMIT 25`, [from, to]),
    all(env, `SELECT ref_host, COUNT(*) AS sessions ${base} AND ref_host IS NOT NULL AND ${AI_SQL('ref_host')} GROUP BY ref_host ORDER BY sessions DESC`, [from, to]),
    all(env, `SELECT ref_host, COUNT(*) AS sessions ${base} AND ref_host IS NOT NULL AND ${SEARCH_SQL('ref_host')} GROUP BY ref_host ORDER BY sessions DESC`, [from, to]),
    all(env, `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS sessions ${base} AND utm_source IS NOT NULL GROUP BY 1,2,3 ORDER BY sessions DESC LIMIT 25`, [from, to]),
    all(env, `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS sessions ${base} AND utm_source IS NOT NULL AND ${AI_SQL('utm_source')} GROUP BY 1,2,3 ORDER BY sessions DESC`, [from, to]),
    all(env, `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS sessions ${base} AND utm_source IS NOT NULL AND ${SEARCH_SQL('utm_source', true)} GROUP BY 1,2,3 ORDER BY sessions DESC`, [from, to]),
    all(env, `SELECT country, COUNT(*) AS sessions ${base} GROUP BY country ORDER BY sessions DESC LIMIT 25`, [from, to]),
  ]);
  const chans = channels
    .map((c) => ({ channel: c.channel, sessions: c.sessions, visitors: c.visitors, active_s: Math.round((c.active_ms || 0) / 1000) }))
    .sort((a, b) => b.sessions - a.sessions);
  return reply(url, {
    sessions: total.n || 0, visitors: total.v || 0, channels: chans,
    referrers, ai_referrers: aiRef, search_referrers: searchRef,
    utm, ai_utm: aiUtm, search_utm: searchUtm, countries,
  });
}
