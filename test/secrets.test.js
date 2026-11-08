import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scanText,
  maskSecret,
  isScannableFile,
  dedupeFindings,
  scanCliPaths,
} from "../src/secrets.js";

test("maskSecret keeps head and tail, hides the middle", () => {
  assert.equal(maskSecret("sk-ant-api03-abcdef1234567890xyz"), "sk-ant…0xyz");
  assert.equal(maskSecret("short"), "sho****");
});

test("scanText: every provider pattern fires", () => {
  // Every sample is built at runtime — realistic-looking key literals must
  // never appear in source, or GitHub Push Protection blocks the push.
  const samples = {
    anthropic: "sk-ant-api03-" + "AbCd".repeat(6),
    openai: "sk-proj-" + "AbCd".repeat(7),
    "openai-legacy": "sk-" + "AbCdEfGhIj" + "T3BlbkFJ" + "AbCd".repeat(6),
    deepseek: "sk-" + "a".repeat(32),
    github: "ghp_" + "A".repeat(36),
    "github-pat": "github_pat_" + "A".repeat(30) + "_1234",
    aws: "AKIA" + "IOSFODNN7EXAMPLE".slice(0, 4) + "IODNN7EXAMPLE".slice(0, 12),
    slack: "xoxb-" + "123456789012-" + "abcdef",
    gitlab: "glpat-" + "AbCd".repeat(5),
    google: "AIza" + "SyA".repeat(11) + "xyz",
    groq: "gsk_" + "A".repeat(24),
    openrouter: "sk-or-v1-" + "a".repeat(32),
  };
  for (const [kind, secret] of Object.entries(samples)) {
    const hits = scanText(`here is my key ${secret} ok`);
    assert.equal(hits.length, 1, `${kind} should fire`);
    assert.equal(hits[0].kind, kind);
    assert.ok(!hits[0].masked.includes(secret.slice(6, -4)), `${kind} must be masked`);
  }
});

test("scanText: normal text and hp-style ids stay quiet", () => {
  assert.deepEqual(scanText("no secrets here, just sk- shorts and chat"), []);
  assert.deepEqual(scanText("xoxb" + " short"), []);
});

test("isScannableFile: text in, binaries and giants out", () => {
  assert.equal(isScannableFile("session.jsonl", 1000), true);
  assert.equal(isScannableFile(".env", 100), true);
  assert.equal(isScannableFile("rollout-2026.jsonl", 6 * 1024 * 1024), false);
  assert.equal(isScannableFile("model.bin", 100), false);
  assert.equal(isScannableFile("README", 100), true);
});

test("dedupeFindings: same key across files collapses with a count", () => {
  const hits = [
    { kind: "github", label: "GitHub", masked: "ghp_A…xyz", raw: "x", file: "/a.jsonl" },
    { kind: "github", label: "GitHub", masked: "ghp_A…xyz", raw: "x", file: "/b.jsonl" },
    { kind: "aws", label: "AWS", masked: "AKIA…AMPLE", raw: "y", file: "/a.jsonl" },
  ];
  const dedup = dedupeFindings(hits);
  assert.equal(dedup.length, 2);
  const gh = dedup.find((d) => d.kind === "github");
  assert.equal(gh.count, 2);
  assert.deepEqual(gh.files, ["/a.jsonl", "/b.jsonl"]);
});

test("scanCliPaths: end-to-end over a synthetic CLI dir with kindOf split", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "aj-scan-"));
  fs.writeFileSync(
    path.join(d, "config.json"),
    JSON.stringify({ apiKey: "ghp_" + "A".repeat(36) }),
  );
  const sess = path.join(d, "sessions");
  fs.mkdirSync(sess);
  fs.writeFileSync(
    path.join(sess, "s1.jsonl"),
    ["user: my key is ", "sk-ant-api03-", "AbCd".repeat(6), " please\n"].join(""),
  );
  fs.writeFileSync(path.join(d, "blob.bin"), Buffer.alloc(10, 0));

  const { findings, scannedFiles } = await scanCliPaths([d], {
    kindOf: (p) => (p.includes("sessions") ? "transcript" : "config"),
  });
  const config = findings.find((f) => f.kind2 === "config");
  const transcript = findings.find((f) => f.kind2 === "transcript");
  assert.ok(config, "config key found");
  assert.equal(config.kind, "github");
  assert.ok(transcript, "transcript leak found");
  assert.equal(transcript.kind, "anthropic");
  assert.ok(scannedFiles >= 2);
  assert.ok(!findings.some((f) => f.file.endsWith(".bin")), "binaries skipped");
});
