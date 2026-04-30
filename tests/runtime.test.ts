import { describe, expect, it, beforeEach } from "vitest";
import {
  tryAcquireTurnLock,
  stealTurnLock,
  releaseTurnLock,
  abortActiveGeneration,
  registerGeneration,
  clearGeneration,
  isAborted,
} from "@/lib/scheduler/runtime";

const SID = "sess_test";

describe("turn lock", () => {
  beforeEach(() => {
    // best-effort cleanup; releaseTurnLock with any stale token is a no-op
    releaseTurnLock(SID, "any");
  });

  it("first acquire succeeds, second fails", () => {
    expect(tryAcquireTurnLock(SID, "a")).toBe(true);
    expect(tryAcquireTurnLock(SID, "b")).toBe(false);
    releaseTurnLock(SID, "a");
  });

  it("releaseTurnLock with wrong token is a no-op", () => {
    tryAcquireTurnLock(SID, "owner");
    releaseTurnLock(SID, "intruder");
    expect(tryAcquireTurnLock(SID, "another")).toBe(false);
    releaseTurnLock(SID, "owner");
    expect(tryAcquireTurnLock(SID, "another")).toBe(true);
    releaseTurnLock(SID, "another");
  });

  it("stealTurnLock replaces owner, prior token's release is no-op", () => {
    tryAcquireTurnLock(SID, "first");
    stealTurnLock(SID, "second");
    releaseTurnLock(SID, "first");
    expect(tryAcquireTurnLock(SID, "third")).toBe(false);
    releaseTurnLock(SID, "second");
    expect(tryAcquireTurnLock(SID, "third")).toBe(true);
    releaseTurnLock(SID, "third");
  });
});

describe("active generation registry", () => {
  beforeEach(() => {
    abortActiveGeneration(SID);
  });

  it("registerGeneration + abortActiveGeneration aborts the controller", () => {
    const ctrl = new AbortController();
    registerGeneration(SID, {
      id: "g1",
      sessionId: SID,
      abort: ctrl,
      messageId: "msg_1",
    });
    const found = abortActiveGeneration(SID);
    expect(found?.id).toBe("g1");
    expect(found?.messageId).toBe("msg_1");
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("isAborted returns true when generation cleared or replaced", () => {
    const ctrl = new AbortController();
    registerGeneration(SID, {
      id: "g1",
      sessionId: SID,
      abort: ctrl,
      messageId: null,
    });
    expect(isAborted(SID, "g1")).toBe(false);
    clearGeneration(SID, "g1");
    expect(isAborted(SID, "g1")).toBe(true);
  });
});
