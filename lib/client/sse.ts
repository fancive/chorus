"use client";

export interface SseTurnHandlers {
  onEvent: (event: unknown) => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}

export async function postTurn(
  sessionId: string,
  body: { userMessage?: string },
  handlers: SseTurnHandlers,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetch(`/api/room/${sessionId}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    handlers.onError?.(new Error(`turn failed: ${resp.status}`));
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = chunk
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (dataLine) {
          try {
            handlers.onEvent(JSON.parse(dataLine.slice(6)));
          } catch (err) {
            handlers.onError?.(err);
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      handlers.onError?.(err);
    }
  } finally {
    handlers.onClose?.();
  }
}
