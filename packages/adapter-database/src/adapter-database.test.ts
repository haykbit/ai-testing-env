import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  builtInProfiles,
  defineFlow,
  defineScenario,
  redactRunTrace,
  runScenario,
  type ExecutionProfile,
} from "@ai-testing-env/core";
import {
  ManagedDatabaseAdapter,
  runDatabaseStep,
  withDatabaseResource,
  type DatabaseDriver,
  type DatabaseOperation,
} from "./index.js";

describe("database adapter", () => {
  it("sets up, observes read/write effects, and cleans an ephemeral resource", async () => {
    const driver = new MemoryDriver();
    const adapter = new ManagedDatabaseAdapter({
      mode: "integration",
      resourceName: "ephemeral-test-database",
      driver,
    });
    const flow = defineFlow<void, number>({
      id: "database-effects",
      execute: (context) => withDatabaseResource(context, adapter, async () => {
        const inserted = await runDatabaseStep(context, adapter, {
          id: "insert-user",
          operation: {
            kind: "write",
            name: "insert user",
            statement: "insert into users(email) values (?)",
            parameters: { email: "person@example.test", password: "secret" },
          },
        });
        assert.equal(inserted.rowsAffected, 1);
        const observed = await runDatabaseStep<Array<{ email: string }>>(
          context,
          adapter,
          {
            id: "read-users",
            operation: { kind: "read", name: "read users" },
          },
        );
        return observed.rows?.length ?? 0;
      }),
    });
    const scenario = defineScenario({
      id: "database-effects",
      flowId: flow.id,
      input: undefined,
    });

    const run = redactRunTrace(await runScenario(flow, scenario, {
      projectId: "database",
      profile: writableIntegrationProfile,
    }));

    assert.equal(run.status, "passed");
    assert.equal(run.output, 1);
    assert.deepEqual(driver.events, ["setup", "write", "read", "cleanup"]);
    assert.deepEqual(
      run.steps.map((step) => step.id),
      [
        "database-resource-setup",
        "insert-user",
        "read-users",
        "database-resource-cleanup",
      ],
    );
    assert.deepEqual(run.steps[1]?.capabilities, ["network", "write"]);
    assert.deepEqual(run.steps[2]?.capabilities, ["network"]);
    assert.equal(
      ((run.steps[1]?.input as { parameters: { password: string } }).parameters).password,
      "[REDACTED]",
    );
    assert.equal(
      (run.steps[1]?.output as { rowsAffected: number }).rowsAffected,
      1,
    );
  });

  it("blocks an unauthorized write before it reaches the driver", async () => {
    const driver = new MemoryDriver();
    const adapter = new ManagedDatabaseAdapter({
      mode: "integration",
      resourceName: "controlled-database",
      driver,
    });
    await adapter.setup();
    const flow = defineFlow<void, void>({
      id: "blocked-write",
      execute: async (context) => {
        await runDatabaseStep(context, adapter, {
          id: "delete-all",
          operation: { kind: "write", name: "delete all users" },
        });
      },
    });
    const scenario = defineScenario({
      id: "blocked-write",
      flowId: flow.id,
      input: undefined,
    });
    const profile = builtInProfiles.find((entry) => entry.id === "integration")!;

    const run = await runScenario(flow, scenario, {
      projectId: "database",
      profile,
    });
    await adapter.cleanup();

    assert.equal(run.status, "errored");
    assert.equal(run.steps[0]?.error?.name, "ProfilePolicyError");
    assert.match(run.steps[0]?.error?.message ?? "", /does not allow: write/);
    assert.deepEqual(driver.events, ["setup", "cleanup"]);
  });

  it("always cleans up when the Flow operation fails", async () => {
    const driver = new MemoryDriver();
    const adapter = new ManagedDatabaseAdapter({
      mode: "mocked",
      resourceName: "memory-database",
      driver,
    });
    const flow = defineFlow<void, void>({
      id: "failing-flow",
      execute: (context) => withDatabaseResource(context, adapter, async () => {
        await runDatabaseStep(context, adapter, {
          id: "read-before-failure",
          operation: { kind: "read", name: "read users" },
        });
        throw new Error("application failed");
      }),
    });
    const scenario = defineScenario({
      id: "failing-flow",
      flowId: flow.id,
      input: undefined,
    });

    const run = await runScenario(flow, scenario, { projectId: "database" });

    assert.equal(run.status, "errored");
    assert.equal(run.error?.message, "application failed");
    assert.deepEqual(driver.events, ["setup", "read", "cleanup"]);
    assert.equal(run.steps.at(-1)?.id, "database-resource-cleanup");
    assert.equal(run.steps.at(-1)?.status, "passed");
  });

  it("records both failures when the operation and cleanup fail", async () => {
    const driver = new MemoryDriver();
    driver.failCleanup = true;
    const adapter = new ManagedDatabaseAdapter({
      mode: "mocked",
      resourceName: "memory-database",
      driver,
    });
    const flow = defineFlow<void, void>({
      id: "double-failure",
      execute: (context) => withDatabaseResource(context, adapter, () => {
        throw new Error("operation failed");
      }),
    });
    const scenario = defineScenario({
      id: "double-failure",
      flowId: flow.id,
      input: undefined,
    });

    const run = await runScenario(flow, scenario, { projectId: "database" });

    assert.equal(run.status, "errored");
    assert.equal(run.error?.name, "AggregateError");
    assert.equal(run.error?.message, "Database operation and cleanup both failed");
    assert.equal(run.steps.at(-1)?.status, "errored");
    assert.deepEqual(driver.events, ["setup", "cleanup"]);
  });
});

const writableIntegrationProfile: ExecutionProfile = {
  id: "database-integration",
  mode: "integration",
  capabilities: { network: true, write: true, spend: false },
};

interface MemoryResource {
  rows: Array<{ email: string }>;
}

class MemoryDriver implements DatabaseDriver<MemoryResource> {
  events: string[] = [];
  failCleanup = false;

  setup(): MemoryResource {
    this.events.push("setup");
    return { rows: [] };
  }

  execute<TRows = unknown>(
    resource: MemoryResource,
    operation: DatabaseOperation,
  ): Omit<import("./index.js").DatabaseResult<TRows>, "durationMs"> {
    this.events.push(operation.kind);
    if (operation.kind === "write") {
      resource.rows.push({ email: "person@example.test" });
      return { rowsAffected: 1 };
    }
    return { rows: [...resource.rows] as TRows };
  }

  cleanup(_resource: MemoryResource): void {
    this.events.push("cleanup");
    if (this.failCleanup) throw new Error("cleanup failed");
  }
}
