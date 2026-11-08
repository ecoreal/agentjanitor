#!/usr/bin/env node
// agentjanitor — the health check for every AI CLI on your machine.
// Read-only: detects CLIs, measures disk, audits keys, de-dupes MCP configs.

import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { detectClis } from "./detect.js";
import { dirSize, topChildren, staleBytes, staleCutoff, humanBytes } from "./disk.js";
import { scanCliPaths, dedupeFindings } from "./secrets.js";
import { collectMcp, duplicateServers } from "./mcp.js";
import { renderTerminal } from "./report.js";
import { planClean, executeClean, renderPlan } from "./clean.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const TRANSCRIPT_RE = /(session|transcript|project|history|log|conversation)/i;

function usage(code = 0) {
  console.log(`🧹 agentjanitor v${pkg.version} — 每个 AI CLI 的本地数据体检

用法:
  agentjanitor [选项]        体检（完全只读）
  agentjanitor clean [选项]  清理过期文件 —— 默认只预览，--yes 才真删

选项:
  --json            JSON 输出（供脚本/CI 使用）
  --no-secrets      跳过密钥扫描（只看磁盘）
  --stale-days <n>  可清理候选的判定天数（默认 90）
  --home <dir>      扫描另一个 home（测试/其他用户）
  --yes             clean 专用：确认执行删除（不带则只预览）
  --no-color        纯文本输出
  -h, --help        帮助
  -v, --version     版本

只读保证: 体检模式不启动任何 CLI、不修改/删除/上传任何文件。
唯一会删文件的入口是 clean --yes，且只删除超过 --stale-days 的普通文件。`);
  process.exit(code);
}

function parseArgv(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    if (a === "-v" || a === "--version") {
      console.log(pkg.version);
      process.exit(0);
    }
    if (a === "--json") flags.json = true;
    else if (a === "--no-secrets") flags.secrets = false;
    else if (a === "--no-color") flags.color = false;
    else if (a === "--stale-days") flags.staleDays = Number(argv[++i]);
    else if (a === "--home") flags.home = argv[++i];
    else if (a === "--yes") flags.yes = true;
    else if (a.startsWith("--")) {
      console.error(`agentjanitor: 未知选项 ${a}`);
      usage(1);
    } else flags._.push(a);
  }
  return flags;
}

function kindOfPath(p) {
  return TRANSCRIPT_RE.test(p) ? "transcript" : "config";
}

const now = () =>
  new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });

