'use strict';

/**
 * The audience-facing surface: RAAHI in any mobile browser, no app install.
 *
 * ElevenLabs agents are reachable from a phone two ways — their hosted
 * "talk-to" page, or the embeddable widget on any https page. We serve the
 * widget ourselves so the demo URL is ours, the page carries the airline's
 * visual language, and the FAQ a first-time tester needs sits around the
 * microphone button.
 *
 * Styled to Emirates' web identity — their red, gold accents, light airy
 * layout, generous whitespace — using colour and type only. No Emirates logo,
 * imagery or font files are used or hotlinked, and the footer states plainly
 * that this is an independent prototype. Looking like the airline is the point;
 * being mistaken for it is not.
 *
 * Bilingual (English / Arabic, full RTL) because the agent is: it carries
 * language presets for Arabic and Hindi and switches mid-call. The toggle is
 * ~10 lines of vanilla JS — a framework here would be the only dependency in
 * an otherwise Express-only stack.
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

/** Emirates web palette, approximated from their public site. */
const THEME = `
  :root {
    --ek-red: #d71921;
    --ek-red-dark: #a3121a;
    --ek-gold: #c39c57;
    --ink: #1c1c1c;
    --ink-soft: #5c6069;
    --line: #e3e5e8;
    --surface: #ffffff;
    --canvas: #f6f6f7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, 'Noto Sans Arabic', Arial, sans-serif;
    background: var(--canvas); color: var(--ink);
    min-height: 100vh; display: flex; flex-direction: column;
    line-height: 1.55; -webkit-font-smoothing: antialiased;
  }

  /* Top bar. The logo is dark red on white, so the band is white with the
     Emirates red rule beneath it rather than a red fill the mark would vanish into. */
  header {
    background: var(--surface); border-bottom: 3px solid var(--ek-red);
    box-shadow: inset 0 -6px 0 -3px var(--ek-gold);
    padding: 11px 18px; display: flex; align-items: center; gap: 12px;
  }
  /* The supplied artwork is a square with wide white margins, so the symbol is
     cropped tight and paired with a CSS wordmark. Scaling the padded original
     to header height rendered the glyph at roughly half its apparent size. */
  header .symbol { height: 40px; width: auto; display: block; flex-shrink: 0; }
  .lockup { display: flex; flex-direction: column; line-height: 1.05; }
  .lockup .name {
    font-size: 1.42rem; font-weight: 600; color: var(--ek-red);
    letter-spacing: 0.21em; text-transform: uppercase;
  }
  .lockup .tag {
    font-size: 0.53rem; color: var(--ink-soft); letter-spacing: 0.29em;
    text-transform: uppercase; margin-top: 3px;
  }
  @media (max-width: 380px) {
    .lockup .name { font-size: 1.18rem; letter-spacing: 0.16em; }
    header .symbol { height: 34px; }
  }
  .badge {
    margin-inline-start: auto; background: #fdf2f3; color: var(--ek-red-dark);
    border: 1px solid #f2d6d8; font-size: 0.62rem; letter-spacing: 0.14em;
    text-transform: uppercase; padding: 5px 10px; border-radius: 3px; white-space: nowrap;
  }

  /* Hero */
  .hero {
    background: var(--surface); border-bottom: 1px solid var(--line);
    padding: 30px 20px 26px; text-align: center;
  }
  .hero-logo { width: min(250px, 60vw); height: auto; margin: 0 auto 14px; display: block; }
  .hero h1 {
    font-size: clamp(1.6rem, 5.6vw, 2.15rem); font-weight: 300;
    letter-spacing: -0.01em; margin-bottom: 8px;
  }
  .hero h1 b { font-weight: 600; color: var(--ek-red); }
  .hero p { color: var(--ink-soft); font-size: 0.96rem; max-width: 46ch; margin: 0 auto; }
  .rule { width: 46px; height: 3px; background: var(--ek-gold); margin: 15px auto 0; }

  main { flex: 1; width: 100%; max-width: 620px; margin: 0 auto; padding: 22px 18px 30px; }

  .lang { display: flex; gap: 8px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
  .lang button {
    background: var(--surface); color: var(--ink-soft); border: 1px solid var(--line);
    padding: 8px 20px; border-radius: 2px; font-size: 0.88rem; cursor: pointer;
    font-family: inherit; transition: all .15s;
  }
  .lang button:hover { border-color: var(--ek-red); color: var(--ek-red); }
  .lang button.on { background: var(--ek-red); color: #fff; border-color: var(--ek-red); }

  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: 3px;
    padding: 20px; margin-bottom: 14px;
  }
  .card > h2 {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.16em;
    color: var(--ek-red); font-weight: 600; margin-bottom: 4px;
  }
  .card > h2 + .hr { height: 1px; background: var(--line); margin-bottom: 14px; }
  .card p, .card li { font-size: 0.93rem; color: var(--ink); }

  details { border-bottom: 1px solid var(--line); }
  details:last-of-type { border-bottom: none; }
  summary {
    cursor: pointer; padding: 12px 0; font-size: 0.94rem; font-weight: 500;
    list-style: none; display: flex; gap: 10px; align-items: baseline;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '+'; color: var(--ek-red); font-weight: 600; font-size: 1.05rem;
    line-height: 1; flex-shrink: 0;
  }
  details[open] > summary::before { content: '\\2212'; }
  details p { padding: 0 0 13px 21px; color: var(--ink-soft); font-size: 0.89rem; }
  [dir="rtl"] details p { padding: 0 21px 13px 0; }

  .why { list-style: none; }
  .why li { padding: 10px 0 10px 21px; border-bottom: 1px solid var(--line); position: relative; font-size: 0.9rem; }
  .why li:last-child { border-bottom: none; }
  .why li::before {
    content: ''; position: absolute; inset-inline-start: 0; top: 17px;
    width: 7px; height: 7px; background: var(--ek-gold); border-radius: 50%;
  }
  [dir="rtl"] .why li { padding: 10px 21px 10px 0; }
  .why b { color: var(--ink); }

  .pnr-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .pnr {
    background: #fbf7ef; border: 1px solid var(--ek-gold); border-radius: 2px;
    padding: 7px 11px; font-size: 0.86rem; flex: 1 1 auto; text-align: center;
  }
  .pnr code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-weight: 600;
    color: var(--ek-red-dark); display: block; font-size: 0.94rem; letter-spacing: 0.05em;
  }
  .pnr span { color: var(--ink-soft); font-size: 0.78rem; }
  .note { font-size: 0.82rem; color: var(--ink-soft); }

  .talk-cue {
    text-align: center; margin: 22px 0 12px; padding: 16px;
    background: var(--surface); border: 1px dashed var(--ek-gold); border-radius: 3px;
  }
  .talk-cue strong { display: block; color: var(--ek-red); font-size: 0.98rem; margin-bottom: 3px; }
  .talk-cue span { font-size: 0.85rem; color: var(--ink-soft); }

  footer {
    border-top: 1px solid var(--line); background: var(--surface);
    padding: 20px; text-align: center; font-size: 0.76rem; color: var(--ink-soft);
  }
  footer a { color: var(--ek-red); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  .disclaimer { margin-top: 8px; font-size: 0.72rem; color: #8b8f97; max-width: 52ch; margin-inline: auto; }
  elevenlabs-convai { display: block; }
`;

