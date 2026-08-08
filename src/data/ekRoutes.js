'use strict';

/**
 * Emirates flight-number → route map.
 *
 * What this is: route knowledge — which city pair a flight number serves and
 * the fleet typically operating it. Emirates' numbering is stable (odd numbers
 * outbound from Dubai, the +1 even number flying the return), so this is the
 * kind of fact a route map can carry honestly.
 *
 * What this is NOT: today's schedule. No keyless source publishes live
 * departure times, gates, delays or cancellations for the full EK network —
 * that is a Cirium/OAG contract. Responses built from this table say
 * `schedule_source: "route_map"` and the agent says "flies the Dubai–London
 * route", never "departs at 14:30 today". The live layer on top is ADS-B:
 * if the aircraft is airborne we report where it actually is, and its actual
 * registration and type, which beats the "typical fleet" listed here.
 *
 * Coverage: ~140 flights across the trunk network. Long-tail numbers fall
 * through to the spoken "read the number back to me" path, which is the
 * honest response to a flight we cannot place.
 */

/** One city pair; returns both directions. Outbound ex-DXB, return is +1. */
function pair(outNo, destIata, destCity, aircraft) {
  const retNo = `EK${Number(outNo) + 1}`;
  return {
    [`EK${outNo}`]: { origin: 'DXB', origin_city: 'Dubai', destination: destIata, destination_city: destCity, aircraft },
    [retNo]: { origin: destIata, origin_city: destCity, destination: 'DXB', destination_city: 'Dubai', aircraft },
  };
}

const A380 = 'Airbus A380-800';
const B77W = 'Boeing 777-300ER';

