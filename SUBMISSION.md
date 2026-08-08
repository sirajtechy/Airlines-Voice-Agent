# Submission pack — RAAHI

Team: **Siraj · Astha · Farman** — BUiD Voice Agents Hackathon, Dubai, 8 August 2026.

---

## 1 · Links to submit

| Item | Link |
| --- | --- |
| **Public repo** | https://github.com/sirajtechy/Airlines-Voice-Agent |
| **Live backend** | https://irops-copilot-backend.onrender.com |
| **Health check** | https://irops-copilot-backend.onrender.com/healthz |
| **Talk to RAAHI (mobile)** | https://irops-copilot-backend.onrender.com/talk |
| **Scannable QR** | https://irops-copilot-backend.onrender.com/qr |
| **Loom video** | _paste after recording_ |

> The Render hostname still reads `irops-copilot-backend` — the service, the 12 ElevenLabs
> tool URLs and the context.dev monitor webhook are all bound to it. Renaming the host on
> submission day would have broken the live agent for a cosmetic gain, so the product is
> RAAHI everywhere a human looks and the infrastructure name was left alone.

## 2 · Required documents (all at repo root or `docs/`)

- **[README.md](README.md)** — what it does, Mermaid architecture, 12-tool table, live-vs-static
  honesty table, 15-row feature log, setup, deploy
- **[TECH-SPEC.md](TECH-SPEC.md)** — problem, architecture, tool rationale, feasibility, extensibility
- **[docs/architecture.md](docs/architecture.md)** — layer-by-layer walkthrough + sequence diagram
- **[docs/question-bank.md](docs/question-bank.md)** — every question RAAHI answers + guardrail test results
- **[docs/demo-script.md](docs/demo-script.md)** — demo run sheet
- **[docs/RAAHI-loom-deck.pptx](docs/RAAHI-loom-deck.pptx)** — 12-slide demo deck, full-bleed
  hero artwork on the opener and closer, regenerable via `python3 scripts/build-deck.py`
- **[docs/RAAHI-deck-notes.md](docs/RAAHI-deck-notes.md)** — speaker notes for all 12 slides.
  Kept out of the .pptx deliberately (see the note in that file); open it on a second screen
- **[docs/assets/](docs/assets/)** — logo, QR code, rendered diagrams (PNG/SVG)

## 3 · Pre-flight checklist — do these in order

```bash
# 1 · Prime the cache so nothing waits on a cold scrape during recording
curl -X POST https://irops-copilot-backend.onrender.com/admin/warm

# 2 · Confirm the backend is healthy and keyed
curl -s https://irops-copilot-backend.onrender.com/healthz

# 3 · Confirm the demo premise is STILL live (the advisory page can change)
curl -s -X POST https://irops-copilot-backend.onrender.com/tools/journey_brief \
  -H 'content-type: application/json' -d '{"pnr":"K7X2M9"}'
#    → must show clear_to_travel: false
```

- [ ] `clear_to_travel: false` for `K7X2M9` — if this flips to `true`, the advisory changed;
      switch the demo to `T4B9RD` (Beirut route suspension) and say so on camera
- [ ] `/healthz` shows `context_dev_key: true` and `cache_entries` > 0
- [ ] Repo is public, opens without an access request
- [ ] Phone on wifi, browser mic permission granted, notifications silenced
- [ ] Screen-record at 1080p; test audio levels for 5 seconds first

## 4 · Loom video script — 3 minutes

Slide deck: **[docs/RAAHI-loom-deck.pptx](docs/RAAHI-loom-deck.pptx)** — 12 slides, each with
notes in [RAAHI-deck-notes.md](docs/RAAHI-deck-notes.md) matching the beats below. Slide 1 and slide 11 are full-bleed artwork: open on
slide 1 held silent for three seconds, and land on slide 11 as the emotional beat before the
QR. Slides 9 and 10 (reliability, bugs found) are reserve material for judge questions rather
than the 3-minute cut.

Record in **four takes** and stitch, or straight through. Timings are targets, not rules.

### 0:00–0:25 · The problem (screen: the live Emirates advisory page)

