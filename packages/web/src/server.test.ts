import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
  ProjectDefinition,
  RunPage,
  RunQuery,
  RunRepository,
  RunTrace,
} from "@ai-testing-env/core";
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
          profileId: run.profileId,
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
      "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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

  it("exposes reevaluation linkage and evidence in API and dashboard", async () => {
    const reevaluation = exampleRun({
      id: "reevaluation-1",
      sourceRunId: "run-1",
      steps: [],
      evaluations: [{ name: "stored rule", passed: false, message: "changed" }],
      status: "failed",
      tags: ["mocked", "reevaluation"],
    });
    const server = await startServer([reevaluation]);

    const api = await fetch(`${server.url}/api/runs`);
    const payload = await api.json() as { runs: Array<{ sourceRunId?: string }> };
    assert.equal(payload.runs[0]?.sourceRunId, "run-1");

    const detail = await fetch(`${server.url}/runs/reevaluation-1`);
    const html = await detail.text();
    assert.match(html, /Reevaluates/);
    assert.match(html, /href="\/runs\/run-1"/);
    assert.match(html, /stored rule/);
    assert.match(html, /changed/);
  });

  it("shares filtered Run queries and safe comparison through API and dashboard", async () => {
    const left = exampleRun({
      id: "left",
      output: { answer: "before" },
      tags: ["smoke", "api"],
    });
    const right = exampleRun({
      id: "right",
      output: { answer: "after" },
      tags: ["smoke", "api"],
      durationMs: 40,
    });
    const unrelated = exampleRun({
      id: "unrelated",
      flowId: "other",
      tags: ["slow"],
    });
    const server = await startServer([left, right, unrelated]);

    const filtered = await fetch(
      `${server.url}/api/runs?project=example-backend&flow=answer-question&tag=smoke&tag=api&verdict=passed`,
    );
    assert.deepEqual(
      (await filtered.json() as { runs: Array<{ id: string }> }).runs.map((run) => run.id),
      ["left", "right"],
    );

    const comparisonResponse = await fetch(
      `${server.url}/api/compare?left=left&right=right`,
    );
    const comparison = (await comparisonResponse.json() as {
      comparison: { compatible: boolean; output: { changed: boolean } };
    }).comparison;
    assert.equal(comparison.compatible, true);
    assert.equal(comparison.output.changed, true);

    const dashboard = await fetch(
      `${server.url}/compare?left=left&right=right`,
    );
    const html = await dashboard.text();
    assert.match(html, /Run comparison/);
    assert.match(html, /before/);
    assert.match(html, /after/);
  });

  it("creates, conflicts, fails, and completes dashboard executions", async () => {
    const repository = new MemoryRunRepository([]);
    const completion = deferred<RunTrace>();
    const started = deferred<void>();
    let calls = 0;
    const server = await startDashboardServer({
      repository,
      project: dashboardProject(),
      port: 0,
      async execute(scenarioId, options) {
        calls += 1;
        if (scenarioId === "errors") throw new Error("orchestrator unavailable");
        started.resolve(undefined);
        const run = await completion.promise;
        assert.equal(options.profileId, "integration");
        assert.equal(options.allowLive, false);
        await repository.save(run);
        return run;
      },
    });
    servers.push(server);

    const manifestResponse = await fetch(`${server.url}/api/project`);
    const manifest = await manifestResponse.json() as {
      project: {
        flows: unknown[];
        scenarios: unknown[];
        profiles: Array<{
          id: string;
          capabilities: Record<string, boolean>;
          projectAuthorized: boolean;
        }>;
      };
    };
    assert.equal(manifest.project.flows.length, 1);
    assert.equal(manifest.project.scenarios.length, 2);
    assert.equal(
      manifest.project.profiles.find((profile) => profile.id === "integration")
        ?.capabilities.network,
      true,
    );
    assert.equal(
      manifest.project.profiles.find((profile) => profile.id === "live")
        ?.projectAuthorized,
      false,
    );

    const createdResponse = await postJson(`${server.url}/api/executions`, {
      scenarioId: "passes",
      profileId: "integration",
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json() as {
      execution: { id: string; runId: string; status: string };
    };
    assert.equal(created.execution.status, "pending");
    await started.promise;

    const running = await fetch(
      `${server.url}/api/executions/${created.execution.id}`,
    );
    assert.equal((await running.json() as { execution: { status: string } }).execution.status, "running");

    const conflict = await postJson(`${server.url}/api/executions`, {
      scenarioId: "passes",
      profileId: "integration",
    });
    assert.equal(conflict.status, 409);

    completion.resolve(exampleRun({
      id: created.execution.runId,
      scenarioId: "passes",
      profileId: "integration",
    }));
    const completed = await waitForExecution(server.url, created.execution.id, "completed");
    assert.equal(completed.verdict, "passed");
    assert.equal(calls, 1);
    assert.equal((await repository.get(created.execution.runId))?.status, "passed");

    const failedResponse = await postJson(`${server.url}/api/executions`, {
      scenarioId: "errors",
      profileId: "mocked",
    });
    const failedId = (await failedResponse.json() as {
      execution: { id: string };
    }).execution.id;
    const failed = await waitForExecution(server.url, failedId, "failed");
    assert.equal(failed.error, "orchestrator unavailable");

    const blocked = await postJson(`${server.url}/api/executions`, {
      scenarioId: "passes",
      profileId: "live",
      allowLive: true,
    });
    assert.equal(blocked.status, 400);
    assert.match(JSON.stringify(await blocked.json()), /set allowLive: true/);
    assert.equal(calls, 2);
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

  async query(query: RunQuery = {}): Promise<RunPage> {
    return {
      runs: this.runs.filter((run) =>
        (query.projectId === undefined || run.projectId === query.projectId)
        && (query.flowId === undefined || run.flowId === query.flowId)
        && (query.scenarioId === undefined || run.scenarioId === query.scenarioId)
        && (query.status === undefined || run.status === query.status)
        && (query.tags ?? []).every((tag) => run.tags.includes(tag))
      ).slice(0, query.limit ?? 50),
    };
  }
}

function exampleRun(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    schemaVersion: 1,
    id: "run-1",
    projectId: "example-backend",
    profileId: "mocked",
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
        capabilities: [],
      },
    ],
    evaluations: [],
    tags: ["mocked"],
    ...overrides,
  };
}

function dashboardProject(): ProjectDefinition {
  return {
    id: "dashboard-project",
    flows: [{ id: "flow", execute: () => "unused" }],
    scenarios: [
      { id: "passes", flowId: "flow", input: null },
      { id: "errors", flowId: "flow", input: null },
    ],
  };
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForExecution(
  baseUrl: string,
  id: string,
  expected: "completed" | "failed",
): Promise<{ status: string; verdict?: string; error?: string }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/executions/${id}`);
    const execution = (await response.json() as {
      execution: { status: string; verdict?: string; error?: string };
    }).execution;
    if (execution.status === expected) return execution;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Execution ${id} did not reach ${expected}`);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
