import { DEMO_ID, SCAN_RESERVATION_CENTS } from "./budget.ts";

export async function captureCompletedResults(db: D1Database) {
  // Run before telemetry cleanup. Each challenge contributes once, including
  // completed checks from before this feature was deployed.
  await db.prepare(`INSERT INTO demo_results (challenge_id, demo_id, outcome)
    SELECT id, ?, state FROM challenges
    WHERE submitted_at IS NOT NULL AND state IN ('passed', 'rejected', 'error')
    ON CONFLICT(challenge_id) DO NOTHING`).bind(DEMO_ID).run();
}

export async function overallStats(db: D1Database) {
  const row = await db.prepare(`SELECT
    prior_reserved_cents / ? + (SELECT COUNT(*) FROM demo_reservations WHERE budget_id = ?) AS attempts,
    (SELECT COUNT(*) FROM demo_results WHERE demo_id = ? AND outcome = 'passed') AS passed,
    (SELECT COUNT(*) FROM demo_results WHERE demo_id = ? AND outcome = 'rejected') AS failed,
    (SELECT COUNT(*) FROM demo_results WHERE demo_id = ? AND outcome = 'error') AS errors
    FROM demo_budget WHERE id = ?`)
    .bind(SCAN_RESERVATION_CENTS, DEMO_ID, DEMO_ID, DEMO_ID, DEMO_ID, DEMO_ID)
    .first<{ attempts: number; passed: number; failed: number; errors: number }>();
  if (!row) throw new Error("Missing demo budget");
  return { ...row, unfinished: Math.max(0, row.attempts - row.passed - row.failed - row.errors) };
}
