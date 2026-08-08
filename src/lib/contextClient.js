'use strict';

const fetch = require('node-fetch');
const cache = require('./cache');

// AbortController is global on Node 18+ (see engines in package.json).

const CONTEXT_API = 'https://api.context.dev/v1/web/scrape/markdown';
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);

/**
 * URLs we keep warm so a cold judge demo never waits on a live scrape.
 */
const WARM_URLS = [
  'https://www.emirates.com/ae/english/help/travel-updates/',
  'https://aviationweather.gov/api/data/metar?ids=OMDB&format=raw',
];

function apiKey() {
  return (process.env.CONTEXT_DEV_API_KEY || '').trim();
}

/**
 * Fetch with a hard timeout. Rejects rather than hanging — every caller
 * has a cache fallback, and ElevenLabs gives us only 20s.
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrape a page to Markdown via context.dev.
 *
 * Always resolves. Degrades: live -> cache -> none.
 *
 * @param {string} url
 * @param {{ includeSelectors?: string[], useMainContentOnly?: boolean, maxAgeMs?: number }} [opts]
 * @returns {Promise<{ data: string|null, source: 'live'|'cache'|'none', cached_at?: string, error?: string }>}
 */
async function scrape(url, opts = {}) {
  const key = apiKey();
  if (!key) return fromCache(url, 'no CONTEXT_DEV_API_KEY configured');

  const qs = new URLSearchParams({ url });
  qs.set('useMainContentOnly', String(opts.useMainContentOnly !== false));
  qs.set('includeImages', 'false');
  // context.dev serves its own edge cache; a 5-minute window keeps the demo
  // fast while still counting as live data.
  qs.set('maxAgeMs', String(opts.maxAgeMs ?? 300000));
  qs.set('timeoutMS', String(TIMEOUT_MS));
  if (Array.isArray(opts.includeSelectors)) {
    for (const s of opts.includeSelectors) qs.append('includeSelectors', s);
  }

  try {
    const res = await fetchWithTimeout(`${CONTEXT_API}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return fromCache(url, `context.dev responded ${res.status}`);
    }
    const body = await res.json();
    const markdown = body && (body.markdown || body.data || null);
    if (!markdown || typeof markdown !== 'string') {
      return fromCache(url, 'context.dev returned no markdown');
    }
    cache.set(url, markdown);
    return { data: markdown, source: 'live' };
  } catch (err) {
    return fromCache(url, err.name === 'AbortError' ? 'scrape timed out' : err.message);
  }
}

/**
 * Plain GET for keyless sources (e.g. aviationweather.gov METAR).
 * Same live -> cache -> none contract as scrape().
 */
async function fetchText(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'text/plain' } });
    if (!res.ok) return fromCache(url, `source responded ${res.status}`);
    const text = (await res.text()).trim();
    if (!text) return fromCache(url, 'source returned empty body');
    cache.set(url, text);
    return { data: text, source: 'live' };
  } catch (err) {
    return fromCache(url, err.name === 'AbortError' ? 'fetch timed out' : err.message);
  }
}

function fromCache(url, error) {
  const entry = cache.get(url);
  if (entry) return { data: entry.data, source: 'cache', cached_at: entry.cached_at, error };
  return { data: null, source: 'none', error };
}

/**
 * Sequentially refresh the warm set. Fire-and-forget on boot; also exposed
 * as POST /admin/warm so we can prime the cache right before the demo.
 */
async function warmCache(urls = WARM_URLS) {
  const warmed = [];
  for (const url of urls) {
    const isMetar = url.includes('aviationweather.gov');
    const result = isMetar ? await fetchText(url) : await scrape(url);
    warmed.push({ url, source: result.source, bytes: result.data ? result.data.length : 0 });
  }
  return warmed;
}

module.exports = { scrape, fetchText, warmCache, WARM_URLS, CONTEXT_API, TIMEOUT_MS };
