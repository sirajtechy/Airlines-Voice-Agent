# TECH-SPEC — IROPS Copilot

## 01 — Problem

**Who:** Emirates passengers mid-journey during irregular operations, and the ground staff
fielding them. Dubai is a transit hub: a regional airspace closure strands people who are
already airborne, already at a gate, or about to leave home for an airport they should not
go to.

**The pain:** the information that decides their next hour lives as prose on
`emirates.com/help/travel-updates` — a page that says things like *"customers transiting
through Dubai with final destination Beirut will not be accepted for travel at their point
of origin."* That sentence is the difference between going to the airport and not. It is
buried in a wall of similar sentences, it changes through the day, and it is unreadable on a
phone in a crowded terminal. The call-centre queue during a disruption is measured in hours.

**Why voice:** the caller's hands are full and their eyes are on a departure board. They ask
one question — *"am I going to get there?"* — and it is a question about live data, not
about their booking. Voice is the only interface that works standing up, and a voice agent
scales past a queue that a call centre cannot.

## 02 — Architecture

```
Caller ──speech──> ElevenLabs Conversational Agent
                     (STT, tool-calling LLM, TTS, barge-in)
                              │
                    8 webhook tools, HTTPS POST, 20s timeout
                              ▼
                   Express backend (Render, Node 18)
                     src/routes/tools.js
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        context.dev     aviationweather   cache (disk+memory)
      scrape→Markdown    .gov METAR       src/lib/cache.js
              │               │                │
     emirates.com/       OMDB raw obs     last good scrape
     travel-updates                            │
              │                                ▼
              └── src/lib/advisory.js ──> mocks (src/data/mocks.js)
                  (prose → structured)
```

**Data flow for the core question.** Caller says *"I'm flying Mumbai to Beirut via Dubai."*
The agent calls `transit_rules` with `{origin: "Mumbai", final_destination: "Beirut"}`. The
backend asks context.dev to scrape the Emirates travel-updates page to Markdown (8s
timeout). `advisory.js` splits that Markdown into sentences, keeps the ones naming Beirut or
BEY, and tests them against a transit-block pattern. It returns
`{transit_allowed: false, explanation: "...", source: "live"}`. The agent speaks the
explanation and, because transit is blocked, chains straight into `rebooking_options`.

**The parsing layer is the substance.** context.dev gives us clean Markdown; turning airline
advisory prose into a boolean is our problem. `advisory.js` does alias resolution (Beirut ↔
BEY ↔ OLBA), sentence-window matching — a qualifier like *"this has been extended"* sits in
the sentence *after* the one naming the route, so a single-sentence match misses it —
suspension-vs-resumption disambiguation, and date extraction from both ISO and
*"10 August 2026"* forms.

**Failure is a first-class path.** Every source call returns `{data, source}` where source
is `live | cache | none`, and that value is propagated all the way into the agent's phrasing.
Every handler is wrapped so a throw becomes `200 {"status":"degraded","message": "..."}` —
never a 500, because a failed tool call is a voice agent going silent mid-sentence.

## 03 — Tool rationale

**ElevenLabs Conversational Agents.** We needed barge-in more than we needed voice quality.
A stressed caller interrupts — they cut in with their flight number three words into the
greeting — and an agent that talks over them is unusable. ElevenLabs gives us interruption
handling, STT, tool-calling and TTS as one configured object, so our six hours went into the
data layer instead of a speech pipeline. The webhook tool abstraction also meant our backend
is a plain REST API we could test with `curl`, independent of the voice layer.

**context.dev.** Emirates publishes no disruption API. The data we need is a rendered web
page, and the naive alternative — `fetch` plus an HTML parser — breaks on client-side
rendering and on any markup change. context.dev's scrape-to-Markdown endpoint gives clean,
prose-shaped text from a single authenticated GET, which is exactly the input a sentence-level
parser wants. Its `maxAgeMs` edge cache also cut our p50 latency enough to stay inside the
tool timeout comfortably.

**Devin.** Used to parallelise the mechanical half of the build — the restructure from a
single `index.js` into `src/routes`, `src/lib`, `src/data`, plus the deployment scaffolding
— while we hand-wrote the advisory parser and the agent prompt, which is where the judgement
calls were.

**Node/Express on Render.** Free tier, `render.yaml` config-as-code, permanent HTTPS URL for
judges. Node 18+ gives us global `AbortController` and `fetch` in tests with no extra
dependency; the whole runtime is Express plus `node-fetch`.

## 04 — Feasibility — scoping to six hours

Cuts, made deliberately:

- **No database.** Cache is JSON on disk, mirrored in memory. No schema, no migration, no
  provisioning.
- **No auth flow, no PNR lookup.** The agent explicitly disclaims booking-specific
  knowledge. Integrating a real booking system is a multi-week compliance conversation, not
  a hackathon task — and the interesting problem (live disruption data) does not need it.
- **One live scrape target.** The Emirates travel-updates page feeds three of the eight
  tools. Adding sources is linear work; proving the pipeline is not.
- **Heuristic parsing, not an LLM extraction pass.** A second LLM call per tool would have
  cost 2–4 seconds against a 20-second budget and introduced its own failure mode. Regex over
  sentences is testable offline, runs in microseconds, and its failure mode is "no match",
  which we already handle.
- **Static data for policy, schedules and turnaround.** These are genuinely slow-changing.
  Spending live-data effort on them would have bought nothing.

What we spent the time on instead: the degradation chain, the advisory parser, and the agent
prompt. The 19-test suite runs with the API key blank and the cache cleared — the offline
path is the one we tested hardest, because a demo that dies on venue wifi scores zero
regardless of what it does when the network is up.

**Honest limits.** `flight_status`, `rebooking_options`, `policy_lookup` and
`turnaround_brief` serve static data with a live cross-check layered on top —
`flight_status` attempts a live scrape and adds a `live_note`, `rebooking_options` checks
the live advisory for a route suspension, `turnaround_brief` attaches a live METAR. Only
`disruption_status`, `transit_rules` and `stranded_support` are live-first end to end, and
`weather_ops` reads live METAR. The `source` field on every response says which you got. We
would rather state that than claim eight live integrations.

## 05 — Extensibility — v2

1. **More advisory sources, same parser.** The sentence-window matcher is source-agnostic.
   Point it at GCAA notices, destination-country entry rules, and other carriers' update
   pages and the same eight tools get materially better with no interface change.
2. **Real flight status.** Swap the static `flightDB` for a Cirium or FlightAware feed
   behind the identical response contract — `src/data/mocks.js` becomes the fallback rather
   than the primary, and no ElevenLabs tool needs re-publishing.
3. **Mid-conversation invalidation.** Today a scrape is cached for the turn. A background
   poller on the advisory page could push a change into an active conversation, letting the
   agent say *"that just changed while we were talking"* — which is the behaviour the
   use-case actually wants and the thing we could not fit in six hours.
4. **Outbound calls.** Invert it: when the advisory page changes for a route, the agent calls
   the affected passengers instead of waiting for them to call. Same tools, opposite
   direction.
5. **Proper multi-tenancy.** Airline-specific config — advisory URL, policy set, voice — so
   the same backend serves any carrier. Nothing in the parser is Emirates-specific except
   the URL and the alias table.
6. **Hardening.** `TOOL_SHARED_SECRET` exists but is off by default for demo convenience;
   v2 makes it mandatory, adds per-tool rate limiting, and moves the cache to Redis so
   multiple instances share warmth.
