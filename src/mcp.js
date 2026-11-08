// MCP config discovery + cross-CLI duplicate detection. Every client stores
// MCP servers in its own format — we read (never write) the shapes that
// matter and report who has what, and which servers are duplicated.

import fs from "node:fs";
import path from "node:path";

export function mcpSourcesFor(home, cwd) {
  return [
    ["claude-code", "Claude Desktop", path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), "json-mcpServers"],
    ["claude-code", "Claude Code", path.join(home, ".claude.json"), "json-mcpServers"],
    ["claude-code", "Claude Code (project)", path.join(cwd, ".mcp.json"), "json-mcpServers"],
    ["cursor", "Cursor", path.join(home, ".cursor", "mcp.json"), "json-mcpServers"],
    ["windsurf", "Windsurf", path.join(home, ".codeium", "windsurf", "mcp_config.json"), "json-mcpServers"],
    ["opencode", "OpenCode", path.join(home, ".config", "opencode", "opencode.json"), "json-nested-mcp"],
    ["codex", "Codex", path.join(home, ".codex", "config.toml"), "codex-toml"],
    ["vscode", "VS Code", path.join(cwd, ".vscode", "mcp.json"), "json-mcpServers"],
  ];
}

export function readMcpServers(file, kind) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    if (kind === "codex-toml") {
      const names = [];
      const re = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]/gm;
      let m;
      while ((m = re.exec(text))) names.push(m[1]);
      return names.length ? names : null;
    }
    const json = JSON.parse(text);
    if (kind === "json-nested-mcp") {
      const mcp = json.mcp ?? json.mcpServers;
      return mcp && typeof mcp === "object" ? Object.keys(mcp) : null;
    }
    const mcp = json.mcpServers ?? json.mcp_servers;
    return mcp && typeof mcp === "object" ? Object.keys(mcp) : null;
  } catch {
    return "unparsable"; // file exists but broken — worth reporting
  }
}

export function collectMcp({ home, cwd = process.cwd() } = {}) {
  const found = [];
  for (const [cli, label, file, kind] of mcpSourcesFor(home, cwd)) {
    const names = readMcpServers(file, kind);
    if (names === null) continue;
    found.push({
      cli,
      label,
      file,
      count: Array.isArray(names) ? names.length : 0,
      servers: Array.isArray(names) ? names : [],
      broken: names === "unparsable",
    });
  }
  return found;
}

export function duplicateServers(found) {
  const byName = new Map();
  for (const src of found) {
    for (const name of src.servers) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(src.label);
    }
  }
  return [...byName.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([name, labels]) => ({ name, labels }));
}
