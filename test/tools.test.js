'use strict';

/**
 * Degraded-path proof: with no API key and no cache, every tool must still
 * answer 200 with a body the voice agent can read aloud. This is the test that
 * matters — it simulates the demo losing the internet.
 */

process.env.CONTEXT_DEV_API_KEY = '';
process.env.FETCH_TIMEOUT_MS = '1500';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/server');
const cache = require('../src/lib/cache');

let server;
let base;

before(async () => {
  cache.clear();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const CASES = [
  ['/tools/flight_status', { flight_no: 'EK17' }, ['flight_no', 'status']],
  ['/tools/weather_ops', { airport: 'DXB' }, ['airport']],
  ['/tools/policy_lookup', { topic: 'delay compensation' }, ['summary']],
  ['/tools/rebooking_options', { flight_no: 'EK17' }, ['options']],
  ['/tools/turnaround_brief', { flight_no: 'EK17' }, ['flight_no']],
  ['/tools/disruption_status', { destination: 'Beirut' }, ['destination', 'suspended', 'advisory_text']],
  ['/tools/transit_rules', { origin: 'Mumbai', final_destination: 'Beirut' }, ['transit_allowed', 'explanation']],
  ['/tools/stranded_support', { location: 'Dubai' }, ['location', 'support_text']],
];

for (const [path, body, fields] of CASES) {
  test(`${path} answers 200 with no network`, async () => {
    const { status, json } = await post(path, body);
    assert.strictEqual(status, 200, `${path} must never return non-200`);
    assert.ok(json && typeof json === 'object', `${path} must return a JSON object`);

    const degraded = json.status === 'degraded';
    if (degraded) {
      assert.ok(typeof json.message === 'string' && json.message.length > 0,
        `${path} degraded response must carry a spoken message`);
    } else {
      for (const f of fields) {
        assert.ok(f in json, `${path} response missing required field "${f}"`);
      }
    }
  });
}

test('every tool responds well inside the ElevenLabs 20s timeout', async () => {
  for (const [path, body] of CASES) {
    const started = Date.now();
    await post(path, body);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 15000, `${path} took ${elapsed}ms, over the 15s budget`);
  }
});

test('missing required params degrade instead of crashing', async () => {
  for (const path of ['/tools/flight_status', '/tools/disruption_status', '/tools/transit_rules']) {
    const { status, json } = await post(path, {});
    assert.strictEqual(status, 200);
    assert.ok(json.status === 'degraded' || 'source' in json, `${path} should degrade on empty body`);
  }
});

test('healthz reports cache state', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.ok, true);
  assert.ok(typeof json.cache_entries === 'number');
  assert.ok(typeof json.uptime_s === 'number');
});

test('unknown tool path returns a spoken 404 body, not an empty error', async () => {
  const { status, json } = await post('/tools/does_not_exist', {});
  assert.strictEqual(status, 404);
  assert.strictEqual(json.status, 'degraded');
  assert.ok(json.message);
});
