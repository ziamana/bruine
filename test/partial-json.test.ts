import { expect, test } from "vitest";
import { parsePartialJson } from "../src/ui/partial-json.js";

const whole = '{"questions":[{"id":"q1","question":"Quel sujet ?","options":[{"label":"A","description":"un"},{"label":"B"}],"multiSelect":false}]}';

test("complete JSON parses as it is", () => {
  expect(parsePartialJson(whole)).toEqual(JSON.parse(whole));
});

test("nothing usable yet is undefined", () => {
  expect(parsePartialJson("")).toBeUndefined();
  expect(parsePartialJson("   ")).toBeUndefined();
});

test("an unfinished string is closed where it stands", () => {
  expect(parsePartialJson('{"questions":[{"id":"q1","question":"Quel su')).toEqual({
    questions: [{ id: "q1", question: "Quel su" }],
  });
});

test("a key with no value yet, or no colon yet, is dropped", () => {
  expect(parsePartialJson('{"questions":[{"id":"q1","question"')).toEqual({ questions: [{ id: "q1" }] });
  expect(parsePartialJson('{"questions":[{"id":"q1","question":')).toEqual({ questions: [{ id: "q1", question: null }] });
  expect(parsePartialJson('{"questions":[{"id":"q1","qu')).toEqual({ questions: [{ id: "q1" }] });
});

test("a trailing comma and a dangling escape do not poison the parse", () => {
  expect(parsePartialJson('{"a":[1,2,')).toEqual({ a: [1, 2] });
  expect(parsePartialJson('{"a":"x\\')).toEqual({ a: "x" });
  expect(parsePartialJson('{"a":"caf\\u00')).toEqual({ a: "caf" });
});

test("every prefix of a real payload yields something and never throws", () => {
  const seen: unknown[] = [];
  for (let i = 1; i <= whole.length; i += 1) {
    expect(() => seen.push(parsePartialJson(whole.slice(0, i)))).not.toThrow();
  }
  expect(seen.at(-1)).toEqual(JSON.parse(whole));
  // Once the options array has started, the options that finished are all there.
  const mid = parsePartialJson(whole.slice(0, whole.indexOf('{"label":"B"') + 8)) as {
    questions: Array<{ options?: Array<{ label?: string }> }>;
  };
  expect(mid.questions[0]!.options?.[0]?.label).toBe("A");
});
