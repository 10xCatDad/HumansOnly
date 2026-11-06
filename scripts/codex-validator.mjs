// Private outbound-only worker. No public Codex server, tools, shell, or filesystem access for submitted stories.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { VALIDATOR_INSTRUCTIONS, CONCEPT_SCHEMA, parseConcepts } from '../lib/validation.ts';

export class SubscriptionJudge {
  child; nextId = 1; pending = new Map();
  constructor({ spawnProcess = spawn, fetcher = fetch } = {}) {
    // Only authentication RPCs are called. No thread or agent turn is started.
    const env = Object.fromEntries(['HOME', 'PATH', 'CODEX_HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    this.fetcher = fetcher;
    this.child = spawnProcess(process.env.CODEX_BINARY || 'codex', ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"'], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, env });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line), waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id); clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error('Codex authentication RPC failed'));
        else waiter.resolve(message.result);
      } catch { /* Ignore unrelated native notifications. */ }
    });
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => this.fail());
    this.initialized = this.rpc('initialize', { clientInfo: { name: 'writing_concept_checker', version: '1.0.0' } }).then(() => this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'));
  }
  fail() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex authentication unavailable')); } this.pending.clear(); }
  rpc(method, params) {
    // Never forward model output or visitor requests into Codex agent/tool RPCs.
    if (!['initialize', 'account/read'].includes(method)) return Promise.reject(new Error('Only authentication RPCs are permitted'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex authentication timeout')); }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async credentials(force = false) {
    await this.initialized;
    const { account } = await this.rpc('account/read', { refreshToken: force });
    if (account?.type !== 'chatgpt') throw new Error('Existing ChatGPT sign-in required');
    let auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'));
    const expiry = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url')).exp;
    if (!force && expiry * 1000 < Date.now() + 120_000) return this.credentials(true);
    if (!auth.tokens?.access_token || !auth.tokens?.account_id) throw new Error('ChatGPT credentials unavailable');
    return auth.tokens;
  }
  async evaluate(prompt, story) {
    if (typeof story !== 'string' || story.length > 8000 || !prompt || typeof prompt !== 'object' || !['setting', 'characters', 'conflict'].every(k => typeof prompt[k] === 'string' && prompt[k].length < 500)) throw new Error('Invalid job input');
    const requirements = Object.fromEntries(['setting', 'characters', 'conflict'].map(key => [key, prompt[key]]));
    const deadline = AbortSignal.timeout(90_000);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = await this.credentials(attempt === 1);
      response = await this.fetcher('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST', redirect: 'error', signal: deadline,
        headers: { authorization: `Bearer ${auth.access_token}`, 'ChatGPT-Account-Id': auth.account_id, 'Content-Type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ model: process.env.VALIDATOR_MODEL || 'gpt-6-luna', instructions: VALIDATOR_INSTRUCTIONS,
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ requirements, story }) }] }],
          tools: [], tool_choice: 'none', store: false, stream: true, reasoning: { effort: 'low' },
          text: { format: { type: 'json_schema', name: 'story_requirements', strict: true, schema: CONCEPT_SCHEMA } } }),
      });
      if (response.status !== 401) break;
      await response.body?.cancel();
    }
    if (!response?.ok || !response.body) throw new Error(`Codex request failed (${response?.status || 'network'})`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', size = 0, output = '', completed = false;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 500_000) throw new Error('Oversized validator response');
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const event = JSON.parse(line.slice(6));
          if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('Codex did not complete');
          if (/function_call|tool_call/.test(event.type || '') || event.item?.type && !['message', 'reasoning'].includes(event.item.type) || event.response?.output?.some(item => !['message', 'reasoning'].includes(item.type))) throw new Error('Tool output is not permitted');
          if (event.type === 'response.output_text.delta') {
            if (typeof event.delta !== 'string') throw new Error('Invalid validator output');
            output += event.delta;
          }
          if (output.length > 2000) throw new Error('Invalid validator output');
          if (event.type === 'response.completed') completed = true;
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!completed) throw new Error('Incomplete validator result');
    return parseConcepts(JSON.parse(output));
  }
  dispose() { this.child.kill(); this.fail(); }
}

export async function boundedJson(response, maxBytes = 262_144) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) throw new Error('Invalid response size');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error('Invalid response size');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const origin = process.env.VALIDATOR_SITE_ORIGIN || 'https://captcha.10xcatdad.xyz';
  if (!/^https:\/\//.test(origin) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('HTTPS origin required');
  if (!process.env.VALIDATOR_TOKEN || !process.env.PANGRAM_API_KEY) throw new Error('Worker credentials missing');
  const judge = new SubscriptionJudge();
  const call = async (path, body = {}) => {
    const response = await fetch(origin + '/api/validator/' + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${process.env.VALIDATOR_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Worker endpoint unavailable');
    return boundedJson(response, 16_384);
  };
  const heartbeat = setInterval(() => judge.credentials().then(() => call('heartbeat')).catch(() => {}), 30_000);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(heartbeat); judge.dispose(); process.exit(0); });
  await judge.credentials();
  console.log('Subscription story validator started. Story text is never logged.');
  while (true) {
    try {
      await judge.credentials();
      const { job } = await call('next');
      if (!job) { await delay(2500); continue; }
      let completion = { id: job.id, lease: job.lease, error: true };
      try {
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(job.taskId)) throw new Error('Invalid task');
        let task;
        for (let i = 0; i < 30; i++) {
          const response = await fetch(`https://text.external-api.pangram.com/task/${job.taskId}`, { headers: { 'x-api-key': process.env.PANGRAM_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(12_000) });
          if (!response.ok) throw new Error('Detector unavailable');
        task = await boundedJson(response);
          if (task.stage === 'STAGE_SUCCESS') break;
          if (task.stage === 'STAGE_FAILED') throw new Error('Detector failed');
          await delay(2000);
        }
        if (task?.stage !== 'STAGE_SUCCESS') throw new Error('Detector timeout');
        const concepts = await judge.evaluate(job.prompt, task.text);
        completion = { id: job.id, lease: job.lease, concepts };
      } catch { console.warn('A check could not complete; returning a service error.'); }
      // Retry delivery only, never repeat model inference after an ambiguous failure.
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await call('complete', completion); break; } catch { await delay(2000); }
      }
    } catch { await delay(10_000); }
  }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) main().catch(() => { console.error('Validator could not start. Check the local sign-in and configuration.'); process.exit(1); });
