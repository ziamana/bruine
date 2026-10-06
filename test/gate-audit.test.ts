import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { decide, isPrivateUrl, isReadonlyBash, lookupLeaks, type DecisionContext } from "../src/gate/rules.js";
import { writeEnvVar } from "../src/setup/simple.js";
import { readFileSync } from "node:fs";

/** The security audit of 2026-10-06: what the gate let through, and now does not. */
const proj = mkdtempSync(join(tmpdir(), "gate-audit-"));
mkdirSync(join(proj, "src"));
writeFileSync(join(proj, "src", "a.ts"), "x");
const skills = mkdtempSync(join(tmpdir(), "gate-skills-"));
mkdirSync(join(skills, "impeccable", "reference"), { recursive: true });
writeFileSync(join(skills, "impeccable", "reference", "color.md"), "x");
const ctx = (mode: DecisionContext["mode"], extra: Partial<DecisionContext> = {}): DecisionContext =>
  ({ mode, plan: false, sessionAllowed: new Set(), projectDir: proj, ...extra });
const home = (rel: string): string => join(homedir(), rel);

describe("read, glob and grep: a secret, or a path outside the project, asks", () => {
  for (const mode of ["ask", "auto"] as const) {
    test.each([
      ["read", { file_path: home(".aws/credentials") }],
      ["read", { file_path: home(".config/gh/hosts.yml") }],
      ["read", { file_path: home(".docker/config.json") }],
      ["read", { file_path: home(".netrc") }],
      ["read", { file_path: home(".bruine/bruine.json") }],
      ["read", { file_path: "/etc/passwd" }],
      ["read_image", { file_path: "/etc/shadow.png" }],
      ["grep", { pattern: "PRIVATE", path: home(".ssh") }],
      ["grep", { pattern: "x", path: "/etc" }],
      ["glob", { pattern: `${home(".aws")}/*` }],
      ["glob", { pattern: "~/.kube/*" }],
      ["glob", { pattern: "**/*", path: ".." }],
    ])(`${mode}: %s %j asks`, (name, args) => expect(decide(name, args, ctx(mode))).toBe("ask"));
  }

  test("inside the project they stay quiet", () => {
    expect(decide("read", { file_path: join(proj, "src/a.ts") }, ctx("auto"))).toBe("allow");
    expect(decide("grep", { pattern: "x", path: "src" }, ctx("auto"))).toBe("allow");
    expect(decide("glob", { pattern: "src/**/*.ts" }, ctx("auto"))).toBe("allow");
    expect(decide("grep", { pattern: "x" }, ctx("auto"))).toBe("allow");
  });

  test("the installed skills are readable, and nothing next to them", () => {
    const c = ctx("auto", { readRoots: [skills] });
    expect(decide("read", { file_path: join(skills, "impeccable/reference/color.md") }, c)).toBe("allow");
    expect(decide("read", { file_path: join(skills, "..", "other") }, c)).toBe("ask");
    expect(decide("read", { file_path: home(".aws/credentials") }, c)).toBe("ask");
    // a secret inside a readable root is still a secret
    expect(decide("read", { file_path: join(skills, "impeccable/.env") }, c)).toBe("ask");
  });

  test("a symlink out of the project is followed before it is judged", () => {
    symlinkSync("/etc/hostname", join(proj, "link.txt"));
    expect(lookupLeaks("read", { file_path: join(proj, "link.txt") }, proj)).toBe(true);
  });

  test("'Always' on read does not open the rest", () => {
    expect(decide("read", { file_path: home(".aws/credentials") }, ctx("auto", { sessionAllowed: new Set(["read"]) }))).toBe("ask");
  });
});

describe("'Always for this session' on write and edit stays inside the project", () => {
  const always = new Set(["write", "edit"]);
  test.each([
    ["write", { path: home(".local/bin/evil"), content: "x" }],
    ["write", { file_path: home(".config/autostart/x.desktop"), content: "x" }],
    ["edit", { path: "/etc/hosts" }],
    ["write", { path: "../outside.txt", content: "x" }],
  ])("%s %j still asks", (name, args) => {
    expect(decide(name, args, ctx("ask", { sessionAllowed: always }))).toBe("ask");
    expect(decide(name, args, ctx("auto", { sessionAllowed: always }))).toBe("ask");
  });
  test("a file in the project is covered by it", () => {
    expect(decide("write", { path: join(proj, "src/new.ts"), content: "x" }, ctx("ask", { sessionAllowed: always }))).toBe("allow");
  });
  test("full access still asks for nothing", () => {
    expect(decide("write", { path: "/etc/hosts", content: "x" }, ctx("full"))).toBe("allow");
  });
});

describe("web_fetch to this machine or the network behind it asks", () => {
  test.each([
    "http://localhost:3000/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://172.16.4.1/", "http://192.168.1.64:8081/v1",
    "http://100.64.0.1/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    "http://nas/", "http://router.local/", "http://metadata.google.internal/", "http://printer.lan/", "http://0.0.0.0/",
    "https://user:pass@example.com/",
  ])("%s", (url) => {
    expect(isPrivateUrl(url)).toBe(true);
    expect(decide("web_fetch", { url }, ctx("auto"))).toBe("ask");
    expect(decide("web_fetch", { url }, ctx("ask", { sessionAllowed: new Set(["web_fetch"]) }))).toBe("ask");
  });
  test.each(["https://example.com/", "https://docs.rs/serde", "http://93.184.216.34/", "https://172.32.0.1/", "https://[2606:4700::1111]/", "https://sub.example.co.uk:8443/a?b=c"])(
    "%s is a public address and goes through", (url) => {
      expect(isPrivateUrl(url)).toBe(false);
      expect(decide("web_fetch", { url }, ctx("auto"))).toBe("allow");
    });
  test("something that is not a URL is left to the tool", () => {
    expect(isPrivateUrl("not a url")).toBe(false);
  });
});

describe("ps is read-only until it prints the environment", () => {
  test.each(["ps", "ps aux", "ps -ef", "ps -p 123", "ps -eo pid,comm", "ps -p 123 -o comm"])("%s", (command) => expect(isReadonlyBash(command)).toBe(true));
  test.each(["ps e", "ps eww", "ps auxe", "ps axe", "ps -p 1 e", "ps --environment"])("%s", (command) => {
    expect(isReadonlyBash(command)).toBe(false);
    expect(decide("bash", { command }, ctx("auto"))).toBe("judge");
  });
});

describe("more places a secret lives", () => {
  test.each(["cat ~/.aws/credentials", "ls ~/.kube", "cat ~/.netrc", "cat ~/.config/gh/hosts.yml", "cat ~/.git-credentials", "cat ~/.docker/config.json", "cat ~/.gnupg/pubring.kbx"])(
    "%s asks", (command) => expect(decide("bash", { command }, ctx("auto"))).toBe("ask"));
});

describe("writeEnvVar keeps the value exactly as given", () => {
  test("a replacement pattern in a value or a key is not expanded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-env-"));
    const file = join(dir, ".env");
    await writeEnvVar(file, "A_KEY", "first");
    await writeEnvVar(file, "A_KEY", "p$&q$1r$$s");
    expect(readFileSync(file, "utf8")).toBe("A_KEY=p$&q$1r$$s\n");
    await writeEnvVar(file, "B.KEY", "x");
    await writeEnvVar(file, "BXKEY", "y");
    await writeEnvVar(file, "B.KEY", "z");
    expect(readFileSync(file, "utf8")).toBe("A_KEY=p$&q$1r$$s\nB.KEY=z\nBXKEY=y\n");
  });
});
