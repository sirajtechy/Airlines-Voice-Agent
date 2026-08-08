# TECH-SPEC — IROPS Copilot

## 01 — Problem

**Who:** Emirates passengers mid-journey during irregular operations, and the ground staff
fielding them. Dubai is a transit hub: a regional airspace closure strands people who are
already airborne, already at a gate, or about to leave home for an airport they should not
go to.

**The pain:** the information that decides their next hour lives as prose on
`emirates.com/help/travel-updates`. As of 8 August 2026 that page says the UAE will not
allow entry to travellers who have recently been in the DRC, Uganda or South Sudan — *"unless
the traveller has been outside of these countries for more than 21 days"* — and that the
restriction *"applies to all travellers, even those arriving by indirect routings."*

Those two sentences decide whether a passenger flying Kampala→Dubai→London should get in a
taxi. They are buried in a wall of unrelated updates about lounge refurbishments and Schengen
biometrics, the carve-out that saves the journey is a subordinate clause, and none of it is
readable on a phone in a crowded terminal. The call-centre queue during a disruption is
measured in hours.

**Why voice:** the caller's hands are full and their eyes are on a departure board. They ask
one question — *"am I going to get there?"* — and it is a question about live data, not
about their booking. Voice is the only interface that works standing up, and a voice agent
scales past a queue that a call centre cannot.

## 02 — Architecture

```
Caller ──speech──> ElevenLabs Conversational Agent
                     (STT, tool-calling LLM, TTS, barge-in)
                              │
                    9 webhook tools, HTTPS POST, 20s timeout
                              ▼
                   Express backend (Render, Node 18)
                     src/routes/tools.js
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        context.dev     aviationweather   cache (disk+memory)
      scrape→Markdown    .gov METAR       src/lib/cache.js
                         + adsb.lol       (5-min bg refresh)
                         ADS-B position
              │               │                │
     emirates.com/       OMDB raw obs     last good scrape
     travel-updates                            │
              │                                ▼
              └── src/lib/advisory.js ──> mocks (src/data/mocks.js)
                  (prose → structured)
```

**Data flow for the core question.** Caller says *"I'm flying Kampala to London via Dubai."*
The agent calls `transit_rules` with `{origin: "Uganda", final_destination: "London"}`. The
backend asks context.dev to scrape the Emirates travel-updates page to Markdown (12s
timeout, ~0.7s warm). `advisory.js` splits that Markdown into sentences and checks **both
sides of the journey**: nothing restricts London, but the sentences naming Uganda match an
entry-restriction pattern *and* sit next to transit language. It returns
`{transit_allowed: false, conditional: true, explanation: "...", source: "live"}`. The agent
speaks the explanation including the 21-day carve-out, then chains into `rebooking_options`.

**The parsing layer is the substance.** context.dev gives us clean Markdown; turning airline
advisory prose into a decision is our problem. Four things `advisory.js` gets right that a
naive keyword match does not:

- **Origin-side restrictions.** Transit can be blocked by where you have *been*, not where
  you are going. Checking only the destination — the obvious implementation — returns
  "you're fine" to the Kampala passenger. We check both sides.
- **Sentence windows.** The qualifier that changes the answer (*"until further notice"*,
  *"this has been extended"*) sits in a neighbouring sentence, so we read one sentence either
  side of every match.
- **Effective-from is not until.** *"effective 6 June 2026 (until further notice)"* contains
  a date that is not an end date. We return `open_ended: true` and `suspended_until: null`
  rather than confidently telling a passenger the restriction lifted in June.
- **Alias resolution.** Callers say "DRC", "the Congo", "Kampala"; the page says "Democratic
  Republic of Congo" and "Uganda". We map across city, IATA, ICAO and country-name variants.

We also distinguish a **route suspension** from an **entry restriction** — both block travel,
but the passenger's next action differs, so `restriction_type` carries which one it is.

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
rendering and on any markup change. context.dev's scrape-to-Markdown endpoint
(`GET /v1/web/scrape/markdown`) gives clean, prose-shaped text from a single authenticated
call, which is exactly the input a sentence-level parser wants: it strips the nav, the
cookie banner and the footer, and leaves us sentences. `useMainContentOnly` and the
`maxAgeMs` edge cache together took a cold 5–8s scrape down to ~0.7s warm, which is the
difference between a conversation and an awkward pause.

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
  which we already handle. It is also the reason we can pin the parser with unit tests
  against verbatim advisory text — an LLM extractor would make those tests flaky.
