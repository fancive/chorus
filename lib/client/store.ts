"use client";

import { create } from "zustand";

export interface RoomMessage {
  id: string;
  actor: "user" | "host" | "role";
  content: string;
  status: "streaming" | "completed" | "interrupted";
  revision: number;
}

export interface RoomMeta {
  id: string;
  mode: "interview" | "dialogue" | "coach";
  topic: string | null;
  role: { name: string; initials: string; color: string };
  status: string;
}

interface RoomState {
  meta: RoomMeta | null;
  messages: RoomMessage[];
  statusBarHint: string;
  inputLocked: boolean;
  awaiting: "user" | "ai" | "ended";
  ended: boolean;

  init: (meta: RoomMeta, messages: RoomMessage[]) => void;
  applyEvent: (event: SseEvent) => void;
  appendUserMessage: (id: string, content: string) => void;
  setEnded: () => void;
  setInputLocked: (v: boolean) => void;
}

type SseEvent =
  | { type: "schedule"; nextSpeaker: "host" | "role" | "await_user"; statusBarHint: string }
  | { type: "message_start"; messageId: string; actor: "host" | "role" }
  | { type: "delta"; messageId: string; revision: number; text: string }
  | { type: "message_end"; messageId: string; status: "completed" | "interrupted" }
  | { type: "await_user" }
  | { type: "error"; message: string };

export const useRoomStore = create<RoomState>((set) => ({
  meta: null,
  messages: [],
  statusBarHint: "",
  inputLocked: false,
  awaiting: "user",
  ended: false,

  init: (meta, messages) => set({ meta, messages, awaiting: "user" }),
  appendUserMessage: (id, content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id, actor: "user", content, status: "completed", revision: 1 },
      ],
      awaiting: "ai",
    })),
  setInputLocked: (v) => set({ inputLocked: v }),
  setEnded: () => set({ ended: true, awaiting: "ended" }),
  applyEvent: (event) =>
    set((s) => {
      switch (event.type) {
        case "schedule":
          return { statusBarHint: event.statusBarHint };
        case "message_start": {
          if (s.messages.some((m) => m.id === event.messageId)) return s;
          return {
            messages: [
              ...s.messages,
              {
                id: event.messageId,
                actor: event.actor,
                content: "",
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
          next[idx] = { ...next[idx], status: event.status };
          return { messages: next, awaiting: "user" };
        }
        case "await_user":
          return { awaiting: "user" };
        case "error":
          return { awaiting: "user", statusBarHint: `错误：${event.message}` };
      }
    }),
}));
