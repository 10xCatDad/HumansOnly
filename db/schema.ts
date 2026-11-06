import { integer, sqliteTable, text, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  grantExpiresAt: integer("grant_expires_at").notNull().default(0),
});
export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  prompt: text("prompt").notNull(),
  state: text("state").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  submittedAt: integer("submitted_at"),
  finishedAt: integer("finished_at"),
  taskId: text("task_id"),
  nextPollAt: integer("next_poll_at").notNull().default(0),
  wordCount: integer("word_count"),
  providerVersion: text("provider_version"),
  checkDetails: text("check_details"),
  validationStartedAt: integer("validation_started_at"),
  validationLease: text("validation_lease"),
  outcome: text("outcome"),
  reportedHuman: integer("reported_human").notNull().default(0),
  reportedSource: text("reported_source"),
  policyVersion: text("policy_version").notNull(),
}, (t) => [index("challenge_session_idx").on(t.sessionId), index("challenge_created_idx").on(t.createdAt)]);
export const rateBuckets = sqliteTable("rate_buckets", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
});

export const demoBudget = sqliteTable("demo_budget", {
  id: text("id").primaryKey(),
  limitCents: integer("limit_cents").notNull(),
  priorReservedCents: integer("prior_reserved_cents").notNull(),
  priorAttempts: integer("prior_attempts"),
  createdAt: integer("created_at").notNull(),
}, t => [check("budget_cannot_exceed_five_dollars", sql`${t.limitCents} BETWEEN 0 AND 500`), check("prior_cost_nonnegative", sql`${t.priorReservedCents} >= 0`)]);

export const demoReservations = sqliteTable("demo_reservations", {
  challengeId: text("challenge_id").primaryKey(),
  budgetId: text("budget_id").notNull(),
  sessionId: text("session_id").notNull(),
  networkKey: text("network_key").notNull(),
  costCents: integer("cost_cents").notNull(),
  createdAt: integer("created_at").notNull(),
}, t => [index("reservation_browser_idx").on(t.budgetId, t.sessionId), index("reservation_network_idx").on(t.budgetId, t.networkKey), check("fixed_scan_reservation", sql`${t.costCents} = 15`)]);

export const demoResults = sqliteTable("demo_results", {
  challengeId: text("challenge_id").primaryKey(),
  demoId: text("demo_id").notNull(),
  outcome: text("outcome").notNull(),
}, t => [index("demo_result_outcome_idx").on(t.demoId, t.outcome), check("valid_demo_result", sql`${t.outcome} IN ('passed', 'rejected', 'error')`)]);

export const resultShares = sqliteTable("result_shares", {
  challengeId: text("challenge_id").primaryKey(),
  imageVersion: integer("image_version").notNull().default(2),
  shareId: text("share_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  uploadedAt: integer("uploaded_at"),
  uploadingUntil: integer("uploading_until").notNull().default(0),
});

export const attemptResets = sqliteTable("attempt_resets", {
  id: text("id").primaryKey(),
  completedAt: integer("completed_at"),
});
