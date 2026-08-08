'use strict';

/**
 * The layer between "a caller asked something" and "which page answers it".
 *
 * Two strategies, tried in order:
 *
 *   1. Configured sources (src/data/sources.js) — hand-verified URLs whose
 *      content we know the shape of, so the parser can be precise.
 *   2. context.dev web search over an allowlist of airline, government and
 *      regulator domains — imprecise, slower, but unbounded in coverage.
 *
 * The registry alone cannot answer "what do I need for Nigeria"; search alone
 * would answer it from whatever ranks first that day. Together the common path
 * stays fast and exact, and the long tail still gets an answer with a source
 * attached to it.
 */

const ctx = require('./contextClient');
const advisory = require('./advisory');
const { sourcesFor, searchDomainsFor } = require('../data/sources');

/**
 * Scrape every configured source for a topic, newest attempt first.
 *
 * @returns {Promise<Array<{key:string,label:string,url:string,markdown:string|null,source:string}>>}
 */
async function readTopic(topic, region) {
  const configured = sourcesFor(topic, region);
  const out = [];
  for (const s of configured) {
    const result = await ctx.scrape(s.url, s.scrape || {});
    out.push({
      key: s.key,
      label: s.label,
      url: s.url,
      markdown: result.data,
      source: result.source,
    });
  }
  return out;
}

/** Sentences that actually bear on the question, rather than the whole page. */
function relevantSentences(markdown, question, limit = 3) {
  if (!markdown) return [];
  const stop = new Set([
    'what', 'when', 'where', 'which', 'does', 'do', 'i', 'a', 'an', 'the', 'to', 'for',
    'is', 'are', 'my', 'me', 'need', 'from', 'and', 'of', 'in', 'on', 'can', 'with',
    'about', 'there', 'any', 'am', 'be', 'it', 'that', 'this', 'you', 'your',
  ]);
  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  if (!terms.length) return [];

  return advisory
    .sentences(markdown)
    .map((s) => {
      const hay = s.toLowerCase();
      return { s, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0 && x.s.length > 40 && x.s.length < 400)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/**
 * Answer an arbitrary travel question from trusted domains via context.dev
 * search, scraping each hit in the same round trip.
 *
 * @returns {Promise<{answer:string|null, sources:Array<{title:string,url:string}>, source:string}>}
 */
async function searchTrusted(question, destination) {
  const query = destination ? `${question} ${destination}` : question;

  // Two stages on purpose. Asking search to scrape all ten hits inline is one
  // round trip but measured ~11s, which leaves nothing for the rest of the
  // turn. Search alone is ~3.6s, and we only ever read one or two pages aloud,
  // so we search cheaply and then fetch just the top hit through the normal
  // cached scrape path. Same answer, roughly half the latency, and a repeat
  // question is instant.
  const found = await ctx.search(query, { domains: searchDomainsFor(destination), scrape: false });
  if (!found.results.length) return { answer: null, sources: [], source: found.source };

  const top = found.results[0];
  // 5s hard cap. If the page is cold this will miss, and missing is fine —
  // the descriptions below are a real answer. What is not fine is spending the
  // caller's whole turn on a page that may not even contain what they asked.
  const scraped = await ctx.scrape(top.url, {
    useMainContentOnly: true,
    maxAgeMs: 3600000,
    timeoutMs: 4000,
  });
  const hits = relevantSentences(scraped.data, query, 3);

  if (hits.length) {
    return {
      answer: advisory.truncate(hits.join(' '), 480),
      sources: [{ title: top.title || top.url, url: top.url }],
      source: scraped.source === 'none' ? found.source : scraped.source,
    };
  }

  // The page had nothing matching, or would not load. The search engine's own
  // descriptions are worse but real, and better than telling a stranded
  // passenger we have nothing.
  const withDesc = found.results.filter((r) => r.description).slice(0, 2);
  if (!withDesc.length) return { answer: null, sources: [], source: found.source };

  return {
    answer: advisory.truncate(withDesc.map((r) => r.description).join(' '), 480),
    sources: withDesc.map((r) => ({ title: r.title || r.url, url: r.url })),
    source: found.source,
  };
}

module.exports = { readTopic, relevantSentences, searchTrusted };
