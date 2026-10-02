import { expect, test } from "vitest";
import { TpsMeter } from "../src/ui/tps.js";

test("SSE chunk counts are not presented as measured tokens per second", () => {
  const meter = new TpsMeter();
  meter.startCall(0);
  meter.delta(1000); meter.delta(1001); meter.delta(2000);
  expect(meter.measuredTps).toBe(0);
  meter.usage(2100, { outputTokens: 60 });
  expect(meter.measuredTps).toBe(60);
  meter.endCall();
  expect(meter.measuredTps).toBe(60);
});

test.each([0, 1, 20, 249])("a buffered %i ms burst does not produce an enormous TPS reading", elapsed => {
  const meter = new TpsMeter();
  meter.startCall(0); meter.delta(1000); meter.delta(1000 + elapsed);
  meter.usage(2000, { outputTokens: 100 });
  expect(meter.measuredTps).toBe(0);
});

test.each([undefined, 0, -1, NaN, Infinity])("missing or invalid output usage (%s) cannot become a token measurement", outputTokens => {
  const meter = new TpsMeter();
  meter.startCall(0); meter.delta(1000); meter.delta(2000);
  meter.usage(2100, { outputTokens }); meter.endCall();
  expect(meter.measuredTps).toBe(0);
});

test("new requests clear stale speed and prefill, and do not time tool execution", () => {
  const meter = new TpsMeter();
  meter.startCall(0); meter.delta(1000); meter.delta(2000);
  meter.usage(2100, { outputTokens: 50, inputTokens: 1000 }); meter.endCall();
  expect(meter.measuredTps).toBe(50);
  expect(meter.pp).toBe(1000);
  meter.startCall(10_000);
  expect(meter.measuredTps).toBe(0);
  expect(meter.pp).toBeUndefined();
  meter.delta(11_000); meter.delta(12_000);
  meter.usage(12_100, { outputTokens: 50 });
  expect(meter.measuredTps).toBe(50);
});

test("an unreported token count remains unknown even when chunks arrive regularly", () => {
  const meter = new TpsMeter();
  meter.startCall(0);
  for (let i = 0; i < 10; i++) meter.delta(1000 + i * 100);
  meter.endCall();
  expect(meter.measuredTps).toBe(0);
});
