import { resolve } from "node:path";
import type { RunTrace } from "@ai-testing-env/core";
import { loadProject } from "./config-loader.js";
import { runProjectScenario } from "./run-project-scenario.js";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface RunCliOptions {
  cwd?: string;
  io?: CliIo;
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };

  try {
    const command = parseCommand(args);
    if (command.kind === "help") {
      io.stdout.write(helpText);
      return 0;
    }

    const project = await loadProject({
      cwd,
      ...(command.configPath === undefined
        ? {}
        : { configPath: command.configPath }),
    });
    const runsDirectory = resolve(cwd, command.runsDirectory ?? ".ai-test/runs");
    const run = await runProjectScenario(project, command.scenarioId, {
      runsDirectory,
    });
    io.stdout.write(formatRun(run));
    return exitCodeFor(run);
  } catch (error) {
    io.stderr.write(`error: ${errorMessage(error)}\n`);
    return 2;
  }
}

type Command =
  | { kind: "help" }
  | {
      kind: "run";
      scenarioId: string;
      configPath?: string;
      runsDirectory?: string;
    };

function parseCommand(args: readonly string[]): Command {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }
  if (args[0] !== "run") {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  const scenarioId = args[1];
  if (scenarioId === undefined || scenarioId.startsWith("-")) {
    throw new Error("Usage: ai-test run <scenario-id>");
  }

  let configPath: string | undefined;
  let runsDirectory: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--config" && value !== undefined) {
      configPath = value;
      index += 1;
    } else if (argument === "--runs-dir" && value !== undefined) {
      runsDirectory = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return {
    kind: "run",
    scenarioId,
    ...(configPath === undefined ? {} : { configPath }),
    ...(runsDirectory === undefined ? {} : { runsDirectory }),
  };
}

function formatRun(run: RunTrace): string {
  const marker = run.status === "passed"
    ? "PASS"
    : run.status === "failed"
      ? "FAIL"
      : "ERROR";
  const failedSteps = run.steps.filter((step) => step.status !== "passed");
  const details = failedSteps.map((step) => {
    const reason = step.error?.message
      ?? step.evaluations.find((evaluation) => !evaluation.passed)?.message;
    return `  ${step.status.toUpperCase()} ${step.id}${
      reason === undefined ? "" : ` — ${reason}`
    }`;
  });
  const runEvaluationDetails = run.evaluations
    .filter((evaluation) => !evaluation.passed)
    .map((evaluation) =>
      `  FAIL ${evaluation.name}${
        evaluation.message === undefined ? "" : ` — ${evaluation.message}`
      }`,
    );
  const unscopedError = run.error !== undefined && failedSteps.length === 0
    ? [`  ERROR run — ${run.error.message}`]
    : [];
  return [
    `${marker} ${run.scenarioId} (${run.durationMs} ms)`,
    `Run ${run.id}`,
    ...details,
    ...runEvaluationDetails,
    ...unscopedError,
    "",
  ].join("\n");
}

function exitCodeFor(run: RunTrace): number {
  if (run.status === "passed") return 0;
  if (run.status === "failed") return 1;
  return 2;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const helpText = `ai-testing-env

Usage:
  ai-test run <scenario-id> [--config <path>] [--runs-dir <path>]
`;
