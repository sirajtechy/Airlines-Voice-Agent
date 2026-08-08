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
  assert.match(r.advisory_text, /No current suspension found for Tokyo/);
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
