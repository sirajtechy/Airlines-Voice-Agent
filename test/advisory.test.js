'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const advisory = require('../src/lib/advisory');

const SAMPLE = `
# Travel updates

Emirates flights to Beirut remain suspended until 10 August 2026. This suspension has been
extended following a review of the regional airspace situation.

Customers transiting through Dubai with final destination Beirut will not be accepted for
travel at their point of origin.

Affected customers may rebook without a change fee, and hotel accommodation will be provided
for passengers whose delay in Dubai exceeds six hours.

Flights to London are operating normally.
`;

/**
 * Verbatim excerpt of the Emirates travel-updates page as scraped on
 * 8 August 2026. This is the live shape the demo actually runs against —
 * an entry restriction, not a route suspension.
 */
const LIVE_EXCERPT = `
Travel advisory – Ebola-related measures in several countries including the UAE.
Check destination entry requirements before travel.
Last updated: 6 June 2026, 05:44 Dubai (GMT+4).
Several countries have implemented travel entry restrictions and/or enhanced screening
measures due to the Ebola virus.
We advise customers to check the entry requirements of their destination country via
official government channels.
UAE entry restrictions – effective 6 June 2026, 1:00 PM Dubai time (until further notice).
The UAE will not allow entry to travellers who have recently been in the Democratic
Republic of Congo, Uganda, or South Sudan , unless the traveller has been outside of
these countries for more than 21 days .
Travellers who are transiting through the UAE are required to comply with the travel
entry measures of their final destination.
The entry and transit restrictions apply to all travellers, even those arriving by
indirect routings.
`;

test('LIVE: detects the UAE entry restriction for Uganda', () => {
  const r = advisory.parseDisruption(LIVE_EXCERPT, 'Uganda');
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.restriction_type, 'entry_restriction');
  assert.strictEqual(r.suspended, false, 'an entry restriction is not a route suspension');
  assert.match(r.advisory_text, /will not allow entry/i);
});

test('LIVE: "until further notice" yields no end date, not the effective-from date', () => {
  const r = advisory.parseDisruption(LIVE_EXCERPT, 'Uganda');
  assert.strictEqual(r.open_ended, true);
  assert.strictEqual(r.suspended_until, null,
    'must not report 2026-06-06 — that is when it started, not when it ends');
});

test('LIVE: resolves DRC aliases to the phrase used in the advisory', () => {
  for (const name of ['DRC', 'Congo', 'Democratic Republic of Congo']) {
    const r = advisory.parseDisruption(LIVE_EXCERPT, name);
    assert.strictEqual(r.blocked, true, `${name} should resolve to the advisory text`);
  }
});

test('LIVE: transit is blocked by origin, not destination', () => {
  const r = advisory.parseTransitRules(LIVE_EXCERPT, 'Uganda', 'London');
  assert.strictEqual(r.transit_allowed, false,
    'London is unrestricted, but a passenger coming from Uganda still cannot transit');
  assert.strictEqual(r.conditional, true, 'the 21-day carve-out makes this conditional');
  assert.ok(r.explanation.length <= 250);
});

test('LIVE: an unaffected journey is not flagged', () => {
  const r = advisory.parseTransitRules(LIVE_EXCERPT, 'Mumbai', 'London');
  assert.strictEqual(r.transit_allowed, true);
});

test('LIVE: a destination with no advisory reports nothing found', () => {
  const r = advisory.parseDisruption(LIVE_EXCERPT, 'Beirut');
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.matched, false);
});

test('parseDisruption finds a suspended route and its end date', () => {
  const r = advisory.parseDisruption(SAMPLE, 'Beirut');
  assert.strictEqual(r.suspended, true);
  assert.strictEqual(r.suspended_until, '2026-08-10');
  assert.strictEqual(r.extended_before, true);
  assert.ok(r.advisory_text.length <= 300);
});

test('parseDisruption resolves an airport code to its city', () => {
  const r = advisory.parseDisruption(SAMPLE, 'BEY');
  assert.strictEqual(r.suspended, true);
});

test('parseDisruption reports no suspension for an unmentioned destination', () => {
  const r = advisory.parseDisruption(SAMPLE, 'Tokyo');
  assert.strictEqual(r.suspended, false);
  assert.match(r.advisory_text, /No current travel disruption found for Tokyo/);
});

test('parseTransitRules detects a blocked transit', () => {
  const r = advisory.parseTransitRules(SAMPLE, 'Mumbai', 'Beirut');
  assert.strictEqual(r.transit_allowed, false);
  assert.ok(r.explanation.length <= 250);
});

test('parseTransitRules allows transit where nothing is published', () => {
  const r = advisory.parseTransitRules(SAMPLE, 'Mumbai', 'London');
  assert.strictEqual(r.transit_allowed, true);
});

