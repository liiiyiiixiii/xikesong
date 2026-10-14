CREATE TABLE `scale_configs` (
	`source` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`source`, `id`)
);
--> statement-breakpoint
CREATE TABLE `scale_credentials` (
	`source` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scale_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`scale_id` text NOT NULL,
	`dish_id` text NOT NULL,
	`at` text NOT NULL,
	`received_at` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scale_events_source_at` ON `scale_events` (`source`,`at`);--> statement-breakpoint
CREATE TABLE `scale_latest` (
	`source` text NOT NULL,
	`scale_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`operation_id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`source`, `scale_id`)
);
--> statement-breakpoint
CREATE TABLE `scale_minutes` (
	`source` text NOT NULL,
	`scale_id` text NOT NULL,
	`dish_id` text NOT NULL,
	`minute` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`source`, `scale_id`, `dish_id`, `minute`)
);
--> statement-breakpoint
CREATE INDEX `scale_minutes_retention` ON `scale_minutes` (`minute`);--> statement-breakpoint
CREATE TABLE `scale_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`scale_id` text NOT NULL,
	`sampled_at` text NOT NULL,
	`received_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scale_samples_retention` ON `scale_samples` (`received_at`);--> statement-breakpoint
CREATE TABLE `scale_settings` (
	`source` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`item_id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`lease` text NOT NULL,
	`updated_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `weight_models` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`item_id` text NOT NULL,
	`payload` text NOT NULL
);
