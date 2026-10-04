CREATE TABLE IF NOT EXISTS `portrait_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL,
	`analysis` text,
	`status` text NOT NULL,
	`error` text,
	`retry_at` text NOT NULL,
	`lease` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `portrait_archives_source_date` ON `portrait_archives` (`source`,`date`);