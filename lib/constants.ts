// Limits shared by both server routes and the client UI. Keep this module
// isomorphic (no server-only imports) — it is imported from React components.

/** Max length of a single user message (textarea cap + server validation). */
export const MAX_USER_MESSAGE_LEN = 4000;

/** Idle-host ping: how long the user can be silent before the host breaks it. */
export const IDLE_PING_MS = 12_000;

/**
 * Hard per-session ceiling on AI turns. Backstops cost: an abandoned tab's
 * idle-ping loop, or a hostile client, cannot run a session indefinitely.
 */
export const MAX_SESSION_MESSAGES = 200;

/** Hard per-session ceiling on cumulative LLM tokens (prompt + completion). */
export const MAX_SESSION_TOKENS = 500_000;
