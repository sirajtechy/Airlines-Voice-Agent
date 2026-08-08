'use strict';

const fetch = require('node-fetch');
const cache = require('./cache');

// AbortController is global on Node 18+ (see engines in package.json).

const CONTEXT_BASE = 'https://api.context.dev/v1';
const CONTEXT_API = `${CONTEXT_BASE}/web/scrape/markdown`;
const SEARCH_API = `${CONTEXT_BASE}/web/search`;
const MONITORS_API = `${CONTEXT_BASE}/monitors`;
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
// Search costs a round trip through a search engine plus N page scrapes, so it
// runs slower than a plain scrape (~10s measured). It is a fallback, never the
// first thing we try, and it gets its own tighter budget.
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 8000);

const { warmSources, MAX_SEARCH_DOMAINS } = require('../data/sources');

/**
 * URLs we keep warm so a cold judge demo never waits on a live scrape.
 * Derived from the source registry so adding a warm source is a one-line edit.
 */
const WARM_URLS = warmSources().map((s) => s.url);

function apiKey() {
  return (process.env.CONTEXT_DEV_API_KEY || '').trim();
}

/**
 * Fetch with a hard timeout. Rejects rather than hanging — every caller
 * has a cache fallback, and ElevenLabs gives us only 20s.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  // Per-call budget: a fallback path must not spend the whole turn.
  const budget = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS;
  qs.set('timeoutMS', String(budget));
  if (Array.isArray(opts.includeSelectors)) {
    for (const s of opts.includeSelectors) qs.append('includeSelectors', s);
  }

  try {
    const res = await fetchWithTimeout(
      `${CONTEXT_API}?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
      budget
    );
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

/**
 * context.dev web search, optionally scraping each hit to Markdown in the same
 * round trip.
 *
 * This is the answer to "a caller asked about somewhere we never configured".
 * A registry of hand-picked URLs cannot cover every destination an Emirates
 * passenger might name; search can, and restricting it to an allowlist of
 * airline/government domains keeps the agent from reading a travel blog aloud
 * as if it were policy.
 *
 * Always resolves. Cached under a synthetic key so a repeat question inside
 * the demo is instant and costs no credits.
 *
 * @param {string} query
 * @param {{domains?: string[], numResults?: number, scrape?: boolean, freshness?: string}} [opts]
 * @returns {Promise<{results: Array, source: 'live'|'cache'|'none', error?: string}>}
 */
async function search(query, opts = {}) {
  const key = apiKey();
  const cacheKey = `search:${query}:${(opts.domains || []).join(',')}`;
  if (!key) return searchFromCache(cacheKey, 'no CONTEXT_DEV_API_KEY configured');

  const body = {
    query,
    // The API floor is 10; asking for fewer is a 400.
    numResults: Math.max(10, opts.numResults || 10),
    timeoutMS: SEARCH_TIMEOUT_MS,
  };
  // Hard API cap at 10; exceeding it is a 400 that silently kills the fallback.
  if (opts.domains?.length) body.includeDomains = opts.domains.slice(0, MAX_SEARCH_DOMAINS);
  if (opts.freshness) body.freshness = opts.freshness;
  if (opts.scrape !== false) {
    body.markdownOptions = { enabled: true, useMainContentOnly: true, includeLinks: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(SEARCH_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return searchFromCache(cacheKey, `context.dev search responded ${res.status}`);

    const json = await res.json();
    const results = (json?.results || [])
      .map((r) => ({
        url: r.url,
        title: r.title,
        description: r.description,
        // markdown arrives as {markdown, code} — flatten and drop misses.
        markdown: typeof r.markdown === 'object' ? r.markdown?.markdown || null : r.markdown || null,
      }))
      .filter((r) => r.url);

    if (!results.length) return searchFromCache(cacheKey, 'search returned no results');
    cache.set(cacheKey, JSON.stringify(results));
    return { results, source: 'live' };
  } catch (err) {
    return searchFromCache(cacheKey, err.name === 'AbortError' ? 'search timed out' : err.message);
  }
}

function searchFromCache(cacheKey, error) {
  const entry = cache.get(cacheKey);
  if (entry) {
    try {
      return { results: JSON.parse(entry.data), source: 'cache', cached_at: entry.cached_at, error };
    } catch (_) {
      // fall through
    }
  }
  return { results: [], source: 'none', error };
}

/**
 * Thin wrapper over the Monitors API. Used by scripts/setup-monitor.js and by
 * /healthz; the running server never needs to create monitors itself.
 */
async function monitors(method, path = '', body) {
  const key = apiKey();
  if (!key) throw new Error('CONTEXT_DEV_API_KEY is not set');
  const res = await fetchWithTimeout(`${MONITORS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`monitors ${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
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

module.exports.search = search;
module.exports.monitors = monitors;
module.exports.SEARCH_API = SEARCH_API;
module.exports.MONITORS_API = MONITORS_API;

/**
 * Keep the warm set fresh in the background.
 *
 * Without this, a served `source: "cache"` could be hours old and we would
 * still be calling it current. Re-warming on a timer bounds staleness to the
 * interval, which is what makes the `cached_at` we report defensible.
 *
 * `unref()` so the timer never holds the process open — tests and Ctrl-C must
 * still exit cleanly.
 */
function startBackgroundRefresh(intervalMs = Number(process.env.CACHE_REFRESH_MS || 300000)) {
  if (intervalMs <= 0) return null;
  const timer = setInterval(() => {
    warmCache()
      .then((w) => console.log(`${new Date().toISOString()} cache refreshed ${JSON.stringify(w)}`))
      .catch((e) => console.log(`${new Date().toISOString()} cache refresh failed (non-fatal) ${e.message}`));
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = {
  scrape,
  fetchText,
  search,
  monitors,
  warmCache,
  startBackgroundRefresh,
  WARM_URLS,
  CONTEXT_API,
  SEARCH_API,
  MONITORS_API,
  TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
};
