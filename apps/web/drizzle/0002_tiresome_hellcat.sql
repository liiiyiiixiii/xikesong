CREATE TABLE `preference_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`item_id` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`lease` text NOT NULL,
	`updated_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `preference_models` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`item_id` text NOT NULL,
	`payload` text NOT NULL
);
