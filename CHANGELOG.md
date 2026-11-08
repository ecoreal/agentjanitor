# Changelog

## 0.2.0 — 2026-11-09

- **`agentjanitor clean`** — the deliberate deletion path. Dry-run by default
  (prints every candidate file + total), `--yes` executes. Only stale plain
  files go; directories and fresh files are never touched. The default report
  stays read-only even with `--yes` accidentally attached.
- 5 new tests (31 total), including "report must never delete".

## 0.1.0 — 2026-11-08

First release: cross-CLI detection (14 registries), disk/stale analysis,
plaintext-key audit (11 provider patterns), transcript leak scan, MCP config
discovery + cross-CLI duplicate detection. Zero dependencies, read-only.
