import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEmitter } from "./emit.mjs";

test("makeEmitter écrit du NDJSON quand actif", () => {
  const lines = [];
  const emit = makeEmitter(true, (s) => lines.push(s));
  emit({ type: "progress", key: "X" });
  emit({ type: "result", ok: 1 });
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { type: "progress", key: "X" });
  assert.ok(lines[0].endsWith("\n"));
});

test("makeEmitter est muet quand inactif", () => {
  const lines = [];
  const emit = makeEmitter(false, (s) => lines.push(s));
  emit({ type: "progress" });
  assert.equal(lines.length, 0);
});
