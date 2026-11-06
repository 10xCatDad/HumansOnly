CREATE TABLE `result_shares` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`uploaded_at` integer,
	`uploading_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_shares_share_id_unique` ON `result_shares` (`share_id`);