> "This is the Emirates travel updates page, right now. Buried in here, between a lounge
> refurbishment notice and Schengen biometrics, are two sentences: the UAE will not admit
> travellers who've recently been in the DRC, Uganda or South Sudan — and it applies to
> indirect routings. If you're flying Kampala to London through Dubai, those two sentences
> decide whether you should get in a taxi. They're not in any database. They're prose on a
> web page that changed in June and will change again."

*Scroll to the actual sentences. Let them be read.*

### 0:25–1:30 · The demo (screen: phone, /talk page, RAAHI widget)

Say out loud: **"My booking reference is K seven X two M nine — should I leave for the airport?"**

RAAHI should lead with the restriction, then the 21-day exemption, then the next action.

> "One booking reference. Behind that, five live sources checked in parallel in about two
> seconds — transit rules, destination disruption, UK entry paperwork, where the aircraft
> physically is, and Dubai weather."

Then the control case: **"What about booking P three L eight Q K?"** → comes back clear.

> "Same destination — London. Opposite answer. Because the restriction depends on where
> you've *been*, not where you're going. Checking only the destination — the obvious
> implementation — tells the Kampala passenger she's fine. She isn't."

### 1:30–2:15 · Depth (screen: split — repo diagram + phone)

Pick **two** of these, not all:

- **Change detection:** "Has anything changed in the last hour?" → *"Nothing has changed —
  that still stands."* → "A context.dev monitor re-reads that page every fifteen minutes
  with semantic diffing and pushes signed webhooks to us. A website can tell you what it
  says. Only a monitor can tell you it *changed*, and when."
- **Live aircraft (MCP):** "How busy is Dubai airspace right now?" → real count →
  "That's live ADS-B, over the agent's native MCP connection. Twelve webhook tools plus an
  MCP server — both ElevenLabs integration paths."
- **Guardrail:** read out a fake card number → RAAHI refuses and warns you not to share it,
  and never repeats a digit. "Two independent guardrail layers, and our own logs redact it
  too — because a frightened passenger reading their card out isn't an attack, it's Tuesday."
- **Arabic:** tap العربية, ask in Arabic → answers in Arabic. "Dubai is a transit hub."

### 2:15–3:00 · Honesty + close (screen: README live-vs-static table)

> "What's honest about this: eight of twelve tools read live data on every call, and every
> response carries a source field you can check yourself. What we don't claim — there's no
> real PNR lookup. Emirates' Manage Booking is auth-gated; we scraped it and got a login
> redirect. So the booking lookup is a labelled demo store and everything downstream of it
> is live. Real PNR access is an airline data contract, not an afternoon."

> "Fifty-eight tests, all passing with the API key blank — because a demo that dies on venue
> wifi scores zero regardless of what it does when the network's up."

*End on the QR slide:* "Scan this and talk to RAAHI yourself. No app — just a browser."

## 5 · Talking points held in reserve

Use these if judges probe.

- **Why the parser isn't an LLM call:** a second LLM pass costs 2–4s against a 20s budget and
  makes the tests flaky. Regex over sentences is testable offline and its failure mode is
  "no match", which we already handle.
- **A bug worth admitting:** simulation caught the agent inventing *"you're clear to travel"*
  from an unreadable tool result — the opposite of the truth. Two prompt rules now forbid it,
  and it won't soften under a repeated question either.
- **A second one:** the origin-side check asked a document-level question of a two-sentence
  window; one intervening sentence could flip *blocked* to *allowed*. Found while writing an
  injection test. Fixed and pinned.
- **Rate limits:** context.dev is 10 req/min on the free tier. A 12-tool burst hit 429s, so
  concurrent identical scrapes are now coalesced — three parallel requests become one.
- **What v2 needs:** Cirium/OAG for real schedules, Redis so instances share cache warmth,
  and pushing a monitor event into a conversation already in flight.

## 6 · Known gaps — say these before a judge finds them

- `stranded_support` returns `source: "baseline"`: the live path works, today's page simply
  has no hotel or voucher language to extract.
- `flight_status` schedule fields are static (`schedule_source: "mock"`); the ADS-B position
  next to them is live. Two source fields on purpose, so the live half can't lend
  credibility to the static half.
- The route map covers ~330 EK flight numbers with route and fleet, **not** today's times or
  gates. No keyless source publishes those.
- MCP tools have not been exercised through `simulate-conversation` (the harness doesn't run
  MCP), only through ElevenLabs' own handshake and direct protocol calls.
