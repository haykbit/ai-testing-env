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
