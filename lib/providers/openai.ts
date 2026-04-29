import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type {
  ChorusProvider,
  GenerateJsonArgs,
  ProviderCapabilities,
  StreamTextArgs,
  TokenDelta,
} from "./types";

export class OpenAIProvider implements ChorusProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(opts: { apiKey: string; model: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  capabilities(): ProviderCapabilities {
    return {
      structuredOutput: "native",
      streaming: true,
      maxContext: 128_000,
    };
  }

  async generateJson<TSchema extends z.ZodTypeAny>(
    args: GenerateJsonArgs<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const completion = await this.client.beta.chat.completions.parse(
      {
        model: this.model,
        messages: args.messages,
        response_format: zodResponseFormat(args.schema, args.schemaName),
        temperature: args.purpose === "scheduler" ? 0 : 0.4,
      },
      { signal: args.abortSignal },
    );
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      throw new Error(`OpenAI returned no parsed payload for ${args.schemaName}`);
    }
    return parsed;
  }

  async *streamText(args: StreamTextArgs): AsyncIterable<TokenDelta> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: args.messages,
        stream: true,
        temperature: 0.7,
      },
      { signal: args.abortSignal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { text };
    }
  }
}