const LANGS = [
  ['en', 'English'],
  ['ar', 'العربية'],
  ['fr', 'Français'],
  ['zh', '中文'],
];

const TOGGLE_SCRIPT = `
  var LANGS = ${JSON.stringify(LANGS.map((l) => l[0]))};
  function setLang(l) {
    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.style.display = el.getAttribute('data-lang') === l ? '' : 'none';
    });
    LANGS.forEach(function (code) {
      var b = document.getElementById('btn-' + code);
      if (b) b.classList.toggle('on', code === l);
    });
  }
  setLang('en');
`;

const HEADER = `
  <header>
    <img class="symbol" src="/assets/raahi-symbol.png" alt="">
    <span class="lockup">
      <span class="name">Raahi</span>
      <span class="tag">Your way forward</span>
    </span>
    <span class="badge">Operations copilot</span>
  </header>`;

const FOOTER = `
  <footer>
    BUiD Voice Agents Hackathon, Dubai &middot; ElevenLabs + context.dev &middot;
    <a href="https://github.com/sirajtechy/Airlines-Voice-Agent">View source</a>
    <p class="disclaimer">An independent hackathon prototype by Siraj, Astha and Farman.
      Not affiliated with, endorsed by, or operated by Emirates. Booking references are
      demo data — never enter real booking, passport or payment details.</p>
  </footer>`;

