// Secret scanning over AI CLI local data — the part ccusage and claude-clean
// don't do. Two classes of finding:
//   config-key : an API key sitting in a config file (expected, but plaintext)
//   transcript : a key that leaked INTO a session log / transcript (the part
//                that leaves your machine with every request)
// Everything is masked for display; the full match never leaves the scanner.
import path from "node:path";

export const SECRET_PATTERNS = [
  { id: "anthropic", label: "Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "openai", label: "OpenAI", re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
  { id: "openai-legacy", label: "OpenAI(legacy)", re: /\bsk-[A-Za-z0-9]{10}T3BlbkFJ[A-Za-z0-9]{20,}\b/g },
  { id: "deepseek", label: "DeepSeek", re: /\bsk-[a-f0-9]{32}\b/g },
  { id: "github", label: "GitHub", re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { id: "github-pat", label: "GitHub PAT", re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { id: "aws", label: "AWS", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "slack", label: "Slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "gitlab", label: "GitLab", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: "google", label: "Google", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: "groq", label: "Groq", re: /\bgsk_[A-Za-z0-9]{20,}\b/g },
  { id: "openrouter", label: "OpenRouter", re: /\bsk-or-v1-[a-f0-9]{32}\b/g },
  { id: "moonshot", label: "Moonshot", re: /\bsk-[A-Za-z0-9]{10}ssDxrL[A-Za-z0-9]{10,}\b/g },
];

export function maskSecret(s) {
  if (s.length <= 12) return s.slice(0, 3) + "****";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function scanText(text) {
  const hits = [];
  for (const { id, label, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      hits.push({ kind: id, label, masked: maskSecret(m[0]), raw: m[0] });
    }
  }
  return hits;
}

const TEXT_EXT = new Set([
  ".json", ".jsonl", ".jsonc", ".toml", ".yaml", ".yml", ".md", ".txt",
  ".log", ".env", ".ts", ".js", ".mjs", ".cjs", ".py", ".sh", ".ini",
  ".cfg", ".conf", ".xml", ".csv", ".lock",
]);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300 MB per CLI, then stop

export function isScannableFile(name, size) {
  if (size > MAX_FILE_BYTES) return false;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (name.startsWith(".env")) return true;
  return TEXT_EXT.has(ext) || ext === "";
}

// Walk a CLI's paths and scan scannable text files. kindOf() classifies each
// finding as "config" (expected plaintext) or "transcript" (leaked into logs).
export async function scanCliPaths(
  paths,
  { kindOf, maxTotal = MAX_TOTAL_BYTES, conc = 8, maxFile = MAX_FILE_BYTES } = {},
) {
  const findings = [];
  const fsp = await import("node:fs/promises");
  let scannedBytes = 0;
  let scannedFiles = 0;
  let truncated = false;

  const files = [];
  const collect = async (p_) => {
    let st;
    try {
      st = await fsp.stat(p_);
    } catch {
      return;
    }
    if (st.isFile()) {
      files.push({ path: p_, size: st.size });
      return;
    }
    let list;
    try {
      list = await fsp.readdir(p_, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.name === "node_modules") continue;
      await collect(path.join(p_, e.name));
    }
  };
  for (const p_ of paths) await collect(p_);

  // biggest last is wrong — scan biggest first so the cap favours fat logs
  files.sort((a, b) => b.size - a.size);

  let next = 0;
  const worker = async () => {
    while (next < files.length && !truncated) {
      const f = files[next++];
      if (scannedBytes > maxTotal) {
        truncated = true;
        return;
      }
      if (!isScannableFile(path.basename(f.path), Math.min(f.size, maxFile))) continue;
      const budget = Math.min(f.size, maxFile);
      scannedBytes += budget;
      scannedFiles++;
      let text;
      try {
        const fh = await fsp.open(f.path, "r");
        const buf = Buffer.alloc(budget);
        await fh.read(buf, 0, budget, 0);
        await fh.close();
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      for (const hit of scanText(text)) {
        findings.push({ file: f.path, ...hit, kind2: kindOf ? kindOf(f.path) : "config" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, files.length)) }, worker));

  return { findings, scannedFiles, scannedBytes, truncated };
}

export function dedupeFindings(findings) {
  // same secret can appear in many lines/files — one finding per (kind, masked)
  const seen = new Map();
  for (const f of findings) {
    const key = `${f.kind}:${f.masked}`;
    if (!seen.has(key)) {
      seen.set(key, { ...f, count: 1, files: [f.file] });
    } else {
      const e = seen.get(key);
      e.count++;
      if (!e.files.includes(f.file)) e.files.push(f.file);
    }
  }
  return [...seen.values()];
}
