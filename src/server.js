'use strict';

require('./lib/env').load();

const express = require('express');
const toolsRouter = require('./routes/tools');
const ctx = require('./lib/contextClient');
const cache = require('./lib/cache');
const changes = require('./lib/changes');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOTED_AT = Date.now();

// Keep the raw bytes: the context.dev monitor webhook is HMAC-signed over the
// exact body, and re-serialising parsed JSON would not reproduce it.
app.use(
  express.json({
    limit: '256kb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

// Tolerate a malformed body rather than 400-ing at ElevenLabs.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    req.body = {};
    return next();
  }
  return next(err);
});

app.use((req, res, next) => {
  req.log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
  if (req.path.startsWith('/tools/')) {
    req.log(`-> ${req.method} ${req.path} ${JSON.stringify(req.body || {})}`);
  }
  next();
});

/**
 * Optional shared-secret gate. Off unless TOOL_SHARED_SECRET is set, so the
 * demo works with zero configuration.
 */
app.use(['/tools', '/admin'], (req, res, next) => {
  const expected = (process.env.TOOL_SHARED_SECRET || '').trim();
  if (!expected) return next();
  if (req.get('x-tool-secret') === expected) return next();
  return res.status(401).json({ status: 'degraded', message: 'Tool authentication failed.' });
});

app.get('/', (req, res) => res.type('text/plain').send('IROPS Copilot backend is running.'));

app.get('/healthz', (req, res) => {
  // Surface how stale the advisory actually is. "We cache" is only defensible
  // if we can say by how much.
  const advisoryEntry = cache.get(ctx.WARM_URLS[0]);
  res.status(200).json({
    ok: true,
    cache_entries: cache.count(),
    advisory_cached_at: advisoryEntry?.cached_at || null,
    advisory_age_s: advisoryEntry
      ? Math.round((Date.now() - new Date(advisoryEntry.cached_at).getTime()) / 1000)
      : null,
    cache_refresh_ms: Number(process.env.CACHE_REFRESH_MS || 300000),
    uptime_s: Math.round((Date.now() - BOOTED_AT) / 1000),
    context_dev_key: Boolean((process.env.CONTEXT_DEV_API_KEY || '').trim()),
    sources_configured: ctx.WARM_URLS.length,
    monitor_changes_seen: changes.count(),
    webhook_secret_set: Boolean((process.env.CONTEXT_WEBHOOK_SECRET || '').trim()),
  });
});

app.post('/admin/warm', async (req, res) => {
  const warmed = await ctx.warmCache();
  res.status(200).json({ warmed });
});

/**
 * context.dev Monitors push here when the advisory page changes.
 *
 * Sits outside the /tools and /admin auth gate because context.dev signs its
 * deliveries instead of carrying our shared secret. Always 200s on a duplicate
 * or unparseable payload — a webhook endpoint that 500s gets retried, then
 * disabled.
 */
app.post('/webhooks/context', (req, res) => {
  const secret = (process.env.CONTEXT_WEBHOOK_SECRET || '').trim();
  const signature = req.get('x-context-signature') || req.get('X-Context-Signature');

  if (!changes.verifySignature(req.rawBody || '', signature, secret)) {
    req.log?.('[webhook] rejected: bad signature');
    return res.status(401).json({ ok: false, error: 'invalid signature' });
  }

  const event = req.body?.event || req.body?.type || 'unknown';
  // run.completed fires on every tick including no-change runs; only a real
  // change is worth surfacing to a caller.
  if (event.includes('run.completed') && !req.body?.change && !req.body?.data?.change) {
    return res.status(200).json({ ok: true, recorded: false, reason: 'no change in run' });
  }

  const entry = changes.record(changes.fromWebhook(req.body));
  req.log?.(`[webhook] change recorded ${entry.id} ${entry.url || ''}`);
  res.status(200).json({ ok: true, recorded: true, id: entry.id });
});

app.use('/tools', toolsRouter);
app.use('/mcp', require('./routes/mcp'));

app.use((req, res) => {
  res.status(404).json({ status: 'degraded', message: `No tool at ${req.method} ${req.path}.` });
});

// Last-resort guard: ElevenLabs must never receive an empty 500.
app.use((err, req, res, next) => {
  console.error('unhandled', err);
  if (res.headersSent) return;
  res.status(200).json({
    status: 'degraded',
    message: 'Something went wrong on my side. Please ask me again in a moment.',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`IROPS Copilot backend listening on :${PORT}`);
    ctx
      .warmCache()
      .then((w) => console.log('cache warmed', JSON.stringify(w)))
      .catch((e) => console.log('warm failed (non-fatal)', e.message));
    ctx.startBackgroundRefresh();
  });
}

module.exports = app;
