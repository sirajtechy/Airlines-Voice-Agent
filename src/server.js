'use strict';

require('./lib/env').load();

const express = require('express');
const toolsRouter = require('./routes/tools');
const ctx = require('./lib/contextClient');
const cache = require('./lib/cache');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOTED_AT = Date.now();

app.use(express.json({ limit: '256kb' }));

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
  res.status(200).json({
    ok: true,
    cache_entries: cache.count(),
    uptime_s: Math.round((Date.now() - BOOTED_AT) / 1000),
    context_dev_key: Boolean((process.env.CONTEXT_DEV_API_KEY || '').trim()),
  });
});

app.post('/admin/warm', async (req, res) => {
  const warmed = await ctx.warmCache();
  res.status(200).json({ warmed });
});

app.use('/tools', toolsRouter);

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
  });
}

module.exports = app;
