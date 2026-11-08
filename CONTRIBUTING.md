# Contributing to agentjanitor

Small, sharp tool — same rules apply. Thanks for helping!

## Development setup

```bash
git clone https://github.com/ecoreal/agentjanitor && cd agentjanitor
npm test          # node:test, offline
```

Node ≥ 18.17, **zero dependencies** — stdlib only. If a feature needs a
package, it belongs in a separate project.

## Modules

detect.js (CLI registry) · disk.js (sizes/stale) · secrets.js (patterns/scan) · mcp.js (config discovery) · clean.js (deletion path) · report.js/cli.js

## Ground rules

- **Read-only is the product.** Only `clean --yes` may delete, and only stale plain files. Any PR that widens that surface needs a very good reason.
- **Never touch the real home in tests.** Everything runs against synthetic fixtures (`--home` injection); a test that reads `os.homedir()` is a bug.
- **Secrets are runtime-assembled in fixtures.** Realistic key literals in source trigger GitHub Push Protection.
- **Failures degrade.** A missing dir, unreadable file or broken JSON shows up as an absence in the report — never a crash.

## Commit style

Short, imperative, emoji-prefixed to match the house style:
`✨ features · 🐛 fixes · 📝 docs · 🔧 CI/build`.

## Filing issues

Include: the exact command, `--json` output where applicable (redact anything
private), Node version, and what you expected vs got.
