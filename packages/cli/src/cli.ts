import { resolve } from "node:path";
import {
  FileRunRepository,
  type RunQuery,
  type RunTrace,
  type Verdict,
} from "@ai-testing-env/core";
import { loadProject } from "./config-loader.js";
import {
  discoverProject,
  type ProjectDiscoveryReport,
} from "./discovery.js";
import {
  runProjectSuite,
  type RunSuiteResult,
} from "./run-project-suite.js";
import { reevaluateProjectRun } from "./reevaluate-project-run.js";

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

    if (command.kind === "runs") {
      const repository = new FileRunRepository(
        resolve(cwd, command.runsDirectory ?? ".ai-test/runs"),
      );
      const page = await repository.query(command.query);
      io.stdout.write(command.json
        ? `${JSON.stringify({ schemaVersion: 1, ...page })}\n`
        : formatRunPage(page.runs, page.nextCursor));
      return 0;
    }
    if (command.kind === "init") {
      const report = await discoverProject(cwd, {
        ...(command.savePath === undefined ? {} : { savePath: command.savePath }),
      });
      io.stdout.write(command.json
        ? `${JSON.stringify(report)}\n`
        : formatDiscovery(report, command.savePath));
      return 0;
    }

    const project = await loadProject({
      cwd,
      ...(command.configPath === undefined
        ? {}
        : { configPath: command.configPath }),
    });
    const runsDirectory = resolve(cwd, command.runsDirectory ?? ".ai-test/runs");
    if (command.kind === "reevaluate") {
      const run = await reevaluateProjectRun(
        project,
        command.sourceRunId,
        command.evaluationIds,
        {
          runsDirectory,
          ...(command.profileId === undefined
            ? {}
            : { profileId: command.profileId }),
          allowLive: command.allowLive,
        },
      );
      io.stdout.write(command.json
        ? `${JSON.stringify({ schemaVersion: 1, run })}\n`
        : formatReevaluation(run));
      return run.status === "passed" ? 0 : run.status === "failed" ? 1 : 2;
    }
    const result = await runProjectSuite(project, command.selector, {
      runsDirectory,
      ...(command.profileId === undefined
        ? {}
        : { profileId: command.profileId }),
      allowLive: command.allowLive,
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
  | { kind: "init"; savePath?: string; json: boolean }
  | {
      kind: "runs";
      query: RunQuery;
      runsDirectory?: string;
      json: boolean;
    }
  | {
      kind: "reevaluate";
      sourceRunId: string;
      evaluationIds: string[];
      configPath?: string;
      runsDirectory?: string;
      profileId?: string;
      allowLive: boolean;
      json: boolean;
    }
  | {
      kind: "run";
      selector: {
        scenarioId?: string;
        flowId?: string;
        tags?: string[];
      };
      configPath?: string;
      runsDirectory?: string;
      profileId?: string;
      allowLive: boolean;
      json: boolean;
    };

function parseCommand(args: readonly string[]): Command {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }
  if (args[0] === "reevaluate") return parseReevaluateCommand(args.slice(1));
  if (args[0] === "runs") return parseRunsCommand(args.slice(1));
  if (args[0] === "init") return parseInitCommand(args.slice(1));
  if (args[0] !== "run") {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  let scenarioId: string | undefined;
  let flowId: string | undefined;
  const tags: string[] = [];
  let configPath: string | undefined;
  let runsDirectory: string | undefined;
  let profileId: string | undefined;
  let allowLive = false;
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
    } else if (argument === "--profile") {
      profileId = optionValue(argument, value);
      index += 1;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--allow-live") {
      allowLive = true;
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
    ...(profileId === undefined ? {} : { profileId }),
    allowLive,
    json,
  };
}

function parseInitCommand(args: readonly string[]): Command {
  let savePath: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--save") {
      savePath = optionValue(argument, args[index + 1]);
      index += 1;
    } else if (argument === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return {
    kind: "init",
    ...(savePath === undefined ? {} : { savePath }),
    json,
  };
}

function parseRunsCommand(args: readonly string[]): Command {
  const query: RunQuery & { tags?: string[] } = {};
  let runsDirectory: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--project") {
      query.projectId = optionValue(argument, value); index += 1;
    } else if (argument === "--flow") {
      query.flowId = optionValue(argument, value); index += 1;
    } else if (argument === "--scenario") {
      query.scenarioId = optionValue(argument, value); index += 1;
    } else if (argument === "--verdict") {
      query.status = verdictValue(optionValue(argument, value)); index += 1;
    } else if (argument === "--tag") {
      query.tags = [...(query.tags ?? []), optionValue(argument, value)]; index += 1;
    } else if (argument === "--from") {
      query.startedFrom = dateValue(argument, optionValue(argument, value)); index += 1;
    } else if (argument === "--to") {
      query.startedTo = dateValue(argument, optionValue(argument, value)); index += 1;
    } else if (argument === "--limit") {
      query.limit = numberValue(argument, optionValue(argument, value)); index += 1;
    } else if (argument === "--cursor") {
      query.cursor = optionValue(argument, value); index += 1;
    } else if (argument === "--runs-dir") {
      runsDirectory = optionValue(argument, value); index += 1;
    } else if (argument === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return {
    kind: "runs",
    query,
    ...(runsDirectory === undefined ? {} : { runsDirectory }),
    json,
  };
}

function parseReevaluateCommand(args: readonly string[]): Command {
  let sourceRunId: string | undefined;
  const evaluationIds: string[] = [];
  let configPath: string | undefined;
  let runsDirectory: string | undefined;
  let profileId: string | undefined;
  let allowLive = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--evaluation") {
      evaluationIds.push(optionValue(argument, value));
      index += 1;
    } else if (argument === "--config") {
      configPath = optionValue(argument, value);
      index += 1;
    } else if (argument === "--runs-dir") {
      runsDirectory = optionValue(argument, value);
      index += 1;
    } else if (argument === "--profile") {
      profileId = optionValue(argument, value);
      index += 1;
    } else if (argument === "--allow-live") {
      allowLive = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument !== undefined && !argument.startsWith("-") && sourceRunId === undefined) {
      sourceRunId = argument;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (sourceRunId === undefined) throw new Error("Select a Run id to reevaluate");
  if (evaluationIds.length === 0) {
    throw new Error("Select at least one --evaluation");
  }
  if (new Set(evaluationIds).size !== evaluationIds.length) {
    throw new Error("Evaluation ids must be unique");
  }
  return {
    kind: "reevaluate",
    sourceRunId,
    evaluationIds,
    ...(configPath === undefined ? {} : { configPath }),
    ...(runsDirectory === undefined ? {} : { runsDirectory }),
    ...(profileId === undefined ? {} : { profileId }),
    allowLive,
    json,
  };
}

function optionValue(option: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function verdictValue(value: string): Verdict {
  if (value !== "passed" && value !== "failed" && value !== "errored") {
    throw new Error(`Invalid Verdict: ${value}`);
  }
  return value;
}

function dateValue(option: string, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for ${option}: ${value}`);
  return date.toISOString();
}

function numberValue(option: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Invalid number for ${option}: ${value}`);
  return number;
}

function formatRunPage(runs: readonly RunTrace[], nextCursor?: string): string {
  return [
    ...runs.map((run) =>
      `${run.id}\t${run.status}\t${run.projectId}/${run.flowId}/${run.scenarioId}\t${run.startedAt}`
    ),
    ...(nextCursor === undefined ? [] : [`Next cursor: ${nextCursor}`]),
    "",
  ].join("\n");
}

function formatDiscovery(
  report: ProjectDiscoveryReport,
  savePath?: string,
): string {
  const list = (values: readonly string[]) => values.length === 0
    ? "none"
    : values.join(", ");
  return [
    `Project discovery: ${report.root}`,
    `Files scanned: ${report.filesScanned}`,
    `Languages: ${list(report.inventory.languages)}`,
    `AI SDKs: ${list(report.inventory.aiSdks)}`,
    `Database clients: ${list(report.inventory.databaseClients)}`,
    `Test tools: ${list(report.inventory.testTools)}`,
    `Prompts: ${report.inventory.prompts.length}`,
    `Schemas: ${report.inventory.schemas.length}`,
    `Endpoints: ${report.inventory.endpoints.length}`,
    `Entrypoints: ${report.inventory.entrypoints.length}`,
    "",
    "Proposal status: review-required",
    ...report.proposal.flowCandidates.map((candidate) =>
      `  ? ${candidate.file} — ${candidate.reason}`
    ),
    ...report.proposal.uncertainties.map((uncertainty) => `  ! ${uncertainty}`),
    savePath === undefined
      ? "Dry run: no configuration or proposal file was written."
      : `Saved proposal: ${savePath}`,
    "",
  ].join("\n");
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
      profileId: run.profileId,
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
    `${marker} ${run.scenarioId} [${run.profileId}] (${run.durationMs} ms)`,
    `Run ${run.id}`,
    ...details,
    ...runEvaluationDetails,
    ...unscopedError,
    "",
  ].join("\n");
}

function formatReevaluation(run: RunTrace): string {
  const marker = run.status === "passed" ? "PASS" : "FAIL";
  return [
    `${marker} reevaluation ${run.id} of ${run.sourceRunId}`,
    ...run.evaluations.map((evaluation) =>
      `  ${evaluation.passed ? "PASS" : "FAIL"} ${evaluation.name}${
        evaluation.message === undefined ? "" : ` — ${evaluation.message}`
      }`
    ),
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
  ai-test run <scenario-id> [--profile <profile-id>] [--allow-live] [--json]
  ai-test run [--flow <flow-id>] [--tag <tag>...] [--profile <profile-id>] [--allow-live] [--json]
  ai-test reevaluate <run-id> --evaluation <evaluation-id>... [--profile <profile-id>] [--allow-live] [--json]
  ai-test runs [--project <id>] [--flow <id>] [--scenario <id>] [--verdict <status>] [--tag <tag>...] [--from <date>] [--to <date>] [--limit <n>] [--cursor <cursor>] [--json]
  ai-test init [--json] [--save <proposal-path>]
`;
