CREATE TABLE IF NOT EXISTS `freshness_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`scale_id` text NOT NULL,
	`dish_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`closed_at` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freshness_closed` ON `freshness_batches` (`closed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `freshness_active_scale` ON `freshness_batches` (`scale_id`) WHERE "freshness_batches"."status" = 'active';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `freshness_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `freshness_rules` (
	`dish_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
