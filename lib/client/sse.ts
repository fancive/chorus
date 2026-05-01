"use client";

import { getOrCreateBrowserToken } from "./identity";

export interface SseTurnHandlers {
  onEvent: (event: unknown) => void;
  onAccept?: () => void;
  onClose?: () => void;
  onError?: (err: unknown, phase: "pre" | "stream") => void;
}

export async function postTurn(
  sessionId: string,
  body: { userMessage?: string; regenerate?: boolean },
  handlers: SseTurnHandlers,
  signal: AbortSignal,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`/api/room/${sessionId}/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-chorus-token": getOrCreateBrowserToken(),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (!signal.aborted) handlers.onError?.(err, "pre");
    handlers.onClose?.();
    return;
  }
  if (!resp.ok || !resp.body) {
    handlers.onError?.(new Error(`turn failed: ${resp.status}`), "pre");
    handlers.onClose?.();
    return;
  }
  handlers.onAccept?.();
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
            handlers.onError?.(err, "stream");
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      handlers.onError?.(err, "stream");
    }
  } finally {
    handlers.onClose?.();
  }
}
