export const TURNSTILE_ACTION = "writing_prompt";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_KEY = /^[123]x0+[A-Z]{2}$/;
export type TurnstileEnv = { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string };
export function turnstileReady(env: TurnstileEnv) {
  // Public test keys must never accidentally enable the production gate.
  return !!env.TURNSTILE_SITE_KEY?.trim() && !!env.TURNSTILE_SECRET_KEY?.trim()
    && !TEST_KEY.test(env.TURNSTILE_SITE_KEY.trim()) && !TEST_KEY.test(env.TURNSTILE_SECRET_KEY.trim());
}
export class TurnstileUnavailable extends Error {}
export async function verifyTurnstile(token: unknown, secret: string, hostname: string, remoteip?: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (typeof token !== "string" || !token.trim() || token.length > 2048) return false;
  let response: Response;
  try {
    response = await fetcher(VERIFY_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(remoteip ? { remoteip } : {}) }),
      redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new TurnstileUnavailable(); }
  if (!response.ok) throw new TurnstileUnavailable();
  let result: { success?: unknown; hostname?: unknown; action?: unknown; "error-codes"?: unknown };
  try { result = await response.json(); } catch { throw new TurnstileUnavailable(); }
  if (!result || typeof result !== "object") throw new TurnstileUnavailable();
  if (Array.isArray(result["error-codes"]) && result["error-codes"].some(code => ["internal-error", "invalid-input-secret", "missing-input-secret"].includes(code))) throw new TurnstileUnavailable();
  return result.success === true && result.hostname === hostname && result.action === TURNSTILE_ACTION;
}