async function run(flags) {
  const home = flags.home ? path.resolve(flags.home) : os.homedir();
  if (!fs.existsSync(home)) {
    console.error(`agentjanitor: home 不存在: ${home}`);
    process.exitCode = 1;
    return;
  }
  const color = flags.color !== false && process.stdout.isTTY;
  const staleDays = Number.isFinite(flags.staleDays) && flags.staleDays > 0 ? flags.staleDays : 90;
  const cutoff = staleCutoff(Date.now(), staleDays);

  const detected = detectClis({ home });

  // Disk pass
  const disk = [];
  for (const cli of detected) {
    let bytes = 0;
    let files = 0;
    let oldest = null;
    let truncated = false;
    const hogs = [];
    for (const dir of cli.present) {
      const s = dirSize(dir);
      bytes += s.bytes;
      files += s.files;
      truncated ||= s.truncated;
      if (s.oldest != null && (oldest == null || s.oldest < oldest)) oldest = s.oldest;
      if (fs.statSync(dir).isDirectory()) {
        for (const h of topChildren(dir, 2)) {
          if (h.bytes > 5 * 1024 * 1024) hogs.push(`${h.name} ${humanBytes(h.bytes)}`);
        }
      }
    }
    const stale = cli.present
      .filter((d) => fs.statSync(d).isDirectory())
      .reduce((acc, d) => {
        const s = staleBytes(d, cutoff);
        acc.bytes += s.bytes;
        acc.files += s.files;
        return acc;
      }, { bytes: 0, files: 0 });
    disk.push({ id: cli.id, name: cli.name, bytes, files, oldest, hogs, stale, truncated });
  }
  disk.sort((a, b) => b.bytes - a.bytes);

  // Secrets pass (per CLI so attribution stays right)
  const secrets = { configKeys: [], transcriptKeys: [], scannedBytes: 0, scannedFiles: 0, truncated: false };
  if (flags.secrets !== false) {
    for (const cli of detected) {
      const { findings, scannedFiles, scannedBytes, truncated } = await scanCliPaths(cli.present, {
        kindOf: kindOfPath,
      });
      secrets.scannedFiles += scannedFiles;
      secrets.scannedBytes += scannedBytes;
      secrets.truncated ||= truncated;
      for (const f of dedupeFindings(findings)) {
        const bucket = f.kind2 === "transcript" ? secrets.transcriptKeys : secrets.configKeys;
        const existing = bucket.find((k) => k.kind === f.kind && k.masked === f.masked);
        if (existing) {
          existing.count += f.count;
          for (const file of f.files) if (!existing.files.includes(file)) existing.files.push(file);
        } else {
          bucket.push({ kind: f.kind, label: f.label, masked: f.masked, count: f.count, firstFile: f.files[0], files: f.files });
        }
      }
    }
    secrets.transcriptKeys.sort((a, b) => b.count - a.count);
  }

  // MCP pass
  const sources = collectMcp({ home });
  const mcp = { sources, duplicates: duplicateServers(sources) };

  const summary = {
    clis: detected.length,
    bytes: disk.reduce((a, c) => a + c.bytes, 0),
    files: disk.reduce((a, c) => a + c.files, 0),
    truncated: disk.some((c) => c.truncated),
    staleBytes: disk.reduce((a, c) => a + c.stale.bytes, 0),
    staleFiles: disk.reduce((a, c) => a + c.stale.files, 0),
    staleDays,
    configKeys: secrets.configKeys.length,
    transcriptKeys: secrets.transcriptKeys.length,
    mcpSources: sources.length,
    mcpDuplicates: mcp.duplicates.length,
  };

  const model = {
    home,
    generatedAt: now(),
    detected: detected.map((d) => ({ id: d.id, name: d.name, dirs: d.present })),
    disk,
    secrets: {
      scannedBytes: secrets.scannedBytes,
      scannedFiles: secrets.scannedFiles,
      truncated: secrets.truncated,
      configKeys: secrets.configKeys,
      transcriptKeys: secrets.transcriptKeys,
    },
    mcp,
    summary,
  };

  if (flags.json) {
    console.log(JSON.stringify(model, null, 2));
  } else {
    console.log(renderTerminal(model, { color }));
  }
}

const flags = parseArgv(process.argv.slice(2));
try {
  if (flags._[0] === "clean") await cmdClean(flags);
  else await run(flags);
} catch (e) {
  console.error(`agentjanitor: ${e.message}`);
  process.exitCode = 1;
}

// clean — the deliberate, opt-in deletion path. Dry-run by default.
async function cmdClean(flags) {
  const home = flags.home ? path.resolve(flags.home) : os.homedir();
  if (!fs.existsSync(home)) {
    console.error(`agentjanitor: home 不存在: ${home}`);
    process.exitCode = 1;
    return;
  }
  const staleDays = Number.isFinite(flags.staleDays) && flags.staleDays > 0 ? flags.staleDays : 90;
  const cutoff = staleCutoff(Date.now(), staleDays);
  const plan = planClean({ home, cutoffMs: cutoff });
  const color = flags.color !== false && process.stdout.isTTY;

  if (!plan.length) {
    console.log(`🧹 没有超过 ${staleDays} 天的可清理文件 —— 很干净。`);
    return;
  }
  const { text, total, count } = renderPlan(plan, { color });
  console.log(`🧹 agentjanitor clean · 超过 ${staleDays} 天的文件\n${text}\n`);
  if (!flags.yes) {
    console.log(`▸ 预览模式：没有删除任何文件。确认执行请加 --yes`);
    return;
  }
  const r = executeClean(plan);
  console.log(`🗑 已删除 ${r.removed}/${count} 个文件 · 释放 ${humanBytes(r.bytes)}${r.errors ? ` · ${r.errors} 个失败` : ""}`);
}
