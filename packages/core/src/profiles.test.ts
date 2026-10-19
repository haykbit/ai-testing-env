import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCapabilitiesAllowed,
  builtInProfiles,
  defineFlow,
  defineProject,
  defineScenario,
  runScenario,
  type ResourceCapability,
} from "./index.js";

describe("execution Profiles", () => {
  it("enforces the built-in capability matrix", () => {
    const capabilities: ResourceCapability[] = ["network", "write", "spend"];
    const expected: Record<string, ResourceCapability[]> = {
      mocked: capabilities,
      recorded: capabilities,
      integration: ["write", "spend"],
      live: [],
    };

    for (const profile of builtInProfiles) {
      for (const capability of capabilities) {
        if (expected[profile.id]?.includes(capability) === true) {
          assert.throws(
            () => assertCapabilitiesAllowed(profile, [capability]),
            new RegExp(`Profile ${profile.id} does not allow: ${capability}`),
          );
        } else {
          assert.doesNotThrow(() =>
            assertCapabilitiesAllowed(profile, [capability]),
          );
        }
      }
    }
  });

  it("blocks a Step before its operation and records policy evidence", async () => {
    let operationCalled = false;
    const flow = defineFlow<void, string>({
      id: "call-service",
      execute: (context) => context.step(
        {
          id: "request",
          kind: "http",
          capabilities: ["network"],
        },
        () => {
          operationCalled = true;
          return "unexpected";
        },
      ),
    });
    const scenario = defineScenario({
      id: "safe-default",
      flowId: flow.id,
      input: undefined,
    });

    const run = await runScenario(flow, scenario, { projectId: "profiles" });

    assert.equal(operationCalled, false);
    assert.equal(run.profileId, "mocked");
    assert.equal(run.status, "errored");
    assert.deepEqual(run.steps[0]?.capabilities, ["network"]);
    assert.equal(run.steps[0]?.error?.name, "ProfilePolicyError");
    assert.match(run.steps[0]?.error?.message ?? "", /does not allow: network/);
  });

  it("validates Profile identifiers referenced by a Project", () => {
    const flow = defineFlow<void, void>({ id: "flow", execute: () => undefined });
    const scenario = defineScenario({
      id: "scenario",
      flowId: flow.id,
      input: undefined,
      profileId: "missing",
    });

    assert.throws(
      () => defineProject({ id: "project", flows: [flow], scenarios: [scenario] }),
      /references unknown profile missing/,
    );
    assert.throws(
      () => defineProject({
        id: "project",
        flows: [flow],
        scenarios: [],
        profiles: [{
          id: "mocked",
          mode: "mocked",
          capabilities: { network: false, write: false, spend: false },
        }],
      }),
      /Duplicate profile id: mocked/,
    );
  });
});
