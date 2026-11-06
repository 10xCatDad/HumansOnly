import { billingWordBound, MAX_BILLING_WORDS } from "./budget.ts";
export const POLICY_VERSION = "writing-turnstile-v4";
export const MIN_WORDS = 200;
export const MAX_WORDS = 250;
export const CHALLENGE_MS = 30 * 60_000;
export const ACCESS_MS = 60 * 60_000;
const settings = [
  "A coastal village in 1920", "A lunar settlement in 2080", "A city library in 1995", "A mountain inn in 1880",
  "An overnight train in 2026", "A floating market in 2150", "A small-town cinema in 1965", "A remote radio station in 1978",
  "A desert research camp in 2040", "A crowded bakery in 1910", "A city rooftop garden in 2035", "A seaside observatory in 1955",
];
const characters = [
  "Two estranged siblings caring for their mother's cat", "A retired teacher and an apprentice cook who share a stray cat",
  "A caretaker, a visitor using a false name, and the resident cat", "Two feuding neighbors whose cats have become inseparable",
  "A young inventor and a skeptical grandparent trying to entertain a bored cat", "A musician, their former best friend, and a missing cat",
  "A newcomer and the oldest resident looking after a colony of stray cats", "A courier and a cat owner awaiting a long-lost letter",
  "A parent and their adult child disagreeing over an adopted cat", "Two strangers who recognize the same cat in a photograph",
  "A repairer, an impatient customer, and a cat asleep inside the broken object", "A storyteller and a cat sitter who knows the truth",
];
const conflicts = [
  "A promise must be kept before sunset, but keeping it means admitting a mistake.",
  "A lost keepsake turns up, and both characters believe it belongs to them.",
  "A planned celebration goes wrong, forcing the characters to work together.",
  "One character wants to leave; the other needs them to stay for one more day.",
  "An important message arrives too late, and the characters must decide what to do.",
  "The characters must choose between saving a familiar place and accepting a useful change.",
  "A harmless lie becomes difficult to maintain when an unexpected guest appears.",
  "A broken object reveals a secret that changes how the characters see each other.",
  "The characters are blamed for a mistake neither admits making.",
  "A sudden storm traps the characters together while an unresolved disagreement resurfaces.",
  "One character offers an apology that the other is not ready to accept.",
  "A valuable opportunity can go to only one character, and they must decide who gets it.",
];
function pick<T>(items: T[]): T {
  const n = new Uint32Array(1), ceiling = Math.floor(2 ** 32 / items.length) * items.length;
  do { crypto.getRandomValues(n); } while (n[0] >= ceiling);
  return items[n[0] % items.length];
}
export type StoryPrompt = { setting: string; characters: string; conflict: string };
export function createPrompt(): StoryPrompt { return { setting: pick(settings), characters: pick(characters), conflict: pick(conflicts) }; }
export function wordsIn(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}
export function inspectWriting(text: string, _prompt?: StoryPrompt) {
  const words = wordsIn(text), billingSafe = billingWordBound(text) <= MAX_BILLING_WORDS;
  return { count: words.length, billingSafe, valid: words.length >= MIN_WORDS && words.length <= MAX_WORDS && billingSafe };
}
