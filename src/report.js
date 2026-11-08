// Terminal report + the model that builds it. CJK-aware widths, house style.

const WIDE_RE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/gu;

export function displayWidth(s) {
  s = String(s ?? "");
  const wide = s.match(WIDE_RE)?.length ?? 0;
  return s.length - wide + wide * 2;
}

export function pad(s, n) {
  s = String(s ?? "");
  return s + " ".repeat(Math.max(0, n - displayWidth(s)));
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

export function humanBytes(n) {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

function clip(s, n) {
  s = String(s ?? "");
  const out = [];
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > n) break;
    out.push(ch);
    w += cw;
  }
  return out.join("") + (w < displayWidth(s) ? "…" : "");
}

export function buildModel(report) {
  return report; // already the model; renderer reads it directly
}

export function renderTerminal(model, { color = true } = {}) {
  const L = [];
  const d = color ? dim : (s) => String(s);
  const b = color ? bold : (s) => String(s);
  const { detected, disk, secrets, mcp, summary, generatedAt } = model;

  L.push(b("🧹 agentjanitor · AI CLI 本地数据体检"));
  L.push(d(`   ${generatedAt} · 只读扫描 · 不执行任何 CLI · 不联网`));
  L.push("");
  L.push(
    `   检测到 ${b(summary.clis)} 个 AI CLI · 数据共 ${b(humanBytes(summary.bytes))}` +
      ` · ${b(summary.files)} 个文件` +
      (summary.truncated ? d(" (超大目录，统计有截断)") : ""),
  );
  if (summary.staleBytes > 0) {
    L.push(
      `   ` + (color ? yellow("⚠") : "⚠") +
        ` ${d(`超过 ${summary.staleDays} 天未动的数据 ${humanBytes(summary.staleBytes)}（${summary.staleFiles} 个文件）— 可清理候选`)}`,
    );
  }
  L.push("");

  L.push(b("   磁盘占用"));
  for (const c of disk) {
    L.push(
      `     ${pad(clip(c.name, 18), 20)} ${pad(humanBytes(c.bytes), 10)} ${d(`${c.files} 文件`)} ` +
        d(clip(c.hogs.join(" · "), 42)),
    );
  }
  L.push("");

  const cfgKeys = secrets.configKeys;
  const transcriptKeys = secrets.transcriptKeys;
  L.push(b("   密钥体检"));
  if (!cfgKeys.length && !transcriptKeys.length) {
    L.push(`     ` + (color ? green("✓") : "✓") + d(` 未发现密钥样式（扫描 ${humanBytes(secrets.scannedBytes)} 文本）`));
  }
  if (cfgKeys.length) {
    L.push(
      `     ` + (color ? yellow("⚠") : "⚠") +
        ` ${b(cfgKeys.length)} 个明文密钥位于配置文件（本地正常，但注意备份/同步渠道）:`,
    );
    cfgKeys.slice(0, 6).forEach((k) =>
      L.push(d(`       ${pad(clip(k.label, 14), 15)} ${k.masked}  ← ${clip(k.firstFile.replace(model.home, "~"), 52)}`)),
    );
    if (cfgKeys.length > 6) L.push(d(`       … 另有 ${cfgKeys.length - 6} 个`));
  }
  if (transcriptKeys.length) {
    L.push(
      `     ` + (color ? red("🚨") : "🚨") +
        ` ${b(transcriptKeys.length)} 个密钥泄露进会话记录（transcript 会随请求/共享出网，建议立即轮换）:`,
    );
    transcriptKeys.slice(0, 6).forEach((k) =>
      L.push(d(`       ${pad(clip(k.label, 14), 15)} ${k.masked}  ×${k.count} 处 · ${clip(k.firstFile.replace(model.home, "~"), 40)}`)),
    );
    if (transcriptKeys.length > 6) L.push(d(`       … 另有 ${transcriptKeys.length - 6} 个`));
  }
  if (secrets.scannedBytes) L.push(d(`     扫描文本 ${humanBytes(secrets.scannedBytes)} · ${secrets.scannedFiles} 个文件${secrets.truncated ? "（达到上限，未扫尽）" : ""}`));
  L.push("");

  if (mcp.sources.length) {
    L.push(b("   MCP 配置"));
    for (const s of mcp.sources) {
      L.push(
        `     ${pad(clip(s.label, 22), 23)} ${s.broken ? red(`${s.count} 个 (解析失败)`) : `${s.count} 个`}` +
          (s.servers.length ? d(` · ${clip(s.servers.join(", "), 38)}`) : ""),
      );
    }
    if (mcp.duplicates.length) {
      L.push(
        `     ` + (color ? yellow("⚠") : "⚠") +
          d(` 跨 CLI 重复配置: ${mcp.duplicates.map((x) => `${x.name}(${x.labels.length})`).join(" · ")}`),
      );
    }
    L.push("");
  }

  L.push(d("   只读体检：不修改、不删除、不上传。清理请自行判断后手动进行。"));
  L.push("");
  return L.join("\n");
}
