// Origin allow list for the ingest endpoint.
// Production: saikanagat.com, any *.saikanagat.com (studio split), the Pages
// project host and its hash or branch previews. Local development origins are
// accepted only when the ALLOW_LOCAL_ORIGINS binding is "1".

const OWN = ['saikanagat.com', 'saikanagat-7yg.pages.dev'];

export function hostAllowed(hostname) {
  const h = hostname.toLowerCase();
  return OWN.some((d) => h === d || h.endsWith('.' + d));
}

export function originAllowed(value, env) {
  if (!value || typeof value !== 'string' || value.length > 200) return false;
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (env && env.ALLOW_LOCAL_ORIGINS === '1') {
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return u.protocol === 'http:' || u.protocol === 'https:';
  }
  if (u.protocol !== 'https:') return false;
  return hostAllowed(u.hostname);
}

// Origin header first, Referer second. No header at all means not a browser.
export function requestOriginAllowed(request, env) {
  const o = request.headers.get('origin');
  if (o && o !== 'null') return originAllowed(o, env);
  if (o === 'null') return false;
  const r = request.headers.get('referer');
  if (r) {
    try {
      return originAllowed(new URL(r).origin, env);
    } catch {
      return false;
    }
  }
  return false;
}
