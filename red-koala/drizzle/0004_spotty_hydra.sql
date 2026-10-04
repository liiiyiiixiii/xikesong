CREATE TABLE IF NOT EXISTS `history_batches` (
	`dataset_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`checksum` text NOT NULL,
	`dish_key` text NOT NULL,
	`imported_at` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`dataset_id`, `batch_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `history_batch_dish` ON `history_batches` (`dataset_id`,`dish_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `history_control` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
