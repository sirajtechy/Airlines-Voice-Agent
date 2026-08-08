'use strict';

/**
 * Live aircraft position from adsb.lol — a keyless, ODbL-licensed feed of
 * ADS-B transponder data contributed by volunteer receivers.
 *
 * What this genuinely gives us: where an aircraft physically is right now,
 * how high, how fast, climbing or descending. That is real live data off the
 * network, and it is the only live flight signal we found without a
 * commercial contract.
 *
 * What it does NOT give us, and what we therefore must never claim it does:
 * scheduled times, gate numbers, delay minutes, or cancellation status. Those
 * are airline schedule facts, not transponder facts. An aircraft sitting at a
 * stand with its transponder off is indistinguishable here from one that never
 * existed — an empty result means "not currently airborne", never "cancelled".
 */

const fetch = require('node-fetch');

const ADSB_API = 'https://api.adsb.lol/v2/callsign';
// Deliberately shorter than the context.dev budget: this is a nice-to-have
// enrichment on top of a response we can already answer without it.
const TIMEOUT_MS = Number(process.env.ADSB_TIMEOUT_MS || 6000);

/**
 * Airline IATA prefix -> ICAO callsign prefix. Callers and boarding passes use
 * IATA ("EK17"); the transponder broadcasts ICAO ("UAE17").
 */
const CALLSIGN_PREFIX = {
  EK: 'UAE',
  FZ: 'FDB',
  QR: 'QTR',
  EY: 'ETD',
};

/**
 * "EK 017" / "ek17" / "EK017" all describe the same transponder callsign
 * "UAE17" — ADS-B does not zero-pad.
 *
 * @returns {string|null}
 */
function toCallsign(flightNo) {
  const key = String(flightNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = key.match(/^([A-Z]{2,3})0*(\d{1,4})$/);
  if (!m) return null;
  const prefix = CALLSIGN_PREFIX[m[1]] || m[1];
  return `${prefix}${m[2]}`;
}

function describeVerticalRate(rate) {
  if (typeof rate !== 'number' || Math.abs(rate) < 300) return 'in level flight';
  return rate > 0 ? 'climbing' : 'descending';
}

/**
 * Look up an aircraft currently broadcasting the given flight number.
 *
 * Always resolves — a failure here must never cost us the schedule response
 * the caller actually asked for.
 *
 * @returns {Promise<{position: object|null, source: 'live'|'none', error?: string}>}
 */
async function positionFor(flightNo) {
  const callsign = toCallsign(flightNo);
  if (!callsign) return { position: null, source: 'none', error: 'unrecognised flight number format' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ADSB_API}/${encodeURIComponent(callsign)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { position: null, source: 'none', error: `adsb.lol responded ${res.status}` };

    const body = await res.json();
    const ac = Array.isArray(body?.ac) ? body.ac[0] : null;
    // No aircraft broadcasting this callsign. It is on the ground, between
    // sectors, or out of receiver range — we cannot tell which, so we say so.
    if (!ac) return { position: null, source: 'live', airborne: false, callsign };

    const altitude = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
    const verticalRate = typeof ac.baro_rate === 'number' ? ac.baro_rate : ac.geom_rate;

    return {
      source: 'live',
      airborne: true,
      position: {
        callsign,
        registration: ac.r || null,
        aircraft_type: ac.t || null,
        altitude_ft: altitude,
        ground_speed_kt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
        track_deg: typeof ac.track === 'number' ? Math.round(ac.track) : null,
        latitude: ac.lat ?? null,
        longitude: ac.lon ?? null,
        vertical_state: describeVerticalRate(verticalRate),
        observed_seconds_ago: typeof ac.seen === 'number' ? Math.round(ac.seen) : null,
      },
    };
  } catch (err) {
    return {
      position: null,
      source: 'none',
      error: err.name === 'AbortError' ? 'adsb.lol timed out' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One spoken sentence describing the aircraft.
 *
 * Altitudes are rounded to the nearest thousand — "thirty-seven thousand feet"
 * is what a human says, "37,275 feet" is what a machine says.
 *
 * The not-airborne wording is deliberately careful. An absent transponder means
 * the aircraft has not departed OR is outside volunteer receiver coverage, and
 * we cannot tell which from here — so we say both rather than implying a delay
 * we have not confirmed.
 */
function speakablePosition(result) {
  if (!result?.position) {
    if (result?.source !== 'live') return null;
    return 'Live tracking is not picking up this aircraft in the air at the moment, which means it has either not departed yet or is outside tracking coverage.';
  }
  const p = result.position;
  const parts = [];
  if (p.altitude_ft != null) {
    parts.push(
      p.altitude_ft >= 1000
        ? `at ${Math.round(p.altitude_ft / 1000)} thousand feet`
        : `at ${p.altitude_ft} feet`
    );
  }
  if (p.ground_speed_kt != null) parts.push(`doing ${p.ground_speed_kt} knots`);
  if (!parts.length) return `The aircraft is airborne and ${p.vertical_state}.`;
  return `The aircraft is airborne right now, ${parts.join(', ')}, ${p.vertical_state}.`;
}

const ADSB_POINT_API = 'https://api.adsb.lol/v2/point';

/**
 * Every aircraft currently broadcasting within `radiusNm` of a point.
 *
 * This is the tool the flight-tracking MCPs (airplanes.live et al.) exist to
 * provide, from the same volunteer receiver network, minus their
 * non-commercial licence problem. It answers questions no schedule can:
 * "how busy is Dubai right now", "is anything actually moving".
 *
 * @param {number} lat @param {number} lon @param {number} radiusNm
 * @param {string} [airlinePrefix] ICAO callsign prefix filter, e.g. "UAE"
 * @returns {Promise<{aircraft: Array, total: number, source: 'live'|'none', error?: string}>}
 */
async function snapshot(lat, lon, radiusNm = 100, airlinePrefix = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ADSB_POINT_API}/${lat}/${lon}/${Math.min(radiusNm, 250)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { aircraft: [], total: 0, source: 'none', error: `adsb.lol responded ${res.status}` };

    const body = await res.json();
    let ac = Array.isArray(body?.ac) ? body.ac : [];
    const total = ac.length;
    if (airlinePrefix) {
      const prefix = String(airlinePrefix).toUpperCase();
      ac = ac.filter((a) => (a.flight || '').trim().toUpperCase().startsWith(prefix));
    }

    const aircraft = ac
      .filter((a) => a.flight && typeof a.alt_baro === 'number')
      .sort((a, b) => (a.alt_baro || 0) - (b.alt_baro || 0))
      .slice(0, 12)
      .map((a) => ({
        callsign: (a.flight || '').trim(),
        aircraft_type: a.t || null,
        altitude_ft: a.alt_baro,
        ground_speed_kt: typeof a.gs === 'number' ? Math.round(a.gs) : null,
        vertical_state: describeVerticalRate(typeof a.baro_rate === 'number' ? a.baro_rate : a.geom_rate),
      }));

    return { aircraft, total, source: 'live' };
  } catch (err) {
    return {
      aircraft: [],
      total: 0,
      source: 'none',
      error: err.name === 'AbortError' ? 'adsb.lol timed out' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { positionFor, snapshot, toCallsign, speakablePosition, ADSB_API, TIMEOUT_MS };
