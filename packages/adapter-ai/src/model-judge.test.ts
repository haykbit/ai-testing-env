import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  builtInProfiles,
  reevaluateRun,
  type RunTrace,
} from "@ai-testing-env/core";
import {
  MockAiAdapter,
  RecordingAiAdapter,
  ReplayAiAdapter,
  createModelJudge,
  type AiAdapter,
  type AiFixture,
  type AiFixtureRepository,
  type AiRequest,
  type AiResponse,
} from "./index.js";

describe("model judge", () => {
  it("keeps explainable, versioned judgment evidence", async () => {
    const judge = createModelJudge({
      id: "helpfulness",
      name: "response is helpful",
      model: "judge-model",
      rubric,
      adapter: new MockAiAdapter(() => ({
        output: { score: 4, explanation: "Specific and actionable" },
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        latencyMs: 5,
      })),
    });

    const result = await reevaluateRun(sourceRun(), [judge]);
    const evaluation = result.evaluations[0]!;

    assert.equal(result.status, "passed");
    assert.equal(evaluation.score, 4);
    assert.equal(evaluation.explanation, "Specific and actionable");
    assert.deepEqual(evaluation.expected, { minimumScore: 3 });
    assert.deepEqual(evaluation.actual, { score: 4 });
    assert.deepEqual(evaluation.metadata, {
      judge: {
        provider: "mock",
        adapterMode: "mocked",
        model: "judge-model",
        rubricId: "helpfulness",
        rubricVersion: "2026-10-19",
        scale: { min: 1, max: 5 },
        passingScore: 3,
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        latencyMs: 5,
      },
    });
  });

  it("redacts evidence before sending it to the judge", async () => {
    let sent = "";
    const judge = createModelJudge({
      id: "safe-judge",
      model: "judge-model",
      rubric,
      adapter: new MockAiAdapter((request) => {
        sent = JSON.stringify(request);
        return { output: { score: 3, explanation: "Enough" } };
      }),
    });
    const source = sourceRun();
    source.input = { password: "top-secret", prompt: "safe" };

    await reevaluateRun(source, [judge]);

    assert.doesNotMatch(sent, /top-secret/);
    assert.match(sent, /\[REDACTED\]/);
  });

  it("records once and replays the same judgment without spend", async () => {
    const fixtures = new MemoryFixtureRepository();
    const live = new FakeLiveJudgeAdapter();
    const recordingJudge = createModelJudge({
      id: "helpfulness",
      model: "judge-model",
      rubric,
      adapter: new RecordingAiAdapter({
        delegate: live,
        fixtures,
        now: () => new Date("2026-10-19T10:00:00.000Z"),
      }),
    });
    const liveProfile = builtInProfiles.find((profile) => profile.id === "live")!;

    const recorded = await reevaluateRun(sourceRun(), [recordingJudge], {
      profile: liveProfile,
      allowLive: true,
    });
    const replayJudge = createModelJudge({
      id: "helpfulness",
      model: "judge-model",
      rubric,
      adapter: new ReplayAiAdapter({ fixtures, provider: "openai" }),
    });
    const replayed = await reevaluateRun(sourceRun(), [replayJudge]);

    assert.equal(live.calls, 1);
    assert.equal(recorded.evaluations[0]?.score, 2);
    assert.equal(replayed.evaluations[0]?.score, 2);
    assert.equal(replayed.status, "failed");
    assert.equal(live.calls, 1);
  });

  it("blocks a live judge before the adapter without invocation authorization", async () => {
    const live = new FakeLiveJudgeAdapter();
    const judge = createModelJudge({
      id: "helpfulness",
      model: "judge-model",
      rubric,
      adapter: live,
    });
    const liveProfile = builtInProfiles.find((profile) => profile.id === "live")!;

    const result = await reevaluateRun(sourceRun(), [judge], {
      profile: liveProfile,
    });

    assert.equal(live.calls, 0);
    assert.equal(result.status, "errored");
    assert.equal(
      result.evaluations[0]?.error?.name,
      "LiveExecutionAuthorizationError",
    );
  });

  it("distinguishes a negative judgment from a judge error", async () => {
    const negative = createModelJudge({
      id: "negative",
      model: "judge-model",
      rubric,
      adapter: new MockAiAdapter(() => ({
        output: { score: 1, explanation: "Not useful" },
      })),
    });
    const broken = createModelJudge({
      id: "broken",
      model: "judge-model",
      rubric,
      adapter: new MockAiAdapter(() => ({ output: { score: "bad" } })),
    });

    const failed = await reevaluateRun(sourceRun(), [negative]);
    const errored = await reevaluateRun(sourceRun(), [broken]);

    assert.equal(failed.status, "failed");
    assert.equal(failed.evaluations[0]?.error, undefined);
    assert.equal(errored.status, "errored");
    assert.equal(errored.evaluations[0]?.error?.name, "ModelJudgeResponseError");
  });
});

const rubric = {
  id: "helpfulness",
  version: "2026-10-19",
  instructions: "Reward specific and actionable answers.",
  scale: { min: 1, max: 5 },
  passingScore: 3,
};

function sourceRun(): RunTrace {
  return {
    schemaVersion: 1,
    id: "source-run",
    projectId: "project",
    profileId: "mocked",
    flowId: "answer",
    scenarioId: "question",
    status: "passed",
    startedAt: "2026-10-19T09:00:00.000Z",
    finishedAt: "2026-10-19T09:00:00.001Z",
    durationMs: 1,
    input: "How do I test this?",
    output: "Use deterministic assertions first.",
    steps: [],
    evaluations: [],
    tags: [],
  };
}

class FakeLiveJudgeAdapter implements AiAdapter {
  readonly provider = "openai";
  readonly mode = "live" as const;
  readonly capabilities = ["network", "spend"] as const;
  calls = 0;

  async execute<T = unknown>(_request: AiRequest): Promise<AiResponse<T>> {
    this.calls += 1;
    return {
      output: { score: 2, explanation: "Too vague" } as T,
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    };
  }
}

class MemoryFixtureRepository implements AiFixtureRepository {
  saved: AiFixture | undefined;

  async get(key: string): Promise<AiFixture | undefined> {
    return this.saved?.key === key ? this.saved : undefined;
  }

  async save(fixture: AiFixture): Promise<void> {
    this.saved = fixture;
  }
}
