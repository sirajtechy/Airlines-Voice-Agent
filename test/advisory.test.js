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
