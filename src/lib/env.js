'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader — avoids a dependency for the one thing we need.
 * Real environment variables always win, so Render's dashboard config is safe.
 */
function load(file = path.join(process.cwd(), '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return {}; // no .env is normal in production
  }

  const loaded = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
      loaded[key] = value;
    }
  }
  return loaded;
}

module.exports = { load };
