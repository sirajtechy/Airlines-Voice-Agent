# IROPS Copilot

A voice-first flight-disruption copilot. You call it, say *"I'm connecting through Dubai to
Beirut tomorrow — am I going to get there?"*, and it reads the Emirates travel-updates page
**at that moment** and tells you the truth: the route is suspended, transit passengers are
not being accepted, here is what to do instead.

Built for the BUiD Voice Agents Hackathon, Dubai — 8 August 2026.

- **Voice layer:** ElevenLabs Conversational Agents (8 webhook tools)
- **Live web data:** [context.dev](https://context.dev) scrape-to-Markdown API
- **Backend:** Node 18+ / Express, deployed on Render

---

## What it does

During irregular operations — a suspended route, a regional airspace closure, a cancelled
flight — the information a passenger needs changes hourly and lives in prose on an airline's
travel-updates page. Nobody reads it standing at a departure board. IROPS Copilot puts that
page behind a voice agent.

The agent handles eight things: whether a route is suspended and until when, whether transit
through Dubai to a given destination is being accepted, a specific flight's status and delay
reason, current airport weather and its operational impact, rebooking options, passenger
entitlements, stranded-passenger support, and a staff-facing turnaround brief.

Every one of those is a live tool call. The agent is instructed never to answer route or
weather questions from memory.

---

## Architecture

```
   Caller (phone / web widget)
            │  speech
            ▼
  ┌──────────────────────────┐
  │  ElevenLabs Conversational│   STT → LLM (tool-calling) → TTS
  │  Agent                    │   interruption handling, voice design
  └───────────┬──────────────┘
              │  HTTPS POST, 8 webhook tools, 20s timeout
              ▼
  ┌──────────────────────────┐
  │  IROPS backend (Express)  │   src/server.js
  │  /tools/* — 8 endpoints   │   src/routes/tools.js
  └───────────┬──────────────┘
              │
      ┌───────┴────────┬──────────────────┐
      ▼                ▼                  ▼
 context.dev      aviationweather    disk + memory cache
 scrape→Markdown   .gov METAR         src/lib/cache.js
      │                │                  │
      ▼                ▼                  ▼
 emirates.com     OMDB observation   last good response
 /travel-updates                            │
      │                                     ▼
      └──── parsed by src/lib/advisory.js ──┴──> mock fallback
                                                 src/data/mocks.js
```

**The degradation chain is the point.** Every endpoint tries live, falls back to the last
cached scrape, then falls back to static data — and never returns a non-200 to ElevenLabs.
A tool that errors out is a voice agent that goes silent mid-sentence, which is worse than
a slightly stale answer. See [Reliability](#reliability-design) below.

---

## Setup

Assumes a clean machine with **Node 18 or newer** (`node -v` to check).

```bash
git clone https://github.com/sirajtechy/irops-copilot-backend.git
cd irops-copilot-backend
npm install
cp .env.example .env
```

Open `.env` and set your context.dev API key (free tier is enough — sign up at
<https://context.dev>):

```
CONTEXT_DEV_API_KEY=your_key_here
```

Run it:

```bash
npm start
```

The server listens on `http://localhost:3000` and warms its cache on boot. Check it:

```bash
curl http://localhost:3000/healthz
```

Run the test suite (it deliberately runs with **no** API key, to prove the offline path):

```bash
npm test
```

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CONTEXT_DEV_API_KEY` | For live data | — | context.dev bearer token. Without it every endpoint still answers, from cache or mock. |
| `PORT` | No | `3000` | Render injects this. |
| `TOOL_SHARED_SECRET` | No | *(off)* | If set, `/tools/*` and `/admin/*` require an `x-tool-secret` header. |
| `FETCH_TIMEOUT_MS` | No | `8000` | Outbound fetch timeout. Keep well under the ElevenLabs 20s tool timeout. |

---

## The eight tools

All are `POST`, all take and return JSON, all respond `200`.

| Tool | Input | Returns | Data source |
| --- | --- | --- | --- |
| `/tools/disruption_status` | `{ destination }` | `suspended`, `suspended_until`, `extended_before`, `advisory_text`, `source` | context.dev → emirates.com travel-updates |
| `/tools/transit_rules` | `{ origin, final_destination }` | `transit_allowed`, `explanation`, `source` | context.dev → emirates.com travel-updates |
| `/tools/stranded_support` | `{ location }` | `location`, `support_text`, `source` | context.dev, with static baseline |
| `/tools/flight_status` | `{ flight_no }` | full flight record, `live_note`, `source` | context.dev → Emirates flight status, mock fallback |
| `/tools/weather_ops` | `{ airport }` | `metar`, `wind`, `ops_impact`, `source` | aviationweather.gov METAR (keyless) |
| `/tools/rebooking_options` | `{ flight_no? , destination? }` | `options[]`, `route_suspended`, `advice`, `source` | Static schedule + live suspension cross-check |
| `/tools/policy_lookup` | `{ topic }` | `summary`, `source_hint` | Static policy baseline |
| `/tools/turnaround_brief` | `{ flight_no }` | stand, ground time, critical path, `risks[]`, station weather | Static brief + live METAR |

Plus: `GET /` (liveness string), `GET /healthz` (`ok`, `cache_entries`, `uptime_s`),
`POST /admin/warm` (re-prime the cache before a demo).

Try one:

```bash
curl -s -X POST http://localhost:3000/tools/disruption_status -H 'content-type: application/json' -d '{"destination":"Beirut"}'
```

---

## How the voice agent calls it

The ElevenLabs agent is configured with eight **webhook tools**, one per endpoint. Each
posts JSON to `https://<your-render-url>/tools/<name>` with a 20-second timeout, and the
agent reads the returned fields aloud.

The system prompt, voice settings, and all eight tool definitions are in
[`elevenlabs/`](elevenlabs/) — [`agent-prompt.md`](elevenlabs/agent-prompt.md) is
copy-pasteable into the dashboard, and [`elevenlabs/tools/*.json`](elevenlabs/tools/) mirror
the webhook tool shape field-for-field.

Two things in the prompt do real work:

1. **The agent is forbidden from answering route or weather questions from memory.** Those
   change hourly; a plausible-sounding stale answer is the failure mode that matters here.
2. **Every tool returns a `source` field** (`live` / `cache` / `none` / `mock` / `baseline`)
   and the agent is instructed to hedge its phrasing accordingly — *"as of the last update
   I have"* — without ever saying the word "cache" out loud.

---

## Reliability design

An ElevenLabs tool call that fails leaves the agent silent mid-conversation. So:

- **8-second outbound timeout** via `AbortController`, against a 20-second ElevenLabs
  budget — a slow scrape can never hang the call.
- **Never a bare 500.** Every handler is wrapped so any throw becomes
  `200 {"status":"degraded","message":"<spoken-friendly sentence>"}`, which the agent reads
  aloud gracefully.
- **Two-layer cache** (`src/lib/cache.js`): disk under `./cache`, mirrored in memory so a
  read-only filesystem doesn't break it. Warmed on boot and via `POST /admin/warm`.
- **Static fallback** (`src/data/mocks.js`) so the demo survives total internet loss.

`npm test` runs the whole suite with `CONTEXT_DEV_API_KEY` blank and the cache cleared —
19 tests asserting every endpoint still returns 200, still carries a spoken message, and
still comes in under the timeout budget.

---

## Deploy

The repo carries a [`render.yaml`](render.yaml), so Render configures itself:

1. Sign in to <https://render.com> with GitHub.
2. **New → Web Service** → select this repo. Render reads `render.yaml` (Node, free plan,
   `npm install` / `npm start`, health check on `/healthz`).
3. In the dashboard, set `CONTEXT_DEV_API_KEY` (marked `sync: false`, so it is not in git).
4. Deploy. Your URL will be `https://irops-copilot-backend.onrender.com`.

Then, in ElevenLabs, point all eight tools at the Render URL and **re-Publish the agent**.

> Render's free tier sleeps after inactivity and takes ~30s to wake. Hit `/healthz` and
> `POST /admin/warm` a minute before demoing.

---

## Project layout

```
src/server.js            Express app, health, admin, error floor
src/routes/tools.js      All 8 /tools/* handlers
src/lib/contextClient.js context.dev wrapper — live → cache → none
src/lib/cache.js         Disk + memory cache
src/lib/advisory.js      Parses advisory prose into structured answers
src/data/mocks.js        Static fallback: flights, policies, schedules
test/                    19 tests, run with no network
elevenlabs/              Agent prompt, voice settings, 8 tool definitions
docs/demo-script.md      The three-question demo run
TECH-SPEC.md             Engineering reasoning
```

---

## Team

Team — BUiD Voice Agents Hackathon, Dubai, 8 August 2026.