const EN_CONTENT = `
  <div class="card">
    <h2>Ask Raahi</h2><div class="hr"></div>
    <details open><summary>"My booking reference is K7X2M9 — should I leave for the airport?"</summary>
      <p>One booking code fans out to five live checks at once — transit rules, destination
      disruption, entry paperwork, where the aircraft physically is, and Dubai weather —
      and comes back as one decision in about two seconds.</p></details>
    <details><summary>"Can I connect through Dubai from Kampala to London?"</summary>
      <p>Restrictions often depend on where you have <i>been</i>, not where you are going.
      Raahi checks both ends of the journey against the live Emirates advisory.</p></details>
    <details><summary>"What do I need to enter the UK? And for Nigeria?"</summary>
      <p>EU and UK paperwork comes from the live advisory plus gov.uk and europa.eu. Anywhere
      else, Raahi searches official sources only — and tells you where the answer came from.</p></details>
    <details><summary>"Has anything changed in the last hour?"</summary>
      <p>A monitor re-reads the advisory every fifteen minutes and pushes changes to Raahi.
      "Nothing has changed — that still stands" is a real answer, and so is "that changed
      eleven minutes ago".</p></details>
    <details><summary>"Where is EK 305 right now? How busy is Dubai airspace?"</summary>
      <p>Live transponder data — altitude, speed, climbing or descending — and a live count
      of everything flying within a hundred miles of the airport.</p></details>
    <details><summary>"My flight's delayed five hours — what am I owed?"</summary>
      <p>Compensation, rebooking, hotels, delayed baggage — and which desk to walk to.</p></details>
  </div>

  <div class="card">
    <h2>Why this is hard</h2><div class="hr"></div>
    <ul class="why">
      <li><b>Reads the page that changes, live.</b> The Emirates travel advisory, scraped to
        text the moment you ask — not a stale database.</li>
      <li><b>Understands prose, not keywords.</b> A restriction that keys off your origin, a
        21-day exemption hiding in a subordinate clause, an "effective from" date that is not
        an end date.</li>
      <li><b>Knows when the world changed.</b> Semantic change detection pushes advisory
        updates within fifteen minutes.</li>
      <li><b>Sees real aircraft.</b> Live ADS-B transponder data, spoken plainly.</li>
      <li><b>Never bluffs.</b> Every answer carries its source — live stated as fact, cached
        as "as of the last update", unverified as "I could not confirm this". It will not
        soften that under pressure.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Demo booking references</h2><div class="hr"></div>
    <div class="pnr-row">
      <div class="pnr"><code>K7X2M9</code><span>Kampala → London</span></div>
      <div class="pnr"><code>P3L8QK</code><span>Mumbai → London</span></div>
      <div class="pnr"><code>T4B9RD</code><span>Dubai → Beirut</span></div>
    </div>
    <p class="note">Bookings are demo data. Everything Raahi checks about them — restrictions,
      transit rules, entry paperwork, aircraft position, weather — is live.</p>
  </div>

  <div class="talk-cue">
    <strong>Tap the microphone and just talk</strong>
    <span>English, العربية, Français, 中文 or हिन्दी — Raahi follows your language.</span>
  </div>`;

