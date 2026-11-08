import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirSize, topChildren, staleBytes, humanBytes, staleCutoff } from "../src/disk.js";

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "aj-disk-"));
const write = (p, bytes) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
};

test("dirSize: sums files, counts them, tracks age bounds", () => {
  const d = mk();
  write(path.join(d, "a.jsonl"), 100);
  write(path.join(d, "sub", "b.jsonl"), 50);
  const s = dirSize(d);
  assert.equal(s.bytes, 150);
  assert.equal(s.files, 2);
  assert.ok(s.oldest && s.newest);
});

test("dirSize: node_modules is skipped entirely", () => {
  const d = mk();
  write(path.join(d, "keep.bin"), 10);
  write(path.join(d, "node_modules", "huge", "x.bin"), 5000);
  const s = dirSize(d);
  assert.equal(s.bytes, 10);
  assert.equal(s.files, 1);
});

test("dirSize: unreadable dirs are skipped, not thrown", () => {
  const d = mk();
  write(path.join(d, "ok.txt"), 5);
  const secret = path.join(d, "locked");
  fs.mkdirSync(secret);
  fs.chmodSync(secret, 0o000);
  try {
    const s = dirSize(d);
    assert.ok(s.bytes >= 5);
  } finally {
    fs.chmodSync(secret, 0o755);
  }
});

test("topChildren: biggest subdirs first, limited", () => {
  const d = mk();
  write(path.join(d, "small", "x"), 10);
  write(path.join(d, "big", "y"), 1000);
  write(path.join(d, "mid", "z"), 100);
  const top = topChildren(d, 2);
  assert.deepEqual(top.map((t) => t.name), ["big", "mid"]);
});

test("staleBytes: only files older than the cutoff count", () => {
  const d = mk();
  write(path.join(d, "old.jsonl"), 500);
  write(path.join(d, "new.jsonl"), 100);
  const oldFile = path.join(d, "old.jsonl");
  const past = new Date(Date.now() - 200 * 864e5);
  fs.utimesSync(oldFile, past, past);
  const s = staleBytes(d, staleCutoff(Date.now(), 90));
  assert.equal(s.bytes, 500);
  assert.equal(s.files, 1);
});

test("humanBytes: the usual ladder", () => {
  assert.equal(humanBytes(0), "0 B");
  assert.equal(humanBytes(999), "999 B");
  assert.equal(humanBytes(1024), "1.0 KB");
  assert.equal(humanBytes(459 * 1024 * 1024), "459 MB");
  assert.equal(humanBytes(1.4 * 1024 ** 3), "1.4 GB");
});
