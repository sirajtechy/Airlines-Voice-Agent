# Demo script — 2 to 3 minutes

## Before you hit record

```bash
curl -s https://irops-copilot-backend.onrender.com/healthz
curl -s -X POST https://irops-copilot-backend.onrender.com/admin/warm
```

Render's free tier sleeps. Do this a minute before recording so the first tool call is not
a 30-second cold start. Confirm `cache_entries` is greater than zero and
`context_dev_key` is `true`.

Have the Emirates travel-updates page open in a second tab — you will point at it to show
the agent is reading the real thing.

---

## The run

**Q1 — the live-data moment (this is the one that scores).**

> "I'm flying from Mumbai to Beirut through Dubai tomorrow. Am I going to get there?"

Agent calls `transit_rules`, which scrapes emirates.com through context.dev live. It should
say transit through Dubai to Beirut is not being accepted, and why.

*Say over it:* "That just read the Emirates travel-updates page — live, this second, through
context.dev. It isn't in a database anywhere."

Then show the same sentence on the real page in your second tab.

**Q2 — the interrupt (proves barge-in).**

Let the agent start a long answer, then cut in three words down:

> "— sorry, what about E K seventeen?"

It should stop cleanly and switch to `flight_status`. Do not wait for a gap; the point is
that you talked over it.

**Q3 — the chain (proves it's an agent, not a lookup).**

> "So what do I do? I'm stuck at the airport."

Agent should chain `rebooking_options` (which cross-checks the live suspension before
offering seats) and `stranded_support` — hotel and meal vouchers, which desk in Terminal 3.
It reaches those without you naming a tool.

**Optional — the failure story, if you have 20 seconds left.**

> "What's the weather doing at Dubai?"

Live METAR, decoded to operational impact. Mention that if any source fails, the endpoint
returns a spoken degraded message rather than an error — and that `npm test` runs the whole
suite with the network blocked.

---

## The six questions to answer on camera

1. **Problem and who for** (~30s) — passengers mid-journey during a disruption; the answer
   they need is prose on a page that changes hourly and is unreadable in a terminal.
2. **Live demo** (~2min) — the run above. Name the data: the Emirates travel-updates page,
   fetched through context.dev at the moment of the question.
3. **Why live data is essential** (~30s) — *"Our project would fundamentally break without
   live web data because a route suspension that ended yesterday and one that was extended
   this morning produce opposite advice, and there is no API for that — only a page."*
   Say honestly what happens mid-conversation: each tool call re-fetches, so a change
   between two questions is picked up on the next call; we do not yet push a change into an
   in-flight turn (that's v2).
4. **What the agent does autonomously** (~45s) — chains tools without being asked
   (suspension → rebooking → support), refuses to answer route questions from memory, and
   hedges its own phrasing based on the `source` field. ElevenLabs features: barge-in,
   webhook tool-calling, voice designed calm and slow because callers are stressed.
5. **What's novel** (~30s) — a voice agent whose knowledge source is an airline's own
   unstructured advisory prose, parsed live. Not a booking bot, not an FAQ — the specific
   pairing of ElevenLabs barge-in with context.dev scraping over a page that changes hourly.
6. **Hardest problem** (~30s) — turning advisory prose into a boolean. The qualifier that
   changes the answer (*"this has been extended"*) sits in the sentence after the one naming
   the route, so single-sentence matching gets it wrong. Fixed with a sentence-window matcher
   plus alias resolution across city name, IATA and ICAO. All of it tested offline.

---

## Do not claim

- Do not say all eight tools are live. Four are live-backed
  (`disruption_status`, `transit_rules`, `stranded_support`, `weather_ops`), the rest are
  static with a live cross-check. The `source` field in every response says which. The brief
  is explicit that overclaiming costs more than not claiming.
- Do not say "streaming" unless you mean ElevenLabs' own audio streaming.
- Do not say "real-time" about the cache. Say "live at the moment of the question".
