'use strict';

/**
 * Backend-side guardrails — the layer the agent's own guardrails cannot cover.
 *
 * The ElevenLabs guardrails stop the agent from *asking for* or *echoing*
 * sensitive data. They cannot stop two things that happen below the agent:
 *
 *   1. A caller volunteers a card number, the transcriber hears it, and the
 *      LLM drops it into a tool parameter. It then reaches our request log and
 *      sits in Render's log retention in plaintext. Nobody attacked us; a
 *      frightened passenger just read their card out. `redact()` runs on
 *      everything we log.
 *
 *   2. Indirect prompt injection. Every advisory answer is text scraped off
 *      the public web and handed to an LLM. If that page — or anything injected
 *      into it upstream, a CDN, a compromised CMS, a comment field — contains
 *      "ignore your previous instructions", we would pass it to the agent as
 *      trusted content. `neutralizeInjection()` defangs those phrases before
 *      scraped prose is ever quoted back.
 *
 * Both are deliberately conservative: they degrade a string, never throw, and
 * never drop a response. A guardrail that breaks the answer is worse than the
 * risk it removes.
 */

/**
 * Luhn check, so we redact real card numbers and leave flight numbers,
 * ticket numbers and long reference codes alone.
 */
function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Spoken card numbers arrive space- or dash-separated: "4111 1111 1111 1111".
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const CVV_RE = /\b(?:cvv|cvc|security code)\D{0,12}(\d{3,4})\b/gi;
const SECRET_RE = /\b(?:password|passcode|pin|otp|one[- ]time code)\D{0,12}([A-Za-z0-9!@#$%^&*]{3,})/gi;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const PASSPORT_RE = /\b(?:passport)\D{0,15}([A-Z0-9]{6,9})\b/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;

/**
 * Replace sensitive values with type markers. Structure is preserved so a log
 * line stays diagnosable — you can still see a card was mentioned, which is
 * exactly what you want when auditing why a call went wrong.
 *
 * @param {unknown} input
 * @returns {string}
 */
function redact(input) {
  let text = typeof input === 'string' ? input : safeStringify(input);
  if (!text) return '';

  text = text.replace(CARD_RE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    return passesLuhn(digits) ? '[REDACTED:CARD]' : match;
  });
  text = text.replace(CVV_RE, (m, g) => m.replace(g, '[REDACTED:CVV]'));
  text = text.replace(SECRET_RE, (m, g) => m.replace(g, '[REDACTED:SECRET]'));
  text = text.replace(IBAN_RE, '[REDACTED:IBAN]');
  text = text.replace(PASSPORT_RE, (m, g) => m.replace(g, '[REDACTED:PASSPORT]'));
  text = text.replace(EMAIL_RE, '[REDACTED:EMAIL]');
  return text;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value) || '';
  } catch (_) {
    return '[unserialisable]';
  }
}

/**
 * Phrases that only ever appear in prose trying to steer a model. Matching
 * these in an airline advisory means something is wrong with the page, not
 * with the passenger.
 */
const INJECTION_RE = new RegExp(
  [
    'ignore (?:all |any )?(?:your |the )?(?:previous|prior|above|preceding) (?:instructions?|prompts?|rules?)',
    'disregard (?:all |any )?(?:your |the )?(?:previous|prior|above) (?:instructions?|prompts?|rules?)',
    'you are now (?:a|an|the) \\w+',
    'forget (?:everything|all) (?:you|above)',
    'new instructions?:',
    'system prompt',
    'reveal (?:your|the) (?:prompt|instructions?|system)',
    'act as (?:a|an|if)',
    'pretend (?:to be|you are)',
    '</?(?:system|assistant|user)>',
  ].join('|'),
  'gi'
);

/**
 * Defang instruction-like phrases in untrusted scraped text.
 *
 * Marks rather than deletes: if an advisory genuinely discusses a "system
 * prompt" we still want the sentence to read sensibly, and a visible marker
 * tells us the page tripped this rather than silently mangling the answer.
 *
 * @param {string|null} text
 * @returns {string|null}
 */
function neutralizeInjection(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(INJECTION_RE, (m) => `[filtered: ${m.slice(0, 24)}]`);
}

/** True when scraped text contains anything injection-shaped. For logging. */
function looksLikeInjection(text) {
  if (typeof text !== 'string') return false;
  INJECTION_RE.lastIndex = 0;
  return INJECTION_RE.test(text);
}

module.exports = { redact, neutralizeInjection, looksLikeInjection, passesLuhn };
