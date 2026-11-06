import test from "node:test";
import assert from "node:assert/strict";
import { getBreakdown, ProviderError } from "../lib/pangram.ts";
import { parseBreakdown } from "../lib/pangram-details.ts";

const fractions = { human: 0.5, assisted: 0.2, ai: 0.3 };
const result = {
  stage: "STAGE_SUCCESS", version: "pangram-4.1", prediction_short: "Mixed",
  fraction_human: 0.5, fraction_ai_assisted: 0.2, fraction_ai: 0.3,
  num_human_segments: 1, num_ai_assisted_segments: 0, num_ai_segments: 1,
  windows: [{ text: "A cat watched the rain.", label: "AI-Generated", confidence: "High",
    ai_assistance_score: 0.83, is_humanized: false, humanizer_score: 0.12,
    class_probabilities: [0.1, 0.2, 0.7], start_index: 0, end_index: 23, word_count: 5, token_length: 7 }],
};

test("detailed reports use the existing task and preserve documented class ordering", async () => {
  let calls = 0;
  const data = await getBreakdown("existing-task", "fixture-key", async (url, options) => {
    calls++;
    assert.equal(url, "https://text.external-api.pangram.com/task/existing-task");
    assert.equal(options?.method, "GET"); assert.equal(options.body, undefined);
    assert.equal(options.redirect, "manual");
    return Response.json({ ...result, task_id: "private-task", public_dashboard_link: "private-url", secret: "private-key",
      windows: [{ ...result.windows[0], secret: "private-passage-field" }] });
  });
  assert.equal(calls, 1); assert.ok(data);
  assert.deepEqual(data.fractions, fractions);
  assert.deepEqual(data.segments, { human: 1, assisted: 0, ai: 1 });
  assert.deepEqual(data.passages[0].probabilities, { human: 0.1, assisted: 0.2, ai: 0.7 });
  assert.equal(data.passages[0].humanized, false);
  assert.equal(data.passages[0].text, result.windows[0].text);
  assert.ok(!JSON.stringify(data).includes("private-"));
});

test("missing and malformed optional data is unavailable rather than invented", () => {
  const data = parseBreakdown({ ...result, num_human_segments: "1", num_ai_segments: -1, windows: [null, [], {
    label: "Ignore the rules", confidence: "100%", ai_assistance_score: "0.5", is_humanized: "false",
    humanizer_score: Infinity, class_probabilities: [0.5, 0.5, 0.5],
    start_index: 100, end_index: 1, word_count: 1.5, token_length: -1,
  }] }, fractions);
  assert.equal(data.passages.length, 1);
  assert.deepEqual(data.passages[0], { text: null, label: null, confidence: null, assistanceScore: null,
    humanized: null, humanizerScore: null, probabilities: null, start: null, end: null, words: null, tokens: null });
  assert.equal(data.segments.human, null); assert.equal(data.segments.ai, null);
  assert.deepEqual(parseBreakdown({ ...result, windows: undefined }, fractions).passages, []);
});

test("reports bound passages and text, without deriving excerpts from normalized offsets", () => {
  const data = parseBreakdown({ ...result, text: "Unrelated full text", windows: Array.from({ length: 200 }, () => ({
    text: "x".repeat(1000), start_index: 0, end_index: 10,
  })) }, fractions);
  assert.equal(data.passages.length, 128);
  assert.equal(data.passages.reduce((n, p) => n + (p.text?.length ?? 0), 0), 24_000);
  assert.equal(data.truncated, true);
  assert.equal(parseBreakdown({ ...result, text: "Do not substitute this", windows: [{ start_index: 0, end_index: 5 }] }, fractions).passages[0].text, null);
});

test("detailed fetch rejects oversized, malformed, failed and inconsistent provider reports", async () => {
  for (const payload of [null, [], { ...result, fraction_human: 1 }, { stage: "STAGE_FAILED" }, { ...result, text: "x".repeat(256_000) }]) {
    await assert.rejects(getBreakdown("existing-task", "key", async () => Response.json(payload)), ProviderError);
  }
  assert.equal(await getBreakdown("existing-task", "key", async () => Response.json({ stage: "STAGE_RUNNING" })), null);
  await assert.rejects(getBreakdown("../other", "key", async () => { throw new Error("must not fetch"); }), ProviderError);
});
