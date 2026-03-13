CREATE TABLE `bot_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionData` text,
	`isActive` boolean NOT NULL DEFAULT false,
	`lastVerified` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_sessions_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`messageTemplate` text NOT NULL,
	`status` enum('draft','running','paused','completed','failed') NOT NULL DEFAULT 'draft',
	`delayBetweenMessages` int NOT NULL DEFAULT 3000,
	`maxRetries` int NOT NULL DEFAULT 3,
	`totalRecipients` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`successRate` float DEFAULT 0,
	`csvFileUrl` text,
	`csvFileKey` text,
	`logFileUrl` text,
	`logFileKey` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`recipientId` int NOT NULL,
	`userId` int NOT NULL,
	`recipientName` varchar(255),
	`messageContent` text,
	`status` enum('success','failed','retry') NOT NULL,
	`errorMessage` text,
	`attemptNumber` int NOT NULL DEFAULT 1,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`campaignId` int,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`type` enum('info','success','warning','error') NOT NULL DEFAULT 'info',
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`facebookUid` varchar(128),
	`facebookUrl` text,
	`phone` varchar(32),
	`extraData` json,
	`status` enum('pending','sending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`retryCount` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recipients_id` PRIMARY KEY(`id`)
);
