// Link registry rules shared by /go, /api/ops/links and tools/link.
export const CHANNELS = ['li', 'cv', 'qr', 'em', 'gh', 'ig', 'pdf'];
export const MEDIUM = { li: 'social', ig: 'social', gh: 'referral', em: 'email', cv: 'document', pdf: 'document', qr: 'print' };
export const SLUG_RE = /^(li|cv|qr|em|gh|ig|pdf)-[a-z0-9]+(-[a-z0-9]+)*$/;
export const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Destinations: only the site's own domain (or a root-relative path).
export function safeDest(dest, baseOrigin = 'https://saikanagat.com') {
  if (typeof dest !== 'string' || dest.length > 500 || /[\u0000-\u001f\u007f\\]/.test(dest)) return null;
  if (dest.startsWith('/') && !dest.startsWith('//')) {
    return new URL(dest, baseOrigin).toString();
  }
  let u;
  try { u = new URL(dest); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h !== 'saikanagat.com' && !h.endsWith('.saikanagat.com')) return null;
  return u.toString();
}

export function buildTarget(row, baseOrigin) {
  const dest = safeDest(row.dest, baseOrigin);
  if (!dest) return null;
  const u = new URL(dest);
  u.searchParams.set('utm_source', row.channel);
  u.searchParams.set('utm_medium', MEDIUM[row.channel] || 'link');
  if (row.campaign) u.searchParams.set('utm_campaign', row.campaign);
  const content = row.content_label || row.app_label;
  if (content) u.searchParams.set('utm_content', content);
  u.searchParams.set('sk_l', row.slug);
  return u.toString();
}

// Heuristic only. Links are never to be named after a person, so a label that
// looks like "firstname-lastname" or starts with a common first name warns.
const FIRST = new Set(('anna andrea alessandro alessia alice amit ankit arjun ashok bruno carla carlo chiara christian claudia daniel david davide elena elisa emma enrico fabio federica filippo francesca francesco giorgia giorgio giovanni giulia giuseppe james john jonas julia kiran laura lorenzo lucia luca luigi manuel marco maria mario marta martina matteo michael michele nicola paola paolo pietro priya rahul raj ravi riccardo roberto rohan sara sarah simone sofia stefano sunil tommaso valentina vikram vincenzo').split(' '));
const COMMON = new Set(('growth design marketing brand product social media content strategy analyst manager lead intern junior senior studio agency post role cv resume portfolio demo demos blog work about contact hire thallo cortex agora melt shadow theatre hands balls audio poster roas autopsy positioning mapper email linkedin github instagram print qr card flyer pdf deck case study paper monocular aperol golden hour opening launch update note digital director specialist executive associate coordinator consultant engineer developer designer research data sales').split(' '));

export function personNameWarnings(...labels) {
  const out = [];
  for (const raw of labels) {
    if (!raw) continue;
    const toks = String(raw).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (!toks.length) continue;
    const named = toks.filter((t) => FIRST.has(t) && !COMMON.has(t));
    const twoWords = toks.length === 2 && toks.every((t) => t.length >= 3 && !COMMON.has(t));
    if (named.length || twoWords) out.push(`"${raw}" looks like a person's name; use a company or post label instead`);
  }
  return out;
}
