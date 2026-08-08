#!/usr/bin/env node
'use strict';

/**
 * Provision the ElevenLabs Conversational Agent from what is in this repo.
 *
 *   ELEVENLABS_API_KEY=... BACKEND_URL=https://your-app.onrender.com \
 *     node scripts/provision-elevenlabs.js
 *
 * Creates (or updates in place) one webhook tool per file in elevenlabs/tools/,
 * repointed at BACKEND_URL, then creates or updates the agent using the system
 * prompt and first message in elevenlabs/agent-prompt.md.
 *
 * The repo is the source of truth, and the script is idempotent — matching on
 * tool name and agent name — so it can be re-run after any edit. That matters
 * because dashboard clicking is the step most likely to go wrong under time
 * pressure, and because "re-point the tools at the deployed URL" is otherwise
 * nine manual edits, each of which silently breaks the agent if missed.
 *
 * Flags:
 *   --dry-run   print what would be sent, call nothing
 */

const fs = require('fs');
const path = require('path');

require('../src/lib/env').load();

const API = 'https://api.elevenlabs.io/v1';
const ROOT = path.join(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'elevenlabs', 'tools');
const PROMPT_FILE = path.join(ROOT, 'elevenlabs', 'agent-prompt.md');

const AGENT_NAME = process.env.AGENT_NAME || 'RAAHI';
// Names the agent may have carried before. A rename must update the existing
// agent, not quietly create a second one whose tools then drift out of sync.
const PREVIOUS_AGENT_NAMES = ['RAAHI'];
// "Sarah — mature, reassuring, confident". The brief is a stressed caller in a
// noisy terminal; a bright, upbeat voice reads as tone-deaf during a disruption.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const LLM = process.env.AGENT_LLM || 'claude-sonnet-5';

