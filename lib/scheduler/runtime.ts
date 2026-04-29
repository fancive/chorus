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
