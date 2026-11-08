import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectClis, registryFor } from "../src/detect.js";

function mkHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aj-home-"));
}

test("registry paths resolve under the given home", () => {
  const home = mkHome();
  const reg = registryFor(home);
  assert.ok(reg.length >= 12);
  const claude = reg.find((c) => c.id === "claude-code");
  assert.equal(claude.dirs[0], path.join(home, ".claude"));
});

test("detect: only CLIs with existing dirs are reported", () => {
  const home = mkHome();
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(path.join(home, ".claude.json"), "{}");
  const found = detectClis({ home });
  assert.deepEqual(found.map((f) => f.id), ["claude-code", "codex"]);
  const codex = found.find((f) => f.id === "codex");
  assert.deepEqual(codex.present, [path.join(home, ".codex")]);
});

test("detect: empty home finds nothing", () => {
  assert.deepEqual(detectClis({ home: mkHome() }), []);
});

test("detect: injected existsSync is honoured (no filesystem access)", () => {
  const found = detectClis({
    home: "/elsewhere",
    existsSync: (p) => String(p).includes(".pi"),
  });
  assert.deepEqual(found.map((f) => f.id), ["pi"]);
});
