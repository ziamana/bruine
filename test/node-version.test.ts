import { expect, test } from "vitest";
import { nodeIsSupported, oldNodeMessage } from "../src/platform/node-version.js";

test("Node 24.9 and newer run bruine, older ones are told how to go on", () => {
  for (const v of ["24.9.0", "24.12.1", "25.0.0", "26.13.0"]) expect(nodeIsSupported(v), v).toBe(true);
  for (const v of ["22.19.0", "24.8.2", "20.0.0", ""]) expect(nodeIsSupported(v), v).toBe(false);
  const text = oldNodeMessage("0.2.0", "22.19.0");
  expect(text).toContain("Node 24.9 or newer; this is Node 22.19.0");
  expect(text).toContain("npm install -g @ziamana/bruine@0.1");
});
