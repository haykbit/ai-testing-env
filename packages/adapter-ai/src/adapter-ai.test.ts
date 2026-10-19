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
  FetchOpenAIResponsesTransport,
  OpenAIResponsesAdapter,
  OpenAIResponsesApiError,
  OpenAIResponsesConfigurationError,
  RecordingAiAdapter,
  ReplayAiAdapter,
  aiFixtureKey,
  runAiStep,
  type AiAdapter,
  type AiFixture,
  type AiFixtureRepository,
  type AiRequest,
  type AiResponse,
  type OpenAIResponsesTransport,
  type OpenAIResponsesTransportAuth,
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

describe("OpenAI Responses adapter", () => {
  it("maps requests and normalizes text, tool calls, usage, and latency", async () => {
    const transport = new FakeOpenAITransport({
      id: "resp_123",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Done" }],
        },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "lookup",
          arguments: "{\"topic\":\"testing\"}",
        },
      ],
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    });
    const times = [100, 137];
    const adapter = new OpenAIResponsesAdapter({
      apiKey: "secret-key",
      transport,
      now: () => times.shift()!,
    });

    const response = await adapter.execute<string>({
      model: "gpt-test",
      messages: [{ role: "user", content: "Help" }],
      tools: [{
        name: "lookup",
        description: "Find data",
        inputSchema: { type: "object", required: ["topic"] },
      }],
    });

    assert.equal(transport.auth?.apiKey, "secret-key");
    assert.equal(transport.request?.store, false);
    assert.deepEqual(transport.request?.input, [{ role: "user", content: "Help" }]);
    assert.deepEqual(response, {
      output: "Done",
      text: "Done",
      toolCalls: [{ id: "call_1", name: "lookup", input: { topic: "testing" } }],
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
      latencyMs: 37,
      providerResponseId: "resp_123",
    });
    assert.doesNotMatch(JSON.stringify(response), /secret-key/);
    assert.deepEqual(adapter.capabilities, ["network", "spend"]);
  });

  it("requests and parses strict structured output", async () => {
    const transport = new FakeOpenAITransport({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "{\"answer\":42}" }],
      }],
    });
    const adapter = new OpenAIResponsesAdapter({
      apiKey: "secret-key",
      transport,
      now: () => 0,
    });

    const response = await adapter.execute<{ answer: number }>({
      model: "gpt-test",
      prompt: "Answer",
      responseSchema: {
        type: "object",
        properties: { answer: { type: "number" } },
        required: ["answer"],
        additionalProperties: false,
      },
    });

    assert.deepEqual(response.output, { answer: 42 });
    assert.deepEqual(
      (transport.request?.text as { format: { type: string } }).format.type,
      "json_schema",
    );
  });

  it("fails fast without credentials", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(
        () => new OpenAIResponsesAdapter(),
        (error: unknown) => error instanceof OpenAIResponsesConfigurationError,
      );
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });

  it("sends one authenticated request and exposes a sanitized API error", async () => {
    let calls = 0;
    let authorization: string | null = null;
    const transport = new FetchOpenAIResponsesTransport({
      fetch: async (_input, init) => {
        calls += 1;
        authorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({
          error: { message: "quota exhausted" },
        }), {
          status: 429,
          headers: { "x-request-id": "req_123" },
        });
      },
    });
    const adapter = new OpenAIResponsesAdapter({
      apiKey: "secret-key",
      transport,
    });

    await assert.rejects(
      adapter.execute({ model: "gpt-test", prompt: "Hello" }),
      (error: unknown) => {
        assert.ok(error instanceof OpenAIResponsesApiError);
        assert.equal(error.status, 429);
        assert.equal(error.requestId, "req_123");
        assert.equal(error.message, "quota exhausted");
        assert.doesNotMatch(error.message, /secret-key/);
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.equal(authorization, "Bearer secret-key");
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

class FakeOpenAITransport implements OpenAIResponsesTransport {
  request: Readonly<Record<string, unknown>> | undefined;
  auth: OpenAIResponsesTransportAuth | undefined;

  constructor(private readonly response: unknown) {}

  async create(
    request: Readonly<Record<string, unknown>>,
    auth: OpenAIResponsesTransportAuth,
  ): Promise<unknown> {
    this.request = request;
    this.auth = auth;
    return this.response;
  }
}
