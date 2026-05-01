import { describe, expect, it, beforeEach } from "vitest";
import { useRoomStore, type RoomMeta, type RoomMessage } from "@/lib/client/store";

const META: RoomMeta = {
  id: "sess_x",
  mode: "dialogue",
  topic: null,
  roles: [{ name: "苏格拉底", initials: "苏", color: "#000" }],
  status: "await_user",
};

function reset() {
  useRoomStore.setState({
    meta: null,
    messages: [],
    statusBarHint: "old",
    awaiting: "ai",
    ended: true,
  });
}

describe("room store init()", () => {
  beforeEach(reset);

  it("resets ended and statusBarHint when reusing a fresh room", () => {
    useRoomStore.getState().init(META, []);
    const s = useRoomStore.getState();
    expect(s.ended).toBe(false);
    expect(s.awaiting).toBe("user");
    expect(s.statusBarHint).toBe("");
    expect(s.messages).toEqual([]);
  });

  it("sets ended=true when meta.status === ended", () => {
    useRoomStore.getState().init({ ...META, status: "ended" }, []);
    const s = useRoomStore.getState();
    expect(s.ended).toBe(true);
    expect(s.awaiting).toBe("ended");
  });
});

describe("room store removeMessage", () => {
  beforeEach(() => {
    reset();
    useRoomStore.getState().init(META, []);
  });

  it("removes only the matching id", () => {
    useRoomStore.getState().appendUserMessage("local_1", "hi");
    useRoomStore.getState().appendUserMessage("local_2", "again");
    useRoomStore.getState().removeMessage("local_1");
    const ids = useRoomStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["local_2"]);
  });
});

describe("room store applyEvent dedup", () => {
  beforeEach(() => {
    reset();
    useRoomStore.getState().init(META, []);
  });

  it("ignores duplicate message_start", () => {
    useRoomStore.getState().applyEvent({
      type: "message_start",
      messageId: "m1",
      actor: "host",
      actorRoleIndex: null,
    });
    useRoomStore.getState().applyEvent({
      type: "message_start",
      messageId: "m1",
      actor: "host",
      actorRoleIndex: null,
    });
    const msgs = useRoomStore.getState().messages as RoomMessage[];
    expect(msgs.filter((m) => m.id === "m1")).toHaveLength(1);
  });

  it("delta with stale revision is ignored", () => {
    useRoomStore.getState().applyEvent({
      type: "message_start",
      messageId: "m2",
      actor: "host",
      actorRoleIndex: null,
    });
    useRoomStore.getState().applyEvent({
      type: "delta",
      messageId: "m2",
      revision: 5,
      text: "abc",
    });
    useRoomStore.getState().applyEvent({
      type: "delta",
      messageId: "m2",
      revision: 3,
      text: "stale",
    });
    const msg = useRoomStore.getState().messages.find((m) => m.id === "m2");
    expect(msg?.content).toBe("abc");
    expect(msg?.revision).toBe(5);
  });
});

describe("room store tickPace × interrupted", () => {
  beforeEach(() => {
    reset();
    useRoomStore.getState().init(META, []);
  });

  function startStreamingMessage(id: string, text: string) {
    const s = useRoomStore.getState();
    s.applyEvent({
      type: "message_start",
      messageId: id,
      actor: "host",
      actorRoleIndex: null,
    });
    s.applyEvent({ type: "delta", messageId: id, revision: 1, text });
  }

  it("advances displayedLen on each tick while streaming", () => {
    startStreamingMessage("m1", "abcdefghij"); // 10 chars
    useRoomStore.getState().tickPace(1000, 5); // 5 chars/sec * 1s = 5
    const m = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    expect(m.displayedLen).toBe(5);
    expect(m.status).toBe("streaming");
  });

  it("freezes displayedLen after markStreamingInterrupted (paced mode)", () => {
    startStreamingMessage("m1", "abcdefghij");
    useRoomStore.getState().tickPace(1000, 5); // displayedLen → 5
    useRoomStore.getState().markStreamingInterrupted();
    const before = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    expect(before.status).toBe("interrupted");
    expect(before.displayedLen).toBe(5);

    // Subsequent ticks must not dribble out the rest.
    useRoomStore.getState().tickPace(1000, 5);
    useRoomStore.getState().tickPace(1000, 5);
    const after = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    expect(after.displayedLen).toBe(5);
  });

  it("freezes displayedLen after markStreamingInterrupted (instant mode)", () => {
    startStreamingMessage("m1", "abcdefghij");
    useRoomStore.getState().tickPace(1000, 5); // displayedLen → 5
    useRoomStore.getState().markStreamingInterrupted();

    // Switching to instant mode after an interrupt must NOT snap to full content.
    useRoomStore.getState().tickPace(50, Infinity);
    const m = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    expect(m.displayedLen).toBe(5);
  });

  it("keeps advancing displayedLen after message_end completed", () => {
    startStreamingMessage("m1", "abcdefghij"); // 10 chars
    useRoomStore.getState().tickPace(600, 5); // displayedLen → 3
    useRoomStore.getState().applyEvent({
      type: "message_end",
      messageId: "m1",
      status: "completed",
    });
    useRoomStore.getState().tickPace(1000, 5); // should advance toward 10
    const m = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    expect(m.status).toBe("completed");
    expect(m.displayedLen).toBe(8);
  });

  it("still advances streaming siblings when one message is interrupted", () => {
    startStreamingMessage("m1", "abcdefghij");
    useRoomStore.getState().tickPace(1000, 5); // m1 → 5
    useRoomStore.getState().markStreamingInterrupted(); // freezes m1

    startStreamingMessage("m2", "xyz123"); // new streaming message
    useRoomStore.getState().tickPace(1000, 5);

    const m1 = useRoomStore.getState().messages.find((x) => x.id === "m1")!;
    const m2 = useRoomStore.getState().messages.find((x) => x.id === "m2")!;
    expect(m1.displayedLen).toBe(5);
    expect(m2.displayedLen).toBe(5);
  });
});
