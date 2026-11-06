CREATE TABLE `demo_results` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`demo_id` text NOT NULL,
	`outcome` text NOT NULL,
	CONSTRAINT "valid_demo_result" CHECK("demo_results"."outcome" IN ('passed', 'rejected', 'error'))
);
--> statement-breakpoint
CREATE INDEX `demo_result_outcome_idx` ON `demo_results` (`demo_id`,`outcome`);