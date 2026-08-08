'use strict';

/**
 * Every live web source the agent reads, in one registry.
 *
 * All of these were verified by an actual scrape before being added — three
 * other plausible-looking Emirates URLs (delayed-baggage, visa-passport-
 * information, dubaiairports flight-information) returned 404 and were left
 * out. A configured dead URL is worse than no source at all: it burns the
 * request budget and returns nothing, and the caller waits for it.
 *
 * `topics` drives routing: a tool says what it is looking for, and the
 * registry answers which pages could plausibly contain it. Anything not
 * covered here falls through to context.dev web search — see
 * src/lib/liveSources.js.
 */

const SOURCES = {
  emirates_updates: {
    url: 'https://www.emirates.com/ae/english/help/travel-updates/',
    label: 'Emirates travel updates',
    topics: ['disruption', 'suspension', 'entry_restriction', 'transit', 'support', 'entry_requirements'],
    // The advisory is the demo's spine and changes without notice; keep it warm.
    warm: true,
    scrape: { useMainContentOnly: true },
  },
  uk_eta: {
    url: 'https://www.gov.uk/electronic-travel-authorisation',
    label: 'UK Electronic Travel Authorisation (gov.uk)',
    topics: ['entry_requirements'],
    regions: ['uk'],
    warm: true,
    scrape: { useMainContentOnly: true },
  },
  eu_ees: {
    url: 'https://travel-europe.europa.eu/ees_en',
    label: 'EU Entry/Exit System (European Commission)',
    topics: ['entry_requirements'],
    regions: ['schengen'],
    warm: true,
    scrape: { useMainContentOnly: true },
  },
  emirates_delays_faq: {
    url: 'https://www.emirates.com/ae/english/help/faq-topics/delays-and-cancellations/',
    label: 'Emirates delays and cancellations FAQ',
    topics: ['policy', 'disruption'],
    warm: false,
    scrape: { useMainContentOnly: true },
  },
};

/**
 * Keyless sources. No API key, no credit cost, so they are always tried live.
 */
const KEYLESS = {
  metar_omdb: {
    url: 'https://aviationweather.gov/api/data/metar?ids=OMDB&format=raw',
    label: 'Dubai METAR (aviationweather.gov)',
    warm: true,
  },
};

/**
 * Domains we will accept an answer from when falling back to web search.
 *
 * Deliberately narrow. An airline agent that reads a random blog aloud as
 * though it were policy is worse than one that admits it does not know, so
 * the allowlist is airlines, governments and regulators only.
 *
 * The context.dev search API caps includeDomains at 10, so this list is a
 * budget, not a wishlist — ordered by how often an Emirates passenger's
 * question is actually answered there.
 */
const MAX_SEARCH_DOMAINS = 10;
const TRUSTED_SEARCH_DOMAINS = [
  'emirates.com',
  'gov.uk',
  'europa.eu',
  'u.ae',
  'gcaa.gov.ae',
  'dubaiairports.ae',
  'iata.org',
  'icao.int',
  'travel.state.gov',
  'canada.ca',
];

function warmSources() {
  const out = [];
  for (const [key, s] of Object.entries(SOURCES)) if (s.warm) out.push({ key, ...s, keyless: false });
  for (const [key, s] of Object.entries(KEYLESS)) if (s.warm) out.push({ key, ...s, keyless: true });
  return out;
}

/** Configured sources that claim to cover `topic`, optionally scoped to a region. */
function sourcesFor(topic, region) {
  return Object.entries(SOURCES)
    .filter(([, s]) => s.topics.includes(topic))
    .filter(([, s]) => !region || !s.regions || s.regions.includes(region))
    .map(([key, s]) => ({ key, ...s }));
}

module.exports = {
  SOURCES,
  KEYLESS,
  TRUSTED_SEARCH_DOMAINS,
  MAX_SEARCH_DOMAINS,
  warmSources,
  sourcesFor,
};
