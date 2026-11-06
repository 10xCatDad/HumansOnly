import { overallStats } from "./stats.ts";

const ERROR_REASONS = {
  provider_unavailable: "The AI detection service could not complete the request or could not be reached.",
  provider_configuration: "The AI detection service rejected its credentials or account configuration.",
  provider_billing: "The AI detection service reported a billing or credit problem.",
  provider_invalid_response: "The AI detection service returned an unexpected response.",
  validation_unavailable: "The story validation worker could not complete its check.",
  validation_timeout: "The combined verification did not finish within five minutes.",
  unknown: "No recognized error reason was retained for this check.",
} as const;
type ErrorCode = keyof typeof ERROR_REASONS;
export type ServiceDiagnostics = {
  checkedAt: number;
  totalErrors: number;
  detailsUnavailable: number;
  services: { browserConfigured: boolean; detectorConfigured: boolean; validatorOnline: boolean; detectorPausedUntil: number | null };
  errors: { code: ErrorCode; description: string; count: number; lastSeen: number | null }[];
};

// The keyboard shortcut is a UI easter egg, not authorization. Everything in
// this response must be safe to publish. Never return raw errors or user rows.
export async function serviceDiagnostics(db: D1Database, now: number, configuration: { browserConfigured: boolean; detectorConfigured: boolean }): Promise<ServiceDiagnostics> {
  const [overall, rows, heartbeat, cooldown] = await Promise.all([
    overallStats(db),
    db.prepare("SELECT outcome, COUNT(*) AS count, MAX(finished_at) AS last_seen FROM challenges WHERE state = 'error' AND submitted_at IS NOT NULL GROUP BY outcome").all<{ outcome: string | null; count: number; last_seen: number | null }>(),
    db.prepare("SELECT expires_at FROM rate_buckets WHERE id = 'validator-heartbeat' AND expires_at > ?").bind(now).first<{ expires_at: number }>(),
    db.prepare("SELECT expires_at FROM rate_buckets WHERE id = 'provider-cooldown' AND expires_at > ?").bind(now).first<{ expires_at: number }>(),
  ]);
  const groups = new Map<ErrorCode, ServiceDiagnostics["errors"][number]>();
  for (const row of rows.results) {
    const code: ErrorCode = row.outcome && Object.hasOwn(ERROR_REASONS, row.outcome) ? row.outcome as ErrorCode : "unknown";
    const group = groups.get(code) || { code, description: ERROR_REASONS[code], count: 0, lastSeen: null };
    group.count += row.count;
    if (row.last_seen !== null) group.lastSeen = Math.max(group.lastSeen ?? 0, row.last_seen);
    groups.set(code, group);
  }
  const errors = [...groups.values()].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.code.localeCompare(b.code));
  return {
    checkedAt: now,
    totalErrors: overall.errors,
    detailsUnavailable: Math.max(0, overall.errors - errors.reduce((sum, item) => sum + item.count, 0)),
    services: { ...configuration, validatorOnline: !!heartbeat, detectorPausedUntil: cooldown?.expires_at ?? null },
    errors,
  };
}
