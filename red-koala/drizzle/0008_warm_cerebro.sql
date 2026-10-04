CREATE TABLE IF NOT EXISTS `intelligence_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text,
	`lease_until` text NOT NULL
);
