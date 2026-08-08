# Demo script — 2 to 3 minutes

## Before you hit record

```bash
curl -s https://irops-copilot-backend.onrender.com/healthz
```

Confirm `context_dev_key` is `true`, then warm it:

```bash
curl -s -X POST https://irops-copilot-backend.onrender.com/admin/warm
```

Render's free tier sleeps. Do both a minute before recording so the first tool call is not a
30-second cold start. A warm scrape answers in ~0.7s; a cold one takes 5–8s.

**Verify the demo case is still live** — the advisory page changes, and this run depends on
what is on it *today*:

```bash
curl -s -X POST https://irops-copilot-backend.onrender.com/tools/transit_rules -H 'content-type: application/json' -d '{"origin":"Uganda","final_destination":"London"}'
```

You want `"transit_allowed": false` and `"source": "live"`. If the Ebola advisory has been
lifted, see **If the page changed** at the bottom — do not record a demo whose premise is
gone.

Have <https://www.emirates.com/ae/english/help/travel-updates/> open in a second tab. You
will point at it.

---

## The run

### Q1 — the live-data moment (this is the one that scores)

> "I'm flying from Kampala to London through Dubai on Monday. Am I going to make it?"

The agent calls `transit_rules`. Nothing restricts London — but the passenger is coming from
Uganda, and the UAE entry restriction applies to indirect routings. It should say transit is
not currently permitted, and name the 21-day condition.

**Say over it:** "Nothing about that answer is in a database. It just read the Emirates
travel-updates page — live, through context.dev — and the restriction it found is on where
she's *coming from*, not where she's going."

Then show that exact sentence on the real page in your second tab. **This is the strongest
30 seconds of the video — the on-screen page proves the claim.**

### Q2 — the interrupt (proves barge-in)

Let the agent start a long answer, then cut in three words down:

> "— sorry, what about E K seventeen?"

It should stop cleanly and switch to `flight_status`. Do not wait for a gap; the point is
that you talked over it.

### Q3 — the chain (proves it's an agent, not a lookup)

> "So what do I do? I'm stuck at the airport."

The agent should chain `rebooking_options` — which cross-checks the live advisory before
offering seats — and `stranded_support`: vouchers, and which desk in Terminal 3. It reaches
those without you naming a tool.

### Optional, if you have 20 seconds

> "What's the weather doing at Dubai?"

Live METAR, decoded to operational impact. Mention that if any source fails, the endpoint
returns a spoken degraded message rather than an error — and that `npm test` runs the whole
suite with the network blocked.

---

## The six questions to answer on camera

1. **Problem and who for** (~30s) — passengers mid-journey during a disruption. The answer
   they need is prose on a page that changes without warning, buried between lounge
   refurbishment notices, unreadable in a terminal.
2. **Live demo** (~2min) — the run above. Name the data explicitly: the Emirates
   travel-updates page, fetched through context.dev at the moment of the question.
3. **Why live data is essential** (~30s) — *"Our project would fundamentally break without
   live web data because an entry restriction that was lifted yesterday and one extended
   this morning produce opposite advice, and there is no API for either — only a page."*
   On mid-conversation change, say it precisely: **every tool call re-fetches, so a change
   between two questions is picked up on the next call. We do not push a change into an
   in-flight turn — that's v2.** Do not overstate this.
4. **What the agent does autonomously** (~45s) — chains tools unprompted (restriction →
   rebooking → support), checks both origin and destination because restrictions key off
   either, refuses to answer route questions from memory, and hedges its phrasing from the
   `source` field. ElevenLabs features: barge-in, webhook tool-calling, and a voice chosen
   calm and slightly slow because callers are stressed and flight numbers must land first
   time.
5. **What's novel** (~30s) — a voice agent whose knowledge source is an airline's own
   unstructured advisory prose, parsed live, checking the leg of the journey nobody checks.
   Not a booking bot, not an FAQ.
6. **Hardest problem** (~30s) — turning advisory prose into a decision. Three things broke
   the naive version: the restriction keys off **origin**, not destination, so
   destination-only matching tells the passenger she's fine; the qualifier that changes the
   answer sits in the *next* sentence; and *"effective 6 June (until further notice)"*
   contains a date that is not an end date. Fixed with two-sided matching, sentence windows,
   and open-ended detection — all pinned by tests against verbatim page text.

---

## Do not claim

The brief says overclaiming costs more than not claiming. Specifically:

- **Do not say all twelve tools are live.** Eight are live-backed (`disruption_status`,
  `transit_rules`, `entry_requirements`, `weather_ops`, `recent_changes`, `travel_intel`,
  plus the two MCP tracking tools); the rest are static with a live cross-check, and
  `flight_status` is deliberately split (live position, static schedule). The `source`
  field in every response says which, and judges can check it themselves.
- **Do not say `stranded_support` is returning live data** — it returns `baseline` today,
  because there is no voucher language on the current page to extract.
- **Do not say "streaming"** unless you mean ElevenLabs' own audio streaming.
- **Do not say "real-time"** about the cache. Say "live at the moment of the question".
- **Do not claim we push changes into a live conversation turn.** A context.dev monitor does
  push advisory changes to the backend within ~15 minutes, and `recent_changes` reports how
  long ago — but the agent only learns of it on its next tool call, not mid-sentence.
- **Do not claim mid-conversation data invalidation.** We re-fetch per call. That is good,
  and it is not the same thing.

---

## If the page changed

The advisory page is live, so your demo premise can evaporate between now and recording.
Find what is actually on it:

```bash
curl -s -X POST https://irops-copilot-backend.onrender.com/tools/disruption_status -H 'content-type: application/json' -d '{"destination":"Uganda"}'
```

If that comes back `"blocked": false`, the Ebola restriction has been lifted. Re-read the
page, pick whatever restriction *is* current, and swap the countries in Q1 — the parser is
not hardcoded to this advisory. Add any new country name variants to `countryAliases` in
[`src/data/mocks.js`](../src/data/mocks.js), and update the `LIVE_EXCERPT` fixture in
[`test/advisory.test.js`](../test/advisory.test.js) so the tests still pin reality.

A demo built on a restriction that has been lifted is worse than no demo — the judges will
check the page.
