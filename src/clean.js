// `agentjanitor clean` — the only subcommand that ever deletes anything.
// Default: dry-run (prints exactly what would go, deletes nothing).
// --yes: actually unlink the stale files. Directories are never removed.

import fs from "node:fs";
import { detectClis } from "./detect.js";
import { staleFileList, humanBytes } from "./disk.js";

export function planClean({ home, cutoffMs } = {}) {
  const plan = [];
  for (const cli of detectClis({ home })) {
    const dirs = cli.present.filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const files = dirs.flatMap((d) => staleFileList(d, cutoffMs));
    if (files.length) {
      plan.push({
        cli: cli.name,
        id: cli.id,
        files,
        bytes: files.reduce((a, f) => a + f.bytes, 0),
      });
    }
  }
  return plan;
}

export function executeClean(plan) {
  let removed = 0;
  let bytes = 0;
  let errors = 0;
  for (const group of plan) {
    for (const f of group.files) {
      try {
        fs.rmSync(f.path);
        removed++;
        bytes += f.bytes;
      } catch {
        errors++;
      }
    }
  }
  return { removed, bytes, errors };
}

export function renderPlan(plan, { color = true } = {}) {
  const L = [];
  const d = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const y = (s) => (color ? `\x1b[33m${s}\x1b[0m` : s);
  let total = 0;
  let count = 0;
  for (const group of plan) {
    L.push(y(`  ${group.cli} — ${group.files.length} 个文件 · ${humanBytes(group.bytes)}`));
    for (const f of group.files.slice(0, 5)) L.push(d(`    ${humanBytes(f.bytes)}  ${f.path}`));
    if (group.files.length > 5) L.push(d(`    … 另有 ${group.files.length - 5} 个`));
    total += group.bytes;
    count += group.files.length;
  }
  L.push(y(`  合计 ${count} 个文件 · ${humanBytes(total)}`));
  return { text: L.join("\n"), total, count };
}
