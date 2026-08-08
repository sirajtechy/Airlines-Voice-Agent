'use strict';

/**
 * Heuristic parsing of the Emirates travel-updates page (scraped to Markdown).
 * The page is prose, not an API, so we work in sentences: find the ones that
 * mention the destination, then classify them.
 */

const { cityToIata, airports } = require('../data/mocks');

/** Split markdown into sentence-ish chunks, stripping markdown noise. */
function sentences(markdown) {
  return String(markdown)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // unwrap links
    .replace(/[#*_>`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Every spelling of a destination we should match on: the raw input, the city
 * name behind an airport code, and the code behind a city name.
 */
function aliasesFor(destination) {
  const raw = String(destination || '').trim();
  const lower = raw.toLowerCase();
  const set = new Set();
  if (lower) set.add(lower);

  const asCode = raw.toUpperCase();
  if (airports[asCode]) set.add(airports[asCode].city.toLowerCase());

  const asIata = cityToIata[lower];
  if (asIata) {
    set.add(asIata.toLowerCase());
    if (airports[asIata]) set.add(airports[asIata].city.toLowerCase());
  }
  return [...set].filter((a) => a.length >= 3);
}

function mentions(sentence, aliases) {
  const hay = sentence.toLowerCase();
  return aliases.some((a) => new RegExp(`\\b${escapeRe(a)}\\b`).test(hay));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUSPENSION_RE = /\b(suspend|suspended|suspension|cancell?ed|not operat|will not operate|remain cancelled)\b/i;
const RESUME_RE = /\b(resume|resuming|resumption|will operate|reinstat)\b/i;
const EXTENDED_RE = /\b(extend|extended|further extended|until further notice)\b/i;
const TRANSIT_BLOCK_RE = /\b(transit|transiting|connecting)\b[^.]*\b(will not be accepted|not be accepted|cannot be accepted|are not accepted|unable to accept)\b/i;
const TRANSIT_OK_RE = /\b(transit|transiting|connecting)\b[^.]*\b(will be accepted|are accepted|can be accepted|resume)\b/i;
const SUPPORT_RE = /\b(hotel|accommodation|meal|voucher|refreshment|rebook|rebooking|assistance|support desk|transfer desk)\b/i;

/** Pull a date out of advisory prose: "until 10 August 2026", "until 2026-08-10". */
function extractDate(text) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const months = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };
  const m = text.match(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(20\d{2})?/i
  );
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = months[m[2].toLowerCase()];
    const year = m[3] || String(new Date().getUTCFullYear());
    return `${year}-${month}-${day}`;
  }
  return null;
}

function truncate(text, max) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @returns {{suspended:boolean, suspended_until:string|null, extended_before:boolean, advisory_text:string, matched:boolean}}
 */
function parseDisruption(markdown, destination) {
  const aliases = aliasesFor(destination);
  const all = markdown ? sentences(markdown) : [];
  const hitIndexes = all.map((s, i) => (mentions(s, aliases) ? i : -1)).filter((i) => i >= 0);
  const hits = hitIndexes.map((i) => all[i]);

  if (!hits.length) {
    return {
      suspended: false,
      suspended_until: null,
      extended_before: false,
      advisory_text: `No current suspension found for ${destination}.`,
      matched: false,
    };
  }

  // Advisories carry qualifiers ("this has been extended", "until 10 August")
  // in the sentence *after* the one naming the route, so read a small window
  // around each hit rather than the hit alone.
  const window = new Set();
  for (const i of hitIndexes) {
    for (let j = i; j <= Math.min(i + 1, all.length - 1); j++) window.add(j);
  }
  const blob = [...window].sort((a, b) => a - b).map((i) => all[i]).join(' ');

  // A "resume" sentence beats a "suspend" sentence only when it is the later word.
  const suspended = SUSPENSION_RE.test(blob) && !(RESUME_RE.test(blob) && !SUSPENSION_RE.test(hits[0]));
  const relevant = hits.find((s) => SUSPENSION_RE.test(s)) || hits[0];

  return {
    suspended,
    suspended_until: extractDate(blob),
    extended_before: EXTENDED_RE.test(blob),
    advisory_text: truncate(relevant, 300),
    matched: true,
  };
}

/**
 * @returns {{transit_allowed:boolean, explanation:string, matched:boolean}}
 */
function parseTransitRules(markdown, origin, finalDestination) {
  const aliases = aliasesFor(finalDestination);
  const hits = markdown ? sentences(markdown).filter((s) => mentions(s, aliases)) : [];
  const blocked = hits.find((s) => TRANSIT_BLOCK_RE.test(s));

  if (blocked) {
    return {
      transit_allowed: false,
      explanation: truncate(
        `Transit through Dubai to ${finalDestination} is not being accepted right now. ${blocked}`,
        250
      ),
      matched: true,
    };
  }

  const allowed = hits.find((s) => TRANSIT_OK_RE.test(s));
  if (allowed) {
    return {
      transit_allowed: true,
      explanation: truncate(`Transit through Dubai to ${finalDestination} is being accepted. ${allowed}`, 250),
      matched: true,
    };
  }

  // Route suspended but transit not called out — connecting travel is effectively off.
  const disruption = parseDisruption(markdown, finalDestination);
  if (disruption.matched && disruption.suspended) {
    return {
      transit_allowed: false,
      explanation: truncate(
        `Flights to ${finalDestination} are suspended, so a connection through Dubai cannot be completed. ${disruption.advisory_text}`,
        250
      ),
      matched: true,
    };
  }

  return {
    transit_allowed: true,
    explanation: `No transit restriction is published for passengers travelling from ${origin} through Dubai to ${finalDestination}. Check in as normal, and confirm at the transfer desk on arrival.`,
    matched: disruption.matched,
  };
}

/**
 * Pull passenger-support language (hotels, meals, vouchers) out of the advisory.
 * @returns {string|null}
 */
function parseSupportText(markdown, location) {
  if (!markdown) return null;
  const aliases = aliasesFor(location);
  const all = sentences(markdown);
  const scoped = all.filter((s) => SUPPORT_RE.test(s) && mentions(s, aliases));
  const generic = all.filter((s) => SUPPORT_RE.test(s));
  const picked = (scoped.length ? scoped : generic).slice(0, 3);
  if (!picked.length) return null;
  return truncate(picked.join(' '), 600);
}

module.exports = {
  parseDisruption,
  parseTransitRules,
  parseSupportText,
  sentences,
  aliasesFor,
  extractDate,
  truncate,
};
