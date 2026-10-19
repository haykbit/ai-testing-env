import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reevaluateRun, type RunTrace } from "./index.js";

describe("reevaluateRun", () => {
  it("creates linked evidence without changing or executing the source", async () => {
    const source = exampleRun();
    const before = structuredClone(source);
    let evaluations = 0;

    const result = await reevaluateRun(source, [{
      id: "output-length",
      evaluate(run) {
        evaluations += 1;
        assert.throws(() => {
          (run.steps as RunTrace["steps"]).push(run.steps[0]!);
        }, TypeError);
        return {
          name: "output length",
          passed: String(run.output).length > 3,
          actual: String(run.output).length,
        };
      },
    }], {
      runId: "reevaluation-1",
      now: sequenceDates(
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T10:00:00.004Z",
      ),
    });

    assert.equal(evaluations, 1);
    assert.deepEqual(source, before);
    assert.equal(result.id, "reevaluation-1");
    assert.equal(result.sourceRunId, source.id);
    assert.equal(result.status, "passed");
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.input, { sourceRunId: source.id });
    assert.deepEqual(result.tags, ["mocked", "reevaluation"]);
  });

  it("turns evaluator errors into deterministic failed evidence", async () => {
    const result = await reevaluateRun(exampleRun(), [{
      id: "broken",
      evaluate() {
        throw new Error("invalid rule");
      },
    }]);

    assert.equal(result.status, "errored");
    assert.deepEqual(result.evaluations, [{
      name: "broken",
      passed: false,
      message: "Evaluator errored: invalid rule",
      error: { name: "Error", message: "invalid rule" },
    }]);
  });
});

function exampleRun(): RunTrace {
  return {
    schemaVersion: 1,
    id: "source-1",
    projectId: "project",
    profileId: "mocked",
    flowId: "answer",
    scenarioId: "happy",
    status: "passed",
    startedAt: "2026-10-19T09:00:00.000Z",
    finishedAt: "2026-10-19T09:00:00.001Z",
    durationMs: 1,
    input: "question",
    output: "answer",
    steps: [{
      id: "external",
      name: "external",
      kind: "http",
      status: "passed",
      startedAt: "2026-10-19T09:00:00.000Z",
      finishedAt: "2026-10-19T09:00:00.001Z",
      durationMs: 1,
      metadata: {},
      evaluations: [],
      capabilities: ["network"],
    }],
    evaluations: [],
    tags: ["mocked"],
  };
}

function sequenceDates(...values: string[]): () => Date {
  return () => new Date(values.shift()!);
}
