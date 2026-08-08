'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(process.cwd(), 'cache');

function ensureDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (_) {
    // Read-only filesystem (some PaaS tiers). Memory cache still works.
  }
}
ensureDir();

// Memory mirror so the demo survives a read-only disk.
const memory = new Map();

function keyFor(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex');
}

function fileFor(url) {
  return path.join(CACHE_DIR, `${keyFor(url)}.json`);
}

/**
 * Persist a value for a URL. Never throws — caching is best-effort.
 */
function set(url, data) {
  const entry = { url, data, cached_at: new Date().toISOString() };
  memory.set(url, entry);
  try {
    fs.writeFileSync(fileFor(url), JSON.stringify(entry), 'utf8');
  } catch (_) {
    // best-effort only
  }
  return entry;
}

/**
 * @returns {{url:string,data:any,cached_at:string}|null}
 */
function get(url) {
  if (memory.has(url)) return memory.get(url);
  try {
    const raw = fs.readFileSync(fileFor(url), 'utf8');
    const entry = JSON.parse(raw);
    memory.set(url, entry);
    return entry;
  } catch (_) {
    return null;
  }
}

function has(url) {
  return get(url) !== null;
}

function count() {
  let onDisk = 0;
  try {
    onDisk = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).length;
  } catch (_) {
    onDisk = 0;
  }
  return Math.max(onDisk, memory.size);
}

function clear() {
  memory.clear();
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(CACHE_DIR, f));
    }
  } catch (_) {
    // nothing to clear
  }
}

module.exports = { get, set, has, count, clear, CACHE_DIR };
