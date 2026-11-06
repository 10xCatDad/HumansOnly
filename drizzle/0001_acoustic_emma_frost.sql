CREATE TABLE `demo_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`limit_cents` integer NOT NULL,
	`prior_reserved_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "budget_cannot_exceed_five_dollars" CHECK("demo_budget"."limit_cents" BETWEEN 0 AND 500),
	CONSTRAINT "prior_cost_nonnegative" CHECK("demo_budget"."prior_reserved_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `demo_reservations` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`session_id` text NOT NULL,
	`network_key` text NOT NULL,
	`cost_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "fixed_scan_reservation" CHECK("demo_reservations"."cost_cents" = 15)
);
--> statement-breakpoint
CREATE INDEX `reservation_browser_idx` ON `demo_reservations` (`budget_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `reservation_network_idx` ON `demo_reservations` (`budget_id`,`network_key`);--> statement-breakpoint
ALTER TABLE `challenges` ADD `reported_source` text;