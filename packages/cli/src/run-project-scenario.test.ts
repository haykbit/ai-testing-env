import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineFlow,
  defineProject,
  defineScenario,
  type RunRepository,
  type RunPage,
  type RunQuery,
  type RunTrace,
} from "@ai-testing-env/core";
import { runProjectScenario } from "./run-project-scenario.js";

describe("runProjectScenario redaction boundary", () => {
  it("redacts a Trace before the RunRepository observes it", async () => {
    const repository = new SpyRunRepository();
    const flow = defineFlow<{ apiKey: string }, Record<string, unknown>>({
      id: "request",
      execute: (context, input) => context.step(
        {
          id: "http-request",
          kind: "http",
          input,
          metadata: {
            headers: { Authorization: "Bearer provider-token" },
            url: "https://example.test?token=query-secret",
          },
        },
        () => ({
          password: "response-password",
          privateNote: "internal-only",
          message: "provider returned project-secret",
        }),
      ),
    });
    const scenario = defineScenario({
      id: "redacted",
      flowId: flow.id,
      input: { apiKey: "input-secret" },
    });
    const project = defineProject({
      id: "redaction-project",
      flows: [flow],
      scenarios: [scenario],
      redaction: {
        sensitiveKeys: ["privateNote"],
        sensitiveValues: ["project-secret"],
      },
    });

    const run = await runProjectScenario(project, scenario.id, { repository });

    assert.equal(repository.saved, run);
    const serialized = JSON.stringify(repository.saved);
    for (const secret of [
      "input-secret",
      "provider-token",
      "query-secret",
      "response-password",
      "internal-only",
      "project-secret",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(secret));
    }
    assert.match(serialized, /\[REDACTED\]/);
  });
});

class SpyRunRepository implements RunRepository {
  saved: RunTrace | undefined;

  async save(run: RunTrace): Promise<void> {
    this.saved = run;
  }

  async list(): Promise<RunTrace[]> {
    return this.saved === undefined ? [] : [this.saved];
  }

  async get(id: string): Promise<RunTrace | undefined> {
    return this.saved?.id === id ? this.saved : undefined;
  }

  async query(_query?: RunQuery): Promise<RunPage> {
    return { runs: this.saved === undefined ? [] : [this.saved] };
  }
}
