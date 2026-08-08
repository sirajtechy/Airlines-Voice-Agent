'use strict';

/**
 * The audience-facing surface: RAAHI in any mobile browser, no app install.
 *
 * ElevenLabs agents are reachable from a phone two ways — their hosted
 * "talk-to" page, or the embeddable widget on any https page. We serve the
 * widget ourselves so the demo URL is ours, the page is branded, and the demo
 * PNRs are printed right under the microphone button where a first-time tester
 * needs them.
 *
 * /talk — the widget page people actually use.
 * /qr   — a projectable QR code pointing at /talk, for "scan this" moments.
 *         The QR image comes from a public generator service; the only thing
 *         encoded is our own public URL, so there is nothing to leak.
 */

const express = require('express');

const router = express.Router();

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_7301kzg65ntsfpvtcex012707re0';

function publicBase(req) {
  return (process.env.PUBLIC_BASE_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
}

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0b1220; color: #e8edf6; min-height: 100vh;
         display: flex; flex-direction: column; align-items: center;
         padding: 32px 20px; text-align: center; }
  h1 { font-size: 2.4rem; letter-spacing: 0.18em; margin-bottom: 4px; }
  .sub { color: #93a3bd; margin-bottom: 28px; font-size: 0.95rem; }
  .card { background: #131c30; border: 1px solid #223052; border-radius: 14px;
          padding: 20px; max-width: 430px; width: 100%; margin-bottom: 18px; }
  .card h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
             color: #7f91b2; margin-bottom: 10px; }
  .card p, .card li { font-size: 0.92rem; line-height: 1.55; color: #c7d2e5; }
  .card ul { list-style: none; }
  .card li { margin-bottom: 8px; }
  .pnr { font-family: ui-monospace, monospace; background: #1d2a45; padding: 1px 7px;
         border-radius: 5px; color: #ffd479; }
  a { color: #7fb2ff; }
  .foot { margin-top: auto; padding-top: 24px; font-size: 0.75rem; color: #5a6a86; }
`;

router.get('/talk', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAAHI — Emirates operations copilot</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>RAAHI</h1>
  <p class="sub">Voice copilot for flight disruptions &middot; live data, spoken answers</p>

  <div class="card">
    <h2>Try asking</h2>
    <ul>
      <li>"My booking reference is <span class="pnr">K7X2M9</span> — should I leave for the airport?"</li>
      <li>"Can I connect through Dubai from Kampala to London?"</li>
      <li>"How busy is Dubai airspace right now?"</li>
      <li>"What do I need to enter the UK?"</li>
      <li>"Has anything changed in the last hour?"</li>
    </ul>
  </div>

  <div class="card">
    <h2>Demo booking references</h2>
    <p><span class="pnr">K7X2M9</span> Kampala &rarr; London &nbsp;&middot;&nbsp;
       <span class="pnr">P3L8QK</span> Mumbai &rarr; London &nbsp;&middot;&nbsp;
       <span class="pnr">T4B9RD</span> Dubai &rarr; Beirut</p>
    <p style="margin-top:8px">Bookings are demo data. Everything Raahi checks about them
       &mdash; restrictions, transit rules, entry paperwork, aircraft positions, weather
       &mdash; is live.</p>
  </div>

  <p class="sub">Tap the widget below and allow the microphone.</p>

  <elevenlabs-convai agent-id="${AGENT_ID}"></elevenlabs-convai>
  <script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>

  <p class="foot">BUiD Voice Agents Hackathon, Dubai &middot; ElevenLabs + context.dev
    &middot; <a href="https://github.com/sirajtechy/Airlines-Voice-Agent">source</a></p>
</body>
</html>`);
});

router.get('/qr', (req, res) => {
  const talkUrl = `${publicBase(req)}/talk`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=2&data=${encodeURIComponent(talkUrl)}`;
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scan to talk to RAAHI</title>
<style>${PAGE_STYLE}
  .qr { background: #fff; padding: 18px; border-radius: 18px; margin: 10px 0 16px; }
  .qr img { display: block; width: min(72vw, 460px); height: auto; }
  .url { font-family: ui-monospace, monospace; font-size: 1.05rem; color: #ffd479; }
</style>
</head>
<body>
  <h1>RAAHI</h1>
  <p class="sub">Scan with your phone camera &mdash; no app needed, just a browser and a microphone</p>
  <div class="qr"><img src="${qr}" alt="QR code linking to ${talkUrl}"></div>
  <p class="url">${talkUrl}</p>
  <p class="foot">Voice copilot for flight disruptions &middot; BUiD Hackathon, Dubai</p>
</body>
</html>`);
});

module.exports = router;
