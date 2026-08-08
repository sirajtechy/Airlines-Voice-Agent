'use strict';

/**
 * Advisory changes pushed to us by context.dev Monitors.
 *
 * This is the piece that makes the agent's freshness claim real rather than
 * rhetorical. Polling tells you what a page says *now*; a monitor tells you
 * that it *changed*, and when, and what moved. Those are different facts, and
 * only the second one lets an agent say "that changed eleven minutes ago,
 * while you were on your way to the airport."
 *
 * Deliberately in-memory with a hard cap. These are ephemeral operational
 * events, not records — losing them on restart costs nothing, and a disk
 * writer here would be another failure mode on the request path.
 */

const crypto = require('crypto');

const MAX_CHANGES = 25;
const changes = [];

/**
 * @param {{monitor_id?:string, monitor_name?:string, url?:string, summary?:string,
 *          added?:string[], removed?:string[], importance?:string, confidence?:number,
 *          detected_at?:string}} change
 */
function record(change) {
  const entry = {
    id: change.id || crypto.randomUUID(),
    monitor_id: change.monitor_id || null,
    monitor_name: change.monitor_name || null,
    url: change.url || null,
    summary: change.summary || null,
    added: Array.isArray(change.added) ? change.added.slice(0, 5) : [],
    removed: Array.isArray(change.removed) ? change.removed.slice(0, 5) : [],
    importance: change.importance || null,
    confidence: typeof change.confidence === 'number' ? change.confidence : null,
    detected_at: change.detected_at || new Date().toISOString(),
    received_at: new Date().toISOString(),
  };
  changes.unshift(entry);
  if (changes.length > MAX_CHANGES) changes.length = MAX_CHANGES;
  return entry;
}

/** Most recent first, optionally limited to the last `withinMinutes`. */
function recent({ limit = 5, withinMinutes = null } = {}) {
  const cutoff = withinMinutes ? Date.now() - withinMinutes * 60000 : null;
  return changes
    .filter((c) => !cutoff || new Date(c.detected_at).getTime() >= cutoff)
    .slice(0, limit);
}

function count() {
  return changes.length;
}

function clear() {
  changes.length = 0;
}

/**
 * Verify a context.dev monitor webhook signature.
 *
 * Header format is `t=<unix>,v1=<hex hmac>` over `<t>.<raw body>`. We compare
 * with timingSafeEqual and reject stale timestamps, because an unauthenticated
 * endpoint that can inject "your route just closed" into a live conversation is
 * a lie-injection vector, not merely a spam risk.
 *
 * Returns true when no secret is configured, so the feature degrades to
 * open-but-documented rather than silently dropping every delivery.
 */
function verifySignature(rawBody, signatureHeader, secret, toleranceSecs = 300) {
  if (!secret) return true;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    String(signatureHeader)
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter((p) => p.length === 2)
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSecs) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(v1), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Flatten a context.dev `change.detected` payload into our shape. The payload
 * nests differently for page/sitemap/extract monitors, so we probe a few
 * shapes rather than assuming one.
 */
function fromWebhook(payload) {
  const change = payload?.change || payload?.data?.change || payload?.data || payload || {};
  const monitor = payload?.monitor || payload?.data?.monitor || {};
  const diff = change.diff || change.text_diff || {};

  const summary =
    change.summary ||
    change.semantic_evidence ||
    change.description ||
    (typeof diff.summary === 'string' ? diff.summary : null);

  return {
    id: change.id,
    monitor_id: monitor.id || change.monitor_id,
    monitor_name: monitor.name || change.monitor_name,
    url: monitor.target?.url || change.url,
    summary,
    added: diff.added || change.added_urls || change.added || [],
    removed: diff.removed || change.removed_urls || change.removed || [],
    importance: change.importance,
    confidence: change.confidence,
    detected_at: change.detected_at || change.created_at,
  };
}

module.exports = { record, recent, count, clear, verifySignature, fromWebhook, MAX_CHANGES };
