import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  builtInProfiles,
  defineFlow,
  defineScenario,
  redactRunTrace,
  runScenario,
} from "@ai-testing-env/core";
import {
  FetchHttpAdapter,
  FileHttpFixtureRepository,
  HttpFixtureNotFoundError,
  MockHttpAdapter,
  RecordingHttpAdapter,
  ReplayHttpAdapter,
  httpFixtureKey,
  runHttpStep,
  type HttpFixture,
  type HttpFixtureRepository,
  type HttpRequest,
  type HttpResponse,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("HTTP adapters", () => {
  it("gives mock and replay the same deterministic port without network", async () => {
    const request: HttpRequest = {
      method: "POST",
      url: "https://service.test/items",
      headers: { "content-type": "application/json" },
      body: { name: "test" },
    };
    const expected: HttpResponse<{ id: number }> = {
      status: 201,
      headers: { "content-type": "application/json" },
      body: { id: 7 },
      durationMs: 0,
    };
    const mock = new MockHttpAdapter(() => expected);
    const fixtures = new MemoryHttpFixtureRepository({
      schemaVersion: 1,
      key: httpFixtureKey(request),
      recordedAt: "2026-10-19T10:00:00.000Z",
      request,
      response: expected,
    });
    const replay = new ReplayHttpAdapter({ fixtures });

    assert.deepEqual(await mock.execute(request), expected);
    assert.deepEqual(await replay.execute(request), expected);
    assert.deepEqual(mock.capabilities, []);
    assert.deepEqual(replay.capabilities, []);
  });

  it("records a redacted integration fixture and replays by stable key", async () => {
    const request: HttpRequest = {
      method: "GET",
      url: "https://service.test/items?token=first-secret",
      headers: { authorization: "Bearer first-secret" },
    };
    const fixtures = new MemoryHttpFixtureRepository();
    const delegate = new MockHttpAdapter(() => ({
      status: 200,
      headers: {},
      body: { token: "first-secret" },
      durationMs: 2,
    }));
    const recording = new RecordingHttpAdapter({
      delegate,
      fixtures,
      now: () => new Date("2026-10-19T10:00:00.000Z"),
    });

    await recording.execute(request);

    assert.equal(fixtures.saved?.request.headers?.authorization, "[REDACTED]");
    assert.match(fixtures.saved?.request.url ?? "", /%5BREDACTED%5D/);
    assert.equal(fixtures.saved?.recordedAt, "2026-10-19T10:00:00.000Z");
    assert.equal(
      httpFixtureKey(request),
      httpFixtureKey({
        ...request,
        url: "https://service.test/items?token=different-secret",
        headers: { authorization: "Bearer different-secret" },
      }),
    );
  });

  it("checks the Profile before integration fetch and captures safe evidence", async () => {
    let calls = 0;
    const times = [10, 27];
    const adapter = new FetchHttpAdapter({
      now: () => times.shift() ?? 27,
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ ok: true, password: "hidden" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-1",
            "set-cookie": "session=hidden",
          },
        });
      },
    });
    const flow = defineFlow<void, number>({
      id: "fetch-item",
      async execute(context) {
        const response = await runHttpStep(context, adapter, {
          id: "request",
          request: {
            method: "GET",
            url: "https://user:password@service.test/items?token=hidden",
            headers: {
              accept: "application/json",
              authorization: "Bearer hidden",
            },
          },
        });
        return response.status;
      },
    });
    const scenario = defineScenario({
      id: "integration",
      flowId: flow.id,
      input: undefined,
    });

    const blocked = await runScenario(flow, scenario, { projectId: "http" });
    assert.equal(blocked.status, "errored");
    assert.equal(calls, 0);

    const profile = builtInProfiles.find((entry) => entry.id === "integration")!;
    const run = redactRunTrace(await runScenario(flow, scenario, {
      projectId: "http",
      profile,
    }));

    assert.equal(run.status, "passed");
    assert.equal(calls, 1);
    assert.deepEqual(run.steps[0]?.capabilities, ["network"]);
    assert.equal(run.steps[0]?.metadata.method, "GET");
    assert.match(String(run.steps[0]?.metadata.url), /%5BREDACTED%5D/);
    assert.deepEqual(
      (run.steps[0]?.input as { headers: unknown }).headers,
      { accept: "application/json" },
    );
    const response = run.steps[0]?.output as HttpResponse;
    assert.equal(response.status, 200);
    assert.deepEqual(response.headers, {
      "content-type": "application/json",
      "x-request-id": "request-1",
    });
    assert.deepEqual(response.body, { ok: true, password: "[REDACTED]" });
    assert.equal(response.durationMs, 17);
  });

  it("returns non-2xx responses and reports transport, parsing, and replay errors", async () => {
    const notFound = new FetchHttpAdapter({
      fetch: async () => new Response("missing", { status: 404 }),
    });
    assert.equal(
      (await notFound.execute({ method: "GET", url: "https://service.test" })).status,
      404,
    );

    const invalidJson = new FetchHttpAdapter({
      fetch: async () => new Response("not-json", {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    });
    await assert.rejects(
      invalidJson.execute({ method: "GET", url: "https://service.test" }),
      /declared JSON but contained invalid JSON/,
    );

    const replay = new ReplayHttpAdapter({
      fixtures: new MemoryHttpFixtureRepository(),
    });
    await assert.rejects(
      replay.execute({ method: "GET", url: "https://service.test" }),
      (error: unknown) => error instanceof HttpFixtureNotFoundError,
    );
  });

  it("round-trips fixtures through JSON storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "http-fixtures-"));
    temporaryDirectories.push(directory);
    const repository = new FileHttpFixtureRepository(directory);
    const request: HttpRequest = { method: "GET", url: "https://service.test" };
    const fixture: HttpFixture = {
      schemaVersion: 1,
      key: httpFixtureKey(request),
      recordedAt: "2026-10-19T10:00:00.000Z",
      request,
      response: { status: 200, headers: {}, body: "ok", durationMs: 1 },
    };

    await repository.save(fixture);

    assert.deepEqual(await repository.get(fixture.key), fixture);
  });
});

class MemoryHttpFixtureRepository implements HttpFixtureRepository {
  saved: HttpFixture | undefined;

  constructor(fixture?: HttpFixture) {
    this.saved = fixture;
  }

  async get(key: string): Promise<HttpFixture | undefined> {
    return this.saved?.key === key ? this.saved : undefined;
  }

  async save(fixture: HttpFixture): Promise<void> {
    this.saved = fixture;
  }
}
