'use strict';

/**
 * The audience-facing surface: RAAHI in any mobile browser, no app install.
 *
 * ElevenLabs agents are reachable from a phone two ways — their hosted
 * "talk-to" page, or the embeddable widget on any https page. We serve the
 * widget ourselves so the demo URL is ours, the page is branded, and the
 * FAQ a first-time tester needs is printed around the microphone button.
 *
 * The page is bilingual (English / Arabic, full RTL) because the agent is:
 * it carries language presets for Arabic and Hindi and switches mid-call.
 * The toggle is ~10 lines of vanilla JS — a framework here would be the
 * only dependency in an otherwise Express-only stack.
 *
 * /talk — the page people actually use.
 * /qr   — a projectable QR code pointing at /talk, for "scan this" moments.
 */

const express = require('express');

const router = express.Router();

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_7301kzg65ntsfpvtcex012707re0';

function publicBase(req) {
  return (process.env.PUBLIC_BASE_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
}

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Arabic', sans-serif;
         background: #0b1220; color: #e8edf6; min-height: 100vh;
         display: flex; flex-direction: column; align-items: center;
         padding: 28px 18px; }
  h1 { font-size: 2.3rem; letter-spacing: 0.18em; text-align: center; }
  .sub { color: #93a3bd; margin: 4px 0 18px; font-size: 0.95rem; text-align: center; }
  .lang { margin-bottom: 18px; }
  .lang button { background: #1d2a45; color: #c7d2e5; border: 1px solid #2c3d63;
                 padding: 7px 16px; border-radius: 999px; font-size: 0.9rem; cursor: pointer; }
  .lang button.on { background: #2f4b8f; color: #fff; border-color: #4d6fc4; }
  .card { background: #131c30; border: 1px solid #223052; border-radius: 14px;
          padding: 18px; max-width: 460px; width: 100%; margin-bottom: 14px; }
  .card h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
             color: #7f91b2; margin-bottom: 10px; }
  .card p, .card li, .card summary { font-size: 0.93rem; line-height: 1.6; color: #c7d2e5; }
  details { border-bottom: 1px solid #1d2a45; padding: 7px 0; }
  details:last-child { border-bottom: none; }
  summary { cursor: pointer; color: #dbe4f3; font-weight: 500; }
  details p { padding: 7px 4px 3px; color: #93a3bd; }
  .pnr { font-family: ui-monospace, monospace; background: #1d2a45; padding: 1px 7px;
         border-radius: 5px; color: #ffd479; white-space: nowrap; }
  .brain li { margin: 0 0 9px 18px; }
  a { color: #7fb2ff; }
  .foot { margin-top: auto; padding-top: 22px; font-size: 0.75rem; color: #5a6a86; text-align: center; }
  [dir="rtl"] .brain li { margin: 0 18px 9px 0; }
`;

const TOGGLE_SCRIPT = `
  function setLang(l) {
    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.style.display = el.getAttribute('data-lang') === l ? '' : 'none';
    });
    document.getElementById('btn-en').classList.toggle('on', l === 'en');
    document.getElementById('btn-ar').classList.toggle('on', l === 'ar');
  }
  setLang('en');
`;

const EN_CONTENT = `
  <div class="card">
    <h2>Ask Raahi</h2>
    <details open><summary>"My booking reference is K7X2M9 — should I leave for the airport?"</summary>
      <p>One booking code fans out to five live checks at once — transit rules, destination
      disruption, entry paperwork, where the aircraft physically is, and Dubai weather —
      and comes back as one decision in about two seconds.</p></details>
    <details><summary>"Can I connect through Dubai from Kampala to London?"</summary>
      <p>Restrictions often depend on where you have <i>been</i>, not where you are going.
      Raahi checks both sides of the journey against the live Emirates advisory.</p></details>
    <details><summary>"What do I need to enter the UK? And for Nigeria?"</summary>
      <p>EU and UK paperwork comes from the live advisory plus gov.uk and europa.eu. Anywhere
      else, Raahi searches official sources only — and tells you where the answer came from.</p></details>
    <details><summary>"Has anything changed in the last hour?"</summary>
      <p>A monitor re-reads the advisory every fifteen minutes and pushes changes to Raahi.
      "Nothing has changed — that still stands" is a real answer, and so is
      "that changed eleven minutes ago".</p></details>
    <details><summary>"Where is EK 305 right now? How busy is Dubai airspace?"</summary>
      <p>Live transponder data: altitude, speed, climbing or descending — and a live count
      of everything flying within a hundred miles of the airport.</p></details>
    <details><summary>"My flight's delayed five hours — what am I owed?"</summary>
      <p>Compensation, rebooking, hotels, baggage — and which desk to walk to.</p></details>
  </div>

  <div class="card brain">
    <h2>The intelligence behind Raahi</h2>
    <ul>
      <li><b>Reads the page that changes,</b> live — the Emirates travel advisory, scraped
        to text at the moment you ask, not a stale database.</li>
      <li><b>Understands prose, not keywords</b> — a restriction that keys off your origin,
        a 21-day exemption hiding in a subordinate clause, an "effective from" date that is
        not an end date.</li>
      <li><b>Knows when the world changed</b> — semantic change detection pushes advisory
        updates to Raahi within fifteen minutes.</li>
      <li><b>Sees real aircraft</b> — live ADS-B transponder data, spoken plainly.</li>
      <li><b>Never bluffs</b> — every answer carries its source. Live is stated as fact,
        cached as "as of the last update", unverified as "I could not confirm — check with
        Emirates". It will not soften that under pressure.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Demo booking references</h2>
    <p><span class="pnr">K7X2M9</span> Kampala → London &nbsp;·&nbsp;
       <span class="pnr">P3L8QK</span> Mumbai → London &nbsp;·&nbsp;
       <span class="pnr">T4B9RD</span> Dubai → Beirut</p>
    <p style="margin-top:8px">Bookings are demo data — everything Raahi checks about them is live.</p>
  </div>

  <p class="sub">Tap the widget below, allow the microphone, and just talk — English, العربية, or हिन्दी.</p>
`;

const AR_CONTENT = `
  <div class="card" dir="rtl" lang="ar">
    <h2>اسأل راحي</h2>
    <details open><summary>"رقم حجزي K7X2M9 — هل أغادر إلى المطار؟"</summary>
      <p>رمز حجز واحد يُطلق خمسة فحوصات حية في آنٍ واحد — قواعد العبور، وتعطّل الوجهة،
      وأوراق الدخول، وموقع الطائرة الفعلي، وطقس دبي — ويعود بقرار واحد في نحو ثانيتين.</p></details>
    <details><summary>"هل أستطيع العبور عبر دبي من كمبالا إلى لندن؟"</summary>
      <p>كثير من القيود تعتمد على المكان الذي كنت فيه، لا وجهتك. راحي يفحص طرفي الرحلة
      معاً في نشرة طيران الإمارات المباشرة.</p></details>
    <details><summary>"ماذا أحتاج لدخول بريطانيا؟ ولنيجيريا؟"</summary>
      <p>متطلبات الاتحاد الأوروبي وبريطانيا من النشرة المباشرة ومواقع gov.uk وeuropa.eu.
      ولأي وجهة أخرى يبحث راحي في المصادر الرسمية فقط — ويخبرك من أين جاءت الإجابة.</p></details>
    <details><summary>"هل تغيّر شيء خلال الساعة الماضية؟"</summary>
      <p>نظام مراقبة يعيد قراءة النشرة كل خمس عشرة دقيقة ويدفع التغييرات إلى راحي فوراً.
      "لم يتغيّر شيء — الكلام ما زال قائماً" إجابة حقيقية، وكذلك "تغيّر قبل إحدى عشرة دقيقة".</p></details>
    <details><summary>"أين الرحلة EK 305 الآن؟ وما مدى ازدحام أجواء دبي؟"</summary>
      <p>بيانات حية من أجهزة إرسال الطائرات: الارتفاع والسرعة والصعود أو الهبوط —
      وعدد مباشر لكل ما يطير حول المطار.</p></details>
    <details><summary>"تأخرت رحلتي خمس ساعات — ما هي حقوقي؟"</summary>
      <p>التعويض وإعادة الحجز والفنادق والأمتعة — وأي مكتب تقصده.</p></details>
  </div>

  <div class="card brain" dir="rtl" lang="ar">
    <h2>الذكاء وراء راحي</h2>
    <ul>
      <li><b>يقرأ الصفحة التي تتغيّر،</b> مباشرةً — نشرة سفر طيران الإمارات لحظة سؤالك،
        لا قاعدة بيانات قديمة.</li>
      <li><b>يفهم النصوص لا الكلمات المفتاحية</b> — قيد يعتمد على نقطة انطلاقك،
        واستثناء الواحد والعشرين يوماً المختبئ في جملة فرعية.</li>
      <li><b>يعرف متى تغيّر العالم</b> — رصد دلالي للتغييرات يصل إلى راحي خلال دقائق.</li>
      <li><b>يرى طائرات حقيقية</b> — بيانات حية تُقال بوضوح.</li>
      <li><b>لا يخمّن أبداً</b> — كل إجابة تحمل مصدرها، وما لم يتأكد منه يقول:
        "لم أستطع التأكد — راجع طيران الإمارات".</li>
    </ul>
  </div>

  <div class="card" dir="rtl" lang="ar">
    <h2>أرقام حجوزات تجريبية</h2>
    <p><span class="pnr">K7X2M9</span> كمبالا ← لندن &nbsp;·&nbsp;
       <span class="pnr">P3L8QK</span> مومباي ← لندن &nbsp;·&nbsp;
       <span class="pnr">T4B9RD</span> دبي ← بيروت</p>
    <p style="margin-top:8px">الحجوزات بيانات تجريبية — وكل ما يفحصه راحي عنها مباشر وحي.</p>
  </div>

  <p class="sub" dir="rtl" lang="ar">اضغط على الأداة بالأسفل، واسمح بالميكروفون، وتحدّث بالعربية مباشرة.</p>
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
  <p class="sub">Voice copilot for flight disruptions · live data, spoken answers<br/>
     <span dir="rtl" lang="ar">مساعد صوتي لاضطرابات الرحلات · بيانات حية، وإجابات منطوقة</span></p>

  <div class="lang">
    <button id="btn-en" class="on" onclick="setLang('en')">English</button>
    <button id="btn-ar" onclick="setLang('ar')">العربية</button>
  </div>

  <div data-lang="en">${EN_CONTENT}</div>
  <div data-lang="ar">${AR_CONTENT}</div>

  <elevenlabs-convai agent-id="${AGENT_ID}"></elevenlabs-convai>
  <script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
  <script>${TOGGLE_SCRIPT}</script>

  <p class="foot">BUiD Voice Agents Hackathon, Dubai · ElevenLabs + context.dev
    · <a href="https://github.com/sirajtechy/Airlines-Voice-Agent">source</a></p>
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
  <p class="sub">Scan with your phone camera — no app needed, just a browser and a microphone<br/>
     <span dir="rtl" lang="ar">امسح بكاميرا هاتفك — لا حاجة لتطبيق، متصفح وميكروفون فقط</span></p>
  <div class="qr"><img src="${qr}" alt="QR code linking to ${talkUrl}"></div>
  <p class="url">${talkUrl}</p>
  <p class="foot">Voice copilot for flight disruptions · BUiD Hackathon, Dubai</p>
</body>
</html>`);
});

module.exports = router;