- **Static data for policy, schedules and turnaround.** These are genuinely slow-changing.
  Spending live-data effort on them would have bought nothing.

What we spent the time on instead: the degradation chain, the advisory parser, and the agent
prompt. The 42-test suite runs with the API key blank and the cache cleared — the offline
path is the one we tested hardest, because a demo that dies on venue wifi scores zero
regardless of what it does when the network is up.

**Honest limits.** Five of the nine tools are live-first: `disruption_status`,
`transit_rules`, `entry_requirements` and `stranded_support` read the Emirates advisory
through context.dev, and `weather_ops` reads aviationweather.gov METAR. The rest serve
static data with a live cross-check layered on top — `rebooking_options` checks the live
advisory before offering seats, `turnaround_brief` attaches a live METAR, and
`policy_lookup` is entirely static because entitlements genuinely do not change hourly. The
`source` field on every response says which you got, verifiably.

Two caveats we will not paper over.

`flight_status` mixes two feeds and reports them separately rather than averaging them into
one comfortable claim. The aircraft position is genuinely live — a transponder fix from
adsb.lol, keyless and ODbL-licensed, typically back in under a second. The schedule around
it is not: no keyless source publishes gate numbers, delay minutes or cancellations, so
`schedule_source` stays `"mock"` while `position_source` says `"live"`. We considered
collapsing these into a single `source: "live"` and rejected it, because the live half would
lend credibility to the static half — the precise overclaim the brief warns about. The
distinction is load-bearing in the agent prompt too: `airborne: false` means "not tracked in
the air", which is not departed *or* out of receiver coverage, and the agent is explicitly
forbidden from reading it as a cancellation.

`stranded_support` is live-capable but currently returns `source: "baseline"`, because
today's advisory page happens to contain no hotel or voucher language to extract. The live
path is exercised and correct; there is simply nothing there to find right now. That is the
honest state of it, and the fallback text is good guidance regardless.

## 05 — Extensibility — v2

1. **More advisory sources, same parser.** The sentence-window matcher is source-agnostic.
   Point it at GCAA notices, destination-country entry rules, and other carriers' update
   pages and the same nine tools get materially better with no interface change.
   `entry_requirements` is the proof: it reads the EU EES and UK ETA sections of a page we
   were already scraping, and cost an alias table plus a section splitter.
2. **Real flight status.** Swap the static `flightDB` for a Cirium or FlightAware feed
   behind the identical response contract — `src/data/mocks.js` becomes the fallback rather
   than the primary, `schedule_source` starts reporting `"live"`, and no ElevenLabs tool
   needs re-publishing. The ADS-B position layer already added in `src/lib/adsb.js` stays as
   it is; the two feeds are deliberately independent.
3. **Mid-conversation invalidation.** We now refresh the advisory cache on a five-minute
   background timer, so served data is minutes old at worst — but that is a freshness
   guarantee, not a push. Nothing reaches a conversation that is already in flight; the
   agent only learns of a change on its next tool call. Closing that gap means holding
   conversation state and pushing an event into it, letting the agent say *"that just
   changed while we were talking"*. That is the behaviour the use-case actually wants and
   the thing we could not fit in six hours.
4. **Outbound calls.** Invert it: when the advisory page changes for a route, the agent calls
   the affected passengers instead of waiting for them to call. Same tools, opposite
   direction.
5. **Proper multi-tenancy.** Airline-specific config — advisory URL, policy set, voice — so
   the same backend serves any carrier. Nothing in the parser is Emirates-specific except
   the URL and the alias table.
6. **Hardening.** `TOOL_SHARED_SECRET` exists but is off by default for demo convenience;
   v2 makes it mandatory, adds per-tool rate limiting, and moves the cache to Redis so
   multiple instances share warmth.
