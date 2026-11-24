// User agent helpers. Only used to flag bots and bucket device class. The UA
// string itself is never stored.

const BOT_RE = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'preview', 'fetcher', 'scanner', 'monitor',
    'facebookexternalhit', 'facebot', 'whatsapp', 'telegram', 'discord', 'slack',
    'skype', 'linkedin', 'twitter', 'pinterest', 'embedly', 'quora', 'redditbot',
    'googleother', 'google-read-aloud', 'adsbot', 'mediapartners', 'lighthouse', 'pagespeed',
    'chrome-lighthouse', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright',
    'curl/', 'wget/', 'python', 'go-http-client', 'java/', 'okhttp', 'node-fetch',
    'undici', 'axios', 'libwww', 'httpclient', 'postmanruntime', 'insomnia',
    'gptbot', 'chatgpt', 'oai-searchbot', 'claudebot', 'claude-web', 'anthropic',
    'perplexity', 'bytespider', 'ccbot', 'amazonbot', 'applebot', 'duckduckbot',
    'yandex', 'baidu', 'semrush', 'ahrefs', 'mj12', 'dotbot', 'petalbot', 'sogou',
    'msoffice', 'microsoft office', 'safelinks', 'barracuda', 'proofpoint', 'mimecast',
  ].join('|'),
  'i'
);

export function isBotUA(ua) {
  if (!ua || ua.length < 8) return true;
  return BOT_RE.test(ua);
}

// Headless Chrome is allowed through /api/e only for flagged test traffic.
export function isHeadlessOnly(ua) {
  return !!ua && /headlesschrome/i.test(ua) && !isBotUA(ua.replace(/headlesschrome/gi, ''));
}

export function deviceOf(ua) {
  if (!ua) return 'unknown';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  return 'desktop';
}
