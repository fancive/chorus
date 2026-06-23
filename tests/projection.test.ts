import { describe, expect, it } from "vitest";
import {
  projectForHostScheduler,
  projectForHostSpeaker,
  projectForRoleSpeaker,
  projectForSummary,
  SCHEDULER_WINDOW,
  SPEAKER_WINDOW,
} from "@/lib/transcript/projection";
import type { Message } from "@/lib/db/schema";
import type { ResolvedRole } from "@/lib/prompts/role-builder";

function msg(partial: Partial<Message> & Pick<Message, "actor" | "content">): Message {
  return {
    id: "m" + Math.random().toString(36).slice(2),
    sessionId: "s1",
    actorRoleIndex: null,
    status: "completed",
    revision: 1,
    seq: 0,
    metaJson: null,
    createdAt: new Date(0),
    ...partial,
  } as Message;
}

const roles: ResolvedRole[] = [
  { name: "苏格拉底", initials: "S", color: "#000", systemPrompt: "SOC", talkativeness: 50 },
  { name: "牛顿", initials: "N", color: "#111", systemPrompt: "NEW", talkativeness: 50 },
];

const base = { hostIdentity: "HOST", roles };

describe("projectForHostScheduler", () => {
  it("keeps the ' [被用户打断]' suffix on interrupted lines", () => {
    const history = [msg({ actor: "role", actorRoleIndex: 0, content: "半句话", status: "interrupted" })];
    const out = projectForHostScheduler({ ...base, history });
    expect(out[1].content).toContain("[被用户打断]");
  });

  it("skips empty-content messages and uses the host identity as system", () => {
    const history = [
      msg({ actor: "user", content: "   " }),
      msg({ actor: "role", actorRoleIndex: 0, content: "有内容" }),
    ];
    const out = projectForHostScheduler({ ...base, history });
    expect(out[0]).toEqual({ role: "system", content: "HOST" });
    expect(out[1].content).toContain("有内容");
    expect(out[1].content).not.toContain("   ");
  });

  it("windows the transcript to the last SCHEDULER_WINDOW messages", () => {
    const history = Array.from({ length: SCHEDULER_WINDOW + 10 }, (_, i) =>
      msg({ actor: "user", content: `u${i}` }),
    );
    const out = projectForHostScheduler({ ...base, history });
    // The earliest message (u0) must have been dropped by the window.
    expect(out[1].content).not.toContain("u0\n");
    expect(out[1].content).toContain(`u${SCHEDULER_WINDOW + 9}`);
  });
});

describe("projectForSummary", () => {
  it("strips the interrupted meta suffix (hideInterruptedMeta=true)", () => {
    const history = [msg({ actor: "role", actorRoleIndex: 0, content: "半句话", status: "interrupted" })];
    const out = projectForSummary({ ...base, history });
    expect(out[1].content).not.toContain("[被用户打断]");
    expect(out[1].content).toContain("半句话");
  });

  it("keeps the FULL history (no window)", () => {
    const history = Array.from({ length: SPEAKER_WINDOW + 20 }, (_, i) =>
      msg({ actor: "user", content: `u${i}` }),
    );
    const out = projectForSummary({ ...base, history });
    expect(out[1].content).toContain("u0");
    expect(out[1].content).toContain(`u${SPEAKER_WINDOW + 19}`);
  });
});

describe("projectForRoleSpeaker", () => {
  it("maps the self role's lines to assistant and others to labeled user", () => {
    const history = [
      msg({ actor: "user", content: "你好" }),
      msg({ actor: "role", actorRoleIndex: 0, content: "我是苏格拉底" }),
      msg({ actor: "role", actorRoleIndex: 1, content: "我是牛顿" }),
      msg({ actor: "host", content: "主持人插话" }),
    ];
    const out = projectForRoleSpeaker({ ...base, history }, 0);
    expect(out[0]).toEqual({ role: "system", content: "SOC" });
    const selfLine = out.find((m) => m.role === "assistant");
    expect(selfLine?.content).toBe("我是苏格拉底");
    expect(out.some((m) => m.content === "[牛顿] 我是牛顿")).toBe(true);
    expect(out.some((m) => m.content === "[用户] 你好")).toBe(true);
    expect(out.some((m) => m.content === "[主持人] 主持人插话")).toBe(true);
  });

  it("throws on an out-of-range role index", () => {
    expect(() => projectForRoleSpeaker({ ...base, history: [] }, 9)).toThrow();
  });
});

describe("projectForHostSpeaker", () => {
  it("maps host lines to assistant and the rest to labeled user", () => {
    const history = [
      msg({ actor: "host", content: "开场" }),
      msg({ actor: "user", content: "用户说" }),
      msg({ actor: "role", actorRoleIndex: 1, content: "牛顿说" }),
    ];
    const out = projectForHostSpeaker({ ...base, history });
    expect(out.find((m) => m.role === "assistant")?.content).toBe("开场");
    expect(out.some((m) => m.content === "[用户] 用户说")).toBe(true);
    expect(out.some((m) => m.content === "[牛顿] 牛顿说")).toBe(true);
  });
});
