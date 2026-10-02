import { describe, expect, test } from "vitest";
import { SessionSpend } from "../src/ui/spend.js";

/** A session log with the usage each assistant message carries. */
const logged = (usages: Array<Record<string, number>>): unknown => ({
  snapshotEvents: () => usages.map((usage) => ({ type: "assistant/message", data: { usage } })),
});

describe("the session's token totals (D3)", () => {
  test("a report is added to the session, and the next call continues it", () => {
    const spend = new SessionSpend({});
    spend.beginCall();
    spend.add({ input: 1_500, output: 320, cacheRead: 34_000 });
    expect(spend.readings).toEqual({ inputTokens: 1_500, outputTokens: 320, cacheRead: 34_000 });
    spend.beginCall();
    spend.add({ input: 1_900, output: 750, cacheRead: 34_000 });
    expect(spend.readings).toEqual({ inputTokens: 3_400, outputTokens: 1_070, cacheRead: 68_000 });
  });

  test("a call that reports as it generates is charged once", () => {
    const spend = new SessionSpend({});
    spend.beginCall();
    spend.add({ input: 40_000, output: 0 });
    spend.add({ input: 40_000, output: 1_200 });
    spend.add({ input: 40_000, output: 5_500 });
    expect(spend.readings).toEqual({ inputTokens: 40_000, outputTokens: 5_500 });
  });

  test("a count that went backwards is a new call, not a smaller one", () => {
    const spend = new SessionSpend({});
    spend.beginCall();
    spend.add({ output: 5_000 });
    // The call boundary was missed, and this report counts a different call: it
    // adds whole rather than nothing.
    spend.add({ output: 120 });
    expect(spend.readings.outputTokens).toBe(5_120);
  });

  test("a count the server never sent stays unknown instead of reading as zero", () => {
    const spend = new SessionSpend({});
    spend.beginCall();
    spend.add({ output: 12 });
    spend.add({});
    expect(spend.readings).toEqual({ inputTokens: undefined, outputTokens: 12, cacheRead: undefined });
  });

  test("a negative or unusable count is not a count", () => {
    const spend = new SessionSpend({});
    spend.beginCall();
    spend.add({ input: -5, output: NaN, cacheRead: Infinity });
    expect(spend.readings).toEqual({ inputTokens: 0, outputTokens: undefined, cacheRead: undefined });
  });

  test("a resumed session opens on what its log already recorded", () => {
    const spend = new SessionSpend(
      logged([{ inputTokens: 5_000, outputTokens: 900, cacheReadTokens: 12_000 }]),
    );
    expect(spend.readings).toEqual({ inputTokens: 5_000, outputTokens: 900, cacheRead: 12_000 });
    spend.beginCall();
    spend.add({ input: 300, output: 40, cacheRead: 12_000 });
    expect(spend.readings).toEqual({ inputTokens: 5_300, outputTokens: 940, cacheRead: 24_000 });
  });

  test("a log without usage, or none at all, is zero spent rather than a guess", () => {
    expect(new SessionSpend({}).readings).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cacheRead: undefined,
    });
    expect(
      new SessionSpend({ snapshotEvents: () => [{ type: "user/message", data: {} }] }).readings.outputTokens,
    ).toBeUndefined();
    // A log that throws leaves the count alone rather than taking the session down.
    expect(
      new SessionSpend({
        snapshotEvents: () => {
          throw new Error("no history");
        },
      }).readings.inputTokens,
    ).toBeUndefined();
  });

  test("following another session starts it over, and the same one changes nothing", () => {
    const first = {};
    const spend = new SessionSpend(first);
    spend.beginCall();
    spend.add({ output: 12 });
    expect(spend.follow(first)).toBe(false);
    expect(spend.readings.outputTokens).toBe(12);
    expect(spend.follow(logged([{ outputTokens: 900 }]))).toBe(true);
    expect(spend.readings).toEqual({ inputTokens: undefined, outputTokens: 900, cacheRead: undefined });
  });
});
