DROP INDEX IF EXISTS `messages_session_seq_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_seq_idx` ON `messages` (`session_id`,`seq`);