import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RunRepository, RunTrace } from "@ai-testing-env/core";
import { startDashboardServer, type RunningDashboardServer } from "./server.js";

const servers: RunningDashboardServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("dashboard server", () => {
  it("projects repository runs through list and detail APIs", async () => {
    const run = exampleRun();
    const server = await startServer([run]);

    const listResponse = await fetch(`${server.url}/api/runs`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), {
      runs: [
        {
          id: run.id,
          projectId: run.projectId,
          flowId: run.flowId,
          scenarioId: run.scenarioId,
          status: run.status,
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          stepCount: 1,
          tags: ["mocked"],
        },
      ],
    });

    const detailResponse = await fetch(`${server.url}/api/runs/${run.id}`);
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(await detailResponse.json(), { run });
  });

  it("renders navigable run evidence without exposing trace values as HTML", async () => {
    const run = exampleRun({ scenarioId: "<script>alert('unsafe')</script>" });
    const server = await startServer([run]);

    const listResponse = await fetch(server.url);
    const listHtml = await listResponse.text();
    assert.equal(listResponse.status, 200);
    assert.match(listHtml, /Run evidence/);
    assert.match(listHtml, /&lt;script&gt;alert\(&#039;unsafe&#039;\)&lt;\/script&gt;/);
    assert.doesNotMatch(listHtml, /<script>/);

    const detailResponse = await fetch(`${server.url}/runs/${run.id}`);
    const detailHtml = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.match(detailHtml, /Trace steps/);
    assert.match(detailHtml, /generate-answer/);
    assert.match(detailHtml, /mentions testing/);
    assert.equal(
      detailResponse.headers.get("content-security-policy"),
      "default-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
  });

  it("returns useful HTTP errors and does not forward path-like run ids", async () => {
    const repository = new MemoryRunRepository([]);
    const server = await startDashboardServer({ repository, port: 0 });
    servers.push(server);

    const missingResponse = await fetch(`${server.url}/api/runs/missing`);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: "Run not found" });

    const traversalResponse = await fetch(`${server.url}/api/runs/..%2Foutside`);
    assert.equal(traversalResponse.status, 404);
    assert.deepEqual(repository.requestedIds, ["missing"]);

    const methodResponse = await fetch(`${server.url}/api/runs`, { method: "POST" });
    assert.equal(methodResponse.status, 405);
    assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");
  });
});

async function startServer(runs: RunTrace[]): Promise<RunningDashboardServer> {
  const server = await startDashboardServer({
    repository: new MemoryRunRepository(runs),
    port: 0,
  });
  servers.push(server);
  return server;
}

class MemoryRunRepository implements RunRepository {
  readonly requestedIds: string[] = [];

  constructor(private readonly runs: RunTrace[]) {}

  async save(run: RunTrace): Promise<void> {
    this.runs.push(run);
  }

  async list(): Promise<RunTrace[]> {
    return this.runs;
  }

  async get(id: string): Promise<RunTrace | undefined> {
    this.requestedIds.push(id);
    return this.runs.find((run) => run.id === id);
  }
}

function exampleRun(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    schemaVersion: 1,
    id: "run-1",
    projectId: "example-backend",
    flowId: "answer-question",
    scenarioId: "happy-path",
    status: "passed",
    startedAt: "2026-10-19T08:00:00.000Z",
    finishedAt: "2026-10-19T08:00:00.032Z",
    durationMs: 32,
    input: { question: "Why test AI?" },
    output: "To make behavior observable.",
    steps: [
      {
        id: "generate-answer",
        name: "generate-answer",
        kind: "ai",
        status: "passed",
        startedAt: "2026-10-19T08:00:00.000Z",
        finishedAt: "2026-10-19T08:00:00.030Z",
        durationMs: 30,
        input: { question: "Why test AI?" },
        output: "Testing makes AI behavior observable.",
        metadata: { model: "deterministic-test-model" },
        evaluations: [{ name: "mentions testing", passed: true }],
      },
    ],
    evaluations: [],
    tags: ["mocked"],
    ...overrides,
  };
}
