import { describe, expect, test } from "vitest";
import { parseFlags } from "../src/flags.js";

describe("launcher headless flags", () => {
  test.each([
    [["-p", "task"], ["task"], "text"],
    [["--print=task"], ["task"], "text"],
    [["-p", "first", "-p", "second"], ["first", "second"], "text"],
    [["-p", "-"], ["-"], "text"],
    [["--output-format", "json", "-p", "task"], ["task"], "json"],
    [["-p", "task", "-f", "stream-json"], ["task"], "stream-json"],
  ] as const)("parses %j", (args, prompts, format) => {
    expect(parseFlags(args).headless).toEqual({ prompts, format });
  });

  test("rejects an invalid output format by name", () => {
    expect(parseFlags(["-p", "task", "--output-format", "xml"]).error).toContain("--output-format");
  });

  test("does not claim flags after -- or as another option's value", () => {
    expect(parseFlags(["--", "-p", "task"]).headless).toBeUndefined();
    expect(parseFlags(["--model", "-p", "task"]).headless).toBeUndefined();
    expect(parseFlags(["--model", "-p", "task"]).passthrough).toEqual(["--model", "-p", "task"]);
  });

  test("recognizes explicit headless permission modes", () => {
    expect(parseFlags(["-p", "task", "--permission-mode", "full"]).permission).toBe("full");
    expect(parseFlags(["--dangerously-skip-permissions", "-p", "task"]).permission).toBe("full");
    expect(parseFlags(["-p", "task", "--permission-mode", "unknown"]).error).toContain("--permission-mode");
  });
});