const DRY_RUN = process.argv.includes('--dry-run');
const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
const sharedSecret = (process.env.TOOL_SHARED_SECRET || '').trim();

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!apiKey && !DRY_RUN) die('ELEVENLABS_API_KEY is not set.');
if (!backendUrl) die('BACKEND_URL is not set, e.g. https://irops-copilot-backend.onrender.com');
if (!/^https:\/\//.test(backendUrl)) die(`BACKEND_URL must be https — ElevenLabs will not call ${backendUrl}`);

async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${endpoint} -> ${res.status}\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

/**
 * Pull the system prompt and first message out of agent-prompt.md so the
 * markdown stays the single source of truth — a prompt that drifts from the
 * documented one is worse than no documentation.
 */
function readPrompt() {
  const md = fs.readFileSync(PROMPT_FILE, 'utf8');

  const fenced = md.match(/##\s*System prompt\s*\n+```(?:\w+)?\n([\s\S]*?)\n```/);
  if (!fenced) die('Could not find the fenced system prompt under "## System prompt" in agent-prompt.md');

  const firstMessageBlock = md.match(/\*\*First message:\*\*\s*\n+((?:>.*\n?)+)/);
  if (!firstMessageBlock) die('Could not find the "**First message:**" blockquote in agent-prompt.md');

  const firstMessage = firstMessageBlock[1]
    .split('\n')
    .map((l) => l.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ');

  return { systemPrompt: fenced[1].trim(), firstMessage };
}

function readToolConfigs() {
  const files = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) die(`No tool definitions found in ${TOOLS_DIR}`);

  return files.map((file) => {
    const cfg = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8'));

    // The committed URLs point at whatever host we last used. Authoritative
    // value is BACKEND_URL; keep only the path so a stale host cannot survive.
    const endpointPath = new URL(cfg.api_schema.url).pathname;
    cfg.api_schema.url = `${backendUrl}${endpointPath}`;

    if (sharedSecret) {
      cfg.api_schema.request_headers = {
        ...(cfg.api_schema.request_headers || {}),
        'x-tool-secret': sharedSecret,
      };
    }

    // Our tools return in ~1s, and silence over a phone reads as a dropped
    // call. A quiet keystroke sound fills it without the agent having to say
    // "one moment", which the prompt forbids for good reason.
    cfg.tool_call_sound = cfg.tool_call_sound || 'typing';
    cfg.tool_call_sound_behavior = cfg.tool_call_sound_behavior || 'always';
    // Let a stressed caller cut in even mid-lookup.
    cfg.interruption_mode = cfg.interruption_mode || 'allow';

    return { file, cfg };
  });
}

async function upsertTools(toolConfigs) {
  const existing = DRY_RUN ? { tools: [] } : await api('GET', '/convai/tools');
  const byName = new Map(
    (existing.tools || []).map((t) => [t.tool_config?.name || t.name, t.id || t.tool_id])
  );

  const ids = [];
  for (const { file, cfg } of toolConfigs) {
    const existingId = byName.get(cfg.name);
    if (DRY_RUN) {
      console.log(`  [dry-run] ${existingId ? 'update' : 'create'} ${cfg.name} -> ${cfg.api_schema.url}`);
      ids.push(`dry-run-${cfg.name}`);
      continue;
    }

    const result = existingId
      ? await api('PATCH', `/convai/tools/${existingId}`, { tool_config: cfg })
      : await api('POST', '/convai/tools', { tool_config: cfg });

    const id = result.id || result.tool_id;
    if (!id) throw new Error(`No tool id returned for ${cfg.name}: ${JSON.stringify(result)}`);
    ids.push(id);
    console.log(`  ${existingId ? 'updated' : 'created'}  ${cfg.name.padEnd(20)} ${cfg.api_schema.url}  (${file})`);
  }
  return ids;
}

/**
 * Terms the transcriber must not mangle.
 *
 * A misheard airport is not a cosmetic error: "Kampala" heard as "Campala"
 * fails the alias lookup and the passenger is told there is no restriction.
 * Airline callsigns, IATA codes and the country names carrying live
 * restrictions are all boosted.
 */
const ASR_KEYWORDS = [
  'Emirates', 'Etihad', 'flydubai', 'Qatar Airways',
  'Dubai', 'DXB', 'Heathrow', 'LHR', 'Gatwick', 'JFK',
  'Kampala', 'Uganda', 'Entebbe', 'Juba', 'South Sudan', 'Kinshasa',
  'Democratic Republic of Congo', 'DRC', 'Beirut', 'Mumbai', 'Delhi',
  'Schengen', 'ETA', 'EES', 'eVisa', 'transit', 'layover', 'connection',
  'cancelled', 'delayed', 'rebook', 'boarding pass', 'stopover', 'stranded',
  'Terminal three', 'Concourse', 'Raahi',
  // Arabic — the terms a Gulf caller will actually say.
  'دبي', 'الإمارات', 'أوغندا', 'كمبالا', 'لندن', 'تأشيرة', 'رحلة', 'مطار',
  // French.
  'Dubaï', 'Émirats', 'Ouganda', 'Kampala', 'Londres', 'escale', 'correspondance',
  'vol annulé', 'retard', 'visa', 'aéroport',
  // Chinese (Simplified).
  '迪拜', '阿联酋', '乌干达', '坎帕拉', '伦敦', '转机', '航班', '延误', '取消', '签证', '机场',
];

const MCP_SERVER_NAME = 'RAAHI Flight Tracking';
// Same reasoning as PREVIOUS_AGENT_NAMES: a rename must find and reuse the
// existing server, not leave a second one attached to nothing.
const PREVIOUS_MCP_NAMES = ['IROPS Flight Tracking'];

/**
 * Register (or find) our backend's /mcp endpoint as a native ElevenLabs MCP
 * server. auto_approve_all is a considered choice, not a shortcut: both tools
 * are read-only lookups of public transponder data, and a human-approval gate
 * in the middle of a phone call is an unanswerable question.
 */
async function upsertMcpServer() {
  if (DRY_RUN) {
    console.log(`\n  [dry-run] MCP server "${MCP_SERVER_NAME}" -> ${backendUrl}/mcp`);
    return 'dry-run-mcp';
  }

  // MCP integrations are gated per workspace ("Actions & Integrations" in the
  // dashboard security settings). If the gate is closed, say so loudly and
  // carry on — losing two tracking tools must not block the agent update that
  // carries the prompt and the other twelve tools.
  try {
    const existing = await api('GET', '/convai/mcp-servers');
    const acceptable = [MCP_SERVER_NAME, ...PREVIOUS_MCP_NAMES];
    const match = (existing.mcp_servers || []).find((s) =>
      acceptable.includes(s.config?.name || s.name)
    );
    if (match) {
      const id = match.id || match.mcp_server_id;
      console.log(`\n  found MCP server  ${MCP_SERVER_NAME}  (${id})`);
      return id;
    }

    const created = await api('POST', '/convai/mcp-servers', {
      config: {
        name: MCP_SERVER_NAME,
        url: `${backendUrl}/mcp`,
        transport: 'STREAMABLE_HTTP',
        approval_policy: 'auto_approve_all',
        description:
          'Live ADS-B flight tracking: aircraft position by flight number, and a live snapshot of traffic around an airport.',
        tool_call_sound: 'typing',
        tool_call_sound_behavior: 'always',
        response_timeout_secs: 20,
      },
    });
    const id = created.id || created.mcp_server_id;
    console.log(`\n  created MCP server  ${MCP_SERVER_NAME}  (${id})`);
    return id;
  } catch (err) {
    if (/mcp_servers_disabled|does not have access to MCP/i.test(err.message)) {
      console.log(
        '\n  !! MCP servers are disabled for this workspace.\n' +
          '     Enable them at elevenlabs.io -> Conversational AI -> Settings ->\n' +
          '     MCP servers / Integrations, then re-run this script.\n' +
          '     Continuing without the tracking tools.'
      );
      return null;
    }
    throw err;
  }
}

function buildAgentConfig({ systemPrompt, firstMessage }, toolIds, mcpServerIds) {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: firstMessage,
        language: 'en',
        prompt: {
          prompt: systemPrompt,
          llm: LLM,
          temperature: 0,
          tool_ids: toolIds,
          mcp_server_ids: mcpServerIds,
          built_in_tools: {
            // Let the agent close cleanly once the caller is sorted, rather
            // than idling on an open line until the duration cap.
            end_call: {
              name: 'end_call',
              type: 'system',
              params: { system_tool_type: 'end_call' },
            },
            // Dubai is a transit hub: a large share of stranded passengers are
            // not native English speakers. Detect and switch rather than making
            // a stressed caller fight for words.
            language_detection: {
              name: 'language_detection',
              type: 'system',
              params: { system_tool_type: 'language_detection', only_at_conversation_start: false },
            },
          },
        },
      },
      asr: {
        keywords: ASR_KEYWORDS,
      },
      tts: {
        voice_id: VOICE_ID,
        // multilingual v2, deliberately. flash v2 is English-only, and the
        // API rejects the v2.5 models outright for agents whose default
        // language is English — verified empirically: flash v2.5 and turbo
        // v2.5 both 400, multilingual v2 is the one multilingual model it
        // accepts. It costs some TTS latency versus flash; an agent that can
        // answer a stranded caller in Arabic is worth that in this city.
        model_id: 'eleven_multilingual_v2',
        // Slightly slow and fairly stable: flight numbers and dates have to
        // land first time over a bad line in a loud terminal.
        stability: 0.55,
        similarity_boost: 0.75,
        speed: 0.95,
      },
      // Additional spoken languages. The language_detection built-in switches
      // into these mid-call when the caller speaks them; the prompt tells the
      // agent to stay there once switched. Flight numbers and airport codes
      // remain letter-and-digit in any language — aviation convention.
      language_presets: {
        ar: {
          overrides: {
            agent: {
              language: 'ar',
              first_message:
                'معك راحي، مساعد العمليات لطيران الإمارات. يمكنني التحقق مباشرةً من حالة الرحلات، وتعليق المسارات، وقواعد العبور عبر دبي. ما الذي يحدث في رحلتك؟',
            },
          },
        },
        hi: {
          overrides: {
            agent: {
              language: 'hi',
              first_message:
                'मैं राही हूँ, एमिरेट्स ऑपरेशन्स सहायक। मैं उड़ानों की स्थिति, रूट निलंबन और दुबई ट्रांज़िट नियम तुरंत जाँच सकता हूँ। आपकी यात्रा में क्या हो रहा है?',
            },
          },
        },
        // Emirates' two largest non-Gulf long-haul markets after the UK and
        // India: Greater China and francophone Europe/Africa.
        zh: {
          overrides: {
            agent: {
              language: 'zh',
              first_message:
                '您好，我是 Raahi，阿联酋航空运营助理。我可以实时查询航班状态、航线暂停以及经迪拜转机的规定。请问您的行程遇到什么问题？',
            },
          },
        },
        fr: {
          overrides: {
            agent: {
              language: 'fr',
              first_message:
                "Bonjour, je suis Raahi, votre copilote des opérations Emirates. Je peux vérifier en direct l'état des vols, les suspensions de lignes et les règles de transit par Dubaï. Que se passe-t-il avec votre voyage ?",
            },
          },
        },
      },
      turn: {
        // Callers pause to read a boarding pass mid-sentence. Cutting in at 3s
        // makes the agent feel like it is talking over them.
        turn_timeout: 7,
        // Stressed callers read hesitation as the system being broken, and our
        // tools return in about a second, so lean forward.
        turn_eagerness: 'eager',
      },
      conversation: {
        max_duration_seconds: 600,
      },
    },
    platform_settings: {
      // Native guardrails, evaluated by ElevenLabs outside the LLM — they hold
      // even if a jailbreak gets past the prompt. `focus` is the out-of-scope
      // enforcement; `medical_and_legal_information` stays OFF deliberately,
      // because entry requirements and visa rules ARE legal information and
      // that filter would block the product's core job.
      guardrails: {
        version: '1',
        focus: { is_enabled: true },
        prompt_injection: { is_enabled: true },
        content: {
          // Blocking, because the retry action demands it — and retry is the
          // only acceptable action here. The alternative, end_call, hangs up
          // on a stressed passenger for tripping a filter. The evaluator is a
          // fast small model; the latency is worth not dropping calls.
          execution_mode: 'blocking',
          config: {
            sexual: { is_enabled: true, threshold: 0.3 },
            violence: { is_enabled: true, threshold: 0.3 },
            harassment: { is_enabled: true, threshold: 0.3 },
            self_harm: { is_enabled: true, threshold: 0.3 },
            profanity: { is_enabled: true, threshold: 0.5 },
            religion_or_politics: { is_enabled: true, threshold: 0.3 },
          },
          trigger_action: { type: 'retry' },
        },
        custom: {
          config: {
            configs: [
              {
                name: 'sensitive-data',
                prompt:
                  'Block any reply that asks for, confirms, or repeats sensitive personal or financial data: full payment card numbers, CVV codes, passwords, one-time passcodes, bank account or IBAN numbers, or full passport numbers. A booking reference and a flight number are the only identifiers this assistant ever needs. Replies that tell the caller NOT to share such data are allowed.',
                is_enabled: true,
                execution_mode: 'blocking',
                history_message_count: 1,
                trigger_action: { type: 'retry' },
              },
              {
                name: 'border-evasion',
                prompt:
                  'Block any reply that helps evade immigration or border controls, conceal recent travel history from authorities, falsify or alter travel documents, or smuggle goods or people. Explaining published entry rules, restrictions and exemptions is allowed and is the assistant\'s job.',
                is_enabled: true,
                execution_mode: 'blocking',
                history_message_count: 1,
                trigger_action: { type: 'retry' },
              },
            ],
          },
        },
      },
      // Scored automatically on every call, so demo failures are measurable
      // rather than anecdotal.
      evaluation_criteria: [
        {
          identifier: 'answered_not_stalled',
          name: 'answered_not_stalled',
          conversation_goal_prompt:
            'Did the agent actually answer the caller\'s question, rather than saying it would check and then handing the turn back without an answer? Failure if the agent ever said it was checking, waiting, or asked the caller to hold, and did not deliver the answer in that same turn.',
        },
        {
          identifier: 'sourced_honestly',
          name: 'sourced_honestly',
          conversation_goal_prompt:
            'Did the agent avoid presenting static or searched information as live fact? Failure if it claimed real-time knowledge of a gate, delay or cancellation, or stated a searched result as official Emirates policy without attributing it.',
        },
        {
          identifier: 'gave_next_action',
          name: 'gave_next_action',
          conversation_goal_prompt:
            'Did the agent give the caller a concrete next action (which desk, what to ask for, what to do now) rather than only describing the problem?',
        },
      ],
      data_collection: {
        flight_number: {
          type: 'string',
          description: 'The flight number the caller mentioned, e.g. EK17. Empty if none.',
        },
        journey: {
          type: 'string',
          description: 'The caller\'s route as origin to destination, e.g. Kampala to London via Dubai.',
        },
        blocked: {
          type: 'boolean',
          description: 'True if the agent told the caller their travel was restricted, suspended or blocked.',
        },
      },
    },
  };
}

