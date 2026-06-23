import { logger } from "@/lib/server/logger";

export function sseStream<T>(
  setup: (emit: (event: T) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const ctrl = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: T) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* closed */
        }
      };
      // Heartbeat: a comment frame (":...") every 15s keeps CDNs/proxies from
      // idle-timing-out the connection during scheduler latency and slow first
      // tokens. EventSource and our manual parser both ignore comment lines.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 15_000);
      try {
        await setup(emit, ctrl.signal);
      } catch (err) {
        // Last-resort catch for unexpected throws in setup(). Keep the real
        // error server-side; the client only ever sees an opaque code.
        logger.error("sse_stream_error", { err });
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "stream_error" })}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
    cancel() {
      ctrl.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
