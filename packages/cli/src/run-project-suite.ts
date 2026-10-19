import {
  FileRunRepository,
  type ProjectDefinition,
  type RunRepository,
  type RunTrace,
  type ScenarioDefinition,
} from "@ai-testing-env/core";
import { runProjectScenario } from "./run-project-scenario.js";

export interface ScenarioSelector {
  scenarioId?: string;
  flowId?: string;
  tags?: readonly string[];
}

export interface RunProjectSuiteOptions {
  repository?: RunRepository;
  runsDirectory?: string;
  profileId?: string;
  allowLive?: boolean;
}

export interface RunSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
}

export interface RunSuiteResult {
  runs: RunTrace[];
  summary: RunSuiteSummary;
}

export async function runProjectSuite(
  project: ProjectDefinition,
  selector: ScenarioSelector,
  options: RunProjectSuiteOptions = {},
): Promise<RunSuiteResult> {
  const scenarios = selectScenarios(project, selector);
  const repository = options.repository ?? new FileRunRepository(
    options.runsDirectory ?? ".ai-test/runs",
  );
  const runs: RunTrace[] = [];

  for (const scenario of scenarios) {
    runs.push(
      await runProjectScenario(project, scenario.id, {
        repository,
        ...(options.profileId === undefined
          ? {}
          : { profileId: options.profileId }),
        allowLive: options.allowLive === true,
      }),
    );
  }

  return { runs, summary: summarizeRuns(runs) };
}

export function selectScenarios(
  project: ProjectDefinition,
  selector: ScenarioSelector,
): readonly ScenarioDefinition<any>[] {
  if (selector.scenarioId !== undefined) {
    const scenario = project.scenarios.find(
      (entry) => entry.id === selector.scenarioId,
    );
    if (scenario === undefined) {
      throw new Error(`Unknown Scenario: ${selector.scenarioId}`);
    }
    return [scenario];
  }

  if (
    selector.flowId !== undefined
    && !project.flows.some((flow) => flow.id === selector.flowId)
  ) {
    throw new Error(`Unknown Flow: ${selector.flowId}`);
  }

  const tags = selector.tags ?? [];
  const scenarios = project.scenarios.filter((scenario) =>
    (selector.flowId === undefined || scenario.flowId === selector.flowId)
    && tags.every((tag) => scenario.tags?.includes(tag) === true)
  );
  if (scenarios.length === 0) {
    throw new Error("No Scenarios matched the selected Flow and tags");
  }
  return scenarios;
}

function summarizeRuns(runs: readonly RunTrace[]): RunSuiteSummary {
  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    errored: runs.filter((run) => run.status === "errored").length,
  };
}
