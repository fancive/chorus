CREATE INDEX `generations_session_idx` ON `generations` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_session_status_idx` ON `messages` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `summaries_session_idx` ON `summaries` (`session_id`);