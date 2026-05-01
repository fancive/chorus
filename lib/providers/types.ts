import type { z } from "zod";

export type Actor = "user" | "host" | "role";

export interface ChorusMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface ProviderCapabilities {
  structuredOutput: "native" | "tool" | "prompt";
  streaming: boolean;
  maxContext: number;
}

export interface GenerateJsonArgs<TSchema extends z.ZodTypeAny> {
  schema: TSchema;
  schemaName: string;
  purpose: "scheduler" | "summary";
  messages: ChorusMessage[];
  abortSignal?: AbortSignal;
}

export interface StreamTextArgs {
  messages: ChorusMessage[];
  purpose: "speaker";
  abortSignal: AbortSignal;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface TokenDelta {
  text: string;
  /** Set on the final chunk (when the provider supplies it). */
  usage?: TokenUsage;
}

export interface GenerateJsonResult<T> {
  data: T;
  usage?: TokenUsage;
}

export interface ChorusProvider {
  readonly name: string;
  readonly model: string;
  capabilities(): ProviderCapabilities;
  generateJson<TSchema extends z.ZodTypeAny>(
    args: GenerateJsonArgs<TSchema>,
  ): Promise<GenerateJsonResult<z.infer<TSchema>>>;
  streamText(args: StreamTextArgs): AsyncIterable<TokenDelta>;
}

export type ProviderRole = "host" | "role" | "summary";
