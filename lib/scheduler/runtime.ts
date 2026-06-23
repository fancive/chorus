// In-memory active generation registry. Single-instance Node assumption (tech-plan §1).
// Allows mid-stream abort across HTTP boundary: turn route stores AbortController here,
// next turn route looks it up to abort.

interface ActiveGeneration {
  id: string;
  sessionId: string;
  abort: AbortController;
  messageId: string | null;
  startedAt: number;
}

const active = new Map<string, ActiveGeneration>();
const turnLocks = new Map<string, string>();

export function tryAcquireTurnLock(sessionId: string, token: string): boolean {
  if (turnLocks.has(sessionId)) return false;
  turnLocks.set(sessionId, token);
  return true;
}

/** Forcibly hand the lock to a new owner (used when a user message preempts an active turn). */
export function stealTurnLock(sessionId: string, token: string) {
  turnLocks.set(sessionId, token);
}

export function releaseTurnLock(sessionId: string, token: string) {
  if (turnLocks.get(sessionId) === token) turnLocks.delete(sessionId);
}

export function registerGeneration(sessionId: string, generation: Omit<ActiveGeneration, "startedAt">) {
  active.set(sessionId, { ...generation, startedAt: Date.now() });
}

export function abortActiveGeneration(sessionId: string): ActiveGeneration | null {
  const found = active.get(sessionId);
  if (!found) return null;
  try {
    found.abort.abort(new Error("interrupted by user"));
  } catch {
    /* ignore */
  }
  active.delete(sessionId);
  return found;
}

export function clearGeneration(sessionId: string, generationId: string) {
  const found = active.get(sessionId);
  if (found?.id === generationId) active.delete(sessionId);
}

export function isAborted(sessionId: string, generationId: string): boolean {
  const found = active.get(sessionId);
  return !found || found.id !== generationId;
}

/** True when a generation is registered for this session in THIS process. */
export function hasActiveGeneration(sessionId: string): boolean {
  return active.has(sessionId);
}
