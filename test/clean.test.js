import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
const run = (args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
import { spawnSync } from "node:child_process";

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aj-clean-"));
  fs.mkdirSync(path.join(home, ".codex", "sessions", "old"), { recursive: true });
  // stale (120d) — cleanup candidate
  const old1 = path.join(home, ".codex", "sessions", "old", "a.jsonl");
  const old2 = path.join(home, ".codex", "sessions", "b.jsonl");
  // fresh — must survive everything
  const fresh = path.join(home, ".codex", "sessions", "new.jsonl");
  for (const [p, size] of [[old1, 500], [old2, 300], [fresh, 900]]) {
    fs.writeFileSync(p, Buffer.alloc(size, 1));
  }
  const past = new Date(Date.now() - 120 * 864e5);
  for (const p of [old1, old2]) fs.utimesSync(p, past, past);
  return { home, old1, old2, fresh };
}

test("clean (dry-run): lists candidates, deletes nothing", () => {
  const { home, old1, old2, fresh } = fixtureHome();
  const r = run(["clean", "--home", home, "--no-color"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("预览模式"), "dry-run is explicit");
  assert.ok(r.stdout.includes(old1));
  assert.ok(r.stdout.includes("2 个文件"));
  assert.ok(fs.existsSync(old1) && fs.existsSync(old2), "dry run removes nothing");
  assert.ok(fs.existsSync(fresh));
});

test("clean --yes: removes only stale files, keeps fresh ones", () => {
  const { home, old1, old2, fresh } = fixtureHome();
  const r = run(["clean", "--home", home, "--yes", "--no-color"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("已删除 2/2 个文件"));
  assert.ok(!fs.existsSync(old1), "stale file removed");
  assert.ok(!fs.existsSync(old2), "stale file removed");
  assert.ok(fs.existsSync(fresh), "fresh file survives");
});

test("clean: empty home is a clean bill of health", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aj-clean-empty-"));
  const r = run(["clean", "--home", home, "--no-color"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("很干净"));
});

test("clean with a missing home fails cleanly", () => {
  const r = run(["clean", "--home", "/nonexistent-aj-xyz"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("home 不存在"));
});

test("report mode still deletes nothing even with --yes (report is read-only)", () => {
  const { home, old1 } = fixtureHome();
  const r = run(["--home", home, "--yes"]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(old1), "the report must never delete");
});
