import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineProject, type ProjectDefinition } from "@ai-testing-env/core";
import { tsImport } from "tsx/esm/api";

export const defaultConfigPath = ".ai-test/config.ts";

export interface LoadProjectOptions {
  cwd?: string;
  configPath?: string;
}

export async function loadProject(
  options: LoadProjectOptions = {},
): Promise<ProjectDefinition> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolve(cwd, options.configPath ?? defaultConfigPath);

  try {
    await access(configPath);
  } catch {
    throw new Error(`Configuration not found: ${configPath}`);
  }

  let loaded: unknown;
  try {
    loaded = await tsImport(pathToFileURL(configPath).href, import.meta.url);
  } catch (error) {
    throw new Error(
      `Unable to load configuration ${configPath}: ${errorMessage(error)}`,
    );
  }

  const candidate = projectExport(loaded);
  assertProjectShape(candidate, configPath);
  return defineProject(candidate);
}

function projectExport(loaded: unknown): unknown {
  let candidate = loaded;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(candidate)) {
      return undefined;
    }
    if (typeof candidate.id === "string") {
      return candidate;
    }
    if ("project" in candidate) {
      candidate = candidate.project;
      continue;
    }
    if ("default" in candidate) {
      candidate = candidate.default;
      continue;
    }
    return undefined;
  }
  return candidate;
}

function assertProjectShape(
  candidate: unknown,
  configPath: string,
): asserts candidate is ProjectDefinition {
  if (!isRecord(candidate)) {
    throw new Error(
      `Configuration ${configPath} must default-export a Project definition`,
    );
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new Error(`Configuration ${configPath} must define a Project id`);
  }
  if (!Array.isArray(candidate.flows) || !Array.isArray(candidate.scenarios)) {
    throw new Error(
      `Configuration ${configPath} must define Flow and Scenario arrays`,
    );
  }
  for (const flow of candidate.flows) {
    if (
      !isRecord(flow) ||
      typeof flow.id !== "string" ||
      flow.id.length === 0 ||
      typeof flow.execute !== "function"
    ) {
      throw new Error(`Configuration ${configPath} contains an invalid Flow`);
    }
  }
  for (const scenario of candidate.scenarios) {
    if (
      !isRecord(scenario) ||
      typeof scenario.id !== "string" ||
      scenario.id.length === 0 ||
      typeof scenario.flowId !== "string" ||
      !("input" in scenario)
    ) {
      throw new Error(`Configuration ${configPath} contains an invalid Scenario`);
    }
  }
  if (candidate.evaluations !== undefined) {
    if (!Array.isArray(candidate.evaluations)) {
      throw new Error(`Configuration ${configPath} evaluations must be an array`);
    }
    for (const evaluation of candidate.evaluations) {
      if (
        !isRecord(evaluation)
        || typeof evaluation.id !== "string"
        || evaluation.id.length === 0
        || typeof evaluation.evaluate !== "function"
      ) {
        throw new Error(
          `Configuration ${configPath} contains an invalid Evaluation`,
        );
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
