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