async function upsertAgent(agentConfig) {
  if (DRY_RUN) {
    console.log(`\n  [dry-run] agent "${agentConfig.name}" with ${agentConfig.conversation_config.agent.prompt.tool_ids.length} tools`);
    console.log(`  [dry-run] voice=${VOICE_ID} llm=${LLM}`);
    console.log(`  [dry-run] first message: ${agentConfig.conversation_config.agent.first_message}`);
    return null;
  }

  const existing = await api('GET', '/convai/agents');
  const acceptable = [agentConfig.name, ...PREVIOUS_AGENT_NAMES];
  const match = (existing.agents || []).find((a) => acceptable.includes(a.name));

  if (match) {
    const id = match.agent_id || match.id;
    await api('PATCH', `/convai/agents/${id}`, agentConfig);
    console.log(`\n  updated agent  ${agentConfig.name}  (${id})`);
    return id;
  }

  const created = await api('POST', '/convai/agents/create', agentConfig);
  const id = created.agent_id || created.id;
  console.log(`\n  created agent  ${agentConfig.name}  (${id})`);
  return id;
}

async function main() {
  console.log(`\n  Backend: ${backendUrl}`);
  console.log(`  Shared secret: ${sharedSecret ? 'set — sending x-tool-secret' : 'not set'}\n`);

  const prompt = readPrompt();
  const toolConfigs = readToolConfigs();
  console.log(`  ${toolConfigs.length} tool definitions\n`);

  const toolIds = await upsertTools(toolConfigs);
  const mcpServerId = await upsertMcpServer();
  const mcpServerIds = mcpServerId ? [mcpServerId] : [];
  const agentId = await upsertAgent(buildAgentConfig(prompt, toolIds, mcpServerIds));

  if (agentId) {
    console.log(`\n  Talk to it: https://elevenlabs.io/app/conversational-ai/agents/${agentId}\n`);
  }
}

main().catch((err) => {
  console.error(`\n  Provisioning failed.\n\n${err.message}\n`);
  process.exit(1);
});
