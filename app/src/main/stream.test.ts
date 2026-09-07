import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStream } from "./stream";
import type { ExtractEvent } from "../shared/types";

function fakeScript(body: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "strm-"));
  const path = join(dir, "fake.mjs");
  writeFileSync(path, body);
  return { dir, path };
}

test("runStream transfère les events NDJSON et résout au result", async () => {
  const { dir, path } = fakeScript(
    `process.stdout.write(JSON.stringify({type:"progress",key:"A",step:"start"})+"\\n");
     process.stdout.write("ceci n'est pas du JSON\\n");
     process.stdout.write(JSON.stringify({type:"result",ok:1,ko:0,skipped:0})+"\\n");`,
  );
  const events: ExtractEvent[] = [];
  const { done } = runStream(path, [], { cwd: dir, onEvent: (e) => events.push(e) });
  const res = await done;
  expect(events.some((e) => e.type === "progress")).toBe(true);
  expect(res).toEqual({ type: "result", ok: 1, ko: 0, skipped: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("runStream rejette avec le stderr si exit≠0 sans result", async () => {
  const { dir, path } = fakeScript(`process.stderr.write("boom"); process.exit(1);`);
  const { done } = runStream(path, [], { cwd: dir, onEvent: () => {} });
  await expect(done).rejects.toThrow(/boom/);
  rmSync(dir, { recursive: true, force: true });
});

// Générique : réutilisable avec un autre type d'événement (ex. QA).
type QaLike = { type: "ship"; key: string } | { type: "result"; conforme: boolean };

test("runStream est générique sur le type d'événement (QA) et résout au result", async () => {
  const { dir, path } = fakeScript(
    `process.stdout.write(JSON.stringify({type:"ship",key:"TST"})+"\\n");
     process.stdout.write(JSON.stringify({type:"result",conforme:true,ships:1,hard:0,warns:0})+"\\n");`,
  );
  const events: QaLike[] = [];
  const { done } = runStream<QaLike>(path, [], { cwd: dir, onEvent: (e) => events.push(e) });
  const res = await done;
  expect(events.some((e) => e.type === "ship")).toBe(true);
  expect(res).toMatchObject({ type: "result", conforme: true });
  rmSync(dir, { recursive: true, force: true });
});

test("runStream résout emptyResult si le process sort en 0 sans result", async () => {
  const { dir, path } = fakeScript(`process.stdout.write("rien de typé\\n"); process.exit(0);`);
  const empty: ExtractEvent = { type: "result", ok: 0, ko: 0, skipped: 0 };
  const { done } = runStream(path, [], { cwd: dir, onEvent: () => {}, emptyResult: empty });
  expect(await done).toEqual(empty);
  rmSync(dir, { recursive: true, force: true });
});
