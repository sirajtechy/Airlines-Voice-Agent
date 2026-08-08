'use strict';

/**
 * Protocol-shape tests for the MCP endpoint. ElevenLabs is the client here,
 * and a malformed JSON-RPC response does not degrade politely — the tools
 * simply vanish from the agent. No network: tool *calls* are exercised only
 * for their error paths.
 */

process.env.CONTEXT_DEV_API_KEY = '';
process.env.ADSB_TIMEOUT_MS = '1200';
process.env.CACHE_REFRESH_MS = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/mcp`;
});

after(() => server && server.close());

async function rpc(body) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

test('initialize returns protocol version and server info', async () => {
  const { status, json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.id, 1);
  assert.ok(json.result.protocolVersion);
  assert.ok(json.result.serverInfo.name);
  assert.ok(json.result.capabilities.tools, 'must advertise the tools capability');
});

test('notifications get 202 with no body', async () => {
  const { status } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.strictEqual(status, 202);
});

test('tools/list names both tools with schemas', async () => {
  const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = json.result.tools.map((t) => t.name);
  assert.deepStrictEqual(names.sort(), ['airspace_snapshot', 'track_aircraft']);
  for (const t of json.result.tools) {
    assert.ok(t.description.length > 50, `${t.name} needs a description the LLM can route on`);
    assert.strictEqual(t.inputSchema.type, 'object');
  }
});

test('unknown method is a -32601 error, not a crash', async () => {
  const { status, json } = await rpc({ jsonrpc: '2.0', id: 3, method: 'does/not/exist' });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.error.code, -32601);
});

test('unknown tool is an in-band tool error the agent can speak', async () => {
  const { status, json } = await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'nonexistent', arguments: {} },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.result.isError, true, 'tool failures are results, not protocol errors');
});

test('track_aircraft with no network still answers in protocol shape', async () => {
  const { status, json } = await rpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'track_aircraft', arguments: { flight_no: 'EK17' } },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.result.isError, false);
  const payload = JSON.parse(json.result.content[0].text);
  assert.ok('airborne' in payload && 'source' in payload);
  if (payload.source !== 'live') {
    assert.strictEqual(payload.airborne, null, 'a failed lookup must not claim on-the-ground');
  }
});

test('GET refuses the SSE stream explicitly', async () => {
  const res = await fetch(base);
  assert.strictEqual(res.status, 405);
});
