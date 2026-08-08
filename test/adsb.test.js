'use strict';

/**
 * Pure-function tests for the ADS-B layer. Deliberately no network: the
 * translation from a spoken flight number to a transponder callsign, and the
 * honesty of the sentence we hand the agent, are what can silently break.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const adsb = require('../src/lib/adsb');

test('maps IATA flight numbers to ICAO callsigns', () => {
  assert.strictEqual(adsb.toCallsign('EK17'), 'UAE17');
  assert.strictEqual(adsb.toCallsign('EK 017'), 'UAE17', 'spoken numbers arrive spaced');
  assert.strictEqual(adsb.toCallsign('ek017'), 'UAE17', 'ADS-B does not zero-pad');
  assert.strictEqual(adsb.toCallsign('EK001'), 'UAE1');
  assert.strictEqual(adsb.toCallsign('QR123'), 'QTR123');
});

test('passes through an unknown airline prefix rather than inventing one', () => {
  assert.strictEqual(adsb.toCallsign('XY42'), 'XY42');
});

test('rejects input that is not a flight number', () => {
  for (const bad of ['', null, undefined, 'hello', 'EK', '12345678']) {
    assert.strictEqual(adsb.toCallsign(bad), null, JSON.stringify(bad));
  }
});

test('speaks altitude in thousands, the way a person would', () => {
  const note = adsb.speakablePosition({
    source: 'live',
    airborne: true,
    position: { altitude_ft: 37275, ground_speed_kt: 494, vertical_state: 'in level flight' },
  });
  assert.match(note, /37 thousand feet/);
  assert.ok(!/37275/.test(note), 'never read a raw sensor figure aloud');
});

test('not-airborne wording does not imply a delay we have not confirmed', () => {
  const note = adsb.speakablePosition({ source: 'live', airborne: false, position: null });
  assert.match(note, /not departed yet or is outside tracking coverage/i,
    'an absent transponder is ambiguous and must be reported as ambiguous');
  assert.ok(!/delayed|cancelled/i.test(note), 'must not assert a schedule fact ADS-B cannot know');
});

test('says nothing at all when the lookup itself failed', () => {
  assert.strictEqual(adsb.speakablePosition({ source: 'none', position: null }), null,
    'a failed lookup is not evidence the aircraft is on the ground');
});

test('never claims a position without live data behind it', async () => {
  const r = await adsb.positionFor('not-a-flight');
  assert.strictEqual(r.position, null);
  assert.strictEqual(r.source, 'none');
});
