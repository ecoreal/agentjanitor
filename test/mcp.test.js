import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectMcp, duplicateServers, readMcpServers } from "../src/mcp.js";

test("readMcpServers: mcpServers shape", () => {
  const f = path.join(os.tmpdir(), `aj-mcp-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { playwright: {}, context7: {} } }));
  assert.deepEqual(readMcpServers(f, "json-mcpServers"), ["playwright", "context7"]);
  fs.rmSync(f);
});

test("readMcpServers: codex TOML section headers", () => {
  const f = path.join(os.tmpdir(), `aj-mcp-${Date.now()}.toml`);
  fs.writeFileSync(
    f,
    `model = "gpt-5"\n\n[mcp_servers.playwright]\ncommand = "npx"\n\n[mcp_servers.context7]\ncommand = "npx"\n`,
  );
  assert.deepEqual(readMcpServers(f, "codex-toml"), ["playwright", "context7"]);
  fs.rmSync(f);
});

test("readMcpServers: broken JSON reports 'unparsable', missing returns null", () => {
  const f = path.join(os.tmpdir(), `aj-mcp-broken-${Date.now()}.json`);
  fs.writeFileSync(f, "{ not json");
  assert.equal(readMcpServers(f, "json-mcpServers"), "unparsable");
  assert.equal(readMcpServers(path.join(os.tmpdir(), "nope.json"), "json-mcpServers"), null);
  fs.rmSync(f);
});

test("collectMcp + duplicateServers across CLIs", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aj-mcp-home-"));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { playwright: {}, context7: {}, fetch: {} } }),
  );
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { playwright: {}, time: {} } }),
  );
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    "[mcp_servers.playwright]\ncommand='npx'\n",
  );

  const found = collectMcp({ home, cwd: "/nonexistent-cwd" });
  assert.equal(found.length, 3);
  const dups = duplicateServers(found);
  assert.deepEqual(dups, [
    { name: "playwright", labels: ["Claude Code", "Cursor", "Codex"] },
  ]);
});
