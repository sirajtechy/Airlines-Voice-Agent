'use strict';

const express = require('express');
const ctx = require('../lib/contextClient');
const adsb = require('../lib/adsb');
const advisory = require('../lib/advisory');
const {
  flightDB,
  policies,
  rebookingOptions,
  turnaroundBriefs,
  strandedSupportBaseline,
  airports,
  cityToIata,
} = require('../data/mocks');

const router = express.Router();

const EMIRATES_UPDATES = 'https://www.emirates.com/ae/english/help/travel-updates/';
const METAR_URL = (icao) => `https://aviationweather.gov/api/data/metar?ids=${icao}&format=raw`;

/**
 * Wrap a handler so ElevenLabs never sees a 500 or an empty body. Any throw
 * becomes a 200 with a spoken-friendly degraded payload the agent reads aloud.
 */
function safe(name, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      req.log?.(`[${name}] ${err.stack || err.message}`);
      if (!res.headersSent) {
        res.status(200).json({
          status: 'degraded',
          message:
            'I could not reach the live operations feed just then. Please give me one moment and ask me again, or check with the Emirates desk directly.',
          tool: name,
        });
      }
    }
  };
}

/** Normalise a spoken airport/city into an IATA code where we can. */
function toIata(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && airports[upper]) return upper;
  if (/^[A-Z]{4}$/.test(upper)) {
    const match = Object.entries(airports).find(([, v]) => v.icao === upper);
    if (match) return match[0];
  }
  return cityToIata[raw.toLowerCase()] || (/^[A-Z]{3}$/.test(upper) ? upper : null);
}

function toIcao(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(raw)) return raw;
  const iata = toIata(raw);
  return iata && airports[iata] ? airports[iata].icao : null;
}

