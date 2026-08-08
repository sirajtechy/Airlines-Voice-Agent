'use strict';

/**
 * Heuristic parsing of the Emirates travel-updates page (scraped to Markdown).
 * The page is prose, not an API, so we work in sentences: find the ones that
 * mention the destination, then classify them.
 */

const {
  cityToIata,
  airports,
  countryAliases,
  destinationRegions,
  regionSections,
} = require('../data/mocks');

/**
 * Split markdown into sentence-ish chunks, stripping markdown noise.
 *
 * Block boundaries are split before punctuation is considered, because plenty
 * of advisory lines carry no terminal full stop — headings, list items, and
 * stamps like "Last updated: 8 January 2026, 05:44 Dubai (GMT+4)". Collapsing
 * the whole document to one string first glues those to the paragraph below,
 * producing a Frankenstein sentence whose opening clause belongs to a heading.
 * That mattered: it hid the UK ETA requirement behind a stray "do not need".
 */
function sentences(markdown) {
  return String(markdown)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // unwrap links
    .split(/\n{2,}|\n(?=\s*[-*+]\s)|\n(?=#{1,6}\s)/) // paragraph / list / heading
    .flatMap((block) =>
      block
        .replace(/^\s*[-*+]\s+/, '') // list bullet — the agent would read it aloud
        .replace(/[#*_>`|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s+/)
    )
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

  // Country-level advisories name the country, not the airport.
  for (const alias of countryAliases[lower] || []) set.add(alias);

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
// Entry/screening restrictions block travel just as effectively as a cancelled
// route, and are what airlines actually publish most of the time.
const RESTRICTION_RE = /\b(will not allow entry|not be allowed entry|entry restriction|travel restriction|entry ban|denied entry|enhanced screening|entry requirement|not be permitted)\b/i;
const RESUME_RE = /\b(resume|resuming|resumption|will operate|reinstat|lifted|no longer applies)\b/i;
// Deliberately excludes "until further notice" — that means open-ended, not
// previously extended, and open_ended already reports it.
const EXTENDED_RE = /\b(extend|extended|further extended)\b/i;
const OPEN_ENDED_RE = /\buntil further notice\b/i;
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
 * Sentences mentioning `aliases`, plus one sentence either side. Advisories put
 * the qualifier that changes the answer ("effective 6 June", "until further
 * notice", "this has been extended") in a neighbouring sentence, so matching a
 * single sentence reads the restriction but misses its scope.
 */
function contextWindow(all, aliases) {
  const hitIndexes = all.map((s, i) => (mentions(s, aliases) ? i : -1)).filter((i) => i >= 0);
  const window = new Set();
  for (const i of hitIndexes) {
    for (let j = Math.max(0, i - 1); j <= Math.min(i + 1, all.length - 1); j++) window.add(j);
  }
  return {
    hitIndexes,
    hits: hitIndexes.map((i) => all[i]),
    blob: [...window].sort((a, b) => a - b).map((i) => all[i]).join(' '),
  };
}

/**
 * @returns {{blocked:boolean, restriction_type:'suspension'|'entry_restriction'|null,
 *            suspended:boolean, suspended_until:string|null, open_ended:boolean,
 *            extended_before:boolean, advisory_text:string, matched:boolean}}
 */
function parseDisruption(markdown, destination) {
  const aliases = aliasesFor(destination);
  const all = markdown ? sentences(markdown) : [];
  const { hits, blob } = contextWindow(all, aliases);

  if (!hits.length) {
    return {
      blocked: false,
      restriction_type: null,
      suspended: false,
      suspended_until: null,
      open_ended: false,
      extended_before: false,
      advisory_text: `No current travel disruption found for ${destination}.`,
      matched: false,
    };
  }

  const lifted = RESUME_RE.test(blob) && !SUSPENSION_RE.test(hits[0]);
  const suspended = SUSPENSION_RE.test(blob) && !lifted;
  const restricted = RESTRICTION_RE.test(blob) && !lifted;

  const relevant =
    hits.find((s) => SUSPENSION_RE.test(s)) ||
    hits.find((s) => RESTRICTION_RE.test(s)) ||
    hits[0];

  // "until further notice" means there is no end date — do not mistake the
  // effective-from date in the same sentence for one.
  const openEnded = OPEN_ENDED_RE.test(blob);

  return {
    blocked: suspended || restricted,
    restriction_type: suspended ? 'suspension' : restricted ? 'entry_restriction' : null,
    suspended,
    suspended_until: openEnded ? null : extractDate(blob),
    open_ended: openEnded,
    extended_before: EXTENDED_RE.test(blob),
    advisory_text: truncate(relevant, 300),
    matched: true,
  };
}

const TRANSIT_SCOPE_RE = /\b(transit|transiting|connecting|indirect routing|point of origin)\b/i;
const CONDITION_RE = /\bunless\b[^.]*/i;

/**
 * Transit can be blocked by the destination (route suspended, connections
 * refused) OR by where the passenger has recently been — entry restrictions
 * key off origin, not destination. Check both sides.
 *
 * @returns {{transit_allowed:boolean, conditional:boolean, explanation:string, matched:boolean}}
 */
function parseTransitRules(markdown, origin, finalDestination) {
  const all = markdown ? sentences(markdown) : [];
  const destAliases = aliasesFor(finalDestination);
  const destHits = all.filter((s) => mentions(s, destAliases));

  // 1. Destination side: connections explicitly refused.
  const blocked = destHits.find((s) => TRANSIT_BLOCK_RE.test(s));
  if (blocked) {
    return {
      transit_allowed: false,
      conditional: false,
      explanation: truncate(
        `Transit through Dubai to ${finalDestination} is not being accepted right now. ${blocked}`,
        250
      ),
      matched: true,
    };
  }

  // 2. Destination side: route suspended, so the connection cannot complete.
  const disruption = parseDisruption(markdown, finalDestination);
  if (disruption.matched && disruption.suspended) {
    return {
      transit_allowed: false,
      conditional: false,
      explanation: truncate(
        `Flights to ${finalDestination} are suspended, so a connection through Dubai cannot be completed. ${disruption.advisory_text}`,
        250
      ),
      matched: true,
    };
  }

  // 3. Origin side: entry/transit restrictions that key off recent travel
  //    history rather than destination.
  if (origin) {
    const originWindow = contextWindow(all, aliasesFor(origin));
    if (
      originWindow.hits.length &&
      RESTRICTION_RE.test(originWindow.blob) &&
      TRANSIT_SCOPE_RE.test(originWindow.blob)
    ) {
      const restrictionSentence =
        originWindow.hits.find((s) => RESTRICTION_RE.test(s)) || originWindow.hits[0];
      const condition = restrictionSentence.match(CONDITION_RE);
      return {
        transit_allowed: false,
        conditional: Boolean(condition),
        explanation: truncate(
          `There is a current entry and transit restriction affecting travellers coming from ${origin}. ${restrictionSentence}`,
          250
        ),
        matched: true,
      };
    }
  }

  // 4. Destination side: connections explicitly confirmed.
  const allowed = destHits.find((s) => TRANSIT_OK_RE.test(s));
  if (allowed) {
    return {
      transit_allowed: true,
      conditional: false,
      explanation: truncate(`Transit through Dubai to ${finalDestination} is being accepted. ${allowed}`, 250),
      matched: true,
    };
  }

  return {
    transit_allowed: true,
    conditional: false,
    explanation: `No transit restriction is published for passengers travelling from ${origin || 'your origin'} through Dubai to ${finalDestination}. Check in as normal, and confirm at the transfer desk on arrival.`,
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

// ---------------------------------------------------------------------------
// Entry requirements (EU Entry/Exit System, UK ETA and eVisas)
// ---------------------------------------------------------------------------

// The page uses non-breaking hyphens and NBSPs inside "non‑EU", "long‑stay",
// "90 days". Left alone they defeat every \b word boundary below.
function normaliseDashes(text) {
  return String(text).replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ');
}

/** A requirement the passenger has to act on before they fly. */
const OBLIGATION_RE = /\b(you will need|you must|you should|need to|will need to|should take action|are required|cannot legally travel|will not be able to board|applies to you|please allow extra time|make sure)\b/i;
/** Carve-outs. Worth separating: "not affected" is the sentence that ends the call happily. */
const EXEMPTION_RE = /\b(are not affected|not affected|do not need|does not need|will not need|are exempt|exempt from|no longer need|not required)\b/i;
const LAST_UPDATED_RE = /last updated:\s*([^\n]+)/i;

/**
 * Drop a leading "If ..., " conditional so classification reads the main clause.
 *
 * "If you do not need a visa to visit the UK for short stays, you will need an
 * Electronic Travel Authorisation." The negation lives in the condition; the
 * obligation lives in the main clause. Testing the whole sentence files the
 * single most important UK requirement as an exemption and the agent tells the
 * passenger they need nothing — which is how someone gets denied boarding.
 */
function mainClause(sentence) {
  return sentence.replace(/^if\b[^,]*,\s*/i, '');
}

/**
 * Split scraped Markdown on `##` headings into { heading, body } sections.
 * Entry requirements are documentation, not bulletins — the governing scope is
 * the heading, so a sentence window (right for disruption bulletins) would drag
 * in unrelated blocs. We section first, then read sentences within the section.
 */
function sections(markdown) {
  const text = normaliseDashes(markdown || '');
  const out = [];
  const parts = text.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    if (nl === -1) {
      out.push({ heading: part.trim(), body: '' });
      continue;
    }
    out.push({ heading: part.slice(0, nl).trim(), body: part.slice(nl + 1).trim() });
  }
  return out;
}

/**
 * Entry requirements for a destination, read out of the region section that
 * governs it.
 *
 * Distinct from `parseDisruption`: a disruption blocks you, a requirement is
 * paperwork you can still satisfy. Conflating them would have the agent tell a
 * passenger flying to Munich that they cannot travel, when in fact they need to
 * register for EES. So `blocked` is never set here — the caller gets
 * `action_required` instead.
 *
 * @returns {{destination:string, region:string|null, region_label:string|null,
 *            applies:boolean, action_required:boolean, requirements:string[],
 *            exemptions:string[], summary:string, last_updated:string|null,
 *            matched:boolean}}
 */
function parseEntryRequirements(markdown, destination) {
  const raw = String(destination || '').trim();
  const lower = raw.toLowerCase();

  // Resolve the destination to a bloc, trying the city/code and, failing that,
  // the city behind an airport code ("LHR" -> "london" -> uk).
  let region = destinationRegions[lower] || null;
  if (!region) {
    const asCode = raw.toUpperCase();
    if (airports[asCode]) region = destinationRegions[airports[asCode].city.toLowerCase()] || null;
  }
  if (!region) {
    for (const alias of aliasesFor(raw)) {
      if (destinationRegions[alias]) {
        region = destinationRegions[alias];
        break;
      }
    }
  }

  const label = region ? regionSections[region].label : null;

  if (!region) {
    return {
      destination: raw,
      region: null,
      region_label: null,
      applies: false,
      action_required: false,
      requirements: [],
      exemptions: [],
      summary: `I do not have published entry requirements for ${raw || 'that destination'}. The ones I track are for the European Union and the United Kingdom.`,
      last_updated: null,
      matched: false,
    };
  }

  const wanted = regionSections[region].headings;
  const section = sections(markdown).find((s) =>
    wanted.some((h) => s.heading.toLowerCase().includes(h))
  );

  if (!section || !section.body) {
    return {
      destination: raw,
      region,
      region_label: label,
      applies: false,
      action_required: false,
      requirements: [],
      exemptions: [],
      summary: `I could not read the current entry requirements for ${label} from the live advisory just now. Check with the Emirates desk before you travel.`,
      last_updated: null,
      matched: false,
    };
  }

  // Classify on the main clause, not the whole sentence — see mainClause().
  const all = sentences(section.body);
  const requirements = [];
  const exemptions = [];
  for (const s of all) {
    const main = mainClause(s);
    if (OBLIGATION_RE.test(main) && !EXEMPTION_RE.test(main)) requirements.push(truncate(s, 240));
    else if (EXEMPTION_RE.test(main)) exemptions.push(truncate(s, 240));
  }

  const lastUpdated = section.body.match(LAST_UPDATED_RE);

  return {
    destination: raw,
    region,
    region_label: label,
    applies: true,
    action_required: requirements.length > 0,
    requirements: requirements.slice(0, 4),
    exemptions: exemptions.slice(0, 2),
    summary: requirements.length
      ? truncate(`There are entry requirements in force for ${label}. ${requirements[0]}`, 300)
      : `Entry requirements for ${label} are published, but nothing in them requires action from you before departure.`,
    last_updated: lastUpdated ? lastUpdated[1].trim() : null,
    matched: true,
  };
}

module.exports = {
  parseDisruption,
  parseTransitRules,
  parseSupportText,
  parseEntryRequirements,
  sections,
  sentences,
  aliasesFor,
  extractDate,
  truncate,
};
