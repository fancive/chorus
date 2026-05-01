import { nanoid } from "nanoid";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: Level =
  (process.env.CHORUS_LOG_LEVEL?.toLowerCase() as Level) || "info";

interface LogFields {
  reqId?: string;
  sessionId?: string;
  route?: string;
  method?: string;
  status?: number;
  ms?: number;
  err?: unknown;
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: LogFields) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const record: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  if (fields?.err instanceof Error) {
    record.err = { name: fields.err.name, message: fields.err.message };
  }
  // Single-line JSON: easy to grep, easy to ship to a log collector.
  if (level === "error") console.error(JSON.stringify(record));
  else console.log(JSON.stringify(record));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

export function newReqId(): string {
  return nanoid(10);
}

/**
 * Wrap a Next.js route handler to emit a single structured access-log line
 * and inject a `reqId` field into the surrounding logger context. Returns
 * the original Response unchanged.
 */
export function withRequestLog<Args extends unknown[]>(
  route: string,
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const reqId = newReqId();
    const started = Date.now();
    let status = 0;
    try {
      const resp = await fn(...args);
      status = resp.status;
      return resp;
    } catch (err) {
      logger.error("route_threw", { reqId, route, err });
      throw err;
    } finally {
      const ms = Date.now() - started;
      logger.info("req", { reqId, route, status, ms });
    }
  };
}
