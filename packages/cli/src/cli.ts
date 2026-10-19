import { resolve } from "node:path";
import type { RunTrace } from "@ai-testing-env/core";
import { loadProject } from "./config-loader.js";
import {
  runProjectSuite,
  type RunSuiteResult,
} from "./run-project-suite.js";

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
    const result = await runProjectSuite(project, command.selector, {
      runsDirectory,
    });
    io.stdout.write(command.json ? formatJson(result) : formatSuite(result));
    return exitCodeFor(result);
  } catch (error) {
    io.stderr.write(`error: ${errorMessage(error)}\n`);
    return 2;
  }
}

type Command =
  | { kind: "help" }
  | {
      kind: "run";
      selector: {
        scenarioId?: string;
        flowId?: string;
        tags?: string[];
      };
      configPath?: string;
      runsDirectory?: string;
      json: boolean;
    };

function parseCommand(args: readonly string[]): Command {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }
  if (args[0] !== "run") {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  let scenarioId: string | undefined;
  let flowId: string | undefined;
  const tags: string[] = [];
  let configPath: string | undefined;
  let runsDirectory: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--flow") {
      flowId = optionValue(argument, value);
      index += 1;
    } else if (argument === "--tag") {
      tags.push(optionValue(argument, value));
      index += 1;
    } else if (argument === "--config") {
      configPath = optionValue(argument, value);
      index += 1;
    } else if (argument === "--runs-dir") {
      runsDirectory = optionValue(argument, value);
      index += 1;
    } else if (argument === "--json") {
      json = true;
    } else if (argument !== undefined && !argument.startsWith("-") && scenarioId === undefined) {
      scenarioId = argument;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (scenarioId !== undefined && (flowId !== undefined || tags.length > 0)) {
    throw new Error("A Scenario id cannot be combined with --flow or --tag");
  }
  if (scenarioId === undefined && flowId === undefined && tags.length === 0) {
    throw new Error("Select a Scenario id, --flow, or at least one --tag");
  }

  return {
    kind: "run",
    selector: {
      ...(scenarioId === undefined ? {} : { scenarioId }),
      ...(flowId === undefined ? {} : { flowId }),
      ...(tags.length === 0 ? {} : { tags }),
    },
    ...(configPath === undefined ? {} : { configPath }),
    ...(runsDirectory === undefined ? {} : { runsDirectory }),
    json,
  };
}

function optionValue(option: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function formatSuite(result: RunSuiteResult): string {
  return [
    ...result.runs.map(formatRun),
    `Summary: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.errored} errored`,
    "",
  ].join("\n");
}

function formatJson(result: RunSuiteResult): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    summary: result.summary,
    runs: result.runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      flowId: run.flowId,
      scenarioId: run.scenarioId,
      status: run.status,
      durationMs: run.durationMs,
    })),
  })}\n`;
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

function exitCodeFor(result: RunSuiteResult): number {
  if (result.summary.errored > 0) return 2;
  if (result.summary.failed > 0) return 1;
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const helpText = `ai-testing-env

Usage:
  ai-test run <scenario-id> [--json] [--config <path>] [--runs-dir <path>]
  ai-test run [--flow <flow-id>] [--tag <tag>...] [--json]
`;
