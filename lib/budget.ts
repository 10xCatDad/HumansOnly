// Pangram's published realtime price on 2026-11-06: $0.05 per 100 words.
// Every admitted request reserves three whole blocks, including failures.
export const DEMO_ID = "initial-public-demo";
export const BUDGET_CENTS = 500;
export const SCAN_RESERVATION_CENTS = 15;
export const ATTEMPT_LIMIT = 3;
export const PANGRAM_MODEL = "pangram-4.1";
export const MAX_BILLING_WORDS = 300;

// Count ASCII letter/digit runs and every other non-whitespace character.
// This deliberately overcounts punctuation, non-Latin prose, and emoji, so
// whitespace tricks and giant symbol blocks cannot evade the paid input cap.
export function billingWordBound(text: string) {
  return (text.normalize("NFKC").match(/[A-Za-z0-9]+|[^\s]/gu) ?? []).length;
}

export async function initializeBudget(db: D1Database, now: number) {
  // Include all old submitted checks, including ambiguous provider failures.
  // This seed runs once. It is never derived again after telemetry cleanup.
  await db.prepare(`INSERT INTO demo_budget (id, limit_cents, prior_reserved_cents, created_at)
    SELECT ?, ?, COUNT(*) * ?, ? FROM challenges WHERE submitted_at IS NOT NULL
    ON CONFLICT(id) DO NOTHING`).bind(DEMO_ID, BUDGET_CENTS, SCAN_RESERVATION_CENTS, now).run();
}

export async function budgetState(db: D1Database, sessionId?: string, network?: string) {
  const row = await db.prepare(`SELECT limit_cents, prior_reserved_cents,
    (SELECT COALESCE(SUM(cost_cents), 0) FROM demo_reservations WHERE budget_id = ?) AS new_reserved_cents,
    (SELECT COUNT(*) FROM demo_reservations WHERE budget_id = ? AND session_id = ?) AS browser_attempts,
    (SELECT COUNT(*) FROM demo_reservations WHERE budget_id = ? AND network_key = ?) AS network_attempts
    FROM demo_budget WHERE id = ?`).bind(DEMO_ID, DEMO_ID, sessionId ?? "", DEMO_ID, network ?? "", DEMO_ID).first<{
      limit_cents: number; prior_reserved_cents: number; new_reserved_cents: number; browser_attempts: number; network_attempts: number;
    }>();
  if (!row) throw new Error("Missing demo budget");
  const reservedCents = row.prior_reserved_cents + row.new_reserved_cents;
  return { limitCents: row.limit_cents, reservedCents, remainingCents: Math.max(0, row.limit_cents - reservedCents),
    attemptsRemaining: Math.max(0, ATTEMPT_LIMIT - Math.max(row.browser_attempts, row.network_attempts)) };
}

export async function reserveScan(db: D1Database, challengeId: string, sessionId: string, network: string, now: number) {
  // A single SQLite write evaluates every limit and inserts the reservation.
  // Competing writers cannot both spend the same remaining balance or attempt.
  // The unique challenge key also prevents duplicate reservations after retries.
  return db.prepare(`INSERT INTO demo_reservations (challenge_id, budget_id, session_id, network_key, cost_cents, created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE
      EXISTS (SELECT 1 FROM demo_budget WHERE id = ? AND limit_cents - prior_reserved_cents >=
        ? + (SELECT COALESCE(SUM(cost_cents), 0) FROM demo_reservations WHERE budget_id = ?))
      AND (SELECT COUNT(*) FROM demo_reservations WHERE budget_id = ? AND session_id = ?) < ?
      AND (SELECT COUNT(*) FROM demo_reservations WHERE budget_id = ? AND network_key = ?) < ?
    ON CONFLICT(challenge_id) DO NOTHING RETURNING challenge_id`)
    .bind(challengeId, DEMO_ID, sessionId, network, SCAN_RESERVATION_CENTS, now,
      DEMO_ID, SCAN_RESERVATION_CENTS, DEMO_ID, DEMO_ID, sessionId, ATTEMPT_LIMIT,
      DEMO_ID, network, ATTEMPT_LIMIT).first();
}
