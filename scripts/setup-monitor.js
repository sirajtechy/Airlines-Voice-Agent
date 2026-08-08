#!/usr/bin/env node
'use strict';

/**
 * Point a context.dev Monitor at the Emirates travel-updates page so we learn
 * that it *changed*, not merely what it says right now.
 *
 *   BACKEND_URL=https://your-app.onrender.com node scripts/setup-monitor.js
 *   node scripts/setup-monitor.js --list
 *   node scripts/setup-monitor.js --delete
 *
 * Why a monitor and not just a faster poll: polling answers "what does the
 * page say", which we already have. A monitor answers "what moved, when, and
 * how much does it matter" — semantic detection with an importance score. That
 * is the difference between an agent that is merely current and one that can
 * say "this changed eleven minutes ago, after you left for the airport."
 *
 * Semantic (not exact) detection is deliberate. The page carries a
 * last-updated timestamp and rotating promo copy; exact diffing would fire on
 * every tick and train everyone to ignore it. `instructions` scopes detection
 * to the sentences that actually change a passenger's decision.
 */

require('../src/lib/env').load();

const ctx = require('../src/lib/contextClient');
const { SOURCES } = require('../src/data/sources');

const MONITOR_NAME = 'RAAHI — Emirates travel updates';
const TARGET_URL = SOURCES.emirates_updates.url;

const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
const wantList = process.argv.includes('--list');
const wantDelete = process.argv.includes('--delete');

// 15 minutes: the API floor is 10, and each run costs credits. Fifteen bounds
// the "how stale could this be" answer to a quarter of an hour while leaving
// headroom in a hackathon credit budget.
const FREQUENCY_MINUTES = Number(process.env.MONITOR_FREQUENCY_MINUTES || 15);

async function findExisting() {
  const list = await ctx.monitors('GET');
  const monitors = list.monitors || list.data || [];
  return monitors.find((m) => m.name === MONITOR_NAME) || null;
}

async function main() {
  if (wantList) {
    const list = await ctx.monitors('GET');
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  const existing = await findExisting();

  if (wantDelete) {
    if (!existing) return console.log('  No monitor to delete.');
    await ctx.monitors('DELETE', `/${existing.id}`);
    return console.log(`  Deleted monitor ${existing.id}`);
  }

  if (!backendUrl) {
    console.error('\n  BACKEND_URL is not set — the monitor needs somewhere to deliver changes.\n');
    process.exit(1);
  }
  if (!/^https:\/\//.test(backendUrl)) {
    console.error(`\n  BACKEND_URL must be https, got ${backendUrl}\n`);
    process.exit(1);
  }

  const body = {
    mode: 'web',
    name: MONITOR_NAME,
    target: {
      type: 'page',
      url: TARGET_URL,
      instructions:
        'Report only changes that would alter a passenger\'s travel decision: new or lifted entry restrictions, ' +
        'country entry bans, route suspensions or resumptions, transit and connection rules through Dubai, ' +
        'changes to which countries are affected, changes to exemption periods such as a 21-day rule, and new ' +
        'visa or travel-authorisation requirements. Ignore marketing copy, lounge and refurbishment notices, ' +
        'the page last-updated timestamp, and navigation changes.',
    },
    change_detection: { type: 'semantic' },
    schedule: { type: 'interval', frequency: FREQUENCY_MINUTES, unit: 'minutes' },
    webhook: {
      url: `${backendUrl}/webhooks/context`,
      events: ['change.detected'],
    },
  };

  if (existing) {
    const updated = await ctx.monitors('PATCH', `/${existing.id}`, body);
    console.log(`\n  Updated monitor ${existing.id}`);
    report(updated);
    return;
  }

  const created = await ctx.monitors('POST', '', body);
  const monitor = created.monitor || created;
  console.log(`\n  Created monitor ${monitor.id}`);
  report(created);
}

function report(result) {
  const monitor = result.monitor || result;
  // The signing secret is generated server-side and returned once here; the
  // backend needs it in CONTEXT_WEBHOOK_SECRET or every delivery is rejected.
  const secret = monitor.webhook?.secret || result.webhook?.secret || null;
  console.log(`  Target       ${TARGET_URL}`);
  console.log(`  Every        ${FREQUENCY_MINUTES} minutes, semantic detection`);
  console.log(`  Delivers to  ${backendUrl}/webhooks/context`);
  console.log(`  Baseline run ${result.initial_run_id || monitor.initial_run_id || '(scheduled)'}`);
  if (secret) {
    console.log(`\n  Set this on the backend so deliveries verify:\n\n    CONTEXT_WEBHOOK_SECRET=${secret}\n`);
  } else {
    console.log('\n  No secret returned — deliveries will be unsigned. Check the monitor in the dashboard.\n');
  }
}

main().catch((err) => {
  console.error(`\n  Monitor setup failed.\n\n  ${err.message}\n`);
  process.exit(1);
});
