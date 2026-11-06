import { readFile, writeFile, mkdir } from "node:fs/promises";
import { submitText, getResult } from "../lib/pangram.ts";
import { wordsIn } from "../lib/challenge.ts";
const path = process.argv.find(v => v.startsWith('--input='))?.slice(8);
const limit = Number(process.argv.find(v => v.startsWith('--max-checks='))?.slice(13) || 3);
if (!path || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Usage: npm run study:detector -- --input=/absolute/corpus.jsonl --max-checks=3. This makes paid Pangram calls.');
const key = process.env.PANGRAM_API_KEY;
if (!key) throw new Error('Set PANGRAM_API_KEY locally.');
const rows = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { id: string; label: 'human' | 'bot'; text: string });
if (rows.length > limit) throw new Error(`Dataset contains ${rows.length} rows, exceeding the explicit ${limit}-check budget.`);
if (rows.some(r => typeof r.id !== 'string' || !['human', 'bot'].includes(r.label) || typeof r.text !== 'string' || wordsIn(r.text).length < 200 || wordsIn(r.text).length > 250)) throw new Error('Every row needs an id, independently established human/bot label, and 200–250 words of text.');
const results: {id:string;label:string;status:string;version?:string;elapsedMs:number}[] = [];
for (const row of rows) {
  const started = Date.now();
  try {
    const id = await submitText(row.text, key, process.env.PANGRAM_MODEL || 'pangram-4');
    let result: Awaited<ReturnType<typeof getResult>> = {status:'pending'};
    while (result.status === 'pending' && Date.now()-started < 300_000) { await new Promise(r=>setTimeout(r,2000)); result = await getResult(id,key); }
    results.push({id:row.id,label:row.label,...result,elapsedMs:Date.now()-started});
  } catch { results.push({id:row.id,label:row.label,status:'error',elapsedMs:Date.now()-started}); }
  console.log(JSON.stringify({id:row.id,status:results.at(-1)?.status}));
  // Persist partial results after each paid call so interruption does not lose completed work.
  await mkdir('outputs',{recursive:true});
  await writeFile('outputs/detector-evaluation.json',JSON.stringify({createdAt:new Date().toISOString(),results,scope:'Detector-only evaluation; does not measure the full gate or verify dataset labels.'},null,2)+'\n');
}
for (const label of ['human','bot']) {
  const cohort=results.filter(r=>r.label===label && ['passed','rejected'].includes(r.status));
  console.log(JSON.stringify({label,completed:cohort.length,errors:results.filter(r=>r.label===label&&r.status==='error').length,passRate:cohort.length?cohort.filter(r=>r.status==='passed').length/cohort.length:null}));
}
