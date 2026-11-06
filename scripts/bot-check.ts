import { writeFile, mkdir } from "node:fs/promises";
import { wordsIn, type StoryPrompt } from "../lib/challenge.ts";
const origin = process.argv.find(v => v.startsWith("--origin="))?.slice(9) || "http://localhost:5188";
const maximum = Number(process.argv.find(v => v.startsWith("--attempts="))?.slice(11) || 3);
if (!Number.isInteger(maximum) || maximum < 1 || maximum > 3) throw new Error("Choose 1–3 attempts. This tool makes real, potentially billable checks.");
let cookie = "";
async function call(path: string, body?: unknown) {
  const r = await fetch(new URL(path, origin), { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: new URL(origin).origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0];
  if (!r.ok) throw new Error(`Gate request ${path.split('?')[0]} failed (${r.status}).`);
  return await r.json() as { challenge: { id: string; prompt: StoryPrompt }; state: string; configured: boolean };
}
function generate(_prompt: StoryPrompt, strategy: number) {
  const base = `I left the cat carrier at the station on a Tuesday. At least, I thought it was Tuesday. That week had become a collection of small errands that never quite got finished. My brother called while I was looking for it, and I almost ignored him. He wanted to talk about the missing cat. I said I would call back, which was the sort of thing I kept saying without ever doing it. The woman behind the desk noticed me walking past for the third time and asked if I needed help. I described what I had lost. She listened carefully, then reached under the counter and produced something completely different. We both laughed. For a moment I stopped worrying about the time. Outside, a delivery driver was trying to balance three boxes while opening a heavy door. I went over and held it for him. When I came back, my missing thing was waiting on a chair. Someone had left a note beside it. The handwriting was my brother's. I sat down, called him, and this time I stayed on the phone until neither of us had anything else to say.`;
  let story = base;
  if (strategy === 1) story = base.replace('I left', 'Okay, so I left').replace('She listened carefully,', '"Let me look," she said,').replace('We both laughed.', '"Not mine," I said. "But thanks."');
  if (strategy === 2) story = base.replaceAll('I thought', 'I figured').replace('That week had become a collection of small errands that never quite got finished.', 'Nothing got done that week. Seriously. I kept getting sidetracked.').replace('For a moment I stopped worrying about the time.', 'I forgot the time for a bit.');
  if (wordsIn(story).length < 180 || wordsIn(story).length > 240) throw new Error('Baseline generator produced an invalid word count.');
  return story;
}
const trials: unknown[] = [];
console.log('Running a bounded template-based bot baseline. This is not a frontier-model red team.');
for (let attempt = 0; attempt < maximum; attempt++) {
  const { challenge, configured } = await call('/api/challenge', {});
  if (!configured) throw new Error('Live Pangram verification is not configured.');
  const text = generate(challenge.prompt, attempt), started = Date.now();
  await call('/api/submit', { challengeId: challenge.id, text });
  let state = 'checking';
  while (state === 'checking' && Date.now() - started < 330_000) {
    await new Promise(r => setTimeout(r, 2500));
    state = (await call(`/api/result?id=${challenge.id}`)).state;
  }
  const trial = { attempt: attempt + 1, strategy: ['plain-template', 'dialogue-variation', 'casual-variation'][attempt], groundTruth: 'bot', state, elapsedMs: Date.now() - started, wordCount: wordsIn(text).length };
  trials.push(trial); console.log(JSON.stringify(trial));
  if (state === 'passed') {
    const room = await fetch(new URL('/api/room', origin), { headers: { cookie }, redirect: 'manual' });
    if (!room.ok) throw new Error('Detector passed, but the gate did not grant access.');
    console.log('Protected endpoint admitted this automated trial.'); break;
  }
  if (state !== 'rejected') break;
}
await mkdir('outputs', { recursive: true });
await writeFile('outputs/bot-baseline.json', JSON.stringify({ generatedAt: new Date().toISOString(), origin, trials, limitation: 'Small adaptive template baseline only. No human cohort or frontier-model attack is measured.' }, null, 2)+'\n');