const AR_CONTENT = `
  <div class="card" dir="rtl" lang="ar">
    <h2>اسأل راحي</h2><div class="hr"></div>
    <details open><summary>"رقم حجزي K7X2M9 — هل أغادر إلى المطار؟"</summary>
      <p>رمز حجز واحد يُطلق خمسة فحوصات حية في آنٍ واحد — قواعد العبور، وتعطّل الوجهة،
      وأوراق الدخول، وموقع الطائرة الفعلي، وطقس دبي — ويعود بقرار واحد في نحو ثانيتين.</p></details>
    <details><summary>"هل أستطيع العبور عبر دبي من كمبالا إلى لندن؟"</summary>
      <p>كثير من القيود تعتمد على المكان الذي كنت فيه، لا على وجهتك. يفحص راحي طرفي الرحلة
      معاً في نشرة طيران الإمارات المباشرة.</p></details>
    <details><summary>"ماذا أحتاج لدخول بريطانيا؟ ولنيجيريا؟"</summary>
      <p>متطلبات الاتحاد الأوروبي وبريطانيا من النشرة المباشرة ومن gov.uk وeuropa.eu.
      ولأي وجهة أخرى يبحث راحي في المصادر الرسمية فقط — ويخبرك من أين جاءت الإجابة.</p></details>
    <details><summary>"هل تغيّر شيء خلال الساعة الماضية؟"</summary>
      <p>نظام مراقبة يعيد قراءة النشرة كل خمس عشرة دقيقة ويدفع التغييرات إلى راحي فوراً.
      "لم يتغيّر شيء — الكلام ما زال قائماً" إجابة حقيقية، وكذلك "تغيّر قبل إحدى عشرة دقيقة".</p></details>
    <details><summary>"أين الرحلة EK 305 الآن؟ وما مدى ازدحام أجواء دبي؟"</summary>
      <p>بيانات حية من أجهزة إرسال الطائرات: الارتفاع والسرعة والصعود أو الهبوط — وعدد
      مباشر لكل ما يطير حول المطار.</p></details>
    <details><summary>"تأخرت رحلتي خمس ساعات — ما هي حقوقي؟"</summary>
      <p>التعويض وإعادة الحجز والفنادق والأمتعة المتأخرة — وأي مكتب تقصده.</p></details>
  </div>

  <div class="card" dir="rtl" lang="ar">
    <h2>لماذا هذا صعب</h2><div class="hr"></div>
    <ul class="why">
      <li><b>يقرأ الصفحة التي تتغيّر، مباشرةً.</b> نشرة سفر طيران الإمارات لحظة سؤالك،
        لا قاعدة بيانات قديمة.</li>
      <li><b>يفهم النصوص لا الكلمات المفتاحية.</b> قيد يعتمد على نقطة انطلاقك، واستثناء
        الواحد والعشرين يوماً المختبئ في جملة فرعية.</li>
      <li><b>يعرف متى تغيّر العالم.</b> رصد دلالي للتغييرات يصل إلى راحي خلال دقائق.</li>
      <li><b>يرى طائرات حقيقية.</b> بيانات حية تُقال بوضوح.</li>
      <li><b>لا يخمّن أبداً.</b> كل إجابة تحمل مصدرها، وما لم يتأكد منه يقول: "لم أستطع
        التأكد — راجع طيران الإمارات".</li>
    </ul>
  </div>

  <div class="card" dir="rtl" lang="ar">
    <h2>أرقام حجوزات تجريبية</h2><div class="hr"></div>
    <div class="pnr-row">
      <div class="pnr"><code>K7X2M9</code><span>كمبالا ← لندن</span></div>
      <div class="pnr"><code>P3L8QK</code><span>مومباي ← لندن</span></div>
      <div class="pnr"><code>T4B9RD</code><span>دبي ← بيروت</span></div>
    </div>
    <p class="note">الحجوزات بيانات تجريبية — وكل ما يفحصه راحي عنها مباشر وحي.</p>
  </div>

  <div class="talk-cue" dir="rtl" lang="ar">
    <strong>اضغط على الميكروفون وتحدّث</strong>
    <span>بالعربية أو الإنجليزية — راحي يتبع لغتك.</span>
  </div>`;

