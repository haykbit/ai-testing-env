import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { FileRunRepository, compareRuns, type RunTrace } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Run queries and comparison", () => {
  it("combines filters and paginates with a stable cursor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "run-query-"));
    temporaryDirectories.push(directory);
    const repository = new FileRunRepository(directory);
    await Promise.all([
      repository.save(exampleRun("run-b", "2026-10-19T10:00:00.000Z", { tags: ["smoke", "api"] })),
      repository.save(exampleRun("run-a", "2026-10-19T10:00:00.000Z", { tags: ["smoke", "api"] })),
      repository.save(exampleRun("run-c", "2026-10-19T09:00:00.000Z", { tags: ["smoke", "api"] })),
      repository.save(exampleRun("run-other", "2026-10-19T11:00:00.000Z", {
        projectId: "other", tags: ["smoke"], status: "failed",
      })),
    ]);

    const first = await repository.query({
      projectId: "project", flowId: "flow", scenarioId: "scenario",
      status: "passed", tags: ["smoke", "api"],
      startedFrom: "2026-10-19T08:00:00.000Z",
      startedTo: "2026-10-19T10:00:00.000Z", limit: 2,
    });
    assert.deepEqual(first.runs.map((run) => run.id), ["run-a", "run-b"]);
    assert.ok(first.nextCursor);

    const second = await repository.query({
      projectId: "project", tags: ["smoke", "api"],
      cursor: first.nextCursor, limit: 2,
    });
    assert.deepEqual(second.runs.map((run) => run.id), ["run-c"]);
    assert.equal(second.nextCursor, undefined);
    await assert.rejects(repository.query({ cursor: "bad" }), /Invalid Run query cursor/);
  });

  it("compares changed and missing values across different Trace shapes", () => {
    const left = exampleRun("left", "2026-10-19T10:00:00.000Z", {
      output: { answer: "old" }, durationMs: 10,
      steps: [step("shared", { output: { usage: { totalTokens: 4 } } }), step("removed")],
      evaluations: [{ name: "quality", passed: true, score: 4 }],
    });
    const right = exampleRun("right", "2026-10-19T11:00:00.000Z", {
      output: undefined, durationMs: 15,
      steps: [step("shared", { status: "failed" }), step("added")],
      evaluations: [{ name: "quality", passed: false, score: 2 }, { name: "new", passed: true }],
    });

    const comparison = compareRuns(left, right);

    assert.equal(comparison.compatible, true);
    assert.deepEqual(comparison.output, {
      changed: true, beforePresent: true, afterPresent: false,
      before: { answer: "old" },
    });
    assert.deepEqual(
      comparison.steps.map((entry) => [entry.id, entry.change]),
      [["added", "added"], ["removed", "removed"], ["shared", "changed"]],
    );
    assert.deepEqual(comparison.duration, { beforeMs: 10, afterMs: 15, deltaMs: 5 });
    assert.deepEqual(comparison.tokens, {
      changed: true, beforePresent: true, afterPresent: false, before: 4,
    });
    assert.equal(comparison.evaluations[0]?.change, "added");
    assert.equal(comparison.evaluations[1]?.change, "changed");
    assert.equal(compareRuns(left, { ...right, scenarioId: "other" }).compatible, false);
  });
});

function exampleRun(id: string, startedAt: string, overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    schemaVersion: 1, id, projectId: "project", profileId: "mocked",
    flowId: "flow", scenarioId: "scenario", status: "passed",
    startedAt, finishedAt: startedAt, durationMs: 0, input: null,
    steps: [], evaluations: [], tags: [], ...overrides,
  };
}

function step(id: string, overrides: Partial<RunTrace["steps"][number]> = {}): RunTrace["steps"][number] {
  return {
    id, name: id, kind: "code", status: "passed",
    startedAt: "2026-10-19T10:00:00.000Z",
    finishedAt: "2026-10-19T10:00:00.000Z", durationMs: 0,
    metadata: {}, evaluations: [], capabilities: [], ...overrides,
  };
}
