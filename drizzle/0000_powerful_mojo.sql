CREATE TABLE `finance_records` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`imported_at` text NOT NULL,
	`as_of` text NOT NULL,
	`transaction_count` integer NOT NULL,
	`account_count` integer NOT NULL
);