const FR_CONTENT = `
  <div class="card" lang="fr">
    <h2>Demandez à Raahi</h2><div class="hr"></div>
    <details open><summary>« Ma référence de réservation est K7X2M9 — dois-je partir pour l'aéroport ? »</summary>
      <p>Une seule référence déclenche cinq vérifications en direct simultanées — règles de
      transit, perturbations à destination, formalités d'entrée, position réelle de l'avion et
      météo à Dubaï — et revient avec une décision en deux secondes environ.</p></details>
    <details><summary>« Puis-je faire escale à Dubaï entre Kampala et Londres ? »</summary>
      <p>Les restrictions dépendent souvent des pays où vous <i>avez séjourné</i>, pas de votre
      destination. Raahi vérifie les deux extrémités du voyage dans l'avis Emirates en direct.</p></details>
    <details><summary>« Que me faut-il pour entrer au Royaume-Uni ? Et pour le Nigeria ? »</summary>
      <p>Pour l'UE et le Royaume-Uni, l'avis en direct plus gov.uk et europa.eu. Ailleurs, Raahi
      ne consulte que des sources officielles — et vous dit d'où vient la réponse.</p></details>
    <details><summary>« Quelque chose a-t-il changé dans la dernière heure ? »</summary>
      <p>Un moniteur relit l'avis toutes les quinze minutes et transmet les changements à Raahi.
      « Rien n'a changé » est une vraie réponse, tout comme « cela a changé il y a onze minutes ».</p></details>
    <details><summary>« Où est le vol EK 305 en ce moment ? »</summary>
      <p>Données transpondeur en direct — altitude, vitesse, montée ou descente — et le nombre
      d'appareils en vol autour de l'aéroport.</p></details>
    <details><summary>« Mon vol a cinq heures de retard — à quoi ai-je droit ? »</summary>
      <p>Indemnisation, réacheminement, hôtel, bagages retardés — et à quel comptoir vous adresser.</p></details>
  </div>

  <div class="card brain" lang="fr">
    <h2>L'intelligence derrière Raahi</h2>
    <ul class="why">
      <li><b>Lit en direct la page qui change.</b> L'avis de voyage Emirates, au moment où vous posez la question.</li>
      <li><b>Comprend la prose, pas les mots-clés.</b> Une restriction liée à votre origine, une
        exemption de vingt-et-un jours cachée dans une subordonnée.</li>
      <li><b>Sait quand le monde a changé.</b> Détection sémantique des changements en quinze minutes.</li>
      <li><b>Voit de vrais avions.</b> Données ADS-B en direct, dites simplement.</li>
      <li><b>Ne bluffe jamais.</b> Chaque réponse porte sa source ; ce qu'il n'a pu vérifier, il le dit.</li>
    </ul>
  </div>

  <div class="card" lang="fr">
    <h2>Références de démonstration</h2><div class="hr"></div>
    <div class="pnr-row">
      <div class="pnr"><code>K7X2M9</code><span>Kampala → Londres</span></div>
      <div class="pnr"><code>P3L8QK</code><span>Mumbai → Londres</span></div>
      <div class="pnr"><code>T4B9RD</code><span>Dubaï → Beyrouth</span></div>
    </div>
    <p class="note">Réservations fictives — tout ce que Raahi vérifie à leur sujet est en direct.</p>
  </div>

  <div class="talk-cue" lang="fr">
    <strong>Touchez le micro et parlez</strong>
    <span>En français — Raahi suit votre langue.</span>
  </div>`;

