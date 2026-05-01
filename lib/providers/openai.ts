import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type {
  ChorusProvider,
  GenerateJsonArgs,
  GenerateJsonResult,
  ProviderCapabilities,
  StreamTextArgs,
  TokenDelta,
  TokenUsage,
} from "./types";

export class OpenAIProvider implements ChorusProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(opts: { apiKey: string; model: string; baseURL?: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
  }

  capabilities(): ProviderCapabilities {
    return {
      structuredOutput: "native",
      streaming: true,
      maxContext: 128_000,
    };
  }

  private extraBody(): Record<string, unknown> {
    // Doubao seed/thinking models default to thinking-on, which burns 2-9s of latency
    // even on trivial scheduler/structured calls. Disable for all our use cases.
    if (/^doubao-seed-/i.test(this.model)) {
      return { thinking: { type: "disabled" } };
    }
    return {};
  }

  async generateJson<TSchema extends z.ZodTypeAny>(
    args: GenerateJsonArgs<TSchema>,
  ): Promise<GenerateJsonResult<z.infer<TSchema>>> {
    const attempt = async (extraNote: string | null) => {
      const messages = extraNote
        ? [...args.messages, { role: "system" as const, content: extraNote }]
        : args.messages;
      const completion = await this.client.beta.chat.completions.parse(
        {
          model: this.model,
          messages,
          response_format: zodResponseFormat(args.schema, args.schemaName),
          temperature: args.purpose === "scheduler" ? 0 : 0.4,
          ...(this.extraBody() as Record<string, never>),
        },
        { signal: args.abortSignal },
      );
      const parsed = completion.choices[0]?.message.parsed ?? null;
      const usage: TokenUsage | undefined = completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
          }
        : undefined;
      return { parsed, usage };
    };

    try {
      const first = await attempt(null);
      if (first.parsed) return { data: first.parsed, usage: first.usage };
    } catch (err) {
      if (args.abortSignal?.aborted) throw err;
      // fall through to one retry with stricter instruction
    }
    const retry = await attempt(
      `严格按照名为 ${args.schemaName} 的 JSON Schema 输出，仅输出合法 JSON 对象，不要任何解释。`,
    );
    if (!retry.parsed) {
      throw new Error(`OpenAI returned no parsed payload for ${args.schemaName}`);
    }
    return { data: retry.parsed, usage: retry.usage };
  }

  async *streamText(args: StreamTextArgs): AsyncIterable<TokenDelta> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: args.messages,
        stream: true,
        temperature: 0.7,
        stream_options: { include_usage: true },
        ...(this.extraBody() as Record<string, never>),
      },
      { signal: args.abortSignal },
    );
    let lastUsage: TokenUsage | undefined;
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (chunk.usage) {
        lastUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
      }
      if (text) yield { text };
    }
    if (lastUsage) yield { text: "", usage: lastUsage };
  }
}
