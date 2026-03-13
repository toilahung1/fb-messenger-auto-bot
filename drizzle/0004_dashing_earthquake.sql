ALTER TABLE `campaigns` ADD `mode` enum('inbox_scan','manual') DEFAULT 'inbox_scan' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `maxSendCount` int DEFAULT 0 NOT NULL;