const ZH_CONTENT = `
  <div class="card" lang="zh">
    <h2>问问 Raahi</h2><div class="hr"></div>
    <details open><summary>“我的订座编号是 K7X2M9——我该出发去机场吗？”</summary>
      <p>一个订座编号同时触发五项实时查询：中转规定、目的地中断情况、入境手续、飞机的实际位置，
      以及迪拜天气，约两秒内返回一个明确结论。</p></details>
    <details><summary>“我能从坎帕拉经迪拜转机到伦敦吗？”</summary>
      <p>限制往往取决于您<i>去过</i>哪里，而不是您要去哪里。Raahi 会在实时的阿联酋航空公告中
      同时核查行程两端。</p></details>
    <details><summary>“进入英国需要什么？尼日利亚呢？”</summary>
      <p>欧盟与英国的手续来自实时公告，以及 gov.uk 和 europa.eu。其他目的地，Raahi 只检索官方来源，
      并会告诉您答案的出处。</p></details>
    <details><summary>“过去一小时内有变化吗？”</summary>
      <p>监控系统每十五分钟重读公告，并把变化推送给 Raahi。“没有变化”是真实的答复，
      “十一分钟前发生了变化”也是。</p></details>
    <details><summary>“EK 305 现在在哪里？”</summary>
      <p>实时应答机数据——高度、速度、爬升或下降——以及机场周边正在飞行的航班数量。</p></details>
    <details><summary>“我的航班延误五小时——我能获得什么？”</summary>
      <p>赔偿、改签、酒店、行李延误——以及该前往哪个柜台。</p></details>
  </div>

  <div class="card brain" lang="zh">
    <h2>Raahi 背后的能力</h2>
    <ul class="why">
      <li><b>实时读取会变化的页面。</b>在您提问的那一刻抓取阿联酋航空旅行公告。</li>
      <li><b>理解文句，而非关键词。</b>以出发地为准的限制，藏在从句里的二十一天豁免。</li>
      <li><b>知道世界何时改变。</b>语义变更检测在十五分钟内送达。</li>
      <li><b>看得见真实的飞机。</b>实时 ADS-B 数据，用平实的话说出来。</li>
      <li><b>从不虚张声势。</b>每个答复都带有来源；无法确认的，它会明确说明。</li>
    </ul>
  </div>

  <div class="card" lang="zh">
    <h2>演示用订座编号</h2><div class="hr"></div>
    <div class="pnr-row">
      <div class="pnr"><code>K7X2M9</code><span>坎帕拉 → 伦敦</span></div>
      <div class="pnr"><code>P3L8QK</code><span>孟买 → 伦敦</span></div>
      <div class="pnr"><code>T4B9RD</code><span>迪拜 → 贝鲁特</span></div>
    </div>
    <p class="note">订座为演示数据——但 Raahi 对其所做的每一项核查都是实时的。</p>
  </div>

  <div class="talk-cue" lang="zh">
    <strong>点击麦克风，直接说话</strong>
    <span>用中文提问——Raahi 会跟随您的语言。</span>
  </div>`;

router.get('/talk', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#d71921">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<title>RAAHI — flight disruption copilot</title>
<style>${THEME}</style>
</head>
<body>
${HEADER}
  <section class="hero">
    <img class="hero-logo" src="/assets/raahi-logo.png" alt="RAAHI — your way forward">
    <h1>Your flight just changed. <b>Ask Raahi.</b></h1>
    <p>A voice copilot for flight disruptions — live route restrictions, transit rules and
       entry requirements, spoken in seconds.</p>
    <div class="rule"></div>
  </section>

  <main>
    <div class="lang">
      ${LANGS.map(([code, label], i) =>
        `<button id="btn-${code}" class="${i === 0 ? 'on' : ''}" onclick="setLang('${code}')">${label}</button>`
      ).join('')}
    </div>

    <div data-lang="en">${EN_CONTENT}</div>
    <div data-lang="ar">${AR_CONTENT}</div>
    <div data-lang="fr">${FR_CONTENT}</div>
    <div data-lang="zh">${ZH_CONTENT}</div>

    <elevenlabs-convai agent-id="${AGENT_ID}"></elevenlabs-convai>
    <script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
    <script>${TOGGLE_SCRIPT}</script>
  </main>
${FOOTER}
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
<meta name="theme-color" content="#d71921">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<title>Scan to talk to RAAHI</title>
<style>${THEME}
  .scan { flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 34px 20px; text-align: center; }
  .qr { background: #fff; padding: 20px; border: 1px solid var(--line);
        border-top: 3px solid var(--ek-red); border-radius: 3px; margin: 20px 0 16px; }
  .qr img { display: block; width: min(66vw, 400px); height: auto; }
  .url { font-family: ui-monospace, Menlo, monospace; font-size: 0.95rem; color: var(--ek-red-dark); }
</style>
</head>
<body>
${HEADER}
  <div class="scan">
    <img src="/assets/raahi-logo.png" alt="RAAHI" style="width:min(230px,56vw);height:auto;margin-bottom:6px">
    <h1 style="font-weight:300;font-size:1.5rem">Scan to talk to <b style="color:var(--ek-red);font-weight:600">RAAHI</b></h1>
    <p style="color:var(--ink-soft);font-size:0.93rem;max-width:40ch">
      No app needed — just a phone browser and a microphone.<br/>
      <span dir="rtl" lang="ar">لا حاجة لتطبيق — متصفح هاتف وميكروفون فقط</span></p>
    <div class="qr"><img src="${qr}" alt="QR code linking to ${talkUrl}"></div>
    <p class="url">${talkUrl}</p>
  </div>
${FOOTER}
</body>
</html>`);
});

module.exports = router;
