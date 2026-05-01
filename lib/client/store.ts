"use client";

import { create } from "zustand";
import type { Mode } from "@/lib/scheduler/modes";

export interface RoomMessage {
  id: string;
  actor: "user" | "host" | "role";
  actorRoleIndex: number | null;
  /** Server-truth content (everything received so far). */
  content: string;
  /** How many chars of `content` we've actually painted to the user. */
  displayedLen: number;
  status: "streaming" | "completed" | "interrupted";
  revision: number;
}

export interface RoomMeta {
  id: string;
  mode: Mode;
  topic: string | null;
  roles: { name: string; initials: string; color: string }[];
  status: string;
}

interface RoomState {
  meta: RoomMeta | null;
  messages: RoomMessage[];
  statusBarHint: string;
  awaiting: "user" | "ai" | "ended";
  ended: boolean;

  init: (meta: RoomMeta, messages: RoomMessage[]) => void;
  applyEvent: (event: SseEvent) => void;
  appendUserMessage: (id: string, content: string) => void;
  removeMessage: (id: string) => void;
  markStreamingInterrupted: () => void;
  setEnded: () => void;
  /**
   * Advance per-message paced rendering by `dt` ms, at `charsPerSec`.
   * Pass Infinity for "instant".
   */
  tickPace: (dtMs: number, charsPerSec: number) => void;
}

type SseEvent =
  | { type: "schedule"; nextSpeaker: string; statusBarHint: string }
  | {
      type: "message_start";
      messageId: string;
      actor: "host" | "role";
      actorRoleIndex: number | null;
    }
  | { type: "delta"; messageId: string; revision: number; text: string }
  | { type: "message_end"; messageId: string; status: "completed" | "interrupted" }
  | { type: "await_user" }
  | { type: "error"; message: string };

export const useRoomStore = create<RoomState>((set) => ({
  meta: null,
  messages: [],
  statusBarHint: "",
  awaiting: "user",
  ended: false,

  init: (meta, messages) => {
    const ended = meta.status === "ended";
    // Existing messages from the server are already complete; show them in full.
    const initial = messages.map((m) => ({
      ...m,
      displayedLen: m.content.length,
    }));
    set({
      meta,
      messages: initial,
      statusBarHint: "",
      awaiting: ended ? "ended" : "user",
      ended,
    });
  },
  appendUserMessage: (id, content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          actor: "user",
          actorRoleIndex: null,
          content,
          displayedLen: content.length,
          status: "completed",
          revision: 1,
        },
      ],
      awaiting: "ai",
    })),
  removeMessage: (id) =>
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
  markStreamingInterrupted: () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.status === "streaming" ? { ...m, status: "interrupted" as const } : m,
      ),
      awaiting: "ai",
    })),
  setEnded: () => set({ ended: true, awaiting: "ended" }),
  tickPace: (dtMs, charsPerSec) =>
    set((s) => {
      if (!Number.isFinite(charsPerSec)) {
        // Instant mode: snap any lagging messages.
        let dirty = false;
        const next = s.messages.map((m) => {
          if (m.displayedLen >= m.content.length) return m;
          dirty = true;
          return { ...m, displayedLen: m.content.length };
        });
        return dirty ? { messages: next } : s;
      }
      const advance = Math.max(1, Math.round((dtMs * charsPerSec) / 1000));
      let dirty = false;
      const next = s.messages.map((m) => {
        if (m.displayedLen >= m.content.length) return m;
        dirty = true;
        return {
          ...m,
          displayedLen: Math.min(m.content.length, m.displayedLen + advance),
        };
      });
      return dirty ? { messages: next } : s;
    }),
  applyEvent: (event) =>
    set((s) => {
      switch (event.type) {
        case "schedule":
          return { statusBarHint: event.statusBarHint, awaiting: "ai" };
        case "message_start": {
          if (s.messages.some((m) => m.id === event.messageId)) return s;
          return {
            messages: [
              ...s.messages,
              {
                id: event.messageId,
                actor: event.actor,
                actorRoleIndex: event.actorRoleIndex,
                content: "",
                displayedLen: 0,
                status: "streaming",
                revision: 0,
              },
            ],
          };
        }
        case "delta": {
          const idx = s.messages.findIndex((m) => m.id === event.messageId);
          if (idx === -1) return s;
          const m = s.messages[idx];
          if (event.revision <= m.revision) return s;
          const next = [...s.messages];
          next[idx] = {
            ...m,
            content: m.content + event.text,
            revision: event.revision,
          };
          return { messages: next };
        }
        case "message_end": {
          const idx = s.messages.findIndex((m) => m.id === event.messageId);
          if (idx === -1) return { awaiting: "user" };
          const next = [...s.messages];
          // On interrupt: snap displayed to whatever we've already shown — no
          // dribbling out the rest after the user has moved on.
          // On completed: leave displayedLen alone; the pacing tick will catch
          // up at the configured speed.
          const m = next[idx];
          next[idx] =
            event.status === "interrupted"
              ? { ...m, status: event.status, displayedLen: Math.min(m.displayedLen, m.content.length) }
              : { ...m, status: event.status };
          return { messages: next, awaiting: "user" };
        }
        case "await_user":
          return { awaiting: "user" };
        case "error":
          return { awaiting: "user", statusBarHint: `错误：${event.message}` };
      }
    }),
}));
