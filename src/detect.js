// The registry: where known AI CLIs keep their local data. Detection is just
// "does this path exist" — no processes are launched, nothing is executed.
import path from "node:path";

export const CLI_REGISTRY = [
  { id: "claude-code", name: "Claude Code", dirs: [".claude", ".claude.json"] },
  { id: "codex", name: "Codex CLI", dirs: [".codex"] },
  { id: "pi", name: "pi", dirs: [".pi"] },
  { id: "cursor", name: "Cursor", dirs: [".cursor", ".cursor.json"] },
  { id: "opencode", name: "OpenCode", dirs: [".opencode", ".config/opencode"] },
  { id: "gemini", name: "Gemini CLI", dirs: [".gemini"] },
  { id: "copilot", name: "GitHub Copilot CLI", dirs: [".copilot", ".config/gh-copilot"] },
  { id: "openclaw", name: "OpenClaw", dirs: [".openclaw", ".config/openclaw"] },
  { id: "windsurf", name: "Windsurf", dirs: [".codeium", ".windsurf"] },
  { id: "continue", name: "Continue", dirs: [".continue"] },
  { id: "aider", name: "Aider", dirs: [".aider", ".aider.conf.yml"] },
  { id: "qwen", name: "Qwen Code", dirs: [".qwen"] },
  { id: "droid", name: "Droid", dirs: [".factory"] },
  { id: "goose", name: "Goose", dirs: [".config/goose"] },
];

export function registryFor(home) {
  return CLI_REGISTRY.map((c) => ({ ...c, dirs: c.dirs.map((d) => path.join(home, ...d.split("/"))) }));
}

import fs from "node:fs";
export function detectClis({ home, existsSync } = {}) {
  const exists = existsSync ?? ((p_) => {
    try {
      fs.statSync(p_);
      return true;
    } catch {
      return false;
    }
  });
  const found = [];
  for (const cli of registryFor(home)) {
    const present = cli.dirs.filter((d) => exists(d));
    if (present.length) found.push({ ...cli, present });
  }
  return found;
}
