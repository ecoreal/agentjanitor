// Disk analysis: sizes, file counts, and age — pure lstat walking, no file
// contents are ever read here. Sessions older than STALE_DAYS are the cleanup
// candidates the report talks about.

import fs from "node:fs";
import path from "node:path";

export const STALE_DAYS = 90;

export function dirSize(dir, { maxEntries = 400000 } = {}) {
  const out = { bytes: 0, files: 0, oldest: null, newest: null, truncated: false };
  let visited = 0;
  const walk = (d) => {
    if (out.truncated) return;
    let list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (out.truncated) return;
      if (++visited > maxEntries) {
        out.truncated = true;
        return;
      }
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue; // never the user's fault
          walk(full);
        } else if (e.isFile()) {
          const st = fs.statSync(full);
          out.bytes += st.size;
          out.files++;
          const t = st.mtimeMs;
          if (!out.oldest || t < out.oldest) out.oldest = t;
          if (!out.newest || t > out.newest) out.newest = t;
        }
      } catch {
        /* raced / permission — skip */
      }
    }
  };
  walk(dir);
  return out;
}

// Top-level children of a CLI dir, biggest first — "what's eating it".
export function topChildren(dir, topN = 4) {
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sized = [];
  for (const e of list) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) sized.push({ name: e.name, ...dirSize(full) });
      else sized.push({ name: e.name, bytes: st.size, files: 1, oldest: st.mtimeMs, newest: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return sized.sort((a, b) => b.bytes - a.bytes).slice(0, topN);
}

// Stale cleanup candidates: files under a dir last touched before the cutoff.
export function staleBytes(dir, cutoffMs, { maxEntries = 400000 } = {}) {
  let bytes = 0;
  let files = 0;
  let visited = 0;
  const walk = (d) => {
    let list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (++visited > maxEntries) return;
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          const st = fs.statSync(full);
          if (st.mtimeMs < cutoffMs) {
            bytes += st.size;
            files++;
          }
        }
      } catch {
        /* skip */
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

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

export function staleCutoff(now = Date.now(), days = STALE_DAYS) {
  return now - days * 864e5;
}