const ekRoutes = {
  // --- United Kingdom ---
  ...pair(1, 'LHR', 'London Heathrow', A380),
  ...pair(3, 'LHR', 'London Heathrow', A380),
  ...pair(5, 'LHR', 'London Heathrow', A380),
  ...pair(7, 'LHR', 'London Heathrow', A380),
  ...pair(29, 'LHR', 'London Heathrow', A380),
  ...pair(31, 'LHR', 'London Heathrow', A380),
  ...pair(9, 'LGW', 'London Gatwick', A380),
  ...pair(11, 'LGW', 'London Gatwick', A380),
  ...pair(15, 'LGW', 'London Gatwick', A380),
  ...pair(19, 'MAN', 'Manchester', A380),
  ...pair(21, 'MAN', 'Manchester', A380),
  ...pair(23, 'BHX', 'Birmingham', B77W),
  ...pair(39, 'BHX', 'Birmingham', B77W),
  ...pair(25, 'GLA', 'Glasgow', B77W),
  ...pair(27, 'GLA', 'Glasgow', B77W),
  ...pair(35, 'NCL', 'Newcastle', B77W),
  ...pair(37, 'NCL', 'Newcastle', B77W),
  ...pair(41, 'EDI', 'Edinburgh', B77W),

  // --- Ireland, France, Benelux ---
  ...pair(161, 'DUB', 'Dublin', B77W),
  ...pair(163, 'DUB', 'Dublin', B77W),
  ...pair(71, 'CDG', 'Paris Charles de Gaulle', A380),
  ...pair(73, 'CDG', 'Paris Charles de Gaulle', A380),
  ...pair(75, 'CDG', 'Paris Charles de Gaulle', A380),
  ...pair(77, 'NCE', 'Nice', B77W),
  ...pair(145, 'AMS', 'Amsterdam', A380),
  ...pair(147, 'AMS', 'Amsterdam', A380),
  ...pair(181, 'BRU', 'Brussels', B77W),
  ...pair(183, 'BRU', 'Brussels', B77W),

  // --- Germany, Switzerland, Austria ---
  ...pair(43, 'FRA', 'Frankfurt', A380),
  ...pair(45, 'FRA', 'Frankfurt', A380),
  ...pair(47, 'FRA', 'Frankfurt', A380),
  ...pair(49, 'MUC', 'Munich', A380),
  ...pair(51, 'MUC', 'Munich', A380),
  ...pair(53, 'MUC', 'Munich', A380),
  ...pair(55, 'DUS', 'Dusseldorf', B77W),
  ...pair(57, 'DUS', 'Dusseldorf', B77W),
  ...pair(59, 'HAM', 'Hamburg', B77W),
  ...pair(61, 'HAM', 'Hamburg', B77W),
  ...pair(85, 'ZRH', 'Zurich', A380),
  ...pair(87, 'ZRH', 'Zurich', A380),
  ...pair(83, 'GVA', 'Geneva', B77W),
  ...pair(89, 'GVA', 'Geneva', B77W),
  ...pair(127, 'VIE', 'Vienna', B77W),

  // --- Italy, Iberia, Greece, Turkey ---
  ...pair(91, 'FCO', 'Rome Fiumicino', B77W),
  ...pair(97, 'FCO', 'Rome Fiumicino', A380),
  ...pair(101, 'MXP', 'Milan Malpensa', A380),
  ...pair(93, 'MXP', 'Milan Malpensa', A380),
  ...pair(135, 'VCE', 'Venice', B77W),
  ...pair(99, 'BLQ', 'Bologna', B77W),
  ...pair(141, 'MAD', 'Madrid', A380),
  ...pair(143, 'MAD', 'Madrid', B77W),
  ...pair(185, 'BCN', 'Barcelona', A380),
  ...pair(187, 'BCN', 'Barcelona', A380),
  ...pair(191, 'LIS', 'Lisbon', B77W),
  ...pair(103, 'ATH', 'Athens', B77W),
  ...pair(105, 'ATH', 'Athens', B77W),
  ...pair(121, 'IST', 'Istanbul', B77W),
  ...pair(123, 'IST', 'Istanbul', B77W),

  // --- North America ---
  ...pair(201, 'JFK', 'New York JFK', A380),
  ...pair(203, 'JFK', 'New York JFK', A380),
  ...pair(207, 'JFK', 'New York JFK', A380),
  ...pair(215, 'LAX', 'Los Angeles', A380),
  ...pair(217, 'LAX', 'Los Angeles', A380),
  ...pair(225, 'SFO', 'San Francisco', A380),
  ...pair(235, 'ORD', 'Chicago O\u2019Hare', B77W),
  ...pair(231, 'IAD', 'Washington Dulles', B77W),
  ...pair(237, 'BOS', 'Boston', B77W),
  ...pair(213, 'MIA', 'Miami', A380),
  ...pair(221, 'DFW', 'Dallas Fort Worth', B77W),
  ...pair(211, 'IAH', 'Houston', A380),
  ...pair(229, 'SEA', 'Seattle', B77W),
  ...pair(241, 'YYZ', 'Toronto', A380),

  // --- Middle East, Levant, Egypt ---
  ...pair(957, 'BEY', 'Beirut', B77W),
  ...pair(953, 'BEY', 'Beirut', B77W),
  ...pair(903, 'AMM', 'Amman', B77W),
  ...pair(905, 'AMM', 'Amman', B77W),
  ...pair(923, 'CAI', 'Cairo', B77W),
  ...pair(927, 'CAI', 'Cairo', B77W),
  ...pair(929, 'CAI', 'Cairo', B77W),
  ...pair(801, 'RUH', 'Riyadh', B77W),
  ...pair(803, 'RUH', 'Riyadh', B77W),
  ...pair(805, 'JED', 'Jeddah', B77W),
  ...pair(807, 'JED', 'Jeddah', B77W),
  ...pair(853, 'KWI', 'Kuwait', B77W),
  ...pair(855, 'KWI', 'Kuwait', B77W),
  ...pair(837, 'BAH', 'Bahrain', B77W),
  ...pair(841, 'BAH', 'Bahrain', B77W),
  ...pair(861, 'MCT', 'Muscat', B77W),
  ...pair(863, 'MCT', 'Muscat', B77W),

  // --- South Asia ---
  ...pair(500, 'BOM', 'Mumbai', B77W),
  ...pair(502, 'BOM', 'Mumbai', B77W),
  ...pair(504, 'BOM', 'Mumbai', A380),
  ...pair(510, 'DEL', 'Delhi', B77W),
  ...pair(512, 'DEL', 'Delhi', B77W),
  ...pair(514, 'DEL', 'Delhi', A380),
  ...pair(564, 'BLR', 'Bengaluru', B77W),
  ...pair(566, 'BLR', 'Bengaluru', B77W),
  ...pair(544, 'MAA', 'Chennai', B77W),
  ...pair(546, 'MAA', 'Chennai', B77W),
  ...pair(524, 'HYD', 'Hyderabad', B77W),
  ...pair(526, 'HYD', 'Hyderabad', B77W),
  ...pair(530, 'COK', 'Kochi', B77W),
  ...pair(532, 'COK', 'Kochi', B77W),
  ...pair(570, 'CCU', 'Kolkata', B77W),
  ...pair(600, 'KHI', 'Karachi', B77W),
  ...pair(606, 'KHI', 'Karachi', B77W),
  ...pair(622, 'LHE', 'Lahore', B77W),
  ...pair(624, 'LHE', 'Lahore', B77W),
  ...pair(612, 'ISB', 'Islamabad', B77W),
  ...pair(614, 'ISB', 'Islamabad', B77W),
  ...pair(582, 'DAC', 'Dhaka', B77W),
  ...pair(584, 'DAC', 'Dhaka', B77W),
  ...pair(586, 'DAC', 'Dhaka', B77W),
  ...pair(650, 'CMB', 'Colombo', B77W),
  ...pair(654, 'CMB', 'Colombo', B77W),
  ...pair(652, 'MLE', 'Male', B77W),
  ...pair(656, 'MLE', 'Male', B77W),

  // --- East and Southeast Asia ---
  ...pair(372, 'BKK', 'Bangkok', A380),
  ...pair(374, 'BKK', 'Bangkok', A380),
  ...pair(376, 'BKK', 'Bangkok', A380),
  ...pair(352, 'SIN', 'Singapore', A380),
  ...pair(354, 'SIN', 'Singapore', A380),
  ...pair(342, 'KUL', 'Kuala Lumpur', A380),
  ...pair(346, 'KUL', 'Kuala Lumpur', A380),
  ...pair(356, 'CGK', 'Jakarta', B77W),
  ...pair(358, 'CGK', 'Jakarta', B77W),
  ...pair(332, 'MNL', 'Manila', B77W),
  ...pair(334, 'MNL', 'Manila', B77W),
  ...pair(380, 'HKG', 'Hong Kong', A380),
  ...pair(382, 'HKG', 'Hong Kong', A380),
  ...pair(302, 'PVG', 'Shanghai Pudong', A380),
  ...pair(304, 'PVG', 'Shanghai Pudong', A380),
  ...pair(306, 'PEK', 'Beijing', A380),
  ...pair(308, 'PEK', 'Beijing', A380),
  ...pair(322, 'ICN', 'Seoul Incheon', A380),
  ...pair(318, 'NRT', 'Tokyo Narita', B77W),
  ...pair(312, 'HND', 'Tokyo Haneda', A380),

  // --- Australia, New Zealand ---
  ...pair(412, 'SYD', 'Sydney', A380),
  ...pair(414, 'SYD', 'Sydney', A380),
  ...pair(406, 'MEL', 'Melbourne', A380),
  ...pair(408, 'MEL', 'Melbourne', A380),
  ...pair(430, 'BNE', 'Brisbane', A380),
  ...pair(434, 'BNE', 'Brisbane', A380),
  ...pair(420, 'PER', 'Perth', A380),
  ...pair(424, 'PER', 'Perth', B77W),
  ...pair(448, 'AKL', 'Auckland', A380),

  // --- Africa ---
  ...pair(761, 'JNB', 'Johannesburg', A380),
  ...pair(763, 'JNB', 'Johannesburg', A380),
  ...pair(765, 'JNB', 'Johannesburg', B77W),
  ...pair(770, 'CPT', 'Cape Town', B77W),
  ...pair(772, 'CPT', 'Cape Town', B77W),
  ...pair(775, 'DUR', 'Durban', B77W),
  ...pair(719, 'NBO', 'Nairobi', B77W),
  ...pair(721, 'NBO', 'Nairobi', B77W),
  ...pair(729, 'EBB', 'Entebbe', B77W),
  ...pair(783, 'LOS', 'Lagos', B77W),
  ...pair(787, 'ACC', 'Accra', B77W),
  ...pair(725, 'DAR', 'Dar es Salaam', B77W),
  ...pair(707, 'SEZ', 'Seychelles', B77W),
  ...pair(703, 'MRU', 'Mauritius', A380),
  ...pair(701, 'MRU', 'Mauritius', A380),
  ...pair(751, 'CMN', 'Casablanca', B77W),

  // --- South America ---
  ...pair(261, 'GRU', 'Sao Paulo', B77W),
  ...pair(247, 'GIG', 'Rio de Janeiro', B77W),
};

/** EK17 / EK 017 / ek17 → the map key. */
function routeFor(flightNo) {
  const key = String(flightNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = key.match(/^EK0*(\d{1,4})$/);
  if (!m) return null;
  return ekRoutes[`EK${m[1]}`] || null;
}

module.exports = { ekRoutes, routeFor };
