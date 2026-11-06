import { DEMO_ID } from "./budget.ts";

// Run only after owner authentication. Keep billing reservations while removing
// attempt history and quotas. Every write is gated by the same pending reset,
// so retries cannot erase attempts submitted after the original transaction.
export async function resetAttempts(db: D1Database, resetId: string, now: number): Promise<number | null> {
  const pending = "EXISTS (SELECT 1 FROM attempt_resets WHERE id = ? AND completed_at IS NULL)";
  await db.batch([
    // Wait for paid checks to finish instead of deleting their in-flight jobs.
    db.prepare(`INSERT INTO attempt_resets (id) SELECT ?
      WHERE NOT EXISTS (SELECT 1 FROM challenges WHERE state = 'checking')
      ON CONFLICT(id) DO NOTHING`).bind(resetId),
    db.prepare(`UPDATE demo_budget SET
      prior_reserved_cents = prior_reserved_cents + (SELECT COALESCE(SUM(cost_cents), 0) FROM demo_reservations WHERE budget_id = ?),
      prior_attempts = 0 WHERE id = ? AND ${pending}`).bind(DEMO_ID, DEMO_ID, resetId),
    db.prepare(`DELETE FROM result_shares WHERE ${pending}`).bind(resetId),
    db.prepare(`DELETE FROM challenges WHERE ${pending}`).bind(resetId),
    db.prepare(`DELETE FROM demo_results WHERE demo_id = ? AND ${pending}`).bind(DEMO_ID, resetId),
    db.prepare(`DELETE FROM demo_reservations WHERE budget_id = ? AND ${pending}`).bind(DEMO_ID, resetId),
    db.prepare(`UPDATE sessions SET grant_expires_at = 0 WHERE ${pending}`).bind(resetId),
    db.prepare(`DELETE FROM rate_buckets WHERE id NOT IN ('validator-heartbeat', 'provider-cooldown') AND ${pending}`).bind(resetId),
    db.prepare("UPDATE attempt_resets SET completed_at = ? WHERE id = ? AND completed_at IS NULL").bind(now, resetId),
  ]);
  const row = await db.prepare("SELECT completed_at FROM attempt_resets WHERE id = ?").bind(resetId).first<{ completed_at: number | null }>();
  return row?.completed_at ?? null;
}
