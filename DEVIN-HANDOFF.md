# Devin handoff — RAAHI backend

Session handoff, 8 August 2026. Submission deadline **2:30 PM GST today**.
This document is the contract: what exists, what is proven, what is assumed, and what to
build next in priority order.

---

## Ground rules

1. **Do not change the paths or response contracts of `/tools/*`.** ElevenLabs webhook tools
   point at them. If a field must change, add it — do not rename or remove.
2. **No endpoint may ever return a non-200 to ElevenLabs.** A failed tool call makes the
   voice agent go silent mid-sentence. On total failure return
   `200 {"status":"degraded","message":"<spoken-friendly sentence>"}`. The `safe()` wrapper
   in [`src/routes/tools.js`](src/routes/tools.js) already enforces this — keep new handlers
   inside it.
3. **Every response carries a `source` field** (`live` / `cache` / `none` / `mock` /
   `baseline`). The agent's phrasing depends on it and the TECH-SPEC makes claims about it.
   Never report `live` for data that did not come off the network this request.
4. **The 15-second budget is hard.** ElevenLabs times out at 20s. Outbound fetches use a
   12s `AbortController` timeout with a cache fallback.
5. **Never commit the context.dev API key.** It lives in `.env` (gitignored). Render gets it
   through the dashboard (`sync: false` in `render.yaml`). `.claude/settings.local.json` is
   now gitignored because permission grants can capture command text containing secrets.
6. **All commits must fall inside the build window (08:30–14:30 GST today).** Do not rewrite
   author dates.

---

## What exists and is verified

Ran and confirmed working this session:

| Thing | Status |
| --- | --- |
| 8 `/tools/*` endpoints | All return 200. Slowest warm response 1.3s. |
| context.dev integration | **Live, confirmed.** `GET https://api.context.dev/v1/web/scrape/markdown`, `Authorization: Bearer`, returns `{success, markdown, contentLength, url, metadata, key_metadata}`. Real scrape returned 8,949 chars. |
| Advisory parser | Correctly extracts the live UAE/Ebola entry restriction for Uganda, DRC, South Sudan from real page text. |
| Origin-side transit logic | `{origin:"Uganda", final_destination:"London"}` → `transit_allowed:false, conditional:true, source:"live"`. |
| METAR | Live, keyless, real observation for OMDB. |
| Test suite | 25 tests, all passing, run with the API key blank and cache cleared. |
| Degraded path | Every endpoint answers 200 with a spoken message when the network is unavailable. |

Latency measured: cold context.dev scrape **5–8s**, warm **~0.7s**. The boot-time cache warm
is what keeps the demo conversational.

## What is NOT verified — assume broken until you check

- **`/tools/flight_status` live scrape.** It hits
  `emirates.com/.../flight-status/?flightNumber=X`, which is very likely JS-gated or
  auth-gated. It has never returned useful live text. The endpoint still works because it
  falls through to the mock `flightDB`. **Do not claim this is live.** Either find a real
  source or leave it honest.
- **`/tools/stranded_support` live extraction.** The code path is exercised and correct, but
  today's advisory page contains no hotel/voucher language, so it returns
  `source: "baseline"`. Do not present it as live.
- **Deployment.** Nothing has been deployed. `render.yaml` is written but unexercised.
- **ElevenLabs wiring.** The 8 tool definitions in `elevenlabs/tools/` are hand-authored to
  match the webhook shape. They have not been imported into a live agent.

---

## Repo layout

```
src/server.js             Express app, /healthz, /admin/warm, error floor
src/routes/tools.js       All 8 /tools/* handlers, safe() wrapper, code normalisation
src/lib/contextClient.js  context.dev wrapper — live → cache → none, 12s timeout
src/lib/advisory.js       Prose → structured decisions. The substance of the project.
src/lib/cache.js          Disk (./cache) + memory mirror
src/lib/env.js            Dependency-free .env loader; real env vars always win
src/data/mocks.js         Static fallback + airport/city/country alias tables
test/                     25 tests; advisory.test.js pins the parser to verbatim page text
elevenlabs/               Agent system prompt, voice settings, 8 tool definitions
docs/demo-script.md       Demo run + the six video questions + what not to overclaim
README.md, TECH-SPEC.md   Required at repo root by the submission brief
```

**`src/lib/advisory.js` is where the judgement lives.** Four behaviours a naive rewrite
would lose, each pinned by a test — read them before touching it:

- **Two-sided matching.** Restrictions key off where a passenger has *been*, not only where
  they are going. Destination-only matching tells the Kampala→Dubai→London passenger she is
  fine. She is not.
- **Sentence windows.** The qualifier that changes the answer sits in a *neighbouring*
  sentence, so every match reads one sentence either side.
- **Effective-from ≠ until.** `"effective 6 June 2026 (until further notice)"` contains a
  date that is not an end date. Returns `open_ended: true`, `suspended_until: null`.
- **Alias resolution.** Callers say "DRC", "the Congo", "Kampala"; the page says "Democratic
  Republic of Congo", "Uganda". Mapped across city / IATA / ICAO / country variants.

---

## Priority queue

### P0 — required to submit (do these first, in order)

1. **Push to GitHub, public.** Repo must be openable without an access request. Confirm
   `README.md` and `TECH-SPEC.md` are at the **root**.
2. **Deploy to Render.** New Web Service → select repo → it reads `render.yaml` → set
   `CONTEXT_DEV_API_KEY` in the dashboard → deploy. Expected URL
   `https://irops-copilot-backend.onrender.com`.
3. **Smoke-test the deployed URL**, all 8 tools, and confirm `/healthz` reports
   `context_dev_key: true` and `cache_entries > 0`.
4. **Repoint the 8 ElevenLabs tools** at the Render URL and **re-Publish the agent** —
   unpublished edits do not reach the live agent. Paste the system prompt from
   [`elevenlabs/agent-prompt.md`](elevenlabs/agent-prompt.md).
5. **Re-verify the demo premise is still live** before recording — the advisory page can
   change under you. See "If the page changed" in [`docs/demo-script.md`](docs/demo-script.md).

### P1 — materially improves the submission

6. **Make `flight_status` genuinely live or drop the claim.** Try a keyless source
   (adsb.lol, OpenSky) via `contextClient.fetchText`. If nothing works inside the timeout,
   leave the mock and make sure README/TECH-SPEC say so plainly. Overclaiming is explicitly
   penalised by the brief.
7. **Broaden advisory coverage.** The page also carries an EU Entry/Exit System notice, UK
   entry requirements, and a summer peak-travel advisory. A `POST /tools/entry_requirements
   { destination }` reading those would add a real live tool cheaply — the parser is
   source-agnostic, so this is mostly alias-table and regex work.
8. **Retry-once on scrape failure** before falling back to cache. One retry fits inside the
   budget (12s timeout, 15s budget is too tight — reduce the per-attempt timeout to 6s if
   you add this).
9. **Background cache refresh.** A `setInterval` re-warm every ~5 minutes so the served
   cache is never more than minutes old, and `cached_at` stays defensible.

### P2 — v2, only if time remains

10. Mid-conversation invalidation: poll the advisory page and push a change into an active
    conversation. This is the feature the use-case actually wants and the TECH-SPEC is
    careful to list as *not built*. Do not claim it until it exists.
11. Real flight data (Cirium / FlightAware) behind the identical response contract.
12. Multi-tenancy: advisory URL, policy set and voice per airline.
13. Hardening: make `TOOL_SHARED_SECRET` mandatory, add per-tool rate limiting, move the
    cache to Redis so multiple instances share warmth.

---

## Running it

```bash
npm install
cp .env.example .env   # then set CONTEXT_DEV_API_KEY
npm start              # http://localhost:3000, warms cache on boot
npm test               # 25 tests, deliberately runs with no API key
```

Live check — expect `"source":"live"`:

```bash
curl -s -X POST http://localhost:3000/tools/transit_rules -H 'content-type: application/json' -d '{"origin":"Uganda","final_destination":"London"}'
```

If you change parser behaviour, update the `LIVE_EXCERPT` fixture in
[`test/advisory.test.js`](test/advisory.test.js) — it is verbatim page text and exists so a
regression in prose handling fails the build rather than the demo.

---

## Two honesty constraints, restated

The submission brief says: *"We check your spec against your code. Claiming streaming,
real-time data, or an agent loop that isn't there costs more than not claiming it."*

- **Four tools are live-backed**, not eight: `disruption_status`, `transit_rules`,
  `stranded_support` (live-capable, currently `baseline`) and `weather_ops`. The rest are
  static with a live cross-check.
- **We re-fetch per tool call.** We do not push data changes into an in-flight conversation
  turn. Both README and TECH-SPEC state this precisely — keep it that way if you change the
  caching behaviour.
