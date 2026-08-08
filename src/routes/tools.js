'use strict';

const express = require('express');
const ctx = require('../lib/contextClient');
const adsb = require('../lib/adsb');
const advisory = require('../lib/advisory');
const changes = require('../lib/changes');
const liveSources = require('../lib/liveSources');
const ekRoutes = require('../data/ekRoutes');
const {
  flightDB,
  bookings,
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

    // Not one of the demo disruption records — resolve it against the route
    // map, which knows the city pair and typical fleet for ~140 EK flights.
    // Route knowledge is not a departure time: no invented delays, no gates.
    if (!flight) {
      const route = ekRoutes.routeFor(flightNo);
      if (route) {
        return res.status(200).json({
          flight_no: normFlightNo(flightNo),
          route: `${route.origin} → ${route.destination}`,
          origin: route.origin,
          origin_city: route.origin_city,
          destination: route.destination,
          destination_city: route.destination_city,
          typical_aircraft: route.aircraft,
          status: adsbResult.position ? 'In flight' : 'Scheduled service',
          summary: `${normFlightNo(flightNo)} is the Emirates service from ${route.origin_city} to ${route.destination_city}, typically a ${route.aircraft}.${adsbResult.position ? '' : ' I do not have live departure times or gates for it.'}`,
          live_note,
          live_position: adsbResult.position || null,
          airborne,
          position_source: adsbResult.source,
          // Route map, not today's schedule — the agent says "flies the
          // route", never "departs at" a time we do not have.
          schedule_source: 'route_map',
          source: adsbResult.position ? 'live' : 'route_map',
        });
      }

      // Unknown to every table but visible on ADS-B: still answer usefully —
      // refusing would waste the one genuinely live signal we have.
      if (!adsbResult.position) {
        return res.status(200).json({
          status: 'degraded',
          message: `I could not place flight ${flightNo} on the Emirates network, and it is not showing on live tracking either. Could you read the flight number back to me?`,
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

    // The airline advisory only covers the EU and the UK. For anywhere else,
    // fall through to the official source for that country rather than telling
    // the caller we do not know — "I don't cover Nigeria" is a bad answer when
    // gov.uk and emirates.com both document it.
    if (!parsed.matched) {
      const found = await liveSources.searchTrusted(
        `entry requirements visa passport rules for travellers to ${destination}`,
        destination
      );
      if (found.answer) {
        return res.status(200).json({
          destination,
          region: null,
          region_label: destination,
          applies: true,
          action_required: true,
          requirements: [found.answer],
          exemptions: [],
          summary: `Here is what the official sources say about entering ${destination}. ${found.answer}`,
          last_updated: null,
          blocks_travel: false,
          sources: found.sources,
          // Searched, not curated — the agent is told to attribute this.
          attribution_required: true,
          source: found.source,
        });
      }
    }

    // Cross-read the dedicated official page for the bloc (gov.uk for the UK,
    // europa.eu for Schengen) so we are not relying on the airline's summary of
    // someone else's border policy.
    let official = null;
    if (parsed.region) {
      const extra = await liveSources.readTopic('entry_requirements', parsed.region);
      const gov = extra.find((s) => s.key !== 'emirates_updates' && s.markdown);
      if (gov) {
        const hits = liveSources.relevantSentences(
          gov.markdown,
          `entry requirements ${parsed.region === 'uk' ? 'electronic travel authorisation ETA visa' : 'entry exit system biometric registration'}`,
          2
        );
        if (hits.length) official = { label: gov.label, url: gov.url, detail: advisory.truncate(hits.join(' '), 300) };
      }
    }

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
      official_source: official,
      // Paperwork, not a closed border. Stated explicitly so the agent never
      // reads this tool as a travel ban.
      blocks_travel: false,
      source: parsed.matched ? scraped.source : 'none',
    });
  })
);

// ---------------------------------------------------------------------------
// 10. POST /tools/recent_changes  { within_minutes? }
// ---------------------------------------------------------------------------
router.post(
  '/recent_changes',
  safe('recent_changes', async (req, res) => {
    const withinMinutes = Number(req.body?.within_minutes) || 120;
    const found = changes.recent({ limit: 3, withinMinutes });

    if (!found.length) {
      return res.status(200).json({
        changed: false,
        within_minutes: withinMinutes,
        summary: 'Nothing in the Emirates travel advisory has changed recently — what I told you is current.',
        changes: [],
        source: 'monitor',
      });
    }

    const newest = found[0];
    const minutesAgo = Math.max(
      1,
      Math.round((Date.now() - new Date(newest.detected_at).getTime()) / 60000)
    );

    res.status(200).json({
      changed: true,
      within_minutes: withinMinutes,
      minutes_ago: minutesAgo,
      summary: newest.summary
        ? `The travel advisory changed about ${minutesAgo} minutes ago. ${advisory.truncate(newest.summary, 260)}`
        : `The travel advisory changed about ${minutesAgo} minutes ago. I would re-check anything I told you before that.`,
      changes: found,
      source: 'monitor',
    });
  })
);

// ---------------------------------------------------------------------------
// 11. POST /tools/travel_intel  { question, destination? }
// ---------------------------------------------------------------------------
router.post(
  '/travel_intel',
  safe('travel_intel', async (req, res) => {
    const question = String(req.body?.question || '').trim();
    const destination = String(req.body?.destination || '').trim();
    if (!question) {
      return res.status(200).json({
        status: 'degraded',
        message: 'What would you like me to look up?',
      });
    }

    const found = await liveSources.searchTrusted(question, destination);

    if (!found.answer) {
      return res.status(200).json({
        status: 'degraded',
        message: `I could not find anything official on that just now. The Emirates desk or emirates dot com will have it. ${destination ? `You asked about ${destination}.` : ''}`.trim(),
        source: found.source,
      });
    }

    res.status(200).json({
      question,
      destination: destination || null,
      answer: found.answer,
      sources: found.sources,
      source: found.source,
      // Search hits official sites but is not a curated policy statement, so
      // the agent must attribute rather than assert.
      attribution_required: true,
    });
  })
);

