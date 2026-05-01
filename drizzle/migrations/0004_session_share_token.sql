ALTER TABLE `sessions` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_share_token_idx` ON `sessions` (`share_token`);