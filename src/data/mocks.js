'use strict';

/**
 * Final-fallback data. Everything here is static so the demo survives a
 * total loss of internet. Live sources are always tried first.
 */

const flightDB = {
  EK17: {
    flight_no: 'EK17',
    route: 'DXB → LHR',
    origin: 'DXB',
    destination: 'LHR',
    scheduled_departure: '2026-08-08T07:45:00Z',
    estimated_departure: '2026-08-08T09:20:00Z',
    status: 'Delayed',
    delay_minutes: 95,
    gate: 'A14',
    aircraft: 'A380-800',
    reason: 'Late inbound aircraft plus an ATC flow restriction into Heathrow.',
  },
  EK001: {
    flight_no: 'EK001',
    route: 'DXB → LHR',
    origin: 'DXB',
    destination: 'LHR',
    scheduled_departure: '2026-08-08T02:30:00Z',
    estimated_departure: '2026-08-08T02:30:00Z',
    status: 'On Time',
    delay_minutes: 0,
    gate: 'B12',
    aircraft: 'A380-800',
    reason: null,
  },
  EK957: {
    flight_no: 'EK957',
    route: 'DXB → BEY',
    origin: 'DXB',
    destination: 'BEY',
    scheduled_departure: '2026-08-08T10:15:00Z',
    estimated_departure: null,
    status: 'Cancelled',
    delay_minutes: null,
    gate: null,
    aircraft: 'B777-300ER',
    reason: 'Route suspended under a regional airspace advisory.',
  },
};

const policies = {
  delay_compensation: {
    topic: 'delay_compensation',
    summary:
      'On a delay of five hours or more you can request a full refund of the unused portion, or rebook onto the next available flight at no extra fare. Meal vouchers are issued from two hours; hotel accommodation from six hours on an overnight disruption.',
    source_hint: 'Emirates Conditions of Carriage, Article 9 (Schedule changes and delays).',
  },
  cancellation: {
    topic: 'cancellation',
    summary:
      'If we cancel your flight you may take the next available Emirates service at no additional cost, be rerouted on a partner carrier, or take a full refund with no cancellation fee. Rebooking is free even on the lowest fare classes when the cancellation is ours.',
    source_hint: 'Emirates Conditions of Carriage, Article 9.',
  },
  baggage_delay: {
    topic: 'baggage_delay',
    summary:
      'Report delayed baggage at the arrivals baggage desk before leaving the airport and keep the property irregularity report reference. Reasonable essential-purchase expenses are reimbursable on production of receipts, and most bags are reunited within forty-eight hours.',
    source_hint: 'Montreal Convention, Article 19, as applied in Emirates baggage policy.',
  },
  missed_connection: {
    topic: 'missed_connection',
    summary:
      'If you miss a connection because an Emirates flight arrived late, you are rebooked onto the next available service at no charge. Go to the transfer desk in Concourse B or C rather than leaving the transit area, and ask for a connection voucher if the wait exceeds four hours.',
    source_hint: 'Emirates transfer and connection handling policy.',
  },
  refund: {
    topic: 'refund',
    summary:
      'Refunds for disruptions we caused are processed to the original form of payment, typically within seven business days for cards and up to twenty business days for other methods. A refund closes the booking, so choose it only if you no longer want to travel.',
    source_hint: 'Emirates refund policy.',
  },
};

const rebookingOptions = {
  LHR: [
    { flight_no: 'EK003', departs: '2026-08-08T14:30:00Z', arrives: '2026-08-08T19:05:00Z', seats: 12, cabin: 'Economy', note: 'Next available, same-day.' },
    { flight_no: 'EK007', departs: '2026-08-08T20:10:00Z', arrives: '2026-08-09T00:45:00Z', seats: 4, cabin: 'Economy', note: 'Evening service, lighter load.' },
    { flight_no: 'EK029', departs: '2026-08-09T03:15:00Z', arrives: '2026-08-09T07:50:00Z', seats: 26, cabin: 'Economy', note: 'Overnight; hotel voucher applies.' },
  ],
  BEY: [
    { flight_no: 'PARTNER-MEA', departs: '2026-08-09T08:00:00Z', arrives: '2026-08-09T10:40:00Z', seats: 6, cabin: 'Economy', note: 'Partner carrier while the Emirates route is suspended.' },
  ],
  DEFAULT: [
    { flight_no: 'EK-NEXT', departs: null, arrives: null, seats: null, cabin: 'Economy', note: 'Next available Emirates service; the transfer desk can confirm the exact flight.' },
  ],
};

const turnaroundBriefs = {
  EK17: {
    flight_no: 'EK17',
    stand: 'A14',
    inbound: 'EK18 from LHR, on stand at 06:10Z',
    ground_time_minutes: 95,
    critical_path: 'Cabin deep-clean is the constraint; catering and fuelling run in parallel.',
    crew: 'Operating crew within duty limits until 12:40Z.',
    risks: ['Late inbound eats 40 minutes of buffer', 'ATC slot into LHR is fixed — a further 20-minute slip loses it'],
  },
};

const strandedSupportBaseline =
  'If your delay exceeds 6 hours due to a cancellation, ask the Emirates transfer desk about hotel and meal vouchers. During major regional disruptions, Dubai authorities have historically covered accommodation for stranded transit passengers — ask the airport\'s passenger-support desk in Terminal 3.';

/**
 * Airport metadata used to resolve spoken city names to ICAO/IATA codes.
 */
const airports = {
  DXB: { icao: 'OMDB', city: 'Dubai' },
  OMDB: { icao: 'OMDB', city: 'Dubai' },
  LHR: { icao: 'EGLL', city: 'London' },
  EGLL: { icao: 'EGLL', city: 'London' },
  BEY: { icao: 'OLBA', city: 'Beirut' },
  OLBA: { icao: 'OLBA', city: 'Beirut' },
  JFK: { icao: 'KJFK', city: 'New York' },
  KJFK: { icao: 'KJFK', city: 'New York' },
  BOM: { icao: 'VABB', city: 'Mumbai' },
  DEL: { icao: 'VIDP', city: 'Delhi' },
  THR: { icao: 'OIII', city: 'Tehran' },
  BGW: { icao: 'ORBI', city: 'Baghdad' },
  AMM: { icao: 'OJAI', city: 'Amman' },
};

const cityToIata = {
  dubai: 'DXB',
  london: 'LHR',
  beirut: 'BEY',
  'new york': 'JFK',
  mumbai: 'BOM',
  delhi: 'DEL',
  tehran: 'THR',
  baghdad: 'BGW',
  amman: 'AMM',
};

module.exports = {
  flightDB,
  policies,
  rebookingOptions,
  turnaroundBriefs,
  strandedSupportBaseline,
  airports,
  cityToIata,
};
