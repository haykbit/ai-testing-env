import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { FileRunRepository, type RunTrace } from "@ai-testing-env/core";

const temporaryDirectories: string[] = [];
const binPath = fileURLToPath(new URL("./bin.ts", import.meta.url));
const tsxImport = fileURLToPath(import.meta.resolve("tsx"));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ai-test run", () => {
  it("loads a TypeScript Project, executes a Scenario, and persists its Trace", async () => {
    const projectDirectory = await createProject(`
      const suffix: string = "observed";
      export default {
        id: "cli-project",
        flows: [{
          id: "answer",
          execute: (context: any, input: string) => context.step(
            { id: "generate", kind: "ai", input },
            () => input + " " + suffix,
          ),
        }],
        scenarios: [{ id: "happy-path", flowId: "answer", input: "testing" }],
      };
    `);

    const result = await runCliProcess(projectDirectory, ["run", "happy-path"]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /^PASS happy-path/);
    assert.equal(result.stderr, "");
    const run = await onlyStoredRun(projectDirectory);
    assert.equal(run.projectId, "cli-project");
    assert.equal(run.status, "passed");
    assert.equal(run.output, "testing observed");
    assert.equal(run.steps[0]?.kind, "ai");
  });

  it("returns exit code 1 and keeps evidence when an Evaluation fails", async () => {
    const projectDirectory = await createProject(`
      export default {
        id: "cli-project",
        flows: [{
          id: "moderate",
          execute: (context: any) => context.step(
            {
              id: "moderate-text",
              kind: "ai",
              evaluators: [{
                name: "must approve",
                evaluate: () => ({
                  name: "must approve",
                  passed: false,
                  message: "content was rejected",
                }),
              }],
            },
            () => "rejected",
          ),
        }],
        scenarios: [{ id: "rejection", flowId: "moderate", input: null }],
      };
    `);

    const result = await runCliProcess(projectDirectory, ["run", "rejection"]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /^FAIL rejection/);
    assert.match(result.stdout, /content was rejected/);
    assert.equal((await onlyStoredRun(projectDirectory)).status, "failed");
  });

  it("returns exit code 2 and persists a Trace when the Flow errors", async () => {
    const projectDirectory = await createProject(`
      export default {
        id: "cli-project",
        flows: [{
          id: "write",
          execute: (context: any) => context.step(
            { id: "insert", kind: "database" },
            () => { throw new Error("database unavailable"); },
          ),
        }],
        scenarios: [{ id: "database-down", flowId: "write", input: null }],
      };
    `);

    const result = await runCliProcess(projectDirectory, ["run", "database-down"]);

    assert.equal(result.code, 2);
    assert.match(result.stdout, /^ERROR database-down/);
    assert.match(result.stdout, /database unavailable/);
    const run = await onlyStoredRun(projectDirectory);
    assert.equal(run.status, "errored");
    assert.equal(run.error?.message, "database unavailable");
  });

  it("reports configuration errors without creating a Run", async () => {
    const projectDirectory = await createProject(`
      export default { id: "empty", flows: [], scenarios: [] };
    `);

    const result = await runCliProcess(projectDirectory, ["run", "missing"]);

    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unknown Scenario: missing/);
    await assert.rejects(
      readdir(join(projectDirectory, ".ai-test", "runs")),
      { code: "ENOENT" },
    );
  });

  it("selects a suite by Flow and tags and emits stable JSON", async () => {
    const projectDirectory = await createProject(`
      export default {
        id: "suite-project",
        flows: [
          { id: "publish", execute: (_context: any, input: string) => input },
          { id: "moderate", execute: (_context: any, input: string) => input },
        ],
        scenarios: [
          { id: "publish-fast", flowId: "publish", input: "fast", tags: ["smoke"] },
          { id: "publish-full", flowId: "publish", input: "full", tags: ["smoke", "slow"] },
          { id: "moderate-fast", flowId: "moderate", input: "safe", tags: ["smoke"] },
        ],
      };
    `);

    const result = await runCliProcess(projectDirectory, [
      "run",
      "--flow",
      "publish",
      "--tag",
      "smoke",
      "--json",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout) as {
      schemaVersion: number;
      summary: Record<string, number>;
      runs: Array<Record<string, unknown> & { scenarioId: string }>;
    };
    assert.equal(payload.schemaVersion, 1);
    assert.deepEqual(payload.summary, {
      total: 2,
      passed: 2,
      failed: 0,
      errored: 0,
    });
    assert.deepEqual(Object.keys(payload.runs[0] ?? {}).sort(), [
      "durationMs",
      "flowId",
      "id",
      "profileId",
      "projectId",
      "scenarioId",
      "status",
    ]);
    assert.deepEqual(
      payload.runs.map((run) => run.scenarioId),
      ["publish-fast", "publish-full"],
    );
    assert.equal((await storedRuns(projectDirectory)).length, 2);
  });

  it("persists later Runs when an earlier Scenario errors", async () => {
    const projectDirectory = await createProject(`
      export default {
        id: "suite-project",
        flows: [{
          id: "process",
          execute: (context: any, input: string) => context.step(
            { id: "work", kind: "code", input },
            () => {
              if (input === "explode") throw new Error("boom");
              return input;
            },
          ),
        }],
        scenarios: [
          { id: "first-errors", flowId: "process", input: "explode", tags: ["ci"] },
          { id: "second-passes", flowId: "process", input: "safe", tags: ["ci"] },
        ],
      };
    `);

    const result = await runCliProcess(projectDirectory, [
      "run",
      "--tag",
      "ci",
    ]);

    assert.equal(result.code, 2);
    assert.match(result.stdout, /ERROR first-errors/);
    assert.match(result.stdout, /PASS second-passes/);
    assert.match(result.stdout, /Summary: 1 passed, 0 failed, 1 errored/);
    assert.deepEqual(
      (await storedRuns(projectDirectory)).map((run) => run.status).sort(),
      ["errored", "passed"],
    );
  });

  it("selects a Profile and blocks denied capabilities before execution", async () => {
    const projectDirectory = await createProject(`
      export default {
        id: "profile-project",
        flows: [{
          id: "request",
          execute: (context: any) => context.step(
            { id: "http-request", kind: "http", capabilities: ["network"] },
            () => "response",
          ),
        }],
        scenarios: [{
          id: "recorded-default",
          flowId: "request",
          input: null,
          profileId: "recorded",
        }],
      };
    `);

    const blocked = await runCliProcess(projectDirectory, [
      "run",
      "recorded-default",
    ]);
    assert.equal(blocked.code, 2);
    assert.match(blocked.stdout, /Profile recorded does not allow: network/);

    const allowed = await runCliProcess(projectDirectory, [
      "run",
      "recorded-default",
      "--profile",
      "integration",
    ]);
    assert.equal(allowed.code, 0);
    assert.match(allowed.stdout, /PASS recorded-default \[integration\]/);

    assert.deepEqual(
      (await storedRuns(projectDirectory)).map((run) => run.profileId).sort(),
      ["integration", "recorded"],
    );
  });
});

async function createProject(config: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-testing-env-cli-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".ai-test", "config.ts");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, config, "utf8");
  return directory;
}

async function onlyStoredRun(projectDirectory: string): Promise<RunTrace> {
  const runsDirectory = join(projectDirectory, ".ai-test", "runs");
  const entries = await readdir(runsDirectory);
  assert.equal(entries.length, 1);
  const id = entries[0]?.replace(/\.json$/, "");
  assert.ok(id);
  const repository = new FileRunRepository(runsDirectory);
  const run = await repository.get(id);
  assert.ok(run);
  const raw = await readFile(join(runsDirectory, entries[0]!), "utf8");
  assert.equal(JSON.parse(raw).id, run.id);
  return run;
}

async function storedRuns(projectDirectory: string): Promise<RunTrace[]> {
  const repository = new FileRunRepository(
    join(projectDirectory, ".ai-test", "runs"),
  );
  return repository.list();
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCliProcess(cwd: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxImport, binPath, ...args],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