// ---------------------------------------------------------------------------
// 12. POST /tools/journey_brief  { pnr }
// ---------------------------------------------------------------------------
/**
 * The whole product in one call: a record locator in, a decision out.
 *
 * A passenger holding a boarding pass can read six characters. They cannot
 * tell you their origin country's entry-restriction status, and they should
 * not have to — that is the agent's job. So this resolves the itinerary, then
 * fans out every live source at once and collapses the answers into one
 * spoken headline plus a next action.
 *
 * Fanned out with allSettled rather than sequentially: run in series these
 * checks total ~5s, in parallel ~1.5s, and a rejected check must degrade its
 * own line rather than the whole brief.
 *
 * Honesty boundary: the PNR->itinerary hop is demo data (`booking_source`).
 * Everything downstream of it is live and individually sourced in `checks`.
 */
router.post(
  '/journey_brief',
  safe('journey_brief', async (req, res) => {
    const pnr = String(req.body?.pnr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!pnr) {
      return res.status(200).json({
        status: 'degraded',
        message: 'What is your booking reference? It is the six-character code on your boarding pass.',
      });
    }

    const booking = bookings[pnr];
    if (!booking) {
      return res.status(200).json({
        status: 'degraded',
        message: `I could not find booking ${pnr.split('').join(' ')}. Could you read those six characters back to me, or give me your flight number instead?`,
        source: 'none',
      });
    }

    const lastSegment = booking.segments[booking.segments.length - 1];
    const connecting = booking.segments.length > 1;

    // One scrape, three questions. The advisory answers transit, destination
    // disruption and entry paperwork all at once, so fetching it per-question
    // would spend three credits and three rate-limit units on identical bytes.
    const [advisoryPage, position, weather] = await Promise.allSettled([
      ctx.scrape(EMIRATES_UPDATES),
      adsb.positionFor(lastSegment.flight_no),
      ctx.fetchText(METAR_URL('OMDB')),
    ]);

    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const page = val(advisoryPage);
    const p = val(position);
    const w = val(weather);

    const t = page && {
      parsed: advisory.parseTransitRules(page.data, booking.origin_city, booking.final_destination_city),
      source: page.source,
    };
    const d = page && {
      parsed: advisory.parseDisruption(page.data, booking.final_destination_city),
      source: page.source,
    };
    const e = page && {
      parsed: advisory.parseEntryRequirements(page.data, booking.final_destination_city),
      source: page.source,
    };

    const checks = [
      t && { check: 'transit_rules', ok: t.parsed.transit_allowed, detail: t.parsed.explanation, source: t.source },
      d && { check: 'disruption_status', ok: !d.parsed.blocked, detail: d.parsed.advisory_text, source: d.source },
      e && { check: 'entry_requirements', ok: !e.parsed.action_required, detail: e.parsed.summary, source: e.source },
      p && { check: 'aircraft_position', ok: true, detail: adsb.speakablePosition(p), source: p.source },
      w && { check: 'hub_weather', ok: true, detail: w.data ? w.data.split('\n')[0].trim() : null, source: w.source },
    ].filter(Boolean);

    const recent = changes.recent({ limit: 1, withinMinutes: 120 });

    // Precedence is deliberate. Being refused at the gate outranks a closed
    // destination, which outranks paperwork. Lead with whichever is worst.
    let headline;
    let nextAction;
    let clear = false;

    if (t && !t.parsed.transit_allowed) {
      headline = t.parsed.explanation;
      nextAction = t.parsed.conditional
        ? 'If that exemption covers you, bring evidence of where you have been for the last three weeks. If it does not, do not travel to the airport before speaking to Emirates.'
        : 'Do not travel to the airport yet. Call Emirates or go to a city ticket office to be re-routed.';
    } else if (d && d.parsed.blocked) {
      headline = `Travel to ${booking.final_destination_city} is currently restricted. ${d.parsed.advisory_text}`;
      nextAction = 'Ask Emirates about re-routing or a refund before you set off.';
    } else if (e && e.parsed.action_required) {
      headline = `Your journey looks clear to operate. Before you fly, though — ${e.parsed.summary}`;
      nextAction = 'Sort that paperwork before you go to the airport; without it you will not be boarded.';
      clear = true;
    } else {
      headline = `Nothing is blocking ${booking.origin_city} to ${booking.final_destination_city}${connecting ? ' through Dubai' : ''} right now.`;
      nextAction = 'Check in as normal and confirm at the transfer desk when you land.';
      clear = true;
    }

    res.status(200).json({
      pnr: booking.pnr,
      passenger: booking.passenger,
      journey: `${booking.origin_city} to ${booking.final_destination_city}${connecting ? ' via Dubai' : ''}`,
      segments: booking.segments,
      clear_to_travel: clear,
      headline: advisory.truncate(headline, 320),
      next_action: nextAction,
      advisory_changed_recently: recent.length > 0,
      advisory_change_note: recent.length ? recent[0].summary : null,
      checks,
      // The lookup is demo data; every check above is live and says so itself.
      booking_source: 'demo_booking',
      source: t?.source || d?.source || 'none',
    });
  })
);

module.exports = router;
module.exports.EMIRATES_UPDATES = EMIRATES_UPDATES;
