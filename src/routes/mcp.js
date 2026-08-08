'use strict';

/**
 * An MCP server, served by the same backend, attached natively to the
 * ElevenLabs agent.
 *
 * Why this exists instead of the flight-tracking MCPs on the public
 * registries: ElevenLabs attaches MCP servers by **hosted https URL** (SSE or
 * streamable HTTP). The registry packages (airplanes-live-mcp, Google-Flights,
 * Flight-Search) are stdio processes built for desktop clients — there is
 * nothing to point ElevenLabs at without hosting them ourselves, two of the
 * three need paid API keys we do not have, and airplanes.live's terms are
 * non-commercial. So we host the same capability class here, on data we are
 * licensed to use (adsb.lol, ODbL), one process with the rest of the backend.
 *
 * The webhook tools answer schedule-and-policy questions; the MCP tools answer
 * physical-world ones — where is this aircraft, what is actually moving over
 * Dubai — which is also a live demonstration of the two integration paths
 * ElevenLabs supports side by side.
 *
 * Implements the streamable-HTTP transport (spec 2025-03-26) minimally:
 * JSON-RPC 2.0 over POST, notifications answered 202, GET answered 405
 * because we never push server-initiated messages.
 */

const express = require('express');
const adsb = require('../lib/adsb');
const { airports, cityToIata } = require('../data/mocks');

const router = express.Router();

const PROTOCOL_VERSION = '2025-03-26';

/** Airport coordinates for the airspace snapshot. DXB is the hub default. */
const AIRPORT_COORDS = {
  DXB: { lat: 25.2532, lon: 55.3657, label: 'Dubai' },
  LHR: { lat: 51.47, lon: -0.4543, label: 'London Heathrow' },
  EBB: { lat: 0.0424, lon: 32.4435, label: 'Entebbe' },
  BEY: { lat: 33.8209, lon: 35.4884, label: 'Beirut' },
  JFK: { lat: 40.6413, lon: -73.7781, label: 'New York JFK' },
  BOM: { lat: 19.0896, lon: 72.8656, label: 'Mumbai' },
  DEL: { lat: 28.5562, lon: 77.1, label: 'Delhi' },
};

function resolveAirport(input) {
  const raw = String(input || 'DXB').trim();
  const upper = raw.toUpperCase();
  if (AIRPORT_COORDS[upper]) return { code: upper, ...AIRPORT_COORDS[upper] };
  const viaCity = cityToIata[raw.toLowerCase()];
  if (viaCity && AIRPORT_COORDS[viaCity]) return { code: viaCity, ...AIRPORT_COORDS[viaCity] };
  const viaIcao = Object.entries(airports).find(([, v]) => v.icao === upper);
  if (viaIcao && AIRPORT_COORDS[viaIcao[0]]) return { code: viaIcao[0], ...AIRPORT_COORDS[viaIcao[0]] };
  return { code: 'DXB', ...AIRPORT_COORDS.DXB };
}

const TOOLS = [
  {
    name: 'track_aircraft',
    description:
      'Live position of an aircraft by flight number, from ADS-B transponder data (adsb.lol). ' +
      'Returns altitude, speed, climb/descent and a speakable summary for aircraft currently airborne. ' +
      'An empty result means the aircraft is not being tracked in the air right now — not departed or ' +
      'out of receiver coverage. It NEVER means the flight is cancelled, and this tool knows nothing ' +
      'about schedules, gates or delays.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_no: { type: 'string', description: 'Flight number, e.g. EK17 or EK 017' },
      },
      required: ['flight_no'],
    },
  },
  {
    name: 'airspace_snapshot',
    description:
      'Live picture of what is physically flying near an airport right now, from ADS-B. Answers ' +
      '"how busy is Dubai at the moment", "are Emirates flights actually moving". Returns the total ' +
      'aircraft count and the lowest dozen (the ones arriving or departing), optionally filtered to ' +
      'one airline. Supported airports: Dubai, Heathrow, Entebbe, Beirut, JFK, Mumbai, Delhi.',
    inputSchema: {
      type: 'object',
      properties: {
        airport: { type: 'string', description: 'Airport city or IATA code, defaults to Dubai (DXB)' },
        airline: {
          type: 'string',
          description: 'Optional airline filter: EK/Emirates -> UAE callsigns. Pass the IATA code.',
        },
      },
      required: [],
    },
  },
];

const AIRLINE_PREFIX = { EK: 'UAE', FZ: 'FDB', QR: 'QTR', EY: 'ETD', BA: 'BAW', EMIRATES: 'UAE' };

async function callTool(name, args = {}) {
  if (name === 'track_aircraft') {
    const result = await adsb.positionFor(args.flight_no);
    return {
      flight_no: args.flight_no,
      airborne: result.source === 'live' ? Boolean(result.airborne) : null,
      position: result.position,
      speakable: adsb.speakablePosition(result),
      source: result.source,
    };
  }

  if (name === 'airspace_snapshot') {
    const airport = resolveAirport(args.airport);
    const prefix = args.airline
      ? AIRLINE_PREFIX[String(args.airline).toUpperCase()] || String(args.airline).toUpperCase()
      : null;
    const result = await adsb.snapshot(airport.lat, airport.lon, 100, prefix);
    return {
      airport: airport.code,
      area: airport.label,
      radius_nm: 100,
      total_aircraft_tracked: result.total,
      shown: result.aircraft.length,
      aircraft: result.aircraft,
      speakable:
        result.source === 'live'
          ? `There are ${result.total} aircraft being tracked within a hundred nautical miles of ${airport.label} right now${prefix ? `, ${result.aircraft.length} of them ${args.airline}` : ''}.`
          : `Live tracking around ${airport.label} is not reachable just now.`,
      source: result.source,
    };
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

router.post('/', async (req, res) => {
  const msg = req.body;

  // Notifications (no id) get a bare 202 per the streamable HTTP transport.
  if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) {
    return res.status(202).end();
  }

  try {
    switch (msg.method) {
      case 'initialize':
        return res.status(200).json(
          rpcResult(msg.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'irops-flight-tracking', version: '1.0.0' },
          })
        );
      case 'ping':
        return res.status(200).json(rpcResult(msg.id, {}));
      case 'tools/list':
        return res.status(200).json(rpcResult(msg.id, { tools: TOOLS }));
      case 'tools/call': {
        const { name, arguments: args } = msg.params || {};
        try {
          const result = await callTool(name, args);
          return res.status(200).json(
            rpcResult(msg.id, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: false,
            })
          );
        } catch (err) {
          // Tool-level failures are results, not protocol errors — the agent
          // should hear "couldn't reach tracking", not lose the connection.
          return res.status(200).json(
            rpcResult(msg.id, {
              content: [{ type: 'text', text: `Tool failed: ${err.message}` }],
              isError: true,
            })
          );
        }
      }
      default:
        return res.status(200).json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  } catch (err) {
    return res.status(200).json(rpcError(msg.id, -32603, err.message));
  }
});

// We never open a server-initiated stream; saying so is part of the transport.
router.get('/', (req, res) => res.status(405).json({ error: 'SSE stream not supported; POST JSON-RPC.' }));
router.delete('/', (req, res) => res.status(200).end());

module.exports = router;