function normFlightNo(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Look up a flight allowing EK17 / EK 17 / EK017 to mean the same thing. */
function findFlight(flightNo) {
  const key = normFlightNo(flightNo);
  if (!key) return null;
  if (flightDB[key]) return flightDB[key];
  const digits = key.replace(/^[A-Z]+/, '').replace(/^0+/, '');
  const prefix = key.match(/^[A-Z]+/)?.[0] || 'EK';
  return (
    Object.values(flightDB).find((f) => {
      const fk = normFlightNo(f.flight_no);
      return (
        fk.match(/^[A-Z]+/)?.[0] === prefix &&
        fk.replace(/^[A-Z]+/, '').replace(/^0+/, '') === digits
      );
    }) || null
  );
}

// ---------------------------------------------------------------------------
// 1. POST /tools/flight_status  { flight_no }
// ---------------------------------------------------------------------------
router.post(
  '/flight_status',
  safe('flight_status', async (req, res) => {
    const flightNo = req.body?.flight_no;
    if (!flightNo) {
      return res.status(200).json({
        status: 'degraded',
        message: 'I need a flight number — for example E K seventeen — to check the status.',
      });
    }

    const flight = findFlight(flightNo);

    // Live enrichment: where the aircraft physically is, from ADS-B.
    //
    // The schedule block (times, gate, delay, cancellation) is static — no
    // keyless source publishes it, so `schedule_source` stays "mock" and we do
    // not pretend otherwise. What IS live is the transponder position, reported
    // separately under `position_source` so the two can never be conflated.
    const adsbResult = await adsb.positionFor(flight?.flight_no || flightNo);
    const airborne = adsbResult.source === 'live' ? Boolean(adsbResult.airborne) : null;
    const live_note = adsb.speakablePosition(adsbResult);

    // Unknown to the schedule table but visible on ADS-B: we can still answer
    // usefully, and refusing would waste the one genuinely live signal we have.
    if (!flight) {
      if (!adsbResult.position) {
        return res.status(200).json({
          status: 'degraded',
          message: `I could not find flight ${flightNo} in today's schedule, and it is not showing on live tracking either. Could you read the flight number back to me?`,
          source: 'none',
        });
      }
      return res.status(200).json({
        flight_no: normFlightNo(flightNo),
        status: 'In flight',
        schedule_available: false,
        live_note,
        live_position: adsbResult.position,
        airborne: true,
        position_source: adsbResult.source,
        schedule_source: 'none',
        source: 'live',
      });
    }

    res.status(200).json({
      ...flight,
      schedule_available: true,
      live_note,
      live_position: adsbResult.position || null,
      airborne,
      position_source: adsbResult.source,
      schedule_source: 'mock',
      source: 'mock',
    });
  })
);

// ---------------------------------------------------------------------------
// 2. POST /tools/weather_ops  { airport }
// ---------------------------------------------------------------------------
router.post(
  '/weather_ops',
  safe('weather_ops', async (req, res) => {
    const input = req.body?.airport || 'DXB';
    const icao = toIcao(input) || 'OMDB';
    const result = await ctx.fetchText(METAR_URL(icao));

    if (!result.data) {
      return res.status(200).json({
        status: 'degraded',
        message: `I could not pull the current weather observation for ${input} just now. Operations at Dubai are running normally as far as I know.`,
        airport: input,
        icao,
        source: 'none',
      });
    }

    const raw = result.data.split('\n')[0].trim();
    const visibilityMatch = raw.match(/\b(\d{4})\b(?!\/)/);
    const windMatch = raw.match(/\b(\d{3})(\d{2})(G\d{2})?KT\b/);
    const lowVisibility = visibilityMatch ? Number(visibilityMatch[1]) < 1500 : false;
    const strongWind = windMatch ? Number(windMatch[2]) >= 25 : false;

    res.status(200).json({
      airport: input,
      icao,
      metar: raw,
      wind: windMatch ? `${Number(windMatch[1])} degrees at ${Number(windMatch[2])} knots` : null,
      ops_impact: lowVisibility
        ? 'Low-visibility procedures are likely, which reduces the arrival rate and pushes departure slots.'
        : strongWind
          ? 'Strong surface winds — expect longer taxi and possible runway-direction changes.'
          : 'No weather-driven constraint on operations from this observation.',
      source: result.source,
    });
  })
);

// ---------------------------------------------------------------------------
// 3. POST /tools/policy_lookup  { topic }
// ---------------------------------------------------------------------------
router.post(
  '/policy_lookup',
  safe('policy_lookup', async (req, res) => {
    const topicRaw = String(req.body?.topic || '').toLowerCase().trim();
    const key = Object.keys(policies).find(
      (k) => k === topicRaw.replace(/\s+/g, '_') || topicRaw.includes(k.split('_')[0])
    );

    if (!key) {
      return res.status(200).json({
        status: 'degraded',
        message:
          'I can cover delay compensation, cancellations, delayed baggage, missed connections, and refunds. Which of those do you need?',
        available_topics: Object.keys(policies),
      });
    }

    res.status(200).json({ ...policies[key], source: 'policy_baseline' });
  })
);

// ---------------------------------------------------------------------------
// 4. POST /tools/rebooking_options  { flight_no?, destination? }
// ---------------------------------------------------------------------------
router.post(
  '/rebooking_options',
  safe('rebooking_options', async (req, res) => {
    const flight = findFlight(req.body?.flight_no);
    const destInput = req.body?.destination || flight?.destination;
    const dest = toIata(destInput) || 'DEFAULT';
    const options = rebookingOptions[dest] || rebookingOptions.DEFAULT;

    // Cross-check the advisory: a suspended route makes these options moot.
    const scraped = await ctx.scrape(EMIRATES_UPDATES);
    const disruption = destInput
      ? advisory.parseDisruption(scraped.data, destInput)
      : { blocked: false };

    res.status(200).json({
      destination: destInput || null,
      route_blocked: Boolean(disruption.blocked),
      options,
      advice: disruption.blocked
        ? `Travel to ${destInput} is currently restricted, so a same-airline rebooking may not be possible yet. ${disruption.advisory_text}`
        : 'Seats shown are the next available services. The transfer desk can hold one for you while you decide.',
      source: scraped.source,
    });
  })
);

// ---------------------------------------------------------------------------
// 5. POST /tools/turnaround_brief  { flight_no }
// ---------------------------------------------------------------------------
router.post(
  '/turnaround_brief',
  safe('turnaround_brief', async (req, res) => {
    const flightNo = normFlightNo(req.body?.flight_no);
    const brief = turnaroundBriefs[flightNo];
    const flight = findFlight(flightNo);

    if (!brief && !flight) {
      return res.status(200).json({
        status: 'degraded',
        message: `I do not have a turnaround brief for ${req.body?.flight_no || 'that flight'}. I can brief you on E K seventeen.`,
      });
    }

    const wx = await ctx.fetchText(METAR_URL('OMDB'));

    res.status(200).json({
      flight_no: flight?.flight_no || flightNo,
      stand: brief?.stand || flight?.gate || null,
      inbound: brief?.inbound || null,
      ground_time_minutes: brief?.ground_time_minutes ?? null,
      critical_path: brief?.critical_path || 'Standard turnaround; no single constraint flagged.',
      crew: brief?.crew || null,
      risks: brief?.risks || [],
      station_weather: wx.data ? wx.data.split('\n')[0].trim() : null,
      source: wx.source,
    });
  })
);

// ---------------------------------------------------------------------------
// 6. POST /tools/disruption_status  { destination }
// ---------------------------------------------------------------------------
router.post(
  '/disruption_status',
  safe('disruption_status', async (req, res) => {
    const destination = String(req.body?.destination || '').trim();
    if (!destination) {
      return res.status(200).json({
        status: 'degraded',
        message: 'Which destination should I check for travel disruption?',
      });
    }

    const scraped = await ctx.scrape(EMIRATES_UPDATES);
    const parsed = advisory.parseDisruption(scraped.data, destination);

    res.status(200).json({
      destination,
      blocked: parsed.blocked,
      restriction_type: parsed.restriction_type,
      suspended: parsed.suspended,
      suspended_until: parsed.suspended_until,
      open_ended: parsed.open_ended,
      extended_before: parsed.extended_before,
      advisory_text: parsed.advisory_text,
      source: scraped.source,
    });
  })
);

// ---------------------------------------------------------------------------
// 7. POST /tools/transit_rules  { origin, final_destination }
// ---------------------------------------------------------------------------
router.post(
  '/transit_rules',
  safe('transit_rules', async (req, res) => {
    const origin = String(req.body?.origin || '').trim();
    const finalDestination = String(req.body?.final_destination || '').trim();
    if (!finalDestination) {
      return res.status(200).json({
        status: 'degraded',
        message: 'I need the final destination to check whether transit through Dubai is being accepted.',
      });
    }

    const scraped = await ctx.scrape(EMIRATES_UPDATES);
    const parsed = advisory.parseTransitRules(scraped.data, origin || 'your origin', finalDestination);

    res.status(200).json({
      transit_allowed: parsed.transit_allowed,
      conditional: parsed.conditional,
      explanation: parsed.explanation,
      source: scraped.source,
    });
  })
);

// ---------------------------------------------------------------------------
// 8. POST /tools/stranded_support  { location }
// ---------------------------------------------------------------------------
router.post(
  '/stranded_support',
  safe('stranded_support', async (req, res) => {
    const location = String(req.body?.location || 'Dubai').trim();
    const scraped = await ctx.scrape(EMIRATES_UPDATES);
    const live = advisory.parseSupportText(scraped.data, location);

    res.status(200).json({
      location,
      support_text: live || strandedSupportBaseline,
      source: live ? scraped.source : 'baseline',
    });
  })
);

// ---------------------------------------------------------------------------
// 9. POST /tools/entry_requirements  { destination }
// ---------------------------------------------------------------------------
router.post(
  '/entry_requirements',
  safe('entry_requirements', async (req, res) => {
    const destination = String(req.body?.destination || '').trim();
    if (!destination) {
      return res.status(200).json({
        status: 'degraded',
        message: 'Which country are you travelling to? I can check entry requirements for the European Union and the United Kingdom.',
      });
    }

    const scraped = await ctx.scrape(EMIRATES_UPDATES);
    const parsed = advisory.parseEntryRequirements(scraped.data, destination);

    res.status(200).json({
      destination,
      region: parsed.region,
      region_label: parsed.region_label,
      applies: parsed.applies,
      action_required: parsed.action_required,
      requirements: parsed.requirements,
      exemptions: parsed.exemptions,
      summary: parsed.summary,
      last_updated: parsed.last_updated,
      // Paperwork, not a closed border. Stated explicitly so the agent never
      // reads this tool as a travel ban.
      blocks_travel: false,
      source: parsed.matched ? scraped.source : 'none',
    });
  })
);

module.exports = router;
module.exports.EMIRATES_UPDATES = EMIRATES_UPDATES;
