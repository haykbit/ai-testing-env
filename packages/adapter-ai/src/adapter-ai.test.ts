import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defineFlow, defineScenario, runScenario } from "@ai-testing-env/core";
import {
  AiFixtureCorruptError,
  AiFixtureNotFoundError,
  FileAiFixtureRepository,
  MockAiAdapter,
  RecordingAiAdapter,
  ReplayAiAdapter,
  aiFixtureKey,
  runAiStep,
  type AiAdapter,
  type AiFixture,
  type AiFixtureRepository,
  type AiRequest,
  type AiResponse,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AI adapter", () => {
  it("runs a deterministic mock and captures normalized AI evidence", async () => {
    const adapter = new MockAiAdapter((request) => ({
      output: { answer: `About ${request.prompt}` },
      text: `About ${request.prompt}`,
      toolCalls: [{ id: "call-1", name: "lookup", input: { topic: "testing" } }],
      usage: { inputTokens: 4, outputTokens: 7, totalTokens: 11 },
      latencyMs: 3,
    }));
    const flow = defineFlow<string, string>({
      id: "answer",
      async execute(context, input) {
        const response = await runAiStep<{ answer: string }>(context, adapter, {
          id: "generate-answer",
          request: {
            model: "deterministic-model",
            prompt: input,
            messages: [{ role: "user", content: input }],
            tools: [{ name: "lookup", inputSchema: { type: "object" } }],
            responseSchema: { type: "object", required: ["answer"] },
          },
        });
        return response.output.answer;
      },
    });
    const scenario = defineScenario({
      id: "mocked-answer",
      flowId: flow.id,
      input: "AI testing",
    });

    const run = await runScenario(flow, scenario, { projectId: "ai-adapter" });

    assert.equal(run.status, "passed");
    assert.equal(run.output, "About AI testing");
    assert.deepEqual(run.steps[0]?.capabilities, []);
    assert.equal(run.steps[0]?.metadata.provider, "mock");
    assert.equal(run.steps[0]?.metadata.adapterMode, "mocked");
    assert.equal(run.steps[0]?.metadata.model, "deterministic-model");
    assert.deepEqual(
      (run.steps[0]?.output as AiResponse).usage,
      { inputTokens: 4, outputTokens: 7, totalTokens: 11 },
    );
    assert.equal((run.steps[0]?.output as AiResponse).latencyMs, 3);
  });

  it("records a redacted fixture and replays it without calling the delegate", async () => {
    const fixtures = new MemoryFixtureRepository();
    const delegate = new FakeNetworkAdapter();
    const request: AiRequest = {
      model: "provider-model",
      prompt: "Explain testing",
      metadata: { Authorization: "Bearer first-secret" },
    };
    const recording = new RecordingAiAdapter({
      delegate,
      fixtures,
      now: () => new Date("2026-10-19T10:00:00.000Z"),
    });

    const recordedResponse = await recording.execute(request);

    assert.equal(delegate.calls, 1);
    assert.equal(recordedResponse.text, "Recorded answer");
    assert.equal(fixtures.saved?.recordedAt, "2026-10-19T10:00:00.000Z");
    assert.equal(
      fixtures.saved?.request.metadata?.Authorization,
      "[REDACTED]",
    );

    const replay = new ReplayAiAdapter({ fixtures, provider: "fake-provider" });
    const replayedResponse = await replay.execute({
      ...request,
      metadata: { Authorization: "Bearer different-secret" },
    });

    assert.equal(delegate.calls, 1);
    assert.deepEqual(replayedResponse, fixtures.saved?.response);
    assert.deepEqual(replay.capabilities, []);
  });

  it("uses stable redacted keys and reports replay misses", async () => {
    const left: AiRequest = {
      model: "model",
      prompt: "hello",
      metadata: { Authorization: "Bearer one", region: "eu" },
    };
    const right: AiRequest = {
      metadata: { region: "eu", Authorization: "Bearer two" },
      prompt: "hello",
      model: "model",
    };
    assert.equal(aiFixtureKey(left), aiFixtureKey(right));

    const replay = new ReplayAiAdapter({
      fixtures: new MemoryFixtureRepository(),
    });
    await assert.rejects(
      replay.execute(left),
      (error: unknown) => error instanceof AiFixtureNotFoundError,
    );
  });

  it("reports corrupt fixture files with the fixture key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-fixtures-"));
    temporaryDirectories.push(directory);
    const key = "a".repeat(64);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${key}.json`), "not-json", "utf8");
    const repository = new FileAiFixtureRepository(directory);

    await assert.rejects(
      repository.get(key),
      (error: unknown) =>
        error instanceof AiFixtureCorruptError && error.key === key,
    );
  });

  it("round-trips valid fixtures through local JSON storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-fixtures-"));
    temporaryDirectories.push(directory);
    const repository = new FileAiFixtureRepository(directory);
    const request: AiRequest = { model: "model", prompt: "hello" };
    const fixture: AiFixture = {
      schemaVersion: 1,
      key: aiFixtureKey(request),
      provider: "fake",
      recordedAt: "2026-10-19T10:00:00.000Z",
      request,
      response: { output: "hello", text: "hello" },
    };

    await repository.save(fixture);

    assert.deepEqual(await repository.get(fixture.key), fixture);
  });
});

class MemoryFixtureRepository implements AiFixtureRepository {
  saved: AiFixture | undefined;

  async get(key: string): Promise<AiFixture | undefined> {
    return this.saved?.key === key ? this.saved : undefined;
  }

  async save(fixture: AiFixture): Promise<void> {
    this.saved = fixture;
  }
}

class FakeNetworkAdapter implements AiAdapter {
  readonly provider = "fake-provider";
  readonly mode = "record" as const;
  readonly capabilities = ["network"] as const;
  calls = 0;

  async execute<T = unknown>(_request: AiRequest): Promise<AiResponse<T>> {
    this.calls += 1;
    return {
      output: { answer: "Recorded answer" } as T,
      text: "Recorded answer",
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      latencyMs: 5,
    };
  }
}
