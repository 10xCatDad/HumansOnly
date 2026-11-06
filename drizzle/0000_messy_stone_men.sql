CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`prompt` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`submitted_at` integer,
	`finished_at` integer,
	`task_id` text,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`word_count` integer,
	`provider_version` text,
	`outcome` text,
	`reported_human` integer DEFAULT 0 NOT NULL,
	`policy_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `challenge_session_idx` ON `challenges` (`session_id`);--> statement-breakpoint
CREATE INDEX `challenge_created_idx` ON `challenges` (`created_at`);--> statement-breakpoint
CREATE TABLE `rate_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`grant_expires_at` integer DEFAULT 0 NOT NULL
);
