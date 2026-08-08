# RAAHI — Complete Build & Deployment Spec (for Devin)

## Context
Voice-first flight-disruption agent for the BUiD hackathon. Voice layer is ElevenLabs
Conversational Agents (already configured, 5 webhook tools published). Live web data
comes from context.dev. This spec covers the backend only: extend the existing repo,
make every endpoint production-ready, and deploy to Render so judges get a permanent URL.

Repo: github.com/sirajtechy/irops-copilot-backend (Node 18+, Express, node-fetch@2 already installed)
Existing file: index.js — 5 working endpoints with mock data + live METAR.

## Non-negotiable constraints
1. DO NOT change existing endpoint paths or request/response contracts — ElevenLabs
   tools point at them. Paths: /tools/flight_status, /tools/weather_ops,
   /tools/policy_lookup, /tools/rebooking_options, /tools/turnaround_brief
2. Every endpoint must respond in under 15 seconds even when a scrape fails
   (ElevenLabs tool timeout is 20s). Use an 8s fetch timeout + cache fallback.
3. Never return a 500 with an empty body to ElevenLabs. On total failure return
   200 with { "status": "degraded", "message": "<spoken-friendly explanation>" } —
   the agent will read this aloud gracefully.
4. Keep the mock flightDB as final fallback. Demo must survive total internet loss.

## Task 1 — Project restructure
Split index.js into:
  src/server.js          — express app, route registration
  src/routes/tools.js    — all /tools/* handlers
  src/lib/contextClient.js — context.dev scrape wrapper
  src/lib/cache.js       — disk cache (JSON files in ./cache, gitignored)
  src/data/mocks.js      — existing flightDB + policies objects, unchanged
package.json: "start": "node src/server.js", engines.node >= 18.
Port: process.env.PORT || 3000 (Render injects PORT).

## Task 2 — context.dev client (src/lib/contextClient.js)
Export: async scrape(url, { selector } = {})
- Calls context.dev extraction API with API key from process.env.CONTEXT_DEV_API_KEY
  (consult https://context.dev docs for the exact endpoint shape; if the API differs
  from assumptions, adapt and document in README).
- 8s AbortController timeout.
- On success: write result to cache via cache.set(url, data), return { data, source: "live" }.
- On any failure: return cache.get(url) as { data, source: "cache" } or
  { data: null, source: "none" }.
Export: warmCache(urls[]) — sequential scrape of all target URLs, called on server boot
  (fire-and-forget) and via POST /admin/warm.

## Task 3 — New endpoint: POST /tools/disruption_status
Body: { "destination": "string" }  (city or airport, e.g. "Beirut", "BEY")
Scrapes the Emirates travel-updates page (https://www.emirates.com/ae/english/help/travel-updates/)
via contextClient. Parse for the destination.
Response 200:
{
  "destination": "Beirut",
  "suspended": true,
  "suspended_until": "2026-08-10" | null,
  "extended_before": true,          // heuristic: page mentions "extended" for this route
  "advisory_text": "<=300 chars of the relevant advisory>",
  "source": "live" | "cache" | "none"
}
If destination not found in advisory: { "suspended": false, "advisory_text": "No current suspension found for <destination>.", ... }

## Task 4 — New endpoint: POST /tools/transit_rules
Body: { "origin": "string", "final_destination": "string" }
Same scrape source. Determine whether transit passengers via Dubai to final_destination
are being accepted (advisories phrase this as "customers transiting through Dubai with
final destination X will not be accepted").
Response 200:
{ "transit_allowed": false, "explanation": "<spoken-friendly, <=250 chars>", "source": "live|cache|none" }

## Task 5 — New endpoint: POST /tools/stranded_support
Body: { "location": "string" }
Return practical stranded-passenger guidance. Scrape the Emirates help/travel-updates
page for hotel/meal/accommodation language; if nothing live, fall back to this static
baseline (keep in mocks.js):
"If your delay exceeds 6 hours due to a cancellation, ask the Emirates transfer desk
about hotel and meal vouchers. During major regional disruptions, Dubai authorities
have historically covered accommodation for stranded transit passengers — ask the
airport's passenger-support desk in Terminal 3."
Response 200: { "location", "support_text", "source" }

## Task 6 — Upgrade /tools/flight_status
Try live first: scrape Emirates flight-status or use any free flight-status source
reachable without a key; if unavailable within timeout, fall back to mock flightDB
(EK17, EK001). Add "source" field to the response. Contract otherwise unchanged.

## Task 7 — Health + demo safety
- GET /            -> "RAAHI backend is running." (exists, keep)
- GET /healthz     -> 200 { ok: true, cache_entries: n, uptime_s: n }
- POST /admin/warm -> triggers warmCache, returns { warmed: [urls] }
- On boot: warmCache([emirates travel-updates URL, aviationweather.gov OMDB URL])

## Task 8 — Tests
Add minimal test script (node --test or jest): each /tools/* endpoint returns 200 and
required fields when network is blocked (simulate by setting CONTEXT_DEV_API_KEY empty
and no cache) — proves the degraded path never crashes.

## Task 9 — Render deployment
Add render.yaml:
  services:
    - type: web
      name: irops-copilot-backend
      env: node
      plan: free
      buildCommand: npm install
      startCommand: npm start
      envVars:
        - key: CONTEXT_DEV_API_KEY
          sync: false
README section "Deploy": sign in to render.com with GitHub -> New Web Service ->
select repo -> it reads render.yaml -> set CONTEXT_DEV_API_KEY in dashboard -> deploy.
Document final URL format: https://irops-copilot-backend.onrender.com

## Task 10 — README for judges
Sections: What it does (1 para), Architecture diagram (ascii), Live URL, The 8 tools
table (name, input, output, data source), How the voice agent calls it (ElevenLabs
webhook tools), Demo script (3 questions + interrupt), Team.

## After deploy — manual step (NOT Devin)
In ElevenLabs, edit each of the 5 existing tools + add the 3 new ones, replacing the
Codespace URL with the Render URL. Then re-Publish the agent.

## Acceptance checklist
[ ] curl -X POST <render-url>/tools/flight_status -d '{"flight_no":"EK17"}' returns 200 JSON
[ ] Same for all 8 tools
[ ] Killing network -> endpoints still return 200 degraded/cached
[ ] /healthz shows cache entries after boot
[ ] Repo README has live URL + demo script
