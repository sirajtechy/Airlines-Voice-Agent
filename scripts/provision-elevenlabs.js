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

const AGENT_NAME = process.env.AGENT_NAME || 'IROPS Copilot';
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

function buildAgentConfig({ systemPrompt, firstMessage }, toolIds) {
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
        },
      },
      tts: {
        voice_id: VOICE_ID,
        model_id: 'eleven_flash_v2_5',
        // Slightly slow and fairly stable: flight numbers and dates have to
        // land first time over a bad line in a loud terminal.
        stability: 0.55,
        similarity_boost: 0.75,
        speed: 0.95,
      },
      turn: {
        // Callers pause to read a boarding pass mid-sentence. Cutting in at 3s
        // makes the agent feel like it is talking over them.
        turn_timeout: 7,
      },
      conversation: {
        max_duration_seconds: 600,
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
  const match = (existing.agents || []).find((a) => a.name === agentConfig.name);

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
  const agentId = await upsertAgent(buildAgentConfig(prompt, toolIds));

  if (agentId) {
    console.log(`\n  Talk to it: https://elevenlabs.io/app/conversational-ai/agents/${agentId}\n`);
  }
}

main().catch((err) => {
  console.error(`\n  Provisioning failed.\n\n${err.message}\n`);
  process.exit(1);
});
