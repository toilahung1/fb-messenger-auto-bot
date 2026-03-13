CREATE TABLE `schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`campaignId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`hour` int NOT NULL,
	`minute` int NOT NULL DEFAULT 0,
	`repeatType` enum('once','daily','weekdays','weekends') NOT NULL DEFAULT 'once',
	`runDate` timestamp,
	`safetyLevel` enum('low','medium','high','extreme') NOT NULL DEFAULT 'medium',
	`isActive` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`runCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`)
);