test('parseSupportText pulls hotel and rebooking language', () => {
  const text = advisory.parseSupportText(SAMPLE, 'Dubai');
  assert.ok(text && /hotel accommodation/i.test(text));
});

test('parsers tolerate null markdown', () => {
  assert.strictEqual(advisory.parseDisruption(null, 'Beirut').matched, false);
  assert.strictEqual(advisory.parseSupportText(null, 'Dubai'), null);
});

// ---------------------------------------------------------------------------
// Entry requirements
// ---------------------------------------------------------------------------

/**
 * Verbatim excerpt of the EU and UK sections of the Emirates travel-updates
 * page as scraped on 8 August 2026, non-breaking hyphens included — those
 * characters are real and they defeat naive word-boundary matching.
 */
const LIVE_ENTRY = `
## Travel to the European Union

Last updated: 22 April 2026, 08:04 Dubai (GMT+4)

The European Union has introduced a new Entry/Exit System (EES) at Schengen borders. This system replaces the manual passport stamping process with a digital record of your entry and exit, including basic details and biometric data (such as fingerprints and a facial image).

If you are a non\u2011EU/Schengen national travelling to or from the Schengen Area for a short stay (up to 90 days in any 180\u2011day period), the EES applies to you.

EU citizens, Schengen residents, and those holding long\u2011stay visas or residence permits are not affected.

Please allow extra time for border checks, especially on your first trip after the system goes live.

## Travel requirements for the United Kingdom

Last updated: 8 January 2026, 05:44 Dubai (GMT+4)

If you do not need a visa to visit the UK for short stays of up to six months, you will need an Electronic Travel Authorisation (ETA). From 25 February 2026, eligible visitors without an ETA will not be able to board their transport and cannot legally travel to the UK.
`;

test('ENTRY: a subordinate "do not need" does not hide the ETA requirement', () => {
  const r = advisory.parseEntryRequirements(LIVE_ENTRY, 'London');
  assert.strictEqual(r.region, 'uk');
  assert.strictEqual(r.action_required, true);
  assert.match(r.requirements[0], /Electronic Travel Authorisation/i,
    'the ETA sentence is a requirement — the negation is in the "if" clause, not the main clause');
  assert.ok(
    !r.exemptions.some((e) => /Electronic Travel Authorisation/i.test(e)),
    'must never be filed as an exemption; that tells a passenger they need nothing'
  );
});

test('ENTRY: a genuine carve-out is still read as an exemption', () => {
  const r = advisory.parseEntryRequirements(LIVE_ENTRY, 'Paris');
  assert.strictEqual(r.region, 'schengen');
  assert.ok(r.exemptions.some((e) => /are not affected/i.test(e)));
  assert.ok(
    !r.requirements.some((s) => /are not affected/i.test(s)),
    'an exemption must not be read back as an obligation'
  );
});

test('ENTRY: routes cities and airport codes to the right bloc', () => {
  for (const d of ['Munich', 'MAD', 'Amsterdam', 'Schengen']) {
    assert.strictEqual(advisory.parseEntryRequirements(LIVE_ENTRY, d).region, 'schengen', d);
  }
  for (const d of ['LHR', 'Manchester', 'United Kingdom', 'London']) {
    assert.strictEqual(advisory.parseEntryRequirements(LIVE_ENTRY, d).region, 'uk', d);
  }
});

test('ENTRY: survives non-breaking hyphens in the source text', () => {
  const r = advisory.parseEntryRequirements(LIVE_ENTRY, 'Paris');
  assert.ok(r.requirements.some((s) => /non-EU\/Schengen national/i.test(s)),
    'U+2011 must be normalised or the word boundaries never match');
});

test('ENTRY: entry requirements are paperwork, never a travel ban', () => {
  const r = advisory.parseEntryRequirements(LIVE_ENTRY, 'Paris');
  assert.strictEqual(r.applies, true);
  // parseDisruption is the tool that decides "blocked". This one must not.
  assert.ok(!('blocked' in r), 'entry requirements must not claim to block travel');
});

test('ENTRY: an untracked destination says so rather than guessing', () => {
  const r = advisory.parseEntryRequirements(LIVE_ENTRY, 'Tokyo');
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.applies, false);
  assert.match(r.summary, /do not have published entry requirements/i);
});

test('ENTRY: reports the section last-updated stamp', () => {
  assert.match(advisory.parseEntryRequirements(LIVE_ENTRY, 'Paris').last_updated, /22 April 2026/);
});

test('ENTRY: tolerates null markdown', () => {
  const r = advisory.parseEntryRequirements(null, 'London');
  assert.strictEqual(r.matched, false);
  assert.ok(r.summary.length > 0);
});
