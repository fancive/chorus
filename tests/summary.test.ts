import { describe, expect, it } from "vitest";
import { safeParseSummary } from "@/lib/prompts/host-summary";

describe("safeParseSummary", () => {
  it("returns null on garbage", () => {
    expect(safeParseSummary("not json")).toBeNull();
    expect(safeParseSummary("{}")).toBeNull();
  });

  it("returns null when shape is wrong", () => {
    expect(
      safeParseSummary(
        JSON.stringify({
          recap: "x",
          role_observations: "should-be-array",
          user_highlights: [],
          quotes: [],
          follow_up_topics: [],
        }),
      ),
    ).toBeNull();
  });

  it("parses a valid summary payload", () => {
    const payload = {
      recap: "聊了 X",
      role_observations: ["a"],
      user_highlights: [],
      quotes: [{ speaker: "苏格拉底", text: "你以为你知道" }],
      follow_up_topics: ["下次聊 Y"],
    };
    const got = safeParseSummary(JSON.stringify(payload));
    expect(got).toEqual(payload);
  });
});
