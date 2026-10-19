import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  FileRunRepository,
  defineFlow,
  defineScenario,
  hasFields,
  matches,
  runScenario,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runScenario", () => {
  it("captures and evaluates a complete backend and AI flow", async () => {
    const flow = defineFlow<{ topic: string }, { slug: string; summary: string }>({
      id: "publish-content",
      async execute(context, input) {
        const draft = await context.step(
          {
            id: "generate-draft",
            kind: "ai",
            input,
            metadata: {
              provider: "fake",
              model: "deterministic-test-model",
              prompt: "Write about {{topic}}",
            },
            evaluators: [matches("mentions topic", /testing/i)],
          },
          () => `A practical guide to ${input.topic}`,
        );

        const structured = await context.step(
          {
            id: "structure-content",
            kind: "ai",
            input: draft,
            evaluators: [
              hasFields<{ title: string; body: string }>("has typed fields", [
                "title",
                "body",
              ]),
            ],
          },
          () => ({ title: input.topic, body: draft }),
        );

        const slug = await context.step(
          { id: "create-slug", kind: "code", input: structured.title },
          () => structured.title.toLowerCase().replaceAll(" ", "-"),
        );

        const summary = await context.step(
          { id: "postprocess", kind: "ai", input: structured },
          () => structured.body.toUpperCase(),
        );

        return { slug, summary };
      },
    });
    const scenario = defineScenario({
      id: "happy-path",
      flowId: flow.id,
      input: { topic: "AI testing" },
      tags: ["mocked"],
    });

    const run = await runScenario(flow, scenario, {
      projectId: "example-backend",
      runId: "run-1",
    });

    assert.equal(run.status, "passed");
    assert.equal(run.steps.length, 4);
    assert.deepEqual(
      run.steps.map((step) => step.kind),
      ["ai", "ai", "code", "ai"],
    );
    assert.deepEqual(run.output, {
      slug: "ai-testing",
      summary: "A PRACTICAL GUIDE TO AI TESTING",
    });
    assert.equal(run.steps[0]?.metadata.prompt, "Write about {{topic}}");
  });

  it("keeps the output and evidence when an evaluation fails", async () => {
    const flow = defineFlow<string, string>({
      id: "moderate",
      execute: (context, input) =>
        context.step(
          {
            id: "moderate-text",
            kind: "ai",
            input,
            evaluators: [matches("must be approved", /^approved$/)],
          },
          () => "rejected",
        ),
    });
    const scenario = defineScenario({
      id: "rejection",
      flowId: flow.id,
      input: "unsafe input",
    });

    const run = await runScenario(flow, scenario, {
      projectId: "example-backend",
    });

    assert.equal(run.status, "failed");
    assert.equal(run.output, "rejected");
    assert.equal(run.steps[0]?.evaluations[0]?.passed, false);
  });

  it("records thrown operations as errors", async () => {
    const flow = defineFlow<void, void>({
      id: "failing-database-write",
      execute: (context) =>
        context.step({ id: "insert", kind: "database" }, () => {
          throw new Error("database unavailable");
        }),
    });
    const scenario = defineScenario({
      id: "database-down",
      flowId: flow.id,
      input: undefined,
    });

    const run = await runScenario(flow, scenario, {
      projectId: "example-backend",
    });

    assert.equal(run.status, "errored");
    assert.equal(run.steps[0]?.status, "errored");
    assert.equal(run.error?.message, "database unavailable");
  });
});

describe("FileRunRepository", () => {
  it("persists runs for both the CLI and web dashboard", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-test-runs-"));
    temporaryDirectories.push(directory);
    const repository = new FileRunRepository(directory);
    const flow = defineFlow<string, string>({
      id: "echo",
      execute: (_context, input) => input,
    });
    const scenario = defineScenario({
      id: "echo-value",
      flowId: flow.id,
      input: "hello",
    });
    const run = await runScenario(flow, scenario, {
      projectId: "storage-test",
      runId: "persisted-run",
    });

    await repository.save(run);

    assert.deepEqual(await repository.get(run.id), run);
    assert.deepEqual(await repository.list(), [run]);
    assert.equal(await repository.get("missing"), undefined);
    assert.equal(await repository.get("../../outside"), undefined);
  });

  it("supplies safe Profile defaults when reading schema-v1 legacy Traces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-test-runs-"));
    temporaryDirectories.push(directory);
    const repository = new FileRunRepository(directory);
    await writeFile(
      join(directory, "legacy-run.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "legacy-run",
        projectId: "legacy-project",
        flowId: "legacy-flow",
        scenarioId: "legacy-scenario",
        status: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:00.001Z",
        durationMs: 1,
        input: null,
        steps: [{
          id: "legacy-step",
          name: "legacy-step",
          kind: "code",
          status: "passed",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:00.001Z",
          durationMs: 1,
          metadata: {},
          evaluations: [],
        }],
        evaluations: [],
        tags: [],
      }),
      "utf8",
    );

    const run = await repository.get("legacy-run");

    assert.equal(run?.profileId, "mocked");
    assert.deepEqual(run?.steps[0]?.capabilities, []);
  });
});

