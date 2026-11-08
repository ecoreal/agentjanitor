import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aj-e2e-"));
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { playwright: {} } }),
  );
  fs.writeFileSync(
    path.join(home, ".claude", "projects", "s1.jsonl"),
    JSON.stringify({ text: "leak: " + ["ghp_", "A".repeat(36)].join("") }) + "\n",
  );
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ ok: true }));
  fs.mkdirSync(path.join(home, ".codex", "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    "[mcp_servers.playwright]\ncommand='npx'\n",
  );
  fs.writeFileSync(
    path.join(home, ".codex", "sessions", "rollout.jsonl"),
    ["sk-ant-api03-", "AbCd".repeat(6)].join("") + "\n",
  );
  return home;
}

const run = (args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

test("--version prints the version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("--help mentions the read-only guarantee", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("只读"));
});

test("end-to-end: JSON model over a synthetic home", () => {
  const home = fixtureHome();
  const r = run(["--json", "--home", home]);
  assert.equal(r.status, 0, r.stderr);
  const model = JSON.parse(r.stdout);
  assert.deepEqual(model.detected.map((d) => d.id), ["claude-code", "codex"]);
  assert.equal(model.summary.clis, 2);
  assert.ok(model.summary.bytes > 0);
  // secrets: ghp in claude transcript, sk-ant in codex transcript
  assert.equal(model.secrets.transcriptKeys.length, 2);
  const kinds = model.secrets.transcriptKeys.map((k) => k.kind).sort();
  assert.deepEqual(kinds, ["anthropic", "github"]);
  // mcp: playwright duplicated across claude-code + codex
  assert.equal(model.summary.mcpDuplicates, 1);
  assert.ok(model.mcp.sources.length >= 2);
});

test("end-to-end: terminal report over a synthetic home", () => {
  const home = fixtureHome();
  const r = run(["--home", home, "--no-color"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("agentjanitor"));
  assert.ok(r.stdout.includes("Claude Code"));
  assert.ok(r.stdout.includes("Codex CLI"));
  assert.ok(r.stdout.includes("🚨"), "transcript leaks are the headline");
  assert.ok(r.stdout.includes("playwright"), "duplicate MCP server named");
  assert.ok(!r.stdout.includes("A".repeat(36)), "full key never printed");
});

test("--no-secrets skips the scan entirely", () => {
  const home = fixtureHome();
  const r = run(["--json", "--home", home, "--no-secrets"]);
  const model = JSON.parse(r.stdout);
  assert.equal(model.secrets.scannedFiles, 0);
  assert.equal(model.secrets.transcriptKeys.length, 0);
});

test("missing home fails with one clean line", () => {
  const r = run(["--home", "/nonexistent-aj-home-xyz"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("home 不存在"));
  assert.ok(!r.stderr.includes("at "));
});
