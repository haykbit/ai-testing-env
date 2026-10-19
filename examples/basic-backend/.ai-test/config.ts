import {
  defineFlow,
  defineProject,
  defineScenario,
} from "ai-testing-env";
import { MockAiAdapter, runAiStep } from "@ai-testing-env/adapter-ai";
import {
  ManagedDatabaseAdapter,
  runDatabaseStep,
  withDatabaseResource,
  type DatabaseDriver,
  type DatabaseOperation,
} from "@ai-testing-env/adapter-database";
import { MockHttpAdapter, runHttpStep } from "@ai-testing-env/adapter-http";
import { publishContent } from "../src/content.js";

class ExampleDatabaseDriver implements DatabaseDriver<Map<string, unknown>> {
  setup(): Map<string, unknown> {
    return new Map();
  }

  execute<TRows>(
    resource: Map<string, unknown>,
    operation: DatabaseOperation,
  ): { rowsAffected: number } {
    resource.set(operation.name, operation.parameters);
    return { rowsAffected: 1 };
  }

  cleanup(resource: Map<string, unknown>): void {
    resource.clear();
  }
}

const ai = new MockAiAdapter(() => ({
  output: { classification: "educational" },
  text: "educational",
  usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
  latencyMs: 0,
}));
const http = new MockHttpAdapter(() => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: { accepted: true },
  durationMs: 0,
}));
const database = new ManagedDatabaseAdapter({
  mode: "mocked",
  resourceName: "example-memory-database",
  driver: new ExampleDatabaseDriver(),
});

const publish = defineFlow({
  id: "publish-content",
  async execute(context, input: { topic: string }) {
    const published = await context.step(
      {
        id: "publish",
        kind: "code",
        input,
        evaluators: [
          {
            name: "summary mentions topic",
            evaluate: ({ value }) => ({
              name: "summary mentions topic",
              passed: value.summary.toLowerCase().includes(input.topic.toLowerCase()),
            }),
          },
        ],
      },
      () => publishContent(input.topic),
    );
    await runAiStep(context, ai, {
      id: "classify-content",
      request: { model: "deterministic-example", prompt: published.summary },
    });
    await runHttpStep(context, http, {
      id: "notify-service",
      request: {
        method: "POST",
        url: "https://example.invalid/content",
        headers: { "content-type": "application/json" },
        body: published,
      },
    });
    await withDatabaseResource(context, database, () =>
      runDatabaseStep(context, database, {
        id: "store-content",
        operation: {
          kind: "write",
          name: "store content",
          parameters: published,
        },
      })
    );
    return published;
  },
  evaluators: [
    {
      name: "slug is URL-safe",
      evaluate: ({ value }) => ({
        name: "slug is URL-safe",
        passed: /^[a-z0-9-]+$/.test(value.slug),
      }),
    },
  ],
});

const happyPath = defineScenario({
  id: "publish-happy-path",
  flowId: publish.id,
  input: { topic: "AI testing" },
  tags: ["mocked", "smoke"],
  profileId: "mocked",
});

export default defineProject({
  id: "basic-backend",
  flows: [publish],
  scenarios: [happyPath],
});
