import type { NextSpeakerTag } from "@/lib/prompts/host-scheduler";

/**
 * The single source of truth for the SSE event protocol between the turn route
 * (server) and the room store (client). Type-only module — safe to import from
 * client components (it erases at compile time).
 */
export type SseEvent =
  | { type: "schedule"; nextSpeaker: NextSpeakerTag; statusBarHint: string }
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
