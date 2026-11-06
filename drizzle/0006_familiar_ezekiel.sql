CREATE TABLE `attempt_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
ALTER TABLE `demo_budget` ADD `prior_attempts` integer;